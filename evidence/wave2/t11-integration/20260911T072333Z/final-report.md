# Wave-2 t11 — final report (short, honest, actionable)

## 1. What changed

Wave 1 and wave 2 are **one uncommitted tree** (`dev` @ `98680b1f`, 66 modified + 59 untracked entries).
The two waves are not separable in git (see `commit-plan.md`), so the close-out is one reconciled plan.

- **Wave 1 (B1–B6):** session-workspace resolution through the adapter (`dsh.workspaceRoot(exec)`) across
  every mpd plugin; lossless verif backend JSON; the hashline `oneOf` schema fix; the vendor gate that no
  longer reports a failing asset as OK; docs.
- **Wave 2:** **B8** — the bundle patch names NO binary path any more; each MCP row launches
  `packages/mpd-mcp-<name>/launch.mjs`, which resolves through the ONE shared
  `packages/mpd-mcp-shared/bin-resolve.mjs` (caller pin → `MPD_AST_GREP_BIN_DIR` → `createRequire` →
  `<bundle>/.toolchain/...` → adopted chain), with `ast-grep` preferred over the deprecated `sg` wrapper
  and a `--version`-prints-`ast-grep` acceptance probe. **B9** — the legacy installer gains the missing
  `mpd-verif` row plus a new `verify:rows` guard. **R1** — the cocotb iron gate runs before the regress
  work directory is created (t3) and `exec` is forwarded to the per-case sims (t12). **QA isolation** —
  every QA boot/session carries a sandbox workspace and positively asserts no real-workspace key
  (t7, `skills/dsh-qa/scripts/lib/workspace-isolation.mjs`). **Memory migration** — the 7 orphaned
  entries copied (never moved) into the correct store, committed there as `8635a6e`. **Adopted tooling** —
  inScope `**` expansion, the contract-contradiction guard, the read-only `agent_teams_task_contract`
  surface, and the delta applier that makes a hand re-vendor loud (t4 + repairs t13/t14/t15-cancelled).

## 2. What was verified, and by whom

- **t9 (Reviewer):** all five wave-2 workstreams re-derived with its own controls — 7/7 acceptance,
  12/12 commands; B8 gate 20/20 across checkout AND packed layouts with all pins scrubbed; it also
  covered t12's dist marker.
- **t8 (Lead, independent):** three attempts. Attempt 1 FAILED (three findings), attempt 2 FAILED on a
  new F4 (clean heal not byte-faithful), attempt 3 **PASSED** on the captain's re-scoped contract —
  glob pre/post with the real wave-1 replay, contradiction closed with the over-carve control,
  live-record contract reads 13/13, every guard failure mode non-zero and named with a **byte-faithful**
  restore for `quality-gates.js`, 0 of 212 added lines outside the 9 regions, and a mounting boot with
  14/14 agent-teams tools and 0 apply-crash signatures. **Stated limitation, not closed:** t4
  acceptance 5 is MET for `quality-gates.js` and **NOT MET for `tools.js`** (60-line heal divergence;
  wave-3 registry redesign, analysis in `evidence/wave2/adopted-tooling-repair-f4-sibling/README.md`).
- **t10 (Reviewer):** review round 1 PASS on the frozen revision, A1–A7 traced, with its own
  observed-failure durability probe.
- **t11 (Lead, this task):** the gate sweep below was re-run by ME on the frozen tree; nothing quoted
  from a member's report.

## 3. The green snapshot (frozen tree, raw)

| Gate | Result |
|---|---|
| `node scripts/verify-vendor.mjs` | PASS — commit/version/stats + 6 assets (skills 366 files) |
| `bun run verify:rows` | ok — 22 row ids match the bundle patch insert list (mpd-verif included) |
| `bun run typecheck` | exit 0 |
| `bun test packages` | **343 pass / 0 fail** / 2194 expect() calls / 38 files |
| `bun run test:qa` | all self-tests passed |
| `node skills/dsh-qa/scripts/preset-conformance.mjs` | PASS — conformance ok (30 checked), parity 31/31, auth ok, `session/create` 200 with `agentPreset: mpd`, mount log 0 signatures, **negative control fired** (`agent-preset/invalid … $.prefix missing required value`) |
| `node evidence/session-workspace-root/dist-repair/sweep.mjs --clean-room` | **0 STALE / 16 FRESH**, clean-room pass1==pass2 16/16 and committed==pass2 16/16 |
| `npm run pack` | re-run (the wave rebuilt dists): 19 packed dist files byte-identical to the working tree, 0 mismatches; B8 launchers + resolver present; modes normalized **1160 files → 1148×644 + 12×755, zero 600s** (was 1118×644, **30×600**, 12×755) |
| `node skills/dsh-qa/scripts/mcp-call.mjs` | **FAILS, reported raw** — see below |

