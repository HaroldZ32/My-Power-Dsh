// Evidence run for the stateless panel-deployment wave (G1/G2/G4).
//
// SUBJECT: the SHIPPED bytes, not the TypeScript sources — both packages are imported from their built
// `dist/index.js`, so a build that dropped the read-only gate or the attention surface fails here even
// when the source tree still reads correctly.
//
// CASES
//   A. 0.16.1 (host OWNS the list): the enable keeper writes NOTHING — not even the stale-default
//      migration — installs no feed/belt, and says so; the discovered ids still reach `onChange`.
//   B. 0.15.0 (below the ownership gate): the S1 migration still runs exactly once (boundary proof).
//   C/D (the attention surface and the `/mpd status` deployment line) are NOT driven here: the plugin
//      package's public entry re-exports the plugin contract only, so those helpers are proven by the
//      package suites, whose run is captured beside this file (`output.log`). This script's subject is
//      the ADAPTER's shipped bytes, which do export the keeper and both version gates.
import assert from "node:assert/strict"
import { createPanelEnableKeeper, hostOwnsPanelCsv } from "../../../../packages/mpd-tui-adapter-plugin/dist/index.js"

const OURS = ["act1:team", "act1:workmate"]
const STALE_PIN = "todo,jobs,agents"
const HOST_DEFAULT = "todo,jobs,agents,info,trajectory,workspace,btw,companion"
const results = []

/** The host's live-setting double: notifies only on a change, exactly like createLiveSetting. */
function fakeStore(initial) {
  let csv = initial
  const applied = []
  const listeners = new Set()
  const applyValue = (value) => {
    applied.push(value)
    if (value === csv) return
    csv = value
    for (const listener of [...listeners]) listener()
  }
  return {
    store: {
      getSidePanelPanels: () => csv,
      applySidePanelPanels: (value) => { applyValue(String(value)); return csv },
      subscribeSidePanelPanels: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    applied,
    csv: () => csv,
    listeners: () => listeners.size,
  }
}

/** One controllable tick clock. */
function clock() {
  const pending = []
  return {
    schedule: (run) => { pending.push(run); return () => { const at = pending.indexOf(run); if (at >= 0) pending.splice(at, 1) } },
    runNext: async () => { pending.shift()?.(); for (let i = 0; i < 8; i += 1) await Promise.resolve() },
  }
}

// A. the ownership gate's truth table, then the keeper's behaviour on it.
assert.equal(hostOwnsPanelCsv("0.16.1"), true)
assert.equal(hostOwnsPanelCsv("0.16.0"), false)
{
  const fake = fakeStore(STALE_PIN)
  const tick = clock()
  const logged = []
  const keeper = createPanelEnableKeeper({
    loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.16.1", defaultIds: HOST_DEFAULT }),
    schedule: tick.schedule,
    pastIds: () => [],
    log: (line) => logged.push(line),
  })
  keeper.observe(OURS[0]); keeper.observe(OURS[1])
  await tick.runNext()
  assert.deepEqual(fake.applied, [], "A: the owning host received a write")
  assert.equal(fake.listeners(), 0, "A: a belt/feed subscription was installed")
  assert.match(keeper.outcome().detail, /read-only/)
  assert.deepEqual(keeper.outcome().ids, OURS, "A: the discovered ids stopped reaching the record")
  assert.ok(logged.some((line) => line.includes("READ-ONLY on host 0.16.1")), "A: no read-only line")
  results.push({ case: "A", host: "0.16.1", writes: fake.applied.length, subscribers: fake.listeners(), detail: keeper.outcome().detail })
}

// B. the boundary: 0.16.0 still migrates once (the 0.15-era S1 path is untouched).
{
  const fake = fakeStore(STALE_PIN)
  const tick = clock()
  const keeper = createPanelEnableKeeper({
    loadPrefs: async () => ({ prefs: fake.store, hostVersion: "0.16.0", defaultIds: HOST_DEFAULT }),
    schedule: tick.schedule,
    pastIds: () => [],
  })
  keeper.observe(OURS[0]); keeper.observe(OURS[1])
  await tick.runNext()
  assert.deepEqual(fake.applied, [HOST_DEFAULT + "," + OURS.join(",")], "B: the 0.16.0 migration did not run")
  results.push({ case: "B", host: "0.16.0", writes: fake.applied.length, csv: fake.csv() })
}

console.log(JSON.stringify({ ok: true, results }, null, 2))
