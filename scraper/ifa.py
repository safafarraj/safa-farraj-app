"""Reading and parsing pages from the Israel Football Association site (football.org.il).

All requests go out through an Israeli residential proxy (env IL_PROXY), because the
site blocks data-center addresses outside Israel.
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

import requests
from bs4 import BeautifulSoup, Tag

BASE = "https://www.football.org.il"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


class IFAClient:
    def __init__(self, proxy: Optional[str] = None, delay: float = 1.0):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "he-IL,he;q=0.9"})
        proxy = proxy if proxy is not None else os.environ.get("IL_PROXY")
        if proxy:
            self.s.proxies = {"http": proxy, "https": proxy}
        self.delay = delay
        self.requests_made = 0
        self.bytes_received = 0

    def get(self, path: str, **headers) -> str:
        url = path if path.startswith("http") else BASE + path
        last = None
        for attempt in range(3):
            try:
                r = self.s.get(url, timeout=45, headers=headers or None)
                self.requests_made += 1
                self.bytes_received += len(r.content)
                if r.status_code == 200:
                    time.sleep(self.delay)
                    return r.text
                last = f"HTTP {r.status_code}"
            except requests.RequestException as e:  # network hiccup through the proxy
                last = type(e).__name__
            time.sleep(3 * (attempt + 1))
        raise RuntimeError(f"IFA fetch failed ({last}) for {path.split('?')[0]}")

    # ---- page fetchers -------------------------------------------------
    def player_page(self, player_id: int, season_id: Optional[int] = None) -> str:
        q = f"/players/player/?player_id={player_id}"
        if season_id:
            q += f"&season_id={season_id}"
        return self.get(q)

    def player_games(self, player_id: int, season_id: int) -> str:
        txt = self.get(f"/Components.asmx/GetPlayerGames?player_id={player_id}&season_id={season_id}",
                       **{"Content-Type": "application/json; charset=utf-8"})
        try:
            return json.loads(txt).get("d") or ""
        except ValueError:
            return ""

    def team_page(self, team_id: int, season_id: int) -> str:
        return self.get(f"/team-details/?season_id={season_id}&team_id={team_id}")

    def team_games(self, team_id: int, season_id: int) -> str:
        return self.get(f"/team-details/team-games?team_id={team_id}&&season_id={season_id}")

    def league_page(self, league_id: int, season_id: int) -> str:
        return self.get(f"/leagues/league/?league_id={league_id}&season_id={season_id}")

    def game_page(self, game_id: int, season_id: int) -> str:
        return self.get(f"/leagues/games/game/?season_id={season_id}&game_id={game_id}")


# ---------------------------------------------------------------------------
# helpers

def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


def _text(el: Optional[Tag], strip_sr: bool = True) -> str:
    if el is None:
        return ""
    el = BeautifulSoup(str(el), "html.parser")
    if strip_sr:
        for sr in el.select(".sr-only"):
            sr.decompose()
    return re.sub(r"\s+", " ", el.get_text(" ")).strip()


def _int(s: str) -> Optional[int]:
    m = re.search(r"-?\d+", s or "")
    return int(m.group()) if m else None


def _date(s: str) -> Optional[date]:
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    if not m:
        return None
    return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))


def _qs(href: str, key: str) -> Optional[int]:
    m = re.search(rf"[?&]{key}=(-?\d+)", href or "")
    return int(m.group(1)) if m else None


def split_team_league(title: str) -> tuple[str, str]:
    """'בני סכנין (נערים ב' לאומית צפון)' -> ('בני סכנין', "נערים ב' לאומית צפון")."""
    title = title.strip()
    m = re.match(r"^(.*)\((.*)\)\s*$", title)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return title, ""


# ---------------------------------------------------------------------------
# player page

@dataclass
class PlayerProfile:
    name: str = ""
    photo_url: str = ""
    birth_month_year: str = ""
    citizenship: str = ""
    team_name: str = ""
    league_name: str = ""
    seasons: list[tuple[int, str]] = field(default_factory=list)  # (season_id, label)
    goals_total: Optional[int] = None


