window.GameFlow = {
  init() {
    document.getElementById("preview-host-start").addEventListener("click", () => {
      this.setMockHostStatus("active", true);
    });
    // The host preview syncs between tabs on the SAME browser/origin only.
    // Real syncing across phones must come from the backend API.
    window.addEventListener("storage", event => {
      if (event.key === "signalHuntDemoStatus") this.syncMockHostStatus(true);
    });
    this.syncMockHostStatus(false);
    document.getElementById("initiate-transmission").addEventListener("click", () => window.Navigation.show("station-code"));
    document.getElementById("station-code-form").addEventListener("submit", event => {
      event.preventDefault();
      this.submitCode();
    });
    document.getElementById("retry-station-code").addEventListener("click", () => {
      document.getElementById("station-code-input").value = "";
      window.Navigation.show("station-code");
      document.getElementById("station-code-input").focus();
    });
    document.getElementById("continue-game").addEventListener("click", () => {
      if (window.SignalHuntState.currentLevel >= 4) {
        window.Navigation.show("complete");
      } else {
        window.SignalHuntState.currentLevel += 1;
        window.Navigation.show("active-game");
      }
    });
    document.getElementById("finish-demo").addEventListener("click", () => window.Navigation.show("home"));
    document.getElementById("preview-elimination").addEventListener("click", () => {
      window.SignalHuntState.eliminationReason = "Preview only: leaving the website or navigating back violates the zero-warning policy.";
      document.getElementById("elimination-reason-text").textContent = window.SignalHuntState.eliminationReason;
      window.Navigation.show("eliminated");
    });
    document.getElementById("elimination-home").addEventListener("click", () => window.Navigation.show("home"));
    this.renderDemoCodes();
  },
  readMockHostStatus() {
    try { return localStorage.getItem("signalHuntDemoStatus") || "waiting"; }
    catch (_) { return "waiting"; }
  },
  writeMockHostStatus(status) {
    try { localStorage.setItem("signalHuntDemoStatus", status); }
    catch (_) { /* file:// browsers may block or isolate storage */ }
  },
  setMockHostStatus(status, navigate = false) {
    this.writeMockHostStatus(status);
    this.applyMockHostStatus(status, navigate);
  },
  syncMockHostStatus(navigate = false) {
    this.applyMockHostStatus(this.readMockHostStatus(), navigate);
  },
  applyMockHostStatus(status, navigate = false) {
    const active = status === "active";
    const state = window.SignalHuntState;
    state.demoGameStarted = active;
    if (!active) {
      state.currentLevel = 1;
      state.completedLevel = 0;
      state.completedStation = null;
    }
    const title = document.getElementById("home-status-title");
    const body = document.getElementById("home-status-text");
    const previewButton = document.getElementById("preview-host-start");
    if (title) title.textContent = active ? "STATUS: SIGNAL ACTIVE · DEMO" : window.SignalHuntData.copy.waitingTitle;
    if (body) body.textContent = active
      ? "The host has started the hunt. This is still a local demo until the backend is connected."
      : window.SignalHuntData.copy.waitingBody;
    if (previewButton) previewButton.innerHTML = active
      ? 'OPEN CURRENT CHALLENGE <span aria-hidden="true">→</span>'
      : 'Preview active game (local demo) <span aria-hidden="true">→</span>';
    if (window.TeamProfile && state.currentTeam) window.TeamProfile.render();
    const shell = document.getElementById("app-shell");
    if (active && navigate && shell && !shell.classList.contains("is-hidden") && state.currentTeam) {
      window.Navigation.show("active-game");
    } else if (!active && navigate && shell && !shell.classList.contains("is-hidden") &&
               ["active-game", "station-code", "code-success"].includes(state.currentPage)) {
      window.Navigation.show("home");
    }
  },
  getCurrentStation() {
    return window.SignalHuntData.stations.find(item => item.level === window.SignalHuntState.currentLevel) || window.SignalHuntData.stations[0];
  },
  renderActiveGame() {
    const state = window.SignalHuntState;
    const station = this.getCurrentStation();
    document.getElementById("game-level-label").textContent = `LEVEL ${station.level} OF 4`;
    document.getElementById("game-progress-count").textContent = `${state.completedLevel} / 4 COMPLETE`;
    document.getElementById("game-station-title").textContent = `${String(station.level).padStart(2, "0")} · ${station.short}`;
    document.getElementById("game-station-description").textContent = window.SignalHuntData.copy.activeBody;
    document.getElementById("game-instruction").textContent = station.instruction;
    document.getElementById("game-topic-icon").innerHTML = `<img src="${station.icon}" alt="">`;
    const steps = document.querySelectorAll("#level-track .level-step");
    const connectors = document.querySelectorAll("#level-track .level-connector");
    steps.forEach((step, index) => {
      step.classList.toggle("is-current", index + 1 === station.level);
      step.classList.toggle("is-complete", index + 1 <= state.completedLevel);
    });
    connectors.forEach((line, index) => line.classList.toggle("is-complete", index + 1 <= state.completedLevel));
  },
  renderDemoCodes() {
    const box = document.getElementById("demo-station-codes");
    box.innerHTML = window.SignalHuntData.stations.map(item => `<div><span>Level ${item.level} · ${item.name}</span><code>${window.SignalHuntMock.stationCodes[item.level]}</code></div>`).join("");
  },
  prepareCodeEntry() {
    const station = this.getCurrentStation();
    document.getElementById("code-level-label").textContent = `LVL ${String(station.level).padStart(2, "0")}`;
    document.getElementById("station-code-input").placeholder = window.SignalHuntData.copy.stationPlaceholder;
    document.getElementById("station-code-message").hidden = true;
    document.getElementById("station-code-message").textContent = "";
    document.getElementById("station-code-input").value = "";
  },
  async submitCode() {
    const input = document.getElementById("station-code-input");
    const message = document.getElementById("station-code-message");
    const code = input.value.trim();
    if (!code) {
      message.textContent = window.SignalHuntData.copy.emptyCode;
      message.className = "form-message error-message";
      message.hidden = false;
      input.focus();
      return;
    }
    const result = await window.SignalHuntAPI.verifyStation(window.SignalHuntState.currentLevel, code);
    if (!result.ok) {
      window.Navigation.show("code-invalid");
      return;
    }
    window.SignalHuntState.completedLevel = Math.max(window.SignalHuntState.completedLevel, result.level);
    window.SignalHuntState.completedStation = result.station;
    document.getElementById("success-level-label").textContent = `LEVEL ${result.level} COMPLETE`;
    document.getElementById("success-station-name").textContent = result.station.name.toUpperCase();
    document.getElementById("success-progress").textContent = `${String(result.level).padStart(2, "0")} / 04 COMPLETE`;
    document.getElementById("continue-game").textContent = result.level === 4 ? "VIEW FINAL TRANSMISSION →" : "CONTINUE →";
    window.Navigation.show("code-success");
  }
};
