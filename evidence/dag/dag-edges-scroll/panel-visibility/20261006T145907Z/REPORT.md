# panel-visibility — why the TUI sidebar never showed the MPD tabs

Defect (user report, verbatim): 「这边 TUI 侧边栏依旧没有 TEAM 栏的显示（只有任务/待办/代理）」

Revision: branch `feature/dag-edges-scroll`, base `52cd964f`, UNCOMMITTED working tree (the wave commits at
the end). Host: `@deepseek-harness-tui/dsh-tui` 0.13.0, launched from the global install.

Isolation (dsh-qa hard rule 1, three ways): sandbox `DSH_HOME`, sandbox `HOME`, sandbox workspace used both as
`DSH_TUI_WORKSPACE_TARGET` and as the tmux pane's cwd. No boot read or wrote the real `~/.dsh` or `~/.dsh-tui`.
The sandbox is a copy of the captain-provisioned `.mpd/recon/tui-013-fv`, moved to a shorter path because the
private tmux socket exceeded `sun_path` at the evidence path (`error connecting to …sock (File name too long)`).

## The cause, in one paragraph

The host's own registration path DOES append a successfully registered panel id to the sidebar's enable CSV
(`enablePanelIdInStore` in `lib/types/dsh-adapter/panels.js`). MEASURED, in-process, at +1056 ms: the CSV became
`todo,jobs,agents,act1:team`, then `…,act1:dag`, then `…,act1:workmate`. Then at **+5403 ms** it went back to
`todo,jobs,agents`, and the stack on that write names the writer exactly:
`tuiDisplayPrefs.js:158 apply` ← `dsh-adapter/plugin.js:586 applySidePanelPanels(config.sidePanel?.panels)` ←
`Fiber._reload` ← `Fiber.await`. The `dsh-tui` row re-applies its CONFIG about 4.3 s after our registration, and
while the user layer is unset that config is the schema default `todo,jobs,agents`, so the append is transient
and the sidebar ends up with the host's three builtins.

**Correction to the earlier recon.** The composed ids are `act1:team`, `act1:dag`, `act1:workmate` — NOT
`mpd-tui:*`. `pluginIdFor(caller, owner)` returns `identity.componentId` only when `componentIdentityOf(caller)`
is defined, and that identity is bound only by `bindComponentIdentity(...)` for an ADMITTED Component
(`componentId: projection.metadata.name`). A `cordis.patch.yml` loader row has none, so the host takes its own
`act<N>` fallback. The ids are knowable ONLY from the host's registration read-back at run time; the host's own
`PanelStore` read-back in ARM A carried exactly `act1:team@plugin,act1:dag@plugin,act1:workmate@plugin`.

## Arms

| arm | what it is | verdict |
|---|---|---|
| A | STEP 1 reproduction, STOCK profile (`sidePanel.panels` ABSENT), pre-fix dist | RED reproduced: `mpdTabSeen=false`, the three appends then the +5403 ms reset |
| B | POSITIVE CONTROL, same boot, `sidePanel.panels` forced to the three measured ids | GREEN: no reset event fires (`apply` dedupes an identical value), `settledEnabled=true`, the bar paints `‹ MPD ›` |
| C | STEP 4, STOCK profile on the rebuilt adapter dist, whole ladder window elapsed | BLOCKED — see `result.json.blockedBy` |
| E | STEP 4, STEP 3 proven end to end: the script wrote the user layer, then a real PTY boot | GREEN: `bars=["‹ MPD › ◈ ◆","M ‹ MPD DAG › ◆","M ◈ ‹ MPD workmate ›"]`, `settledEnabled=true`, `failures=[]` |

