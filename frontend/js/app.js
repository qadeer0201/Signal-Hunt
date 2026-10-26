/* App bootstrap. Keep this file small; feature behaviour lives in its own files. */
document.addEventListener("DOMContentLoaded", () => {
  window.Navigation.init();
  window.Auth.init();
  window.TeamProfile.init();
  window.KnowledgePage.init();
  window.GameFlow.init();
});
