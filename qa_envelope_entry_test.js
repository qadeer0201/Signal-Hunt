// Regression for the participant's Level 1–4 envelope-code entry action.
// Rendered-browser progression is also recorded in QA_REPORT.md.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("Frontend/js/pages/game-flow.js", "utf8");
const listeners = new Map();
const openButton = { addEventListener: (event, callback) => listeners.set(`open:${event}`, callback) };
let submitButton;
const form = {
  addEventListener: (event, callback) => listeners.set(`form:${event}`, callback),
  querySelector: () => submitButton,
  setAttribute: () => {}, removeAttribute: () => {}, isConnected: true
};
let inputListener;
let focusCount = 0;
const input = { value: "TEST-CODE-123", disabled: false, addEventListener: (event, callback) => { if (event === "input") inputListener = callback; }, focus() { focusCount++; } };
const message = { hidden: true, textContent: "", className: "" };
submitButton = { disabled: false, textContent: "VERIFY ENVELOPE CODE" };
const state = {
  currentTeam: { id: 1 }, participantAuthenticated: true,
  gameStatus: "active", currentLevel: 1, completedLevels: 0,
  currentLevelTimedOut: false, currentLevelTimerActive: true,
  currentLevelRemainingSeconds: 900, timerUpdatedAt: Date.now(),
  eliminated: false, completed: false, currentPage: "station-code"
};
const shown = [];
const document = {
  fullscreenElement: null,
  documentElement: { requestFullscreen: async () => {} },
  addEventListener: () => {},
  getElementById(id) {
    if (id === "initiate-transmission") return openButton;
    if (id === "station-code-form") return form;
    if (id === "station-code-input") return input;
    if (id === "station-code-message") return message;
    return null;
  }
};
let submissionCount = 0;
let finishSubmission;
const window = {
  SignalHuntState: state,
  SignalHuntData: { copy: { stationPlaceholder: "Enter envelope code…", emptyCode: "Enter a code." } },
  SignalHuntAPI: {
    getTeamCurrent: async () => ({ status: "active", progress: {} }),
    applyProgress: () => {},
    submitEnvelopeCode: async () => {
      submissionCount++;
      return new Promise(resolve => { finishSubmission = resolve; });
    }
  },
  Navigation: { show: page => shown.push(page), showToast: () => {} },
  setInterval: () => 1
};
vm.runInNewContext(source, { window, document, setInterval: () => 1, clearInterval: () => {}, Number, String, Math, Date });
window.GameFlow.init();

assert.equal(typeof listeners.get("open:click"), "function", "Level 1 entry button must have a click handler");
listeners.get("open:click")();
assert.equal(shown.at(-1), "station-code", "clicking the button must open the existing code-entry view");
assert.equal(typeof listeners.get("form:submit"), "function", "the code form must retain its submit handler");
assert.equal(typeof inputListener, "function", "editing the field should clear only its previous error");

state.currentLevel = 2;
listeners.get("open:click")();
state.currentLevel = 3;
listeners.get("open:click")();
state.currentLevel = 4;
listeners.get("open:click")();
assert.deepEqual(shown, ["station-code", "station-code", "station-code", "station-code"]);

(async () => {
  input.value = "PASTED-CODE-123";
  const oldFocusCount = focusCount;
  await window.GameFlow.refreshStatus();
  assert.equal(input.value, "PASTED-CODE-123", "status refresh must preserve typed or pasted input");
  assert.equal(focusCount, oldFocusCount, "background status refresh must not steal focus");
  window.GameFlow.prepareCodeEntry(false);
  assert.equal(input.value, "PASTED-CODE-123", "reopening the entry page must preserve its draft");
  input.value = "TEST-CODE-123";
  const first = window.GameFlow.submitCode();
  const duplicate = window.GameFlow.submitCode();
  assert.equal(submissionCount, 1, "a second submit while verification is pending must not call the API twice");
  assert.equal(submitButton.disabled, true, "submit control must be disabled while checking");
  finishSubmission({ ok: false, message: "Test rejection; retry." });
  await Promise.all([first, duplicate]);
  assert.equal(message.hidden, false, "backend rejection must be shown inline");
  assert.equal(message.textContent, "Test rejection; retry.");
  assert.equal(input.disabled, false, "the input must be enabled again so the participant can retry");
  assert.equal(submitButton.disabled, false, "the submit control must be restored after rejection");
  console.log("Envelope-entry regression PASS: click opens the code view at Levels 1–4; polling and revisit preserve input/focus; duplicate submissions lock; rejection stays retryable.");
})().catch(error => { console.error(error); process.exitCode = 1; });
