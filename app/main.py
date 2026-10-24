import os, sqlite3, secrets, hashlib, hmac
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).parent
DB = Path(os.getenv('DATABASE_PATH', str(BASE.parent / 'signalhunt.db')))
FRONTEND = Path.home() / "Downloads" / "Signal-Hunt" / "frontend"
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'change-this-before-deploying')
app = FastAPI(title='Signal Hunt', version='1.0.0')
app.mount('/static', StaticFiles(directory=BASE / 'static'), name='static')
app.mount(
    '/styles',
    StaticFiles(directory=FRONTEND / 'styles'),
    name='frontend-styles'
)
app.mount(
    '/js',
    StaticFiles(directory=FRONTEND / 'js'),
    name='frontend-js'
)
app.mount(
    '/assets',
    StaticFiles(directory=FRONTEND / 'assets'),
    name='frontend-assets'
)


def connect():
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with connect() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS teams (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
          code_hash TEXT UNIQUE NOT NULL, eliminated INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clues (
          id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
          prompt TEXT NOT NULL, answer_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER NOT NULL,
          clue_id INTEGER NOT NULL, answer TEXT NOT NULL, correct INTEGER NOT NULL,
          created_at TEXT NOT NULL, FOREIGN KEY(team_id) REFERENCES teams(id),
          FOREIGN KEY(clue_id) REFERENCES clues(id)
        );
        CREATE TABLE IF NOT EXISTS game_state (
          id INTEGER PRIMARY KEY CHECK (id=1),
          status TEXT NOT NULL DEFAULT 'waiting',
          started_at TEXT,
          paused_at TEXT,
          remaining_seconds INTEGER NOT NULL DEFAULT 7200
        );
        INSERT OR IGNORE INTO game_state
          (id,status,started_at,paused_at,remaining_seconds)
          VALUES (1,'waiting',NULL,NULL,7200);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER, kind TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
        );
        ''')
        if c.execute('SELECT COUNT(*) FROM clues').fetchone()[0] == 0:
            c.execute('INSERT INTO clues(title,prompt,answer_hash) VALUES(?,?,?)',
                ('Demo: Decode the signal', 'Decode this Morse code: .... ..', hash_answer('hi')))



GAME_DURATION_SECONDS = 2 * 60 * 60

def read_game_state(c):
    row = c.execute(
        "SELECT status, started_at, paused_at, remaining_seconds "
        "FROM game_state WHERE id=1"
    ).fetchone()
    if row is None:
        c.execute(
            "INSERT INTO game_state(id,status,started_at,paused_at,remaining_seconds) "
            "VALUES(1,'waiting',NULL,NULL,?,?)",
            (GAME_DURATION_SECONDS, GAME_DURATION_SECONDS)
        )
        row = c.execute("SELECT * FROM game_state WHERE id=1").fetchone()

    remaining = int(row["remaining_seconds"])
    if row["status"] == "active" and row["started_at"]:
        started = datetime.fromisoformat(row["started_at"])
        elapsed = int((datetime.now(timezone.utc) - started).total_seconds())
        remaining = max(0, remaining - elapsed)
        if remaining == 0:
            c.execute(
                "UPDATE game_state SET status='finished', remaining_seconds=0 "
                "WHERE id=1"
            )
            row = c.execute("SELECT * FROM game_state WHERE id=1").fetchone()

    return {
        "status": row["status"],
        "remaining_seconds": remaining,
        "duration_seconds": GAME_DURATION_SECONDS
    }

def require_admin(password):
    if not admin_ok(password):
        raise HTTPException(401, "Organizer authentication failed.")


def hash_answer(s: str) -> str:
    return hashlib.sha256(s.strip().casefold().encode()).hexdigest()


def now(): return datetime.now(timezone.utc).isoformat()

def log(c, team_id, kind, details=''):
    c.execute('INSERT INTO events(team_id,kind,details,created_at) VALUES(?,?,?,?)', (team_id,kind,details[:250],now()))

def get_team(c, code):
    if not code or len(code) > 100: return None
    row = c.execute('SELECT * FROM teams WHERE code_hash=?', (hashlib.sha256(code.strip().encode()).hexdigest(),)).fetchone()
    return row

def admin_ok(password):
    return bool(password) and hmac.compare_digest(password, ADMIN_PASSWORD)

class Register(BaseModel):
    name: str = Field(min_length=2, max_length=60)

class Login(BaseModel):
    code: str = Field(min_length=4, max_length=100)

class Submit(BaseModel):
    code: str
    clue_id: int
    answer: str = Field(min_length=1, max_length=500)

class Violation(BaseModel):
    code: str
    kind: str = Field(default='back_navigation', max_length=50)
    details: str = Field(default='', max_length=200)

class AddClue(BaseModel):
    title: str = Field(min_length=2, max_length=100)
    prompt: str = Field(min_length=2, max_length=2000)
    answer: str = Field(min_length=1, max_length=200)

@app.on_event('startup')
def startup(): init_db()

@app.get('/')
def home():
    return FileResponse(FRONTEND / 'index.html')


@app.get('/host.html')
def host_page():
    return FileResponse(FRONTEND / 'host.html')


@app.get('/api/status')
def public_game_status():
    with connect() as c:
        return read_game_state(c)

@app.post('/api/admin/game/start')
def start_game(x_admin_password: str | None = Header(default=None)):
    require_admin(x_admin_password)
    with connect() as c:
        state = read_game_state(c)
        if state["status"] == "active":
            return state
        if state["status"] != "waiting":
            raise HTTPException(409, "Game cannot be started from its current state.")
        started = now()
        c.execute(
            "UPDATE game_state SET status='active', started_at=?, paused_at=NULL, "
            "remaining_seconds=? WHERE id=1",
            (started, GAME_DURATION_SECONDS)
        )
        log(c, None, "game_started", "120-minute game started")
        return read_game_state(c)

@app.post('/api/admin/game/pause')
def pause_game(x_admin_password: str | None = Header(default=None)):
    require_admin(x_admin_password)
    with connect() as c:
        state = read_game_state(c)
        if state["status"] != "active":
            raise HTTPException(409, "Only an active game can be paused.")
        # read_game_state() has already accounted for elapsed time.
        remaining = max(0, state["remaining_seconds"])
        if remaining == 0:
            c.execute("UPDATE game_state SET status='finished', remaining_seconds=0 WHERE id=1")
            raise HTTPException(409, "The game time has expired.")
        c.execute(
            "UPDATE game_state SET status='paused', started_at=NULL, paused_at=?, "
            "remaining_seconds=? WHERE id=1",
            (now(), remaining)
        )
        log(c, None, "game_paused", "Organizer paused game")
        return read_game_state(c)

@app.post('/api/admin/game/resume')
def resume_game(x_admin_password: str | None = Header(default=None)):
    require_admin(x_admin_password)
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
def finish_game(x_admin_password: str | None = Header(default=None)):
    require_admin(x_admin_password)
    with connect() as c:
        c.execute(
            "UPDATE game_state SET status='finished', started_at=NULL, paused_at=NULL, "
            "remaining_seconds=0 WHERE id=1"
        )
        log(c, None, "game_finished", "Organizer finished game")
        return read_game_state(c)


@app.post('/api/register')
def register(data: Register):
    name = ' '.join(data.name.split())
    code = secrets.token_urlsafe(9)
    try:
        with connect() as c:
            if c.execute('SELECT COUNT(*) FROM teams').fetchone()[0] >= 4:
                raise HTTPException(409, 'The event is limited to four teams.')
            cur = c.execute('INSERT INTO teams(name,code_hash,created_at) VALUES(?,?,?)',
                (name, hashlib.sha256(code.encode()).hexdigest(), now()))
            team_id = cur.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'That team name is already registered.')
    return {'team_id': team_id, 'team_name': name, 'code': code, 'message': 'Save this team code. It cannot be recovered.'}

@app.post('/api/login')
def login(data: Login):
    with connect() as c:
        t = get_team(c, data.code)
        if not t: raise HTTPException(401, 'Invalid team code.')
        if t['eliminated']: raise HTTPException(403, 'This team has been eliminated. Contact an organizer.')
        state = read_game_state(c)
        clues = c.execute('SELECT id,title,prompt FROM clues WHERE active=1 ORDER BY id').fetchall()
        done = {r['clue_id'] for r in c.execute('SELECT clue_id FROM submissions WHERE team_id=? AND correct=1', (t['id'],))}
        return {'team': {'id':t['id'],'name':t['name']}, 'clues':[dict(x, solved=x['id'] in done) for x in clues], 'status': state['status'], 'remaining_seconds': state['remaining_seconds']}

@app.post('/api/submit')
def submit(data: Submit):
    with connect() as c:
        t = get_team(c, data.code)
        if not t: raise HTTPException(401, 'Invalid team code.')
        if t['eliminated']: raise HTTPException(403, 'Team eliminated.')
        state = read_game_state(c)
        if state['status'] != 'active':
            raise HTTPException(403, 'The game is not active. Wait for the organizer.')
        clue = c.execute('SELECT * FROM clues WHERE id=? AND active=1', (data.clue_id,)).fetchone()
        if not clue: raise HTTPException(404, 'Clue not found.')
        correct = hmac.compare_digest(hash_answer(data.answer), clue['answer_hash'])
        c.execute('INSERT INTO submissions(team_id,clue_id,answer,correct,created_at) VALUES(?,?,?,?,?)',
                  (t['id'], clue['id'], data.answer.strip()[:500], int(correct), now()))
        log(c,t['id'],'answer_correct' if correct else 'answer_incorrect',f"clue={clue['id']}")
        return {'correct':correct, 'message':'Correct! Signal decoded.' if correct else 'Not quite. Try again.'}

@app.post('/api/violation')
def violation(data: Violation):
    # Back navigation is client-detectable only in some browsers. A determined user can bypass this.
    with connect() as c:
        t = get_team(c, data.code)
        if not t: raise HTTPException(401, 'Invalid team code.')
        if t['eliminated']: return {'eliminated':True,'message':'Team already eliminated.'}
        c.execute('UPDATE teams SET eliminated=1 WHERE id=?', (t['id'],))
        log(c,t['id'],'team_eliminated',f'{data.kind}: {data.details}')
        return {'eliminated':True,'message':'Team eliminated under the event rule. Contact an organizer if this was accidental.'}

@app.get('/api/admin/overview')
def overview(x_admin_password: str | None = Header(default=None)):
    if not admin_ok(x_admin_password): raise HTTPException(401, 'Organizer authentication failed.')
    with connect() as c:
        teams = [dict(r) for r in c.execute('SELECT id,name,eliminated,created_at FROM teams ORDER BY id DESC')]
        clues = [dict(r) for r in c.execute('SELECT id,title,prompt,active FROM clues ORDER BY id')]
        events = [dict(r) for r in c.execute('SELECT e.id,t.name AS team,e.kind,e.details,e.created_at FROM events e LEFT JOIN teams t ON t.id=e.team_id ORDER BY e.id DESC LIMIT 100')]
        subs = [dict(r) for r in c.execute('SELECT s.id,t.name AS team,cl.title AS clue,s.answer,s.correct,s.created_at FROM submissions s JOIN teams t ON t.id=s.team_id JOIN clues cl ON cl.id=s.clue_id ORDER BY s.id DESC LIMIT 100')]
        return {'teams':teams,'clues':clues,'events':events,'submissions':subs}

@app.post('/api/admin/clues')
def add_clue(data: AddClue, x_admin_password: str | None = Header(default=None)):
    if not admin_ok(x_admin_password): raise HTTPException(401, 'Organizer authentication failed.')
    with connect() as c:
        cur=c.execute('INSERT INTO clues(title,prompt,answer_hash) VALUES(?,?,?)', (data.title,data.prompt,hash_answer(data.answer)))
        return {'id':cur.lastrowid,'message':'Clue added.'}

@app.post('/api/admin/team/{team_id}/reinstate')
def reinstate(team_id: int, x_admin_password: str | None = Header(default=None)):
    if not admin_ok(x_admin_password): raise HTTPException(401, 'Organizer authentication failed.')
    with connect() as c:
        cur=c.execute('UPDATE teams SET eliminated=0 WHERE id=?',(team_id,))
        if not cur.rowcount: raise HTTPException(404,'Team not found.')
        log(c,team_id,'team_reinstated','Organizer override')
        return {'message':'Team reinstated.'}
