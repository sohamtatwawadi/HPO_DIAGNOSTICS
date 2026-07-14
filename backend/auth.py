"""
Email/password auth with JWT tokens and a SQLite users table (same DB as cases).
"""
from __future__ import annotations

import os
import sqlite3
import time
import uuid
from typing import Any, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from cases_store import _connect, _db_path

_JWT_ALG = "HS256"
_JWT_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days
_bearer = HTTPBearer(auto_error=False)


def _jwt_secret() -> str:
    secret = os.environ.get("HPO_JWT_SECRET", "").strip()
    if secret:
        return secret
    # Local-dev fallback only — set HPO_JWT_SECRET in production.
    return "hpo-diagnostics-dev-secret-change-me-32b"


def init_users_db() -> None:
    """Ensure users table exists (idempotent)."""
    _db_path().parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)")


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_user(email: str, password: str) -> dict[str, Any]:
    init_users_db()
    email_n = _normalize_email(email)
    if not email_n or "@" not in email_n:
        raise ValueError("Valid email is required")
    if len(password or "") < 8:
        raise ValueError("Password must be at least 8 characters")

    user_id = uuid.uuid4().hex
    now = time.time()
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (user_id, email_n, _hash_password(password), now),
            )
    except sqlite3.IntegrityError as exc:
        raise ValueError("An account with this email already exists") from exc

    return {"id": user_id, "email": email_n, "created_at": now}


def authenticate_user(email: str, password: str) -> dict[str, Any]:
    init_users_db()
    email_n = _normalize_email(email)
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
            (email_n,),
        ).fetchone()
    if row is None or not _verify_password(password, row["password_hash"]):
        raise ValueError("Invalid email or password")
    return {"id": row["id"], "email": row["email"], "created_at": row["created_at"]}


def get_user_by_id(user_id: str) -> Optional[dict[str, Any]]:
    init_users_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, email, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    return dict(row)


def issue_token(user: dict[str, Any]) -> str:
    now = int(time.time())
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "iat": now,
        "exp": now + _JWT_TTL_SECONDS,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_JWT_ALG)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[_JWT_ALG])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(401, "Session expired — please log in again") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(401, "Invalid authentication token") from exc


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict[str, Any]:
    if credentials is None or not credentials.credentials:
        raise HTTPException(401, "Authentication required")
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Invalid authentication token")
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(401, "User account no longer exists")
    return user
