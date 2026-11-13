"""Back-fill past seasons for every active player: team, league, standings, game length,
full team schedule with results, line-ups, minutes, goals and cards. No notifications.

Usage:  python -m scraper.backfill [--force]
"""
from __future__ import annotations

import argparse
import re
from collections import Counter
from datetime import datetime

from . import ifa
from .db import DB
from .sync import SEASON_ID, log


class Backfill:
    def __init__(self, force: bool):
        self.force = force
        self.client = ifa.IFAClient()
        self.db = DB()
        self.today = ifa.now_il().date()
        self.players = self.db.select("players", "active=eq.true&select=*")
        self.game_cache: dict[tuple[int, int], ifa.GameDetails] = {}

    def game(self, gid: int, sid: int) -> ifa.GameDetails:
        key = (gid, sid)
        if key not in self.game_cache:
            self.game_cache[key] = ifa.parse_game_page(self.client.game_page(gid, sid), gid)
        return self.game_cache[key]

    def run(self) -> None:
        for p in self.players:
            prof = ifa.parse_player_page(self.client.player_page(p["ifa_player_id"], SEASON_ID))
            have = {r["season_id"]: r for r in self.db.select("player_seasons", f"player_id=eq.{p['id']}&select=*")}
            # current season: refresh cards/goals only (sync handles the rest)
            self.db.upsert("player_seasons", {"player_id": p["id"], "season_id": SEASON_ID,
                                              "goals": prof.goals_total, "yellow_cards": prof.yellow_cards,
                                              "red_cards": prof.red_cards}, "player_id,season_id", returning=False)
            for sid, label in prof.seasons:
                if sid == SEASON_ID:
                    continue
                if have.get(sid, {}).get("backfilled_at") and not self.force:
                    continue
                try:
                    self.season(p, sid, label)
                except Exception as e:  # keep going with the other seasons
                    log(f"season {sid} failed: {type(e).__name__}: {str(e)[:200]}")
        log(f"done · requests={self.client.requests_made} · {self.client.bytes_received/1e6:.1f}MB")

    @staticmethod
    def league_id(sid: int, *htmls: str):
        """The team page links 'לכל משחקי הליגה' -> /leagues/games/?league_id=X (the menu links are not reliable)."""
        for html in htmls:
            m = re.search(r"/leagues/games/\?league_id=(\d+)&(?:amp;)?season_id=" + str(sid) + r"\b", html)
            if m:
                return int(m.group(1))
        return None

    def season(self, p: dict, sid: int, label: str) -> None:
        self._player_html = self.client.player_page(p["ifa_player_id"], sid)
        prof = ifa.parse_player_page(self._player_html)
        rows = ifa.parse_player_games(self.client.player_games(p["ifa_player_id"], sid))
        played_ids = {r.game_id: r for r in rows}

        # which team did he play for? -> side he is listed on in his games
        team_votes: Counter = Counter()
        for r in rows[:6]:
            g = self.game(r.game_id, sid)
            for gp in g.players:
                if gp.ifa_player_id == p["ifa_player_id"]:
                    team_votes[g.home_team_id if gp.side == "home" else g.away_team_id] += 1
            if not team_votes and prof.team_name:
                if prof.team_name in (g.home_team or ""):
                    team_votes[g.home_team_id] += 1
                elif prof.team_name in (g.away_team or ""):
                    team_votes[g.away_team_id] += 1
        team_id = team_votes.most_common(1)[0][0] if team_votes else None

        league_id = length = None
        standings: list = []
        if team_id:
            team_html = self.client.team_page(team_id, sid)
            standings = ifa.parse_standings(team_html)
            league_id = self.league_id(sid, team_html)
            if league_id:
                length = ifa.parse_game_length(self.client.league_page(league_id, sid))
                self.db.upsert("leagues", {"ifa_league_id": league_id, "season_id": sid, "name": prof.league_name,
                                           "game_length_min": length, "standings": standings,
                                           "updated_at": datetime.utcnow().isoformat()},
                               "ifa_league_id,season_id", returning=False)
            self.db.upsert("teams", {"ifa_team_id": team_id, "season_id": sid, "name": prof.team_name,
                                     "ifa_league_id": league_id}, "ifa_team_id,season_id", returning=False)
        length = length or 80

        # whole team schedule (league) + his cup / other games
        wanted: dict[int, str] = {}
        if team_id:
            for r in ifa.parse_team_games(self.client.team_games(team_id, sid)):
                if r.game_id and not r.is_bye:
                    wanted[r.game_id] = "league"
        for gid, r in played_ids.items():
            wanted.setdefault(gid, "cup" if r.is_cup else "league")

        n_games = n_lineups = 0
        for gid, comp in wanted.items():
            g = self.game(gid, sid)
            if not g.game_date:
                continue
            played_out = g.game_date < self.today
            final = g.home_score is not None or (played_out and g.has_lineups)
            has_moves = any(k in ("sub_in", "sub_out") for x in g.players for k, _ in x.events)
            no_minutes = g.home_score is None and not has_moves  # children leagues: no result, no subs → no minutes
            competition = "cup" if ifa.is_cup(g.competition_title) else comp
            saved = self.db.upsert("games", {
                "ifa_game_id": gid, "season_id": sid, "ifa_team_id": team_id, "competition": competition,
                "competition_name": g.competition_title, "game_date": g.game_date.isoformat(),
                "kickoff_time": g.kickoff, "venue": g.venue or None, "home_team": g.home_team,
                "away_team": g.away_team, "home_score": g.home_score, "away_score": g.away_score,
                "status": "final" if final else "scheduled", "details_complete": bool(final and g.has_lineups),
                "home_coach": g.home_coach or None, "away_coach": g.away_coach or None,
                "updated_at": datetime.utcnow().isoformat()}, "ifa_game_id")
            n_games += 1
            if not g.has_lineups:
                continue
            n_lineups += 1
            gp = next((x for x in g.players if x.ifa_player_id == p["ifa_player_id"]), None)
            if gp is None:
                st, mins, m_in, m_out, shirt, cap, events = "not_in_squad", 0, None, None, None, False, []
            else:
                mins, m_in, m_out = ifa.minutes_played(gp, length)
                st = gp.status
                if gp.status == "sub_in" and m_in is None:
                    st, mins = "bench", 0
                if no_minutes and st in ("starter", "sub_in"):
                    st, mins, m_in, m_out = "played", 0, None, None  # took part, minutes not published
                shirt, cap, events = gp.shirt, gp.captain, gp.events
            game_row_id = saved[0]["id"]
            self.db.upsert("game_players", {
                "game_id": game_row_id, "player_id": p["id"], "status": st, "shirt_number": shirt,
                "is_captain": cap, "minute_in": m_in, "minute_out": m_out, "minutes": mins,
                "goals": sum(1 for k, _ in events if k in ("goal", "penalty_goal")),
                "yellow_cards": sum(1 for k, _ in events if k == "yellow"),
                "red_cards": sum(1 for k, _ in events if k in ("red", "second_yellow")),
                "updated_at": datetime.utcnow().isoformat()}, "game_id,player_id", returning=False)
            self.db.insert_ignore("game_events", [{"game_id": game_row_id, "player_id": p["id"], "minute": m,
                                                   "event_type": k} for k, m in events],
                                  "game_id,player_id,event_type,minute")

        self.db.upsert("player_seasons", {
            "player_id": p["id"], "season_id": sid, "season_label": label, "team_name": prof.team_name,
            "league_name": prof.league_name, "goals": prof.goals_total, "yellow_cards": prof.yellow_cards,
            "red_cards": prof.red_cards, "ifa_team_id": team_id, "ifa_league_id": league_id,
            "game_length_min": length, "backfilled_at": datetime.utcnow().isoformat()},
            "player_id,season_id", returning=False)
        log(f"player {p['id']} season {sid}: team={'ok' if team_id else '-'} league={'ok' if league_id else '-'} "
            f"games={n_games} lineups={n_lineups} played={len(played_ids)} length={length}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    Backfill(ap.parse_args().force).run()
