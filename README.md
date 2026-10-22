# Signal Hunt

**A Campus Mystery Challenge | Nexus Vyoma 2026**

Signal Hunt is a campus-based puzzle challenge where teams solve clues, decode signals, and work together to complete a sequence of challenges.

The website is being developed to support the event by providing teams with access to mission information, learning resources, rules, and game updates.

## Project Status

The frontend is currently a prototype using mock data. Backend integration and gameplay functionality will be developed separately.

## Current Features

- Team login using a team colour and mock team code
- Home / Waiting Room with the current game status
- Mission information
- Knowledge resources
- Rules and guidelines
- Team profile
- Campus map placeholder
- Responsive interface for mobile and desktop

## Technology Stack

- HTML
- CSS
- JavaScript
- Git and GitHub for version control and collaboration
- FastAPI for the planned backend

## Project Structure

```text
Signal-Hunt/
├── frontend/
│   ├── index.html
│   ├── styles/
│   │   ├── main.css
│   │   └── components.css
│   ├── js/
│   │   ├── app.js
│   │   ├── auth.js
│   │   ├── data.js
│   │   └── nav.js
│   └── assets/
├── .gitignore
└── README.md
```

The backend will be maintained separately within the shared project as development progresses.

## Running the Frontend Locally

1. Clone the repository.
2. Open the project folder in your code editor.
3. Open `frontend/index.html` directly in a browser, or run a local development server.

For example, from the `frontend` folder:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080` in your browser.

**Note:** Login codes and authentication are currently for prototype testing only. They are not real authentication credentials.

## Team Collaboration

- Keep frontend work inside `frontend/`.
- Keep backend work in the agreed backend directory.
- Create a separate branch for each feature or task.
- Commit changes with clear messages.
- Push your branch and open a Pull Request for review before merging into `main`.

## Project Goal

Build a clear, reliable, and engaging digital interface to support the Signal Hunt campus challenge.

---

*Developed as part of Nexus Vyoma 2026.*
