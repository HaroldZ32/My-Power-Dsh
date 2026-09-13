# Close-out ledger — the wave of 2026-09-13

**User request**: commit and push the repair; fix the `relocate-smoke` fresh-clone blocker; close
the MCP rebuild brand-protection hazard; and re-declare the project's identity (it drew on
oh-my-openagent and dsh-agent-teams, but it is no longer "the OMO DeepSeek-Harness port"; the
licence stays SUL-1.0 inherited from OMO).

**Base**: `32ae54dd` (branch `dev`) · **Result**: six commits on five `fix/*` branches, each merged
`--no-ff` into `dev`.

---

## 1. The commits

| Branch | Commit | Subject |
|---|---|---|
| `fix/rtl-extraction-residuals` | `a64264d` | repair the confirmed extraction residuals (R1–R7) |
| ″ | `7eb3b85` | file the residual audit, repair and follow-up evidence |
| `fix/mcp-rebuild-brand-guard` | `d6eb692` | fail the rebuild on foreign brand tokens + repair the git-bash alias |
| `fix/build-placeholder-and-lockfile` | `eda9838` | drop the placeholder provenance + refresh the stale workspace lock |
| `fix/relocate-smoke-fresh-clone` | `0b4772a` | skip absent prerequisites with a reason (3 cases) + the skills re-pin |
| `fix/project-declaration` | `e1096ed` | state the independent identity, drop the false lineage claim |

Merges into `dev`: `d72767c`, `e92260d`, `a3d3628`, `c18c80a`, `4a1d661`.

## 2. Gate sweep on the merged tree (captain's own runs, all exit 0)

`bun run typecheck` · `bun test packages` · `bun run test:qa` · `bun run test:qa:strict` ·
`node scripts/verify-vendor.mjs` · `node scripts/verify-rtl-references.mjs` ·
`node scripts/verify-rows-parity.mjs` · `node scripts/patch-agent-teams-fixes.mjs --check`.

Re-run after the merge, on the merged tree — not accepted from any member's report.

## 3. Answering the user's four requests

**(1) Commit and push the repair.** Five branches + `dev`, pushed to `origin`
(`https://gitee.com/nop_chip/my-power-dsh`). The 50 staged paths of the verified repair landed in
`a64264d`; the audit/repair/follow-up evidence in `7eb3b85`.

**(2) `relocate-smoke` fresh-clone.** A clean clone's `bun run test:qa` exited 1 on a gitignored
artifact. Now: pack absent → **exit 0 with exactly three canonical SKIP markers** (pack present →
exit 0, 0 SKIPs), plus `test:qa:strict` which turns the same absence into a loud failure. The
blocker count is **three**, not the two the contract claimed — `skill-catalog-probe.mjs` sorts
first and aborted the suite, falsifying the contract's own M4 measurement; that correction is
recorded. The captain additionally found and fixed a **false green**: `team-route-rewire` exited 0
on a pack whose `package.json` was `name: broken`, because its success line's "staged bundle
present" rested on a bare `existsSync`. It now runs `packUsable()` and fails loudly.

**(3) Rebuild brand protection.** `scripts/build-mcp.mjs` gains a two-layer guard: a **byte
comparison** against the committed dists (fails loudly naming artifact, first differing char, both
sizes and both differing lines; fails when zero artifacts were compared) and a **layered token
allowlist** whose matcher captures full identifiers (an earlier form collapsed
`omoRuntimeCandidates`/`omo/ping` to the bare token `omo`, which one allowlisted entry would have
satisfied). Both directions are proven with child-process exit codes. The committed git-bash
`cli.js` also carried `platformFrmpdOptions` — our own global `omo`→`mpd` rewrite matching the
incidental `omO` inside `platformFromOptions` (the form both upstream checkouts carry, 5×) — so the
artifact was the corrupted one and a rebuild would have *fixed* it; repaired to `0484a8ff…` /
22 651 B with its `BUILD.lock` and `VENDOR_LOCK` entries moved together.

