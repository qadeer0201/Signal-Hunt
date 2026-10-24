/* Signal Hunt: Live Participant Gameplay Engine v2.0 */
window.GameFlow = {
  pollingInterval: null,

  init() {
    // Start challenge button on home screen
    const previewBtn = document.getElementById("preview-host-start");
    if (previewBtn) {
      previewBtn.addEventListener("click", () => {
        const state = window.SignalHuntState;
        if (state.gameStatus === "active") {
          window.Navigation.show("active-game");
        } else {
          window.Navigation.showToast("The host has not started the hunt yet. Await the transmission signal.");
        }
      });
    }

    // Initiate transmission from active game
    const initBtn = document.getElementById("initiate-transmission");
    if (initBtn) {
      initBtn.addEventListener("click", () => window.Navigation.show("station-code"));
    }

    // Station code submission
    const form = document.getElementById("station-code-form");
    if (form) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        this.submitCode();
      });
    }

    // Retry code
    const retryBtn = document.getElementById("retry-station-code");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        const input = document.getElementById("station-code-input");
        if (input) input.value = "";
        window.Navigation.show("station-code");
        if (input) input.focus();
      });
    }

    // Continue after correct solve
    const continueBtn = document.getElementById("continue-game");
    if (continueBtn) {
      continueBtn.addEventListener("click", () => {
        const state = window.SignalHuntState;
        if (state.completed || state.solvedCount >= 16) {
          window.Navigation.show("complete");
        } else {
          window.Navigation.show("active-game");
        }
      });
    }

    const finishBtn = document.getElementById("finish-demo");
    if (finishBtn) {
      finishBtn.addEventListener("click", () => window.Navigation.show("home"));
    }

    const elimHome = document.getElementById("elimination-home");
    if (elimHome) {
      elimHome.addEventListener("click", () => window.Navigation.show("home"));
    }

    // Start periodic live polling
    this.startPolling();
  },

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.refreshStatus();
    this.pollingInterval = setInterval(() => this.refreshStatus(), 2500);
  },

  formatTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
  },

  async refreshStatus() {
    const state = window.SignalHuntState;
    if (!state.currentTeam || !state.teamCode) {
      // Not logged in: poll public game status
      try {
        const publicStatus = await window.SignalHuntAPI.getStatus();
        state.gameStatus = publicStatus.status || "waiting";
        state.remainingSeconds = publicStatus.remaining_seconds;
        this.updateHomeUI();
      } catch (_) {}
      return;
    }

    // Logged in: poll team current progress and status
    try {
      const data = await window.SignalHuntAPI.getTeamCurrent(state.teamCode);
      state.gameStatus = data.status || "waiting";
      state.remainingSeconds = data.remaining_seconds;
      state.currentClue = data.current_clue;

      if (data.progress) {
        state.solvedCount = data.progress.solved_count;
        state.currentLevel = data.progress.current_station;
        state.currentRiddle = data.progress.current_riddle;
        state.completed = data.progress.completed;
      }

      this.updateHomeUI();

      // If viewing active game, refresh current challenge display
      if (state.currentPage === "active-game") {
        this.renderActiveGame();
      }
    } catch (err) {
      if (err.message && err.message.includes("eliminated")) {
        state.eliminated = true;
        window.Navigation.show("eliminated");
      }
    }
  },

  updateHomeUI() {
    const state = window.SignalHuntState;
    const title = document.getElementById("home-status-title");
    const body = document.getElementById("home-status-text");
    const button = document.getElementById("preview-host-start");

    if (!title || !body) return;

    const timeStr = this.formatTime(state.remainingSeconds);

    if (state.gameStatus === "active") {
      title.textContent = `STATUS: SIGNAL ACTIVE · ${timeStr}`;
      body.textContent = "The hunt is live; every signal leads closer to the truth.";
      if (button) {
        button.innerHTML = 'OPEN CURRENT CHALLENGE <span aria-hidden="true">→</span>';
        button.className = "btn btn-primary btn-compact";
      }
    } else if (state.gameStatus === "paused") {
      title.textContent = `STATUS: GAME PAUSED · ${timeStr}`;
      body.textContent = "The organizer has paused the game. Submissions are temporarily locked.";
      if (button) {
        button.innerHTML = 'HUNT PAUSED BY ORGANIZER';
        button.className = "btn btn-secondary btn-compact";
      }
    } else if (state.gameStatus === "finished") {
      title.textContent = "STATUS: GAME CONCLUDED";
      body.textContent = "The event countdown has concluded. Report to Rooms 07 & 08.";
      if (button) {
        button.innerHTML = 'EVENT CONCLUDED';
        button.className = "btn btn-secondary btn-compact";
      }
    } else {
      // Waiting
      title.textContent = window.SignalHuntData.copy.waitingTitle;
      body.textContent = window.SignalHuntData.copy.waitingBody;
      if (button) {
        button.innerHTML = 'AWAITING ORGANIZER TRANSMISSION';
        button.className = "btn btn-secondary btn-compact";
      }
    }

    if (window.TeamProfile && state.currentTeam) {
      window.TeamProfile.render();
    }
  },

  getCurrentStation() {
    const level = window.SignalHuntState.currentLevel || 1;
    return window.SignalHuntData.stations.find(item => item.level === level) || window.SignalHuntData.stations[0];
  },

  renderActiveGame() {
    const state = window.SignalHuntState;
    const station = this.getCurrentStation();

    const levelLabel = document.getElementById("game-level-label");
    const progressCount = document.getElementById("game-progress-count");
    const stationTitle = document.getElementById("game-station-title");
    const stationDesc = document.getElementById("game-station-description");
    const instruction = document.getElementById("game-instruction");
    const topicIcon = document.getElementById("game-topic-icon");

    if (levelLabel) levelLabel.textContent = `STATION ${station.level} OF 4`;
    if (progressCount) progressCount.textContent = `${state.solvedCount} / ${state.totalClues} COMPLETE`;
    if (stationTitle) stationTitle.textContent = `${String(station.level).padStart(2, "0")} · ${station.short}`;

    if (state.currentClue) {
      if (stationDesc) stationDesc.textContent = `Riddle #${state.currentRiddle}: ${state.currentClue.title}`;
      if (instruction) instruction.textContent = state.currentClue.prompt;
    } else if (state.completed) {
      if (stationDesc) stationDesc.textContent = "All riddles solved!";
      if (instruction) instruction.textContent = "Return to Rooms 07 & 08 to claim victory.";
    } else {
      if (stationDesc) stationDesc.textContent = window.SignalHuntData.copy.activeBody;
      if (instruction) instruction.textContent = station.instruction;
    }

    if (topicIcon) {
      topicIcon.innerHTML = `<img src="${station.icon}" alt="">`;
    }

    // Step track indicators
    const steps = document.querySelectorAll("#level-track .level-step");
    const connectors = document.querySelectorAll("#level-track .level-connector");

    steps.forEach((step, index) => {
      step.classList.toggle("is-current", index + 1 === station.level);
      step.classList.toggle("is-complete", index + 1 < station.level || state.completed);
    });

    connectors.forEach((line, index) => {
      line.classList.toggle("is-complete", index + 1 < station.level || state.completed);
    });
  },

  prepareCodeEntry() {
    const state = window.SignalHuntState;
    const station = this.getCurrentStation();

    const levelLabel = document.getElementById("code-level-label");
    const input = document.getElementById("station-code-input");
    const message = document.getElementById("station-code-message");

    if (levelLabel) {
      levelLabel.textContent = `STN ${String(station.level).padStart(2, "0")} · R#${state.currentRiddle}`;
    }
    if (input) {
      input.placeholder = window.SignalHuntData.copy.stationPlaceholder;
      input.value = "";
      input.focus();
    }
    if (message) {
      message.hidden = true;
      message.textContent = "";
    }
  },

  async submitCode() {
    const state = window.SignalHuntState;
    const input = document.getElementById("station-code-input");
    const message = document.getElementById("station-code-message");
    const answer = input ? input.value.trim() : "";

    if (!answer) {
      if (message) {
        message.textContent = window.SignalHuntData.copy.emptyCode;
        message.className = "form-message error-message";
        message.hidden = false;
      }
      if (input) input.focus();
      return;
    }

    const currentClueId = state.currentClue ? state.currentClue.id : null;
    const currentStation = state.currentLevel;

    // Send to real backend
    const result = await window.SignalHuntAPI.submitAnswer(answer, currentClueId, currentStation);

    if (!result.ok) {
      if (message) {
        message.textContent = result.message;
        message.className = "form-message error-message";
        message.hidden = false;
      }
      if (result.message && result.message.toLowerCase().includes("rejected")) {
        window.Navigation.show("code-invalid");
      }
      return;
    }

    if (result.correct) {
      const solved = result.progress ? result.progress.solved_count : state.solvedCount;
      const completed = result.progress ? result.progress.completed : state.completed;

      const successLevel = document.getElementById("success-level-label");
      const successStation = document.getElementById("success-station-name");
      const successProgress = document.getElementById("success-progress");
      const continueBtn = document.getElementById("continue-game");

      if (successLevel) successLevel.textContent = `STATION ${state.currentLevel} · RIDDLE #${state.currentRiddle} SOLVED`;
      if (successStation) successStation.textContent = "SIGNAL DECODED";
      if (successProgress) successProgress.textContent = `${String(solved).padStart(2, "0")} / 16 COMPLETE`;
      if (continueBtn) {
        continueBtn.textContent = completed ? "VIEW FINAL TRANSMISSION →" : "NEXT RIDDLE →";
      }

      window.Navigation.show("code-success");
    } else {
      window.Navigation.show("code-invalid");
    }
  }
};