Frozen hashes: `quality-gates.js 4e94f7f6…`, `tools.js fd106fdb…`, `mpd-deltas.js 9680c7b8…`,
`patch-agent-teams-fixes.mjs aedb9198…`, `VENDOR_LOCK.json 2d358a30…` (skills re-pinned to
`5b13e920…`), `cordis.patch.yml 88ad2cb2…`.

## 4. `mcp-call` — the real result, raw, not retried into green

`node skills/dsh-qa/scripts/mcp-call.mjs` → exit 1, `{ok:false, enum:{exit:1}, call:{exit:1}}`. Two
independent causes, both visible in its own log:

1. **F-B8-1 (the t9 finding) reproduces on the fresh pack:** the codegraph MCP child dies with an
   uncaught `Error: ENOENT: no such file or directory, mkdir '/root/.mpd/codegraph'` from
   `dist/mpd-package/packages/mpd-mcp-codegraph/dist/serve.js:308 acquireLock` (7 occurrences).
   `/root/.mpd` is genuinely read-only here (`touch` → "Read-only file system"). The B8 fix removed the
   `MPD_CODEGRAPH_BIN` pin that used to short-circuit this path, so the defect is newly reachable — the
   fix is right, the adopted provisioning should degrade instead of throwing (carry-forward A12).
2. **`MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`** — this
   environment has no usable LLM credential: `~/.dsh/settings.yaml` carries only UI/pet/agent-default
   settings (`llm-deepseek: {}`) and `~/.dsh/.credentials.yaml` only a `client-connection/browser-session`
   grant, and `settings.yaml` names NO gateway (`llm-pi-ai`) provider. t11 added the documented
   `settings.yaml` copy to `mcp-call.mjs` (the fix was owed), but a copy cannot conjure a key that does
   not exist. `mcp-call` needs a real model turn, so it cannot pass here; the credential-free B8 proof is
   t9's own gate (20/20 by driving the shipped launchers as MCP stdio servers).

**What the pack refresh DID fix:** the `MODULE_NOT_FOUND …/packages/mpd-mcp-astgrep/launch.mjs` that t7
measured is gone — both launchers now run from the packed artifact (the codegraph stack trace above is
the proof that the packed launcher executed).

## 5. What the user must do next

1. **Restart dsh.** There is NO hot reload of plugin modules in this harness, so nothing in this wave
   that touches adopted plugin code — the `**` matcher, the contract surfaces, the delta applier — acts
   on a running session until dsh restarts. All wave-2 claims about that code are module-level or
   mounted-boot results, never live-gate results.
2. **Archive two real team records** in the AgentTeams tab: `mpd-default-0bc1738e` (t7's isolation
   negative control) and `mpd-default-587132ea` (t9's isolation negative control). They are the controls
   that proved the isolation defect was real and were deliberately left in place.
3. **Fix `~/.mpd/mcp.env` if you source it.** It still exports
   `MPD_AST_GREP_SG_PATH="/root/dshProj/my-power-dsh/.toolchain/node_modules/.bin/sg"` — the DEPRECATED
   wrapper that fails `--version` (exit 1; `ast-grep --version` exits 0 printing `ast-grep 0.45.3`) —
   and `MPD_CODEGRAPH_BIN`. Because a caller pin WINS untouched, sourcing that file re-introduces the
   dead pin and bypasses B8's resolution chain. Point it at `.bin/ast-grep`, or drop those two lines
   now that the launchers resolve bundle-relatively. (`MPD_DSH_WAVE_MCP_BIN` / `MPD_DSH_TRACEWEAVE_BIN`
   in the same file are unrelated and still needed for the wave/traceweave rows.)
4. **Optional:** nothing else is required for the wave to be effective; the toolchain provisioning
   (`node scripts/install-mcp.mjs --with-*`) is only needed when a binary is genuinely absent.

## 6. Honesty notes

- The `tools.js` heal-fidelity gap is NOT closed; it is recorded, measured and owned by wave 3.
- The `mcp-call` failure is reported as measured, with both causes named, and was not retried into a
  green.
- The wave-2 tree still carries t15's indent-correction machinery (`anchorMarker`, `anchorOccurrence`,
  `effectiveInsertionIndent`, the CLI `(indent corrected: …)` report) rather than being byte-identical to
  the post-t14 revision: the revert was semantic, not byte-level. Behaviour is what t8 verified.
