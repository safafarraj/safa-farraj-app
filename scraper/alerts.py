"""Time-based alerts (run on every cycle, cheap: database only) and push delivery."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from .db import DB

AGENT_OFFSETS = [120, 60, 30, 7, 1]      # 4 months, 2 months, 1 month, week, day
CLUB_OFFSETS = [182, 91, 30, 7, 1]       # half year, 3 months, 1 month, week, day
WEEKDAY_WED, WEEKDAY_FRI, WEEKDAY_SAT, WEEKDAY_SUN = 2, 4, 5, 6


def player_minutes(db: DB, player: dict, length: int) -> dict:
    """Minutes played vs possible this season, over the team's finished games (excluded games removed)."""
    games = db.select("games", f"ifa_team_id=eq.{player['ifa_team_id']}&status=eq.final&season_id=eq.{player['current_season_id']}&select=id")
    gp = {r["game_id"]: r for r in db.select("game_players", f"player_id=eq.{player['id']}&select=game_id,minutes,excluded_from_contract")}
    counted = [g["id"] for g in games if not (gp.get(g["id"]) or {}).get("excluded_from_contract")]
    played = sum((gp.get(i) or {}).get("minutes", 0) for i in counted)
    possible = len(counted) * length
    return {"played": played, "possible": possible, "pct": (100.0 * played / possible) if possible else None}


