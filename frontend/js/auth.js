/**
 * auth.js — Signal Hunt Login / Authentication Logic
 * =====================================================
 * PROTOTYPE: Uses mock data from data.js.
 * No real backend calls are made.
 * =====================================================
 */

const Auth = (() => {
  // Session key used to persist login across page refreshes
  const SESSION_KEY = "sh_session";

  // -------------------------------------------------------------------------
  // Public: Return the current logged-in session, or null if not logged in
  // -------------------------------------------------------------------------
  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Public: Attempt login with selected colour + code
  // Returns { success: true, session } or { success: false, error: string }
  // -------------------------------------------------------------------------
  function login(colourId, teamCode) {
    const trimmedCode = teamCode.trim().toUpperCase();

    // Validate colour selection
    const colour = TEAM_COLOURS.find((c) => c.id === colourId);
    if (!colour) {
      return { success: false, error: "Please select a team colour." };
    }

    // MOCK: Validate team code against hardcoded data
    const validCodes = MOCK_TEAM_CODES[colourId] || [];
    const normalised  = validCodes.map((c) => c.toUpperCase());
    if (!normalised.includes(trimmedCode)) {
      return { success: false, error: "Invalid team code. Check your assignment sheet." };
    }

    // Build session object
    const session = {
      colourId:   colour.id,
      colourLabel: colour.label,
      colourHex:  colour.hex,
      colourTextDark: colour.textDark,
      teamCode:   trimmedCode,
      loginTime:  Date.now(),
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { success: true, session };
  }

  // -------------------------------------------------------------------------
  // Public: Destroy the session (logout)
  // -------------------------------------------------------------------------
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  return { getSession, login, logout };
})();
