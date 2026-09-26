// NEGATIVE CONTROL for packages/mpd-bundle-plugin/test/watchdog-routes-boot.test.mjs.
//
// Loads the PRE-FIX shipped bytes (git HEAD's dist/index.js, extracted beside this script)
// and drives the SAME late-bind scenario the new test asserts. The old plugin must register
// ZERO routes there — that is the live 404 — so the new test is provably falsifiable rather
// than merely green.
import { apply } from "./old-index.mjs"

const STATE_PATH = "/plugins/mpd-team-watchdog/state"
const ACK_PATH = "/plugins/mpd-team-watchdog/ack"

function fakeHost({ bindAtApply = false } = {}) {
  const services = new Map()
  const routes = new Map()
  const serviceListeners = []
  const webServer = {
    register: (route) => { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  }
  if (bindAtApply) services.set("webServer", webServer)
  const ctx = {
    get: (name) => services.get(name),
    on: (event, listener) => { if (event === "internal/service") serviceListeners.push(listener); return () => {} },
    effect: (fn) => { const disposer = fn(); return typeof disposer === "function" ? disposer : () => {} },
  }
  return {
    ctx,
    routes,
    webServer,
    bindService: (name, value) => {
      services.set(name, value)
      for (const listener of serviceListeners) listener(name, value)
    },
  }
}

const late = fakeHost()
apply(late.ctx)
late.bindService("webServer", late.webServer)
const latePaths = [...late.routes.keys()].sort()

const early = fakeHost({ bindAtApply: true })
apply(early.ctx)
const earlyPaths = [...early.routes.keys()].sort()

const reported = {
  lateBindPaths: latePaths,
  atApplyPaths: earlyPaths,
  expected: [ACK_PATH, STATE_PATH],
}
console.log(JSON.stringify(reported, null, 2))

// The control PASSES when the old code reproduces the defect: nothing late, and the
// apply-time path (which is why the bundle-only QA case never caught it) still works.
const reproducesDefect = latePaths.length === 0 && earlyPaths.join() === [ACK_PATH, STATE_PATH].join()
console.log("[negative-control] old bytes reproduce the live 404 on a late bind: " + reproducesDefect)
process.exit(reproducesDefect ? 0 : 1)