class Alerts:
    def __init__(self, db: DB, now: datetime, notify):
        self.db, self.now, self.today, self.notify = db, now, now.date(), notify
        self.players = db.select("players", "active=eq.true&select=*")
        self.leagues = {l["ifa_league_id"]: l for l in db.select("leagues", "select=ifa_league_id,game_length_min")}

    def run(self) -> None:
        for fn in (self.weekly_schedule, self.reports_ready, self.pregame, self.birthdays, self.contracts,
                   self.minutes_color, self.two_missed, self.weekly_summary):
            try:
                fn()
            except Exception as e:  # one failing alert type must not block the others
                print(f"alert {fn.__name__} failed: {type(e).__name__}: {str(e)[:200]}")

    def at_least(self, hour: int, minute: int = 0) -> bool:
        return (self.now.hour, self.now.minute) >= (hour, minute)

    # (1) Wednesday 20:00 — two separate alerts
    def weekly_schedule(self) -> None:
        if self.today.weekday() != WEEKDAY_WED or not self.at_least(20):
            return
        kinds = {p["kind"] for p in self.players}
        for aud, label in (("mine", "שחקנים שלי"), ("tracked", "שחקנים במעקב")):
            if aud in kinds:
                self.notify("weekly_schedule", label, "לוח המשחקים לסופ״ש הקרוב מוכן",
                            f"weekly:{self.today}:{aud}", {"kind": aud}, f"/schedule?aud={aud}")

    # (5) Friday + Saturday 20:00 — today's reports are ready
    def reports_ready(self) -> None:
        if self.today.weekday() not in (WEEKDAY_FRI, WEEKDAY_SAT) or not self.at_least(20):
            return
        start = datetime.combine(self.today, datetime.min.time(), self.now.tzinfo).isoformat()
        reps = self.db.select("notifications", f"kind=eq.report&created_at=gte.{start}&select=audience")
        for aud in sorted({r["audience"] for r in reps}):
            label = "שחקנים שלי" if aud == "mine" else "שחקנים במעקב"
            self.notify("reports_ready", f"📊 כל הדוחות של היום מוכנים · {label}", f"{sum(1 for r in reps if r['audience'] == aud)} דוחות משחק",
                        f"ready:{self.today}:{aud}", {"kind": aud}, f"/reports?aud={aud}")

    # (2) 30 minutes before kick-off
    def pregame(self) -> None:
        games = self.db.select("games", f"game_date=eq.{self.today}&kickoff_time=not.is.null&status=neq.final&select=*")
        for g in games:
            ko = datetime.combine(self.today, datetime.strptime(g["kickoff_time"][:5], "%H:%M").time(), self.now.tzinfo)
            if not (ko - timedelta(minutes=30) <= self.now < ko):
                continue
            for p in self.players:
                if p.get("ifa_team_id") != g["ifa_team_id"]:
                    continue
                home = g["home_team"] == p.get("team_name")
                opp = g["away_team"] if home else g["home_team"]
                gp = self.db.select("game_players", f"game_id=eq.{g['id']}&player_id=eq.{p['id']}&select=status")
                lineup = {"starter": "בהרכב ✅", "sub_in": "על הספסל", "bench": "על הספסל",
                          "not_in_squad": "לא בסגל ❌"}.get(gp[0]["status"], "") if gp else "הרכב טרם פורסם"
                self.notify("pregame", f"⏰ בעוד 30 דק' · {p['name']}",
                            f"נגד {opp} · {g['kickoff_time'][:5]} · {g.get('venue') or 'מגרש טרם נקבע'} · {lineup}",
                            f"pre:{g['id']}:{p['id']}", p, f"/player/{p['id']}/games")

    # (8) birthdays at 08:00 (player or his coach) — dates are entered manually
    def birthdays(self) -> None:
        if not self.at_least(8):
            return
        for p in self.players:
            for field, who in (("birth_date", p["name"]), ("coach_birth_date", f"המאמן {p.get('coach_name') or ''} של {p['name']}")):
                d = p.get(field)
                if d and d[5:] == self.today.isoformat()[5:]:
                    self.notify("birthday", "🎂 יום הולדת היום", who, f"bday:{field}:{p['id']}:{self.today.year}", p, f"/player/{p['id']}")

    # (6) contract end reminders
    def contracts(self) -> None:
        byid = {p["id"]: p for p in self.players}
        for c in self.db.select("contracts", "end_date=not.is.null&select=*"):
            p = byid.get(c["player_id"])
            if not p:
                continue
            end = date.fromisoformat(c["end_date"])
            offsets = c.get("alert_offsets_days") or (AGENT_OFFSETS if c["contract_type"] == "agent" else CLUB_OFFSETS)
            left = (end - self.today).days
            if left in offsets:
                label = "חוזה עם הסוכן" if c["contract_type"] == "agent" else "חוזה עם המועדון"
                self.notify("contract", f"📄 {label} · {p['name']}", f"מסתיים בעוד {left} ימים ({end:%d/%m/%Y})",
                            f"contract:{c['id']}:{left}", p, f"/player/{p['id']}/contracts")

    # (7) minutes colour change vs contract commitment
    def minutes_color(self) -> None:
        clubs = {c["player_id"]: c for c in self.db.select("contracts", "contract_type=eq.club&confirmed=eq.true&minutes_commitment_pct=not.is.null&select=*")}
        for p in self.players:
            c = clubs.get(p["id"])
            if not c or not p.get("ifa_team_id"):
                continue
            length = (self.leagues.get(p.get("ifa_league_id")) or {}).get("game_length_min") or 90
            m = player_minutes(self.db, p, length)
            if m["pct"] is None:
                continue
            color = "green" if m["pct"] >= float(c["minutes_commitment_pct"]) else "red"
            key = f"color:{p['id']}"
            prev = self.db.get_state(key)
            if prev and prev != color:
                word = "חזר לירוק ✅" if color == "green" else "ירד לאדום ⚠️"
                self.notify("minutes_color", f"⏱️ {p['name']} {word}",
                            f"{m['pct']:.1f}% דקות מתוך {float(c['minutes_commitment_pct']):g}% בחוזה",
                            f"color:{p['id']}:{color}:{self.today}", p, f"/player/{p['id']}/stats")
            if prev != color:
                self.db.set_state(key, color)

    # extra: two finished games in a row without playing
    def two_missed(self) -> None:
        for p in self.players:
            rows = self.db.select("game_players", f"player_id=eq.{p['id']}&select=status,games!inner(id,game_date,status)&games.status=eq.final")
            rows = sorted(rows, key=lambda r: r["games"]["game_date"], reverse=True)[:2]
            if len(rows) == 2 and all(r["status"] in ("bench", "not_in_squad") for r in rows):
                self.notify("missed_two", f"⚠️ {p['name']} לא שותף שני משחקים ברצף", "כדאי לבדוק מול המאמן",
                            f"dnp:{p['id']}:{rows[0]['games']['id']}", p, f"/player/{p['id']}/games")

    # Sunday morning weekly summary
    def weekly_summary(self) -> None:
        if self.today.weekday() != WEEKDAY_SUN or not self.at_least(8):
            return
        since = (self.today - timedelta(days=7)).isoformat()
        lines = []
        for p in [p for p in self.players if p["kind"] == "mine"]:
            rows = self.db.select("game_players", f"player_id=eq.{p['id']}&select=minutes,goals,status,games!inner(game_date,home_team,away_team,home_score,away_score)&games.game_date=gte.{since}&games.status=eq.final")
            if not rows:
                lines.append(f"{p['name']}: לא שיחק השבוע")
                continue
            parts = []
            for r in rows:
                g = r["games"]
                home = g["home_team"] == p.get("team_name")
                ours, theirs = (g["home_score"], g["away_score"]) if home else (g["away_score"], g["home_score"])
                opp = g["away_team"] if home else g["home_team"]
                parts.append(f"{ours}:{theirs} מול {opp}, {r['minutes']} דק'" + (f", {r['goals']} ש'" if r["goals"] else ""))
            lines.append(f"{p['name']}: " + " | ".join(parts))
        if lines:
            self.notify("weekly_summary", "🗓️ סיכום שבועי · שחקנים שלי", "\n".join(lines),
                        f"summary:{self.today}", {"kind": "mine"}, "/")


