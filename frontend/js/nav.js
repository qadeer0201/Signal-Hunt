/**
 * nav.js — Signal Hunt Section Navigation
 * =====================================================
 * Switches between Home / Mission / Knowledge / Rules
 * without reloading the page (single-page app style).
 * Both the desktop top-bar nav and the mobile bottom-bar
 * nav are kept in sync via a single switchTo() call.
 * =====================================================
 */

const Nav = (() => {
  let currentSection = "home";

  // -------------------------------------------------------------------------
  // Internal: Build nav buttons into a given <ul> element
  // -------------------------------------------------------------------------
  function _buildNavButtons(ulElement) {
    if (!ulElement) return;
    NAV_SECTIONS.forEach(({ id, label, icon }) => {
      const li  = document.createElement("li");
      const btn = document.createElement("button");
      btn.className        = "nav-btn";
      btn.dataset.section  = id;
      btn.setAttribute("aria-label", label);
      btn.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>`;
      btn.addEventListener("click", () => switchTo(id));
      li.appendChild(btn);
      ulElement.appendChild(li);
    });
  }

  // -------------------------------------------------------------------------
  // Public: Initialise navigation — build buttons in both nav bars
  // -------------------------------------------------------------------------
  function init() {
    // Desktop top-bar nav
    _buildNavButtons(document.getElementById("nav-links"));
    // Mobile bottom nav
    _buildNavButtons(document.getElementById("nav-links-mobile"));

    // Activate the default section
    switchTo("home");
  }

  // -------------------------------------------------------------------------
  // Public: Switch the visible section and sync ALL nav buttons
  // -------------------------------------------------------------------------
  function switchTo(sectionId) {
    // Close the mobile knowledge-reference detail when leaving Knowledge.
    const knowledgeSection = document.getElementById("section-knowledge");
    if (knowledgeSection && sectionId !== "knowledge") {
      knowledgeSection.classList.remove("knowledge-reference-open");
    }

    // Hide all sections
    document.querySelectorAll(".section").forEach((el) => {
      el.classList.remove("section--active");
      el.setAttribute("aria-hidden", "true");
    });

    // Show requested section
    const target = document.getElementById(`section-${sectionId}`);
    if (target) {
      target.classList.add("section--active");
      target.setAttribute("aria-hidden", "false");
    }

    // Campus Map is a Home sub-page, so keep Home highlighted in the nav.
    const navSection = sectionId === "campus-map" ? "home" : sectionId;

    // Sync active state across ALL nav buttons (desktop + mobile)
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("nav-btn--active", btn.dataset.section === navSection);
    });

    currentSection = sectionId;
  }

  // -------------------------------------------------------------------------
  // Public: Return the currently active section id
  // -------------------------------------------------------------------------
  function getCurrent() {
    return currentSection;
  }

  return { init, switchTo, getCurrent };
})();
