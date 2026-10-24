🔍 Signal Hunt

A Team-Based, Multi-Station Riddle Hunt Platform

A full-stack event platform built to manage team access, riddle solving, answer validation and progression across multiple stations in a timed competition.

---

🎯 Project Overview

Signal Hunt is designed for organized, team-based riddle hunt events. Participants access the mobile-friendly interface, solve challenges and progress through stations while organizers monitor event activity through a host dashboard.

Goal: Deliver a smooth, fair and organized hunt experience for participants and event organizers.

✨ Key Features

- Team Authentication — Dedicated team access.
- Multi-Station Gameplay — Structured clue and station progression.
- Server-Authoritative Progression — Backend controls progression decisions.
- Answer Validation — Server-side verification of submitted answers.
- Admin Dashboard — Organizer controls and event monitoring.
- Live Telemetry — Event activity and submission visibility, subject to implemented functionality.
- Rate Limiting — Helps control excessive requests.
- Responsive UI — Participant interface designed for mobile devices.
- Clue Management — Authorized clue creation and management.
- Event Tracking — Monitor team progress and completion.

🎮 Event Configuration

Setting| Planned Configuration
Teams| 10
Members per team| 5
Total participants| 50
Stations| 4
Riddles| 16
Riddles per station| 4
Event duration| 2 hours

Event configuration may change.

🏗️ Architecture

Participant Mobile Web App
          |
          v
    FastAPI Backend
          |
          v
 Authentication + Validation
          |
          v
 Progression + Event Logic
          |
          v
       Data Storage

Organizer Dashboard
          |
          v
    FastAPI Backend

The frontend handles the user interface and API communication. The backend is responsible for trusted gameplay decisions, authentication, validation and progression.

🛠️ Tech Stack

Frontend

- HTML5
- CSS3
- JavaScript

Backend

- Python
- FastAPI
- Uvicorn

Development & Deployment

- Git & GitHub
- Docker
- Environment-based configuration

📁 Project Structure

Signal-Hunt/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example
│   └── README.md
├── frontend/
│   ├── assets/
│   ├── js/
│   ├── styles/
│   ├── index.html
│   ├── host.html
│   └── README.md
├── .gitignore
└── README.md

🚀 Getting Started

Prerequisites

- Python 3
- pip
- Git

1. Clone the Repository

git clone YOUR_REPOSITORY_URL
cd Signal-Hunt

2. Set Up the Backend

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

3. Configure Environment Variables

Review ".env.example" and configure the required environment variables using your deployment or local configuration method.

Never commit production secrets or real credentials.

4. Start the Backend

Use the project's configured startup command. For a compatible FastAPI application:

uvicorn app.main:app --reload

5. Open the Frontend

Serve the frontend using a local static HTTP server or the project's configured frontend hosting.

Configure the API base URL to match the backend endpoint.

The exact startup and frontend configuration steps must match the implementation.

🔐 Security Principles

- Backend-enforced authorization.
- Server-side answer validation.
- Rate limiting for sensitive endpoints.
- Secrets managed outside version control.
- Input validation and controlled error responses.
- Restricted organizer operations.
- Protection against unauthorized progression.
- Production HTTPS and secure credential handling.

Security measures require testing and verification; listing them here does not establish that the application is secure.

🧪 Testing Checklist

- [ ] Team login and invalid credentials
- [ ] Unauthorized admin access
- [ ] Clue creation and editing
- [ ] Correct and incorrect answer submissions
- [ ] Station and level unlocking
- [ ] Event expiry and timer enforcement
- [ ] Repeated and rapid submissions
- [ ] Concurrent team submissions
- [ ] Data persistence after restart
- [ ] Mobile interface usability
- [ ] Production deployment smoke test

📍 Project Status

Current status: Development / Testing

The project is being prepared for a team-based event. Features, testing results and deployment details will be updated as development progresses.

👥 Contributors

Add contributor names, GitHub profiles and responsibilities.

📄 License

No license specified yet.

Add a license before permitting reuse or redistribution.

---

Built for collaborative problem-solving, fair competition and a better event experience.