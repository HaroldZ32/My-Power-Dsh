# NAMED HOP REQUEST — `scripts/verify-docs-parity.mjs`'s `liveRegionCount` (review `t44` F1, part 5)

**Why this is a request and not an edit:** `scripts/verify-docs-parity.mjs` is OUTSIDE `t55`'s declared
`inScope` (it belongs to the docs-parity lane). Unlike the applier — whose nesting-blind scan I fixed
in- scope — this one file is handed over with its exact replacement text.

**What it does today (measured, `:178-198`):** the helper's own docstring states the bug as a feature —
"a region opening INSIDE another region's span is part of that span, not a region of its own, so a naive
marker grep OVER-counts". On `lib/session-start.js` with the T-42 child nested, it returned **2** for a
file with **3** markers while the registry held 118 and the live markers 119: the gate printed
`markers agree: 118` — a FALSE AGREEMENT that hid the reviewer's finding from every gate.

**The replacement (drop-in; the caller's existing `null` handling already reports a mismatch):**

```js
function liveRegionCount(fileText) {
  const lines = fileText.split("\n");
  let count = 0;
  const open = [];
  for (let index = 0; index < lines.length; index += 1) {
    const begin = /^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[index]);
    if (begin !== null) {
      // t55: a marker is a SIBLING, never a CHILD. A nested child is INVISIBLE to the registry the
      // applier now REFUSES to write, so this must surface as a mismatch (the same `null` the
      // caller already reports for an unterminated region) instead of folding into the parent's span.
      if (open.length > 0) return null;
      open.push(begin[1]);
      continue;
    }
    const end = /^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)\s*$/.exec(lines[index]);
    if (end === null) continue;
    if (open.pop() !== end[1]) return null;
    count += 1;
  }
  return open.length > 0 ? null : count;
}
```

**Acceptance for the hop:** with the applier's refusal in place, seed a nested region in a scratch copy
of `lib/session-start.js` and run `bun run verify:docs` — it must NOT print `markers agree`; it must
report the file as a mismatch. (The current helper cannot: it returns the parent's span as one region.)
