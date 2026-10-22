/**
 * app.js — Signal Hunt Application Orchestrator v2
 * =====================================================
 * Bootstraps the app, handles view transitions between
 * Login Screen and the main App Shell (with nav).
 * Also manages the team profile modal and knowledge
 * sidebar tab switching.
 * =====================================================
 */

const App = (() => {

  // -------------------------------------------------------------------------
  // Internal: Render the colour picker grid in the login form
  // -------------------------------------------------------------------------
  function _renderColourPicker() {
    const grid = document.getElementById("colour-grid");
    if (!grid) return;

    TEAM_COLOURS.forEach(({ id, label, hex, textDark }) => {
      const btn = document.createElement("button");
      btn.type      = "button";
      btn.id        = `colour-${id}`;
      btn.className = "colour-chip";
      btn.dataset.colour = id;
      btn.setAttribute("aria-label", `Select ${label} team`);
      btn.title = label;
      btn.style.setProperty("--chip-colour", hex);
      btn.style.setProperty("--chip-text", textDark ? "#1a1a1a" : "#ffffff");
      btn.innerHTML = `<span class="chip-dot"></span><span class="chip-label">${label}</span>`;

      btn.addEventListener("click", () => _selectColour(id));
      grid.appendChild(btn);
    });
  }

  // -------------------------------------------------------------------------
  // Internal: Highlight the selected colour chip
  // -------------------------------------------------------------------------
  let _selectedColour = null;

  function _selectColour(colourId) {
    _selectedColour = colourId;
    document.querySelectorAll(".colour-chip").forEach((btn) => {
      btn.classList.toggle("colour-chip--selected", btn.dataset.colour === colourId);
    });
  }

  // -------------------------------------------------------------------------
  // Internal: Handle login form submission
  // -------------------------------------------------------------------------
  function _handleLogin(e) {
    e.preventDefault();
    const code    = document.getElementById("team-code-input").value;
    const errorEl = document.getElementById("login-error");
    errorEl.textContent = "";

    const result = Auth.login(_selectedColour, code);

    if (!result.success) {
      errorEl.textContent = result.error;
      const form = document.getElementById("login-form");
      form.classList.add("shake");
      setTimeout(() => form.classList.remove("shake"), 550);
      return;
    }

    _showAppShell(result.session);
  }

  // -------------------------------------------------------------------------
  // Internal: Show the login screen
  // -------------------------------------------------------------------------
  function _showLoginScreen() {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");
  }

  // -------------------------------------------------------------------------
  // Internal: Show the app shell after successful login
  // -------------------------------------------------------------------------
  function _showAppShell(session) {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");

    _renderTeamProfile(session);
    Nav.init();
    _initKnowledgeSidebar();
  }

  // -------------------------------------------------------------------------
  // Internal: Populate all [data-profile] elements with session data
  // -------------------------------------------------------------------------
  function _renderTeamProfile(session) {
    document.querySelectorAll("[data-profile]").forEach((el) => {
      const field = el.dataset.profile;
      switch (field) {

        // "Welcome, Team RED." heading on the home banner
        case "welcome-greeting":
          el.textContent = `Welcome, Team ${session.colourLabel}.`;
          break;

        // Colour label (text) — used in profile modal & elsewhere
        case "colour-label":
          el.textContent = session.colourLabel;
          break;

        // Colour dot / swatch — background colour applied directly
        case "colour-dot":
          el.style.setProperty("--chip-colour", session.colourHex);
          el.style.background = session.colourHex;
          break;

        // Team code text
        case "team-code":
          // The welcome banner shows "Team Code: XXX"
          if (el.id === "welcome-team-code") {
            el.textContent = `Team Code: ${session.teamCode}`;
          } else {
            el.textContent = session.teamCode;
          }
          break;

        // Game status badge
        case "game-status":
          el.textContent = GAME_STATE.started
            ? "Live — Game in Progress"
            : "Standby · Awaiting Host";
          el.className = GAME_STATE.started
            ? "status-badge status-live"
            : "status-badge status-wait";
          break;
      }
    });

    // Top-bar colour dot
    const bar = document.getElementById("topbar-team-colour");
    if (bar) {
      bar.style.background = session.colourHex;
      bar.style.boxShadow  = `0 0 8px ${session.colourHex}99`;
    }
  }

  // -------------------------------------------------------------------------
  // Internal: Wire the team profile modal open/close
  // -------------------------------------------------------------------------
  function _initProfileModal() {
    const overlay   = document.getElementById("profile-modal-overlay");
    const openBtn   = document.getElementById("profile-btn");
    const closeBtn  = document.getElementById("profile-modal-close");
    const ctaBtn    = document.getElementById("profile-modal-cta");

    if (!overlay) return;

    function open() {
      overlay.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    }
    function close() {
      overlay.classList.add("hidden");
      document.body.style.overflow = "";
    }

    if (openBtn)  openBtn .addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (ctaBtn)   ctaBtn  .addEventListener("click", close);

    // Close on backdrop click
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  // -------------------------------------------------------------------------
  // Internal: Wire the knowledge sidebar tab switching (desktop only)
  // -------------------------------------------------------------------------
  function _initKnowledgeSidebar() {
    const navItems = document.querySelectorAll(".knowledge-nav-item");
    const panes    = document.querySelectorAll(".knowledge-pane");

    navItems.forEach((item) => {
      item.addEventListener("click", () => {
        const paneId = item.dataset.pane;

        // Update active nav item
        navItems.forEach((n) => n.classList.remove("active"));
        item.classList.add("active");

        // Show correct pane
        panes.forEach((p) => {
          p.classList.toggle("active", p.id === `pane-${paneId}`);
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Public: Initialise the entire application
  // -------------------------------------------------------------------------
  function init() {
    // Wire profile modal (always, so close works even before login if needed)
    _initProfileModal();

    // Check for an existing session (e.g. user refreshed the page)
    const session = Auth.getSession();

    if (session) {
      _showAppShell(session);
    } else {
      _showLoginScreen();
      _renderColourPicker();

      const form = document.getElementById("login-form");
      if (form) form.addEventListener("submit", _handleLogin);
    }

    // Logout button
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        Auth.logout();
        location.reload();
      });
    }
  }

  return { init };
})();

// Boot the app when the DOM is ready
document.addEventListener("DOMContentLoaded", App.init);
