/* Signal Hunt: Live, authenticated host dashboard orchestrator v2.0 */
(() => {
  const $ = id => document.getElementById(id);

  const title = $("host-status-title");
  const badge = $("host-status-badge");
  const description = $("host-status-description");
  const start = $("host-start-button");
  const pause = $("host-reset-button");
  const finish = $("host-finish-button");
  const rearmBtn = $("host-rearm-button");
  const message = $("host-action-message");
  const password = $("host-admin-password");

  const summaryTeams = $("summary-active-teams");
  const summaryDevices = $("summary-devices-count");
  const summaryClues = $("summary-active-clues");
  const summarySolved = $("summary-solved-count");

  const teamsGrid = $("host-teams-grid");
  const riddlesContainer = $("host-riddles-container");
  const logTbody = $("host-log-tbody");
  const logCountBadge = $("log-count-badge");

  // Modals
  const modalRiddle = $("modal-riddle");
  const formRiddle = $("form-riddle");
  const modalRearm = $("modal-rearm");
  const rearmInput = $("rearm-confirm-input");

  let currentStatus = "waiting";
  let busy = false;
  let cachedOverview = null;

  // Restore password from session if available
  const savedPass = sessionStorage.getItem("sh_admin_password");
  if (savedPass && password) {
    password.value = savedPass;
  }

  let passDebounce = null;
  if (password) {
    password.addEventListener("input", () => {
      sessionStorage.setItem("sh_admin_password", password.value.trim());
      clearTimeout(passDebounce);
      passDebounce = setTimeout(() => {
        refresh();
      }, 400);
    });
    password.addEventListener("change", () => {
      clearTimeout(passDebounce);
      refresh();
    });
    password.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        clearTimeout(passDebounce);
        refresh();
      }
    });
  }

  const labels = {
    waiting: ["STATUS: AWAITING THE SIGNAL", "STANDBY", "Participants can review event guides while awaiting organizer transmission."],
    active: ["STATUS: SIGNAL ACTIVE", "LIVE", "Event is live. Official countdown is server-authoritative."],
    paused: ["STATUS: GAME PAUSED", "PAUSED", "Timer paused. Submissions are temporarily locked."],
    finished: ["STATUS: GAME FINISHED", "FINISHED", "Event concluded. All submissions are locked."]
  };

  const stationNames = {
    1: "01 · MORSE CODE",
    2: "02 · BINARY ASCII",
    3: "03 · FSK SIGNALS",
    4: "04 · FINAL CHALLENGE"
  };

  const colourHexMap = {
    red: "#c93636",
    black: "#171717",
    navy: "#233e65",
    yellow: "#e6c83d",
    orange: "#e87832",
    green: "#26794b",
    purple: "#743bb0"
  };

  function formatTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
  }

  function renderStatus(data) {
    currentStatus = data.status || "waiting";
    const info = labels[currentStatus] || labels.waiting;
    title.textContent = info[0];
    badge.textContent = info[1];
    badge.className = "host-status-badge" + (currentStatus === "active" ? " is-active" : "");

    const remaining = Number(data.remaining_seconds);
    description.textContent = info[2] + (Number.isFinite(remaining) ? " Remaining Play Time: " + formatTime(remaining) + "." : "");

    start.disabled = busy || currentStatus !== "waiting";
    start.textContent = currentStatus === "waiting" ? "START CHALLENGE →" : "START UNAVAILABLE";
    pause.disabled = busy || !["active", "paused"].includes(currentStatus);
    pause.textContent = currentStatus === "paused" ? "RESUME GAME" : "PAUSE GAME";
    finish.disabled = busy || ["waiting", "finished"].includes(currentStatus);
  }

  function renderTeams(teams) {
    if (!teamsGrid) return;
    if (!teams || teams.length === 0) {
      teamsGrid.innerHTML = '<p style="color:var(--muted); font-size:0.8rem;">No teams registered yet. Teams can register via participant screen.</p>';
      return;
    }

    let totalDevices = 0;
    let totalSolves = 0;

    teamsGrid.innerHTML = teams.map(t => {
      totalDevices += t.participant_count || 0;
      totalSolves += t.solved_count || 0;

      const swatchColour = colourHexMap[t.colour] || "#3c4528";
      const percent = Math.min(100, Math.round(((t.solved_count || 0) / (t.total_clues || 16)) * 100));

      let badgeClass = "badge-playing";
      let badgeLabel = "PLAYING";
      if (t.eliminated) {
        badgeClass = "badge-eliminated";
        badgeLabel = "ELIMINATED";
      } else if (t.completed) {
        badgeClass = "badge-completed";
        badgeLabel = "COMPLETED";
      }

      return `
        <div class="host-team-card">
          <div class="host-team-header">
            <div class="host-team-name-row">
              <span class="team-swatch" style="background:${swatchColour}"></span>
              <strong class="host-team-title">${t.name}</strong>
            </div>
            <span class="team-badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <div class="host-team-stats">
            <div>Current Station: <b>Station ${t.current_station} (${stationNames[t.current_station] || ''})</b></div>
            <div>Current Riddle: <b>Riddle #${t.current_riddle}</b></div>
            <div>Solved Progress: <b>${t.solved_count} / ${t.total_clues || 16}</b> (${percent}%)</div>
            <div>Connected Devices: <b>${t.participant_count} / 5 devices</b></div>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width:${percent}%"></div>
          </div>
          ${t.eliminated ? `
            <button class="btn btn-secondary btn-compact" style="margin-top:6px;" onclick="window.HostControl.reinstateTeam(${t.id})">
              REINSTATE TEAM
            </button>
          ` : ''}
        </div>
      `;
    }).join("");

    if (summaryTeams) summaryTeams.textContent = `${teams.length} / 12`;
    if (summaryDevices) summaryDevices.textContent = `${totalDevices} connected participant devices (max 60)`;
    if (summarySolved) summarySolved.textContent = `${totalSolves} total riddle solves confirmed`;
  }

  function renderRiddles(clues) {
    if (!riddlesContainer) return;
    if (summaryClues) summaryClues.textContent = `${clues.length}`;

    if (!clues || clues.length === 0) {
      riddlesContainer.innerHTML = '<p style="color:var(--muted); font-size:0.8rem;">No riddles added yet. Click "Seed Template Riddles" or "+ Add Riddle" above.</p>';
      return;
    }

    const stations = [1, 2, 3, 4];
    riddlesContainer.innerHTML = stations.map(stNum => {
      const stClues = clues.filter(c => c.station === stNum).sort((a,b) => a.riddle_order - b.riddle_order);
      return `
        <div class="station-accordion">
          <div class="station-accordion-header">
            <span>STATION ${stNum} — ${stationNames[stNum]}</span>
            <small style="color:var(--lime);">${stClues.length} / 4 RIDDLES</small>
          </div>
          <div class="station-riddles-list">
            ${stClues.length === 0 ? '<div style="color:var(--muted); font-size:0.75rem;">No riddles configured for this station.</div>' : ''}
            ${stClues.map(c => `
              <div class="riddle-item">
                <div class="riddle-item-info">
                  <strong>#${c.riddle_order} · ${c.title}</strong>
                  <small>${c.prompt ? (c.prompt.length > 80 ? c.prompt.slice(0, 80) + '…' : c.prompt) : ''}</small>
                </div>
                <div style="display:flex; gap:6px;">
                  <button class="btn btn-secondary btn-compact" style="padding:4px 8px; font-size:0.65rem;" onclick='window.HostControl.openEditRiddle(${JSON.stringify(c)})'>EDIT</button>
                  <button class="btn btn-danger btn-compact" style="padding:4px 8px; font-size:0.65rem;" onclick="window.HostControl.deleteRiddle(${c.id})">✕</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderLogs(events, submissions) {
    if (!logTbody) return;
    const combined = [];

    (events || []).forEach(e => {
      combined.push({
        time: e.created_at,
        team: e.team || "SYSTEM",
        type: e.kind,
        details: e.details,
        isEvent: true
      });
    });

    (submissions || []).forEach(s => {
      combined.push({
        time: s.created_at,
        team: s.team,
        type: s.correct ? "SUBMISSION_CORRECT" : "SUBMISSION_INCORRECT",
        details: `Station ${s.station} R#${s.riddle_order}: "${s.answer}"`,
        correct: s.correct
      });
    });

    combined.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recent = combined.slice(0, 50);

    if (logCountBadge) logCountBadge.textContent = `${recent.length} EVENTS`;

    if (recent.length === 0) {
      logTbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted); text-align:center;">No activity recorded yet.</td></tr>';
      return;
    }

    logTbody.innerHTML = recent.map(row => {
      const timeStr = row.time ? new Date(row.time).toLocaleTimeString() : "--";
      let resClass = "";
      if (row.type === "SUBMISSION_CORRECT" || row.type === "game_started") resClass = "log-success";
      else if (row.type === "SUBMISSION_INCORRECT") resClass = "log-fail";
      else if (row.type === "team_eliminated") resClass = "log-alert";

      return `
        <tr>
          <td>${timeStr}</td>
          <td><strong>${row.team}</strong></td>
          <td>${row.type}</td>
          <td class="${resClass}">${row.details}</td>
        </tr>
      `;
    }).join("");
  }

  async function refresh() {
    const secret = password ? password.value.trim() : "";
    if (secret) {
      try {
        const r = await fetch("/api/admin/overview", {
          headers: { "X-Admin-Password": secret },
          cache: "no-store"
        });
        if (r.status === 401) {
          message.textContent = "Organizer authentication failed. Check password.";
          return;
        }
        if (r.status === 429) {
          message.textContent = "Rate limited: too many failed attempts. Please wait.";
          return;
        }
        if (!r.ok) throw new Error("Overview HTTP " + r.status);

        const data = await r.json();
        cachedOverview = data;
        renderStatus(data.game_state || {});
        renderTeams(data.teams || []);
        renderRiddles(data.clues || []);
        renderLogs(data.events || [], data.submissions || []);
        message.textContent = "Authenticated. Live telemetry synced at " + new Date().toLocaleTimeString();
        return;
      } catch (err) {
        // Fall back to public status
      }
    }

    // Public status fallback
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        renderStatus(data);
      }
    } catch (_) {
      message.textContent = "Cannot reach Signal Hunt backend. Ensure the server is running.";
    }
  }

  async function controlGame(action) {
    if (busy) return;
    const secret = password.value.trim();
    if (!secret) {
      alert("Enter the organizer password first.");
      password.focus();
      return;
    }

    if (action === "finish" && !confirm("Conclude the game for all participants? Further answer submissions will be locked.")) {
      return;
    }

    busy = true;
    message.textContent = `Sending ${action} request to server…`;

    try {
      const res = await fetch(`/api/admin/game/${action}`, {
        method: "POST",
        headers: { "X-Admin-Password": secret }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Action failed (${res.status})`);
      renderStatus(data);
      message.textContent = `Server confirmed: Game ${action} successful.`;
    } catch (e) {
      message.textContent = e.message;
    } finally {
      busy = false;
      await refresh();
    }
  }

  // Window-level host actions
  window.HostControl = {
    async reinstateTeam(teamId) {
      const secret = password.value.trim();
      if (!secret) return alert("Enter organizer password.");
      try {
        const res = await fetch(`/api/admin/team/${teamId}/reinstate`, {
          method: "POST",
          headers: { "X-Admin-Password": secret }
        });
        if (!res.ok) throw new Error("Failed to reinstate team.");
        message.textContent = "Team reinstated successfully.";
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    },

    openAddRiddle() {
      $("modal-riddle-title").textContent = "Add Station Riddle";
      $("riddle-edit-id").value = "";
      formRiddle.reset();
      modalRiddle.hidden = false;
    },

    openEditRiddle(clue) {
      $("modal-riddle-title").textContent = `Edit Riddle (ID: ${clue.id})`;
      $("riddle-edit-id").value = clue.id;
      $("riddle-station").value = clue.station;
      $("riddle-order").value = clue.riddle_order;
      $("riddle-title").value = clue.title;
      $("riddle-prompt").value = clue.prompt;
      $("riddle-answer").value = ""; // Don't expose hash; prompt for new answer
      $("riddle-answer").placeholder = "Leave blank to keep existing answer, or type new answer";
      $("riddle-answer").required = false;
      modalRiddle.hidden = false;
    },

    async deleteRiddle(clueId) {
      if (!confirm("Delete this riddle? Teams will skip this riddle.")) return;
      const secret = password.value.trim();
      try {
        const res = await fetch(`/api/admin/clues/${clueId}`, {
          method: "DELETE",
          headers: { "X-Admin-Password": secret }
        });
        if (!res.ok) throw new Error("Delete failed.");
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    },

    async seedTemplateRiddles() {
      const secret = password.value.trim();
      if (!secret) return alert("Enter organizer password first.");
      if (!confirm("Populate 16 template riddles across the 4 stations? (You can edit answers anytime).")) return;

      const templates = [
        // Station 1: Morse Code
        { station: 1, order: 1, title: "The First Rhythm", prompt: "Decode the short and long pulses: .... ..", answer: "hi" },
        { station: 1, order: 2, title: "Distress Beacon", prompt: "Decode the international signal: ... --- ...", answer: "sos" },
        { station: 1, order: 3, title: "Signal Origin", prompt: "Identify the founder's initial signal: .--. .- - - . .-. -.", answer: "pattern" },
        { station: 1, order: 4, title: "Station 1 Envelope Key", prompt: "Enter the classified station envelope code for Morse Code:", answer: "morse-station-clear" },

        // Station 2: Binary ASCII
        { station: 2, order: 1, title: "Digital Awakening", prompt: "Convert 8-bit binary: 01000001 01010011 01000011 01001001 01001001", answer: "ascii" },
        { station: 2, order: 2, title: "Bit Stream Alpha", prompt: "Decode: 01001100 01001111 01000111 01001001 01000011", answer: "logic" },
        { station: 2, order: 3, title: "Nyquist Limit", prompt: "Decode byte sequence: 01010011 01001001 01000111 01001110 01000001 01001100", answer: "signal" },
        { station: 2, order: 4, title: "Station 2 Envelope Key", prompt: "Enter the classified envelope verification code for Binary ASCII:", answer: "binary-station-clear" },

        // Station 3: FSK Signals
        { station: 3, order: 1, title: "Frequency Carrier", prompt: "FSK transmission detected. Low freq = 0, High freq = 1: L-H-L-H-L-H-L-H -> 01010101. Enter binary state hex:", answer: "55" },
        { station: 3, order: 2, title: "Shift Keying Spectrum", prompt: "Decode signal modulation identifier: 01010011 01001000 01001001 01000110 01010100", answer: "shift" },
        { station: 3, order: 3, title: "Modulation Depth", prompt: "Waveform analysis shows: 01010111 01000001 01010110 01000101", answer: "wave" },
        { station: 3, order: 4, title: "Station 3 Envelope Key", prompt: "Enter the classified envelope verification code for FSK Signals:", answer: "fsk-station-clear" },

        // Station 4: Final Challenge
        { station: 4, order: 1, title: "Convergent Frequencies", prompt: "Combine Morse spacing with Binary offsets to reveal keyword: 01010100 01010010 01010101 01010100 01001000", answer: "truth" },
        { station: 4, order: 2, title: "Cipher Decoupling", prompt: "Decode the operative passkey: 01000011 01001001 01010000 01001000 01000101 01010010", answer: "cipher" },
        { station: 4, order: 3, title: "Final Node Beacon", prompt: "The ultimate signal destination: 01001110 01000101 01011000 01010101 01010011", answer: "nexus" },
        { station: 4, order: 4, title: "Nexus Vyoma Master Key", prompt: "Enter the classified Grand Final transmission passkey:", answer: "signal-hunt-conquered" }
      ];

      for (const t of templates) {
        await fetch("/api/admin/clues", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Password": secret
          },
          body: JSON.stringify({
            station: t.station,
            riddle_order: t.order,
            title: t.title,
            prompt: t.prompt,
            answer: t.answer,
            active: true
          })
        });
      }

      alert("16 template riddles generated successfully! Organizers can now update titles, prompts, and answers.");
      await refresh();
    }
  };

  // Wire buttons
  if (start) start.addEventListener("click", () => controlGame("start"));
  if (pause) pause.addEventListener("click", () => controlGame(currentStatus === "paused" ? "resume" : "pause"));
  if (finish) finish.addEventListener("click", () => controlGame("finish"));

  if ($("btn-add-riddle")) $("btn-add-riddle").addEventListener("click", () => window.HostControl.openAddRiddle());
  if ($("btn-seed-riddles")) $("btn-seed-riddles").addEventListener("click", () => window.HostControl.seedTemplateRiddles());

  if ($("btn-cancel-riddle")) $("btn-cancel-riddle").addEventListener("click", () => { modalRiddle.hidden = true; });

  if (formRiddle) {
    formRiddle.addEventListener("submit", async e => {
      e.preventDefault();
      const secret = password.value.trim();
      if (!secret) return alert("Enter organizer password.");

      const editId = $("riddle-edit-id").value;
      const payload = {
        station: Number($("riddle-station").value),
        riddle_order: Number($("riddle-order").value),
        title: $("riddle-title").value.trim(),
        prompt: $("riddle-prompt").value.trim(),
        active: true
      };

      const ans = $("riddle-answer").value.trim();
      if (ans) payload.answer = ans;

      try {
        const url = editId ? `/api/admin/clues/${editId}` : "/api/admin/clues";
        const method = editId ? "PUT" : "POST";
        const res = await fetch(url, {
          method: method,
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Password": secret
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("Failed to save riddle.");
        modalRiddle.hidden = true;
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Re-arm workflow
  if (rearmBtn) {
    rearmBtn.addEventListener("click", () => {
      rearmInput.value = "";
      modalRearm.hidden = false;
      rearmInput.focus();
    });
  }

  if ($("btn-cancel-rearm")) {
    $("btn-cancel-rearm").addEventListener("click", () => {
      modalRearm.hidden = true;
    });
  }

  if ($("btn-confirm-rearm")) {
    $("btn-confirm-rearm").addEventListener("click", async () => {
      const val = rearmInput.value.trim();
      if (val !== "RESET_SIGNAL_HUNT") {
        alert("Confirmation string must exactly match 'RESET_SIGNAL_HUNT'.");
        return;
      }
      const secret = password.value.trim();
      if (!secret) return alert("Enter organizer password.");

      try {
        const res = await fetch("/api/admin/game/reset", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Password": secret
          },
          body: JSON.stringify({
            confirm: "RESET_SIGNAL_HUNT",
            clear_submissions: true,
            reset_teams: false
          })
        });
        if (!res.ok) throw new Error("Failed to reset game.");
        modalRearm.hidden = true;
        alert("Game has been re-armed to WAITING state with 120 minutes remaining.");
        await refresh();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Initial fetch and 2.5s poll
  refresh();
  window.setInterval(refresh, 2500);
})();
