window.KnowledgePage = {
  init() {
    document.querySelectorAll("[data-topic]").forEach(button => {
      button.addEventListener("click", () => this.open(button.dataset.topic));
    });
    document.getElementById("knowledge-back").addEventListener("click", () => this.showList());
    document.getElementById("open-reference-fullscreen").addEventListener("click", () => this.openFullScreen());
    document.getElementById("knowledge-detail-image").addEventListener("click", () => this.openFullScreen());
    document.getElementById("close-reference-fullscreen").addEventListener("click", () => this.closeFullScreen());
    document.getElementById("reference-fullscreen").addEventListener("click", event => {
      if (event.target.id === "reference-fullscreen") this.closeFullScreen();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") this.closeFullScreen();
    });
  },
  openFullScreen() {
    const source = document.getElementById("knowledge-detail-image");
    if (!source || source.classList.contains("is-hidden")) return;
    const overlay = document.getElementById("reference-fullscreen");
    const image = document.getElementById("reference-fullscreen-image");
    image.src = source.src;
    image.alt = source.alt;
    overlay.classList.remove("is-hidden");
    document.getElementById("close-reference-fullscreen").focus();
  },
  closeFullScreen() {
    const overlay = document.getElementById("reference-fullscreen");
    if (overlay) overlay.classList.add("is-hidden");
  },
  showList() {
    document.getElementById("knowledge-list-view").classList.remove("is-hidden");
    document.getElementById("knowledge-detail-view").classList.add("is-hidden");
  },
  open(id) {
    const topic = window.SignalHuntData.knowledge.find(item => item.id === id);
    if (!topic) return;
    document.getElementById("knowledge-detail-title").textContent = topic.title;
    document.getElementById("knowledge-detail-description").textContent = topic.explanation;
    const image = document.getElementById("knowledge-detail-image");
    const placeholder = document.getElementById("knowledge-image-placeholder");
    if (topic.image) {
      image.src = topic.image;
      image.alt = `${topic.title} reference chart`;
      image.classList.remove("is-hidden");
      placeholder.classList.add("is-hidden");
    } else {
      image.classList.add("is-hidden");
      placeholder.classList.remove("is-hidden");
    }
    document.getElementById("knowledge-list-view").classList.add("is-hidden");
    document.getElementById("knowledge-detail-view").classList.remove("is-hidden");
    document.getElementById("knowledge-back").focus();
  }
};
