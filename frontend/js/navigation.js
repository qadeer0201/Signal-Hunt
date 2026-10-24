/* Signal Hunt: Live SPA Navigation Controller v2.0 */
window.Navigation = {
  toastTimer: null,

  showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
  },

  show(page) {
    const state = window.SignalHuntState;

    // Guard game views if game is not active
    if (["station-code", "active-game"].includes(page)) {
      if (state.eliminated) {
        page = "eliminated";
      } else if (state.gameStatus === "waiting") {
        this.showToast("The host has not started the hunt yet. Await the transmission signal.");
        return;
      } else if (state.gameStatus === "paused") {
        this.showToast("The event timer is currently paused by the organizer.");
      } else if (state.gameStatus === "finished") {
        this.showToast("The event has concluded.");
      }
    }

    const target = document.getElementById(`view-${page}`);
    if (!target) return;

    document.querySelectorAll(".view").forEach(view => {
      const active = view === target;
      view.classList.toggle("is-active", active);
      view.hidden = !active;
      view.setAttribute("aria-hidden", String(!active));
    });

    state.currentPage = page;

    // Sync navigation bar states
    const primaryPages = ["home", "mission", "knowledge", "rules", "security"];
    const bottomPage = primaryPages.includes(page) ? page : "home";

    document.querySelectorAll(".bottom-nav-item").forEach(button => {
      const active = button.dataset.page === bottomPage;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    document.querySelectorAll(".nav-link").forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    // View-specific initialization hooks
    if (page === "knowledge" && window.KnowledgePage) window.KnowledgePage.showList();
    if (page === "active-game" && window.GameFlow) window.GameFlow.renderActiveGame();
    if (page === "station-code" && window.GameFlow) window.GameFlow.prepareCodeEntry();

    window.scrollTo(0, 0);
  },

  init() {
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-page]");
      if (button) this.show(button.dataset.page);
    });
  }
};
