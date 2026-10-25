/* Signal Hunt: Confirmed frontend content and display data for 4 Teams / 4 Stations */
window.SignalHuntData = {
  event: {
    name: "Signal Hunt",
    fest: "Nexus Vyoma 2026",
    returnLocation: "Rooms 07 & 08",
    durationMinutes: 120
  },

  // 12 Event Teams (Max 60 participants, 5 per team)
  teams: [
    { id: "red", name: "Red", color: "#c93636", icon: "⚑", active: true },
    { id: "black", name: "Black", color: "#171717", icon: "◆", active: true },
    { id: "navy", name: "Navy Blue", color: "#233e65", icon: "◈", active: true },
    { id: "yellow", name: "Yellow", color: "#e6c83d", icon: "✦", active: true },
    { id: "orange", name: "Orange", color: "#e87832", icon: "ϟ", active: true },
    { id: "green", name: "Green", color: "#26794b", icon: "❖", active: true },
    { id: "purple", name: "Purple", color: "#743bb0", icon: "✧", active: true },
    { id: "grey", name: "Grey", color: "#91949a", icon: "⬡", active: true },
    { id: "brown", name: "Brown", color: "#75472e", icon: "⌘", active: true },
    { id: "peach", name: "Peach", color: "#e9a08d", icon: "◉", active: true },
    { id: "cyan", name: "Cyan", color: "#17b8be", icon: "▲", active: true },
    { id: "white", name: "White", color: "#e2e8f0", icon: "☼", active: true }
  ],

  stations: [
    {
      level: 1,
      id: "morse",
      name: "Morse Code",
      short: "MORSE CODE",
      description: "Dots and dashes conceal the message. Decode the rhythm to reveal the hidden signal.",
      instruction: "Decode the transmitted pulses and solve each riddle in sequence.",
      icon: "assets/morse-icon.webp",
      image: "assets/morse-code.webp",
      explanation: "Morse Code represents letters and numbers using short and long pulses. Spacing between letters separates characters."
    },
    {
      level: 2,
      id: "binary",
      name: "Binary ASCII",
      short: "BINARY ASCII",
      description: "Only 0s and 1s hold the key. Read the digital trail to uncover what lies beneath.",
      instruction: "Study the binary byte sequence and decode the text before entering your answer.",
      icon: "assets/binary-icon.webp",
      image: "assets/binary-ascii.webp",
      explanation: "In standard 8-bit ASCII, each character is represented by 8 binary digits. Keep leading zeros when decoding."
    },
    {
      level: 3,
      id: "fsk",
      name: "FSK Signals",
      short: "FSK SIGNALS",
      description: "Frequencies shift, and secrets travel unseen. Decode the changing carrier wave.",
      instruction: "Compare the signal frequencies and deduce the decoded state.",
      icon: "assets/fsk-icon.webp",
      image: "assets/fsk-signals.webp",
      explanation: "Frequency Shift Keying represents data using low and high frequencies across a carrier waveform."
    },
    {
      level: 4,
      id: "final",
      name: "Final Challenge",
      short: "FINAL CHALLENGE",
      description: "Combine all earlier disciplines. Every decoded transmission converges at the final node.",
      instruction: "Synthesize observations from Morse, Binary, and FSK to unlock the final transmission.",
      icon: "assets/signal-hunt-logo.webp",
      image: null,
      explanation: "Combine what you learned. The final passkey completes the Nexus Vyoma transmission."
    }
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
    "Teams must decode each clue in sequence and submit answers on the web terminal.",
    "Teams must not skip stages or enter restricted campus areas.",
    "Work strictly with your registered 5 team members.",
    "Do not tamper with physical clues or other teams' station materials.",
    "Do not use outside assistance or unauthorized AI tools.",
    "Stay within the designated event boundaries shown on the Campus Map.",
    "Repeated violation of event rules will lead to disqualification.",
    "Harassment and unsafe conduct will lead to immediate event disqualification.",
    "Follow all live announcements given by the organizing committee.",
    "Submissions are rate-limited to discourage random guessing.",
    "Keep your unique team access code private."
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
    activeBody: "The hunt is live; solve your assigned station riddle and transmit the answer.",
    stationPlaceholder: "Enter decoded riddle answer…",
    emptyCode: "No transmission detected. Enter your decoded answer to verify.",
    invalidCode: "Signal rejected. The decoded answer does not match our records. Try again.",
    successTitle: "SIGNAL DECODED — ACCESS GRANTED",
    successBody: "The solution is verified. Riddle solved; your mission continues.",
    invalidTitle: "SIGNAL REJECTED — ACCESS DENIED",
    invalidBody: "The answer was not recognized. Recheck your notes and try again.",
    completeTitle: "MISSION ACCOMPLISHED",
    completeBody: "Every signal decoded. Every mystery uncovered. Your team has conquered Signal Hunt. Report to Rooms 07 & 08.",
    eliminatedTitle: "MISSION TERMINATED — ACCESS REVOKED",
    eliminatedBody: "Your signal has been terminated by an event rule violation. Report to the organizer."
  }
};

window.SignalHuntState = {
  currentTeam: null,
  teamCode: null,
  currentPage: "home",
  currentLevel: 1,
  currentRiddle: 1,
  completedLevel: 0,
  solvedCount: 0,
  totalClues: 16,
  currentClue: null,
  gameStatus: "waiting",
  remainingSeconds: 7200,
  eliminated: false,
  completed: false,
  eliminationReason: "Violation recorded under event security policy."
};