ARM E answers the user's complaint on its own, independently of the keeper: `node scripts/mpd-tui-panels.ts
--apply` puts the ids into the profile's own patch file and the sidebar paints all three pages on the next boot.

## Why ARM C is blocked

The adapter row is NOT the instance that registers the panels.

* the adapter log proves the mounted row ran and bound its host contact:
  `[mpd-tui-adapter] mpdTui provided …` + `host contact bound: …/dsh-tui (lib/types/ui.js)`;
* the host's `PanelStore` carries the three ids, so registration DID succeed;
* but `<ws>/.mpd/logs/mpd-tui-panels.json` is **0 bytes** and the keeper logged nothing — `recordPanelIds` fires
  on every `observe`, and `observe` is only reachable once the host's `list()` read-back produced a `finalId`,
  and `tuiPanels.list()` DOES exist on the host service. So zero registrations reached the mounted adapter.

The consumer row resolves the adapter ONCE at its own `apply()`
(`packages/mpd-tui-plugin/src/index.ts` → `resolveTuiAdapter(ctx)`), whose fallback is `createTuiAdapter(ctx)`,
so which instance receives the registrations depends on loader sibling order. `grep -c keepPanelEnable
packages/mpd-tui-plugin/dist/index.js` = **0**: the copy actually running is INLINED into that dist and still
predates the fix. Rebuilding it with the pinned toolchain (`.toolchain/node_modules/.bin/bun`) unblocks ARM C
and the negative control ARM D.

The same finding is a SECOND, wider defect: the `cordis.patch.yml` comment above the `mpd-tui-adapter` row says
"the consumer resolves the adapter lazily per call, so a sibling evaluated first still finds it" — that describes
`createLazyTuiAdapter`, which the call site does not use. The mounted `mpdTui` service is therefore decorative
for every adapter-provided capability, not just this keeper. The workaround shipped here (`resolveTuiAdapter`'s
fallback opts the keeper in) is race-independent; the call-site fix is a follow-up of its own.

## Measurement bugs found and fixed during this work

1. The probe arms in EVERY node child, and each loads its own copy of the host store that never changes: 1223
   poll lines, most from MCP children reporting `todo,jobs,agents`. "The last poll" was therefore a foreign
   process's store and `settledEnabled` read FALSE on an arm whose sidebar plainly painted the MPD tab.
   Filtering every series to the pid derived from the `CHANGE` records flipped ARM E to `true` with no other
   change.
2. The tmux socket path exceeded `sun_path` at the evidence path; the sandbox moved to a short scratch root.
3. A `.mjs` probe carrying TypeScript annotations is a `SyntaxError` under `--import` and took the whole boot
   down (`Missing initializer in const declaration`).

## Commands

```
bun evidence/dag/dag-edges-scroll/panel-visibility/20261006T145907Z/repro.ts \
    --sandbox-root <sandbox> --out <arm dir> --label <a|b|c|e> --panels <csv|none|keep> [--boot-env K=V]
node scripts/mpd-tui-panels.ts --self-test
node scripts/mpd-tui-panels.ts --dsh-home <sandbox>/dshhome --profile dsh-tui --workspace <sandbox>/ws \
    --ids act1:team,act1:dag,act1:workmate [--apply]
