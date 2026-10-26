/* Same-origin FastAPI bridge. No mock-data fallback exists in this package. */
window.SignalHuntAPI = {
  mode: "live",
  participantCsrf: "",

  getDeviceId() {
    try {
      let id = localStorage.getItem("sh_device_uuid");
      if (!id) {
        id = "device_" + (window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem("sh_device_uuid", id);
      }
      return id;
    } catch (_) {
      return "device_session_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  },

  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        cache: "no-store",
        credentials: "same-origin",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {})
        }
      });
    } catch (_) {
      throw new Error("Cannot reach Signal Hunt. Check your connection and ask the organizer whether the server is running.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map(item => item.msg || "Invalid request").join("; ") : `Request failed (HTTP ${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  },

  async getConfig() { return this.request("/api/config"); },
  async getStatus() { return this.request("/api/status"); },

  async login(teamColour, code) {
    try {
      const trimmedCode = (code || "").trim();
      if (!trimmedCode) throw new Error("Enter your team access code.");
      const deviceId = this.getDeviceId();
      const data = await this.request("/api/login", {
        method: "POST",
        body: JSON.stringify({ code: trimmedCode, colour: teamColour, device_id: deviceId })
      });
      if (!data.team) throw new Error("The server returned an unexpected login response.");
      if (!data.csrf_token) throw new Error("The server did not establish a secure participant session.");
      this.participantCsrf = data.csrf_token;
      const returnedColour = String(data.team.colour || "").toLowerCase();
      if (teamColour && returnedColour !== teamColour) throw new Error("That code belongs to a different team colour. Check the colour and try again.");
      const paletteTeam = (window.SignalHuntData.teams || []).find(item => item.id === returnedColour);
      const session = {
        team: {
          id: data.team.id,
          name: data.team.name || "Team",
          colour: returnedColour,
          color: paletteTeam?.color || "#3c4528",
          icon: paletteTeam?.icon || "◆",
          teamSize: Number(data.team.team_size || 3)
        },
        deviceId,
        status: data.status || "waiting",
        progress: data.progress || {}
      };
      this.applySession(session);
      return { ok: true, session };
    } catch (error) {
      return { ok: false, message: error.message || "Login failed." };
    }
  },

  applySession(session) {
    const state = window.SignalHuntState;
    state.currentTeam = session.team;
    state.participantAuthenticated = true;
    state.deviceId = session.deviceId || null;
    state.gameStatus = session.status || "waiting";
    const progress = session.progress || {};
    state.completedLevels = Number(progress.completed_levels || 0);
    state.totalLevels = Number(progress.total_levels || 4);
    state.currentLevel = Number(progress.current_level || 1);
    state.currentLevelRemainingSeconds = progress.current_level_remaining_seconds ?? null;
    state.currentLevelTimeLimitSeconds = progress.current_level_time_limit_seconds ?? null;
    state.currentLevelTimedOut = Boolean(progress.current_level_timed_out);
    state.currentLevelTimerActive = Boolean(progress.current_level_timer_active);
    state.completed = Boolean(progress.completed);
    state.eliminated = Boolean(session.eliminated);
    state.eliminatedReason = session.eliminated_reason || "Contact the organizer for reinstatement.";
    state.timerUpdatedAt = Date.now();
  },

  async restoreParticipantSession() {
    const session = await this.request("/api/team/session");
    if (!session.team || !session.csrf_token) throw new Error("Participant session response was incomplete.");
    this.participantCsrf = session.csrf_token;
    this.applySession(session);
    return session;
  },

  async getTeamCurrent() {
    if (!window.SignalHuntState?.participantAuthenticated) throw new Error("No active team session. Please log in again.");
    return this.request("/api/team/current");
  },

  async submitEnvelopeCode(envelopeCode) {
    const state = window.SignalHuntState;
    if (!state.participantAuthenticated) return { ok: false, message: "No active team session. Please log in again." };
    try {
      const data = await this.request("/api/submit", {
        method: "POST",
        headers: { "X-Participant-CSRF": this.participantCsrf },
        body: JSON.stringify({ envelope_code: (envelopeCode || "").trim() })
      });
      if (data.progress) this.applyProgress(data.progress);
      return { ok: true, correct: Boolean(data.correct), message: data.message || "Submission received.", progress: data.progress };
    } catch (error) {
      return { ok: false, message: error.message || "Envelope code submission failed." };
    }
  },

  applyProgress(progress) {
    const state = window.SignalHuntState;
    state.completedLevels = Number(progress.completed_levels || 0);
    state.totalLevels = Number(progress.total_levels || 4);
    state.currentLevel = Number(progress.current_level || 1);
    state.currentLevelRemainingSeconds = progress.current_level_remaining_seconds ?? null;
    state.currentLevelTimeLimitSeconds = progress.current_level_time_limit_seconds ?? null;
    state.currentLevelTimedOut = Boolean(progress.current_level_timed_out);
    state.currentLevelTimerActive = Boolean(progress.current_level_timer_active);
    state.completed = Boolean(progress.completed);
    state.timerUpdatedAt = Date.now();
  },

  async reportViolation(kind = "back_navigation", details = "") {
    const state = window.SignalHuntState;
    if (!state.participantAuthenticated) return { ok: false, message: "No active team session." };
    try {
      const data = await this.request("/api/violation", {
        method: "POST",
        headers: { "X-Participant-CSRF": this.participantCsrf },
        body: JSON.stringify({ kind, details })
      });
      return { ok: true, ...data };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }
};
