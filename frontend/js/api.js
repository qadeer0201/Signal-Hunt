/*
  Frontend API boundary.
  This prototype routes requests to fake data. When the backend developer
  provides the API contract/base URL, replace these methods with fetch calls.
  Server-side code must remain authoritative for login, codes, progress, and elimination.
*/
window.SignalHuntAPI = {
  mode: "mock",
  async login(teamId, code) {
    return window.SignalHuntMock.login(teamId, code);
  },
  async verifyStation(level, code) {
    return window.SignalHuntMock.verifyStation(level, code);
  }
};
