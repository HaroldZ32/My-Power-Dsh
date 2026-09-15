// t36 addendum: falsify the FINAL duplicate-key rule directly against the shipped code.
const m = await import("/root/dshProj/my-power-dsh/packages/mpd-config-plugin/src/jsonc-edit.ts")
const raw = '{\n  "ulw": {\n    "maxRounds": 3,\n    "maxRounds": 7,\n  },\n}\n'
const del = m.surgicalDelete(raw, ["ulw", "maxRounds"])
const set = m.surgicalEdit(raw, ["ulw", "maxRounds"], 9)
const count = (t) => (t.match(/maxRounds/g) ?? []).length
const out = {
  input: raw,
  unset: {
    ok: del.ok,
    reason: del.reason ?? null,
    text: del.ok === true ? del.text : null,
    occurrencesRemaining: del.ok === true ? count(del.text) : null,
    rule: "UNSET removes EVERY occurrence in one pass",
  },
  set: {
    ok: set.ok,
    reason: set.reason ?? null,
    text: set.ok === true ? set.text : null,
    occurrencesRemaining: set.ok === true ? count(set.text) : null,
    lastIsEdited: set.ok === true ? /"maxRounds": 9/.test(set.text) : null,
    firstKept: set.ok === true ? /"maxRounds": 3/.test(set.text) : null,
    rule: "SET edits the LAST occurrence, succeeds, warns with every occurrence line",
    warnings: set.warnings ?? set.notes ?? null,
  },
}
console.log(JSON.stringify(out, null, 1))
