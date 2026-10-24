# Signal Hunt — starter full-stack application

Python/FastAPI backend, SQLite persistence, responsive HTML/CSS/JS frontend. Includes team registration, one-time team code, clue submissions, server-side answer checking, violation logging/team elimination, organizer dashboard, clue creation, and organizer reinstatement.

## Local run on Linux Mint

```bash
cd signal-hunt
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ADMIN_PASSWORD='choose-a-long-password-here'
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. API docs: http://127.0.0.1:8000/docs. Demo clue answer is `hi`; change/remove this before the event.

## Deploy with Docker

```bash
cp .env.example .env
# Edit .env and set a unique ADMIN_PASSWORD.
docker build -t signal-hunt .
mkdir -p data
docker run --name signal-hunt --restart unless-stopped -p 8000:8000 --env-file .env -v "$PWD/data:/data" signal-hunt
```

For public internet access, deploy the container to a host that supports Docker and persistent storage, configure `DATABASE_PATH` to that persistent disk, and enable HTTPS. Do not expose the service publicly until the default admin password is changed. Back up the SQLite database before the event. Do a full rehearsal with multiple phones.

## Important limitations / before event use

- The browser Back trap works only in browsers that expose the history event. It is not tamper-proof. A user may close the browser, use another device, or evade browser-side code. The backend persists an elimination once it receives the violation, and refresh cannot undo it.
- We deliberately do not auto-eliminate on tab switching or `visibilitychange`, because notifications, calls, and accidental backgrounding are common on phones.
- Team codes are bearer secrets. Anyone who obtains one can access that team. Share securely and do not publish codes.
- This starter uses a single-process SQLite setup. For larger concurrent events, use PostgreSQL, add rate limits, CSRF/origin protections as appropriate, stronger admin authentication, and test load/backup/restore. Do not treat it as a fully audited production security system.
- Replace the demo clue, validate the final event rules with organizers, and test Android Chrome, iOS Safari, and desktop browsers. A web app cannot disable mobile data or reliably prevent leaving the browser.
