/* App bootstrap. Keep this file small; feature behaviour lives in its own files. */
document.addEventListener("DOMContentLoaded", () => {
  window.Navigation.init();
  window.Auth.init();
  window.TeamProfile.init();
  window.KnowledgePage.init();
  window.GameFlow.init();
  document.getElementById("logout-button").addEventListener("click", () => {
    document.getElementById("home-status-title").textContent = window.SignalHuntData.copy.waitingTitle;
    document.getElementById("home-status-text").textContent = window.SignalHuntData.copy.waitingBody;
  });
});
