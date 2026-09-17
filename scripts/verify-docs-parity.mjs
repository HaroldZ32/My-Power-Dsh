#!/usr/bin/env node
// Repo gate: the bilingual documentation policy of AGENTS.md (Language policy section).
//
// WHY THIS EXISTS: the policy was previously unenforced — `scripts/pack-mpd.mjs` COPIES each
// package's README pair without asserting anything, and the QA lanes only read single docs. This
// gate was promoted from the prototype written during the docs task
// (`evidence/tui/docs-completeness/20260915T153835Z/docs-parity.mjs`, 87/87 on its five pairs).
//
// DISCOVERY (what a green run actually covers — stated so no reader over-reads it):
//   * the root `README.md` + `README.zh-CN.md`;
//   * EVERY `*.md` under `docs/` at ANY DEPTH (a recursive walk, so nesting cannot hide a pair),
//     with the AGENTS.md §3 process records exempted from the missing-twin rule;
//   * `extensions/**/README.md` at any depth, plus every `*.zh-CN.md` under `extensions/`; the other
//     `.md` files there (extension skills, personas) are ASSETS, not documentation, and are not
//     asked for a twin;
//   * `packages/*/README.md` + its zh twin. A package directory WITHOUT a README is a FAILURE unless
//     it is the one recorded exemption (`packages/mpd-mcp-shared`), so the census cannot stay green
//     while a package is undocumented.
//
// For every bilingual pair it asserts:
//   1. both files exist;
//   2. a switch link sits directly under the title and points at the twin;
//   3. the heading TREE (levels + order, fenced code excluded) is identical;
//   4. the zh-CN file actually carries CJK content (a copy-paste of the English file fails).
// It also runs the INVERSE scan: every `*.zh-CN.md` it discovers must have its non-zh twin; a
// zh-only document is reported as `zh-CN file has no EN twin` (an exempt path stays a reported
// exemption instead of a violation).
//
// It ALSO checks the hand-carried DERIVED values (T-75): the delta-table pointer in the manual
// (`AGENTS.md`) AND in the on-demand index that repeats it (`agent-references/index.md`), plus the
// registry's own region/file count statement, are compared against the value the ARTIFACT derives
// — the transcription table for the range, the GENERATED
// `lib/mpd-deltas.js` registry (corroborated by the live `//#region mpd-delta` markers) for the
// counts. The measured defect: `t39` moved the pointer `A1–D26 → A1–D38`, a later §6 rewrite
// restored the pre-`t39` text, and this gate was GREEN on both revisions — a stale snapshot
// silently reverted a delivered fix, and only reading the file caught it (wave-1 `L78`). The
// artifact wins, never the newer pointer; a site whose claim is GONE is a violation, not a
// silent pass.
//
// EXEMPTION BOOKKEEPING (why the count can exceed what is live here): of the entries in
// `EXEMPT_LONE_FILES`, THIRTEEN correspond to files that exist in this tree today; `docs/adder4.md`
// and `docs/cnt8.md` are ANTICIPATORY entries kept BY DESIGN (t39, 2026-09-17): the manual no longer
// names them as examples — it named two paths that do not exist in this tree, and that stale citation
// was removed from BOTH ends in one change. This list is now their single source: a future addition of
// either file is exempted by design rather than by accident, and the census is unchanged. The run prints every exemption with its reason, so the count is never
// read as "N live paths" without the reasons beside it.
//
// Usage:
//   node scripts/verify-docs-parity.mjs [--root <dir>] [--json <path>]
//   node scripts/verify-docs-parity.mjs --self-test
//
// Exit: 0 when every checked pair passes and no violation is reported (exemptions are printed,
// never silent), 1 otherwise.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── T-30: lone-file exemptions are DERIVED from the file itself ───────────────────────────────
// An exemption means ONLY that a missing zh twin is not a violation; it never suppresses the checks
// for a pair that exists (an exempt file that GAINS a zh-CN twin is checked like any other pair and
// must then satisfy all four rules). Two derived sources replaced the hand-maintained per-file map:
//   * the IN-FILE MARKER `<!-- docs-parity: exempt <reason> -->` — any `*.md` carrying it is
//     reported with the marker's OWN reason, so a new historical doc is exempted WITHOUT editing
//     this gate, and the same doc without the marker is a normal policed file (T-30's observable);
//   * a declared PATTERN table for the classes the AGENTS.md §3 policy names BY GLOB (the plan
//     files) — a policy shape, not a per-file list.
// The two ANTICIPATORY paths are kept by design and PRINTED as their own class: they do not exist
// in this tree, an anticipatory exemption can rot silently, and silence is the failure this row
// removes (t39 recorded them; retiring them is a captain decision, not a silent drop).
const EXEMPT_MARKER = /<!--\s*docs-parity:\s*exempt\s+([^>]*?)\s*-->/;
const EXEMPT_PATTERNS = [{ pattern: /^docs\/plan-[^/]+\.md$/, reason: "process record (AGENTS.md §3: plan-*.md)" }];
const ANTICIPATORY_EXEMPTIONS = new Map([
  ["docs/adder4.md", "internal QA/golden reference — ANTICIPATORY by design: the file does not exist in this tree yet; t39 removed the stale citation from both ends and this list is the single source"],
  ["docs/cnt8.md", "internal QA/golden reference — ANTICIPATORY by design: the file does not exist in this tree yet; t39 removed the stale citation from both ends and this list is the single source"],
]);
const EXEMPT_WITHOUT_README = new Map([
  ["packages/mpd-mcp-shared", "ships source and tests only; its README pair is a recorded follow-up"],
]);
// A third, deliberately tiny source: files whose BYTES must stay verbatim, so the in-file marker
// cannot be added without destroying the property that earns the exemption.
const EXEMPT_PROVENANCE = new Map([
  ["packages/mpd-agent-teams-plugin/README.md", "adopted upstream main code, kept VERBATIM as provenance — its bytes cannot carry a marker"],
]);
const markerExemption = (text) => {
  const match = EXEMPT_MARKER.exec(text ?? "");
  return match === null ? undefined : match[1];
};
const patternExemption = (rel) => EXEMPT_PATTERNS.find((entry) => entry.pattern.test(rel))?.reason;
const isExemptLone = (rel, text) => patternExemption(rel) !== undefined || markerExemption(text) !== undefined || EXEMPT_PROVENANCE.has(rel);
const exemptReason = (rel, text) => patternExemption(rel) ?? markerExemption(text) ?? EXEMPT_PROVENANCE.get(rel);

