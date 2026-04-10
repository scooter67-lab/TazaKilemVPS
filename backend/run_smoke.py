"""Одноразовая проверка API на временной SQLite (запуск: python run_smoke.py)."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# До импорта приложения
fd, dbpath = tempfile.mkstemp(suffix=".db")
os.close(fd)
Path(dbpath).unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{dbpath.replace(chr(92), '/')}"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

# Контекст обязателен: иначе @app.on_event("startup") / seed не выполняется
with TestClient(app) as client:
    r = client.post("/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    assert client.get("/health").json().get("status") == "ok"
    cur = client.get("/shifts/current", headers=h)
    assert cur.status_code == 200
    assert cur.json() is None

    op = client.post("/shifts/open", headers=h)
    assert op.status_code == 200, op.text
    body = op.json()
    assert body.get("employee_username") == "admin"
    sid = body["id"]

    lst = client.get(f"/requests/{sid}", headers=h)
    assert lst.status_code == 200
    assert lst.json() == []

    req = client.post("/requests", headers=h, json={"shift_id": sid, "request_number": " R1 "})
    assert req.status_code == 200, req.text
    assert req.json()["request_number"] == "R1"

print("smoke ok")
sys.exit(0)
