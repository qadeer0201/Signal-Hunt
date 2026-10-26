/* Signal Hunt organizer console. Private routes and answers are only shown after admin auth. */
(() => {
  const $ = id => document.getElementById(id);
  const els = {
    title: $("host-status-title"), badge: $("host-status-badge"), description: $("host-status-description"),
    start: $("host-start-button"), pause: $("host-reset-button"), finish: $("host-finish-button"), rearm: $("host-rearm-button"), eventReset: $("host-event-reset-button"),
    message: $("host-action-message"), password: { value: "authenticated", focus() {}, addEventListener() {} }, teamsMetric: $("summary-active-teams"),
    devicesMetric: $("summary-devices-count"), levelsMetric: $("summary-active-clues"), completedMetric: $("summary-solved-count"),
    teamsGrid: $("host-teams-grid"), logs: $("host-log-tbody"), logsBadge: $("log-count-badge"), profileNote: $("event-profile-note"),
    formTeam: $("form-team"), teamName: $("team-name"), teamColour: $("team-colour-select"), teamSize: $("team-size"), teamCode: $("team-access-code"),
    teamMessage: $("team-action-message"), teamCreated: $("team-created-panel"), teamCreatedCode: $("team-created-code"), copyTeamCode: $("btn-copy-team-code"),
    formTimes: $("form-level-times"), timesContainer: $("level-times-container"), timesMessage: $("level-times-message"),
    formRoute: $("form-team-level"), routeTeam: $("route-team"), routeLevel: $("route-level"), routeStation: $("route-station"),
    routeCode: $("route-code"), routeNotes: $("route-riddle-notes"), routePuzzleNote: $("route-puzzle-note"), routeMessage: $("route-action-message"), routesContainer: $("host-riddles-container"),
    modalRearm: $("modal-rearm"), rearmInput: $("rearm-confirm-input"), modalEventReset: $("modal-event-reset"), eventResetInput: $("event-reset-confirm-input"), auditTeam: $("audit-team-filter"), auditKind: $("audit-kind-filter"),
    modalEditTeam: $("modal-edit-team"), editTeamForm: $("form-edit-team"), editTeamName: $("edit-team-name"), editTeamColour: $("edit-team-colour"), editTeamSize: $("edit-team-size"), editTeamFeedback: $("edit-team-feedback"),
    modalGame: $("modal-game-confirm"), gameConfirmTitle: $("game-confirm-title"), gameConfirmDescription: $("game-confirm-description"),
    gameConfirmButton: $("btn-confirm-game-action"), gameCancelButton: $("btn-cancel-game-action"),
    auditFilter: $("audit-filter-button"), auditPrev: $("audit-prev"), auditNext: $("audit-next"), auditPage: $("audit-page-label"), routeSaveStatus: $("route-save-status")
  };

  let config = null;
  let overview = null;
  let currentStatus = "waiting";
  let busy = false;
  let refreshing = false;
  let refreshQueued = false;
  let recentlySavedRouteCode = "";
  let recentlySavedRouteKey = "";
  // Prevent the 5-second dashboard poll from overwriting organizer text currently being edited.
  let routeFormDirty = false;
  let lastRouteSelection = { team: "", level: "1" };
  let hostFeedbackUntil = 0;
  let csrfToken = "";
  let auditOffset = 0;
  let auditTotal = 0;
  let pendingGameAction = null;
  let pendingTeamCsv = null, pendingRouteCsv = null, pendingRandomRoutes = null;
  let editingTeamId = null;
  const levelLabels = { 1: "Morse", 2: "Binary", 3: "FSK", 4: "Combined" };
  const statusLabels = {
    waiting: ["STATUS: AWAITING THE SIGNAL", "STANDBY", "Teams can log in and prepare. The host starts the level timers."],
    active: ["STATUS: SIGNAL ACTIVE", "LIVE", "The hunt is active. Each team's current-level timer is controlled by the server."],
    paused: ["STATUS: GAME PAUSED", "PAUSED", "Game actions are paused. Existing level time is preserved."],
    finished: ["STATUS: GAME FINISHED", "FINISHED", "Gameplay has ended. Physical volunteers confirm the official finishing order."]
  };

  const setHostMessage = (message, holdMs = 15000) => {
    if (els.message) els.message.textContent = message;
    hostFeedbackUntil = Date.now() + holdMs;
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = seconds => {
    if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "NOT STARTED";
    const s = Math.max(0, Math.floor(Number(seconds)));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(x => String(x).padStart(2, "0")).join(":");
  };

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (csrfToken && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
    if (options.body) headers["Content-Type"] = "application/json";
    let response;
    try { response = await fetch(path, { cache: "no-store", ...options, headers }); }
    catch (_) { throw new Error("Cannot reach Signal Hunt. Check that the local server terminal is still running."); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map(x => x.msg || "Invalid request").join("; ") : `Request failed (HTTP ${response.status}).`);
    }
    return data;
  }

  function currentTeamRoute(teamId, level) {
    const team = (overview?.teams || []).find(item => Number(item.id) === Number(teamId));
    return team?.route?.find(item => Number(item.level) === Number(level)) || null;
  }

  function getStartBlockers() {
    const teams = overview?.teams || [];
    const blockers = [];
    const minimum = Number(config?.min_teams || 4);
    const maximum = Number(config?.max_teams || 10);
    if (!overview) return ["Enter a valid organizer password first so the dashboard can load the current setup."];
    if (teams.length < minimum) blockers.push(`Create at least ${minimum} teams; currently ${teams.length} are registered.`);
    if (teams.length > maximum) blockers.push(`This event allows at most ${maximum} teams.`);
    for (const team of teams) {
      const byLevel = new Map((team.route || []).map(row => [Number(row.level), row]));
      const missing = [];
      for (let level = 1; level <= 4; level++) {
        const row = byLevel.get(level);
        if (!row || !row.configured || !String(row.riddle_notes || "").trim()) missing.push(String(level));
      }
      if (missing.length) blockers.push(`${team.name}: configure level(s) ${missing.join(", ")} with riddle notes and envelope codes.`);
      const stations = [...byLevel.values()].map(row => String(row.station_id || "").toUpperCase());
      if (stations.length === 4 && (new Set(stations).size !== 4 || !["A", "B", "C", "D"].every(id => stations.includes(id)))) {
        blockers.push(`${team.name}: assign internal markers A, B, C and D exactly once each.`);
      }
    }
    return blockers;
  }
  function allRoutesReady() { return getStartBlockers().length === 0; }

  function renderStatus(data) {
    currentStatus = data.status || "waiting";
    const text = statusLabels[currentStatus] || statusLabels.waiting;
    if (els.title) els.title.textContent = text[0];
    if (els.badge) { els.badge.textContent = text[1]; els.badge.className = "host-status-badge" + (currentStatus === "active" ? " is-active" : ""); }
    if (els.description) {
      const configured = (overview?.teams || []).filter(team => Number(team.route_configured_count) === 4).length;
      const teamPart = overview ? ` Routes configured: ${configured}/${overview.teams.length} teams.` : "";
      els.description.textContent = text[2] + teamPart;
    }
    if (els.start) {
      // Keep Start clickable while waiting so a missing setup explains itself rather
      // than looking like a dead button. The backend still enforces all requirements.
      els.start.disabled = busy || currentStatus !== "waiting";
      const blockers = getStartBlockers();
      els.start.title = blockers.length ? `Not ready: ${blockers[0]}` : "Start the game";
    }
    if (els.description && overview && currentStatus === "waiting") {
      const blockers = getStartBlockers();
      if (blockers.length) {
        const short = blockers.slice(0, 2).join(" ");
        els.description.textContent = `${text[2]} Routes configured: ${(overview.teams || []).filter(team => Number(team.route_configured_count) === 4).length}/${(overview.teams || []).length} teams. Start checklist: ${short}${blockers.length > 2 ? ` Plus ${blockers.length - 2} more requirement(s).` : ""}`;
      }
    }
    if (els.pause) { els.pause.disabled = busy || !["active", "paused"].includes(currentStatus); els.pause.textContent = currentStatus === "paused" ? "RESUME GAME" : "PAUSE GAME"; }
    if (els.finish) els.finish.disabled = busy || ["waiting", "finished"].includes(currentStatus);
    if (els.rearm) els.rearm.disabled = busy;
    if (els.eventReset) els.eventReset.disabled = busy || ["active", "paused"].includes(currentStatus);
  }

  function renderTeamColourOptions() {
    if (!els.teamColour || !config) return;
    const used = new Set((overview?.teams || []).map(t => String(t.colour).toLowerCase()));
    const old = els.teamColour.value;
    els.teamColour.innerHTML = "";
    const ph = document.createElement("option"); ph.value = ""; ph.textContent = "Select colour"; els.teamColour.appendChild(ph);
    (config.available_colours || []).forEach(item => {
      const option = document.createElement("option"); option.value = item.id;
      option.textContent = used.has(item.id) ? `${item.name} — assigned` : item.name;
      option.disabled = used.has(item.id); els.teamColour.appendChild(option);
    });
    els.teamColour.value = (config.available_colours || []).some(x => x.id === old && !used.has(old)) ? old : "";
    const full = (overview?.teams || []).length >= Number(config.max_teams || 10) || used.size >= 10;
    const button = $("btn-create-team"); if (button) button.disabled = full || currentStatus === "active" || currentStatus === "paused";
    if (els.teamMessage && full) els.teamMessage.textContent = `All available team slots or colours are used (${config.max_teams} team maximum).`;
  }

  function renderTeams(teams) {
    if (!els.teamsGrid) return;
    let devices = 0, configuredRows = 0, completedLevels = 0;
    const colours = new Map((config?.available_colours || []).map(x => [x.id, x.colour]));
    if (!teams.length) {
      els.teamsGrid.innerHTML = '<p class="host-note">No teams created yet. Create at least four teams to prepare the game.</p>';
    } else {
      els.teamsGrid.innerHTML = teams.map(team => {
        devices += Number(team.participant_count || 0);
        configuredRows += Number(team.route_configured_count || 0);
        completedLevels += Number(team.completed_levels || 0);
        const eliminated = Boolean(team.eliminated), completed = Boolean(team.completed);
        const badge = eliminated ? ["badge-eliminated", "ELIMINATED"] : completed ? ["badge-completed", "LEVELS COMPLETE"] : ["badge-playing", "REGISTERED"];
        const progress = Number(team.completed_levels || 0);
        const pct = Math.min(100, Math.round(progress / 4 * 100));
        const routeSummary = [1,2,3,4].map(level => {
          const r = currentTeamRoute(team.id, level);
          return `<span class="route-chip" title="${escapeHtml(levelLabels[level])}">${level}:${r?.configured ? escapeHtml(r.station_id) : "—"}</span>`;
        }).join(" ");
        return `<article class="host-team-card">
          <div class="host-team-header"><div class="host-team-name-row"><span class="team-swatch" style="background:${escapeHtml(colours.get(team.colour) || "#3c4528")}"></span><strong class="host-team-title">${escapeHtml(team.name)}</strong></div><span class="team-badge ${badge[0]}">${badge[1]}</span></div>
          <div class="host-team-stats">
            <div>Colour: <b>${escapeHtml(team.colour)}</b> · Team size: <b>${Number(team.team_size)}</b></div>
            <div>Devices used: <b>${Number(team.participant_count || 0)}/${Number(team.team_size)}</b></div>
            <div>Levels completed: <b>${progress}/4</b> · Route set: <b>${Number(team.route_configured_count || 0)}/4</b></div>
            <div>Organizer route (level:station): <b>${routeSummary}</b></div>
            ${team.eliminated_reason ? `<div>Reason: <b>${escapeHtml(team.eliminated_reason)}</b></div>` : ""}
          </div>
          <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
          <div class="host-team-actions"><button class="btn btn-secondary btn-compact" data-config-team="${Number(team.id)}">CONFIGURE ROUTE</button><button class="btn btn-secondary btn-compact" data-edit-team="${Number(team.id)}"${["waiting", "finished"].includes(currentStatus) ? "" : " disabled"}>EDIT DETAILS</button><button class="btn btn-secondary btn-compact" data-reset-team-code="${Number(team.id)}"${["waiting", "finished"].includes(currentStatus) ? "" : " disabled"}>RESET LOGIN CODE</button>${currentStatus === "waiting" ? `<button class="btn btn-danger btn-compact" data-remove-team="${Number(team.id)}">REMOVE TEAM</button>` : ""}${eliminated ? `<button class="btn btn-secondary btn-compact" data-reinstate-team="${Number(team.id)}">REINSTATE</button>` : ""}</div>
        </article>`;
      }).join("");
      els.teamsGrid.querySelectorAll("[data-reinstate-team]").forEach(button => button.addEventListener("click", () => reinstateTeam(Number(button.dataset.reinstateTeam))));
      els.teamsGrid.querySelectorAll("[data-edit-team]").forEach(button => button.addEventListener("click", () => editTeam(Number(button.dataset.editTeam))));
      els.teamsGrid.querySelectorAll("[data-remove-team]").forEach(button => button.addEventListener("click", () => removeTeam(Number(button.dataset.removeTeam))));
      els.teamsGrid.querySelectorAll("[data-config-team]").forEach(button => button.addEventListener("click", () => { selectRoute(button.dataset.configTeam, els.routeLevel.value || 1); els.formRoute.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    }
    if (els.teamsMetric) els.teamsMetric.textContent = `${teams.length}/${Number(config?.max_teams || 10)}`;
    if (els.devicesMetric) els.devicesMetric.textContent = `${devices} registered devices · maximum ${Number(config?.max_participants || 50)}`;
    if (els.levelsMetric) els.levelsMetric.textContent = `${configuredRows}/${teams.length * 4 || 0}`;
    if (els.completedMetric) els.completedMetric.textContent = `${completedLevels} level completions recorded`;
    renderTeamColourOptions();
    populateRouteTeamChoices();
  }

  function populateRouteTeamChoices() {
    if (!els.routeTeam) return;
    const old = els.routeTeam.value;
    els.routeTeam.innerHTML = "";
    const ph = document.createElement("option"); ph.value = ""; ph.textContent = "Select team"; els.routeTeam.appendChild(ph);
    (overview?.teams || []).forEach(team => {
      const option = document.createElement("option"); option.value = String(team.id); option.textContent = `${team.name} (${team.colour})`; els.routeTeam.appendChild(option);
    });
    if ((overview?.teams || []).some(t => String(t.id) === old)) els.routeTeam.value = old;
    populateRouteForm();
  }

  function selectRoute(teamId, level) {
    if (routeFormDirty && !window.confirm("Discard unsaved route notes/code and switch to another team or level?")) return false;
    routeFormDirty = false;
    els.routeTeam.value = String(teamId || "");
    els.routeLevel.value = String(level || 1);
    lastRouteSelection = { team: els.routeTeam.value, level: els.routeLevel.value };
    populateRouteForm(true);
    return true;
  }

  function handleRouteSelectionChange() {
    const next = { team: els.routeTeam.value, level: String(els.routeLevel.value || "1") };
    if (routeFormDirty && !window.confirm("Discard unsaved route notes/code and load the selected team/level?")) {
      els.routeTeam.value = lastRouteSelection.team;
      els.routeLevel.value = lastRouteSelection.level;
      return;
    }
    routeFormDirty = false;
    lastRouteSelection = next;
    populateRouteForm(true);
  }

  function populateRouteForm(force = false) {
    if (!els.routeLevel || !els.routeStation || !els.routeNotes || !els.routeCode) return;
    // The dashboard polls every 5 seconds. Do not replace in-progress notes/codes with older saved values.
    if (routeFormDirty && !force) return;
    lastRouteSelection = { team: els.routeTeam.value, level: String(els.routeLevel.value || "1") };
    const teamId = Number(els.routeTeam.value), level = Number(els.routeLevel.value || 1);
    const saved = teamId ? currentTeamRoute(teamId, level) : null;
    if (els.routeSaveStatus) els.routeSaveStatus.textContent = saved?.configured ? "Saved" : "Not saved yet";
    const puzzle = levelLabels[level] || "Puzzle";
    if (els.routePuzzleNote) els.routePuzzleNote.textContent = `Level ${level} uses ${puzzle}. Set the organizer-only physical station marker and notes. Each team must use A, B, C and D once; participants will not see these markers or notes.`;
    const team = (overview?.teams || []).find(t => Number(t.id) === teamId);
    const usedStations = new Set((team?.route || []).filter(r => Number(r.level) !== level).map(r => r.station_id));
    const oldStation = saved?.station_id || "A";
    [...els.routeStation.options].forEach(option => { option.disabled = usedStations.has(option.value); });
    els.routeStation.value = oldStation;
    els.routeNotes.value = saved?.riddle_notes || "";
    const routeKey = `${teamId}:${level}`;
    els.routeCode.value = recentlySavedRouteKey === routeKey ? recentlySavedRouteCode : "";
    els.routeCode.required = !(saved && saved.configured);
    els.routeCode.placeholder = saved?.configured ? "Leave blank to keep saved code" : "Enter unique envelope code";
    if (els.routeMessage) els.routeMessage.textContent = saved?.configured ? `Level ${level} is configured. The saved code is not retrievable; leave blank to retain it or enter a new unique code.` : "This level isn't configured yet. Set its code and private riddle notes.";
  }

  function renderLevelTimes(levels) {
    if (!els.timesContainer) return;
    const values = new Map((levels || []).map(item => [Number(item.level), item]));
    els.timesContainer.innerHTML = [1,2,3,4].map(level => {
      const row = values.get(level) || { duration_minutes: [15,20,20,25][level-1] };
      return `<div class="level-time-card"><label for="level-minutes-${level}">LEVEL ${level} · ${levelLabels[level].toUpperCase()}</label><input id="level-minutes-${level}" data-level-minutes="${level}" class="text-input" type="number" min="1" max="180" step="1" value="${Number(row.duration_minutes)}" required><small class="host-note">Minutes for each team's Level ${level} timer.</small></div>`;
    }).join("");
  }

  function renderRouteList(teams) {
    if (!els.routesContainer) return;
    if (!teams.length) { els.routesContainer.innerHTML = '<p class="host-note">Create teams to begin route configuration.</p>'; return; }
    els.routesContainer.innerHTML = teams.map(team => {
      const routeRows = [1,2,3,4].map(level => {
        const route = currentTeamRoute(team.id, level);
        const set = Boolean(route?.configured);
        return `<div class="riddle-item"><div class="riddle-item-info"><strong>LEVEL ${level} · ${levelLabels[level]} — ${set ? `STATION ${escapeHtml(route.station_id)}` : "NOT CONFIGURED"}</strong><small>${set ? escapeHtml(route.riddle_notes) : "Enter the physical riddle notes and unique envelope code."}</small></div><button type="button" class="btn btn-secondary btn-compact" data-edit-route-team="${Number(team.id)}" data-edit-route-level="${level}">${set ? "EDIT" : "SET UP"}</button></div>`;
      }).join("");
      return `<div class="station-accordion"><div class="station-accordion-header"><span>${escapeHtml(team.name)} · ${escapeHtml(team.colour)}</span><small>${Number(team.route_configured_count || 0)}/4 CONFIGURED</small></div><div class="station-riddles-list">${routeRows}</div></div>`;
    }).join("");
    els.routesContainer.querySelectorAll("[data-edit-route-team]").forEach(button => button.addEventListener("click", () => {
      if (!selectRoute(button.dataset.editRouteTeam, button.dataset.editRouteLevel)) return;
      els.formRoute.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function renderLogs(events, total = events.length) {
    if (!els.logs) return;
    const rows = events || [];
    auditTotal = total;
    if (els.logsBadge) els.logsBadge.textContent = `${total} EVENTS`;
    if (els.auditPage) els.auditPage.textContent = `Rows ${total ? auditOffset + 1 : 0}–${auditOffset + rows.length} of ${total}`;
    if (els.auditPrev) els.auditPrev.disabled = auditOffset === 0;
    if (els.auditNext) els.auditNext.disabled = auditOffset + rows.length >= total;
    if (!rows.length) { els.logs.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center">No activity recorded yet.</td></tr>'; return; }
    els.logs.innerHTML = rows.map(row => {
      const cls = /completed|created|resumed|started|reinstated/i.test(row.kind) ? "log-success" : /incorrect|warning/i.test(row.kind) ? "log-fail" : /eliminated/i.test(row.kind) ? "log-alert" : "";
      return `<tr><td>${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleTimeString() : "--")}</td><td><strong>${escapeHtml(row.team || "—")}</strong></td><td>${escapeHtml(row.kind)}</td><td class="${cls}">${escapeHtml(row.details)}</td></tr>`;
    }).join("");
  }

  function populateAuditTeams(teams) {
    if (!els.auditTeam) return;
    const selected = els.auditTeam.value;
    els.auditTeam.innerHTML = '<option value="">All teams</option>' + teams.map(t => `<option value="${Number(t.id)}">${escapeHtml(t.name)}</option>`).join("");
    if ([...els.auditTeam.options].some(option => option.value === selected)) els.auditTeam.value = selected;
  }

  async function refreshAudit() {
    const query = new URLSearchParams({ limit: "25", offset: String(auditOffset) });
    if (els.auditTeam?.value) query.set("team_id", els.auditTeam.value);
    if (els.auditKind?.value.trim()) query.set("kind", els.auditKind.value.trim());
    const result = await request(`/api/admin/events?${query}`);
    renderLogs(result.events, result.total);
  }

  async function refresh() {
    if (refreshing) { refreshQueued = true; return; }
    refreshing = true;
    try {
      if (!config) {
        config = await request("/api/config");
        if (els.profileNote) els.profileNote.textContent = `One event setup · choose 4–${config.max_teams} teams · all ten colours are available · 3–5 members per team.`;
      }
      const status = await request("/api/status");
      if (!els.password.value.trim()) {
        if (overview) {
          overview = null;
          renderTeams([]);
          renderRouteList([]);
          renderLogs([]);
          populateRouteTeamChoices();
          if (els.teamCreated) els.teamCreated.hidden = true;
          if (els.teamCreatedCode) els.teamCreatedCode.textContent = "";
          if (els.teamCode) els.teamCode.value = "";
          if (els.routeNotes) els.routeNotes.value = "";
          if (els.routeCode) els.routeCode.value = "";
          recentlySavedRouteCode = "";
          recentlySavedRouteKey = "";
          routeFormDirty = false;
        }
        renderStatus(status);
        return;
      }
      const data = await request("/api/admin/overview");
      overview = data; config = data.config || config;
      renderTeams(data.teams || []);
      renderLevelTimes(data.level_settings || config.level_times || []);
      renderRouteList(data.teams || []);
      populateAuditTeams(data.teams || []);
      await refreshAudit();
      renderStatus(data.game_state || status);
      if (els.message && !busy && Date.now() > hostFeedbackUntil) els.message.textContent = `Organizer authenticated · last sync ${new Date().toLocaleTimeString()}. No winner or points are calculated by this dashboard.`;
    } catch (error) {
      if (els.message) els.message.textContent = error.message;
    } finally {
      refreshing = false;
      if (refreshQueued) { refreshQueued = false; window.setTimeout(refresh, 0); }
    }
  }

  async function controlGame(action) {
    if (busy) return;
    if (!els.password.value.trim()) {
      setHostMessage("Enter the organizer password first; private controls are not authenticated yet.");
      els.password.focus(); return;
    }
    if (action === "start") {
      const blockers = getStartBlockers();
      if (blockers.length) {
        const message = `Cannot start yet. ${blockers.slice(0, 5).join(" ")}${blockers.length > 5 ? ` And ${blockers.length - 5} more requirement(s).` : ""}`;
        setHostMessage(message, 30000);
        const target = (overview?.teams || []).length < Number(config?.min_teams || 4) ? els.formTeam : els.formRoute;
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      pendingGameAction = action;
      els.gameConfirmTitle.textContent = "START THE SIGNAL HUNT?";
      els.gameConfirmDescription.textContent = "This starts each team's Level 1 timer. Confirm all team routes and physical envelopes are ready.";
      els.gameConfirmButton.textContent = "START GAME";
      els.modalGame.hidden = false;
      els.gameConfirmButton.focus();
      return;
    }
    if (action === "finish") {
      pendingGameAction = action;
      els.gameConfirmTitle.textContent = "FINISH GAMEPLAY?";
      els.gameConfirmDescription.textContent = "Gameplay will end for all teams. Physical volunteers still determine the official finishing order.";
      els.gameConfirmButton.textContent = "FINISH GAME";
      els.modalGame.hidden = false;
      els.gameConfirmButton.focus();
      return;
    }
    await sendGameAction(action);
  }

  async function sendGameAction(action) {
    busy = true; setHostMessage(`Sending ${action} request…`, 30000);
    let feedback = "";
    try {
      await request(`/api/admin/game/${action}`, { method: "POST" });
      feedback = `Server confirmed: ${action} successful.`;
    } catch (error) { feedback = error.message; }
    finally { busy = false; await refresh(); if (feedback) setHostMessage(feedback, 30000); }
  }

  async function changeTeamCode(teamId) {
    if (!els.password.value.trim()) { alert("Enter the organizer password first."); els.password.focus(); return; }
    if (!["waiting", "finished"].includes(currentStatus)) { alert("Team login codes can only be changed while the game is waiting or finished."); return; }
    const team = (overview?.teams || []).find(item => Number(item.id) === Number(teamId));
    if (!team) { alert("Team not found. Refresh the dashboard and try again."); return; }
    const newCode = window.prompt(`Enter a NEW unique login code for ${team.name} (8–32 letters, numbers, hyphens or underscores). The old code will stop working.`);
    if (newCode === null) return;
    const code = newCode.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,31}$/.test(code)) { alert("Use 8–32 characters: letters, numbers, hyphens or underscores, with no spaces."); return; }
    if (!window.confirm(`Replace the login code for ${team.name}? Anyone using the old code will need the new one.`)) return;
    try {
      await request(`/api/admin/teams/${teamId}/code`, { method: "PUT", body: JSON.stringify({ code }) });
      recentlySavedRouteCode = ""; recentlySavedRouteKey = "";
      els.teamCreatedCode.textContent = code;
      const heading = els.teamCreated?.querySelector("strong"); if (heading) heading.textContent = "TEAM LOGIN CODE UPDATED — SAVE IT";
      els.teamCreated.hidden = false;
      els.teamMessage.textContent = `${team.name}: login code changed. Save the new code securely and distribute it privately.`;
      await refresh();
    } catch (error) { alert(error.message); }
  }


  async function reinstateTeam(teamId) {
    try {
      await request(`/api/admin/team/${teamId}/reinstate`, { method: "POST" });
      if (els.message) els.message.textContent = "Team reinstated. Its current level timer has not been reset.";
      await refresh();
    } catch (error) { alert(error.message); }
  }

  async function editTeam(teamId) {
    const team = (overview?.teams || []).find(item => Number(item.id) === teamId);
    if (!team || !els.modalEditTeam) return;
    editingTeamId = teamId;
    els.editTeamName.value = team.name;
    els.editTeamSize.value = String(team.team_size);
    const usedByOthers = new Set((overview?.teams || []).filter(item => Number(item.id) !== teamId).map(item => item.colour));
    els.editTeamColour.replaceChildren();
    (config?.available_colours || []).forEach(item => {
      const option = document.createElement("option");
      option.value = item.id; option.textContent = item.name; option.disabled = usedByOthers.has(item.id);
      els.editTeamColour.appendChild(option);
    });
    els.editTeamColour.value = team.colour;
    els.editTeamFeedback.textContent = "";
    els.modalEditTeam.hidden = false;
    els.editTeamName.focus();
  }

  async function removeTeam(teamId) {
    const team = (overview?.teams || []).find(item => Number(item.id) === teamId);
    if (!team || !window.confirm(`Remove ${team.name} before gameplay starts? Its own route and device registration will be removed. Audit history remains; other teams are unchanged.`)) return;
    try {
      await request(`/api/admin/teams/${teamId}`, { method: "DELETE" });
      await refresh();
      setHostMessage(`${team.name} was removed before gameplay. Its audit history remains.`);
    } catch (error) { alert(error.message); }
  }

  $("btn-cancel-edit-team")?.addEventListener("click", () => { editingTeamId = null; els.modalEditTeam.hidden = true; });
  els.editTeamForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!editingTeamId) return;
    const teamId = editingTeamId;
    const name = els.editTeamName.value.trim();
    const colour = els.editTeamColour.value;
    const teamSize = Number(els.editTeamSize.value);
    const button = $("btn-save-edit-team"); button.disabled = true;
    els.editTeamFeedback.textContent = "Saving this team's details…";
    try {
      await request(`/api/admin/teams/${teamId}`, { method: "PUT", body: JSON.stringify({ name, colour, team_size: teamSize }) });
      editingTeamId = null; els.modalEditTeam.hidden = true;
      await refresh();
      setHostMessage(`Updated ${name}. Other teams and this team's access code/routes were preserved.`);
    } catch (error) { els.editTeamFeedback.textContent = error.message; }
    finally { button.disabled = false; }
  });

  if (els.password) {
    els.password.addEventListener("change", refresh);
    els.password.addEventListener("input", () => {
      if (!els.password.value.trim() && overview) {
        overview = null;
        renderTeams([]);
        renderRouteList([]);
        renderLogs([]);
        populateRouteTeamChoices();
        if (els.teamCreated) els.teamCreated.hidden = true;
        if (els.teamCreatedCode) els.teamCreatedCode.textContent = "";
        if (els.teamCode) els.teamCode.value = "";
        if (els.routeNotes) els.routeNotes.value = "";
        if (els.routeCode) els.routeCode.value = "";
        recentlySavedRouteCode = "";
        recentlySavedRouteKey = "";
        if (els.message) els.message.textContent = "Organizer password cleared. Private route details are hidden.";
      }
    });
  }
  if (els.start) els.start.addEventListener("click", () => controlGame("start"));
  if (els.pause) els.pause.addEventListener("click", () => controlGame(currentStatus === "paused" ? "resume" : "pause"));
  if (els.finish) els.finish.addEventListener("click", () => controlGame("finish"));
  if (els.gameCancelButton) els.gameCancelButton.addEventListener("click", () => { pendingGameAction = null; els.modalGame.hidden = true; });
  if (els.gameConfirmButton) els.gameConfirmButton.addEventListener("click", async () => {
    const action = pendingGameAction;
    pendingGameAction = null;
    els.modalGame.hidden = true;
    if (action) await sendGameAction(action);
  });
  if (els.rearm) els.rearm.addEventListener("click", () => { els.rearmInput.value = ""; els.modalRearm.hidden = false; els.rearmInput.focus(); });
  if ($("btn-cancel-rearm")) $("btn-cancel-rearm").addEventListener("click", () => { els.modalRearm.hidden = true; });
  els.eventReset?.addEventListener("click", () => {
    if (["active", "paused"].includes(currentStatus)) return setHostMessage("Reset Event Setup is unavailable while the game is active or paused.");
    els.eventResetInput.value = "";
    els.modalEventReset.hidden = false;
    els.eventResetInput.focus();
  });
  $("btn-cancel-event-reset")?.addEventListener("click", () => { els.modalEventReset.hidden = true; });
  $("btn-confirm-event-reset")?.addEventListener("click", async () => {
    const feedback = $("event-reset-feedback");
    if (els.eventResetInput.value.trim() !== "RESET EVENT") {
      if (feedback) feedback.textContent = "Type RESET EVENT exactly to confirm.";
      return;
    }
    const confirmButton = $("btn-confirm-event-reset");
    confirmButton.disabled = true;
    if (feedback) feedback.textContent = "Creating and verifying the backup…";
    try {
      const result = await request("/api/admin/event/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET EVENT" }) });
      els.modalEventReset.hidden = true;
      await refresh();
      setHostMessage(`Event setup cleared. Verified backup: ${result.backup_file}. Recovery instructions are in README.md.`, 30000);
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    } finally { confirmButton.disabled = false; }
  });

  if (els.formTeam) els.formTeam.addEventListener("submit", async event => {
    event.preventDefault();
    const name = els.teamName.value.trim(), colour = els.teamColour.value, code = els.teamCode.value.trim(), teamSize = Number(els.teamSize.value);
    if (!els.password.value.trim()) { els.teamMessage.textContent = "Enter the organizer password first."; els.password.focus(); return; }
    if (!name || !colour || !code) { els.teamMessage.textContent = "Enter a team name, colour and custom unique access code."; return; }
    const button = $("btn-create-team"); button.disabled = true;
    try {
      const result = await request("/api/admin/teams", { method: "POST", body: JSON.stringify({ name, colour, code, team_size: teamSize }) });
      els.teamCreatedCode.textContent = code;
      const createdHeading = els.teamCreated?.querySelector("strong"); if (createdHeading) createdHeading.textContent = "TEAM CREATED — SAVE ITS CODE";
      els.teamCreated.hidden = false;
      els.teamName.value = ""; els.teamCode.value = "";
      els.teamMessage.textContent = `${result.name} created. Save this manually chosen code and distribute it privately.`;
      await refresh();
      selectRoute(result.id, els.routeLevel.value || 1);
    } catch (error) { els.teamMessage.textContent = error.message; }
    finally { button.disabled = false; }
  });

  if (els.copyTeamCode) els.copyTeamCode.addEventListener("click", async () => {
    const code = els.teamCreatedCode.textContent.trim(); if (!code) return;
    try { await navigator.clipboard.writeText(code); els.copyTeamCode.textContent = "COPIED"; }
    catch (_) { const range = document.createRange(); range.selectNodeContents(els.teamCreatedCode); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); els.teamMessage.textContent = "Code selected. Press Ctrl+C to copy it."; }
  });

  async function downloadCsv(url, filename) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Download failed. Organizer session may have expired.");
    const blob = await response.blob(), link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
  }
  async function uploadCsv(path, file, extra = "") {
    const form = new FormData(); form.append("file", file);
    const headers = csrfToken ? { "X-CSRF-Token": csrfToken } : {};
    const response = await fetch(path + extra, { method: "POST", headers, body: form, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Import failed (HTTP ${response.status}).`);
    return data;
  }
  function renderCsvPreview(target, rows, headers) {
    target.innerHTML = `<div style="overflow-x:auto"><table class="host-log-table"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map(h => `<td>${escapeHtml(row[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  $("team-csv-template")?.addEventListener("click", () => downloadCsv("/api/admin/csv-template/teams", "signal-hunt-teams-template.csv").catch(e => $("team-csv-feedback").textContent = e.message));
  $("route-csv-template")?.addEventListener("click", () => downloadCsv("/api/admin/csv-template/routes", "signal-hunt-routes-template.csv").catch(e => $("route-csv-feedback").textContent = e.message));
  $("route-csv-export")?.addEventListener("click", () => downloadCsv("/api/admin/routes/export", "signal-hunt-route-matrix.csv").catch(e => $("route-csv-feedback").textContent = e.message));
  $("team-csv-preview")?.addEventListener("click", async () => {
    try {
      const file = $("team-csv-file").files[0]; if (!file) throw new Error("Choose a team CSV file first.");
      pendingTeamCsv = file; const data = await uploadCsv("/api/admin/teams/import/preview", file);
      renderCsvPreview($("team-csv-preview-table"), data.preview, ["team_name", "team_colour", "member_count"]);
      $("team-csv-feedback").textContent = `Preview valid: ${data.preview.length} teams. Login codes will be hashed by the backend.`;
      $("team-csv-confirm").disabled = false;
    } catch (error) { pendingTeamCsv = null; $("team-csv-feedback").textContent = error.message; $("team-csv-confirm").disabled = true; }
  });
  $("team-csv-confirm")?.addEventListener("click", async () => {
    if (!pendingTeamCsv || !window.confirm("Import these teams? Existing records will not be overwritten.")) return;
    try { const result = await uploadCsv("/api/admin/teams/import/confirm", pendingTeamCsv); $("team-csv-feedback").textContent = `Imported ${result.imported} teams.`; $("team-csv-confirm").disabled = true; pendingTeamCsv = null; await refresh(); }
    catch (error) { $("team-csv-feedback").textContent = error.message; }
  });
  const routeHeaders = ["team_name", "team_colour", ...[1,2,3,4].flatMap(level => [`level_${level}_station`, `level_${level}_envelope_code`, `level_${level}_organizer_note`])];
  $("route-csv-preview")?.addEventListener("click", async () => {
    try {
      const file = $("route-csv-file").files[0]; if (!file) throw new Error("Choose a route CSV file first.");
      pendingRouteCsv = file; const data = await uploadCsv("/api/admin/routes/import/preview", file);
      renderCsvPreview($("route-csv-preview-table"), data.preview, ["team_name", "level", "station", "organizer_note"]);
      $("route-csv-feedback").textContent = `Preview valid: ${data.preview.length} level records.${data.replaces_existing ? " Confirming replaces saved route records." : ""} Envelope codes are stored as hashes; keep your original CSV private.`;
      $("route-csv-confirm").disabled = false;
    } catch (error) { pendingRouteCsv = null; $("route-csv-feedback").textContent = error.message; $("route-csv-confirm").disabled = true; }
  });
  $("route-csv-confirm")?.addEventListener("click", async () => {
    if (!pendingRouteCsv) return;
    const replace = Boolean(overview?.teams?.some(team => (team.route || []).length));
    if (!window.confirm(`Import all routes?${replace ? " This replaces every saved route record." : ""} Save the original CSV privately for envelope preparation.`)) return;
    try { const result = await uploadCsv("/api/admin/routes/import/confirm", pendingRouteCsv, `?replace_existing=${replace}`); $("route-csv-feedback").textContent = `Imported ${result.imported} route records.`; $("route-csv-confirm").disabled = true; pendingRouteCsv = null; await refresh(); }
    catch (error) { $("route-csv-feedback").textContent = error.message; }
  });
  async function generateRandomPreview() {
    try {
      const data = await request("/api/admin/routes/random/preview", { method: "POST", body: "{}" }); pendingRandomRoutes = data.preview;
      const labels = ["Morse", "Binary ASCII", "FSK", "Combined"];
      $("route-random-preview").innerHTML = `<table class="host-log-table"><thead><tr><th>Team</th>${labels.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${data.preview.map(team => `<tr><td>${escapeHtml(team.team_name)}</td>${team.stations.map(station => `<td>${escapeHtml(station)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      $("route-random-feedback").textContent = "Preview generated. Confirming replaces saved station assignments while preserving envelope codes and organizer notes.";
      $("route-random-regenerate").disabled = false; $("route-random-confirm").disabled = false;
    } catch (error) { pendingRandomRoutes = null; $("route-random-feedback").textContent = error.message; }
  }
  $("route-random-generate")?.addEventListener("click", generateRandomPreview);
  $("route-random-regenerate")?.addEventListener("click", generateRandomPreview);
  $("route-random-confirm")?.addEventListener("click", async () => {
    if (!pendingRandomRoutes || !window.confirm("Save these station assignments? This replaces saved station assignments while preserving existing envelope codes and organizer notes.")) return;
    try { await request("/api/admin/routes/random/confirm", { method: "POST", body: JSON.stringify({ assignments: pendingRandomRoutes }) }); $("route-random-feedback").textContent = "Balanced station assignments saved. Envelope codes and organizer notes were preserved."; pendingRandomRoutes = null; $("route-random-confirm").disabled = true; await refresh(); }
    catch (error) { $("route-random-feedback").textContent = error.message; }
  });

  if (els.routeTeam) els.routeTeam.addEventListener("change", handleRouteSelectionChange);
  if (els.routeLevel) els.routeLevel.addEventListener("change", handleRouteSelectionChange);
  const markRouteDirty = () => { routeFormDirty = true; if (els.routeSaveStatus) els.routeSaveStatus.textContent = "Unsaved changes"; };
  if (els.routeStation) els.routeStation.addEventListener("change", markRouteDirty);
  if (els.routeNotes) els.routeNotes.addEventListener("input", markRouteDirty);
  if (els.routeCode) els.routeCode.addEventListener("input", markRouteDirty);
  if (els.formRoute) els.formRoute.addEventListener("submit", async event => {
    event.preventDefault();
    if (!els.password.value.trim()) { els.routeMessage.textContent = "Enter the organizer password first."; els.password.focus(); return; }
    const teamId = Number(els.routeTeam.value), level = Number(els.routeLevel.value), stationId = els.routeStation.value;
    const notes = els.routeNotes.value.trim(), envelopeCode = els.routeCode.value.trim();
    if (!teamId || !notes) { els.routeMessage.textContent = "Select a team and enter the physical riddle notes."; return; }
    const saved = currentTeamRoute(teamId, level);
    if (!envelopeCode && !(saved && saved.configured)) { els.routeMessage.textContent = "Enter a unique envelope verification code for this level."; return; }
    const payload = { station_id: stationId, riddle_notes: notes };
    if (envelopeCode) payload.envelope_code = envelopeCode;
    const button = $("btn-save-team-level"); button.disabled = true;
    if (els.routeSaveStatus) els.routeSaveStatus.textContent = "Saving…";
    try {
      await request(`/api/admin/teams/${teamId}/levels/${level}`, { method: "PUT", body: JSON.stringify(payload) });
      routeFormDirty = false;
      lastRouteSelection = { team: String(teamId), level: String(level) };
      if (envelopeCode) {
        recentlySavedRouteCode = envelopeCode;
        recentlySavedRouteKey = `${teamId}:${level}`;
        els.routeCode.value = envelopeCode;
        els.routeCode.type = "text";
        els.routeMessage.textContent = `Level ${level} setup saved. Copy this envelope code into your organizer sheet and print it inside this team's physical envelope. It is stored as a hash; you must keep this copy.`;
      } else {
        els.routeCode.value = "";
        els.routeMessage.textContent = `Level ${level} setup saved. The previously saved code was retained. It cannot be retrieved; refer to your secure organizer sheet.`;
      }
      await refresh();
      els.routeTeam.value = String(teamId); els.routeLevel.value = String(level); populateRouteForm();
    } catch (error) { els.routeMessage.textContent = error.message; if (els.routeSaveStatus) els.routeSaveStatus.textContent = "Error — changes not saved"; }
    finally { button.disabled = false; }
  });

  if (els.formTimes) els.formTimes.addEventListener("submit", async event => {
    event.preventDefault();
    if (!els.password.value.trim()) { els.timesMessage.textContent = "Enter the organizer password first."; els.password.focus(); return; }
    const inputs = [...els.timesContainer.querySelectorAll("[data-level-minutes]")];
    try {
      for (const input of inputs) {
        const level = Number(input.dataset.levelMinutes), duration = Number(input.value);
        if (!Number.isInteger(duration) || duration < 1 || duration > 180) throw new Error(`Level ${level} must be between 1 and 180 minutes.`);
      }
      for (const input of inputs) {
        await request(`/api/admin/level-settings/${Number(input.dataset.levelMinutes)}`, { method: "PUT", body: JSON.stringify({ duration_minutes: Number(input.value) }) });
      }
      els.timesMessage.textContent = "Level time limits saved. Changing a level's duration affects teams currently on that level.";
      await refresh();
    } catch (error) { els.timesMessage.textContent = error.message; }
  });

  if ($("btn-confirm-rearm")) $("btn-confirm-rearm").addEventListener("click", async () => {
    if (els.rearmInput.value.trim() !== "RESET_SIGNAL_HUNT") { alert("Confirmation text must match RESET_SIGNAL_HUNT exactly."); return; }
    if (!els.password.value.trim()) { alert("Enter the organizer password."); els.password.focus(); return; }
    try {
      await request("/api/admin/game/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET_SIGNAL_HUNT", clear_participants: true }) });
      els.modalRearm.hidden = true;
      alert("Game reset to WAITING. Teams, manually chosen team codes, routes and riddle notes are preserved; completion, timers and eliminations are reset.");
      await refresh();
    } catch (error) { alert(error.message); }
  });

  async function bootstrapHost() {
    try {
      const session = await request("/api/admin/session");
      csrfToken = session.csrf_token;
      await refresh();
      window.setInterval(refresh, 5000);
    } catch (_) { window.location.replace("/"); }
  }
  $("host-logout-button")?.addEventListener("click", async () => {
    try { await request("/api/admin/logout", { method: "POST", body: "{}" }); } finally { window.location.replace("/"); }
  });
  els.auditFilter?.addEventListener("click", () => { auditOffset = 0; refreshAudit().catch(e => setHostMessage(e.message)); });
  els.auditPrev?.addEventListener("click", () => { auditOffset = Math.max(0, auditOffset - 25); refreshAudit().catch(e => setHostMessage(e.message)); });
  els.auditNext?.addEventListener("click", () => { if (auditOffset + 25 < auditTotal) auditOffset += 25; refreshAudit().catch(e => setHostMessage(e.message)); });
  bootstrapHost();
})();
