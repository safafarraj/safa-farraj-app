"""Tiny Supabase REST client (PostgREST) using the server secret key."""
from __future__ import annotations

import os
from typing import Any, Optional

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://pwrtyfpvzhafkwtjxcji.supabase.co")


class DB:
    def __init__(self, url: str = SUPABASE_URL, key: Optional[str] = None):
        key = key or os.environ["SUPABASE_SECRET_KEY"]
        self.base = url.rstrip("/") + "/rest/v1"
        self.s = requests.Session()
        self.s.headers.update({"apikey": key, "Content-Type": "application/json"})
        if key.startswith("eyJ"):  # legacy JWT service_role key
            self.s.headers["Authorization"] = f"Bearer {key}"

    def _check(self, r: requests.Response):
        if r.status_code >= 300:
            raise RuntimeError(f"DB {r.request.method} {r.url.split('?')[0]} -> {r.status_code}: {r.text[:300]}")
        return r

    def select(self, table: str, query: str = "select=*") -> list[dict]:
        return self._check(self.s.get(f"{self.base}/{table}?{query}")).json()

    def upsert(self, table: str, rows: list[dict] | dict, on_conflict: str, returning: bool = True) -> list[dict]:
        if isinstance(rows, dict):
            rows = [rows]
        if not rows:
            return []
        prefer = "resolution=merge-duplicates," + ("return=representation" if returning else "return=minimal")
        r = self._check(self.s.post(f"{self.base}/{table}?on_conflict={on_conflict}", json=rows,
                                    headers={"Prefer": prefer}))
        return r.json() if returning else []

    def insert_ignore(self, table: str, rows: list[dict] | dict, on_conflict: str) -> list[dict]:
        """Insert; silently skip rows that already exist (used for de-duplicated notifications)."""
        if isinstance(rows, dict):
            rows = [rows]
        if not rows:
            return []
        r = self._check(self.s.post(f"{self.base}/{table}?on_conflict={on_conflict}", json=rows,
                                    headers={"Prefer": "resolution=ignore-duplicates,return=representation"}))
        return r.json()

    def update(self, table: str, match: str, values: dict) -> None:
        self._check(self.s.patch(f"{self.base}/{table}?{match}", json=values,
                                 headers={"Prefer": "return=minimal"}))

    def delete(self, table: str, match: str) -> None:
        self._check(self.s.delete(f"{self.base}/{table}?{match}"))

    # app_state helpers
    def get_state(self, key: str, default: Any = None) -> Any:
        rows = self.select("app_state", f"key=eq.{key}&select=value")
        return rows[0]["value"] if rows else default

    def set_state(self, key: str, value: Any) -> None:
        self.upsert("app_state", {"key": key, "value": value}, "key", returning=False)