bun test packages/mpd-tui-plugin/test/panel-visibility.test.ts
node scripts/verify-dist-fresh.ts --only mpd-tui-adapter-plugin
bun run verify:comments ; bun run verify:docs
```

## Gates observed

* `node scripts/verify-dist-fresh.ts --only mpd-tui-adapter-plugin` → `ok: 1/1 targets fresh` (40043 B, pinned toolchain).
* `bun run verify:comments` → `VERDICT: PASS` (407 files, 34675 declarations).
* `bun run verify:docs` → `pairs=45 failed=0 violations=0 dead=0 — PASS`.
* `bun test packages/mpd-tui-plugin/test/panel-visibility.test.ts` → 15 pass / 0 fail.
* `bun test packages/mpd-tui-adapter-plugin/test` → 39 pass / 0 fail.
* `node scripts/mpd-tui-panels.ts --self-test` → 18/18 arms held.
* `bun run verify:gates` → 6/8 PASS. The two reds are NOT this change: `vendor` fails because the upstream
  checkout is absent from this machine (`upstream checkout not found at /home/haroldzhao`), and `dist-fresh`
  fails on exactly one target, `packages/mpd-tui-plugin/dist/index.js`, from the sibling lane's in-flight `src`
  edits. `bun run typecheck` likewise reddens only in `packages/mpd-bundle-plugin/test/team-view.test.ts` (4
  errors, a sibling lane's file) and in the sibling's `mpd-tui-plugin/src/graph.ts` state.

## Amendment after the captain's ruling (same revision, after the first report)

RULING: the keeper must not fight a configured position, and it can tell without a third host contact.
The re-assert condition is now: **append the whole set only when the enable list names NONE of our
registered ids**; if it names ANY of them, the keeper writes nothing and stands down. A partial write is
never performed, so a half-repaired list cannot make the next tick stand down mid-repair.

Case by case, as the ruling states it:
* fresh profile, no settings document → after the reset the list is `todo,jobs,agents`, none of ours is
  present → the set is re-asserted. The user's actual complaint, unchanged.
* the user ran `scripts/mpd-tui-panels.ts --apply` → the config names all three → they survive the reset →
  stand down, nothing written.
* the user removed ONE of ours on purpose and it persisted → the config names the other two → ANY of ours
  is present → **stand down**. Under the previous "append whatever is missing" rule the keeper put the
  removed page back; it no longer does.

NAMED RESIDUAL, in the code comment, both READMEs, both docs pages and this report: a user who removes
**ALL** of ours on purpose leaves a list indistinguishable from a fresh profile's at the live-store level,
so the set is re-added once per boot. Separating those cases needs the CONFIGURED value — a third
host-internals contact, and a §6 count decision the captain deliberately deferred to its own change.

Tests after the ruling: `bun test packages/mpd-tui-plugin/test/panel-visibility.test.ts` → **17 pass / 0
fail** (two new arms: the stand-down, and the single-set write), `bun test
packages/mpd-tui-adapter-plugin/test` → 39 pass / 0 fail, `node scripts/mpd-tui-panels.ts --self-test` →
18/18, `bun run verify:docs` → PASS.

DIST STATE: the adapter's `src` changed for this ruling, so `packages/mpd-tui-adapter-plugin/dist/index.js`
is now STALE by design and needs the captain's pinned-toolchain rebuild. ARM C/D remain blocked on the
`mpd-tui-plugin` dist rebuild as reported.

## ARM C and ARM D — the fixed revision (dist identity recorded WITH the readings)

Build identity, read in the same block as each capture (a reading is evidence only next to the build it
was taken against):

| artifact | sha256 | bytes |
|---|---|---|
| `packages/mpd-tui-adapter-plugin/dist/index.js` | `ca40ecefa0282a7795d23724a759ebb3757eb458832ae245316c9450eae60d2c` | 40295 |
| `packages/mpd-tui-plugin/dist/index.js` | `5318b500dc222b7f56d69f23ccf64a8ebcc697e7ae315644d40f8d0c4f640cdb` | 385962 |

Both shas were identical at the START and the END of each arm (16:26:57Z → 16:27:51Z for C, 16:27:59Z →
16:28:53Z for D), and `grep -c keepPanelEnable packages/mpd-tui-plugin/dist/index.js` answers **3** — the
inlined copy that actually registers the panels now carries the keeper. Both arms ran the same STOCK
profile (`sidePanel.panels` absent, `settingsFilePresent: false`, no `settings.yaml` anywhere).

### ARM C — GREEN. The keeper runs on the instance that registers, and the gap from ARM A is closed.

```
csvEvents, in order:
  todo,jobs,agents,act1:team                          <- the host's own append
  todo,jobs,agents,act1:team,act1:dag
  todo,jobs,agents,act1:team,act1:dag,act1:workmate
  todo,jobs,agents                                    <- the host's config re-apply (the old loss)
  todo,jobs,agents,act1:team,act1:dag,act1:workmate   <- THE KEEPER'S RE-ASSERT (the fix)
