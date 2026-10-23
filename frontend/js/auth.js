window.Auth = {
  selectedTeamId: "",
  init() {
    this.renderTeamChoices();
    this.renderDemoCodes();
    const form = document.getElementById("login-form");
    form.addEventListener("submit", event => {
      event.preventDefault();
      this.login();
    });
  },
  renderTeamChoices() {
    const list = document.getElementById("team-colour-options");
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
    document.getElementById("team-colour").value = teamId;
    document.querySelectorAll(".team-choice").forEach(button => {
      const selected = button.dataset.teamId === teamId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    this.clearError();
  },
  renderDemoCodes() {
    const box = document.getElementById("demo-team-codes");
    box.innerHTML = window.SignalHuntData.teams.map(team => `<div><span>${team.name}</span><code>${window.SignalHuntMock.teamCodes[team.id]}</code></div>`).join("");
  },
  showError(message) {
    const error = document.getElementById("login-error");
    error.textContent = message;
    error.hidden = false;
  },
  clearError() {
    const error = document.getElementById("login-error");
    error.textContent = "";
    error.hidden = true;
  },
  async login() {
    const teamId = document.getElementById("team-colour").value;
    const code = document.getElementById("team-code").value;
    if (!teamId) return this.showError("Select your team colour to establish your signal.");
    const result = await window.SignalHuntAPI.login(teamId, code);
    if (!result.ok) return this.showError(result.message);
    window.SignalHuntState.currentTeam = result.team;
    window.SignalHuntState.currentLevel = 1;
    window.SignalHuntState.completedLevel = 0;
    window.SignalHuntState.completedStation = null;
    window.SignalHuntState.demoGameStarted = false;
    this.clearError();
    document.getElementById("login-screen").classList.add("is-hidden");
    document.getElementById("app-shell").classList.remove("is-hidden");
    document.getElementById("team-code").value = "";
    if (window.TeamProfile) window.TeamProfile.render();
    window.Navigation.show("home");
    if (window.GameFlow) window.GameFlow.syncMockHostStatus(true);
  },
  logout() {
    window.SignalHuntState.currentTeam = null;
    window.SignalHuntState.currentLevel = 1;
    window.SignalHuntState.completedLevel = 0;
    window.SignalHuntState.completedStation = null;
    window.SignalHuntState.demoGameStarted = false;
    document.getElementById("app-shell").classList.add("is-hidden");
    document.getElementById("login-screen").classList.remove("is-hidden");
    document.getElementById("team-code").value = "";
    this.selectTeam("");
    window.Navigation.show("home");
  }
};
