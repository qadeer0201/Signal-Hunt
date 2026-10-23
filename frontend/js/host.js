/* Local host-control demo only. Real start permissions must be enforced by the backend. */
(() => {
  const KEY = "signalHuntDemoStatus";
  const title = document.getElementById("host-status-title");
  const badge = document.getElementById("host-status-badge");
  const description = document.getElementById("host-status-description");
  const start = document.getElementById("host-start-button");
  const reset = document.getElementById("host-reset-button");
  const message = document.getElementById("host-action-message");

  function readStatus() {
    try { return localStorage.getItem(KEY) || "waiting"; }
    catch (_) { return "waiting"; }
  }
  function writeStatus(value) {
    try { localStorage.setItem(KEY, value); return true; }
    catch (_) { return false; }
  }
  function render(status) {
    const active = status === "active";
    title.textContent = active ? "STATUS: SIGNAL ACTIVE" : "STATUS: AWAITING THE SIGNAL";
    badge.textContent = active ? "LIVE · DEMO" : "STANDBY";
    badge.classList.toggle("is-active", active);
    description.textContent = active
      ? "The demo game status is active for tabs on this browser and origin. This is not a real multi-device start."
      : "Participants can review the Mission, Knowledge, Rules, Security and Campus Map while waiting.";
    start.disabled = active;
    start.textContent = active ? "CHALLENGE STARTED (DEMO)" : "START CHALLENGE →";
  }

  start.addEventListener("click", () => {
    const saved = writeStatus("active");
    render("active");
    message.textContent = saved
      ? "Demo started. Other participant tabs on this same browser/origin should move to the Active Game screen."
      : "Browser storage is unavailable. This page can display the demo, but it cannot sync another tab.";
  });

  reset.addEventListener("click", () => {
    const saved = writeStatus("waiting");
    render("waiting");
    message.textContent = saved
      ? "Demo reset to Waiting Room. This does not reset or affect real game data."
      : "Browser storage is unavailable. The display was reset locally only.";
  });

  window.addEventListener("storage", event => {
    if (event.key === KEY) render(event.newValue || "waiting");
  });

  render(readStatus());
})();
