/* Simple single-page navigation. Each view has an id of view-<page>. */
window.Navigation = {
  show(page) {
    if (page === "station-code" && !window.SignalHuntState.demoGameStarted) {
      const toast = document.getElementById("toast");
      if (toast) {
        toast.textContent = "The host has not started the hunt yet. Await the signal.";
        toast.hidden = false;
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2800);
      }
      return;
    }
    const target = document.getElementById(`view-${page}`);
    if (!target) return;
    document.querySelectorAll(".view").forEach(view => {
      const active = view === target;
      view.classList.toggle("is-active", active);
      view.hidden = !active;
      view.setAttribute("aria-hidden", String(!active));
    });
    window.SignalHuntState.currentPage = page;
    const primaryPages = ["home", "mission", "knowledge", "rules"];
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
