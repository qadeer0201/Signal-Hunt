"""Disposable test for first-run local organizer password persistence."""
from __future__ import annotations

import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
import tempfile

ROOT = Path(__file__).resolve().parent
PASSWORD = "Local-QA-" + secrets.token_urlsafe(20)


class App:
    def __init__(self, database: Path, first_run: bool):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self.base = f"http://127.0.0.1:{self.port}"
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        env = os.environ.copy()
        for name in ("ADMIN_PASSWORD", "LOCAL_CREDENTIAL_SETUP", "EVENT_PROFILE"):
            env.pop(name, None)
        env.update({"DATABASE_PATH": str(database), "FRONTEND_DIR": str(ROOT / "Frontend"), "STRICT_SECURITY": "1"})
        if first_run:
            env["ADMIN_PASSWORD"] = PASSWORD
            env["LOCAL_CREDENTIAL_SETUP"] = "1"
        self.process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(self.port)], cwd=ROOT / "Backend", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(120):
            try:
                self.request("GET", "/health")
                return
            except Exception:
                if self.process.poll() is not None:
                    raise RuntimeError("Isolated app failed to start")
                time.sleep(.1)
        raise RuntimeError("Isolated app startup timed out")

    def request(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(self.base + path, data=body, headers={"Content-Type": "application/json"} if body else {}, method=method)
        try:
            with self.opener.open(request, timeout=5) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    def stop(self):
        self.process.kill()
        try:
            self.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Isolated app server did not stop after termination.")
        time.sleep(.25)


def main():
    with tempfile.TemporaryDirectory(prefix="signal-hunt-local-password-") as temp:
        database = Path(temp) / "event.db"
        app = App(database, first_run=True)
        try:
            assert app.request("POST", "/api/admin/login", {"password": PASSWORD})[0] == 200
            db = sqlite3.connect(database)
            try:
                stored = db.execute("SELECT value FROM private_meta WHERE key='organizer_password_hash'").fetchone()[0]
            finally:
                db.close()
            assert stored.startswith("pbkdf2_sha256$") and PASSWORD not in stored
            assert app.request("POST", "/api/admin/login", {"password": "wrong-password"})[0] == 401
        finally:
            app.stop()
        app = App(database, first_run=False)
        try:
            assert app.request("POST", "/api/admin/login", {"password": PASSWORD})[0] == 200
            assert app.request("POST", "/api/admin/login", {"password": "wrong-password"})[0] == 401
        finally:
            app.stop()
    print("Local organizer credential PASS: first-run setup, salted hash only, correct/incorrect login, restart without ADMIN_PASSWORD.")


if __name__ == "__main__":
    main()