def parse_player_page(html: str) -> PlayerProfile:
    soup = _soup(html)
    p = PlayerProfile()
    p.name = _text(soup.select_one(".new-player-card_title"))
    img = soup.select_one(".new-player-card_img-container img")
    if img and img.get("src"):
        src = img["src"]
        p.photo_url = src if src.startswith("http") else BASE + "/" + src.lstrip("/")
    for li in soup.select(".new-player-card_data-list li"):
        t = _text(li)
        if "תאריך לידה" in t:
            p.birth_month_year = t.split(":", 1)[-1].strip()
        elif "אזרחות" in t:
            p.citizenship = t.split(":", 1)[-1].strip()
    title = soup.select_one(".new-player-data_title span")
    if title:
        p.team_name, p.league_name = split_team_league(_text(title))
    sel = soup.select_one("select[data-param=season_id]")
    if sel:
        for o in sel.select("option"):
            if o.get("value", "").isdigit():
                p.seasons.append((int(o["value"]), _text(o)))
    for row in soup.select(".pl-team-goals .table_row"):
        cols = row.select(".table_col")
        if len(cols) >= 2 and _text(cols[0]) == "הכל":
            p.goals_total = _int(_text(cols[1]))
    return p


# ---------------------------------------------------------------------------
# player's games (ajax list – the games the player took part in, incl. cups)

@dataclass
class PlayerGameRow:
    game_id: int
    season_id: int
    game_date: Optional[date]
    competition_name: str
    is_cup: bool


def parse_player_games(fragment: str) -> list[PlayerGameRow]:
    rows = []
    for a in _soup(fragment).select("a.table_row"):
        href = a.get("href", "")
        gid = _qs(href, "game_id")
        if not gid or gid < 0:
            continue
        cols = a.select(".table_col")
        comp = _text(cols[1]) if len(cols) > 1 else ""
        rows.append(PlayerGameRow(gid, _qs(href, "season_id") or 0,
                                  _date(_text(cols[0]) if cols else ""), comp, "גביע" in comp))
    return rows


# ---------------------------------------------------------------------------
# team schedule

@dataclass
class ScheduleRow:
    game_id: Optional[int]
    game_date: Optional[date]
    home_team: str
    away_team: str
    venue: str
    kickoff: Optional[str]  # "HH:MM" or None when not set yet
    is_bye: bool


def parse_team_games(html: str) -> list[ScheduleRow]:
    out = []
    for row in _soup(html).select(".table_row"):
        cols = row.select(".table_col")
        if len(cols) < 4:
            continue
        link = row if row.name == "a" else row.select_one("a[href]")
        href = link.get("href", "") if link else ""
        gid = _qs(href, "game_id")
        d = _date(_text(cols[0]))
        teams = [_text(t).rstrip(" -").strip() for t in cols[1].select(".team-name-text")]
        if len(teams) != 2:
            parts = [x.strip() for x in _text(cols[1]).split(" - ", 1)]
            teams = parts if len(parts) == 2 else [parts[0], ""]
        venue = _text(cols[2])
        t = _text(cols[3])
        kickoff = t if re.fullmatch(r"\d{2}:\d{2}", t or "") and t != "00:00" else None
        bye = "חופשית" in (teams[0] + teams[1])
        out.append(ScheduleRow(gid if gid and gid > 0 else None, d, teams[0], teams[1], venue, kickoff, bye))
    return out


# ---------------------------------------------------------------------------
# team page: standings

def parse_standings(html: str) -> list[dict]:
    table = []
    for row in _soup(html).select(".table_row"):
        cols = row.select(".table_col")
        if len(cols) < 8:
            continue
        labels = [_text(c.select_one(".sr-only"), strip_sr=False) if c.select_one(".sr-only") else "" for c in cols]
        if not labels or labels[0] != "מקום":
            continue
        vals = [_text(c) for c in cols]
        link = row if row.name == "a" else (row.find_parent("a") or row.select_one("a[href]"))
        team_href = link.get("href", "") if link else ""
        # goals are shown "against-for"; store for:against
        g = vals[6]
        m = re.match(r"(\d+)-(\d+)", g)
        goals = f"{m.group(2)}:{m.group(1)}" if m else g
        table.append({
            "pos": _int(vals[0]), "team": vals[1], "played": _int(vals[2]), "won": _int(vals[3]),
            "drawn": _int(vals[4]), "lost": _int(vals[5]), "goals": goals, "points": _int(vals[7]),
            "team_id": _qs(team_href, "team_id"),
        })
    return table


def parse_game_length(html: str) -> Optional[int]:
    """League page 'אודות הליגה' shows e.g. '40 x 2 משך משחק'."""
    txt = _text(_soup(html).body)
    m = re.search(r"(\d+)\s*x\s*(\d+)\s*משך משחק", txt)
    return int(m.group(1)) * int(m.group(2)) if m else None


# ---------------------------------------------------------------------------
# game page

@dataclass
class GamePlayer:
    ifa_player_id: int
    side: str           # 'home' / 'guest'
    status: str         # 'starter' / 'sub_in' / 'bench'
    shirt: str
    name: str
    captain: bool
    events: list[tuple[str, Optional[int]]] = field(default_factory=list)  # (type, minute)