// ── T-29: classification is DECLARED, never directory position alone ──────────────────────────
// Bands: `docs/**` (every *.md is a doc), `extensions/**` and `templates/**` (README.md files are
// docs, every other *.md is an ASSET — extension skills, personas, flow docs). The PROMOTION
// MARKER `<!-- docs-parity: doc -->` makes any *.md a doc wherever it lives, so a doc that lands in
// an asset band REDDENS instead of escaping (T-29's observable); the bands alone never promote.
// `templates/**` joined the discovery set with this row: the template README pair shipped UNPOLICED.
const DOC_MARKER = /<!--\s*docs-parity:\s*doc\s*-->/;
const isDocByBand = (rel) =>
  rel.startsWith("docs/") ||
  rel.split("/").at(-1) === "README.md";
const promotedByMarker = (text) => DOC_MARKER.test(text ?? "");

const readIf = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const switchLinkUnderTitle = (text, twinBase) => {
  const head = text.split("\n").slice(0, 8).join("\n");
  if (!/^#\s+\S/m.test(head)) return false;
  return new RegExp(`\\]\\((?:\\./)?${twinBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`).test(head);
};
const headingTree = (text) => {
  const out = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+\S/.exec(line);
    if (match !== null) out.push(match[1].length);
  }
  return out;
};
const hasCjk = (text) => /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);

// ── T-75: hand-carried DERIVED values must equal the artifact-derived ones ────────────────────
// Wave 1's measured instance: `t39` moved the manual's delta-table pointer `A1–D26 → A1–D38`
// (hash chain 1eac90f4… → 54b6f31e… → 24b4490e…); a LATER §6 rewrite restored the pre-`t39` text,
// and this gate was GREEN on both revisions — the revert was found only by reading the file
// (wave-1 journal row 223 / `L78`). The rules below make that class red again.
//
// DERIVATION SOURCES (which side is trusted, and how each is regenerated):
//   * the delta RANGE (`A1–D<n>`) — derived from the transcription table in
//     `agent-references/agent-teams-deltas.md`, the file the manual NAMES as "the authoritative …
//     adaptation table"; it grows by transcribing `evidence/wave2/adopted-tooling/result.json`
//     (`adaptation_list`) plus each wave's rows, never by copying another pointer.
//   * the region/file COUNTS — derived from `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js`
//     (`MPD_DELTAS`), the registry GENERATED from the live `//#region mpd-delta` markers by
//     `node scripts/patch-agent-teams-fixes.mjs --write-registry`, and CORROBORATED against those
//     markers as a printed READING. The registry is the AUTHORITY (the applier heals from it and
//     `--check` verifies it): a marker that is newer than the registry is a normal in-flight
//     state of an adopted-file edit, so registry-vs-file drift is REPORTED here and owned by the
//     applier's `--check`, never reddened by this gate.
// The artifact wins, never the newer pointer. An ABSENT site file (a packed-artifact root) is a
// reported note; a site whose claim is GONE is a violation, never a silent pass (zero-subject).
const MANUAL_REL = "AGENTS.md";
// The files that HAND-CARRY the delta-range pointer. `AGENTS.md` is the manual; the on-demand
// index repeats the claim in its table row, and it was the SECOND live instance of the class
// (`agent-references/index.md` still read `A1–D26` while the manual read the live `A1–D38` —
// wave-1 `L30`/D-5). A site file that is ABSENT from a root (the packed artifact ships no
// AGENTS.md) is a reported note; a site whose claim is gone is a violation.
const DELTA_RANGE_SITES = ["AGENTS.md", "agent-references/index.md"];
const DELTAS_DOC_REL = "agent-references/agent-teams-deltas.md";
const REGISTRY_REL = "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js";
const DELTA_RANGE_LITERAL = /A1\s*[\u2013\u2014-]\s*D(\d+)/g;
const REGION_COUNT_CLAIM = /The live registry is \*\*(\d+)\*\* regions across \*\*(\d+)\*\* adopted files/;
const normalizeDash = (text) => text.replace(/[\u2013\u2014-]/g, "\u2013");
const idRank = (id) => "ABCD".indexOf(id[0]) * 100000 + Number(id.slice(1));

/** The delta-id span the registry's transcription table covers, e.g. `A1–D38`. */
export function deriveDeltaRange(root) {
  const doc = readIf(join(root, DELTAS_DOC_REL));
  if (doc === null) return { ok: false, reason: `${DELTAS_DOC_REL} is absent — the artifact the pointer NAMES cannot be read` };
  const ids = [];
  for (const match of doc.matchAll(/^\|\s*([A-D]\d+)(?:\s*[\u2013\u2014-]\s*([A-D]\d+))?\s*\|/gm)) {
    ids.push(match[1]);
    if (match[2] !== undefined) ids.push(match[2]);
  }
  if (ids.length === 0) return { ok: false, reason: `no delta-table rows parsed from ${DELTAS_DOC_REL} (zero-subject: refusing to derive nothing)` };
  ids.sort((a, b) => idRank(a) - idRank(b));
  return { ok: true, first: ids[0], last: ids[ids.length - 1], text: normalizeDash(`${ids[0]}\u2013${ids[ids.length - 1]}`), ids: ids.length };
}

/**
 * T-57: every region id ONE FILE carries, pairing each begin with ITS OWN end (a STACK), so a
 * region NESTED inside another region's span counts as its OWN region. The earlier walk took the
 * FIRST matching end marker as a region's end and skipped the whole span, so a file carrying three
 * markers counted as two and this corroboration printed a FALSE agreement while a real nested
 * region existed (t44-F1: the registry held 119 ids while this helper reported agreement).
 * A mismatched end, an orphan end, an unclosed begin or a duplicate in-file id is REPORTED, never
 * silently counted around.
 */
