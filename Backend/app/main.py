"""Signal Hunt: server-authoritative physical treasure hunt backend.

The browser never receives team access hashes, envelope-code hashes, private riddle notes,
or physical route assignments. Organizer configuration is protected by ADMIN_PASSWORD.
"""
from __future__ import annotations

import hashlib
import hmac
import csv
import io
from email import policy
from email.parser import BytesParser
import os
import re
import secrets
import sqlite3
import shutil
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi.responses import RedirectResponse

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

BASE = Path(__file__).resolve().parent
MAX_TEAMS = max(4, min(10, int(os.getenv("MAX_TEAMS", "10"))))
MAX_MEMBERS_PER_TEAM = 5
MIN_MEMBERS_PER_TEAM = 3

TEAM_PALETTE = [
    {"id": "red", "name": "Red", "colour": "#c93636", "icon": "⚑"},
    {"id": "blue", "name": "Blue", "colour": "#233e65", "icon": "◈"},
    {"id": "green", "name": "Green", "colour": "#26794b", "icon": "❖"},
    {"id": "yellow", "name": "Yellow", "colour": "#e6c83d", "icon": "✦"},
    {"id": "orange", "name": "Orange", "colour": "#e87832", "icon": "ϟ"},
    {"id": "purple", "name": "Purple", "colour": "#743bb0", "icon": "✧"},
    {"id": "cyan", "name": "Cyan", "colour": "#20aeb9", "icon": "⬡"},
    {"id": "white", "name": "White", "colour": "#f1f0e7", "icon": "◇"},
    {"id": "silver", "name": "Silver", "colour": "#aeb4be", "icon": "⌘"},
    {"id": "gold", "name": "Gold", "colour": "#c79b25", "icon": "◉"},
]
LEVELS = {
    1: {"puzzle_type": "Morse", "default_minutes": 15},
    2: {"puzzle_type": "Binary", "default_minutes": 20},
    3: {"puzzle_type": "FSK", "default_minutes": 20},
    4: {"puzzle_type": "Combined", "default_minutes": 25},
}
STATIONS = {"A", "B", "C", "D"}


def get_frontend_dir() -> Path:
    configured = os.getenv("FRONTEND_DIR", "").strip()
    candidates = [Path(configured).expanduser()] if configured else []
    candidates.extend([BASE.parent.parent / "Frontend", BASE.parent.parent / "frontend", BASE.parent / "Frontend"])
    for candidate in candidates:
        if candidate.is_dir() and (candidate / "index.html").is_file() and (candidate / "host.html").is_file():
            return candidate.resolve()
    return candidates[0] if candidates else BASE.parent.parent / "Frontend"


FRONTEND = get_frontend_dir()


def get_db_path() -> Path:
    path = Path(os.getenv("DATABASE_PATH", str(BASE.parent / "data" / "signal-hunt.db"))).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def get_admin_password() -> str:
    return os.getenv("ADMIN_PASSWORD", "")


STRICT_SECURITY = os.getenv("STRICT_SECURITY", "1") != "0"


def hash_local_admin_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    rounds = 310_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return "pbkdf2_sha256$" + str(rounds) + "$" + salt.hex() + "$" + digest.hex()


def verify_local_admin_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False

app = FastAPI(title="Signal Hunt API", version="3.0.0", description="Physical envelope hunt with organizer-managed team codes, routes, level timers, and envelope verification.")
if (FRONTEND / "styles").is_dir():
    app.mount("/styles", StaticFiles(directory=FRONTEND / "styles"), name="frontend-styles")
if (FRONTEND / "js").is_dir():
    app.mount("/js", StaticFiles(directory=FRONTEND / "js"), name="frontend-js")
if (FRONTEND / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="frontend-assets")


class RateLimiter:
    def __init__(self) -> None:
        self.history: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        current = time.time()
        kept = [entry for entry in self.history[key] if entry > current - window_seconds]
        self.history[key] = kept
        if len(kept) >= max_requests:
            return False
        kept.append(current)
        self.history[key] = kept
        return True

    def is_under_limit(self, key: str, max_requests: int, window_seconds: int) -> bool:
        current = time.time()
        kept = [entry for entry in self.history[key] if entry > current - window_seconds]
        self.history[key] = kept
        return len(kept) < max_requests

    def record(self, key: str) -> None:
        self.history[key].append(time.time())

    def clear(self) -> None:
        self.history.clear()