@dataclass
class GameDetails:
    game_id: int
    competition_title: str = ""
    game_date: Optional[date] = None
    kickoff: Optional[str] = None
    venue: str = ""
    home_team: str = ""
    away_team: str = ""
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    home_coach: str = ""
    away_coach: str = ""
    players: list[GamePlayer] = field(default_factory=list)

    @property
    def has_lineups(self) -> bool:
        return any(p.status == "starter" for p in self.players)


_GROUP_STATUS = {"Active": "starter", "Replacement": "sub_in", "Bench": "bench"}
_MOVE_CLASS = {"change-up": "sub_in", "change-down": "sub_out", "yellow": "yellow",
               "yellow2": "second_yellow", "red": "red", "red-card": "red"}


def _parse_moves(moves: Optional[Tag]) -> list[tuple[str, Optional[int]]]:
    if moves is None:
        return []
    events = []
    pending_goal = None
    for node in moves.children:
        if isinstance(node, Tag):
            classes = node.get("class") or []
            if node.name == "img":
                pending_goal = "goal"
                continue
            if "sr-only" in classes and pending_goal:
                label = node.get_text(strip=True)
                if "פנדל" in label:
                    pending_goal = "penalty_goal"
                elif "עצמי" in label:
                    pending_goal = "own_goal"
                continue
            kind = next((_MOVE_CLASS[c] for c in classes if c in _MOVE_CLASS), None)
            if kind:
                events.append((kind, _int(_text(node))))
        else:
            txt = str(node).strip()
            if pending_goal and re.search(r"\d", txt):
                events.append((pending_goal, _int(txt)))
                pending_goal = None
    return events


def parse_game_page(html: str, game_id: int) -> GameDetails:
    soup = _soup(html)
    g = GameDetails(game_id=game_id)
    g.competition_title = _text(soup.select_one("section.game-details .title h1"))
    home = soup.select_one(".teams-names .team-home a")
    guest = soup.select_one(".teams-names .team-guest a")
    g.home_team, g.away_team = _text(home), _text(guest)
    g.home_team_id = _qs(home.get("href", "") if home else "", "team_id")
    g.away_team_id = _qs(guest.get("href", "") if guest else "", "team_id")
    dt = _text(soup.select_one(".game-time .date"))
    g.game_date = _date(dt)
    m = re.search(r"(\d{2}:\d{2})", dt)
    if m and m.group(1) != "00:00":
        g.kickoff = m.group(1)
    total = _text(soup.select_one(".game-time .total"))
    m = re.search(r"(\d+)\s*:\s*(\d+)", total)
    if m:
        g.home_score, g.away_score = int(m.group(1)), int(m.group(2))
    g.venue = _text(soup.select_one(".game-time .place"))

    for grp in soup.select("div[role=group]"):
        classes = grp.get("class") or []
        side = "home" if "home" in classes else "guest" if "guest" in classes else None
        if not side:
            continue
        heading = _text(grp.select_one("h2"), strip_sr=False)
        if "מאמן" in heading:
            coach = _text(grp.select_one(".name"))
            if side == "home":
                g.home_coach = coach
            else:
                g.away_coach = coach
            continue
        status = next((_GROUP_STATUS[c] for c in classes if c in _GROUP_STATUS), None)
        if not status:
            continue
        for a in grp.select("a[href*=player_id]"):
            pid = _qs(a.get("href", ""), "player_id")
            if not pid:
                continue
            name_el = a.select_one(".name")
            g.players.append(GamePlayer(
                ifa_player_id=pid, side=side, status=status,
                shirt=_text(a.select_one(".number")).replace("מס'", "").strip(),
                name=_text(name_el.select_one("b") if name_el else None),
                captain="(C)" in _text(name_el),
                events=_parse_moves(a.select_one(".moves")),
            ))
    return g


def minutes_played(gp: GamePlayer, length: int) -> tuple[int, Optional[int], Optional[int]]:
    """Return (minutes, minute_in, minute_out) for a player in a game of `length` minutes."""
    ev = dict()
    for k, m in gp.events:
        ev.setdefault(k, m)
    if gp.status == "bench":
        return 0, None, None
    start = 0 if gp.status == "starter" else (ev.get("sub_in") or 0)
    end_candidates = [m for k, m in gp.events if k in ("sub_out", "red", "second_yellow") and m is not None]
    end = min(end_candidates) if end_candidates else length
    start, end = min(start, length), min(end, length)
    return max(0, end - start), (ev.get("sub_in") if gp.status == "sub_in" else None), (min(end_candidates) if end_candidates else None)


def is_cup(title: str) -> bool:
    return "גביע" in (title or "")


def now_il() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("Asia/Jerusalem"))
