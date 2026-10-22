/**
 * data.js — Signal Hunt Phase 1 Mock Data
 * =====================================================
 * PROTOTYPE ONLY: All team codes and data here are
 * hardcoded for frontend demonstration purposes.
 * Replace with real API calls in Phase 2.
 * =====================================================
 */

// ---------------------------------------------------------------------------
// MOCK: Valid team codes per colour
// Format: { colourId: ["CODE1", "CODE2", ...] }
// In production these would come from a secure backend.
// ---------------------------------------------------------------------------
const MOCK_TEAM_CODES = {
  red:    ["RED-ALPHA", "RED-7731"],
  blue:   ["BLUE-NOVA", "BLUE-4492"],
  green:  ["GRN-ECHO", "GRN-2208"],
  yellow: ["YLW-STORM", "YLW-8816"],
  orange: ["ORG-BLAZE", "ORG-3355"],
  purple: ["PRP-VIPER", "PRP-6604"],
  cyan:   ["CYN-FROST", "CYN-1147"],
  white:  ["WHT-GHOST", "WHT-9900"],
  silver: ["SLV-SHADE", "SLV-5523"],
  gold:   ["GLD-CROWN", "GLD-7777"],
};

// ---------------------------------------------------------------------------
// MOCK: Team colour definitions (display name + CSS colour value)
// ---------------------------------------------------------------------------
const TEAM_COLOURS = [
  { id: "red",    label: "Red",    hex: "#D94141", textDark: false },
  { id: "blue",   label: "Blue",   hex: "#3A7FD5", textDark: false },
  { id: "green",  label: "Green",  hex: "#3DAF6E", textDark: false },
  { id: "yellow", label: "Yellow", hex: "#F5C842", textDark: true  },
  { id: "orange", label: "Orange", hex: "#F07A2B", textDark: false },
  { id: "purple", label: "Purple", hex: "#8B5CF6", textDark: false },
  { id: "cyan",   label: "Cyan",   hex: "#22D3EE", textDark: true  },
  { id: "white",  label: "White",  hex: "#F0EDE6", textDark: true  },
  { id: "silver", label: "Silver", hex: "#A8B2C1", textDark: true  },
  { id: "gold",   label: "Gold",   hex: "#D8B84A", textDark: true  },
];

// ---------------------------------------------------------------------------
// MOCK: Game state — host has NOT started the game yet.
// In production this would be a live WebSocket or polling value.
// ---------------------------------------------------------------------------
const GAME_STATE = {
  started: false,      // real game status is not connected; preview button simulates this locally
  previewOnly: true,
  eventName: "Nexus Vyoma 2026",
  eventSubtitle: "Signal Hunt — Campus Puzzle Challenge",
};

// ---------------------------------------------------------------------------
// Sections for the navigation bar
// ---------------------------------------------------------------------------
const NAV_SECTIONS = [
  { id: "home",      label: "Home",      icon: "⌂" },
  { id: "mission",   label: "Mission",   icon: "◈" },
  { id: "knowledge", label: "Knowledge", icon: "⬡" },
  { id: "rules",     label: "Rules",     icon: "⊞" },
];