# ---------------------------------------------------------------------------
# push delivery (Web Push / VAPID)

def ensure_vapid(db: DB) -> tuple[str, str]:
    rows = db.select("server_secrets", "key=eq.vapid_private_pem&select=value")
    if rows:
        priv = rows[0]["value"]
        pub = db.get_state("vapid_public_key")
        return priv, pub
    from py_vapid import Vapid01
    from py_vapid.utils import b64urlencode
    from cryptography.hazmat.primitives import serialization
    v = Vapid01()
    v.generate_keys()
    priv = v.private_pem().decode()
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    pub = b64urlencode(raw)
    db.upsert("server_secrets", {"key": "vapid_private_pem", "value": priv}, "key", returning=False)
    db.set_state("vapid_public_key", pub)
    return priv, pub


def send_pushes(db: DB) -> int:
    ensure_vapid(db)  # make sure the app can subscribe even before the first alert
    pending = db.select("notifications", "sent_at=is.null&order=created_at.asc&limit=50&select=*")
    if not pending:
        return 0
    subs = db.select("push_subscriptions", "select=*")
    sent = 0
    if subs:
        from pywebpush import webpush, WebPushException
        from py_vapid import Vapid01
        priv_pem, _ = ensure_vapid(db)
        priv = Vapid01.from_pem(priv_pem.encode())
        for n in pending:
            payload = json.dumps({"title": n["title"], "body": n.get("body") or "", "url": n.get("url") or "/",
                                  "tag": n.get("dedupe_key") or str(n["id"])}, ensure_ascii=False)
            for s in subs:
                try:
                    webpush({"endpoint": s["endpoint"], "keys": s["keys"]}, payload, vapid_private_key=priv,
                            vapid_claims={"sub": "https://safa-farraj-app.vercel.app"}, ttl=86400)
                    sent += 1
                except WebPushException as e:
                    code = getattr(e.response, "status_code", None)
                    body = getattr(e.response, "text", "")[:200] if e.response is not None else str(e)[:200]
                    print(f"push failed: status={code} {body}")
                    if code in (404, 410):  # subscription expired / removed on the phone
                        db.delete("push_subscriptions", f"id=eq.{s['id']}")
    ids = ",".join(str(n["id"]) for n in pending)
    db.update("notifications", f"id=in.({ids})", {"sent_at": datetime.utcnow().isoformat()})
    return sent