**(4) Declaration.** `README.md`, `README.zh-CN.md`, `AGENTS.md` §1, `package.json` and the three
plugin README pairs now state an independent bundle identity with SUL-1.0 + attribution as a
**licence fact**. The old "fork derived … with deep modifications" frame was **factually false**:
the pinned upstream commit `8c57e463…` is absent (`git cat-file` → *Not a valid commit name*), it is
not an ancestor of HEAD, the root commit is `80e5260d` (2026-08-26) and the only remote is the
Gitee origin. The captain's own repo-wide grep then found the same claim in **four source headers**
plus a fifth file with a `port of upstream` phrasing — all fixed comment-only, with each package's
dist rebuilt. Exemptions (skills' own provenance, the agent-teams API term, historical records,
prior evidence) are recorded with reasons rather than silently swept.

## 4. Defects found in this wave — by whom, and how they were closed

| # | Defect | Found by | Closed |
|---|---|---|---|
| D1 | git-bash scrub covered only `omo-git-bash-run-`, so `Usage: omo-git-bash` passed unreported | contract + captain reproduction | guard (byte + token layers) |
| D2 | guard collapsed identifiers to the bare token `omo` | captain (vector battery) | matcher narrowed; full identifiers |
| D3 | `platformFrmpdOptions` corruption in the committed dist | captain (upstream provenance) | dist repaired, both pins moved |
| D4 | placeholder `the upstream project` minted in script **and** BUILD.locks | captain (grep) | real provenance `8c57e46` |
| D5 | committed `BUILD.lock` hashes disagreed with their artifacts and VENDOR_LOCK | X5 lane | realigned, verified three ways |
| D6 | `bun.lock` missing 7 real workspaces and carrying 2 ghosts | captain (lock diff) | regenerated; `--frozen-lockfile` exit 0 |
| D7 | fresh-clone blocker count was three, not two | X7 lane (exhaustive sweep) | third case converted; contract corrected |
| D8 | `team-route-rewire` false green on a present-but-broken pack | captain (AM3 control) | `packUsable()` check; fix re-proven both ways |
| D9 | false "fork" lineage claim in docs **and** four source headers | captain (repo-wide grep) | declaration + header fixes + dist rebuilds |
| D10 | doc/evidence citations that outlived their subject (X1 five revisions, X2 v2 flag+marker, the tripwire's red→green transition, my own stale gitbash figures) | multiple lanes | supersession notes, never silent rewrites |

## 5. Captain errors, recorded (not hidden)

- **Task-record staging:** I extended two tasks' instructions without extending their `inScope`, so
  the completion guard refused delivered work twice; the retired records (`t21`, `t25`, `t28`) are
  cancelled with the reason, and their work rode into the branches regardless.
- **Cancel cascade:** cancelling a record releases its dependents — `t22`–`t25`, then `t29`/`t30`,
  then `t31`'s predecessor were all released and re-created. The chain survived, but the ledger
  shows the churn.
- **Two of my instructions were wrong and members corrected me:** the probe-order phrasing for the
  third case (AM3b requires the checks BEFORE the gate — implemented that way, and my sentence is
  recorded as superseded-by-contract), and a "currently has NO files" claim about `followup/` that
  was already stale when I wrote it.
- **My first `treeSha` recomputation was algorithmically wrong** (walk order instead of the gate's
  relative-path sort); `verify-vendor` caught it with a mismatch instead of accepting a
  plausible-looking hash. Lesson recorded: recompute a fingerprint with the gate's own algorithm.
- **My own fresh-clone simulation** briefly held `dist/mpd-package` aside, which another lane
  observed as a transient SKIP; the pack was restored byte-identically
  (`package.json` sha256 `f8c94451…`).

## 6. What is NOT verified (stated rather than blurred)

- **A real end-to-end rebuild comparison** was never run: it needs the OMO checkout plus bun and
  would rewrite `dist/`. The byte layer is proven as a pure function over artifact bytes and wired
  into the build loop; the real-rebuild path is exercised by the wave's gate runs.
- **A per-sentence EN/zh declaration map** — the zero-grep and the ten-file apply table are
  verified; the stronger per-sentence mapping is the Reviewer's form and is not claimed here.
- **`bun install --frozen-lockfile`** was verified by the captain (exit 0, "Checked 31 installs
  across 48 packages (no changes)"); the read-only-tempdir limitation and its workspace-scoped
  workaround are documented in the X5 report.
- The X8 verification gate (t33) deliberately **failed itself** rather than pass on partial
  discharge; its four open obligations are closed in §2/§3 above except where explicitly listed in
  this section.

## 7. Follow-ups this wave deliberately did not take

- `LICENSE.md`'s inherited body opens with "incorporated into the oh-my-opencode Software"; the
  owner may want a provenance note in `LICENSE-NOTICES.md` (a separate, flagged recommendation —
  the licence text itself is not rewritten).
- `codegraph-smoke.mjs` has no credential guard and dies with an uncaught `ENOENT` instead of
  skipping; 13 real lanes still exit 1 on absent credentials without a marker (recorded, not
  converted — outside this wave's scope).
- The `relocate-smoke`/`team-route-rewire` **real** lanes need credentials and a full install; they
  are the next candidates for the same treatment, one wave each.

## 8. Pins (taken once, at freeze, on the merged tree)

| Artifact | Pin |
|---|---|
| Skills corpus | `fileCount 328`, `treeSha afe718251965a933b6a15b40bbe6ebf2e5222996fecb48b05fc8e770e390fcad` |
| `packages/mpd-mcp-gitbash/dist/cli.js` | `0484a8ff1714c949bc52a4fc0de89c756dcab975b0691a2823706f008475f38e` / 22 651 B |
| `packages/mpd-mcp-astgrep/dist/cli.js` | `f06bba310cad306b5638efb90a69e50b2c6a7416c0c536867f02c70f4b4fa4c5` / 84 651 B |
| `packages/mpd-mcp-lsp/dist/cli.js` | `9f41d4258c204aca959de98a5bea59a7459f9e298885f187cfc0268e1d18ce69` / 234 827 B |
| `VENDOR_LOCK.json` | vendor gate PASS on the merged tree |

Every earlier hash quoted in a lane's report is a **labelled point-in-time measurement**, not a
freeze value; this table is the binding one for the revision it names.

---

## 9. Post-freeze revision: the declaration's tone (owner review)

The owner read the landed declaration and called it out: *"也不用强调不是OMO的扩展，这就活脱一掩耳盗铃"* —
don't keep insisting it is not an OMO extension; that is self-deception. The objection stands on the
option's own measurements: the bundle still ships the upstream roster under its stable ids, still
speaks the upstream wire names (`OMO_CODEX_*`, `_omo`), and still pins the upstream baseline, so an
opening line that denies being the upstream's port is defending a claim rather than describing a
project.

Revision (`fix/declaration-style`, commit `2058963`, merged `fbbd650`): the negation framing was
replaced with a factual two-part statement — **what it carries from upstream** (roster, model-chain
vocabulary, wire names, the pinned `oh-my-openagent` baseline `8c57e46`, the adopted
dsh-agent-teams component under MIT) and **what is ours** (the DSH plumbing, the plugin set, the
`mpd` preset, the QA suite) — with the licence stated as a licence fact. The same treatment went to
`AGENTS.md` §1 — which now also carries the rule this episode produced: *describe this repository by
what it ships, never by what it is not* — plus `package.json`, the four source-header comments and
the three plugin README pairs (`covered by SUL-1.0` → `SUL-1.0, inherited from upstream`), with each
touched package's dist rebuilt.

What did NOT change: the provenance measurements (the pinned upstream commit object is absent and is
not an ancestor of HEAD), `LICENSE.md`, `LICENSE-NOTICES.md`, the recorded exemptions, and every
"independent" that refers to the workmate library's instance naming rather than to an identity.
