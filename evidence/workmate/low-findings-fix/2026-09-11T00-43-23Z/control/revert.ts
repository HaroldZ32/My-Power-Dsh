// Control builder for the t8 L1-L4 falsifiability check.
//
// Reads the CURRENT (fixed) bundles web-client source and writes a PRE-FIX copy, so the same
// test file can be run against it: every assertion added for t8 L1-L4 must FAIL on the control
// and PASS on the real bytes. A test that cannot fail is not evidence.
//
// Usage: node revert.mjs <in-path> <out-path>
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
let source = readFileSync(input, "utf8");

const reversions = [
  // t8 L2 — zh / en purge busy label (the finding: busy said "删除中…" / "Deleting…").
  ['"mutate.purgeBusy": "彻底删除中…",', '"mutate.purgeBusy": "删除中…",'],
  ['"mutate.purgeBusy": "Purging…",', '"mutate.purgeBusy": "Deleting…",'],
  // t8 L3 — zh wording: the missing 以 and the stray half-width space.
  ['"mutate.reason.confirmRequired": "彻底删除需要输入完整名称以确认",',
    '"mutate.reason.confirmRequired": "彻底删除需要输入完整名称确认",'],
  ["请先结束或归档这些团队：{blocking}", "请先结束或归档这些团队： {blocking}"],
  // t8 L1 — the local same-key refusal (removed, so the dictionary entry is dead again).
  [`
      // The same-key rename is refused HERE, which is what makes \`mutate.reason.sameKey\`
      // reachable: the server answers 400 invalid-name for this case, so without a local
      // check its dictionary entry could never be shown (t8 L1). A name that merely
      // SANITIZES to the current key (e.g. \`GUI-alice\`) still goes to the server, whose own
      // text is authoritative there (§M2).
      if (next === selected) {
        setNotice(null);
        setMutationError(t("mutate.reason.sameKey"));
        return;
      }`, ""],
  // t8 L4 — clearing the previous error when a fresh detail load starts.
  [`
      // A fresh load clears the previous failure: the pane renders its error state whenever
      // \`detail\` is null, so a stale error must not outlive the retry that fixes it (t8 L4).
      setError(null);`, ""],
  // t8 L4 — the pane's failure branch (collapsed back to the unconditional loading text).
  [`        // t8 L4: a detail load that FAILED must say so. Rendering the loading text whenever
        // \`detail\` is null left the pane spinning forever beside the error banner for every
        // failure reason other than \`unknown\` — that one alone closes the pane (no stale
        // selection, contract §H), so every other reason needed its own visible outcome.
        d === null
          ? (error === null
            ? react.createElement("div", { style: MUTED }, t("panel.loading"))
            : react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)))
          : react.createElement("div", { style: { overflowY: "auto" } },`,
    `        d === null ? react.createElement("div", { style: MUTED }, t("panel.loading")) : react.createElement("div", { style: { overflowY: "auto" } },`],
];

for (const [fixed, prefix] of reversions) {
  if (!source.includes(fixed)) {
    console.error("CONTROL BUILD FAILED — the fixed text is absent, so the control would not be pre-fix:\n" + fixed);
    process.exit(1);
  }
  source = source.split(fixed).join(prefix);
}

writeFileSync(output, source);
console.log("control source written: " + output + " (" + source.length + " chars)");
