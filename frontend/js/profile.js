window.TeamProfile = {
  render() {
    const team = window.SignalHuntState.currentTeam;
    if (!team) return;
    const setTeamColour = element => { if (element) element.style.setProperty("--team-colour", team.color); };
    const emblem = document.getElementById("header-team-shield");
    if (emblem) { emblem.textContent = team.icon; setTeamColour(emblem); }
    setTeamColour(document.getElementById("home-team-dot"));
    const label = document.getElementById("home-team-label"); if (label) label.textContent = `TEAM ${team.name.toUpperCase()}`;
    const homeEmblem = document.getElementById("home-emblem"); if (homeEmblem) { homeEmblem.textContent = team.icon; setTeamColour(homeEmblem); }
    setTeamColour(document.getElementById("profile-shield"));
    const symbol = document.getElementById("profile-team-symbol"); if (symbol) symbol.textContent = team.icon;
    const name = document.getElementById("profile-team-name"); if (name) name.textContent = `TEAM ${team.name.toUpperCase()}`;
    const code = document.getElementById("profile-team-code"); if (code) code.textContent = "AUTHENTICATED TEAM TERMINAL";
    const colourName = document.getElementById("profile-colour-name");
    const colorInfo = window.SignalHuntData.teams.find(item => item.id === String(team.colour || "").toLowerCase());
    if (colourName) colourName.textContent = colorInfo ? colorInfo.name : (team.colour || "—");
    setTeamColour(document.getElementById("profile-colour-swatch"));
    const status = document.getElementById("profile-status");
    if (status) {
      const map = { waiting: "AWAITING THE SIGNAL", active: "MISSION ACTIVE · LIVE", paused: "MISSION PAUSED", finished: "MISSION CONCLUDED" };
      status.textContent = window.SignalHuntState.eliminated ? "ELIMINATED · CONTACT ORGANIZER" : (map[window.SignalHuntState.gameStatus] || "AWAITING THE SIGNAL");
    }
    const capacity = document.getElementById("profile-player-capacity"); if (capacity) capacity.textContent = `Team limit: ${team.teamSize || 3} members/devices`;
  },
  init() {
    const logout = document.getElementById("logout-button");
    if (logout) logout.addEventListener("click", () => window.Auth.logout());
  }
};