```

* `mpdTabSeen: true`; the settled bar carries `≡ ▸ ◆ ‹ MPD › ◈ ◆` alongside the builtins.
* `settledEnabled: true` — **the set settled to the configured value**, which on a stock sandbox is the
  schema default `todo,jobs,agents` plus our three ids; the builtins are PRESENT here, not removed.
* `failures: []`.
* the adapter's own settle line, verbatim:
  `mpd-tui panel enable keeper: confirmed — standing down: the enable list already names act1:team,act1:dag,act1:workmate, so the configuration has taken a position on this bundle; 1 write(s) over 6 tick(s); ids act1:team,act1:dag,act1:workmate`
  **exactly one write over the six ticks**: it repaired the post-reset list once, then stood down on the
  ticks that followed, as the ruling requires.
* the id record read back `["act1:team","act1:dag","act1:workmate"]` — ARM A's 0-byte record is now closed,
  which is the delta this arm existed to measure.

### ARM D — the negative control holds.

One environment difference from ARM C: `MPD_DSH_TUI_HOST_ROOT=/nonexistent/mpd-host-root`, which pins the
host-root candidate list away from any real install, so the host-internals import is unavailable.

* `failures: []` — **the boot still SUCCEEDED**, and the chat screen rendered: the boot pane carries
  `mpd: 团队 fidelity-cjk-dag 4·2/7 · 计划 0 · workmate 1`.
* the keeper reported, verbatim:
  `mpd-tui panel enable keeper: absent — no candidate carried a readable lib/types/tuiDisplayPrefs.js (1 probed); 0 write(s) over 6 tick(s); ids act1:team,act1:dag,act1:workmate`
  **`absent`, never a throw, never a silent success, and 0 writes.**
* the host's registry still carried our ids (`act1:team`, `act1:dag`, `act1:workmate`), so REGISTRATION was
  unaffected; the enable list was simply not repaired.
* `csvEvents` ends at `todo,jobs,agents`; `mpdTabSeen: false`; the settled bar is `‹ 待办 › ▸ ◆` and nothing
  else. Same code, same revision, one env difference: the tabs are there in C and absent in D, which is
  what makes C falsifiable rather than asserted.

## ARM C and ARM D re-verified across a REBUILD

The TUI lane landed two further fixes after the first C/D capture, so `packages/mpd-tui-plugin/dist/index.js`
— the copy that carries this keeper through the inlined adapter — changed. Both arms were therefore re-run
against the new build, with the same sandwich discipline.

| arm | build sha256 (`packages/mpd-tui-plugin/dist/index.js`) | captures |
|---|---|---|
| first run | `5318b500dc222b7f56d69f23ccf64a8ebcc697e7ae315644d40f8d0c4f640cdb` (385962 B) | 16:26:57Z → 16:27:51Z (C), 16:27:59Z → 16:28:53Z (D) |
| re-verified | `00e82b38fc37d13d9b1aa99dbd239a970333264a7bbeb268d65a663fa6f9ed23` (386256 B) | 16:44:32Z → 16:46:21Z (both arms) |

`packages/mpd-tui-adapter-plugin/dist/index.js` was unchanged between the two builds
(`ca40ecefa0282a7795d23724a759ebb3757eb458832ae245316c9450eae60d2c`), and `grep -c keepPanelEnable
packages/mpd-tui-plugin/dist/index.js` still answers **3**. The adapter's own source did not change, as
expected — which is what makes an identical reading informative rather than surprising.

**The readings are IDENTICAL.** ARM C: `settledEnabled=true`, `mpdTabSeen=true`, `settingsFilePresent=false`,
`failures=[]`, the same five `csvEvents` ending in the keeper's single re-assert
(`todo,jobs,agents` → `todo,jobs,agents,act1:team,act1:dag,act1:workmate`), the same settle line
(`1 write(s) over 6 tick(s)`), the same id record `["act1:team","act1:dag","act1:workmate"]`. ARM D:
`failures=[]`, the chat screen rendered, the keeper `absent` with `0 write(s)`, `csvEvents` ending at
`todo,jobs,agents`, `mpdTabSeen=false`.

Stronger than either run alone: the same behaviour is now measured across two independent builds of the
dist that carries it, which rules out a coincidence of one build's bytes.
