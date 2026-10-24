/* Signal Hunt: Live FastAPI API Bridge v2.0 */
window.SignalHuntAPI = {
  mode: "live",

  getDeviceId() {
    let id = null;
    try {
      id = localStorage.getItem("sh_device_uuid");
      if (!id) {
        id = "dev_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
        localStorage.setItem("sh_device_uuid", id);
      }
    } catch (_) {
      id = "dev_session_" + Math.random().toString(36).substring(2, 9);
    }
    return id;
  },

  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
    } catch (_) {
      throw new Error("Cannot reach Signal Hunt server. Check your network or server status.");
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.detail || `Request failed (HTTP ${response.status}).`);
    }

    return data;
  },

  async login(teamId, code) {
    try {
      const trimmedCode = (code || "").trim();
      const deviceId = this.getDeviceId();

      const data = await this.request("/api/login", {
        method: "POST",
        body: JSON.stringify({ code: trimmedCode, device_id: deviceId })
      });

      const displayTeam = window.SignalHuntData.teams.find(item => item.id === (data.team.colour || teamId)) ||
                          window.SignalHuntData.teams.find(item => item.id === teamId) ||
                          window.SignalHuntData.teams[0];

      const session = {
        team: {
          id: data.team.id,
          name: data.team.name,
          colour: data.team.colour || teamId,
          color: displayTeam.color,
          icon: displayTeam.icon
        },
        code: trimmedCode,
        deviceId: deviceId,
        status: data.status || "waiting",
        remaining_seconds: data.remaining_seconds,
        current_clue: data.current_clue,
        progress: data.progress || {}
      };

      try {
        sessionStorage.setItem("sh_session", JSON.stringify(session));
      } catch (_) {}

      // Update state
      const state = window.SignalHuntState;
      state.currentTeam = session.team;
      state.teamCode = trimmedCode;
      state.gameStatus = session.status;
      state.remainingSeconds = session.remaining_seconds;
      state.currentClue = session.current_clue;
      if (session.progress) {
        state.solvedCount = session.progress.solved_count || 0;
        state.currentLevel = session.progress.current_station || 1;
        state.currentRiddle = session.progress.current_riddle || 1;
        state.completed = session.progress.completed || false;
      }

      return {
        ok: true,
        session: session
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  },

  async getStatus() {
    return this.request("/api/status");
  },

  async getTeamCurrent(code) {
    const teamCode = code || (window.SignalHuntState && window.SignalHuntState.teamCode);
    if (!teamCode) throw new Error("No active team code.");
    return this.request(`/api/team/current?code=${encodeURIComponent(teamCode)}`);
  },

  async submitAnswer(answer, clueId = null, station = null) {
    const teamCode = window.SignalHuntState.teamCode;
    if (!teamCode) {
      return { ok: false, message: "No active team session. Please log in again." };
    }

    try {
      const payload = {
        code: teamCode,
        answer: (answer || "").trim()
      };
      if (clueId) payload.clue_id = clueId;
      if (station) payload.station = station;

      const data = await this.request("/api/submit", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      // Update local state on solve
      if (data.correct && data.progress) {
        const state = window.SignalHuntState;
        state.solvedCount = data.progress.solved_count;
        state.currentLevel = data.progress.current_station;
        state.currentRiddle = data.progress.current_riddle;
        state.completed = data.progress.completed;
        state.currentClue = data.next_clue;
      }

      return {
        ok: true,
        correct: data.correct,
        message: data.message,
        progress: data.progress,
        next_clue: data.next_clue
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  },

  async reportViolation(kind = "back_navigation", details = "") {
    const teamCode = window.SignalHuntState.teamCode;
    if (!teamCode) return { ok: false };
    try {
      const data = await this.request("/api/violation", {
        method: "POST",
        body: JSON.stringify({ code: teamCode, kind, details })
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
};
