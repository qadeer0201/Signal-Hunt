/* Signal Hunt: Live Authentication & Session Manager v2.0 */
window.Auth = {
  selectedTeamId: "",

  init() {
    this.renderTeamChoices();
    this.renderDemoCodes();

    const form = document.getElementById("login-form");
    if (form) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        this.login();
      });
    }

    // Try restoring existing session on page reload
    this.restoreSession();
  },

  renderTeamChoices() {
    const list = document.getElementById("team-colour-options");
    if (!list) return;
    list.innerHTML = "";
    window.SignalHuntData.teams.forEach(team => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "team-choice";
      button.dataset.teamId = team.id;
      button.setAttribute("aria-pressed", "false");
      button.innerHTML = `<span class="team-choice-swatch" style="--team-colour:${team.color}"></span><span>${team.name}</span><span class="team-choice-symbol">${team.icon}</span>`;
      button.addEventListener("click", () => this.selectTeam(team.id));
      list.appendChild(button);
    });
  },

  selectTeam(teamId) {
    this.selectedTeamId = teamId;
    const input = document.getElementById("team-colour");
    if (input) input.value = teamId;
    const codeInput = document.getElementById("team-code");
    if (codeInput && teamId) {
      codeInput.placeholder = `e.g. ${teamId.toUpperCase()}-2026`;
    }
    document.querySelectorAll(".team-choice").forEach(button => {
      const selected = button.dataset.teamId === teamId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    this.clearError();
  },

  renderDemoCodes() {
    const box = document.getElementById("demo-team-codes");
    if (!box) return;
    const codes = [
      { name: "Red", code: "RED-2026", id: "red" },
      { name: "Black", code: "BLACK-2026", id: "black" },
      { name: "Navy Blue", code: "NAVY-2026", id: "navy" },
      { name: "Yellow", code: "YELLOW-2026", id: "yellow" },
      { name: "Orange", code: "ORANGE-2026", id: "orange" },
      { name: "Green", code: "GREEN-2026", id: "green" },
      { name: "Purple", code: "PURPLE-2026", id: "purple" },
      { name: "Grey", code: "GREY-2026", id: "grey" },
      { name: "Brown", code: "BROWN-2026", id: "brown" },
      { name: "Peach", code: "PEACH-2026", id: "peach" }
    ];
    box.innerHTML = codes.map(c => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px dashed #cbbd96; font-size:0.8rem;">
        <span style="font-weight:700;">${c.name}</span>
        <code style="background:#242216; color:#d8ff36; padding:3px 8px; border-radius:4px; font-weight:800; cursor:pointer;" onclick="window.Auth.selectTeam('${c.id}'); document.getElementById('team-code').value='${c.code}';">${c.code}</code>
      </div>
    `).join("");
  },

  showError(message) {
    const error = document.getElementById("login-error");
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  },

  clearError() {
    const error = document.getElementById("login-error");
    if (!error) return;
    error.textContent = "";
    error.hidden = true;
  },

  async login() {
    const teamColourInput = document.getElementById("team-colour");
    const teamCodeInput = document.getElementById("team-code");
    const teamId = teamColourInput ? teamColourInput.value : "";
    const code = teamCodeInput ? teamCodeInput.value.trim() : "";

    if (!teamId) return this.showError("Select your team colour to establish your signal.");
    if (!code) return this.showError("Enter your team access code.");

    const result = await window.SignalHuntAPI.login(teamId, code);
    if (!result.ok) return this.showError(result.message);

    this.clearError();
    document.getElementById("login-screen").classList.add("is-hidden");
    document.getElementById("app-shell").classList.remove("is-hidden");
    if (teamCodeInput) teamCodeInput.value = "";

    if (window.TeamProfile) window.TeamProfile.render();
    window.Navigation.show("home");
    if (window.GameFlow && typeof window.GameFlow.refreshStatus === "function") {
      window.GameFlow.refreshStatus();
    }
  },

  restoreSession() {
    try {
      const raw = sessionStorage.getItem("sh_session");
      if (!raw) return false;
      const session = JSON.parse(raw);
      if (!session || !session.team || !session.code) return false;

      const state = window.SignalHuntState;
      state.currentTeam = session.team;
      state.teamCode = session.code;
      state.gameStatus = session.status || "waiting";
      state.remainingSeconds = session.remaining_seconds || 7200;
      state.currentClue = session.current_clue;

      document.getElementById("login-screen").classList.add("is-hidden");
      document.getElementById("app-shell").classList.remove("is-hidden");

      if (window.TeamProfile) window.TeamProfile.render();
      window.Navigation.show("home");
      if (window.GameFlow && typeof window.GameFlow.refreshStatus === "function") {
        window.GameFlow.refreshStatus();
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  logout() {
    try {
      sessionStorage.removeItem("sh_session");
    } catch (_) {}

    const state = window.SignalHuntState;
    state.currentTeam = null;
    state.teamCode = null;
    state.currentLevel = 1;
    state.currentRiddle = 1;
    state.completedLevel = 0;
    state.solvedCount = 0;
    state.currentClue = null;
    state.completed = false;

    document.getElementById("app-shell").classList.add("is-hidden");
    document.getElementById("login-screen").classList.remove("is-hidden");
    const codeInput = document.getElementById("team-code");
    if (codeInput) codeInput.value = "";
    this.selectTeam("");
    window.Navigation.show("home");
  }
};
