"""Find the league level (על / לאומית / ארצית / אזורית) of a contact's club + age group from the IFA site.

The IFA menu (on every page) lists each age group's leagues. For the age group we read the
games page of each על / לאומית / ארצית league and look for the club in its team list.
Not found in any of them -> the club plays in a regional league (אזורית).
Only contacts whose club / age group changed are checked, so this costs traffic only after an edit.
"""
from __future__ import annotations

import html as H
import re
from typing import Optional

LEVELS = ("על", "לאומית", "ארצית")  # top first


def norm_age(s: str) -> Optional[str]:
    s = (s or "").replace("׳", "'").replace("״", '"').replace("’", "'").strip()
    s = re.sub(r"\s+", " ", s)
    if not s:
        return None
    if "בוגר" in s:
        return "בוגרים"
    if "נוער" in s:
        return "נוער"
    m = re.search(r"(טרום\s*)?(ילד|נער)\S*\s*([אבג])", s)
    if m:
        base = "נערים" if m.group(2) == "נער" else "ילדים"
        return ("טרום " if m.group(1) else "") + f"{base} {m.group(3)}'"
    return s


def norm_club(s: str) -> str:
    s = H.unescape(s or "")
    s = s.replace("״", '"').replace("׳", "'").replace("”", '"')
    s = re.sub(r'"?צו פיוס"?', " ", s)
    s = re.sub(r"\bהפ'\s*", "הפועל ", s)
    s = re.sub(r"\bמכ'\s*", "מכבי ", s)
    s = re.sub(r"\bמ\.ס\.\s*|\bמ\.כ\.\s*|\bמ\.כדורגל\s*|\bמועדון ספורט\s*|\bמועדון כדורגל\s*|\bעירוני\s*|\bF\.C\.?\s*|\bFC\s*", " ", s)
    s = re.sub(r'["\'.\-–]', " ", s)
    return re.sub(r"\s+", " ", s).strip()


def club_matches(contact_club: str, team_name: str) -> bool:
    a, b = norm_club(contact_club), norm_club(team_name)
    if not a or not b:
        return False
    if a == b or b.startswith(a + " ") or a.startswith(b + " "):
        return True
    # "סכנין" vs "בני סכנין": every word of the shorter name appears in the longer one
    wa, wb = set(a.split()), set(b.split())
    small, big = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    return len(small) >= 1 and small <= big and any(len(w) >= 3 for w in small)


def menu_leagues(page_html: str, season_id: int) -> dict[str, dict[str, list[tuple[int, str]]]]:
    """{age group: {level: [(league_id, name)]}} from the site menu."""
    out: dict[str, dict[str, list[tuple[int, str]]]] = {}
    for lid, txt in re.findall(rf'href="/leagues/league/\?league_id=(\d+)&(?:amp;)?season_id={season_id}"[^>]*>\s*(?:<span>)?([^<]+)<', page_html):
        name = re.sub(r"\s+", " ", H.unescape(txt)).strip()
        if "נשים" in name or "נערות" in name or "ילדות" in name or "ותיקים" in name or "אולמות" in name or "פיתוח" in name:
            continue
        if "WINNER" in name or name == "ליגה לאומית":
            age = "בוגרים"
            level = "על" if "WINNER" in name else "לאומית"
        else:
            age = norm_age(name)
            if not age or age == "בוגרים":
                continue
            level = next((lv for lv in LEVELS if re.search(rf"(^|\s|ה){lv}(\s|$)", name)), None)
            if not level:
                continue
        out.setdefault(age, {}).setdefault(level, []).append((int(lid), name))
    return out


def league_teams(games_html: str) -> list[str]:
    m = re.search(r'id="[^"]*ddlTeams"[^>]*>(.*?)</select>', games_html, re.S)
    if not m:
        return []
    return [H.unescape(t).strip() for v, t in re.findall(r'<option[^>]*value="(\d+)"[^>]*>([^<]*)</option>', m.group(1))]


class ContactLeagues:
    def __init__(self, db, client, season_id: int, log):
        self.db, self.client, self.sid, self.log = db, client, season_id, log
        self._menu = None
        self._teams: dict[int, list[str]] = {}

    def menu(self):
        if self._menu is None:
            self._menu = menu_leagues(self.client.get(f"/leagues/league/?league_id=40&season_id={self.sid}"), self.sid)
        return self._menu

    def teams(self, lid: int) -> list[str]:
        if lid not in self._teams:
            self._teams[lid] = league_teams(self.client.get(f"/leagues/games/?league_id={lid}&season_id={self.sid}"))
        return self._teams[lid]

    def lookup(self, club: str, age_raw: str) -> tuple[Optional[str], Optional[str]]:
        age = norm_age(age_raw)
        if not age:
            return None, None
        tiers = self.menu().get(age)
        if not tiers:  # children: regional leagues only
            return ("אזורית", None) if age.startswith(("ילדים", "טרום")) else (None, None)
        for level in LEVELS:
            for lid, name in tiers.get(level, []):
                if any(club_matches(club, t) for t in self.teams(lid)):
                    return level, name
        return "אזורית", None

    def run(self) -> None:
        rows = self.db.select("network_contacts", "select=id,club,age_group,league_level,league_auto,league_key")
        for c in rows:
            if c.get("league_auto") is False or not c.get("club") or not c.get("age_group"):
                continue
            key = f"{self.sid}|{norm_club(c['club'])}|{norm_age(c['age_group'])}"
            if c.get("league_key") == key:
                continue
            try:
                level, name = self.lookup(c["club"], c["age_group"])
            except Exception as e:  # network trouble: try again next run
                self.log(f"contact league {c['id']}: {e}")
                continue
            self.db.update("network_contacts", f"id=eq.{c['id']}",
                           {"league_level": level, "league_name": name, "league_key": key})
            self.log(f"contact {c['id']}: {c['club']} {c['age_group']} -> {level} ({name})")
