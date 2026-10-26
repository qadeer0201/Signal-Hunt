/* Signal Hunt: one event website, with an organizer-configured team roster. */
window.SignalHuntData = {
  event: {
    name: "Signal Hunt",
    fest: "Nexus Vyoma 2026",
    returnLocation: "Rooms 07 & 08",
    plannedEventMinutes: 120
  },

  // Display palette; only colours assigned to registered teams appear at participant login.
  teams: [
    { id: "red", name: "Red", color: "#c93636", icon: "⚑" },
    { id: "blue", name: "Blue", color: "#233e65", icon: "◈" },
    { id: "green", name: "Green", color: "#26794b", icon: "❖" },
    { id: "yellow", name: "Yellow", color: "#e6c83d", icon: "✦" },
    { id: "orange", name: "Orange", color: "#e87832", icon: "ϟ" },
    { id: "purple", name: "Purple", color: "#743bb0", icon: "✧" },
    { id: "cyan", name: "Cyan", color: "#20aeb9", icon: "⬡" },
    { id: "white", name: "White", color: "#f1f0e7", icon: "◇" },
    { id: "silver", name: "Silver", color: "#aeb4be", icon: "⌘" },
    { id: "gold", name: "Gold", color: "#c79b25", icon: "◉" }
  ],

  stations: [
    { level: 1, id: "level-1", name: "Level 1", short: "LEVEL 01", description: "Use the riddle in your physical envelope to discover the next location.", instruction: "Find your team's envelope, then enter the unique verification code printed inside.", icon: "assets/morse-icon.webp", image: "assets/morse-code.webp", explanation: "Decode the signal in your physical clue, solve the riddle, and search for your team's envelope." },
    { level: 2, id: "level-2", name: "Level 2", short: "LEVEL 02", description: "Your next physical clue leads to another hidden envelope.", instruction: "Use the clue printed in the envelope. Do not rely on the website for physical locations.", icon: "assets/binary-icon.webp", image: "assets/binary-ascii.webp", explanation: "The website records level verification; the physical envelope provides the riddle and destination." },
    { level: 3, id: "level-3", name: "Level 3", short: "LEVEL 03", description: "Continue the hunt using your next physical riddle.", instruction: "Find the correct envelope and enter its code to verify this level.", icon: "assets/fsk-icon.webp", image: "assets/fsk-signals.webp", explanation: "Read your team's envelope carefully and enter only the envelope verification code on the website." },
    { level: 4, id: "level-4", name: "Level 4", short: "LEVEL 04", description: "Complete your final physical clue and retrieve the final envelope.", instruction: "After the final envelope is verified, return to Rooms 7 & 8. A physical volunteer confirms finish order.", icon: "assets/signal-hunt-logo.webp", image: null, explanation: "The website records completion only. The physical volunteer confirms the official winner." }
  ],

  knowledge: [
    {
      id: "morse",
      title: "MORSE CODE",
      description: "Dots and dashes conceal the message. Decode the rhythm to reveal the hidden truth.",
      icon: "assets/morse-icon.webp",
      image: "assets/morse-code.webp",
      explanation: "Morse Code represents letters, numbers and symbols using short and long signals. Decode one pattern at a time and pay attention to spacing."
    },
    {
      id: "binary",
      title: "BINARY ASCII",
      description: "Only 0s and 1s hold the key. Read the digital trail to uncover what lies beneath.",
      icon: "assets/binary-icon.webp",
      image: "assets/binary-ascii.webp",
      explanation: "Standard 8-bit ASCII maps each character to eight binary digits. Split the message into groups of eight and preserve leading zeroes."
    },
    {
      id: "fsk",
      title: "FSK SIGNALS",
      description: "Frequencies shift, and secrets travel unseen. Decode the changing signals to uncover the message.",
      icon: "assets/fsk-icon.webp",
      image: "assets/fsk-signals.webp",
      explanation: "Frequency Shift Keying uses different frequencies to represent binary states. Observe the waveform pattern and compare low and high frequency sections."
    }
  ],

  rules: [
    "Decode the missing word in the physical riddle, solve the riddle, and find your team's hidden envelope.",
    "Enter the unique verification code from the envelope to record level completion.",
    "Work only with your registered team of 3–5 members.",
    "Do not tamper with physical clues or other teams' envelopes.",
    "Do not use outside assistance or unauthorized AI tools.",
    "Stay within organizer-approved campus areas and follow volunteer directions.",
    "Stay in browser fullscreen during active gameplay. A detected fullscreen exit eliminates the team; ask the organizer for reinstatement.",
    "An eliminated team's level timer keeps running. Reinstatement does not reset or refund elapsed time.",
    "Use in-app navigation between Home, Mission, Knowledge, Campus Map, Rules and Security.",
    "Do not share team login codes or envelope verification codes with other teams.",
    "Return to Rooms 7 & 8 with the final envelope. A physical volunteer verifies finish order."
  ],

  copy: {
    loginInstruction: "Select your team colour and enter your classified team access code.",
    loginError: "SIGNAL REJECTED — Invalid Team Code. Check credentials or team colour.",
    welcome: "WELCOME, OPERATIVE!",
    welcomeBody: "Your terminal is authenticated. Stand by for host transmission.",
    waitingTitle: "STATUS: AWAITING THE SIGNAL…",
    waitingBody: "The frequency is silent. The countdown will begin once the organizer initiates the hunt.",
    missionTitle: "MISSION BRIEFING: SIGNAL HUNT",
    missionBody: "A signal has emerged from the unknown. Hidden codes hold the truth, and every clue leads deeper into the mystery. Decode the transmissions. Uncover what lies beneath.",
    activeBody: "Use the physical riddle to find your team's next hidden envelope.",
    stationPlaceholder: "Enter the code printed inside your envelope…",
    emptyCode: "Enter the envelope verification code to continue.",
    invalidCode: "That code is not correct for your team's current level. Check the envelope and try again.",
    successTitle: "LEVEL VERIFIED — ACCESS GRANTED",
    successBody: "The envelope code is verified. Follow the next physical riddle.",
    invalidTitle: "CODE REJECTED — TRY AGAIN",
    invalidBody: "The envelope code was not recognized for your team's current level.",
    completeTitle: "FOUR LEVELS VERIFIED",
    completeBody: "Return to Rooms 7 & 8 with your final envelope. A physical volunteer confirms the official finishing order.",
    eliminatedTitle: "MISSION TERMINATED — ACCESS REVOKED",
    eliminatedBody: "Your team has been eliminated under the event rules. The organizer may reinstate you; your level timer will continue."
  }
};

window.SignalHuntState = {
  currentTeam: null,
  participantAuthenticated: false,
  deviceId: null,
  currentPage: "home",
  currentLevel: 1,
  completedLevels: 0,
  totalLevels: 4,
  currentLevelRemainingSeconds: null,
  currentLevelTimeLimitSeconds: null,
  currentLevelTimedOut: false,
  currentLevelTimerActive: false,
  gameStatus: "waiting",
  eliminated: false,
  eliminatedReason: "Violation recorded under event security policy.",
  completed: false,
  fullscreenRequired: false,
  timerUpdatedAt: 0
};
