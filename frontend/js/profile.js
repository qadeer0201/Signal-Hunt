window.TeamProfile = {
  render() {
    const team = window.SignalHuntState.currentTeam;
    if (!team) return;

    const emblem = document.getElementById("header-team-shield");
    if (emblem) {
      emblem.textContent = team.icon;
      emblem.style.setProperty("--team-colour", team.color);
    }

    const dot = document.getElementById("home-team-dot");
    if (dot) dot.style.setProperty("--team-colour", team.color);

    const label = document.getElementById("home-team-label");
    if (label) label.textContent = `TEAM ${team.name.toUpperCase()}`;

    const homeEmblem = document.getElementById("home-emblem");
    if (homeEmblem) {
      homeEmblem.textContent = team.icon;
      homeEmblem.style.setProperty("--team-colour", team.color);
    }

    const pShield = document.getElementById("profile-shield");
    if (pShield) pShield.style.setProperty("--team-colour", team.color);

    const pSymbol = document.getElementById("profile-team-symbol");
    if (pSymbol) pSymbol.textContent = team.icon;

    const pName = document.getElementById("profile-team-name");
    if (pName) pName.textContent = `TEAM ${team.name.toUpperCase()}`;

    const pCode = document.getElementById("profile-team-code");
    if (pCode) pCode.textContent = "REGISTERED OPERATIVE UNIT";

    const pColourName = document.getElementById("profile-colour-name");
    if (pColourName) pColourName.textContent = team.name;

    const pSwatch = document.getElementById("profile-colour-swatch");
    if (pSwatch) pSwatch.style.setProperty("--team-colour", team.color);

    const pStatus = document.getElementById("profile-status");
    if (pStatus) {
      const statusMap = {
        active: "MISSION ACTIVE · LIVE",
        waiting: "AWAITING THE SIGNAL",
        paused: "MISSION PAUSED",
        finished: "MISSION CONCLUDED"
      };
      pStatus.textContent = statusMap[window.SignalHuntState.gameStatus] || "AWAITING THE SIGNAL";
    }
  },

  init() {
    const logoutBtn = document.getElementById("logout-button");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => window.Auth.logout());
    }
  }
};