function liveRegionIds(rel, fileText) {
  const lines = fileText.split("\n");
  const ids = [];
  const stack = [];
  const problems = [];
  for (let at = 0; at < lines.length; at += 1) {
    const begin = /^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[at]);
    if (begin !== null) {
      ids.push(begin[1]);
      stack.push({ id: begin[1], line: at + 1 });
      continue;
    }
    const end = /^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)\s*$/.exec(lines[at]);
    if (end === null) continue;
    if (stack.length === 0) {
      problems.push(`${rel}:${at + 1} closes ${end[1]} with no open region`);
      continue;
    }
    const open = stack.pop();
    if (open.id !== end[1]) problems.push(`${rel}:${at + 1} closes ${end[1]} while ${open.id} (opened at :${open.line}) is still open`);
  }
  for (const open of stack) problems.push(`${rel}:${open.line} opens ${open.id} with no matching end marker`);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) problems.push(`${rel} carries duplicate region id(s): ${duplicates.join(", ")}`);
  return { ids, problems };
}

/** The generated registry's region/file ids, corroborated PER FILE (ids, not just counts). */
function deriveRegistryCounts(root) {
  const registry = readIf(join(root, REGISTRY_REL));
  if (registry === null) return { ok: false, reason: `${REGISTRY_REL} is absent — regenerate with: node scripts/patch-agent-teams-fixes.mjs --write-registry` };
  const entries = [...registry.matchAll(/^ {8}file: "([^"]+)",$/gm)].map((match) => match[1]);
  const registryIds = [...registry.matchAll(/^ {8}id: "([^"]+)",$/gm)].map((match) => match[1]);
  if (entries.length === 0 || registryIds.length !== entries.length) {
    return { ok: false, reason: `no MPD_DELTAS entries parsed from ${REGISTRY_REL} (zero-subject: refusing to derive nothing)` };
  }
  const files = [...new Set(entries)];
  const perFile = [];
  for (const file of files) {
    const text = readIf(join(root, file));
    if (text === null) return { ok: false, reason: `${file} is named by the registry but absent from this root — registry and tree cannot be corroborated` };
    const { ids: liveIds, problems } = liveRegionIds(file, text);
    if (problems.length > 0) return { ok: false, reason: `${file} cannot be corroborated: ${problems.join("; ")}` };
    const registeredIds = registryIds.filter((id, index) => entries[index] === file);
    const onlyInRegistry = registeredIds.filter((id) => !liveIds.includes(id));
    const onlyOnTree = liveIds.filter((id) => !registeredIds.includes(id));
    perFile.push({ file, registered: registeredIds.length, markers: liveIds.length, registeredIds, liveIds, onlyInRegistry, onlyOnTree });
  }
  return {
    ok: true,
    regions: entries.length,
    files: files.length,
    markers: perFile.reduce((total, item) => total + item.markers, 0),
    mismatched: perFile.filter((item) => item.onlyInRegistry.length > 0 || item.onlyOnTree.length > 0),
    perFile,
  };
}

/** Compare every HAND-CARRIED derived value against the artifact-derived one. */
function checkDerivedValues(root) {
  const violations = [];
  const notes = [];
  const range = deriveDeltaRange(root);
  for (const site of DELTA_RANGE_SITES) {
    const text = readIf(join(root, site));
    if (text === null) {
      notes.push({ path: site, reason: "site file not present in this root (packed artifact / partial copy) — delta-range claims skipped" });
      continue;
    }
    const carried = [...text.matchAll(DELTA_RANGE_LITERAL)];
    if (!range.ok) {
      violations.push({ id: `derived-value:delta-range:${site}`, detail: `cannot adjudicate the delta-range claim(s) in ${site}: ${range.reason}` });
      continue;
    }
    if (carried.length === 0) {
      violations.push({ id: `derived-value:delta-range:${site}:missing-claim`, detail: `${site} carries NO "A1–D<n>" registry pointer while ${DELTAS_DOC_REL} derives "${range.text}" (zero-subject run: refusing to report PASS with nothing compared). If the pointer was deliberately removed, update this rule in the same change.` });
      continue;
    }
    for (const match of carried) {
      const line = text.slice(0, match.index).split("\n").length;
      const value = normalizeDash(match[0].replace(/\s+/g, ""));
      if (value === range.text) continue;
      violations.push({ id: `derived-value:delta-range:${site}:${line}`, detail: `${site}:${line} carries "${value}" but the ARTIFACT derives "${range.text}" (${range.ids} table ids in ${DELTAS_DOC_REL}, first ${range.first}, last ${range.last}) — the artifact wins, never the newer pointer (wave-1 L78); regenerate the range by transcribing the table` });
    }
    notes.push({ path: site, reason: `${carried.length} delta-range claim(s) ${[...new Set(carried.map((m) => normalizeDash(m[0].replace(/\s+/g, ""))))].join(", ")} checked against "${range.text}" derived from ${DELTAS_DOC_REL}` });
  }
  const doc = readIf(join(root, DELTAS_DOC_REL));
  if (doc === null) {
    notes.push({ path: DELTAS_DOC_REL, reason: "site file not present in this root — region-count claim skipped" });
  } else {
    const claim = REGION_COUNT_CLAIM.exec(doc);
    const counts = deriveRegistryCounts(root);
    if (!counts.ok) {
      violations.push({ id: `derived-value:region-count:${DELTAS_DOC_REL}`, detail: `cannot adjudicate the region-count claim in ${DELTAS_DOC_REL}: ${counts.reason}` });
    } else if (claim === null) {
      violations.push({ id: `derived-value:region-count:${DELTAS_DOC_REL}:missing-claim`, detail: `${DELTAS_DOC_REL} no longer states "The live registry is **N** regions across **M** adopted files" while ${REGISTRY_REL} derives ${counts.regions} regions across ${counts.files} files (zero-subject run: refusing to report PASS with nothing compared). If the sentence was deliberately reworded, update this rule in the same change.` });
    } else {
      const line = doc.slice(0, claim.index).split("\n").length;
      if (Number(claim[1]) !== counts.regions || Number(claim[2]) !== counts.files) {
        violations.push({ id: `derived-value:region-count:${DELTAS_DOC_REL}:${line}`, detail: `${DELTAS_DOC_REL}:${line} claims **${claim[1]}** regions across **${claim[2]}** adopted files but ${REGISTRY_REL} derives ${counts.regions} regions across ${counts.files} files — the registry is the AUTHORITY (it is what the applier heals from; regenerate it with: node scripts/patch-agent-teams-fixes.mjs --write-registry), so UPDATE THIS SENTENCE to the derived pair in the same change that moves the registry` });
      }
      // T-57: the corroboration is printed PER FILE with the ids it counted, so a region nested
      // inside another span surfaces as a NAMED mismatch instead of a bare "markers agree".
      const perFileReading = counts.perFile
        .map((item) => `${item.file}: registry ${item.registered} id(s), live ${item.markers} id(s)` + (item.onlyInRegistry.length > 0 || item.onlyOnTree.length > 0
          ? ` — MISMATCH (registered but not on the tree: [${item.onlyInRegistry.join(", ")}]; on the tree but unregistered: [${item.onlyOnTree.join(", ")}])`
          : " — agree"))
        .join("; ");
      notes.push({ path: DELTAS_DOC_REL, reason: `region-count claim checked: carried **${claim[1]}**/${claim[2]} vs derived ${counts.regions}/${counts.files} from ${REGISTRY_REL}; PER FILE (nesting-aware: every begin paired with its OWN end, T-57): ${perFileReading}` + (counts.mismatched.length === 0
        ? ""
        : ` — the mismatch is the applier's \`--check\` territory, not this gate's: an in-flight region edit is expected to be unregistered until --write-registry runs`) });
    }
  }
  return { violations, notes };
}

