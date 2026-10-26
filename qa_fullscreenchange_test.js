// Unit-level regression for the participant fullscreenchange policy.
// This is not a substitute for testing the Fullscreen API in Chrome.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("Frontend/js/pages/game-flow.js", "utf8");

function setup(gameStatus) {
  const listeners = new Map();
  const calls = [];
  const shown = [];
  const state = {
    currentTeam: { id: 1 }, participantAuthenticated: true,
    fullscreenRequired: true, gameStatus, eliminated: false,
    currentLevelRemainingSeconds: 300, currentLevelTimerActive: true
  };
  const document = {
    fullscreenElement: null,
    documentElement: { requestFullscreen: async () => { document.fullscreenElement = {}; } },
    addEventListener: (name, callback) => listeners.set(name, callback),
    getElementById: () => null
  };
  const window = {
    SignalHuntState: state,
    SignalHuntAPI: {
      getTeamCurrent: () => new Promise(() => {}),
      reportViolation: async (...args) => {
        calls.push(args);
        return { ok: true, eliminated: true, message: "Fullscreen exit recorded." };
      }
    },
    Navigation: { show: page => shown.push(page), showToast: () => {} },
    setInterval: () => 1,
    clearTimeout: () => {}
  };
  vm.runInNewContext(source, {
    window, document,
    setInterval: () => 1,
    clearInterval: () => {},
    Number, String, Math, Date
  });
  window.GameFlow.init();
  return { document, listeners, calls, shown, state, window };
}

(async () => {
  const active = setup("active");
  assert.deepEqual([...active.listeners.keys()], ["fullscreenchange"]);
  active.document.fullscreenElement = {};
  await active.listeners.get("fullscreenchange")();
  assert.equal(active.window.GameFlow.fullscreenWasEntered, true);
  active.document.fullscreenElement = null;
  await active.listeners.get("fullscreenchange")();
  assert.equal(active.calls.length, 1);
  assert.equal(active.calls[0][0], "fullscreen_exit");
  assert.equal(active.state.eliminated, true);
  assert.equal(active.shown.at(-1), "eliminated");

  const waiting = setup("waiting");
  waiting.document.fullscreenElement = {};
  await waiting.listeners.get("fullscreenchange")();
  waiting.document.fullscreenElement = null;
  await waiting.listeners.get("fullscreenchange")();
  assert.equal(waiting.calls.length, 0, "exiting fullscreen before active gameplay must not eliminate");

  console.log("fullscreenchange unit regression PASS: active exit reports and eliminates; waiting exit does not; no Back/visibility/page lifecycle detector is registered.");
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
