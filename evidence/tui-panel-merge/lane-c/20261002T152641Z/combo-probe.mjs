// Measures the MPD combo against the INSTALLED dsh-tui keymap module: the same
// `parseCombo`/`canonicalCombo`/`fixedReservedCombos`/`reservedActionCombos` the host's
// `tuiShortcuts.register` validates with.
const keymap = await import("/home/haroldzhao/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/utils/keymap.js")
const { parseCombo, canonicalCombo, fixedReservedCombos, reservedActionCombos, SHORTCUT_ACTIONS } = keymap
const fixed = fixedReservedCombos()
const action = reservedActionCombos()
const cands = ["alt+a", "alt+s", "ctrl+a", "alt+t", "alt+m", "alt+up", "alt+b", "alt+d"]
for (const raw of cands) {
  const parsed = parseCombo(raw)
  const key = parsed === undefined ? "<unparseable>" : canonicalCombo(parsed)
  const shiftless = parsed === undefined ? "<unparseable>" : canonicalCombo({ ...parsed, shift: false })
  const refused = fixed.has(key) || fixed.has(shiftless) || action.has(key) || action.has(shiftless)
  console.log(`${raw.padEnd(8)} key=${String(key).padEnd(8)} ${refused ? "REFUSED" : "accepted"}`)
}
console.log("host action defaults:", SHORTCUT_ACTIONS.map((a) => `${a.id}=${a.defaults.join("|")}`).join(" "))
