# t12 — independent verification of the t9 documentation deliverables

Verifier: Lead (worker seat; verification task, evidence-only writes).
Task: `t12` — independent verification of the two adaptation docs, the README/hub links and the
report's status section. Attempt 1, attempt_id `01fb25ee-215c-4359-abed-df6d84cfe9ea`.
Evidence root: `evidence/extensions/verify-docs/20260916T063433Z/` (the only path this task writes).

## Verdict

`status=failed` — acceptance criterion 2 (citation re-run **plus hand sampling**) is NOT satisfied:
**7 hand-checked line anchors do not carry the symbol they are cited for** (4 of them never did).
Every other criterion passed. Nothing about the prose, the links, the structural split, the
skeleton or the walkthrough is in question; the repair is a small re-anchoring pass.

## Revision the verdict is anchored to

Pinned at 06:41:02Z, re-checked after a 50 s settle window (06:41:52Z, no hash moved):
`raw/hashes-t2.txt` + `raw/hashes-t3.txt` (+ `hashes-t0.txt`, `hashes-t1.txt` for the drift timeline).

| Artifact | sha256 |
|---|---|
| `docs/extension-authoring-guide.md` | `df231162f849ab2ac712084a8b0c08ccb515dfb9884104229c0b4767ba6bb6c5` |
| `docs/extension-authoring-guide.zh-CN.md` | `a6bbe90ee1a4fec9304deceeddcb96e2339982a96dcfee481f0103f61729b996` |
| `EXTENSIONS-FOR-AGENTS.md` | `dbdb9d144f61bf5718fcbbab21830b7647253063c8505a7ff0f0aafa5c64f2b0` |
| `docs/extension-adaptation-report.md` | `4bf61adec14adb0037aa79ccf117ddead6389c5248a4a713d06f5e1b13d0a0c2` |
| `packages/mpd-ext-plugin/src/index.ts` | `dd3bdd00579d8d7aa56a70cb18af6a0bfd4ce3bae400c730d0f35bc40f662ec0` (1093 lines) |
| `packages/mpd-roles-plugin/src/index.ts` | `9a54bf7d6620a2d437ebafd15bda5f7592e9e1cce2d997fe2c6170a71d6ab18c` |
| `scripts/mpd-ext.mjs` | `60d7901245381d9874094604de4b05b9d8c07b14f766b8adb8a8a40eea2618af` |

The three documents are byte-identical to the revision t9 froze (14:31 local): the docs did not
move; the SOURCE files beneath their line anchors did.

## Drift record (why some anchors rotted during this verification)

| Time (local) | Event |
|---|---|
| 14:13 | `evidence/extensions/f1-adapter-identity/20260916T061318Z/result.json` records the F1/F5 artifact as `index.ts:59-92 (CANONICAL NOTE + resolveAdapter)` |
| 14:30:36 – 14:31:53 | t9 writes `EXTENSIONS-FOR-AGENTS.md` and the guide pair |
| 14:34:2x | **this verifier's pre-repair baseline**: `index.ts` = 1081 lines; `sed -n 701p/793p/916p/970p` all EMPTY; `grep -n 'name: "mpd_ext_list"…'` → 703 / 795 / 918 / 972 |
| 14:36:40 – 14:37:42 | an in-flight repair (`evidence/extensions/f1-adapter-identity/20260916T063737Z-repair2/`, still writing at 14:37) rewrites `mpd-ext/src/index.ts` and `mpd-roles/src/index.ts`; `index.ts` 1081 → **1093 lines** (+12) |
| 14:41:02 / 14:41:52 | pin + 50 s settle re-check: no hash moves |

So the guide/report anchors were exact when written and were invalidated by the concurrent repair,
while the AI doc's four tool anchors were already 2 lines early at authoring time (measured at
14:34, before the repair). Root-cause hint: the four AI-doc numbers equal `HEAD`'s registration
lines + 57 (`644/736/859/913` → `701/793/916/970`), while the revision that existed when t9 wrote
was `HEAD` + 59 (`703/795/918/972`) — the anchors were taken from a snapshot two lines off.

## Findings

### F-t12-1 (medium) — the AI contract's four inspection-tool anchors resolve to the wrong lines
`EXTENSIONS-FOR-AGENTS.md:22` cites `packages/mpd-ext-plugin/src/index.ts:701`, `:793`, `:916`,
`:970` as the registrations of `mpd_ext_list` / `mpd_ext_show` / `mpd_flow_list` / `mpd_flow_show`.
At the revision t9 wrote against those four lines were **empty** (registrations at 703/795/918/972);
at the settled revision they carry `kept: { plane: … }`, a `lines.push('! rejected …')`, an
`mcp: entry.mcp.map(…)` and `id: flow.id,` — the registrations are at **715/807/930/984**.
Required fix: re-anchor to the settled lines, or (preferred: it cannot rot) cite the four tool names
instead of line numbers. Note three of the four are written as bare continuations (`:793`, `:916`,
`:970`), so no path:line scanner — including the author's own checker — extracts them at all.

### F-t12-2 (low) — the guide's two `index.ts` anchors were invalidated by the in-flight repair
`docs/extension-authoring-guide.md:75` (+ zh twin `:66`) cites `index.ts:641-658` for the
`mpd_ext_show` env-value redaction, and `:104` cites `index.ts:1041-1053` for connect-at-apply.
Both were exact at 14:34 (`redactedDescriptor` at 641-658, the `connectExtensionMcpServers({` call
at 1041-1053); after the repair they are at **659** and **1062**. Required fix: re-anchor after the
repair settles.

