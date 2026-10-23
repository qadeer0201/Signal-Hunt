/* FAKE TEST VALUES ONLY. Never put real credentials in frontend JavaScript. */
window.SignalHuntMock = {
  teamCodes: {
    black: "BLK-SIGNAL",
    red: "RED-ALPHA",
    navy: "NAVY-ECHO",
    yellow: "YLW-STORM",
    orange: "ORG-BLAZE",
    green: "GRN-ECHO",
    purple: "PRP-VIPER",
    grey: "GRY-SHADE",
    brown: "BRN-TRACE",
    peach: "PCH-PULSE"
  },
  stationCodes: {
    1: "MORSE-01",
    2: "BINARY-02",
    3: "FSK-03",
    4: "FINAL-04"
  },
  login(teamId, code) {
    const expected = this.teamCodes[teamId];
    if (!expected || String(code || "").trim().toUpperCase() !== expected) {
      return { ok: false, message: window.SignalHuntData.copy.loginError };
    }
    const team = window.SignalHuntData.teams.find(item => item.id === teamId);
    return { ok: true, team: { ...team }, status: "AWAITING THE SIGNAL" };
  },
  verifyStation(level, code) {
    const expected = this.stationCodes[level];
    if (!expected || String(code || "").trim().toUpperCase() !== expected) {
      return { ok: false, message: window.SignalHuntData.copy.invalidCode };
    }
    const station = window.SignalHuntData.stations.find(item => item.level === Number(level));
    return { ok: true, level: Number(level), station };
  }
};