/** Every FILE under `<root>/<dir>`, recursively (symlinks and dot/node_modules dirs skipped). */
function walkFiles(root, dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function discoverPairs(root) {
  const pairs = [];
  const exemptNotes = [];
  const violations = [];
  const inverse = [];
  const push = (en, zh) => pairs.push({ en, zh });

  if (existsSync(join(root, "README.md"))) push("README.md", "README.zh-CN.md");
  if (existsSync(join(root, "README.zh-CN.md"))) inverse.push("README.zh-CN.md");

  // docs/**: every *.md is documentation, at any depth.
  for (const rel of walkFiles(root, "docs")) {
    if (!rel.endsWith(".md")) continue;
    if (rel.endsWith(".zh-CN.md")) {
      inverse.push(rel);
      continue;
    }
    const text = readIf(join(root, rel));
    const twin = rel.replace(/\.md$/, ".zh-CN.md");
    if (!existsSync(join(root, twin)) && isExemptLone(rel, text)) {
      exemptNotes.push({ path: rel, reason: exemptReason(rel, text) });
      continue;
    }
    push(rel, twin);
  }

  // The declared bands: README.md files are docs, every other *.md is an ASSET (extension skills,
  // personas, flow docs) — UNLESS the file carries the promotion marker, which makes it a doc
  // wherever it lives (T-29: a misplaced doc reddens instead of escaping).
  for (const band of ["extensions", "templates"]) {
    for (const rel of walkFiles(root, band)) {
      if (!rel.endsWith(".md")) continue;
      if (rel.endsWith(".zh-CN.md")) {
        inverse.push(rel);
        continue;
      }
      const text = readIf(join(root, rel));
      if (!isDocByBand(rel) && !promotedByMarker(text)) continue;
      const twin = rel.replace(/\.md$/, ".zh-CN.md");
      if (!existsSync(join(root, twin)) && isExemptLone(rel, text)) {
        exemptNotes.push({ path: rel, reason: exemptReason(rel, text) });
        continue;
      }
      push(rel, twin);
    }
  }

  const pkgs = join(root, "packages");
  if (existsSync(pkgs)) {
    for (const entry of readdirSync(pkgs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const rel = `packages/${entry.name}/README.md`;
      if (!existsSync(join(root, rel))) {
        if (EXEMPT_WITHOUT_README.has(`packages/${entry.name}`)) {
          exemptNotes.push({ path: `packages/${entry.name}`, reason: EXEMPT_WITHOUT_README.get(`packages/${entry.name}`) });
          continue;
        }
        // An undocumented package is a FAILURE, not a note: silence here is the class this gate closes.
        violations.push({ id: `package-no-readme:packages/${entry.name}`, detail: `package directory ${entry.name} has no README (not an exempt package)` });
        continue;
      }
      const text = readIf(join(root, rel));
      if (!existsSync(join(root, `packages/${entry.name}/README.zh-CN.md`)) && isExemptLone(rel, text)) {
        exemptNotes.push({ path: rel, reason: exemptReason(rel, text) });
        continue;
      }
      push(rel, `packages/${entry.name}/README.zh-CN.md`);
      if (existsSync(join(root, `packages/${entry.name}/README.zh-CN.md`))) inverse.push(`packages/${entry.name}/README.zh-CN.md`);
    }
  }

  // The INVERSE scan: a zh-CN document whose EN twin does not exist.
  for (const zh of inverse) {
    const en = zh.replace(/\.zh-CN\.md$/, ".md");
    if (existsSync(join(root, en))) continue;
    const enText = readIf(join(root, en));
    if (isExemptLone(en, enText)) {
      exemptNotes.push({ path: en, reason: `${exemptReason(en, enText)} — its zh file exists, but an exempt record requires no EN twin` });
      continue;
    }
    violations.push({ id: `inverse:${zh}`, detail: `zh-CN file has no EN twin (${en} is missing)` });
  }

  // The ANTICIPATORY class is reported on its own: an exemption for a file that does not exist yet
  // can rot silently, so it is printed (and never counted as a live path).
  for (const [rel, reason] of ANTICIPATORY_EXEMPTIONS) {
    if (existsSync(join(root, rel))) continue;
    exemptNotes.push({ path: rel, reason: `${reason} [ANTICIPATORY — not a live path]` });
  }

  return { pairs, exemptNotes, violations };
}

export function verifyDocsParity(root) {
  const { pairs, exemptNotes, violations } = discoverPairs(root);
  // T-75: the derived-value rules run AFTER discovery, so a mismatch lands in the SAME
  // `violations` surface the pair checks use (one red gate, one report).
  const derived = checkDerivedValues(root);
  for (const violation of derived.violations) violations.push(violation);
  const checks = [];
  const add = (pair, id, ok, detail) => checks.push({ pair, id, ok: Boolean(ok), detail: String(detail) });
  const summaries = [];
  for (const { en, zh } of pairs) {
    const enText = readIf(join(root, en));
    const zhText = readIf(join(root, zh));
    const failed = [];
    if (enText === null) failed.push("missing EN file");
    if (zhText === null) failed.push("missing zh-CN file");
    if (enText !== null && zhText !== null) {
      const zhBase = zh.split("/").at(-1);
      const enBase = en.split("/").at(-1);
      if (!switchLinkUnderTitle(enText, zhBase)) failed.push("EN switch link missing/not under the title");
      if (!switchLinkUnderTitle(zhText, enBase)) failed.push("zh-CN switch link missing/not under the title");
      const a = headingTree(enText);
      const b = headingTree(zhText);
      if (a.length !== b.length || a.some((level, index) => level !== b[index]))
        failed.push(`heading tree differs: EN [${a.join(",")}] vs zh [${b.join(",")}]`);
      if (!hasCjk(zhText)) failed.push("zh-CN file carries no CJK content (copy-paste of the EN file?)");
    }
    add(en, `pair:${en}`, failed.length === 0, failed.length === 0 ? "ok" : failed.join("; "));
    summaries.push({ pair: en, ok: failed.length === 0, problems: failed });
  }
  for (const violation of violations) add(violation.id, violation.id, false, violation.detail);
  return {
    pairs: summaries,
    violations,
    checks,
    exemptNotes,
    derivedNotes: derived.notes,
    ok: summaries.every((s) => s.ok) && violations.length === 0,
  };
}

function printReport(result, root) {
  for (const summary of result.pairs)
    console.log(`${summary.ok ? "ok  " : "FAIL"} ${summary.pair}${summary.ok ? "" : " — " + summary.problems.join("; ")}`);
  for (const violation of result.violations) console.log(`FAIL ${violation.id} — ${violation.detail}`);
  for (const note of result.exemptNotes) console.log(`skip ${note.path} — EXEMPT: ${note.reason}`);
  for (const note of result.derivedNotes ?? []) console.log(`note ${note.path} — DERIVED: ${note.reason}`);
  const pairs = result.pairs.length;
  const failed = result.pairs.filter((s) => !s.ok).length + result.violations.length;
  console.log(
    `\n[verify-docs-parity] root=${root} pairs=${pairs} failed=${failed} violations=${result.violations.length} exempt=${result.exemptNotes.length} derived=${(result.derivedNotes ?? []).length} — ${result.ok ? "PASS" : "FAIL"}`,
  );
}

function selfTest() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-docs-parity-selftest-"));
  const cases = [];
  const write = (rel, text) => {
    const abs = join(sandbox, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const good = (title, marker) =>
    `# ${title}\n\n**English** | [中文](./X.zh-CN.md)\n\n${marker}\n\n## One\n\ntext\n\n### Deep\n\nmore\n\n## Two\n\nend\n`;
  const zhGood = (title) => `# ${title}\n\n[English](./X.md)\n\n正文\n\n## 一\n\n文本\n\n### 深\n\n更多\n\n## 二\n\n结束\n`;
  try {
    // 1. a clean fixture tree passes, including nested pairs and one non-doc asset.
    write("README.md", good("Root", "Hello").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("README.zh-CN.md", zhGood("根").replace("./X.md", "./README.md"));
    write("docs/guide.md", good("Guide", "Body").replace("./X.zh-CN.md", "./guide.zh-CN.md"));
    write("docs/guide.zh-CN.md", zhGood("指南").replace("./X.md", "./guide.md"));
    write("docs/guides/nested.md", good("Nested", "Body").replace("./X.zh-CN.md", "./nested.zh-CN.md"));
    write("docs/guides/nested.zh-CN.md", zhGood("嵌套").replace("./X.md", "./nested.md"));
    write("extensions/README.md", good("Ext", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("extensions/README.zh-CN.md", zhGood("扩展").replace("./X.md", "./README.md"));
    write("extensions/deep/README.md", good("DeepExt", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("extensions/deep/README.zh-CN.md", zhGood("深层扩展").replace("./X.md", "./README.md"));
    write("extensions/deep/skills/thing/SKILL.md", "# thing\n\nan asset, not a doc\n");
    write("packages/alpha/README.md", good("Alpha", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("packages/alpha/README.zh-CN.md", zhGood("甲").replace("./X.md", "./README.md"));
    // T-30 fixtures: the process records carry their OWN marker; the two ANTICIPATORY paths are
    // deliberately NOT created, because their exemption is for files that do not exist yet.
    write("docs/decisions.md", "<!-- docs-parity: exempt process record (AGENTS.md §3) -->\n# Decisions\n\nno twin needed\n");
    for (const rel of [
      "docs/plan-c.md", "docs/plan-d.md", "docs/plan-e.md", "docs/plan-f.md", "docs/plan-tui-edition.md",
    ])
      write(rel, `# ${rel}\n\nprocess record, no twin by policy (covered by the DECLARED plan-*.md pattern)\n`);
    for (const rel of [
      "docs/bline-report.md", "docs/omo-parity-gap.md", "docs/review-p0-p3.md", "docs/track-a-report.md",
      "docs/ulw-deepseek-optimization.md", "docs/tui-edition-report.md",
    ])
      write(rel, `<!-- docs-parity: exempt prior-phase report (AGENTS.md §3) -->\n# ${rel}\n\nprocess record, no twin by policy (IN-FILE marker)\n`);
    // T-29 fixtures: a POLICED template pair, a promoted misplaced doc, and an unmarked asset.
    write("templates/tpl/README.md", good("Tpl", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("templates/tpl/README.zh-CN.md", zhGood("模板").replace("./X.md", "./README.md"));
    write("templates/tpl/notes/asset.md", "# Asset\n\nan asset, no twin demanded\n");
    write("packages/mpd-mcp-shared/src/index.ts", "export {}\n");
    write("packages/mpd-agent-teams-plugin/README.md", "# upstream verbatim\n");
    const clean = verifyDocsParity(sandbox);
    cases.push({ case: "clean tree passes", ok: clean.ok, detail: `pairs=${clean.pairs.length} exempt=${clean.exemptNotes.length} violations=${clean.violations.length}` });

    // 1a. the RECURSIVE walk finds nested docs/ pairs and nested extensions/README pairs.
    const recursive = ["docs/guides/nested.md", "extensions/deep/README.md"].filter((rel) => clean.pairs.some((p) => p.pair === rel));
    cases.push({
      case: "recursive discovery: nested docs/ and extensions/ pairs are checked (nesting cannot hide a pair)",
      ok: recursive.length === 2,
      detail: `found: ${recursive.join(", ") || "(none)"}`,
    });
    // 1b. a non-README .md under extensions/ is an ASSET: no twin is demanded, so it is not a failure.
    cases.push({
      case: "an extensions ASSET (.md that is not a README) is not demanded a twin",
      ok: clean.ok && !clean.pairs.some((p) => p.pair === "extensions/deep/skills/thing/SKILL.md"),
      detail: "extensions/deep/skills/thing/SKILL.md left out of the pair set",
    });

    const expectedExempt = [
      ...["docs/plan-c.md", "docs/plan-d.md", "docs/plan-e.md", "docs/plan-f.md", "docs/plan-tui-edition.md",
        "docs/bline-report.md", "docs/omo-parity-gap.md", "docs/review-p0-p3.md", "docs/track-a-report.md",
        "docs/ulw-deepseek-optimization.md", "docs/adder4.md", "docs/cnt8.md", "docs/tui-edition-report.md",
        "docs/decisions.md", "packages/mpd-agent-teams-plugin/README.md", "packages/mpd-mcp-shared"],
    ];
    const missingExempt = expectedExempt.filter((rel) => !clean.exemptNotes.some((n) => n.path === rel));
    cases.push({
      case: "EVERY documented exemption is asserted (reported with its reason, never a silent skip)",
      ok: missingExempt.length === 0,
      detail: missingExempt.length === 0 ? `${expectedExempt.length} exemption paths reported` : `missing: ${missingExempt.join(", ")}`,
    });

    // ── T-30 arms: the exemption is derived from the FILE ─────────────────────────────────────
    write("docs/from-1999.md", "<!-- docs-parity: exempt historical note (AGENTS.md §3) -->\n# From 1999\n\nold\n");
    const marked = verifyDocsParity(sandbox);
    cases.push({
      case: "T-30: a doc carrying the IN-FILE marker is exempt WITHOUT editing the gate",
      ok: marked.ok && marked.exemptNotes.some((n) => n.path === "docs/from-1999.md"),
      detail: JSON.stringify(marked.exemptNotes.find((n) => n.path === "docs/from-1999.md") ?? null),
    });
    write("docs/from-1999.md", "# From 1999\n\nold, and now WITHOUT the marker\n");
    const unmarked = verifyDocsParity(sandbox);
    cases.push({
      case: "T-30 NEGATIVE: the SAME doc without the marker is a VIOLATION",
      ok: unmarked.ok === false && unmarked.pairs.some((p) => p.pair === "docs/from-1999.md" && !p.ok),
      detail: JSON.stringify(unmarked.pairs.find((p) => p.pair === "docs/from-1999.md") ?? null),
    });
    rmSync(join(sandbox, "docs/from-1999.md"), { force: true });
    const anticipatory = clean.exemptNotes.filter((n) => n.path === "docs/adder4.md" || n.path === "docs/cnt8.md");
    cases.push({
      case: "T-30: the TWO ANTICIPATORY paths are reported as their OWN class (never silently dropped)",
      ok: anticipatory.length === 2 && anticipatory.every((n) => n.reason.includes("ANTICIPATORY")),
      detail: JSON.stringify(anticipatory),
    });

    // ── T-29 arms: classification is DECLARED, and a misplaced doc reddens ────────────────────
    cases.push({
      case: "T-29: templates/**/README.md pairs enter the discovery set as POLICED pairs",
      ok: clean.ok && clean.pairs.some((p) => p.pair === "templates/tpl/README.md"),
      detail: `pairs=${clean.pairs.length}, template pair present=${clean.pairs.some((p) => p.pair === "templates/tpl/README.md")}`,
    });
    cases.push({
      case: "T-29 NEG CONTROL: an UNMARKED non-README *.md under templates/ stays an ASSET",
      ok: clean.ok && !clean.pairs.some((p) => p.pair === "templates/tpl/notes/asset.md"),
      detail: "templates/tpl/notes/asset.md left out of the pair set",
    });
    write("templates/tpl/notes/promoted.md", "<!-- docs-parity: doc -->\n# Promoted\n\na doc that landed in an ASSET band\n");
    const promoted = verifyDocsParity(sandbox);
    cases.push({
      case: "T-29 NEGATIVE: a misplaced doc carrying the PROMOTION marker REDDENS instead of escaping",
      ok: promoted.ok === false && promoted.pairs.some((p) => p.pair === "templates/tpl/notes/promoted.md" && !p.ok),
      detail: JSON.stringify(promoted.pairs.find((p) => p.pair === "templates/tpl/notes/promoted.md") ?? null),
    });
    rmSync(join(sandbox, "templates/tpl/notes/promoted.md"), { force: true });

    // 2. NEGATIVE CONTROLS — each mutant must fail the gate.
    const mutants = [
      ["negative: missing switch link", "docs/guide.md", (t) => t.replace("[中文](./guide.zh-CN.md)", "no link here")],
      ["negative: re-levelled heading", "docs/guide.zh-CN.md", (t) => t.replace("## 二", "# 二")],
      ["negative: pure-ASCII zh file", "README.zh-CN.md", () => "# Root\n\n[English](./README.md)\n\nHello there\n\n## One\n\ntext\n\n### Deep\n\nmore\n\n## Two\n\nend\n"],
      ["negative: nested pair with a mis-pointed switch link", "docs/guides/nested.md", (t) => t.replace("[中文](./nested.zh-CN.md)", "no link here")],
    ];
    for (const [name, rel, mutate] of mutants) {
      const original = readFileSync(join(sandbox, rel), "utf8");
      writeFileSync(join(sandbox, rel), mutate(original));
      const result = verifyDocsParity(sandbox);
      cases.push({ case: name, ok: result.ok === false, detail: result.ok ? "gate still passed (WRONG)" : result.pairs.filter((p) => !p.ok).map((p) => `${p.pair}: ${p.problems.join("; ")}`).join(" | ") });
      writeFileSync(join(sandbox, rel), original);
    }

    // 3. an exempt file that GAINS a zh twin is checked like any other pair.
    write("docs/decisions.zh-CN.md", "# 决定\n\n[English](./decisions.md)\n\n正文\n\n## 一\n\ntext\n");
    const twins = verifyDocsParity(sandbox);
    cases.push({
      case: "exempt file gaining a zh twin is checked (its missing heading parity fails)",
      ok: twins.pairs.some((p) => p.pair === "docs/decisions.md" && !p.ok),
      detail: JSON.stringify(twins.pairs.find((p) => p.pair === "docs/decisions.md") ?? null),
    });
    const withGoodTwin = `# 决定\n\n[English](./decisions.md)\n\n正文\n\n## 二\n\ntext\n`;
    write("docs/decisions.md", `# Decisions\n\n**English** | [中文](./decisions.zh-CN.md)\n\nBody\n\n## Two\n\ntext\n`);
    write("docs/decisions.zh-CN.md", withGoodTwin);
    const twins2 = verifyDocsParity(sandbox);
    cases.push({ case: "exempt file with a CONFORMANT twin passes", ok: twins2.pairs.some((p) => p.pair === "docs/decisions.md" && p.ok) });

    // 4. the INVERSE scan: a zh-CN document with no EN twin is a violation.
    write("docs/orphan.zh-CN.md", "# 孤儿\n\n正文\n");
    const inverseBad = verifyDocsParity(sandbox);
    cases.push({
      case: "negative: a zh-CN file with no EN twin is a VIOLATION (inverse scan)",
      ok: inverseBad.ok === false && inverseBad.violations.some((v) => v.id === "inverse:docs/orphan.zh-CN.md"),
      detail: JSON.stringify(inverseBad.violations),
    });
    // ...and the same path is a reported EXEMPTION when the missing EN twin is an exempt record.
    write("docs/plan-orphan.zh-CN.md", "# 计划\n\n正文\n");
    const inverseExempt = verifyDocsParity(sandbox);
    cases.push({
      case: "an inverse orphan whose EN path is an exempt record is reported as an exemption, not a violation",
      ok: inverseExempt.violations.every((v) => v.id !== "inverse:docs/plan-orphan.zh-CN.md") && inverseExempt.exemptNotes.some((n) => n.path === "docs/plan-orphan.md"),
      detail: JSON.stringify(inverseExempt.exemptNotes.filter((n) => n.path === "docs/plan-orphan.md")),
    });

    // 5. a NON-exempt package without a README is a FAILURE; the exempt package stays a note.
    write("packages/silent/src/index.ts", "export {}\n");
    const silent = verifyDocsParity(sandbox);
    cases.push({
      case: "negative: a non-exempt package directory without a README is a FAILURE",
      ok: silent.ok === false && silent.violations.some((v) => v.id === "package-no-readme:packages/silent"),
      detail: JSON.stringify(silent.violations),
    });
    cases.push({
      case: "the exempt package (mpd-mcp-shared) is a reported note, not a violation",
      ok: silent.violations.every((v) => !v.id.includes("mpd-mcp-shared")) && silent.exemptNotes.some((n) => n.path === "packages/mpd-mcp-shared"),
      detail: "packages/mpd-mcp-shared stays on the exemption list",
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  cases.push(...selfTestDerivedValues());
  for (const item of cases) console.log(`${item.ok ? "ok  " : "FAIL"} ${item.case}${item.detail ? " — " + item.detail : ""}`);
  const ok = cases.every((c) => c.ok);
  console.log(`\n[verify-docs-parity self-test] ${cases.filter((c) => c.ok).length}/${cases.length} checks passed — ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

/**
 * T-75 arms: the POSITIVE arm (correct carried values pass and are reported) and the NEGATIVE
 * CONTROLS (the pre-`t39` pointer `A1–D26` and a stale region count each redden and NAME the
 * file/value), plus the zero-subject guard, the registry-vs-markers drift arm and the
 * absent-site (packed artifact) bound.
 */
function selfTestDerivedValues() {
  const cases = [];
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-derived-values-selftest-"));
  const write = (root, rel, text) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const markers = (count) =>
    Array.from(
      { length: count },
      (_, index) =>
        `//#region mpd-delta fixture-${index} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const fixture${index} = ${index};\n//#endregion mpd-delta fixture-${index}`,
    ).join("\n\n") + "\n";
  const registryText = (files) =>
    `export const MPD_DELTAS = [\n${files
      .map(
        (file, index) =>
          `    {\n        file: "${file}",\n        id: "mpd-delta fixture-${index}",\n        beforeContext: [],\n        afterContext: [],\n        block: "",\n    },`,
      )
      .join("\n")}\n];\n`;
  const deltasDoc = (regions, files) =>
    `# Adopted agent-teams delta registry\n\n| Id | File | Marker | Purpose |\n|---|---|---|---|\n| A1 | \`adopted/a.js\` | none | first |\n| D2 | \`adopted/a.js\` | \`mpd-delta fixture-0\` | second |\n| D7 | \`adopted/b.js\` | \`mpd-delta fixture-2\` | third |\n\nThe live registry is **${regions}** regions across **${files}** adopted files — the count MEASURED at this edit.\n`;
  const packageReadme = (root) => {
    write(root, "packages/mpd-agent-teams-plugin/README.md", "# Fixture\n\n**English** | [中文](./README.zh-CN.md)\n\nBody\n\n## One\n\ntext\n");
    write(root, "packages/mpd-agent-teams-plugin/README.zh-CN.md", "# 夹具\n\n[English](./README.md)\n\n正文\n\n## 一\n\n文本\n");
  };
  const indexDoc = (range) =>
    `# agent-references — on-demand reference material\n\n| File | Holds |\n|---|---|\n| \`agent-teams-deltas.md\` | the adopted agent-teams delta registry — the ${range} table, registry mechanics |\n`;
  const seed = (root) => {
    rmSync(root, { recursive: true, force: true });
    write(root, "adopted/a.js", markers(2));
    write(root, "adopted/b.js", markers(1));
    write(root, REGISTRY_REL, registryText(["adopted/a.js", "adopted/a.js", "adopted/b.js"]));
    write(root, DELTAS_DOC_REL, deltasDoc(3, 2));
    write(root, MANUAL_REL, "# Manual\n\nPointer: the authoritative A1–D7 adaptation table.\n");
    write(root, "agent-references/index.md", indexDoc("A1–D7"));
    packageReadme(root);
  };
  try {
    const tree = join(sandbox, "tree");
    seed(tree);
    const good = verifyDocsParity(tree);
    cases.push({
      case: "T-75 arm 1 (positive): the artifact-derived range and counts PASS and are REPORTED",
      ok:
        good.ok === true &&
        good.derivedNotes.length === 3 &&
        good.derivedNotes.some((note) => note.path === MANUAL_REL && note.reason.includes("A1\u2013D7")) &&
        good.derivedNotes.some((note) => note.path === "agent-references/index.md" && note.reason.includes("A1\u2013D7")) &&
        good.derivedNotes.some((note) => note.path === DELTAS_DOC_REL && note.reason.includes("3/2")),
      detail: JSON.stringify(good.derivedNotes),
    });

    write(tree, MANUAL_REL, "# Manual\n\nPointer: the authoritative A1–D26 adaptation table.\n");
    const stalePointer = verifyDocsParity(tree);
    const pointerFinding = stalePointer.violations.find((v) => v.id.startsWith(`derived-value:delta-range:${MANUAL_REL}:`));
    cases.push({
      case: "T-75 arm 2 (NEGATIVE CONTROL): the pre-t39 pointer A1–D26 REDDENS and NAMES the file/value",
      ok:
        stalePointer.ok === false &&
        pointerFinding !== undefined &&
        pointerFinding.id === `derived-value:delta-range:${MANUAL_REL}:3` &&
        pointerFinding.detail.includes("A1\u2013D26") &&
        pointerFinding.detail.includes("A1\u2013D7"),
      detail: pointerFinding === undefined ? JSON.stringify(stalePointer.violations) : `${pointerFinding.id} — ${pointerFinding.detail}`,
    });

    seed(tree);
    write(tree, "agent-references/index.md", indexDoc("A1–D26"));
    const staleIndex = verifyDocsParity(tree);
    const indexFinding = staleIndex.violations.find((v) => v.id.startsWith("derived-value:delta-range:agent-references/index.md:"));
    cases.push({
      case: "T-75 arm 2b (NEGATIVE CONTROL, SECOND instance): the stale index pointer A1–D26 REDDENS and NAMES agent-references/index.md:5",
      ok:
        staleIndex.ok === false &&
        indexFinding !== undefined &&
        indexFinding.id === "derived-value:delta-range:agent-references/index.md:5" &&
        indexFinding.detail.includes("A1\u2013D26") &&
        indexFinding.detail.includes("A1\u2013D7"),
      detail: indexFinding === undefined ? JSON.stringify(staleIndex.violations) : `${indexFinding.id} — ${indexFinding.detail}`,
    });

    seed(tree);
    write(tree, DELTAS_DOC_REL, deltasDoc(65, 9));
    const staleCount = verifyDocsParity(tree);
    const countFinding = staleCount.violations.find((v) => v.id.startsWith(`derived-value:region-count:${DELTAS_DOC_REL}:`));
    cases.push({
      case: "T-75 arm 3 (NEGATIVE CONTROL): a stale region count REDDENS and NAMES the deltas doc",
      ok: staleCount.ok === false && countFinding !== undefined && countFinding.detail.includes("**65**") && countFinding.detail.includes("3 regions across 2 files"),
      detail: countFinding === undefined ? JSON.stringify(staleCount.violations) : `${countFinding.id} — ${countFinding.detail}`,
    });

    seed(tree);
    write(tree, MANUAL_REL, "# Manual\n\nno derived claim here\n");
    const noClaim = verifyDocsParity(tree);
    cases.push({
      case: "T-75 zero-subject guard: a site whose claim is GONE is a VIOLATION, not a silent pass",
      ok: noClaim.ok === false && noClaim.violations.some((v) => v.id === `derived-value:delta-range:${MANUAL_REL}:missing-claim`),
      detail: JSON.stringify(noClaim.violations),
    });

    seed(tree);
    write(tree, "adopted/b.js", markers(2));
    const drift = verifyDocsParity(tree);
    cases.push({
      case: "T-75 bound: registry-vs-LIVE-marker drift is REPORTED (note, naming the file AND the ids), never a violation — the applier's --check owns it",
      ok: drift.ok === true && drift.derivedNotes.some((note) => note.reason.includes("adopted/b.js") && note.reason.includes("registry 1 id(s), live 2 id(s)") && note.reason.includes("MISMATCH")),
      detail: JSON.stringify(drift.derivedNotes),
    });
    // T-57 arm: a region NESTED inside another region's span is its OWN region, and an unregistered
    // child surfaces as a NAMED mismatch instead of the old false "markers agree".
    seed(tree);
    write(tree, "adopted/a.js", "//#region mpd-delta fixture-0 (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const outer = 0;\n//#region mpd-delta fixture-extra (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const child = 1;\n//#endregion mpd-delta fixture-extra\n//#endregion mpd-delta fixture-0\n//#region mpd-delta fixture-1 (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const sibling = 2;\n//#endregion mpd-delta fixture-1\n");
    const nested = verifyDocsParity(tree);
    cases.push({
      case: "T-57: a region NESTED inside another span counts as its OWN region and surfaces as a NAMED mismatch (the old walk counted 2, this counts 3)",
      ok: nested.ok === true && nested.derivedNotes.some((note) => note.reason.includes("adopted/a.js") && note.reason.includes("registry 2 id(s), live 3 id(s)") && note.reason.includes("MISMATCH") && note.reason.includes("mpd-delta fixture-extra")),
      detail: JSON.stringify(nested.derivedNotes),
    });
    seed(tree);

    const packed = join(sandbox, "packed");
    write(packed, DELTAS_DOC_REL, deltasDoc(3, 2));
    write(packed, REGISTRY_REL, registryText(["adopted/a.js", "adopted/a.js", "adopted/b.js"]));
    write(packed, "adopted/a.js", markers(2));
    write(packed, "adopted/b.js", markers(1));
    write(packed, "agent-references/index.md", indexDoc("A1–D7"));
    packageReadme(packed);
    const packedResult = verifyDocsParity(packed);
    cases.push({
      case: "T-75 bound: an ABSENT site file (packed artifact, no AGENTS.md) is a NOTE while the PRESENT index site is still checked",
      ok:
        packedResult.ok === true &&
        packedResult.derivedNotes.some((note) => note.path === MANUAL_REL && note.reason.includes("not present")) &&
        packedResult.derivedNotes.some((note) => note.path === "agent-references/index.md" && note.reason.includes("checked against")),
      detail: JSON.stringify(packedResult.derivedNotes),
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  return cases;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) selfTest();
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex === -1 ? join(HERE, "..") : argv[rootIndex + 1];
  const jsonIndex = argv.indexOf("--json");
  const jsonPath = jsonIndex === -1 ? null : argv[jsonIndex + 1];
  const result = verifyDocsParity(root);
  if (jsonPath !== null) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), root, ...result }, null, 2) + "\n");
  }
  printReport(result, root);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
