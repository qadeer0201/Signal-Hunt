import os, sqlite3, secrets, hashlib, hmac, time
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).parent
candidates = [
    Path(os.getenv("FRONTEND_DIR", "")),
    BASE.parent.parent / "frontend",
    BASE.parent / "frontend",
    Path.home() / "Downloads" / "Signal-Hunt" / "frontend"
]
FRONTEND = next((p for p in candidates if p and p.exists()), Path.home() / "Downloads" / "Signal-Hunt" / "frontend")
GAME_DURATION_SECONDS = 2 * 60 * 60  # 120 minutes

def get_db_path() -> Path:
    return Path(os.getenv('DATABASE_PATH', str(BASE.parent / 'signalhunt.db')))

def get_admin_password() -> str:
    return os.getenv('ADMIN_PASSWORD', 'ISLIEEEECELL')

# Fail-safe security check for production
STRICT_SECURITY = os.getenv('STRICT_SECURITY', '0') == '1'
if STRICT_SECURITY and (not get_admin_password() or get_admin_password() == 'change-this-before-deploying'):
    raise RuntimeError("CRITICAL SECURITY: ADMIN_PASSWORD must be configured with a secure secret in production.")

app = FastAPI(title='Signal Hunt API', version='2.0.0')

# Static files mounts
if (BASE / 'static').is_dir():
    app.mount('/static', StaticFiles(directory=BASE / 'static'), name='static')
if (FRONTEND / 'styles').is_dir():
    app.mount('/styles', StaticFiles(directory=FRONTEND / 'styles'), name='frontend-styles')
if (FRONTEND / 'js').is_dir():
    app.mount('/js', StaticFiles(directory=FRONTEND / 'js'), name='frontend-js')
if (FRONTEND / 'assets').is_dir():
    app.mount('/assets', StaticFiles(directory=FRONTEND / 'assets'), name='frontend-assets')


