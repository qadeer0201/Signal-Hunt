window.TeamProfile = {
  render() {
    const team = window.SignalHuntState.currentTeam;
    if (!team) return;
    const emblem = document.getElementById("header-team-shield");
    emblem.textContent = team.icon;
    emblem.style.setProperty("--team-colour", team.color);
    document.getElementById("home-team-dot").style.setProperty("--team-colour", team.color);
    document.getElementById("home-team-label").textContent = `TEAM ${team.name.toUpperCase()}`;
    const homeEmblem = document.getElementById("home-emblem");
    homeEmblem.textContent = team.icon;
    homeEmblem.style.setProperty("--team-colour", team.color);
    document.getElementById("profile-shield").style.setProperty("--team-colour", team.color);
    document.getElementById("profile-team-symbol").textContent = team.icon;
    document.getElementById("profile-team-name").textContent = `TEAM ${team.name.toUpperCase()}`;
    document.getElementById("profile-team-code").textContent = "REGISTERED TEAM · PROTOTYPE";
    document.getElementById("profile-colour-name").textContent = team.name;
    document.getElementById("profile-colour-swatch").style.setProperty("--team-colour", team.color);
    document.getElementById("profile-status").textContent = window.SignalHuntState.demoGameStarted ? "MISSION ACTIVE · DEMO" : "AWAITING THE SIGNAL";
  },
  init() {
    document.getElementById("logout-button").addEventListener("click", () => window.Auth.logout());
  }
};
