"""Auth signup/login and per-user case ownership tests."""

from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

_TMP = tempfile.mkdtemp(prefix="hpo_auth_test_")
os.environ["CASES_DB_PATH"] = str(Path(_TMP) / "cases.db")
os.environ["HPO_JWT_SECRET"] = "test-secret-for-auth-unit-tests-32b+"

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


@pytest.fixture(scope="module")
def client():
    with patch("pyhpo_service.warm_all_caches", return_value=None):
        from fastapi.testclient import TestClient
        import main as main_mod

        with TestClient(main_mod.app) as c:
            yield c


def _signup(client, email: str | None = None, password: str = "password123"):
    email = email or f"user_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/api/auth/signup", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["user"]["email"] == email.lower()
    return data


def test_signup_login_me(client):
    email = f"clinician_{uuid.uuid4().hex[:8]}@example.com"
    created = _signup(client, email=email)

    bad = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 401

    ok = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert ok.status_code == 200
    token = ok.json()["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == email.lower()
    assert created["user"]["id"] == me.json()["user"]["id"]


def test_unauthenticated_case_create_is_401(client):
    r = client.post(
        "/api/cases",
        json={
            "name": "orphan",
            "kind": "gene-prioritization",
            "params": {},
            "result": {},
        },
    )
    assert r.status_code == 401


def test_cases_are_scoped_per_user(client):
    a = _signup(client)
    b = _signup(client)
    headers_a = {"Authorization": f"Bearer {a['access_token']}"}
    headers_b = {"Authorization": f"Bearer {b['access_token']}"}

    save = client.post(
        "/api/cases",
        headers=headers_a,
        json={
            "name": "A's case",
            "kind": "gene-prioritization",
            "params": {"queries": ["HP:0001250"]},
            "result": {"genes": []},
        },
    )
    assert save.status_code == 200
    case_id = save.json()["id"]

    list_a = client.get("/api/cases", headers=headers_a)
    assert list_a.status_code == 200
    assert any(c["id"] == case_id for c in list_a.json()["cases"])

    list_b = client.get("/api/cases", headers=headers_b)
    assert list_b.status_code == 200
    assert all(c["id"] != case_id for c in list_b.json()["cases"])

    get_b = client.get(f"/api/cases/{case_id}", headers=headers_b)
    assert get_b.status_code == 404

    delete_b = client.delete(f"/api/cases/{case_id}", headers=headers_b)
    assert delete_b.status_code == 404

    get_a = client.get(f"/api/cases/{case_id}", headers=headers_a)
    assert get_a.status_code == 200
    assert get_a.json()["name"] == "A's case"

    delete_a = client.delete(f"/api/cases/{case_id}", headers=headers_a)
    assert delete_a.status_code == 200