### F-t12-3 (low) — the report's F1 row no longer brackets `resolveAdapter`
`docs/extension-adaptation-report.md:372` (+ zh `:176`) cites `index.ts:59-95` as "the canonical
note plus `resolveAdapter`". The claim was true when written (t4's own evidence records 59-92). At
the settled revision the note + identity constants span 58-94 and `resolveAdapter` is declared at
**102**, so the anchor no longer contains it — the sample only passes a naive text search because
the note itself mentions the identifier. Required fix: same re-anchoring pass, or cite the symbol.

### Observation (not a finding) — `mcp.ts:34`
`docs/extension-authoring-guide.md:112`, `EXTENSIONS-FOR-AGENTS.md:132` and the report's F4 area
cite `packages/mpd-ext-plugin/src/mcp.ts:34` for the MCP state vocabulary. Line 34 IS
`export type McpServerState = "connecting" | … | "disabled"` — resolved. The "bounded child-stderr
tail" glued to the same sentence is typed at `mcp.ts:42`; a reader looking for the tail type has to
scroll eight lines. Precision note only.

### Accepted tracked deviation (captain-ruled; NOT a t12 finding)
The report's §12 rows for F8/F9/F10 read `delivered by t8 — evidence pending at the time of writing
(task t8)`, and the closing paragraph (EN:388-391, ZH:191-193) states that the wave's single skills
re-pin had not landed. t8 has since landed, so that paragraph is now contradicted by the tree:
`VENDOR_LOCK.json` reads `fileCount 318` / `treeSha a8ba96b8108b2df3cce707e7b69d038f71514cea…`
(t8's own report: 317/`7a48fdad…` → 318/`a8ba96b8…`, 1 hunk, 3 changed lines each side,
`node scripts/verify-vendor.mjs` exit 0). The three rows remain honestly marked `pending`, so no
false "fixed" claim exists; finalising them (and that paragraph) is the follow-up task the captain
is creating for the docs author.

## What passed, and how it was made falsifiable

1. **Doc-pair parity** — `node scripts/verify-docs-parity.mjs` exit 0, 36 pairs, and
   `ok docs/extension-authoring-guide.md` is a CHECKED pair, not one of the 16 printed exemptions.
   Controls: `--root <tmp>` with the zh twin deleted → exit 1 `missing zh-CN file`; with the switch
   link deleted → exit 1 `EN switch link missing/not under the title`; faithful copy → exit 0.
2. **Citations** — the author's checker re-run twice on the settled revision: 14/14, 173 citations,
   0 unresolved (it checks existence and line RANGE only, which is why it stays green while
   F-t12-1/2/3 are wrong). Independent re-implementation: 36 in-scope anchors (guides + AI doc in
   full, the two reports scoped to §12), correct repo-vs-doc-relative resolution, shorthand
   continuation anchors expanded, blank-anchor detection — 0 missing / out-of-range / blank.
3. **Links + anchors** — 112 relative links across `README.md`, `README.zh-CN.md`, `docs/index.md`,
   `docs/index.zh-CN.md`, the guide pair and the AI doc; 6 with heading anchors; 0 unresolved.
   Controls: the four real anchors resolve (including the CJK slug `#终端界面dsh-tui`), an invented
   anchor is reported unresolved.
4. **Report status vs reality** — every "fixed" row resolves to a real dir with a result
   (`f1-adapter-identity/20260916T061318Z/`, `debranding-probe/20260916T061807Z/` incl. the exact
   `verify-debranding-full.mjs`, `pack-closure-check/20260916T061527Z/` + `scripts/verify-pack-closure.mjs`);
   F6's deferred pre-`c239407` dirs are absent from the change set and `c239407` exists; F2/F3/F4's
   sections exist in both guide languages. (The F8/F9/F10 deviation above is the only gap, and it is
   tracked, not hidden.)
5. **Skeleton + walkthrough** — the AI doc's `for-agents-skeleton` block, extracted independently,
   materialized next to the template's four assets, `mpd-ext validate` exit 0; NEGATIVE control with
   the declared persona file deleted → exit 1 `2 problem(s) — this extension would not load`. The
   guide's §5 walkthrough runs verbatim with a sandboxed `HOME`: scaffold (3-kind) exit 0, validate
   exit 0, `list` exit 0, `cp -r` arm validate exit 0, `--with-mcp` arm validate exit 0 and the
   host-free server smoke answers `tools/list`; the AI doc's §6 worked copy (both planes) exit 0.
   The only non-zero step is the server smoke against the DEFAULT (no `--with-mcp`) copy, whose
   `server.mjs` §5 itself says is dropped — consistent with the documented flag semantics, not a
   broken walkthrough.
6. **Structural split** — tested, not asserted: 20 machine headings vs 26 human, 0 shared; 17
   machine paragraphs (>= 80 normalised chars) vs 25 human, 0 duplicated. Control: the same
   comparator run guide-vs-guide reports 25 shared paragraphs, so a zero is a measurement.

## Files

- `raw/` — every command's raw output (`gate-docs-parity.txt`, `negctl-*.txt`, `anchor-sweep.txt`,
  `independent-run1.txt`, `controls.txt`, `walkthrough.txt`, `status-section-vs-reality.txt`,
  `hashes-t0..t3.txt`, `gate-verify-vendor.txt`, `author-checker-rerun*.txt`).
- `independent-result.json`, `anchor-sweep.json`, `controls` output, `author-checker-result*.json` —
  machine-readable readings.
- `verify-docs-independent2.mjs`, `anchor-sweep2.mjs`, `controls.mjs`, `samples.json`,
  `walkthrough.sh`, `author-check-citations.mjs` (byte-identical copy of the author's checker,
  sha256 `c090fc99368c8b8016267aece8270ae67ca6963438d4c65a14f91e0be0c991b0`, kept at
  `evidence/extensions/verify-docs/` because its `REPO` is derived from its own depth).
