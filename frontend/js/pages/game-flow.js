/* Server-authoritative four-level physical envelope hunt. */
window.GameFlow = {
  pollingInterval: null,
  displayInterval: null,
  violationInProgress: false,
  fullscreenWasEntered: false,
  codeSubmissionInProgress: false,

  init() {
    const openChallenge = document.getElementById("preview-host-start");
    if (openChallenge) openChallenge.addEventListener("click", () => {
      const s = window.SignalHuntState;
      if (s.eliminated) return window.Navigation.show("eliminated");
      if (s.gameStatus === "active") window.Navigation.show("active-game");
      else window.Navigation.showToast(s.gameStatus === "paused" ? "The organizer has paused the hunt." : "Wait for the organizer to start the hunt.");
    });

    const submitForm = document.getElementById("station-code-form");
    if (submitForm) submitForm.addEventListener("submit", e => { e.preventDefault(); void this.submitCode(); });
    const codeInput = document.getElementById("station-code-input");
    codeInput?.addEventListener("input", () => {
      const message = document.getElementById("station-code-message");
      if (message) { message.hidden = true; message.textContent = ""; }
    });
    const openCodeEntry = document.getElementById("initiate-transmission");
    if (openCodeEntry) openCodeEntry.addEventListener("click", () => {
      const state = window.SignalHuntState;
      if (state.eliminated || state.completed || state.currentLevelTimedOut || state.gameStatus !== "active") {
        this.renderActiveGame();
        return;
      }
      window.Navigation.show("station-code");
    });
    const retry = document.getElementById("retry-station-code");
    if (retry) retry.addEventListener("click", () => { const input = document.getElementById("station-code-input"); if (input) input.value = ""; window.Navigation.show("station-code"); input?.focus(); });
    const continueButton = document.getElementById("continue-game");
    if (continueButton) continueButton.addEventListener("click", () => window.Navigation.show(window.SignalHuntState.completed ? "complete" : "active-game"));
    const finishButton = document.getElementById("finish-demo");
    if (finishButton) finishButton.addEventListener("click", () => window.Navigation.show("home"));
    const eliminationHome = document.getElementById("elimination-home");
    if (eliminationHome) eliminationHome.addEventListener("click", () => window.Navigation.showToast("This team remains locked until an organizer reinstates it."));
    const reenter = document.getElementById("fullscreen-reenter-button");
    if (reenter) reenter.addEventListener("click", () => this.reenterFullscreen());

    document.addEventListener("fullscreenchange", () => this.handleFullscreenChange());
    this.startPolling();
    this.displayInterval = window.setInterval(() => this.updateTimerDisplay(), 1000);
  },

  enableFullscreenRequirement() {
    const state = window.SignalHuntState;
    if (!state.currentTeam || !state.participantAuthenticated) return;
    state.fullscreenRequired = true;
    this.fullscreenWasEntered = Boolean(document.fullscreenElement);
    if (document.fullscreenElement) {
      this.hideFullscreenGate();
      return;
    }
    this.showFullscreenGate();
  },

  showFullscreenGate() {
    const gate = document.getElementById("fullscreen-gate");
    if (gate) gate.hidden = false;
  },
  hideFullscreenGate() {
    const gate = document.getElementById("fullscreen-gate");
    if (gate) gate.hidden = true;
  },

  async reenterFullscreen() {
    if (typeof document.documentElement.requestFullscreen !== "function") {
      window.Navigation.showToast("This browser does not support required fullscreen mode. Contact the organizer.");
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
      this.hideFullscreenGate();
      this.fullscreenWasEntered = Boolean(document.fullscreenElement);
      const state = window.SignalHuntState;
      if (!state.eliminated) window.Navigation.show("home");
    } catch (_) {
      window.Navigation.showToast("Fullscreen is required. Tap the button again and allow fullscreen.");
    }
  },

  handleFullscreenChange() {
    const state = window.SignalHuntState;
    if (!state.currentTeam || !state.participantAuthenticated || !state.fullscreenRequired) return;
    if (document.fullscreenElement) {
      this.fullscreenWasEntered = true;
      this.hideFullscreenGate();
      return;
    }
    if (!this.fullscreenWasEntered || state.eliminated || this.violationInProgress) return;
    if (state.gameStatus !== "active") {
      this.showFullscreenGate();
      return;
    }
    return this.handleFullscreenExit();
  },

  async handleFullscreenExit() {
    const state = window.SignalHuntState;
    if (!state.currentTeam || !state.participantAuthenticated || state.gameStatus !== "active" || state.eliminated || this.violationInProgress) return;
    this.violationInProgress = true;
    try {
      const result = await window.SignalHuntAPI.reportViolation("fullscreen_exit", "Participant exited required browser fullscreen mode");
      if (result.ok && result.eliminated) {
        state.eliminated = true;
        state.eliminatedReason = result.message || "Fullscreen exit recorded.";
        this.hideFullscreenGate();
        window.Navigation.show("eliminated");
      } else {
        window.Navigation.showToast(result.message || "Could not record fullscreen violation. Contact the organizer immediately.");
      }
    } finally { this.violationInProgress = false; }
  },

  async attemptLogoutViolation() {
    const state = window.SignalHuntState;
    if (!state.currentTeam || state.eliminated) return;
    const result = await window.SignalHuntAPI.reportViolation("logout_attempt", "Participant attempted to log out during the locked session");
    if (result.ok && result.eliminated) {
      state.eliminated = true;
      state.eliminatedReason = result.message || "Attempt to leave the locked participant session.";
      window.Navigation.show("eliminated");
    } else window.Navigation.showToast(result.message || "Logout is disabled after team authentication. Contact the organizer.");
  },

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.refreshStatus();
    this.pollingInterval = window.setInterval(() => this.refreshStatus(), 3000);
  },

  formatTime(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "--:--";
    const s = Math.max(0, Math.floor(Number(seconds)));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, "0")).join(":");
  },

  liveRemaining() {
    const s = window.SignalHuntState;
    if (s.currentLevelRemainingSeconds === null || s.currentLevelRemainingSeconds === undefined) return null;
    let left = Number(s.currentLevelRemainingSeconds);
    if (s.gameStatus === "active" && s.currentLevelTimerActive && s.timerUpdatedAt) left -= Math.floor((Date.now() - s.timerUpdatedAt) / 1000);
    return Math.max(0, left);
  },

  updateTimerDisplay() {
    const state = window.SignalHuntState;
    const remaining = this.liveRemaining();
    const timer = document.getElementById("game-level-timer");
    if (timer) {
      if (state.eliminated) timer.textContent = `ELIMINATED · TIMER CONTINUES ${this.formatTime(remaining)}`;
      else if (state.gameStatus === "waiting") timer.textContent = "TIMER STARTS WHEN THE ORGANIZER STARTS THE GAME";
      else if (state.gameStatus === "paused") timer.textContent = `GAME PAUSED · ${this.formatTime(remaining)}`;
      else if (state.currentLevelTimedOut || remaining === 0) timer.textContent = "LEVEL TIME EXPIRED · CONTACT ORGANIZER";
      else timer.textContent = `LEVEL ${state.currentLevel} REMAINING · ${this.formatTime(remaining)}`;
    }
    const headerTimer = document.getElementById("header-game-timer");
    if (headerTimer) {
      const show = Boolean(state.currentTeam) && ["active", "paused"].includes(state.gameStatus);
      headerTimer.hidden = !show;
      if (state.eliminated) headerTimer.textContent = `LOCK · ${this.formatTime(remaining)}`;
      else if (state.gameStatus === "paused") headerTimer.textContent = `PAUSED · ${this.formatTime(remaining)}`;
      else headerTimer.textContent = `L${state.currentLevel} · ${this.formatTime(remaining)}`;
      headerTimer.title = state.eliminated ? "Eliminated; this level's timer continues" : "Current level timer; updates from server status";
    }
    const homeTitle = document.getElementById("home-status-title");
    if (homeTitle && state.currentTeam && state.gameStatus === "active") homeTitle.textContent = `STATUS: SIGNAL ACTIVE · LEVEL ${state.currentLevel} · ${this.formatTime(remaining)}`;
  },

  async refreshStatus() {
    const state = window.SignalHuntState;
    if (!state.currentTeam || !state.participantAuthenticated) {
      try {
        const publicStatus = await window.SignalHuntAPI.getStatus();
        state.gameStatus = publicStatus.status || "waiting";
        this.updateHomeUI();
      } catch (_) {}
      return;
    }
    try {
      const data = await window.SignalHuntAPI.getTeamCurrent();
      const previouslyEliminated = state.eliminated;
      state.gameStatus = data.status || "waiting";
      state.eliminated = Boolean(data.eliminated);
      state.eliminatedReason = data.eliminated_reason || state.eliminatedReason;
      if (data.progress) window.SignalHuntAPI.applyProgress(data.progress);
      state.timerUpdatedAt = Date.now();

      if (state.eliminated) {
        if (state.currentPage !== "eliminated") window.Navigation.show("eliminated");
      } else if (previouslyEliminated) {
        if (document.fullscreenElement) { this.hideFullscreenGate(); window.Navigation.show("home"); }
        else this.showFullscreenGate();
      }

      if (state.gameStatus === "active" && !document.fullscreenElement) this.showFullscreenGate();
      this.updateHomeUI();
      if (state.currentPage === "active-game") this.renderActiveGame();
      if (state.currentPage === "station-code") this.syncCodeEntryState();
      this.updateTimerDisplay();
    } catch (error) {
      const message = error.message || "";
      if (error.status === 401 || /participant session|invalid team access code|registered device session|not registered for this team/i.test(message)) {
        if (window.Auth?.returnToLogin) await window.Auth.returnToLogin("Your participant session has expired or is no longer valid. Sign in again with your team colour and current team code.");
      } else if (message) window.Navigation.showToast(message);
    }
  },

  updateHomeUI() {
    const state = window.SignalHuntState;
    const title = document.getElementById("home-status-title");
    const body = document.getElementById("home-status-text");
    const button = document.getElementById("preview-host-start");
    if (!title || !body) return;
    if (state.eliminated) {
      title.textContent = "STATUS: TEAM ELIMINATED";
      body.textContent = "Your level timer continues running. Contact the organizer for reinstatement.";
      if (button) { button.textContent = "AWAIT ORGANIZER REINSTATEMENT"; button.disabled = true; }
    } else if (state.gameStatus === "active") {
      title.textContent = `STATUS: SIGNAL ACTIVE · LEVEL ${state.currentLevel} · ${this.formatTime(this.liveRemaining())}`;
      body.textContent = `Levels completed: ${state.completedLevels}/4. Use the physical riddle to find your team's next envelope.`;
      if (button) { button.innerHTML = 'OPEN CURRENT LEVEL <span aria-hidden="true">→</span>'; button.disabled = false; button.className = "btn btn-primary btn-compact"; }
    } else if (state.gameStatus === "paused") {
      title.textContent = "STATUS: GAME PAUSED"; body.textContent = "The organizer has paused gameplay. Level timers are frozen until resumed.";
      if (button) { button.textContent = "HUNT PAUSED BY ORGANIZER"; button.disabled = true; button.className = "btn btn-secondary btn-compact"; }
    } else if (state.gameStatus === "finished") {
      title.textContent = "STATUS: GAME FINISHED"; body.textContent = "Return to Rooms 7 & 8 with the final envelope. Physical volunteers confirm the finish order.";
      if (button) { button.textContent = "EVENT FINISHED"; button.disabled = true; button.className = "btn btn-secondary btn-compact"; }
    } else {
      title.textContent = window.SignalHuntData.copy.waitingTitle; body.textContent = window.SignalHuntData.copy.waitingBody;
      if (button) { button.textContent = "AWAITING ORGANIZER TRANSMISSION"; button.disabled = true; button.className = "btn btn-secondary btn-compact"; }
    }
    if (window.TeamProfile && state.currentTeam) window.TeamProfile.render();
    this.updateTimerDisplay();
  },

  getCurrentStation() {
    const level = window.SignalHuntState.currentLevel || 1;
    return window.SignalHuntData.stations.find(item => item.level === level) || window.SignalHuntData.stations[0];
  },

  renderActiveGame() {
    const state = window.SignalHuntState;
    const level = Math.min(4, Math.max(1, Number(state.currentLevel || 1)));
    const station = this.getCurrentStation();
    const levelLabel = document.getElementById("game-level-label");
    const progressCount = document.getElementById("game-progress-count");
    const title = document.getElementById("game-station-title");
    const desc = document.getElementById("game-station-description");
    const instruction = document.getElementById("game-instruction");
    const icon = document.getElementById("game-topic-icon");
    if (levelLabel) levelLabel.textContent = `LEVEL ${level} OF 4`;
    if (progressCount) progressCount.textContent = `${state.completedLevels} / 4 LEVELS COMPLETE`;
    if (title) title.textContent = `LEVEL ${String(level).padStart(2, "0")}`;
    if (desc) desc.textContent = state.completed ? "All four levels verified" : "Find the physical envelope for your current level.";
    if (instruction) instruction.textContent = state.completed ? "Return to Rooms 7 & 8 with your final envelope. A volunteer confirms finish order." : (state.currentLevelTimedOut ? "Your level timer expired. Ask the organizer whether an extension is available." : "Use the riddle in the physical envelope to discover the location. Find your team's envelope, then enter its unique verification code on this website.");
    if (icon) icon.innerHTML = `<img src="${station.icon}" alt="">`;
    const steps = document.querySelectorAll("#level-track .level-step");
    const connectors = document.querySelectorAll("#level-track .level-connector");
    steps.forEach((step, index) => { step.classList.toggle("is-current", index + 1 === level && !state.completed); step.classList.toggle("is-complete", index + 1 <= state.completedLevels); });
    connectors.forEach((line, index) => line.classList.toggle("is-complete", index + 1 <= state.completedLevels));
    this.updateTimerDisplay();
    const submitButton = document.getElementById("initiate-transmission");
    if (submitButton) {
      submitButton.disabled = state.eliminated || state.gameStatus !== "active" || state.completed || state.currentLevelTimedOut || this.liveRemaining() === 0;
      submitButton.textContent = state.completed ? "ALL LEVELS COMPLETE" : "ENTER ENVELOPE CODE →";
    }
  },

  prepareCodeEntry(focus = true) {
    const state = window.SignalHuntState;
    const label = document.getElementById("code-level-label");
    const input = document.getElementById("station-code-input");
    if (label) label.textContent = `LEVEL ${Math.min(4, state.currentLevel)} OF 4`;
    if (input) { input.placeholder = window.SignalHuntData.copy.stationPlaceholder; this.syncCodeEntryState(); if (focus && !input.disabled) input.focus(); }
  },

  syncCodeEntryState() {
    const state = window.SignalHuntState;
    const input = document.getElementById("station-code-input");
    const form = document.getElementById("station-code-form");
    const submit = form?.querySelector('button[type="submit"]');
    const unavailable = state.currentLevelTimedOut || state.gameStatus !== "active" || state.eliminated || state.completed;
    if (input) input.disabled = unavailable || this.codeSubmissionInProgress;
    if (submit) submit.disabled = unavailable || this.codeSubmissionInProgress;
    if (form) form.setAttribute("aria-disabled", String(unavailable));
  },

  async submitCode() {
    const state = window.SignalHuntState;
    if (this.codeSubmissionInProgress) return;
    if (state.eliminated) return window.Navigation.show("eliminated");
    if (state.gameStatus !== "active") { window.Navigation.showToast("The game is not active. Wait for the organizer."); return; }
    if (state.currentLevelTimedOut || this.liveRemaining() === 0) { window.Navigation.showToast("This level's time has expired. Contact the organizer."); return; }
    const input = document.getElementById("station-code-input");
    const message = document.getElementById("station-code-message");
    const form = document.getElementById("station-code-form");
    const submitButton = form?.querySelector('button[type="submit"]');
    const code = input ? input.value.trim() : "";
    if (!code) { if (message) { message.textContent = window.SignalHuntData.copy.emptyCode; message.className = "form-message error-message"; message.hidden = false; } input?.focus(); return; }
    const levelBeingSubmitted = Number(state.currentLevel || 1);
    this.codeSubmissionInProgress = true;
    if (form) form.setAttribute("aria-busy", "true");
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = "VERIFYING CODE…"; }
    if (input) input.disabled = true;
    try {
      const result = await window.SignalHuntAPI.submitEnvelopeCode(code);
      if (!result.ok) {
        if (message) { message.textContent = result.message || "Could not verify the envelope code. Check your connection and try again."; message.className = "form-message error-message"; message.hidden = false; }
        return;
      }
      if (!result.correct) { window.Navigation.show("code-invalid"); return; }
      if (result.progress) window.SignalHuntAPI.applyProgress(result.progress);
      const successLevel = document.getElementById("success-level-label");
      const successName = document.getElementById("success-station-name");
      const successProgress = document.getElementById("success-progress");
      const continueButton = document.getElementById("continue-game");
      if (successLevel) successLevel.textContent = `LEVEL ${Math.min(4, levelBeingSubmitted)} VERIFIED`;
      if (successName) successName.textContent = "ENVELOPE CODE ACCEPTED";
      if (successProgress) successProgress.textContent = `${state.completedLevels} / 4 LEVELS COMPLETE`;
      if (continueButton) continueButton.textContent = state.completed ? "RETURN TO FINISH ROOM →" : "CONTINUE TO NEXT LEVEL →";
      const successTitle = document.getElementById("success-title"); if (successTitle) successTitle.textContent = state.completed ? "FOUR LEVELS VERIFIED" : "LEVEL VERIFIED — ACCESS GRANTED";
      const successBody = document.querySelector("#view-code-success .result-card > p:not(.section-kicker)"); if (successBody) successBody.textContent = result.message;
      if (input) input.value = "";
      window.Navigation.show(state.completed ? "complete" : "code-success");
    } catch (error) {
      if (message) { message.textContent = error.message || "Could not verify the envelope code. Check your connection and try again."; message.className = "form-message error-message"; message.hidden = false; }
    } finally {
      this.codeSubmissionInProgress = false;
      if (form) form.removeAttribute("aria-busy");
      this.syncCodeEntryState();
      if (submitButton && form?.isConnected) submitButton.textContent = "VERIFY ENVELOPE CODE";
    }
  }
};
