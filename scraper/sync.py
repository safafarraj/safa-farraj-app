"""Synchronise players, schedules, games and line-ups from the IFA site into Supabase,
and create notifications for anything new.

Usage:  python -m scraper.sync [--full]

Logs deliberately avoid names and personal details (counts only).
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta
from typing import Optional

from . import ifa
from .db import DB

SEASON_ID = 28
SEASON_LABEL = "2026/2027"


def log(msg: str) -> None:
    print(f"[{datetime.utcnow():%H:%M:%S}] {msg}", flush=True)


class Sync:
    def __init__(self, full: bool):
        self.full = full
        self.client = ifa.IFAClient()
        self.db = DB()
        self.today = ifa.now_il().date()
        self.now = ifa.now_il()
        self.initialized = bool(self.db.get_state("initialized", False))
        self.players = self.db.select("players", "active=eq.true&select=*")
        self.leagues = {l["ifa_league_id"]: l for l in self.db.select("leagues", f"season_id=eq.{SEASON_ID}&select=*")}
        self.teams = {t["ifa_team_id"]: t for t in self.db.select("teams", f"season_id=eq.{SEASON_ID}&select=*")}
        self.new_notifications = 0

    # ------------------------------------------------------------------
    def notify(self, kind: str, title: str, body: str, dedupe: str, player: Optional[dict] = None,
               url: str = "/", payload: Optional[dict] = None) -> None:
        if not self.initialized:
            return  # first run = back-fill, no alerts for old events
        row = {"kind": kind, "title": title, "body": body, "dedupe_key": dedupe, "url": url,
               "audience": (player or {}).get("kind", "mine"), "player_id": (player or {}).get("id"),
               "payload": payload or {}}
        if self.db.insert_ignore("notifications", row, "dedupe_key"):
            self.new_notifications += 1

    def game_length(self, league_id: Optional[int]) -> int:
        lg = self.leagues.get(league_id or -1)
        return (lg or {}).get("game_length_min") or 90

    # ------------------------------------------------------------------
    def sync_profiles(self) -> None:
        for p in self.players:
            prof = ifa.parse_player_page(self.client.player_page(p["ifa_player_id"], SEASON_ID))
            upd = {"name": prof.name or p["name"], "photo_url": prof.photo_url or p.get("photo_url"),
                   "birth_month_year": prof.birth_month_year, "citizenship": prof.citizenship,
                   "current_season_id": SEASON_ID, "updated_at": datetime.utcnow().isoformat()}
            if prof.team_name:
                if p.get("team_name") and prof.team_name != p["team_name"]:
                    self.notify("team_change", f"🔁 החלפת קבוצה · {upd['name']}",
                                f"רשום עכשיו ב{prof.team_name} ({prof.league_name}). קודם: {p['team_name']}",
                                f"team:{p['id']}:{prof.team_name}", p, f"/player/{p['id']}")
                upd["team_name"], upd["league_name"] = prof.team_name, prof.league_name
            self.db.update("players", f"id=eq.{p['id']}", upd)
            p.update(upd)

            # season history (only fetch seasons we don't have yet; current season always refreshed)
            have = {r["season_id"] for r in self.db.select("player_seasons", f"player_id=eq.{p['id']}&select=season_id")}
            rows = [{"player_id": p["id"], "season_id": SEASON_ID, "season_label": SEASON_LABEL,
                     "team_name": prof.team_name, "league_name": prof.league_name, "goals": prof.goals_total}]
            for sid, label in prof.seasons[:6]:
                if sid == SEASON_ID or sid in have:
                    continue
                old = ifa.parse_player_page(self.client.player_page(p["ifa_player_id"], sid))
                rows.append({"player_id": p["id"], "season_id": sid, "season_label": label,
                             "team_name": old.team_name, "league_name": old.league_name, "goals": old.goals_total})
            self.db.upsert("player_seasons", rows, "player_id,season_id", returning=False)
        log(f"profiles synced: {len(self.players)}")

    # ------------------------------------------------------------------
    def sync_team(self, team_id: int, league_id: Optional[int]) -> list[ifa.ScheduleRow]:
        sched = ifa.parse_team_games(self.client.team_games(team_id, SEASON_ID))
        standings = ifa.parse_standings(self.client.team_page(team_id, SEASON_ID))
        if league_id:
            vals = {"standings": standings, "updated_at": datetime.utcnow().isoformat()}
            lg = self.leagues.get(league_id)
            if lg and (self.full or not lg.get("game_length_min")):
                length = ifa.parse_game_length(self.client.league_page(league_id, SEASON_ID))
                if length:
                    vals["game_length_min"] = length
                    lg["game_length_min"] = length
            self.db.update("leagues", f"ifa_league_id=eq.{league_id}&season_id=eq.{SEASON_ID}", vals)

        # replace not-yet-numbered future fixtures, then upsert everything
        self.db.delete("games", f"ifa_team_id=eq.{team_id}&ifa_game_id=is.null&status=eq.scheduled")
        with_id, without_id = [], []
        for r in sched:
            if r.is_bye or not r.game_date:
                continue
            row = {"season_id": SEASON_ID, "ifa_team_id": team_id, "competition": "league",
                   "game_date": r.game_date.isoformat(), "kickoff_time": r.kickoff, "venue": r.venue or None,
                   "home_team": r.home_team, "away_team": r.away_team}
            if r.game_id:
                row["ifa_game_id"] = r.game_id
                with_id.append(row)
            else:
                without_id.append(row)
        self.db.upsert("games", with_id, "ifa_game_id", returning=False)
        self.db.upsert("games", without_id, "ifa_team_id,game_date,home_team,away_team", returning=False)
        log(f"team schedule: {len(sched)} rows, standings: {len(standings)} teams")
        return sched

    # ------------------------------------------------------------------
    def game_ids_to_fetch(self) -> dict[int, dict]:
        """Map ifa_game_id -> context for games whose details we need."""
        team_ids = {p["ifa_team_id"] for p in self.players if p.get("ifa_team_id")}
        known = {g["ifa_game_id"]: g for g in self.db.select(
            "games", f"season_id=eq.{SEASON_ID}&ifa_game_id=not.is.null&select=id,ifa_game_id,ifa_team_id,game_date,status,details_complete,competition")}
        wanted: dict[int, dict] = {}
        recent = self.today - timedelta(days=2)
        for gid, g in known.items():
            gd = date.fromisoformat(g["game_date"])
            if g["ifa_team_id"] in team_ids and gd <= self.today and (not g["details_complete"] or gd >= recent):
                wanted[gid] = {"team_id": g["ifa_team_id"], "competition": g["competition"]}
        # cup / other games the players took part in (not in the league schedule)
        for p in self.players:
            if not self.full and self.initialized:
                break  # the player game list only needs a refresh on full runs
            for row in ifa.parse_player_games(self.client.player_games(p["ifa_player_id"], SEASON_ID)):
                g = known.get(row.game_id)
                if g is None or not g["details_complete"] or (row.game_date and row.game_date >= recent):
                    wanted.setdefault(row.game_id, {"team_id": p.get("ifa_team_id"),
                                                    "competition": "cup" if row.is_cup else "league",
                                                    "competition_name": row.competition_name})
        return wanted

    def sync_games(self) -> None:
        wanted = self.game_ids_to_fetch()
        for gid, ctx in wanted.items():
            self.sync_game(gid, ctx)
        log(f"games refreshed: {len(wanted)}")

    def sync_game(self, gid: int, ctx: dict) -> None:
        g = ifa.parse_game_page(self.client.game_page(gid, SEASON_ID), gid)
        if not g.game_date:
            return
        team_id = ctx.get("team_id")
        our_side = "home" if g.home_team_id == team_id else "guest" if g.away_team_id == team_id else None
        played_out = g.home_score is not None and (
            g.game_date < self.today or
            (g.game_date == self.today and g.kickoff and
             self.now >= datetime.combine(self.today, datetime.strptime(g.kickoff, "%H:%M").time(), self.now.tzinfo) + timedelta(hours=2)))
        status = "final" if played_out else ("live" if g.home_score is not None else "scheduled")
        complete = bool(played_out and g.has_lineups)
        competition = "cup" if ifa.is_cup(g.competition_title) else ctx.get("competition", "league")
        row = {"ifa_game_id": gid, "season_id": SEASON_ID, "ifa_team_id": team_id, "competition": competition,
               "competition_name": g.competition_title, "game_date": g.game_date.isoformat(),
               "kickoff_time": g.kickoff, "venue": g.venue or None, "home_team": g.home_team, "away_team": g.away_team,
               "home_score": g.home_score, "away_score": g.away_score, "status": status, "details_complete": complete,
               "home_coach": g.home_coach or None, "away_coach": g.away_coach or None,
               "updated_at": datetime.utcnow().isoformat()}
        saved = self.db.upsert("games", row, "ifa_game_id")
        game_row_id = saved[0]["id"]

        if our_side:
            self.check_coach(team_id, g.home_coach if our_side == "home" else g.away_coach, g, status)

        if not g.has_lineups:
            return
        by_ifa = {gp.ifa_player_id: gp for gp in g.players}
        for p in self.players:
            if p.get("ifa_team_id") != team_id:
                continue
            gp = by_ifa.get(p["ifa_player_id"])
            length = self.game_length(p.get("ifa_league_id"))
            if gp is None:
                status_p, mins, m_in, m_out, shirt, cap, events = "not_in_squad", 0, None, None, None, False, []
            else:
                mins, m_in, m_out = ifa.minutes_played(gp, length)
                status_p = gp.status
                if gp.status == "sub_in" and m_in is None:
                    status_p, mins = "bench", 0  # listed as a substitute but never came on
                shirt, cap, events = gp.shirt, gp.captain, gp.events
            goals = sum(1 for k, _ in events if k in ("goal", "penalty_goal"))
            gprow = {"game_id": game_row_id, "player_id": p["id"], "status": status_p, "shirt_number": shirt,
                     "is_captain": cap, "minute_in": m_in, "minute_out": m_out, "minutes": mins, "goals": goals,
                     "yellow_cards": sum(1 for k, _ in events if k == "yellow"),
                     "red_cards": sum(1 for k, _ in events if k in ("red", "second_yellow")),
                     "updated_at": datetime.utcnow().isoformat()}
            self.db.upsert("game_players", gprow, "game_id,player_id", returning=False)
            if shirt and shirt != p.get("shirt_number"):
                self.db.update("players", f"id=eq.{p['id']}", {"shirt_number": shirt})

            fresh = g.game_date >= self.today - timedelta(days=1)
            ev_rows = [{"game_id": game_row_id, "player_id": p["id"], "minute": m, "event_type": k}
                       for k, m in events]
            inserted = self.db.insert_ignore("game_events", ev_rows, "game_id,player_id,event_type,minute")
            opp = g.away_team if g.home_team_id == team_id else g.home_team
            if fresh:
                for e in inserted:
                    self.event_notification(p, e, opp, gid)
                if status != "final":
                    self.lineup_notification(p, status_p, opp, g, gid)
            if complete and fresh:
                self.report_notification(p, g, team_id, status_p, mins, goals, gprow, gid)

    # ------------------------------------------------------------------
    EVENT_TITLES = {"goal": "⚽ שער!", "penalty_goal": "⚽ שער מפנדל!", "own_goal": "שער עצמי",
                    "yellow": "🟨 כרטיס צהוב", "second_yellow": "🟥 צהוב שני", "red": "🟥 כרטיס אדום",
                    "sub_in": "🔄 נכנס כמחליף", "sub_out": "🔄 הוחלף"}

    def event_notification(self, p: dict, e: dict, opp: str, gid: int) -> None:
        t = e["event_type"]
        minute = f"דקה {e['minute']}" if e.get("minute") is not None else ""
        self.notify("event", f"{self.EVENT_TITLES.get(t, t)} · {p['name']}", f"{minute} · נגד {opp}".strip(" ·"),
                    f"event:{gid}:{p['id']}:{t}:{e.get('minute')}", p, f"/player/{p['id']}/games")

    def lineup_notification(self, p: dict, status_p: str, opp: str, g: ifa.GameDetails, gid: int) -> None:
        txt = {"starter": "בהרכב הפותח ✅", "sub_in": "על הספסל", "bench": "על הספסל",
               "not_in_squad": "לא בסגל ❌"}[status_p]
        when = f"{g.kickoff} · " if g.kickoff else ""
        self.notify("lineup", f"📋 הרכב פורסם · {p['name']}", f"{txt} · נגד {opp} · {when}{g.venue}".strip(" ·"),
                    f"lineup:{gid}:{p['id']}", p, f"/player/{p['id']}/games")

    def report_notification(self, p, g: ifa.GameDetails, team_id, status_p, mins, goals, gprow, gid) -> None:
        home = g.home_team_id == team_id
        ours, theirs = (g.home_score, g.away_score) if home else (g.away_score, g.home_score)
        res = "ניצחון" if ours > theirs else "הפסד" if ours < theirs else "תיקו"
        opp = g.away_team if home else g.home_team
        role = {"starter": "פתח בהרכב", "sub_in": f"נכנס בדקה {gprow['minute_in']}", "bench": "לא שותף (ספסל)",
                "not_in_squad": "לא היה בסגל"}[status_p]
        extra = f" · {goals} שערים" if goals > 1 else (" · שער" if goals == 1 else "")
        cards = (" · 🟨" if gprow["yellow_cards"] else "") + (" · 🟥" if gprow["red_cards"] else "")
        self.notify("report", f"📊 דוח משחק · {p['name']} · {res} {ours}:{theirs}",
                    f"{p.get('league_name') or ''} · נגד {opp} ({'בית' if home else 'חוץ'}, {g.venue}) · {role} · {mins} דק'{extra}{cards}",
                    f"report:{gid}:{p['id']}", p, f"/player/{p['id']}/games",
                    {"result": res, "ours": ours, "theirs": theirs})

    def check_coach(self, team_id: int, coach: str, g: ifa.GameDetails, status: str) -> None:
        if not coach or status == "scheduled":
            return
        t = self.teams.get(team_id)
        if not t:
            return
        last_date = t.get("_coach_date")
        if last_date and g.game_date <= last_date:
            return
        if t.get("coach_name") and t["coach_name"] != coach and g.game_date >= self.today - timedelta(days=7):
            for p in self.players:
                if p.get("ifa_team_id") == team_id:
                    self.notify("coach_change", f"👔 החלפת מאמן · {t['name']}",
                                f"{coach} במקום {t['coach_name']} (משחק {g.game_date:%d/%m})",
                                f"coach:{team_id}:{coach}", p, f"/player/{p['id']}")
                    break
        t["coach_name"], t["_coach_date"] = coach, g.game_date
        self.db.update("teams", f"ifa_team_id=eq.{team_id}&season_id=eq.{SEASON_ID}", {"coach_name": coach})
        for p in self.players:
            if p.get("ifa_team_id") == team_id and p.get("coach_name") != coach:
                self.db.update("players", f"id=eq.{p['id']}", {"coach_name": coach})
                p["coach_name"] = coach

    # ------------------------------------------------------------------
    def run(self) -> None:
        if self.full or not self.initialized:
            self.sync_profiles()
        teams = {(p["ifa_team_id"], p.get("ifa_league_id")) for p in self.players if p.get("ifa_team_id")}
        for team_id, league_id in teams:
            self.sync_team(team_id, league_id)
        # process games in date order so coach-change detection sees them chronologically
        self.sync_games()
        if not self.initialized:
            self.db.set_state("initialized", True)
            log("first run: back-fill done, alerts enabled from now on")
        self.db.set_state("last_sync", {"at": datetime.utcnow().isoformat(), "full": self.full,
                                        "requests": self.client.requests_made,
                                        "kb": round(self.client.bytes_received / 1024)})
        log(f"done · requests={self.client.requests_made} · traffic={self.client.bytes_received / 1024:.0f}KB"
            f" · new notifications={self.new_notifications}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    args = ap.parse_args(argv)
    Sync(full=args.full).run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
