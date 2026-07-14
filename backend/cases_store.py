"""
Lightweight case persistence -- SQLite via the stdlib, no new dependency.

A "case" is a saved analysis: which page produced it (``kind``), the inputs
used (``params``), and the result payload shown to the user (``result``).
Revisiting a case shows what was found without recomputing anything. For
variant-file cases, the raw uploaded file itself is never stored (it can be
hundreds of MB) -- only the already-computed, already-summarized result.

Cases are scoped per authenticated user (``user_id``).
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

_DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "cases.db"


def _db_path() -> Path:
    env = os.environ.get("CASES_DB_PATH", "").strip()
    return Path(env).expanduser().resolve() if env else _DEFAULT_DB_PATH


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _migrate_cases_user_id(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(cases)").fetchall()}
    if "user_id" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN user_id TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cases_user_id ON cases(user_id)"
    )


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                params_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                user_id TEXT
            )
            """
        )
        _migrate_cases_user_id(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at)")


def save_case(
    name: str,
    kind: str,
    params: dict[str, Any],
    result: dict[str, Any],
    notes: str = "",
    *,
    user_id: str,
) -> str:
    init_db()
    if not user_id:
        raise ValueError("user_id is required")
    case_id = uuid.uuid4().hex
    now = time.time()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO cases (id, name, kind, notes, created_at, updated_at, "
            "params_json, result_json, user_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                case_id,
                name,
                kind,
                notes,
                now,
                now,
                json.dumps(params),
                json.dumps(result),
                user_id,
            ),
        )
    return case_id


def list_cases(user_id: str, kind: str | None = None) -> list[dict[str, Any]]:
    init_db()
    with _connect() as conn:
        if kind:
            rows = conn.execute(
                "SELECT id, name, kind, notes, created_at, updated_at FROM cases "
                "WHERE user_id = ? AND kind = ? ORDER BY created_at DESC",
                (user_id, kind),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, kind, notes, created_at, updated_at FROM cases "
                "WHERE user_id = ? ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def get_case(case_id: str, user_id: str) -> dict[str, Any]:
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM cases WHERE id = ? AND user_id = ?",
            (case_id, user_id),
        ).fetchone()
    if row is None:
        raise KeyError(f"No case found for id {case_id!r}")
    case = dict(row)
    case["params"] = json.loads(case.pop("params_json"))
    case["result"] = json.loads(case.pop("result_json"))
    return case


def delete_case(case_id: str, user_id: str) -> bool:
    init_db()
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM cases WHERE id = ? AND user_id = ?",
            (case_id, user_id),
        )
    return cur.rowcount > 0