# ---------------------------------------------------------------------------
# Rate Limiting (In-Memory Sliding Window)
# ---------------------------------------------------------------------------
class RateLimiter:
    def __init__(self):
        self.history = defaultdict(list)

    def check(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now_ts = time.time()
        cutoff = now_ts - window_seconds
        records = [ts for ts in self.history[key] if ts > cutoff]
        self.history[key] = records
        return len(records) < max_requests

    def record(self, key: str):
        self.history[key].append(time.time())

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now_ts = time.time()
        cutoff = now_ts - window_seconds
        records = [ts for ts in self.history[key] if ts > cutoff]
        if len(records) >= max_requests:
            self.history[key] = records
            return False
        records.append(now_ts)
        self.history[key] = records
        return True

    def reset(self):
        self.history.clear()

rate_limiter = RateLimiter()


# ---------------------------------------------------------------------------
# Database Utilities & Schema Management
# ---------------------------------------------------------------------------
def connect():
    c = sqlite3.connect(get_db_path(), timeout=20, check_same_thread=False)
    c.execute("PRAGMA journal_mode=WAL;")
    c.execute("PRAGMA busy_timeout=5000;")
    c.execute("PRAGMA synchronous=NORMAL;")
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with connect() as c:
        # Base tables
        c.executescript('''
        CREATE TABLE IF NOT EXISTS teams (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          colour TEXT DEFAULT '',
          code_hash TEXT UNIQUE NOT NULL,
          eliminated INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          station INTEGER NOT NULL DEFAULT 1,
          riddle_order INTEGER NOT NULL DEFAULT 1,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          answer_hash TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER NOT NULL,
          clue_id INTEGER NOT NULL,
          answer TEXT NOT NULL,
          correct INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(team_id) REFERENCES teams(id),
          FOREIGN KEY(clue_id) REFERENCES clues(id)
        );
        CREATE TABLE IF NOT EXISTS participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER NOT NULL,
          device_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(team_id, device_id),
          FOREIGN KEY(team_id) REFERENCES teams(id)
        );
        CREATE TABLE IF NOT EXISTS game_state (
          id INTEGER PRIMARY KEY CHECK (id=1),
          status TEXT NOT NULL DEFAULT 'waiting',
          started_at TEXT,
          paused_at TEXT,
          remaining_seconds INTEGER NOT NULL DEFAULT 7200
        );
        INSERT OR IGNORE INTO game_state
          (id, status, started_at, paused_at, remaining_seconds)
          VALUES (1, 'waiting', NULL, NULL, 7200);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER,
          kind TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        ''')

        # Backward compatibility column migrations for existing databases
        clues_cols = {col['name'] for col in c.execute("PRAGMA table_info(clues)").fetchall()}
        if 'station' not in clues_cols:
            c.execute("ALTER TABLE clues ADD COLUMN station INTEGER NOT NULL DEFAULT 1")
        if 'riddle_order' not in clues_cols:
            c.execute("ALTER TABLE clues ADD COLUMN riddle_order INTEGER NOT NULL DEFAULT 1")
        if 'created_at' not in clues_cols:
            c.execute("ALTER TABLE clues ADD COLUMN created_at TEXT NOT NULL DEFAULT ''")

        teams_cols = {col['name'] for col in c.execute("PRAGMA table_info(teams)").fetchall()}
        if 'colour' not in teams_cols:
            c.execute("ALTER TABLE teams ADD COLUMN colour TEXT DEFAULT ''")

        # Ensure all 12 event teams are pre-seeded
        default_teams = [
            ("Team Red", "red", "REDRACERS2026"),
            ("Team Black", "black", "BLACKPANTHERS2026"),
            ("Team Navy", "navy", "NAVYSHIPS2026"),
            ("Team Yellow", "yellow", "YELLOWYELLOW2026"),
            ("Team Orange", "orange", "ORANGEBLAZE2026"),
            ("Team Green", "green", "GREENVIPERS2026"),
            ("Team Purple", "purple", "PURPLESTORM2026"),
            ("Team Grey", "grey", "GREYSHADOWS2026"),
            ("Team Brown", "brown", "BROWNTITANS2026"),
            ("Team Peach", "peach", "PEACHPULSE2026"),
            ("Team Cyan", "cyan", "CYANBEACON2026"),
            ("Team White", "white", "WHITEGHOSTS2026")
        ]
        for t_name, t_col, t_code in default_teams:
            exists = c.execute("SELECT id FROM teams WHERE colour=? OR name=?", (t_col, t_name)).fetchone()
            if not exists:
                c.execute(
                    "INSERT INTO teams(name, colour, code_hash, created_at) VALUES(?,?,?,?)",
                    (t_name, t_col, hashlib.sha256(t_code.encode()).hexdigest(), now())
                )


def now():
    return datetime.now(timezone.utc).isoformat()


def log(c, team_id, kind, details=''):
    c.execute(
        'INSERT INTO events(team_id, kind, details, created_at) VALUES(?,?,?,?)',
        (team_id, kind, details[:250], now())
    )


def normalize_answer(s: str) -> str:
    """Consistently normalize answer: collapse spaces, strip, and unicode casefold."""
    if not s:
        return ""
    return " ".join(s.strip().casefold().split())


def hash_answer(s: str) -> str:
    return hashlib.sha256(normalize_answer(s).encode('utf-8')).hexdigest()


def admin_ok(password: str | None) -> bool:
    admin_pw = get_admin_password()
    if not password or not admin_pw:
        return False
    return hmac.compare_digest(password.strip(), admin_pw.strip())


def require_admin(password: str | None, request_ip: str = "global"):
    fail_key = f"admin_fail_{request_ip}"
    if admin_ok(password):
        # Successful organizer authentication: immediately clear fail counter
        if fail_key in rate_limiter.history:
            rate_limiter.history[fail_key] = []
        return

    # Check rate limiter on failed attempts (30 attempts per 60 seconds)
    if not rate_limiter.check(fail_key, max_requests=30, window_seconds=60):
        raise HTTPException(429, "Too many failed attempts. Organizer endpoints locked temporarily.")
    rate_limiter.record(fail_key)
    raise HTTPException(401, "Organizer authentication failed.")


def get_team_by_code(c, code: str):
    if not code or len(code) > 100:
        return None
    clean = code.strip()
    for variant in [clean, clean.upper(), clean.lower()]:
        h = hashlib.sha256(variant.encode()).hexdigest()
        team = c.execute('SELECT * FROM teams WHERE code_hash=?', (h,)).fetchone()
        if team:
            return team
    return None


# ---------------------------------------------------------------------------
# Game State Logic
# ---------------------------------------------------------------------------
def read_game_state(c):
    row = c.execute(
        "SELECT status, started_at, paused_at, remaining_seconds "
        "FROM game_state WHERE id=1"
    ).fetchone()
    if row is None:
        c.execute(
            "INSERT INTO game_state(id, status, started_at, paused_at, remaining_seconds) "
            "VALUES(1, 'waiting', NULL, NULL, ?)",
            (GAME_DURATION_SECONDS,)
        )
        row = c.execute("SELECT * FROM game_state WHERE id=1").fetchone()

    remaining = int(row["remaining_seconds"])
    if row["status"] == "active" and row["started_at"]:
        started = datetime.fromisoformat(row["started_at"])
        elapsed = int((datetime.now(timezone.utc) - started).total_seconds())
        remaining = max(0, remaining - elapsed)
        if remaining == 0:
            c.execute(
                "UPDATE game_state SET status='finished', started_at=NULL, remaining_seconds=0 "
                "WHERE id=1"
            )
            row = c.execute("SELECT * FROM game_state WHERE id=1").fetchone()

    return {
        "status": row["status"],
        "remaining_seconds": remaining,
        "duration_seconds": GAME_DURATION_SECONDS
    }


# ---------------------------------------------------------------------------
# Team Progression Logic (4 Stations, 4 Riddles each = 16 Total)
# ---------------------------------------------------------------------------
def get_team_progression(c, team_id: int):
    all_clues = c.execute(
        "SELECT id, station, riddle_order, title, prompt "
        "FROM clues WHERE active=1 "
        "ORDER BY station ASC, riddle_order ASC, id ASC"
    ).fetchall()

    solved_rows = c.execute(
        "SELECT clue_id FROM submissions WHERE team_id=? AND correct=1",
        (team_id,)
    ).fetchall()
    solved_ids = {r["clue_id"] for r in solved_rows}

    current_clue = None
    for clue in all_clues:
        if clue["id"] not in solved_ids:
            current_clue = dict(clue)
            break

    total = len(all_clues)
    solved_count = len(solved_ids)
    completed = (solved_count >= total and total > 0)

    if current_clue:
        curr_station = current_clue["station"]
        curr_riddle = current_clue["riddle_order"]
    elif completed:
        curr_station = 4
        curr_riddle = 4
    else:
        curr_station = 1
        curr_riddle = 1

    return {
        "solved_count": solved_count,
        "total_clues": total,
        "completed": completed,
        "current_clue": current_clue,
        "current_station": curr_station,
        "current_riddle": curr_riddle,
        "solved_ids": solved_ids
    }


# ---------------------------------------------------------------------------
# Pydantic Request Models
# ---------------------------------------------------------------------------
class Register(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    colour: str = Field(default='', max_length=30)

class Login(BaseModel):
    code: str = Field(min_length=4, max_length=100)
    device_id: str | None = Field(default=None, max_length=100)

class Submit(BaseModel):
    code: str = Field(min_length=4, max_length=100)
    clue_id: int | None = None
    station: int | None = None
    answer: str = Field(min_length=1, max_length=500)

class Violation(BaseModel):
    code: str = Field(min_length=4, max_length=100)
    kind: str = Field(default='back_navigation', max_length=50)
    details: str = Field(default='', max_length=200)

class AddClue(BaseModel):
    station: int = Field(default=1, ge=1, le=4)
    riddle_order: int = Field(default=1, ge=1, le=4)
    title: str = Field(min_length=1, max_length=100)
    prompt: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=200)
    active: bool = True

class UpdateClue(BaseModel):
    station: int | None = Field(default=None, ge=1, le=4)
    riddle_order: int | None = Field(default=None, ge=1, le=4)
    title: str | None = Field(default=None, min_length=1, max_length=100)
    prompt: str | None = Field(default=None, min_length=1, max_length=2000)
    answer: str | None = Field(default=None, min_length=1, max_length=200)
    active: bool | None = None

class GameReset(BaseModel):
    confirm: str = Field(description="Must match 'RESET_SIGNAL_HUNT'")
    clear_submissions: bool = True
    reset_teams: bool = False


# ---------------------------------------------------------------------------
# Lifespan / Startup
# ---------------------------------------------------------------------------
@app.on_event('startup')
def startup():
    init_db()


# ---------------------------------------------------------------------------
# HTML Route Handlers
# ---------------------------------------------------------------------------
@app.get('/')
def home():
    index_file = FRONTEND / 'index.html'
    if index_file.is_file():
        return FileResponse(index_file)
    return JSONResponse({"status": "Signal Hunt backend active", "frontend_path": str(index_file)})

@app.get('/host.html')
def host_page():
    host_file = FRONTEND / 'host.html'
    if host_file.is_file():
        return FileResponse(host_file)
    return JSONResponse({"status": "Signal Hunt host backend active", "host_path": str(host_file)})


# ---------------------------------------------------------------------------
# Public Game Lifecycle & Status
# ---------------------------------------------------------------------------
@app.get('/api/status')
def public_game_status():
    with connect() as c:
        return read_game_state(c)


# ---------------------------------------------------------------------------
# Organizer Game Controls
# ---------------------------------------------------------------------------
@app.post('/api/admin/game/start')
def start_game(x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        state = read_game_state(c)
        if state["status"] == "active":
            return state
        if state["status"] != "waiting":
            raise HTTPException(409, f"Game cannot be started from '{state['status']}' state. Reset first if needed.")
        started = now()
        c.execute(
            "UPDATE game_state SET status='active', started_at=?, paused_at=NULL, "
            "remaining_seconds=? WHERE id=1",
            (started, GAME_DURATION_SECONDS)
        )
        log(c, None, "game_started", "120-minute game started by organizer")
        return read_game_state(c)


@app.post('/api/admin/game/pause')
def pause_game(x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        state = read_game_state(c)
        if state["status"] != "active":
            raise HTTPException(409, "Only an active game can be paused.")
        remaining = max(0, state["remaining_seconds"])
        if remaining == 0:
            c.execute("UPDATE game_state SET status='finished', remaining_seconds=0 WHERE id=1")
            raise HTTPException(409, "The game time has expired.")
        c.execute(
            "UPDATE game_state SET status='paused', started_at=NULL, paused_at=?, "
            "remaining_seconds=? WHERE id=1",
            (now(), remaining)
        )
        log(c, None, "game_paused", f"Organizer paused game. Remaining: {remaining}s")
        return read_game_state(c)


@app.post('/api/admin/game/resume')
def resume_game(x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        state = read_game_state(c)
        if state["status"] != "paused":
            raise HTTPException(409, "Only a paused game can be resumed.")
        c.execute(
            "UPDATE game_state SET status='active', started_at=?, paused_at=NULL "
            "WHERE id=1",
            (now(),)
        )
        log(c, None, "game_resumed", "Organizer resumed game")
        return read_game_state(c)


@app.post('/api/admin/game/finish')
def finish_game(x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        c.execute(
            "UPDATE game_state SET status='finished', started_at=NULL, paused_at=NULL, "
            "remaining_seconds=0 WHERE id=1"
        )
        log(c, None, "game_finished", "Organizer finished game")
        return read_game_state(c)


@app.post('/api/admin/game/reset')
def reset_game(data: GameReset, x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    if data.confirm != "RESET_SIGNAL_HUNT":
        raise HTTPException(400, "Reset confirmation string mismatch. Must be 'RESET_SIGNAL_HUNT'.")

    with connect() as c:
        c.execute(
            "UPDATE game_state SET status='waiting', started_at=NULL, paused_at=NULL, "
            "remaining_seconds=? WHERE id=1",
            (GAME_DURATION_SECONDS,)
        )
        if data.clear_submissions:
            c.execute("DELETE FROM submissions")
        if data.reset_teams:
            c.execute("UPDATE teams SET eliminated=0")
            c.execute("DELETE FROM participants")

        log(c, None, "game_reset", f"Organizer reset game. Clear submissions: {data.clear_submissions}, Reset teams: {data.reset_teams}")
        return read_game_state(c)


# ---------------------------------------------------------------------------
# Team Registration & Login (Max 4 Teams, 5 Participants per Team)
# ---------------------------------------------------------------------------
@app.post('/api/register')
def register(data: Register, request: Request = None):
    ip = request.client.host if request and request.client else "global"
    reg_key = f"reg_{ip}"
    if not rate_limiter.is_allowed(reg_key, max_requests=30, window_seconds=60):
        raise HTTPException(429, "Too many registration attempts. Please wait.")

    name = ' '.join(data.name.split())
    colour = data.colour.strip().lower()
    code = secrets.token_urlsafe(9)
    code_hash = hashlib.sha256(code.encode()).hexdigest()

    try:
        with connect() as c:
            team_count = c.execute('SELECT COUNT(*) FROM teams').fetchone()[0]
            max_teams = int(os.getenv('MAX_TEAMS', '12'))
            if team_count >= max_teams:
                raise HTTPException(409, f'The event is limited to {max_teams} teams.')

            if colour:
                existing_colour = c.execute('SELECT id FROM teams WHERE colour=?', (colour,)).fetchone()
                if existing_colour:
                    raise HTTPException(409, f"The team colour '{colour}' is already assigned.")

            cur = c.execute(
                'INSERT INTO teams(name, colour, code_hash, created_at) VALUES(?,?,?,?)',
                (name, colour, code_hash, now())
            )
            team_id = cur.lastrowid
            log(c, team_id, "team_registered", f"Team '{name}' registered with colour '{colour}'")
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'That team name is already registered.')

    return {
        'team_id': team_id,
        'team_name': name,
        'colour': colour,
        'code': code,
        'message': 'Save this team code securely. It cannot be recovered.'
    }


@app.post('/api/login')
def login(data: Login, request: Request = None):
    ip = request.client.host if request and request.client else "global"
    fail_key = f"login_fail_{ip}"
    if not rate_limiter.check(fail_key, max_requests=25, window_seconds=60):
        raise HTTPException(429, "Too many failed login attempts. Please wait a minute.")

    with connect() as c:
        t = get_team_by_code(c, data.code)
        if not t:
            rate_limiter.record(fail_key)
            raise HTTPException(401, 'Invalid team code.')
        if t['eliminated']:
            raise HTTPException(403, 'This team has been eliminated. Contact an organizer.')

        # Enforce max 5 participants per team and max 60 total event participants
        if data.device_id:
            device_id = data.device_id.strip()
            participant = c.execute(
                'SELECT id FROM participants WHERE team_id=? AND device_id=?',
                (t['id'], device_id)
            ).fetchone()
            if not participant:
                p_count = c.execute(
                    'SELECT COUNT(*) FROM participants WHERE team_id=?',
                    (t['id'],)
                ).fetchone()[0]
                max_team_participants = int(os.getenv('MAX_PARTICIPANTS_PER_TEAM', '5'))
                if p_count >= max_team_participants:
                    raise HTTPException(403, f'Team participant limit reached (maximum {max_team_participants} participants per team).')

                total_p = c.execute('SELECT COUNT(*) FROM participants').fetchone()[0]
                max_total_participants = int(os.getenv('MAX_TOTAL_PARTICIPANTS', '60'))
                if total_p >= max_total_participants:
                    raise HTTPException(403, f'Total event participant limit reached (maximum {max_total_participants} participants).')

                c.execute(
                    'INSERT INTO participants(team_id, device_id, created_at) VALUES(?,?,?)',
                    (t['id'], device_id, now())
                )

        state = read_game_state(c)
        prog = get_team_progression(c, t['id'])

        # Security feature: DO NOT leak unreached clues!
        return {
            'team': {
                'id': t['id'],
                'name': t['name'],
                'colour': t['colour']
            },
            'status': state['status'],
            'remaining_seconds': state['remaining_seconds'],
            'current_clue': prog['current_clue'],
            'clues': [prog['current_clue']] if prog['current_clue'] else [],
            'progress': {
                'solved_count': prog['solved_count'],
                'total_clues': prog['total_clues'],
                'current_station': prog['current_station'],
                'current_riddle': prog['current_riddle'],
                'completed': prog['completed']
            }
        }


# ---------------------------------------------------------------------------
# Team Status & Clue Polling
# ---------------------------------------------------------------------------
@app.get('/api/team/current')
def team_current(code: str):
    with connect() as c:
        t = get_team_by_code(c, code)
        if not t:
            raise HTTPException(401, 'Invalid team code.')
        if t['eliminated']:
            raise HTTPException(403, 'Team eliminated.')

        state = read_game_state(c)
        prog = get_team_progression(c, t['id'])

        return {
            'team': {'id': t['id'], 'name': t['name'], 'colour': t['colour']},
            'status': state['status'],
            'remaining_seconds': state['remaining_seconds'],
            'current_clue': prog['current_clue'],
            'progress': {
                'solved_count': prog['solved_count'],
                'total_clues': prog['total_clues'],
                'current_station': prog['current_station'],
                'current_riddle': prog['current_riddle'],
                'completed': prog['completed']
            }
        }


# ---------------------------------------------------------------------------
# Answer Submission & Station Progression
# ---------------------------------------------------------------------------
@app.post('/api/submit')
def submit(data: Submit, request: Request = None):
    with connect() as c:
        t = get_team_by_code(c, data.code)
        if not t:
            raise HTTPException(401, 'Invalid team code.')
        if t['eliminated']:
            raise HTTPException(403, 'Team eliminated.')

        # Rate limit per team to prevent brute-forcing riddle answers
        submit_key = f"submit_{t['id']}"
        if not rate_limiter.is_allowed(submit_key, max_requests=100, window_seconds=60):
            raise HTTPException(429, "Too many submission attempts. Please pause and re-check your notes.")

        state = read_game_state(c)
        if state['status'] != 'active':
            raise HTTPException(403, 'The game is not active. Await organizer transmission.')
        if state['remaining_seconds'] <= 0:
            raise HTTPException(403, 'The event timer has expired. Submissions are closed.')

        prog = get_team_progression(c, t['id'])
        if prog['completed'] or not prog['current_clue']:
            raise HTTPException(400, 'All station riddles are already completed! Mission accomplished.')

        target_clue = prog['current_clue']

        # Guard against duplicate solve or out-of-order submissions
        if data.clue_id is not None:
            if data.clue_id in prog['solved_ids']:
                raise HTTPException(400, 'This riddle has already been solved by your team.')
            if data.clue_id != target_clue['id']:
                raise HTTPException(
                    400,
                    f"Out-of-order submission. You must solve Station {target_clue['station']} "
                    f"Riddle {target_clue['riddle_order']} first."
                )

        if data.station is not None and data.station != target_clue['station']:
            raise HTTPException(
                400,
                f"Out-of-order submission. Your team is currently at Station {target_clue['station']}."
            )

        # Retrieve clue answer hash
        clue_row = c.execute('SELECT * FROM clues WHERE id=?', (target_clue['id'],)).fetchone()
        if not clue_row or not clue_row['active']:
            raise HTTPException(404, 'Active clue not found.')

        # Validate answer securely with constant-time comparison
        user_hash = hash_answer(data.answer)
        correct = hmac.compare_digest(user_hash, clue_row['answer_hash'])

        # Record submission
        c.execute(
            'INSERT INTO submissions(team_id, clue_id, answer, correct, created_at) '
            'VALUES(?,?,?,?,?)',
            (t['id'], target_clue['id'], data.answer.strip()[:500], int(correct), now())
        )

        log(
            c, t['id'],
            'answer_correct' if correct else 'answer_incorrect',
            f"station={target_clue['station']} riddle={target_clue['riddle_order']} clue_id={target_clue['id']}"
        )

        # Recalculate progress after correct solve
        new_prog = get_team_progression(c, t['id'])

        return {
            'correct': correct,
            'message': 'Correct! Signal decoded.' if correct else 'Not quite. Try again.',
            'progress': {
                'solved_count': new_prog['solved_count'],
                'total_clues': new_prog['total_clues'],
                'current_station': new_prog['current_station'],
                'current_riddle': new_prog['current_riddle'],
                'completed': new_prog['completed']
            },
            'next_clue': new_prog['current_clue']
        }


# ---------------------------------------------------------------------------
# Team Violation & Elimination
# ---------------------------------------------------------------------------
@app.post('/api/violation')
def violation(data: Violation):
    with connect() as c:
        t = get_team_by_code(c, data.code)
        if not t:
            raise HTTPException(401, 'Invalid team code.')
        if t['eliminated']:
            return {'eliminated': True, 'message': 'Team already eliminated.'}
        c.execute('UPDATE teams SET eliminated=1 WHERE id=?', (t['id'],))
        log(c, t['id'], 'team_eliminated', f'{data.kind}: {data.details}')
        return {
            'eliminated': True,
            'message': 'Team eliminated under event policy. Report to the organizer.'
        }


# ---------------------------------------------------------------------------
# Organizer Dashboard API
# ---------------------------------------------------------------------------
@app.get('/api/admin/overview')
def overview(x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)

    with connect() as c:
        state = read_game_state(c)

        # Load teams with live progress & participant count
        raw_teams = c.execute(
            'SELECT id, name, colour, eliminated, created_at FROM teams ORDER BY id ASC'
        ).fetchall()

        teams = []
        for team in raw_teams:
            prog = get_team_progression(c, team['id'])
            p_count = c.execute(
                'SELECT COUNT(*) FROM participants WHERE team_id=?',
                (team['id'],)
            ).fetchone()[0]

            teams.append({
                'id': team['id'],
                'name': team['name'],
                'colour': team['colour'],
                'eliminated': bool(team['eliminated']),
                'created_at': team['created_at'],
                'solved_count': prog['solved_count'],
                'total_clues': prog['total_clues'],
                'current_station': prog['current_station'],
                'current_riddle': prog['current_riddle'],
                'completed': prog['completed'],
                'participant_count': p_count
            })

        # Load clues (station, riddle_order, active) - NEVER leak answer_hash
        clues = [
            dict(r) for r in c.execute(
                'SELECT id, station, riddle_order, title, prompt, active, created_at '
                'FROM clues ORDER BY station ASC, riddle_order ASC, id ASC'
            ).fetchall()
        ]

        # Recent events and submissions
        events = [
            dict(r) for r in c.execute(
                'SELECT e.id, t.name AS team, e.kind, e.details, e.created_at '
                'FROM events e LEFT JOIN teams t ON t.id=e.team_id '
                'ORDER BY e.id DESC LIMIT 100'
            ).fetchall()
        ]

        subs = [
            dict(r) for r in c.execute(
                'SELECT s.id, t.name AS team, cl.station, cl.riddle_order, cl.title AS clue, '
                's.answer, s.correct, s.created_at '
                'FROM submissions s '
                'JOIN teams t ON t.id=s.team_id '
                'JOIN clues cl ON cl.id=s.clue_id '
                'ORDER BY s.id DESC LIMIT 100'
            ).fetchall()
        ]

        return {
            'game_state': state,
            'teams': teams,
            'clues': clues,
            'events': events,
            'submissions': subs
        }


# ---------------------------------------------------------------------------
# Organizer Riddle Management (CRUD)
# ---------------------------------------------------------------------------
@app.get('/api/admin/clues')
def list_clues(x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        rows = c.execute(
            'SELECT id, station, riddle_order, title, prompt, active, created_at '
            'FROM clues ORDER BY station ASC, riddle_order ASC, id ASC'
        ).fetchall()
        return [dict(r) for r in rows]


@app.post('/api/admin/clues')
def add_clue(data: AddClue, x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        ans_h = hash_answer(data.answer)
        cur = c.execute(
            'INSERT INTO clues(station, riddle_order, title, prompt, answer_hash, active, created_at) '
            'VALUES(?,?,?,?,?,?,?)',
            (data.station, data.riddle_order, data.title, data.prompt, ans_h, int(data.active), now())
        )
        clue_id = cur.lastrowid
        log(c, None, "clue_added", f"Clue ID {clue_id}: Station {data.station} Riddle {data.riddle_order}")
        return {'id': clue_id, 'message': 'Riddle successfully created.'}


@app.put('/api/admin/clues/{clue_id}')
def update_clue(clue_id: int, data: UpdateClue, x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        clue = c.execute('SELECT * FROM clues WHERE id=?', (clue_id,)).fetchone()
        if not clue:
            raise HTTPException(404, 'Clue not found.')

        station = data.station if data.station is not None else clue['station']
        riddle_order = data.riddle_order if data.riddle_order is not None else clue['riddle_order']
        title = data.title if data.title is not None else clue['title']
        prompt = data.prompt if data.prompt is not None else clue['prompt']
        active = int(data.active) if data.active is not None else clue['active']
        ans_h = hash_answer(data.answer) if data.answer is not None else clue['answer_hash']

        c.execute(
            'UPDATE clues SET station=?, riddle_order=?, title=?, prompt=?, answer_hash=?, active=? '
            'WHERE id=?',
            (station, riddle_order, title, prompt, ans_h, active, clue_id)
        )
        log(c, None, "clue_updated", f"Clue ID {clue_id} updated")
        return {'id': clue_id, 'message': 'Riddle successfully updated.'}


@app.delete('/api/admin/clues/{clue_id}')
def delete_clue(clue_id: int, x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        clue = c.execute('SELECT id FROM clues WHERE id=?', (clue_id,)).fetchone()
        if not clue:
            raise HTTPException(404, 'Clue not found.')
        c.execute('DELETE FROM clues WHERE id=?', (clue_id,))
        log(c, None, "clue_deleted", f"Clue ID {clue_id} deleted")
        return {'id': clue_id, 'message': 'Riddle deleted.'}


@app.post('/api/admin/team/{team_id}/reinstate')
def reinstate(team_id: int, x_admin_password: str | None = Header(default=None), request: Request = None):
    ip = request.client.host if request and request.client else "global"
    require_admin(x_admin_password, ip)
    with connect() as c:
        cur = c.execute('UPDATE teams SET eliminated=0 WHERE id=?', (team_id,))
        if not cur.rowcount:
            raise HTTPException(404, 'Team not found.')
        log(c, team_id, 'team_reinstated', 'Organizer override')
        return {'message': 'Team reinstated.'}