rate_limiter = RateLimiter()
PARTICIPANT_SESSIONS: dict[str, dict] = {}
PARTICIPANT_COOKIE = "sh_participant_session"
PARTICIPANT_SESSION_SECONDS = 12 * 60 * 60
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "0").strip().lower() in {"1", "true", "yes"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_time(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def code_normalize(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip()).upper()


def code_hash(value: str) -> str:
    """Legacy deterministic digest used only to upgrade existing code records."""
    return hashlib.sha256(code_normalize(value).encode("utf-8")).hexdigest()


_LOOKUP_KEY: Optional[bytes] = None


def get_lookup_key() -> bytes:
    global _LOOKUP_KEY
    if _LOOKUP_KEY is not None:
        return _LOOKUP_KEY
    db_path = get_db_path()
    key_path = Path(str(db_path) + ".lookup-key")
    if key_path.exists():
        key = key_path.read_bytes()
        if len(key) != 32:
            raise RuntimeError("Signal Hunt code lookup key is invalid; restore the matching key backup before startup.")
        _LOOKUP_KEY = key
        return key
    if db_path.exists():
        try:
            with sqlite3.connect(db_path) as check_db:
                has_meta = check_db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='private_meta'").fetchone()
                if has_meta and check_db.execute("SELECT 1 FROM private_meta WHERE key='lookup_key_fingerprint'").fetchone():
                    raise RuntimeError("Signal Hunt code lookup key is missing; restore it from the matching database backup.")
        except sqlite3.Error:
            pass
    key = secrets.token_bytes(32)
    try:
        fd = os.open(key_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(key)
            output.flush()
            os.fsync(output.fileno())
    except FileExistsError:
        key = key_path.read_bytes()
    _LOOKUP_KEY = key
    return key


def code_lookup_hash(value: str) -> str:
    return hmac.new(get_lookup_key(), code_normalize(value).encode("utf-8"), hashlib.sha256).hexdigest()


def hash_secret_code(value: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", code_normalize(value).encode(), salt, 120_000)
    return "pbkdf2_sha256$120000$" + salt.hex() + "$" + digest.hex()


def verify_secret_code(value: str, stored: str) -> bool:
    if stored.startswith("pbkdf2_sha256$"):
        try:
            _, rounds, salt, digest = stored.split("$", 3)
            actual = hashlib.pbkdf2_hmac("sha256", code_normalize(value).encode(), bytes.fromhex(salt), int(rounds)).hex()
            return hmac.compare_digest(actual, digest)
        except (ValueError, TypeError):
            return False
    return hmac.compare_digest(code_hash(value), stored)


def answer_normalize(value: str) -> str:
    return " ".join((value or "").strip().casefold().split())


def log(c: sqlite3.Connection, team_id: Optional[int], kind: str, details: str = "") -> None:
    c.execute(
        "INSERT INTO events(team_id, kind, details, created_at) VALUES(?,?,?,?)",
        (team_id, kind[:50], details[:250], now()),
    )


def connect() -> sqlite3.Connection:
    c = sqlite3.connect(get_db_path(), timeout=20, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=10000")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init_db() -> None:
    with connect() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            colour TEXT NOT NULL UNIQUE,
            team_size INTEGER NOT NULL DEFAULT 3,
            code_hash TEXT NOT NULL UNIQUE,
            code_lookup_hash TEXT UNIQUE,
            eliminated INTEGER NOT NULL DEFAULT 0,
            eliminated_reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(team_id, device_id),
            FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS game_state (
            id INTEGER PRIMARY KEY CHECK (id=1),
            status TEXT NOT NULL DEFAULT 'waiting',
            started_at TEXT,
            paused_at TEXT,
            remaining_seconds INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO game_state(id,status,started_at,paused_at,remaining_seconds)
          VALUES(1,'waiting',NULL,NULL,0);
        CREATE TABLE IF NOT EXISTS level_settings (
            level INTEGER PRIMARY KEY CHECK(level BETWEEN 1 AND 4),
            puzzle_type TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 1 AND 180)
        );
        CREATE TABLE IF NOT EXISTS team_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL,
            level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 4),
            station_id TEXT NOT NULL CHECK(station_id IN ('A','B','C','D')),
            riddle_notes TEXT NOT NULL DEFAULT '',
            envelope_code_hash TEXT UNIQUE,
            envelope_code_lookup_hash TEXT UNIQUE,
            elapsed_seconds INTEGER NOT NULL DEFAULT 0,
            started_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(team_id, level),
            FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER,
            kind TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS private_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_team_levels_team ON team_levels(team_id, level);
        CREATE INDEX IF NOT EXISTS idx_events_team_kind ON events(team_id, kind);
        CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id);
        """)
        # Allow the app to start against a database created by earlier versions of this package.
        team_cols = {row["name"] for row in c.execute("PRAGMA table_info(teams)").fetchall()}
        if "team_size" not in team_cols:
            c.execute("ALTER TABLE teams ADD COLUMN team_size INTEGER NOT NULL DEFAULT 3")
        if "eliminated_reason" not in team_cols:
            c.execute("ALTER TABLE teams ADD COLUMN eliminated_reason TEXT NOT NULL DEFAULT ''")
        # Upgrade the former palette IDs one-to-one to the ten event-approved colours.
        for old_colour, new_colour in (("black", "white"), ("navy", "blue"), ("grey", "silver"), ("brown", "gold"), ("peach", "cyan")):
            c.execute("UPDATE teams SET colour=? WHERE colour=?", (new_colour, old_colour))
        if "code_lookup_hash" not in team_cols:
            c.execute("ALTER TABLE teams ADD COLUMN code_lookup_hash TEXT")
            c.execute("UPDATE teams SET code_lookup_hash=code_hash WHERE code_lookup_hash IS NULL")
        level_cols = {row["name"] for row in c.execute("PRAGMA table_info(team_levels)").fetchall()}
        if "envelope_code_lookup_hash" not in level_cols:
            c.execute("ALTER TABLE team_levels ADD COLUMN envelope_code_lookup_hash TEXT")
            c.execute("UPDATE team_levels SET envelope_code_lookup_hash=envelope_code_hash WHERE envelope_code_lookup_hash IS NULL")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_code_lookup ON teams(code_lookup_hash)")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_levels_code_lookup ON team_levels(envelope_code_lookup_hash)")
        fingerprint = hashlib.sha256(get_lookup_key()).hexdigest()
        existing_key = c.execute("SELECT value FROM private_meta WHERE key='lookup_key_fingerprint'").fetchone()
        if existing_key and not hmac.compare_digest(existing_key["value"], fingerprint):
            raise RuntimeError("Signal Hunt code lookup key does not match this database; restore the matching key backup.")
        c.execute("INSERT OR IGNORE INTO private_meta(key,value) VALUES('lookup_key_fingerprint',?)", (fingerprint,))
        for level, item in LEVELS.items():
            c.execute(
                "INSERT OR IGNORE INTO level_settings(level,puzzle_type,duration_minutes) VALUES(?,?,?)",
                (level, item["puzzle_type"], item["default_minutes"]),
            )
        if os.getenv("LOCAL_CREDENTIAL_SETUP") == "1":
            password = get_admin_password()
            if len(password.strip()) < 12:
                raise RuntimeError("Organizer password must contain at least 12 characters.")
            c.execute(
                "INSERT OR IGNORE INTO private_meta(key,value) VALUES('organizer_password_hash',?)",
                (hash_local_admin_password(password),),
            )
        if STRICT_SECURITY:
            configured = bool(get_admin_password()) or bool(c.execute(
                "SELECT 1 FROM private_meta WHERE key='organizer_password_hash'"
            ).fetchone())
            if not configured:
                raise RuntimeError("Organizer password is not set. Start Signal Hunt with run-signal-hunt.ps1 to set it once.")
            if get_admin_password() and len(get_admin_password().strip()) < 12:
                raise RuntimeError("Organizer password must contain at least 12 characters.")


HOST_SESSIONS: dict[str, dict] = {}
HOST_SESSION_LIMIT = 2
HOST_SESSION_SECONDS = 8 * 60 * 60
VERIFIED_CODE_CACHE: set[tuple[str, str]] = set()


def _admin_password_fingerprint() -> str:
    password = get_admin_password()
    if password:
        return hashlib.sha256(password.encode()).hexdigest()
    with connect() as c:
        row = c.execute("SELECT value FROM private_meta WHERE key='organizer_password_hash'").fetchone()
    return hashlib.sha256((row["value"] if row else "missing-local-organizer-password").encode()).hexdigest()


def verify_admin_password(password: str) -> bool:
    configured = get_admin_password()
    if configured:
        return hmac.compare_digest(password, configured)
    with connect() as c:
        row = c.execute("SELECT value FROM private_meta WHERE key='organizer_password_hash'").fetchone()
    return bool(row and verify_local_admin_password(password, row["value"]))


def require_admin(request: Request) -> str:
    token = request.cookies.get("sh_host_session", "")
    session = HOST_SESSIONS.get(hashlib.sha256(token.encode()).hexdigest()) if token else None
    if not session or session["expires"] <= time.time() or not hmac.compare_digest(session["password_fingerprint"], _admin_password_fingerprint()):
        if session:
            HOST_SESSIONS.pop(hashlib.sha256(token.encode()).hexdigest(), None)
        log_event("host_unauthorized", "Unauthorized organizer operation", request)
        raise HTTPException(401, "Organizer session required. Sign in again.")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        expected = f"{request.url.scheme}://{request.url.netloc}"
        if origin and origin != expected:
            raise HTTPException(403, "Cross-origin organizer request rejected.")
        if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf"]):
            raise HTTPException(403, "Organizer request token is missing or expired. Reload the host dashboard.")
    return session["csrf"]


def log_event(kind: str, details: str, request: Optional[Request] = None) -> None:
    try:
        with connect() as c:
            log(c, None, kind, f"{details} (client {request_ip(request)})" if request else details)
    except sqlite3.Error:
        pass


def request_ip(request: Optional[Request]) -> str:
    return request.client.host if request and request.client else "global"


def get_team_by_code(c: sqlite3.Connection, value: str) -> Optional[sqlite3.Row]:
    if not value or len(value) > 100:
        return None
    row = c.execute("SELECT * FROM teams WHERE code_lookup_hash=?", (code_lookup_hash(value),)).fetchone()
    if not row:
        row = c.execute("SELECT * FROM teams WHERE code_lookup_hash=?", (code_hash(value),)).fetchone()
    fingerprint = code_lookup_hash(value)
    if row and ((fingerprint, row["code_hash"]) in VERIFIED_CODE_CACHE or verify_secret_code(value, row["code_hash"])):
        upgraded = row["code_hash"] if row["code_hash"].startswith("pbkdf2_sha256$") else hash_secret_code(value)
        if upgraded != row["code_hash"] or row["code_lookup_hash"] != fingerprint:
            c.execute("UPDATE teams SET code_hash=?,code_lookup_hash=? WHERE id=?", (upgraded, fingerprint, row["id"]))
            row = c.execute("SELECT * FROM teams WHERE id=?", (row["id"],)).fetchone()
        VERIFIED_CODE_CACHE.add((fingerprint, row["code_hash"]))
        return row
    return None


def code_exists(c: sqlite3.Connection, value: str, exclude_team: Optional[int] = None, exclude_level: Optional[tuple[int, int]] = None) -> bool:
    fingerprint = code_lookup_hash(value)
    team = c.execute("SELECT id,code_hash FROM teams WHERE code_lookup_hash=?", (fingerprint,)).fetchone()
    if not team:
        team = c.execute("SELECT id,code_hash FROM teams WHERE code_lookup_hash=?", (code_hash(value),)).fetchone()
    if team and team["id"] != exclude_team and verify_secret_code(value, team["code_hash"]):
        return True
    level = c.execute("SELECT team_id,level,envelope_code_hash FROM team_levels WHERE envelope_code_lookup_hash=?", (fingerprint,)).fetchone()
    if not level:
        level = c.execute("SELECT team_id,level,envelope_code_hash FROM team_levels WHERE envelope_code_lookup_hash=?", (code_hash(value),)).fetchone()
    return bool(level and exclude_level != (level["team_id"], level["level"]) and verify_secret_code(value, level["envelope_code_hash"]))


def require_registered_device(c: sqlite3.Connection, team_id: int, device_id: Optional[str]) -> None:
    """Ensure gameplay/violation calls originate from a device registered at login."""
    if not device_id or len(device_id) > 100:
        raise HTTPException(401, "Registered device session required. Log in on this device again.")
    device = c.execute("SELECT id FROM participants WHERE team_id=? AND device_id=?", (team_id, device_id)).fetchone()
    if not device:
        raise HTTPException(401, "This device is not registered for this team. Log in with the team's access code.")


def issue_participant_session(team_id: int, device_id: str) -> tuple[str, str]:
    for key, existing in list(PARTICIPANT_SESSIONS.items()):
        if existing["expires"] <= time.time() or (existing["team_id"] == team_id and existing["device_id"] == device_id):
            PARTICIPANT_SESSIONS.pop(key, None)
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    PARTICIPANT_SESSIONS[hashlib.sha256(token.encode()).hexdigest()] = {
        "team_id": team_id, "device_id": device_id, "csrf": csrf,
        "expires": time.time() + PARTICIPANT_SESSION_SECONDS,
    }
    return token, csrf


def revoke_participant_sessions(team_id: int) -> None:
    for key, session in list(PARTICIPANT_SESSIONS.items()):
        if session["team_id"] == team_id:
            PARTICIPANT_SESSIONS.pop(key, None)


def resolve_participant(
    request: Request,
    c: sqlite3.Connection,
    *,
    code: Optional[str] = None,
    device_id: Optional[str] = None,
    require_csrf: bool = False,
) -> tuple[sqlite3.Row, str]:
    token = request.cookies.get(PARTICIPANT_COOKIE, "")
    if token:
        key = hashlib.sha256(token.encode()).hexdigest()
        session = PARTICIPANT_SESSIONS.get(key)
        if not session or session["expires"] <= time.time():
            PARTICIPANT_SESSIONS.pop(key, None)
            raise HTTPException(401, "Participant session expired. Log in with the team code again.")
        if require_csrf and not hmac.compare_digest(request.headers.get("x-participant-csrf", ""), session["csrf"]):
            raise HTTPException(403, "Participant request verification failed. Refresh and try again.")
        team = c.execute("SELECT * FROM teams WHERE id=?", (session["team_id"],)).fetchone()
        if not team:
            raise HTTPException(401, "Participant session is no longer valid.")
        require_registered_device(c, int(team["id"]), session["device_id"])
        return team, session["device_id"]
    if code:
        team = get_team_by_code(c, code)
        if not team:
            raise HTTPException(401, "Invalid team access code.")
        require_registered_device(c, int(team["id"]), device_id)
        return team, str(device_id)
    raise HTTPException(401, "Participant authentication required. Log in with the team code.")


def get_game_state(c: sqlite3.Connection) -> dict:
    row = c.execute("SELECT status,started_at,paused_at FROM game_state WHERE id=1").fetchone()
    if not row:
        return {"status": "waiting", "started_at": None, "paused_at": None}
    return {"status": row["status"], "started_at": row["started_at"], "paused_at": row["paused_at"]}


def get_level_settings(c: sqlite3.Connection) -> list[dict]:
    return [dict(row) for row in c.execute("SELECT level,puzzle_type,duration_minutes FROM level_settings ORDER BY level").fetchall()]


def get_progress(c: sqlite3.Connection, team_id: int, state: Optional[dict] = None) -> dict:
    state = state or get_game_state(c)
    settings = {int(row["level"]): dict(row) for row in c.execute("SELECT * FROM level_settings").fetchall()}
    rows = {int(row["level"]): dict(row) for row in c.execute("SELECT * FROM team_levels WHERE team_id=?", (team_id,)).fetchall()}
    completed = [level for level in range(1, 5) if rows.get(level) and rows[level].get("completed_at")]
    current_level = next((level for level in range(1, 5) if level not in completed), 5)
    remaining = None
    timed_out = False
    timer_active = False
    level_limit = None
    if current_level <= 4 and current_level in rows and current_level in settings:
        record = rows[current_level]
        level_limit = int(settings[current_level]["duration_minutes"] * 60)
        elapsed = int(record["elapsed_seconds"] or 0)
        if record["started_at"] and state["status"] == "active":
            elapsed += max(0, int((datetime.now(timezone.utc) - parse_time(record["started_at"])).total_seconds()))
            timer_active = True
        remaining = max(0, level_limit - elapsed)
        timed_out = elapsed >= level_limit and (state["status"] == "active")
    return {
        "completed_levels": len(completed),
        "total_levels": 4,
        "completed": len(completed) == 4,
        "current_level": current_level if current_level <= 4 else 4,
        "current_level_remaining_seconds": remaining,
        "current_level_time_limit_seconds": level_limit,
        "current_level_timed_out": timed_out,
        "current_level_timer_active": timer_active,
        "completed_level_numbers": completed,
    }


def public_state(c: sqlite3.Connection) -> dict:
    state = get_game_state(c)
    settings = get_level_settings(c)
    return {
        "status": state["status"],
        "remaining_seconds": None,
        "duration_seconds": sum(int(item["duration_minutes"]) * 60 for item in settings),
        "level_times": settings,
    }


def public_config(c: Optional[sqlite3.Connection] = None) -> dict:
    durations = get_level_settings(c) if c else [
        {"level": level, "puzzle_type": spec["puzzle_type"], "duration_minutes": spec["default_minutes"]}
        for level, spec in LEVELS.items()
    ]
    # The full palette is for organizer team creation. Participant login should only
    # enable colours that have an actual registered team and a host-assigned code.
    registered_colours = []
    if c is not None:
        registered_colours = [row["colour"] for row in c.execute("SELECT colour FROM teams ORDER BY id").fetchall()]
    return {
        "event_label": "One Signal Hunt event · configure 4–10 teams",
        "default_team_target": 4,
        "min_teams": 4,
        "max_teams": MAX_TEAMS,
        "min_team_size": MIN_MEMBERS_PER_TEAM,
        "max_team_size": MAX_MEMBERS_PER_TEAM,
        "max_participants_per_team": MAX_MEMBERS_PER_TEAM,
        "max_participants": MAX_TEAMS * MAX_MEMBERS_PER_TEAM,
        "stations": 4,
        # Full palette is available to the host. This does not create teams or codes.
        # Participants can select only colours listed in registered_colours.
        "available_colours": TEAM_PALETTE,
        "registered_colours": registered_colours,
        "level_times": durations,
        "puzzle_types": {str(level): spec["puzzle_type"] for level, spec in LEVELS.items()},
    }


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    colour: str = Field(min_length=1, max_length=30)
    code: str = Field(min_length=8, max_length=32)
    team_size: int = Field(default=3, ge=3, le=5)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Team name must contain at least two characters")
        return value

    @field_validator("colour")
    @classmethod
    def validate_colour(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {item["id"] for item in TEAM_PALETTE}:
            raise ValueError("Choose one of the ten available team colours")
        return value

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = code_normalize(value)
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{7,31}", value):
            raise ValueError("Use 8–32 characters: letters, numbers, hyphens or underscores; no spaces")
        return value




class TeamUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    colour: str = Field(min_length=1, max_length=30)
    team_size: int = Field(ge=3, le=5)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Team name must contain at least two characters")
        return value

    @field_validator("colour")
    @classmethod
    def validate_colour(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {item["id"] for item in TEAM_PALETTE}:
            raise ValueError("Choose one of the ten available team colours")
        return value


class TeamCodeUpdate(BaseModel):
    code: str = Field(min_length=8, max_length=32)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = code_normalize(value)
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{7,31}", value):
            raise ValueError("Use 8–32 characters: letters, numbers, hyphens or underscores; no spaces")
        return value


class Login(BaseModel):
    code: str = Field(min_length=8, max_length=100)
    colour: Optional[str] = Field(default=None, max_length=20)
    device_id: str = Field(min_length=1, max_length=100)


class EnvelopeSubmission(BaseModel):
    code: Optional[str] = Field(default=None, min_length=8, max_length=100)
    device_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    envelope_code: str = Field(min_length=8, max_length=100)


class Violation(BaseModel):
    code: Optional[str] = Field(default=None, min_length=8, max_length=100)
    device_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    kind: str = Field(default="back_navigation", max_length=50)
    details: str = Field(default="", max_length=200)


class TeamLevelConfig(BaseModel):
    station_id: str = Field(min_length=1, max_length=1)
    riddle_notes: str = Field(min_length=1, max_length=4000)
    envelope_code: Optional[str] = Field(default=None, min_length=8, max_length=32)

    @field_validator("station_id")
    @classmethod
    def validate_station(cls, value: str) -> str:
        value = value.strip().upper()
        if value not in STATIONS:
            raise ValueError("Station marker must be A, B, C or D")
        return value

    @field_validator("riddle_notes")
    @classmethod
    def validate_riddle_notes(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter organizer notes for the physical envelope riddle")
        return value

    @field_validator("envelope_code")
    @classmethod
    def validate_envelope_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = code_normalize(value)
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{7,31}", value):
            raise ValueError("Use 8–32 characters: letters, numbers, hyphens or underscores; no spaces")
        return value


class LevelSettingUpdate(BaseModel):
    duration_minutes: int = Field(ge=1, le=180)


class GameReset(BaseModel):
    confirm: str
    clear_participants: bool = True


class EventReset(BaseModel):
    confirm: str


TEAM_CSV_HEADERS = ["team_name", "team_colour", "member_count", "team_access_code"]
ROUTE_CSV_HEADERS = ["team_name", "team_colour"] + [f"level_{level}_{field}" for level in range(1, 5) for field in ("station", "envelope_code", "organizer_note")]


def spreadsheet_safe(value: str) -> str:
    text = str(value or "")
    probe = text.lstrip(" \t\r\n")
    if text.startswith(("\t", "\r")) or probe.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


class CsvRows(list):
    def __init__(self, *args, first_data_line: int = 2):
        super().__init__(*args)
        self.first_data_line = first_data_line


def parse_csv_upload(content: bytes, expected: list[str]) -> CsvRows:
    if len(content) > 1_000_000:
        raise HTTPException(413, "CSV file exceeds the 1 MB limit.")
    try:
        text = content.decode("utf-8-sig")
        lines = text.splitlines(keepends=True)
        skipped_lines = 0
        while lines and lines[0].lstrip().startswith("#"):
            lines.pop(0)
            skipped_lines += 1
        reader = csv.DictReader(io.StringIO("".join(lines), newline=""), strict=True)
        headers = [header.strip() for header in (reader.fieldnames or [])]
        reader.fieldnames = headers
        if headers != expected:
            raise HTTPException(422, f"CSV headers must be exactly: {', '.join(expected)}.")
        rows = CsvRows(first_data_line=skipped_lines + 2)
        for line, row in enumerate(reader, start=rows.first_data_line):
            if None in row or any(value is None for value in row.values()):
                raise HTTPException(422, f"CSV row {line}: malformed column count.")
            rows.append({key: value.strip() for key, value in row.items()})
        if not rows:
            raise HTTPException(422, "CSV contains no data rows.")
        return rows
    except UnicodeDecodeError:
        raise HTTPException(422, "CSV must be UTF-8 encoded.")
    except csv.Error:
        raise HTTPException(422, "CSV contains malformed quoting or fields.")


def validate_csv_rows(rows: CsvRows, expected: list[str]) -> CsvRows:
    valid = CsvRows(first_data_line=rows.first_data_line)
    for line, row in enumerate(rows, start=rows.first_data_line):
        if any(not row.get(key, "").strip() for key in expected):
            raise HTTPException(422, f"CSV row {line}: every field is required.")
        valid.append(row)
    return valid


def normalize_team_csv_rows(rows: CsvRows) -> CsvRows:
    normalized = CsvRows(first_data_line=rows.first_data_line)
    for line, row in enumerate(rows, start=rows.first_data_line):
        if any(not row.get(key, "").strip() for key in TEAM_CSV_HEADERS):
            raise HTTPException(422, f"CSV row {line}: every field is required.")
        normalized.append(row)
    return normalized


async def uploaded_csv(request: Request) -> bytes:
    content_type = request.headers.get("content-type", "")
    if not content_type.lower().startswith("multipart/form-data;") or "boundary=" not in content_type.lower():
        raise HTTPException(415, "Upload the CSV using multipart form data.")
    try:
        declared_size = int(request.headers.get("content-length", "0"))
    except ValueError:
        raise HTTPException(400, "Malformed upload length.")
    if declared_size > 1_100_000:
        raise HTTPException(413, "CSV upload exceeds the 1 MB limit.")
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 1_100_000:
            raise HTTPException(413, "CSV upload exceeds the 1 MB limit.")
        chunks.append(chunk)
    try:
        message = BytesParser(policy=policy.default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii") + b"".join(chunks)
        )
    except (UnicodeEncodeError, ValueError):
        raise HTTPException(400, "Malformed CSV upload.")
    if not message.is_multipart():
        raise HTTPException(400, "Malformed CSV upload.")
    files = [part for part in message.iter_parts() if part.get_content_disposition() == "form-data" and part.get_param("name", header="content-disposition") == "file" and part.get_filename()]
    if len(files) != 1:
        raise HTTPException(422, "Upload exactly one CSV file using the file field.")
    return files[0].get_payload(decode=True) or b""


@app.on_event("startup")
def startup() -> None:
    init_db()
    if os.getenv("LOCAL_CREDENTIAL_SETUP") == "1":
        os.environ.pop("ADMIN_PASSWORD", None)
        os.environ.pop("LOCAL_CREDENTIAL_SETUP", None)


@app.get("/")
@app.get("/index.html")
def home():
    path = FRONTEND / "index.html"
    if not path.is_file():
        return JSONResponse({"detail": "Participant frontend not found", "frontend_dir": str(FRONTEND)}, status_code=500)
    return FileResponse(path)


@app.get("/host")
@app.get("/host.html")
def host_page(request: Request):
    try:
        require_admin(request)
    except HTTPException:
        return RedirectResponse("/", status_code=303)
    path = FRONTEND / "host.html"
    if not path.is_file():
        return JSONResponse({"detail": "Host frontend not found", "frontend_dir": str(FRONTEND)}, status_code=500)
    return FileResponse(path)


class HostLogin(BaseModel):
    password: str = Field(min_length=1, max_length=256)


@app.post("/api/admin/login")
def host_login(data: HostLogin, request: Request):
    key = f"admin_fail_{request_ip(request)}"
    if not rate_limiter.is_under_limit(key, max_requests=15, window_seconds=300):
        log_event("host_auth_failed", "Organizer login rate limit reached", request)
        raise HTTPException(429, "Too many failed organizer authentication attempts. Wait five minutes.")
    if not verify_admin_password(data.password):
        rate_limiter.record(key)
        log_event("host_auth_failed", "Organizer login failed; credential redacted", request)
        raise HTTPException(401, "Organizer authentication failed.")
    active = [k for k,v in HOST_SESSIONS.items() if v["expires"] > time.time() and hmac.compare_digest(v["password_fingerprint"], _admin_password_fingerprint())]
    if len(active) >= HOST_SESSION_LIMIT:
        raise HTTPException(429, "Two organizer sessions are already active. Sign out of an unused host session first.")
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    HOST_SESSIONS[hashlib.sha256(token.encode()).hexdigest()] = {"csrf": csrf, "expires": time.time() + HOST_SESSION_SECONDS, "password_fingerprint": _admin_password_fingerprint()}
    response = JSONResponse({"csrf_token": csrf})
    secure_cookie = request.url.scheme == "https" or os.getenv("SECURE_COOKIES", "0") == "1"
    response.set_cookie("sh_host_session", token, httponly=True, secure=secure_cookie, samesite="strict", max_age=HOST_SESSION_SECONDS, path="/")
    log_event("host_auth_success", "Organizer authenticated", request)
    return response


@app.get("/api/admin/session")
def host_session(request: Request):
    csrf = require_admin(request)
    return {"csrf_token": csrf}


@app.post("/api/admin/logout")
def host_logout(request: Request):
    token = request.cookies.get("sh_host_session", "")
    require_admin(request)
    HOST_SESSIONS.pop(hashlib.sha256(token.encode()).hexdigest(), None)
    response = JSONResponse({"message": "Organizer signed out."})
    response.delete_cookie("sh_host_session", path="/")
    return response


@app.get("/api/config")
def app_config():
    with connect() as c:
        return public_config(c)


@app.get("/api/status")
def status():
    with connect() as c:
        return public_state(c)


def require_game_waiting_or_finished(c: sqlite3.Connection) -> None:
    status_value = get_game_state(c)["status"]
    if status_value not in {"waiting", "finished"}:
        raise HTTPException(409, "Pause and re-arm the event before changing team routes or station contents.")


@app.post("/api/admin/teams")
def create_team(data: TeamCreate, request: Request):
    require_admin(request)
    with connect() as c:
        require_game_waiting_or_finished(c)
        c.execute("BEGIN IMMEDIATE")
        count = c.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
        if count >= MAX_TEAMS:
            raise HTTPException(409, f"This event allows at most {MAX_TEAMS} teams.")
        colour = data.colour
        if c.execute("SELECT id FROM teams WHERE colour=?", (colour,)).fetchone():
            raise HTTPException(409, f"Colour '{colour}' is already assigned to another team.")
        digest = hash_secret_code(data.code)
        if code_exists(c, data.code):
            raise HTTPException(409, "That team access code is already in use. Choose a different code.")
        try:
            cur = c.execute(
                "INSERT INTO teams(name,colour,team_size,code_hash,code_lookup_hash,created_at) VALUES(?,?,?,?,?,?)",
                (data.name, colour, data.team_size, digest, code_lookup_hash(data.code), now()),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Team name or colour is already assigned.") from exc
        team_id = int(cur.lastrowid)
        log(c, team_id, "team_created", f"Organizer created team {data.name} ({colour}), team size {data.team_size}")
        return {"id": team_id, "name": data.name, "colour": colour, "team_size": data.team_size, "message": "Team created. The organizer-entered code was stored as a hash."}


@app.put("/api/admin/teams/{team_id}")
def edit_team(team_id: int, data: TeamUpdate, request: Request):
    require_admin(request)
    with connect() as c:
        require_game_waiting_or_finished(c)
        c.execute("BEGIN IMMEDIATE")
        team = c.execute("SELECT * FROM teams WHERE id=?", (team_id,)).fetchone()
        if not team:
            raise HTTPException(404, "Team not found.")
        if int(data.team_size) < int(c.execute("SELECT COUNT(*) FROM participants WHERE team_id=?", (team_id,)).fetchone()[0]):
            raise HTTPException(409, "Team size cannot be lower than the number of registered devices.")
        other = c.execute("SELECT id FROM teams WHERE colour=? AND id<>?", (data.colour, team_id)).fetchone()
        if other:
            raise HTTPException(409, "That colour is already assigned to another team.")
        try:
            c.execute("UPDATE teams SET name=?,colour=?,team_size=? WHERE id=?", (data.name, data.colour, data.team_size, team_id))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "That team name is already assigned.") from exc
        revoke_participant_sessions(team_id)
        log(c, team_id, "team_details_updated", "Organizer updated this team's name, colour or size.")
        return {"message": "Team details updated. Team members must sign in again if their colour changed."}


@app.delete("/api/admin/teams/{team_id}")
def delete_team(team_id: int, request: Request):
    require_admin(request)
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        state = get_game_state(c)
        if state["status"] != "waiting":
            raise HTTPException(409, "Teams can only be removed while the event is waiting.")
        if c.execute("SELECT 1 FROM events WHERE kind='game_started' LIMIT 1").fetchone():
            raise HTTPException(409, "A game has already been started for this event. Keep team and audit records intact; use Reset Event Setup to prepare new data.")
        team = c.execute("SELECT name FROM teams WHERE id=?", (team_id,)).fetchone()
        if not team:
            raise HTTPException(404, "Team not found.")
        revoke_participant_sessions(team_id)
        c.execute("DELETE FROM teams WHERE id=?", (team_id,))
        log(c, None, "team_removed", f"Organizer removed pre-game team '{team['name']}'.")
        return {"message": "Team removed before gameplay. Its route and participant setup was removed with it."}


@app.put("/api/admin/teams/{team_id}/code")
def update_team_code(team_id: int, data: TeamCodeUpdate, request: Request):
    require_admin(request)
    with connect() as c:
        require_game_waiting_or_finished(c)
        c.execute("BEGIN IMMEDIATE")
        team = c.execute("SELECT id,name FROM teams WHERE id=?", (team_id,)).fetchone()
        if not team:
            raise HTTPException(404, "Team not found.")
        if code_exists(c, data.code, exclude_team=team_id):
            raise HTTPException(409, "That code is already assigned to an envelope. Choose a different team login code.")
        digest = hash_secret_code(data.code)
        c.execute("UPDATE teams SET code_hash=?,code_lookup_hash=? WHERE id=?", (digest, code_lookup_hash(data.code), team_id))
        revoke_participant_sessions(team_id)
        log(c, team_id, "team_code_changed", f"Organizer changed the login code for team '{team['name']}'.")
        return {"message": "Team login code updated. The previous code no longer works; save the new code securely."}


@app.post("/api/register")
def legacy_register(data: TeamCreate, request: Request):
    return create_team(data, request)


@app.post("/api/login")
def login(data: Login, request: Request, response: Response):
    ip = request_ip(request)
    key = f"login_fail_{ip}"
    # Count failed guesses, not successful login requests: participants on campus Wi-Fi
    # may share one public IP, and successful logins must not consume their allowance.
    if not rate_limiter.is_under_limit(key, max_requests=30, window_seconds=60):
        raise HTTPException(429, "Too many failed login attempts from this network. Wait one minute before trying again.")
    with connect() as c:
        # Serialize the device-capacity check and insert. This prevents concurrent logins
        # from overfilling a team's configured 3–5 device slots.
        c.execute("BEGIN IMMEDIATE")
        team = get_team_by_code(c, data.code)
        if not team:
            rate_limiter.record(key)
            log(c, None, "team_auth_failed", "Participant login failed; credential redacted")
            c.commit()
            raise HTTPException(401, "Invalid team access code.")
        if data.colour and data.colour != team["colour"]:
            log(c, int(team["id"]), "team_auth_failed", "Participant selected a colour that does not match the credential; credential redacted")
            c.commit()
            raise HTTPException(401, "The selected team colour and access code do not match.")
        if team["eliminated"]:
            raise HTTPException(403, "This team is eliminated. Contact the organizer.")
        device_id = data.device_id.strip()[:100]
        if not device_id:
            raise HTTPException(400, "Device ID is required.")
        existing = c.execute("SELECT id FROM participants WHERE team_id=? AND device_id=?", (team["id"], device_id)).fetchone()
        if not existing:
            current_count = c.execute("SELECT COUNT(*) FROM participants WHERE team_id=?", (team["id"],)).fetchone()[0]
            if current_count >= int(team["team_size"]):
                raise HTTPException(403, f"This team has reached its registered device limit ({team['team_size']}). Contact the organizer if a device needs replacement.")
            c.execute("INSERT INTO participants(team_id,device_id,created_at) VALUES(?,?,?)", (team["id"], device_id, now()))
        state = get_game_state(c)
        progress = get_progress(c, int(team["id"]), state)
        session_token, csrf_token = issue_participant_session(int(team["id"]), device_id)
        response.set_cookie(
            PARTICIPANT_COOKIE, session_token, max_age=PARTICIPANT_SESSION_SECONDS,
            httponly=True, secure=SECURE_COOKIES, samesite="strict", path="/",
        )
        return {
            "team": {"id": int(team["id"]), "name": team["name"], "colour": team["colour"], "team_size": int(team["team_size"])},
            "status": state["status"],
            "eliminated": bool(team["eliminated"]),
            "eliminated_reason": team["eliminated_reason"],
            "progress": progress,
            "csrf_token": csrf_token,
        }


@app.get("/api/team/session")
def restore_participant_session(request: Request):
    with connect() as c:
        team, _ = resolve_participant(request, c)
        state = get_game_state(c)
        return {
            "team": {"id": int(team["id"]), "name": team["name"], "colour": team["colour"], "team_size": int(team["team_size"])},
            "status": state["status"], "eliminated": bool(team["eliminated"]),
            "eliminated_reason": team["eliminated_reason"],
            "progress": get_progress(c, int(team["id"]), state),
            "csrf_token": PARTICIPANT_SESSIONS[hashlib.sha256(request.cookies[PARTICIPANT_COOKIE].encode()).hexdigest()]["csrf"],
        }


@app.get("/api/team/current")
def team_current(request: Request, x_team_code: Optional[str] = Header(default=None), x_device_id: Optional[str] = Header(default=None)):
    with connect() as c:
        team, _ = resolve_participant(request, c, code=x_team_code, device_id=x_device_id)
        state = get_game_state(c)
        progress = get_progress(c, int(team["id"]), state)
        return {
            "team": {"id": int(team["id"]), "name": team["name"], "colour": team["colour"], "team_size": int(team["team_size"])},
            "status": state["status"],
            "eliminated": bool(team["eliminated"]),
            "eliminated_reason": team["eliminated_reason"],
            "progress": progress,
        }


@app.post("/api/submit")
def submit_envelope(data: EnvelopeSubmission, request: Request):
    with connect() as c:
        # A verification code must complete a level once only, even on repeated concurrent submits.
        c.execute("BEGIN IMMEDIATE")
        team, _ = resolve_participant(request, c, code=data.code, device_id=data.device_id, require_csrf=True)
        if team["eliminated"]:
            raise HTTPException(403, "Team eliminated. Contact the organizer.")
        state = get_game_state(c)
        if state["status"] != "active":
            raise HTTPException(403, "The game is not active. Wait for organizer instructions.")
        team_id = int(team["id"])
        progress = get_progress(c, team_id, state)
        if progress["completed"]:
            raise HTTPException(409, "All four levels are complete. Return to Rooms 7 & 8 with your final envelope.")
        if progress["current_level_timed_out"]:
            raise HTTPException(403, "Your time limit for this level has expired. Contact the organizer.")
        level = int(progress["current_level"])
        row = c.execute("SELECT * FROM team_levels WHERE team_id=? AND level=?", (team_id, level)).fetchone()
        if not row or not row["envelope_code_hash"]:
            raise HTTPException(409, "The organizer has not configured this team's envelope code yet.")
        submit_key = f"envelope_submit_{team_id}"
        if not rate_limiter.is_allowed(submit_key, max_requests=20, window_seconds=60):
            raise HTTPException(429, "Too many code attempts. Pause and check the code on your envelope.")
        correct = verify_secret_code(data.envelope_code, row["envelope_code_hash"])
        if not correct:
            log(c, team_id, "envelope_code_incorrect", f"Incorrect verification code attempt at level {level}")
            return {"correct": False, "message": "That envelope code is not correct for your team's current level. Check the envelope and try again.", "progress": progress}

        if not row["envelope_code_hash"].startswith("pbkdf2_sha256$"):
            c.execute("UPDATE team_levels SET envelope_code_hash=?,envelope_code_lookup_hash=? WHERE id=?", (hash_secret_code(data.envelope_code), code_lookup_hash(data.envelope_code), row["id"]))
        elif row["envelope_code_lookup_hash"] != code_lookup_hash(data.envelope_code):
            c.execute("UPDATE team_levels SET envelope_code_lookup_hash=? WHERE id=?", (code_lookup_hash(data.envelope_code), row["id"]))

        stamp = now()
        elapsed = int(row["elapsed_seconds"] or 0)
        if row["started_at"] and state["status"] == "active":
            elapsed += max(0, int((datetime.now(timezone.utc) - parse_time(row["started_at"])).total_seconds()))
        c.execute("UPDATE team_levels SET completed_at=?, started_at=NULL, elapsed_seconds=?, updated_at=? WHERE id=?", (stamp, elapsed, stamp, row["id"]))
        next_level = level + 1
        if next_level <= 4 and state["status"] == "active":
            next_row = c.execute("SELECT id FROM team_levels WHERE team_id=? AND level=?", (team_id, next_level)).fetchone()
            if next_row:
                c.execute("UPDATE team_levels SET started_at=?, elapsed_seconds=0, updated_at=? WHERE team_id=? AND level=?", (stamp, stamp, team_id, next_level))
        log(c, team_id, "level_completed", f"Envelope code verified; level {level} completed. Physical station marker {row['station_id']} is organizer-only.")
        new_progress = get_progress(c, team_id, state)
        message = "Level verified. Follow the next physical riddle in your envelope." if level < 4 else "All four levels verified. Return to Rooms 7 & 8 with your final envelope. A physical volunteer confirms the official finish order."
        return {"correct": True, "message": message, "progress": new_progress}


@app.post("/api/violation")
def violation(data: Violation, request: Request):
    """Record supported participant violations; the backend owns elimination state."""
    allowed_kinds = {"fullscreen_exit", "back_navigation", "logout_attempt"}
    if data.kind not in allowed_kinds:
        raise HTTPException(400, "Unsupported violation type.")
    with connect() as c:
        # Serialize browser-violation escalation so two simultaneous Back events cannot both get warning 1.
        c.execute("BEGIN IMMEDIATE")
        team, _ = resolve_participant(request, c, code=data.code, device_id=data.device_id, require_csrf=True)
        team_id = int(team["id"])
        if team["eliminated"]:
            return {"warning": False, "eliminated": True, "message": "Team is already eliminated."}
        state = get_game_state(c)

        # Fullscreen exit and logout attempts trigger elimination after authentication,
        # including during the pre-game waiting state. Browser Back is a gameplay rule.
        if data.kind in {"fullscreen_exit", "logout_attempt"}:
            reason = "Exited required fullscreen mode" if data.kind == "fullscreen_exit" else "Attempted to leave the participant session"
            c.execute("UPDATE teams SET eliminated=1, eliminated_reason=? WHERE id=?", (reason, team_id))
            log(c, team_id, "team_eliminated", f"{reason}; organizer approval is required to reinstate the team.")
            return {"warning": False, "eliminated": True, "message": f"{reason}. Your team has been eliminated; contact the organizer."}

        if state["status"] != "active":
            return {"warning": False, "eliminated": False, "message": "Browser Back is enforced during active gameplay."}
        game_started_at = state.get("started_at") or ""
        warnings = c.execute(
            "SELECT COUNT(*) FROM events WHERE team_id=? AND kind='back_navigation_warning' AND created_at>=?",
            (team_id, game_started_at),
        ).fetchone()[0]
        if warnings == 0:
            log(c, team_id, "back_navigation_warning", "First browser Back attempt: warning issued.")
            return {"warning": True, "eliminated": False, "message": "Warning 1 of 1: do not use the browser Back button again. The next detected attempt eliminates your team."}
        c.execute("UPDATE teams SET eliminated=1, eliminated_reason=? WHERE id=?", ("Repeated browser Back navigation", team_id))
        log(c, team_id, "team_eliminated", "Second browser Back attempt; elimination policy applied.")
        return {"warning": False, "eliminated": True, "message": "Second browser Back attempt detected. Your team has been eliminated."}


def current_level_station_map(c: sqlite3.Connection, team_id: int) -> dict[int, dict]:
    return {int(row["level"]): dict(row) for row in c.execute("SELECT * FROM team_levels WHERE team_id=? ORDER BY level", (team_id,)).fetchall()}


def team_overview(c: sqlite3.Connection, team: sqlite3.Row, state: dict) -> dict:
    team_id = int(team["id"])
    progress = get_progress(c, team_id, state)
    levels = current_level_station_map(c, team_id)
    p_count = c.execute("SELECT COUNT(*) FROM participants WHERE team_id=?", (team_id,)).fetchone()[0]
    configured = sum(1 for level in range(1, 5) if levels.get(level) and levels[level].get("envelope_code_hash") and levels[level].get("riddle_notes"))
    return {
        "id": team_id,
        "name": team["name"],
        "colour": team["colour"],
        "team_size": int(team["team_size"]),
        "eliminated": bool(team["eliminated"]),
        "eliminated_reason": team["eliminated_reason"],
        "created_at": team["created_at"],
        "participant_count": p_count,
        "completed_levels": progress["completed_levels"],
        "total_levels": 4,
        "current_level": progress["current_level"],
        "current_level_remaining_seconds": progress["current_level_remaining_seconds"],
        "current_level_timed_out": progress["current_level_timed_out"],
        "completed": progress["completed"],
        "route_configured_count": configured,
        "route": [
            {
                "level": level,
                "station_id": levels[level]["station_id"],
                "riddle_notes": levels[level]["riddle_notes"],
                "configured": bool(levels[level]["envelope_code_hash"]),
                "completed": bool(levels[level]["completed_at"]),
                "updated_at": levels[level]["updated_at"],
                "puzzle_type": LEVELS[level]["puzzle_type"],
            }
            for level in sorted(levels)
        ],
    }


@app.get("/api/admin/overview")
def admin_overview(request: Request):
    require_admin(request)
    with connect() as c:
        state = get_game_state(c)
        teams = [team_overview(c, team, state) for team in c.execute("SELECT * FROM teams ORDER BY id", ).fetchall()]
        events = [dict(row) for row in c.execute(
            "SELECT e.id, t.name AS team, e.kind, e.details, e.created_at FROM events e LEFT JOIN teams t ON t.id=e.team_id ORDER BY e.id DESC LIMIT 150"
        ).fetchall()]
        levels = get_level_settings(c)
        return {
            "config": public_config(c),
            "game_state": public_state(c),
            "teams": teams,
            "level_settings": levels,
            "events": events,
        }


@app.get("/api/admin/csv-template/{kind}")
def csv_template(kind: str, request: Request):
    require_admin(request)
    if kind == "teams":
        headers = TEAM_CSV_HEADERS
        sample = ["Example Team", "red", "4", "ReplaceWithPrivateCode123"]
        comment = "# Replace or remove the example. Keep access codes private.\n"
    elif kind == "routes":
        headers = ROUTE_CSV_HEADERS
        sample = ["Example Team", "red"] + [value for level in range(1,5) for value in ("ABCD"[level-1], f"ExampleLevel{level}Code123", "Example organizer note")]
        comment = "# Replace or remove the example. Stations accept only A, B, C or D. Keep original codes privately for envelope preparation.\n"
    else:
        raise HTTPException(404, "Unknown CSV template.")
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerow(sample)
    text = "\ufeff" + comment + output.getvalue()
    return Response(text, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename=signal-hunt-{kind}-template.csv"})


@app.post("/api/admin/teams/import/preview")
async def preview_team_import(request: Request):
    require_admin(request)
    rows = normalize_team_csv_rows(parse_csv_upload(await uploaded_csv(request), TEAM_CSV_HEADERS))
    with connect() as c:
        existing = c.execute("SELECT name,colour,code_lookup_hash FROM teams").fetchall()
        names = {row["name"].casefold() for row in existing}
        colours = {row["colour"] for row in existing}
        codes = {row["code_lookup_hash"] for row in existing}
        seen_names, seen_colours, seen_codes = set(), set(), set()
        if len(existing) + len(rows) > MAX_TEAMS:
            raise HTTPException(422, f"Import exceeds this event's {MAX_TEAMS}-team limit.")
        preview = []
        for line, row in enumerate(rows, start=rows.first_data_line):
            name = " ".join(row["team_name"].split())
            colour = row["team_colour"].lower()
            code = code_normalize(row["team_access_code"])
            try: size = int(row["member_count"])
            except ValueError: raise HTTPException(422, f"CSV row {line}: member_count must be an integer from 3 to 5.")
            if len(name) < 2 or len(name) > 60: raise HTTPException(422, f"CSV row {line}: team name must be 2–60 characters.")
            if colour not in {item["id"] for item in TEAM_PALETTE}: raise HTTPException(422, f"CSV row {line}: invalid team_colour.")
            if size not in range(3, 6): raise HTTPException(422, f"CSV row {line}: member_count must be 3–5.")
            if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{7,31}", code): raise HTTPException(422, f"CSV row {line}: team access code must be 8–32 allowed characters.")
            lookup = code_lookup_hash(code)
            if name.casefold() in names or name.casefold() in seen_names: raise HTTPException(409, f"CSV row {line}: team name conflicts with an existing or imported team.")
            if colour in colours or colour in seen_colours: raise HTTPException(409, f"CSV row {line}: team colour conflicts with an existing or imported team.")
            if lookup in codes or lookup in seen_codes or code_exists(c, code): raise HTTPException(409, f"CSV row {line}: team access code conflicts with an existing code; choose a new code.")
            seen_names.add(name.casefold()); seen_colours.add(colour); seen_codes.add(lookup)
            preview.append({"team_name": name, "team_colour": colour, "member_count": size})
    return {"preview": preview}


@app.post("/api/admin/teams/import/confirm")
async def confirm_team_import(request: Request):
    require_admin(request)
    rows = normalize_team_csv_rows(parse_csv_upload(await uploaded_csv(request), TEAM_CSV_HEADERS))
    # Revalidate inside the same transaction as writes to prevent partial or stale imports.
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        require_game_waiting_or_finished(c)
        existing_count = c.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
        if existing_count + len(rows) > MAX_TEAMS: raise HTTPException(409, "Import exceeds available team slots.")
        names, colours, codes = set(), set(), set()
        prepared = []
        for line, row in enumerate(rows, start=rows.first_data_line):
            name = " ".join(row["team_name"].split()); colour = row["team_colour"].lower(); code = code_normalize(row["team_access_code"])
            try: size = int(row["member_count"])
            except ValueError: raise HTTPException(422, f"CSV row {line}: member_count must be an integer from 3 to 5.")
            if len(name) < 2 or len(name) > 60 or colour not in {item["id"] for item in TEAM_PALETTE} or size not in range(3,6) or not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{7,31}", code): raise HTTPException(422, f"CSV row {line}: invalid team record.")
            lookup = code_lookup_hash(code)
            if name.casefold() in names or colour in colours or lookup in codes or c.execute("SELECT 1 FROM teams WHERE name=? COLLATE NOCASE OR colour=? OR code_lookup_hash=?", (name, colour, lookup)).fetchone() or code_exists(c, code): raise HTTPException(409, f"CSV row {line}: name, colour or access code conflicts with existing data.")
            names.add(name.casefold()); colours.add(colour); codes.add(lookup); prepared.append((name, colour, size, code, lookup))
        for name, colour, size, code, lookup in prepared:
            c.execute("INSERT INTO teams(name,colour,team_size,code_hash,code_lookup_hash,created_at) VALUES(?,?,?,?,?,?)", (name, colour, size, hash_secret_code(code), lookup, now()))
        log(c, None, "teams_csv_imported", f"Imported {len(prepared)} teams.")
    return {"imported": len(rows)}


def validate_route_matrix(rows: list[dict[str, str]], c: sqlite3.Connection) -> list[tuple[int, int, str, str, str]]:
    teams = {row["name"].casefold(): row for row in c.execute("SELECT id,name,colour FROM teams")}
    if len(teams) < 4 or len(rows) != len(teams): raise HTTPException(422, "Route CSV must contain exactly one row for every active team (at least four teams are required).")
    prepared, seen_teams, seen_codes = [], set(), set()
    for line, row in enumerate(rows, start=rows.first_data_line):
        name = " ".join(row["team_name"].split()); key = name.casefold()
        team = teams.get(key)
        if not team: raise HTTPException(422, f"CSV row {line}: unknown team name.")
        if key in seen_teams: raise HTTPException(422, f"CSV row {line}: duplicate team route row.")
        if row["team_colour"].lower() != team["colour"]: raise HTTPException(422, f"CSV row {line}: team colour does not match {team['name']}.")
        seen_teams.add(key)
        stations = []
        for level in range(1,5):
            station = row[f"level_{level}_station"].upper()
            code = code_normalize(row[f"level_{level}_envelope_code"])
            notes = row[f"level_{level}_organizer_note"].strip()
            if station not in STATIONS: raise HTTPException(422, f"CSV row {line}: level {level} station must be A, B, C or D.")
            if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{7,31}", code): raise HTTPException(422, f"CSV row {line}: level {level} envelope code must be 8–32 allowed characters.")
            if not notes or len(notes) > 4000: raise HTTPException(422, f"CSV row {line}: level {level} organizer note is required (max 4000 characters).")
            lookup = code_lookup_hash(code)
            current = c.execute("SELECT envelope_code_hash FROM team_levels WHERE team_id=? AND level=?", (team["id"], level)).fetchone()
            replacing_same = bool(current and verify_secret_code(code, current["envelope_code_hash"]))
            if lookup in seen_codes or (code_exists(c, code) and not replacing_same): raise HTTPException(409, f"CSV row {line}: level {level} envelope code conflicts with another code.")
            seen_codes.add(lookup); stations.append(station)
            prepared.append((team["id"], level, station, code, notes))
        if len(set(stations)) != 4: raise HTTPException(422, f"CSV row {line}: assign A, B, C and D once each.")
    return prepared


@app.post("/api/admin/routes/import/preview")
async def preview_routes(request: Request):
    require_admin(request)
    rows = validate_csv_rows(parse_csv_upload(await uploaded_csv(request), ROUTE_CSV_HEADERS), ROUTE_CSV_HEADERS)
    with connect() as c:
        prepared = validate_route_matrix(rows, c)
        return {"preview": [{"team_name": c.execute("SELECT name FROM teams WHERE id=?", (team_id,)).fetchone()[0], "level": level, "station": station, "organizer_note": notes} for team_id, level, station, code, notes in prepared], "replaces_existing": bool(c.execute("SELECT COUNT(*) FROM team_levels").fetchone()[0])}


@app.post("/api/admin/routes/import/confirm")
async def confirm_routes(request: Request, replace_existing: bool = Query(default=False)):
    require_admin(request)
    rows = validate_csv_rows(parse_csv_upload(await uploaded_csv(request), ROUTE_CSV_HEADERS), ROUTE_CSV_HEADERS)
    with connect() as c:
        require_game_waiting_or_finished(c)
        c.execute("BEGIN IMMEDIATE")
        prepared = validate_route_matrix(rows, c)
        existing = c.execute("SELECT COUNT(*) FROM team_levels").fetchone()[0]
        if existing and not replace_existing: raise HTTPException(409, "Saved routes exist. Explicitly confirm replacement to continue.")
        if existing:
            c.execute("DELETE FROM team_levels")
        for team_id, level, station, code, notes in prepared:
            c.execute("INSERT INTO team_levels(team_id,level,station_id,riddle_notes,envelope_code_hash,envelope_code_lookup_hash,updated_at) VALUES(?,?,?,?,?,?,?)", (team_id, level, station, notes, hash_secret_code(code), code_lookup_hash(code), now()))
        log(c, None, "routes_csv_imported", f"Imported {len(prepared)} route records; replace={bool(existing)}.")
    return {"imported": len(prepared)}


@app.get("/api/admin/routes/export")
def export_routes(request: Request):
    require_admin(request)
    with connect() as c:
        teams = c.execute("SELECT id,name,colour FROM teams ORDER BY id").fetchall()
        output = io.StringIO(newline=""); writer = csv.writer(output); writer.writerow(ROUTE_CSV_HEADERS)
        for team in teams:
            levels = {int(row["level"]): row for row in c.execute("SELECT * FROM team_levels WHERE team_id=?", (team["id"],)).fetchall()}
            values = [spreadsheet_safe(team["name"]), team["colour"]]
            for level in range(1,5):
                row = levels.get(level)
                values.extend([row["station_id"], "", spreadsheet_safe(row["riddle_notes"])] if row else ["", "", ""])
            writer.writerow(values)
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=signal-hunt-route-matrix.csv"})


@app.post("/api/admin/routes/random/preview")
def random_routes_preview(request: Request):
    require_admin(request)
    with connect() as c:
        teams = c.execute("SELECT id,name FROM teams ORDER BY id").fetchall()
        if len(teams) < 4 or len(teams) > 10: raise HTTPException(409, "Create 4–10 teams before generating routes.")
        rng = secrets.SystemRandom()
        base = rng.sample(["A", "B", "C", "D"], 4)
        offsets = list(range(4)) * (len(teams) // 4) + rng.sample(list(range(4)), len(teams) % 4)
        rng.shuffle(offsets)
        assignments = {}
        # Cyclic shifts of one permutation form a Latin square: every block of four
        # teams is balanced at every level, and a partial block differs by at most one.
        for team, offset in zip(rng.sample(list(teams), len(teams)), offsets):
            assignments[team["id"]] = [base[(level + offset) % 4] for level in range(4)]
        return {"preview": [{"team_id": team["id"], "team_name": team["name"], "stations": assignments[team["id"]]} for team in teams]}


def spreadsheet_safe(value: str) -> str:
    text = str(value or "")
    probe = text.lstrip(" \t\r\n")
    if text.startswith(("\t", "\r")) or probe.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


class RandomRouteAssignment(BaseModel):
    team_id: int = Field(ge=1)
    stations: list[str] = Field(min_length=4, max_length=4)

    @field_validator("stations")
    @classmethod
    def validate_stations(cls, values: list[str]) -> list[str]:
        if len(set(values)) != 4 or set(values) != STATIONS:
            raise ValueError("Each route must contain A, B, C and D exactly once.")
        return values


class RandomRoutesConfirm(BaseModel):
    assignments: list[RandomRouteAssignment]


@app.post("/api/admin/routes/random/confirm")
def random_routes_confirm(data: RandomRoutesConfirm, request: Request):
    require_admin(request)
    with connect() as c:
        require_game_waiting_or_finished(c)
        teams = c.execute("SELECT id,name FROM teams ORDER BY id").fetchall()
        if len(teams) < 4 or len(teams) > 10: raise HTTPException(409, "Create 4–10 teams before saving routes.")
        if len(data.assignments) != len(teams) or {item.team_id for item in data.assignments} != {team["id"] for team in teams}: raise HTTPException(422, "Preview does not match the current team list.")
        for level in range(4):
            counts = [sum(item.stations[level] == station for item in data.assignments) for station in STATIONS]
            if max(counts) - min(counts) > 1: raise HTTPException(422, "Station counts must be balanced at each level.")
        missing = c.execute("SELECT COUNT(*) FROM teams t WHERE (SELECT COUNT(*) FROM team_levels l WHERE l.team_id=t.id)<>4").fetchone()[0]
        if missing: raise HTTPException(409, "Configure every team's four route records before randomizing stations; this operation preserves existing codes and notes.")
        c.execute("BEGIN IMMEDIATE")
        for item in data.assignments:
            for level, station in enumerate(item.stations, start=1):
                row = c.execute("SELECT id FROM team_levels WHERE team_id=? AND level=?", (item.team_id, level)).fetchone()
                if row: c.execute("UPDATE team_levels SET station_id=?,updated_at=? WHERE id=?", (station, now(), row["id"]))
        log(c, None, "routes_randomized", "Balanced A/B/C/D station assignments saved; envelope codes and notes preserved.")
    return {"saved": True}


@app.get("/api/admin/events")
def admin_events(request: Request, limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0), team_id: Optional[int] = Query(default=None, ge=1), kind: Optional[str] = Query(default=None, max_length=50)):
    require_admin(request)
    where = []
    params: list = []
    if team_id is not None:
        where.append("e.team_id=?")
        params.append(team_id)
    if kind and kind.strip():
        where.append("e.kind LIKE ? ESCAPE '\\'")
        params.append("%" + kind.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    with connect() as c:
        total = c.execute("SELECT COUNT(*) FROM events e" + clause, params).fetchone()[0]
        rows = [dict(row) for row in c.execute(
            "SELECT e.id,t.name AS team,e.kind,e.details,e.created_at FROM events e LEFT JOIN teams t ON t.id=e.team_id" + clause + " ORDER BY e.id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()]
    return {"events": rows, "total": total, "limit": limit, "offset": offset, "has_more": offset + len(rows) < total}


@app.put("/api/admin/teams/{team_id}/levels/{level}")
def configure_team_level(team_id: int, level: int, data: TeamLevelConfig, request: Request):
    require_admin(request)
    if level not in LEVELS:
        raise HTTPException(400, "Level must be between 1 and 4.")
    with connect() as c:
        require_game_waiting_or_finished(c)
        team = c.execute("SELECT id FROM teams WHERE id=?", (team_id,)).fetchone()
        if not team:
            raise HTTPException(404, "Team not found.")
        current = c.execute("SELECT * FROM team_levels WHERE team_id=? AND level=?", (team_id, level)).fetchone()
        other_station = c.execute("SELECT level FROM team_levels WHERE team_id=? AND station_id=? AND level<>?", (team_id, data.station_id, level)).fetchone()
        if other_station:
            raise HTTPException(409, f"Station marker {data.station_id} is already assigned to this team's level {other_station['level']}.")

        existing_hash = current["envelope_code_hash"] if current else None
        supplied_hash = hash_secret_code(data.envelope_code) if data.envelope_code else existing_hash
        if not supplied_hash:
            raise HTTPException(400, "Enter a unique envelope verification code for this team and level.")
        if data.envelope_code:
            if code_exists(c, data.envelope_code, exclude_level=(team_id, level)):
                raise HTTPException(409, "This envelope code matches a team login code. Choose a different code.")
        if current:
            lookup = code_lookup_hash(data.envelope_code) if data.envelope_code else current["envelope_code_lookup_hash"]
            c.execute("UPDATE team_levels SET station_id=?,riddle_notes=?,envelope_code_hash=?,envelope_code_lookup_hash=?,updated_at=? WHERE id=?", (data.station_id, data.riddle_notes, supplied_hash, lookup, now(), current["id"]))
        else:
            c.execute("INSERT INTO team_levels(team_id,level,station_id,riddle_notes,envelope_code_hash,envelope_code_lookup_hash,updated_at) VALUES(?,?,?,?,?,?,?)", (team_id, level, data.station_id, data.riddle_notes, supplied_hash, code_lookup_hash(data.envelope_code), now()))
        puzzle_type = LEVELS[level]["puzzle_type"]
        log(c, team_id, "team_level_configured", f"Configured level {level} ({puzzle_type}) at organizer station {data.station_id}.")
        return {"message": f"Level {level} saved. Keep the entered envelope code for printing; it cannot be recovered from the database.", "team_id": team_id, "level": level, "station_id": data.station_id, "puzzle_type": puzzle_type}


@app.put("/api/admin/level-settings/{level}")
def update_level_settings(level: int, data: LevelSettingUpdate, request: Request):
    require_admin(request)
    if level not in LEVELS:
        raise HTTPException(400, "Level must be between 1 and 4.")
    with connect() as c:
        state = get_game_state(c)
        if state["status"] == "paused":
            # Adjusting limits while paused is safe; the accumulated elapsed time is retained.
            pass
        c.execute("UPDATE level_settings SET duration_minutes=? WHERE level=?", (data.duration_minutes, level))
        log(c, None, "level_timer_updated", f"Level {level} time limit set to {data.duration_minutes} minutes.")
        return {"level": level, "puzzle_type": LEVELS[level]["puzzle_type"], "duration_minutes": data.duration_minutes}


def freeze_active_level_timers(c: sqlite3.Connection) -> None:
    stamp = now()
    rows = c.execute("SELECT id,elapsed_seconds,started_at FROM team_levels WHERE completed_at IS NULL AND started_at IS NOT NULL").fetchall()
    for row in rows:
        elapsed = int(row["elapsed_seconds"] or 0) + max(0, int((datetime.now(timezone.utc) - parse_time(row["started_at"])).total_seconds()))
        c.execute("UPDATE team_levels SET elapsed_seconds=?,started_at=NULL,updated_at=? WHERE id=?", (elapsed, stamp, row["id"]))


def resume_current_level_timers(c: sqlite3.Connection) -> None:
    stamp = now()
    teams = c.execute("SELECT id FROM teams").fetchall()
    state = get_game_state(c)
    for team in teams:
        progress = get_progress(c, int(team["id"]), state)
        if progress["completed"]:
            continue
        current = c.execute("SELECT id,completed_at,started_at FROM team_levels WHERE team_id=? AND level=?", (team["id"], progress["current_level"])).fetchone()
        if current and current["completed_at"] is None and current["started_at"] is None:
            c.execute("UPDATE team_levels SET started_at=?,updated_at=? WHERE id=?", (stamp, stamp, current["id"]))


@app.post("/api/admin/game/start")
def start_game(request: Request):
    require_admin(request)
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        state = get_game_state(c)
        if state["status"] != "waiting":
            raise HTTPException(409, "Re-arm the event before starting a new run.")
        teams = c.execute("SELECT id FROM teams ORDER BY id").fetchall()
        if len(teams) < 4:
            raise HTTPException(409, "At least four teams must be registered before the game can start.")
        if len(teams) > MAX_TEAMS:
            raise HTTPException(409, f"This event supports at most {MAX_TEAMS} teams.")
        missing = []
        for team in teams:
            rows = c.execute("SELECT level,station_id,riddle_notes,envelope_code_hash FROM team_levels WHERE team_id=? ORDER BY level", (team["id"],)).fetchall()
            by_level = {int(row["level"]): row for row in rows}
            for level in range(1, 5):
                row = by_level.get(level)
                if not row or not row["envelope_code_hash"] or not row["riddle_notes"].strip():
                    missing.append(f"Team {team['id']} Level {level}")
            if len({row["station_id"] for row in rows}) != len(rows) or (len(rows) == 4 and {row["station_id"] for row in rows} != STATIONS):
                missing.append(f"Team {team['id']} must use A, B, C and D once each")
        if missing:
            preview = "; ".join(missing[:8])
            suffix = "…" if len(missing) > 8 else ""
            raise HTTPException(409, "Finish route and envelope setup before starting: " + preview + suffix)
        stamp = now()
        c.execute("UPDATE team_levels SET elapsed_seconds=0,started_at=NULL,completed_at=NULL,updated_at=?", (stamp,))
        c.execute("UPDATE teams SET eliminated=0,eliminated_reason=''")
        c.execute("UPDATE game_state SET status='active',started_at=?,paused_at=NULL WHERE id=1", (stamp,))
        c.execute("UPDATE team_levels SET started_at=?,updated_at=? WHERE level=1", (stamp, stamp))
        log(c, None, "game_started", f"Game started with {len(teams)} teams. Level times are managed independently.")
        return public_state(c)


@app.post("/api/admin/game/pause")
def pause_game(request: Request):
    require_admin(request)
    with connect() as c:
        state = get_game_state(c)
        if state["status"] != "active":
            raise HTTPException(409, "Only an active game can be paused.")
        freeze_active_level_timers(c)
        c.execute("UPDATE game_state SET status='paused',paused_at=? WHERE id=1", (now(),))
        log(c, None, "game_paused", "Organizer paused gameplay; team level timers are frozen.")
        return public_state(c)


@app.post("/api/admin/game/resume")
def resume_game(request: Request):
    require_admin(request)
    with connect() as c:
        if get_game_state(c)["status"] != "paused":
            raise HTTPException(409, "Only a paused game can be resumed.")
        c.execute("UPDATE game_state SET status='active',paused_at=NULL,started_at=COALESCE(started_at,?) WHERE id=1", (now(),))
        resume_current_level_timers(c)
        log(c, None, "game_resumed", "Organizer resumed gameplay; existing level time was retained.")
        return public_state(c)


@app.post("/api/admin/game/finish")
def finish_game(request: Request):
    require_admin(request)
    with connect() as c:
        if get_game_state(c)["status"] == "active":
            freeze_active_level_timers(c)
        c.execute("UPDATE game_state SET status='finished',paused_at=NULL WHERE id=1")
        log(c, None, "game_finished", "Organizer finished the game. Physical volunteers determine official finish order.")
        return public_state(c)


@app.post("/api/admin/game/reset")
def reset_game(data: GameReset, request: Request):
    require_admin(request)
    if data.confirm != "RESET_SIGNAL_HUNT":
        raise HTTPException(400, "Type RESET_SIGNAL_HUNT exactly to confirm.")
    with connect() as c:
        c.execute("UPDATE game_state SET status='waiting',started_at=NULL,paused_at=NULL WHERE id=1")
        c.execute("UPDATE team_levels SET elapsed_seconds=0,started_at=NULL,completed_at=NULL,updated_at=?", (now(),))
        c.execute("UPDATE teams SET eliminated=0,eliminated_reason=''")
        if data.clear_participants:
            c.execute("DELETE FROM participants")
        log(c, None, "game_reset", "Progress, timers and elimination states reset. Teams, codes, routes and manual riddle notes preserved.")
        return public_state(c)


@app.post("/api/admin/event/reset")
def reset_event_setup(data: EventReset, request: Request):
    require_admin(request)
    if data.confirm != "RESET EVENT":
        raise HTTPException(400, "Type RESET EVENT exactly to confirm.")
    source_path = get_db_path()
    backup_directory = Path(os.getenv("BACKUP_DIRECTORY", str(source_path.parent / "backups"))).expanduser().resolve()
    frontend_root = FRONTEND.resolve()
    if backup_directory == frontend_root or frontend_root in backup_directory.parents:
        raise HTTPException(500, "Backup directory must be outside the publicly served Frontend folder.")
    with connect() as c:
        if get_game_state(c)["status"] in {"active", "paused"}:
            raise HTTPException(409, "Finish or re-arm the game before resetting event setup.")
    backup_directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_directory / ("signal-hunt-event-" + stamp + "-" + secrets.token_hex(3) + ".db")
    key_path = Path(str(source_path) + ".lookup-key")
    backup_key_path = Path(str(backup_path) + ".lookup-key")
    try:
        with sqlite3.connect(source_path, timeout=20) as source, sqlite3.connect(backup_path) as target:
            source.backup(target)
            integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
            fingerprint = target.execute("SELECT value FROM private_meta WHERE key='lookup_key_fingerprint'").fetchone()
            if integrity != "ok" or not fingerprint:
                raise RuntimeError("Backup integrity or database key metadata check failed.")
        if not key_path.is_file():
            raise RuntimeError("The database lookup key is missing; event data was not reset.")
        shutil.copy2(key_path, backup_key_path)
        if hashlib.sha256(key_path.read_bytes()).digest() != hashlib.sha256(backup_key_path.read_bytes()).digest():
            raise RuntimeError("Backup key verification failed; event data was not reset.")
        with connect() as c:
            c.execute("BEGIN IMMEDIATE")
            if get_game_state(c)["status"] in {"active", "paused"}:
                raise HTTPException(409, "The game became active; event setup was not reset.")
            c.execute("DELETE FROM participants")
            c.execute("DELETE FROM team_levels")
            c.execute("DELETE FROM teams")
            c.execute("DELETE FROM events")
            c.execute("UPDATE game_state SET status='waiting',started_at=NULL,paused_at=NULL,remaining_seconds=0 WHERE id=1")
            for level, spec in LEVELS.items():
                c.execute("UPDATE level_settings SET puzzle_type=?,duration_minutes=? WHERE level=?", (spec["puzzle_type"], spec["default_minutes"], level))
        PARTICIPANT_SESSIONS.clear()
        VERIFIED_CODE_CACHE.clear()
    except Exception:
        for path in (backup_path, backup_key_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    return {"message": "Event setup was reset. A verified recovery backup was saved outside Frontend.", "backup_file": backup_path.name}


@app.post("/api/admin/team/{team_id}/reinstate")
def reinstate_team(team_id: int, request: Request):
    require_admin(request)
    with connect() as c:
        team = c.execute("SELECT id FROM teams WHERE id=?", (team_id,)).fetchone()
        if not team:
            raise HTTPException(404, "Team not found.")
        c.execute("UPDATE teams SET eliminated=0,eliminated_reason='' WHERE id=?", (team_id,))
        log(c, team_id, "team_reinstated", "Organizer reinstated the team. Elapsed level time was not reset.")
        return {"message": "Team reinstated. Its existing level timer was preserved."}


@app.get("/health")
def health():
    return {"status": "ok"}

