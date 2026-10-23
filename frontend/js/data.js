
/* Signal Hunt: confirmed frontend content and display data. */
window.SignalHuntData = {
  event: {
    name: "Signal Hunt",
    fest: "Nexus Vyoma 2026",
    returnLocation: "Rooms 07 & 08"
  },

  teams: [
    { id: "black", name: "Black", color: "#171717", icon: "◆" },
    { id: "red", name: "Red", color: "#c93636", icon: "⚑" },
    { id: "navy", name: "Navy Blue", color: "#233e65", icon: "◈" },
    { id: "yellow", name: "Yellow", color: "#e6c83d", icon: "✦" },
    { id: "orange", name: "Orange", color: "#e87832", icon: "ϟ" },
    { id: "green", name: "Green", color: "#26794b", icon: "❖" },
    { id: "purple", name: "Purple", color: "#743bb0", icon: "✧" },
    { id: "grey", name: "Grey", color: "#91949a", icon: "⬡" },
    { id: "brown", name: "Brown", color: "#75472e", icon: "⌘" },
    { id: "peach", name: "Peach", color: "#e9a08d", icon: "◉" }
  ],

  stations: [
    {
      level: 1,
      id: "morse",
      name: "Morse Code",
      short: "MORSE CODE",
      description: "Dots and dashes conceal the message. Decode the rhythm to reveal the hidden truth.",
      instruction: "Solve the physical clue at your station, then enter the unique code from the envelope.",
      icon: "assets/morse-icon.webp",
      image: "assets/morse-code.webp",
      explanation: "Morse Code represents letters and numbers using short and long signals. Read the pattern carefully and keep the spacing between letters in mind."
    },
    {
      level: 2,
      id: "binary",
      name: "Binary ASCII",
      short: "BINARY ASCII",
      description: "Only 0s and 1s hold the key. Read the digital trail to uncover what lies beneath.",
      instruction: "Study the binary clue and decode the information before submitting your station code.",
      icon: "assets/binary-icon.webp",
      image: "assets/binary-ascii.webp",
      explanation: "In standard 8-bit ASCII, each character is represented by eight binary digits. Keep leading zeroes and decode each group of eight bits."
    },
    {
      level: 3,
      id: "fsk",
      name: "FSK Signals",
      short: "FSK SIGNALS",
      description: "Frequencies shift, and secrets travel unseen. Decode the changing signals to uncover the message.",
      instruction: "Compare the signal frequencies and follow the clue given at your station.",
      icon: "assets/fsk-icon.webp",
      image: "assets/fsk-signals.webp",
      explanation: "Frequency Shift Keying represents binary data using two different frequencies. In common examples, the lower frequency represents 0 and the higher frequency represents 1."
    },
    {
      level: 4,
      id: "final",
      name: "Final Challenge",
      short: "FINAL CHALLENGE",
      description: "Combine what you learned. Every signal you decoded leads toward the final transmission.",
      instruction: "Use your team's observations from all earlier stages to solve the final physical clue.",
      icon: "assets/signal-hunt-logo.webp",
      image: null,
      explanation: "Use the patterns you learned in Morse Code, Binary ASCII, and FSK Signals. Check the clue carefully and work with your registered team."
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
    "Teams must decode each clue and submit the correct answers on the website.",
    "Teams must not skip stages or enter restricted areas.",
    "Work only with your registered team members.",
    "Do not tamper with other teams' materials.",
    "Do not use outside assistance or unauthorized AI help.",
    "Stay within the designated event areas.",
    "Repeated violation of rules will lead to disqualification.",
    "Harassment and unsafe conduct will lead to immediate termination.",
    "Follow announcements and instructions carefully given by the organizing team.",
    "Submit answers carefully on the website.",
    "Keep your personal team details private."
  ],

  copy: {
    loginInstruction: "Your mission begins here. Enter your Team Code to establish your signal.",
    loginError: "SIGNAL NOT RECOGNIZED — Invalid Team Code. Verify your credentials and try again.",
    welcome: "WELCOME, OPERATIVE!",
    welcomeBody: "Your team is connected. Prepare to decode the signals and begin your mission.",
    waitingTitle: "STATUS: AWAITING THE SIGNAL…",
    waitingBody: "The frequency is silent. Await the host’s transmission to begin your hunt.",
    missionTitle: "MISSION BRIEFING: SIGNAL HUNT",
    missionBody: "A signal has emerged from the unknown. Hidden codes hold the truth, and every clue leads deeper into the mystery. Decode the transmissions. Uncover what lies beneath. Your mission begins when the signal calls.",
    activeBody: "The hunt is live; every signal leads closer to the truth.",
    stationPlaceholder: "Enter the classified station code…",
    emptyCode: "No signal detected. Enter the station code to proceed.",
    invalidCode: "Signal rejected. The code does not match our records. Try again.",
    successTitle: "SIGNAL DECODED — ACCESS GRANTED",
    successBody: "The code is verified. Another mystery solved; your mission continues.",
    invalidTitle: "SIGNAL REJECTED — ACCESS DENIED",
    invalidBody: "The code is unrecognised. Recheck the signal and try again.",
    completeTitle: "MISSION ACCOMPLISHED",
    completeBody: "Every signal decoded. Every mystery uncovered. Your team has conquered the hunt. The final transmission is complete.",
    eliminatedTitle: "MISSION TERMINATED — ACCESS REVOKED",
    eliminatedBody: "Your signal has been terminated. You are no longer authorised to continue the hunt."
  }
};

window.SignalHuntState = {
  currentTeam: null,
  currentPage: "home",
  currentLevel: 1,
  completedLevel: 0,
  completedStation: null,
  demoGameStarted: false,
  mockMode: true,
  eliminationReason: "Leaving the website or navigating back violated the zero-warning policy."
};
