# Signal Hunt — Frontend Prototype

A mobile-first frontend for the Signal Hunt campus challenge at Nexus Vyoma 2026.

## What is included

- Team login with ten predefined team colours and **fake prototype codes**.
- Home / Waiting Room with a local-only preview of host start.
- Separate `host.html` Host Dashboard demo with Start Challenge and Reset Demo controls.
- Local reference image viewer that opens charts full-screen without zoom controls.
- Mission briefing and four station cards.
- Knowledge cards for Morse Code, Binary ASCII, FSK Signals, and Extra Tips.
- Full reference views for the three supplied charts. Extra Tips image is a placeholder until provided.
- The 11 rules supplied by the organisers.
- Security page and local-only elimination preview.
- Team Profile without participant names.
- Campus map page using the supplied illustration.
- Active-game, station-code, success, invalid-code, completion, and elimination screens.
- Simple modular CSS and JavaScript by feature.

## Run on Windows

1. Extract the `frontend` folder into your Signal-Hunt project root (next to `.git` and `README.md`).
2. Open the `Signal-Hunt` project folder in Antigravity / VS Code.
3. Open `frontend/index.html` and run it with Live Server.
4. In the browser, select a team colour and enter its prototype code. Example: Red / `RED-ALPHA`.
5. For the host UI demo, open `host.html` in another tab on the same Live Server origin. Click **Start Challenge** there; the participant page should react in that browser. Use **Reset Local Demo** to return to the Waiting Room.

Live Server is recommended because the site loads local JavaScript and image assets. You can also run a server from the `frontend` folder with:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Prototype test codes — NOT REAL CREDENTIALS

| Team colour | Code |
|---|---|
| Black | `BLK-SIGNAL` |
| Red | `RED-ALPHA` |
| Navy Blue | `NAVY-ECHO` |
| Yellow | `YLW-STORM` |
| Orange | `ORG-BLAZE` |
| Green | `GRN-ECHO` |
| Purple | `PRP-VIPER` |
| Grey | `GRY-SHADE` |
| Brown | `BRN-TRACE` |
| Peach | `PCH-PULSE` |

Station demo codes are shown in the “Prototype station codes” disclosure on the station entry screen. They are fake values for UI testing only.

## Important limits

- No backend is connected. Login and station-code verification use fake local test data.
- `host.html`, the participant preview button, and elimination preview are local UI demonstrations only. The Host Dashboard is not protected by real authentication.
- The host dashboard shares demo state only between tabs on the same browser/origin. It cannot start the game on phones or computers on other devices.
- No timer is implemented.
- Real host authentication, station-code validation, progress, game start across devices, and elimination must be handled by the FastAPI backend after the API contract is agreed.
- The browser cannot reliably prove that every exit or navigation event was intentional. Do not treat this frontend demo as security enforcement.
- The Extra Tips reference image has not been supplied yet; its image area is clearly marked as pending.
- Confirm the campus map's accuracy and labels with event organisers before giving it to participants.

## File structure

```text
frontend/
├── index.html
├── host.html                 # Host start/reset UI demo (not real or protected)
├── assets/
├── styles/
│   ├── base.css
│   ├── components.css
│   └── pages/
└── js/
    ├── data.js
    ├── mock-data.js
    ├── api.js
    ├── navigation.js
    ├── auth.js
    ├── profile.js
    ├── app.js
    └── pages/
        ├── knowledge.js
        └── game-flow.js
```

## Backend integration handoff

`js/api.js` is the seam for future API integration. Once the backend developer supplies endpoints and request/response formats, replace the mock calls with `fetch()` calls. Keep server-side validation authoritative. Never add real passwords, team secrets, API keys, or private participant details to frontend files.
