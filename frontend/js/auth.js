/* Participant authentication. Fullscreen is requested directly from the user login gesture. */
window.Auth = {
  selectedTeamId: "",
  config: null,

  async init() {
    const form = document.getElementById("login-form");
    if (form) form.addEventListener("submit", event => { event.preventDefault(); this.login(); });
    const hostForm = document.getElementById("organizer-login-form");
    hostForm?.addEventListener("submit", event => { event.preventDefault(); this.hostLogin(); });
    document.getElementById("team-login-mode")?.addEventListener("click", () => this.showLoginMode("team"));
    document.getElementById("organizer-login-mode")?.addEventListener("click", () => this.showLoginMode("host"));
    try {
      this.config = await window.SignalHuntAPI.getConfig();
      this.renderTeamChoices();
      const fine = document.querySelector(".login-card .fine-print");
      if (fine) fine.textContent = `TEAM ACCESS ONLY · ${this.config.min_team_size}–${this.config.max_team_size} MEMBERS PER TEAM · FULLSCREEN REQUIRED`;
      const instruction = document.querySelector(".login-instruction");
      if (instruction) {
        const registered = new Set((this.config.registered_colours || []).map(id => String(id).toLowerCase()));
        instruction.textContent = registered.size
          ? `Select your registered team colour and enter the custom access code set by the organizer. Unregistered colours are unavailable.`
          : `No teams are registered yet. Ask the organizer to create teams and set their login codes on the host dashboard.`;
      }
      const capacity = document.getElementById("profile-player-capacity");
      if (capacity) capacity.textContent = `Team size: ${this.config.min_team_size}–${this.config.max_team_size} members`;
      await this.restoreSession();
    } catch (_) {
      this.showError("Cannot load event configuration from the server. Refresh the page or contact the organizer.");
      const choices = document.getElementById("team-colour-options");
      if (choices) choices.innerHTML = '<p role="status">Server configuration unavailable.</p>';
    }
  },

  renderTeamChoices() {
    const list = document.getElementById("team-colour-options");
    if (!list) return;
    const allowed = new Set((this.config?.registered_colours || []).map(id => String(id).toLowerCase()));
    list.innerHTML = "";
    if (!allowed.size) {
      list.innerHTML = '<p class="login-instruction">No teams are registered yet. Ask the organizer to create this event’s teams first.</p>';
      return;
    }
    window.SignalHuntData.teams.filter(team => allowed.has(team.id)).forEach(team => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "team-choice"; button.dataset.teamId = team.id;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `${team.name} team`);
      const swatch = document.createElement("span"); swatch.className = "team-choice-swatch"; swatch.style.setProperty("--team-colour", team.color);
      const label = document.createElement("span"); label.className = "team-choice-label"; label.textContent = team.name;
      const icon = document.createElement("span"); icon.className = "team-choice-symbol"; icon.textContent = team.icon;
      button.append(swatch, label, icon);
      button.addEventListener("click", () => this.selectTeam(team.id));
      list.appendChild(button);
    });
    const instruction = document.querySelector(".login-instruction");
    if (instruction) instruction.textContent = `Select the colour assigned to your team and enter its organizer-provided access code.`;
  },

  selectTeam(teamId) {
    this.selectedTeamId = teamId;
    const input = document.getElementById("team-colour"); if (input) input.value = teamId;
    const code = document.getElementById("team-code"); if (code) code.placeholder = teamId ? "Enter your team access code…" : "Select your team colour first…";
    document.querySelectorAll(".team-choice").forEach(button => {
      const selected = button.dataset.teamId === teamId;
      button.classList.toggle("is-selected", selected); button.setAttribute("aria-pressed", String(selected));
    });
    this.clearError();
  },

  showLoginMode(mode) {
    const team = mode === "team";
    document.getElementById("login-form").hidden = !team;
    document.getElementById("organizer-login-form").hidden = team;
    document.getElementById("team-login-mode").classList.toggle("is-active", team);
    document.getElementById("organizer-login-mode").classList.toggle("is-active", !team);
    document.getElementById("team-login-mode").setAttribute("aria-pressed", String(team));
    document.getElementById("organizer-login-mode").setAttribute("aria-pressed", String(!team));
  },

  async hostLogin() {
    const password = document.getElementById("organizer-password");
    const error = document.getElementById("organizer-login-error");
    const show = message => { error.textContent = message; error.hidden = false; };
    if (!password.value) return show("Enter the organizer password.");
    try {
      const data = await window.SignalHuntAPI.request("/api/admin/login", { method: "POST", body: JSON.stringify({ password: password.value }) });
      password.value = "";
      error.hidden = true;
      window.location.assign("/host");
    } catch (e) { show(e.message); }
  },

  showError(message) {
    const error = document.getElementById("login-error"); if (!error) return;
    error.textContent = message; error.hidden = false;
  },
  clearError() { const error = document.getElementById("login-error"); if (error) { error.textContent = ""; error.hidden = true; } },

  async returnToLogin(message) {
    const state = window.SignalHuntState;
    if (state) {
      state.currentTeam = null; state.participantAuthenticated = false; state.deviceId = null; state.currentPage = "home";
      state.fullscreenRequired = false; state.eliminated = false; state.eliminatedReason = "Contact the organizer if you need access restored.";
      state.completedLevels = 0; state.currentLevel = 1; state.currentLevelRemainingSeconds = null;
      state.currentLevelTimeLimitSeconds = null; state.currentLevelTimedOut = false; state.currentLevelTimerActive = false; state.completed = false;
    }
    window.SignalHuntAPI.participantCsrf = "";
    if (window.GameFlow) window.GameFlow.fullscreenWasEntered = false;
    document.getElementById("app-shell")?.classList.add("is-hidden");
    document.getElementById("login-screen")?.classList.remove("is-hidden");
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {}
    this.showError(message || "Your team session is no longer valid. Please log in again.");
  },

  async login() {
    const teamColour = document.getElementById("team-colour")?.value || "";
    const codeInput = document.getElementById("team-code");
    const code = codeInput ? codeInput.value.trim() : "";
    if (!teamColour) return this.showError("Select your team colour first.");
    const allowed = new Set((this.config?.available_colours || []).map(item => item.id));
    if (!allowed.has(teamColour)) return this.showError("That colour is not available for this event.");
    if (!code) return this.showError("Enter your team's access code.");
    if (!document.fullscreenElement && typeof document.documentElement.requestFullscreen !== "function") {
      return this.showError("This browser does not support required fullscreen mode. Use a supported browser such as current Chrome and try again.");
    }

    // Must be invoked synchronously from this submit gesture before the network request.
    let fullscreenPromise = Promise.resolve();
    if (!document.fullscreenElement) {
      try { fullscreenPromise = document.documentElement.requestFullscreen(); }
      catch (_) { return this.showError("Fullscreen could not start. Tap the login button again and allow fullscreen."); }
    }
    try { await fullscreenPromise; }
    catch (_) { return this.showError("Fullscreen is required to play. Tap login again and allow fullscreen mode."); }

    const result = await window.SignalHuntAPI.login(teamColour, code);
    if (!result.ok) {
      this.showError(result.message);
      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {}
      return;
    }

    this.clearError();
    document.getElementById("login-screen").classList.add("is-hidden");
    document.getElementById("app-shell").classList.remove("is-hidden");
    if (codeInput) codeInput.value = "";
    if (window.TeamProfile) window.TeamProfile.render();
    if (window.Navigation) window.Navigation.show("home");
    if (window.GameFlow) window.GameFlow.enableFullscreenRequirement();
    if (window.GameFlow?.refreshStatus) await window.GameFlow.refreshStatus();
  },

  async restoreSession() {
    try {
      await window.SignalHuntAPI.restoreParticipantSession();
      document.getElementById("login-screen").classList.add("is-hidden");
      document.getElementById("app-shell").classList.remove("is-hidden");
      if (window.TeamProfile) window.TeamProfile.render();
      if (window.Navigation) window.Navigation.show("home");
      if (window.GameFlow) window.GameFlow.enableFullscreenRequirement();
      if (window.GameFlow?.refreshStatus) window.GameFlow.refreshStatus();
      return true;
    } catch (_) {
      window.SignalHuntAPI.participantCsrf = "";
      return false;
    }
  },

  logout() {
    const state = window.SignalHuntState;
    if (state.currentTeam && state.fullscreenRequired) {
      window.GameFlow?.attemptLogoutViolation();
      return;
    }
    state.currentTeam = null; state.participantAuthenticated = false; state.deviceId = null; state.currentLevel = 1; state.completedLevels = 0; state.completed = false; state.eliminated = false;
    state.fullscreenRequired = false;
    if (window.GameFlow) window.GameFlow.fullscreenWasEntered = false;
    window.SignalHuntAPI.participantCsrf = "";
    document.getElementById("app-shell")?.classList.add("is-hidden");
    document.getElementById("login-screen")?.classList.remove("is-hidden");
    const codeInput = document.getElementById("team-code"); if (codeInput) codeInput.value = "";
    this.selectTeam("");
    window.Navigation?.show("home");
  }
};
