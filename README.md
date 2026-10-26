# Signal Hunt

Signal Hunt is a single-event website for participants and organizers. It includes Morse, Binary, FSK and Combined levels, private organizer route setup, team management, CSV tools, and progress tracking. It records completions; physical volunteers decide the official finishing order.

## Start on Windows

1. Extract `Signal-Hunt-Standalone-Release.zip` into a folder you can keep, then open that folder.
2. Right-click `run-signal-hunt.ps1` and choose **Run with PowerShell**. On first start, the launcher creates a private Python environment and installs the required packages. Internet access is needed for this one-time setup. It then asks you to create an organizer password of at least 12 characters; the app stores a salted hash in the local database.
3. Open `http://127.0.0.1:8014/` for the participant site. Open `http://127.0.0.1:8014/host` for organizer sign-in.
4. Keep the PowerShell window open while the site is in use. Press Ctrl+C there to stop it.

Install Python 3.11, 3.12, or 3.14 if the launcher says no supported Python was found. If port 8014 is already occupied, close the other service or set `$env:SIGNAL_HUNT_PORT = '8015'` in PowerShell before launching. The site stays local to this computer by default.

## Data and event setup

The launcher saves the database under `data/signal-hunt.db`; generated backups are in `data/backups`. To put event data in another folder, set `SIGNAL_HUNT_DATA_DIR` before launching. Keep the database and its matching `.lookup-key` file together in protected backups. Do not share either file publicly.

Sign in to `/host` and create 4–10 teams, then configure all four levels for each team. Codes are stored as hashes and cannot be recovered; record team and envelope codes securely when you create them. Team CSV and route CSV imports have preview and explicit confirmation steps. The random-route tool previews balanced A/B/C/D assignments before saving.

The dashboard can start, pause, resume, finish, and re-arm game progress. Event setup reset first makes and verifies a database/key backup, then removes event records; it is unavailable while the game is active or paused. A progress re-arm preserves teams, routes, codes and organizer notes. Physical volunteers determine the official winner.

## Host the single website

`render.yaml` defines one Render web service with persistent storage. Follow [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) to configure it. Set a new, unique `ADMIN_PASSWORD` in the host's secret settings. Do not commit secrets or local event data. The application uses one SQLite database and one instance.

## Validation

See [QA_SUMMARY.md](QA_SUMMARY.md) for the final implementation checks, browser walkthrough, package contents and remaining deployment rehearsal items. The ZIP does not include event data or a live cloud deployment.
