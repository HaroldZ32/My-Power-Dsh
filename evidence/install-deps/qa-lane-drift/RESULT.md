# t9 — Register the unlisted `ulw-command` QA lane (drift gate red since 2026-09-18)

**Author:** Deep Worker (team `mpd-install-deps`, task `t9`, attempt 1). **Kind:** implementation.
**Mode:** the lane was RUN for real before anything was registered; no repair was attempted.

## 0. Verdict

`skills/dsh-qa/scripts/ulw-command.mjs` **PASSES** (`[ulw-command] PASS`, exit 0) on a real boot, so the lane
was registered in `skills/dsh-qa/cases.json` exactly like its siblings. `run-qa-lanes --check-drift` went
from **exit 1** ("1 lane script(s) on disk in no manifest entry") to **exit 0** ("manifest and disk agree
(54 entries, 48 lane script(s) discovered)"), and `--list` now shows the lane in the `all` suite.
The lane's own script is **byte-unchanged** (sha256 identical before and after).

## 1. What the script is (read, not assumed)

`skills/dsh-qa/scripts/ulw-command.mjs` (605 lines) is a **live-boot** case of the same class as
`ultrawork-smoke` / `plan-c-smoke` / `memory-smoke`: it boots a real `dsh` in an isolated sandbox,
answers the model step with the LOCAL OpenAI-shaped stub from `extension-isolation.mjs`
(`apiKeyEnv` is a stub literal, so no provider credential is read), and asserts from the harness's own
session log (`lib/session-evidence.mjs`) — never from model prose:

- `/ulw` and `/ultrawork` are registered in the LIVE command registry and execute through
  `commands.execute()`;
- an EMPTY invocation settles `kind: "error"` with the usage line;
- a NON-EMPTY invocation settles `success` and records the ULW activation directive as a user-role
  message of the invoking session;
- the headless plain-text `/ulw <objective>` gesture injects the same directive with **zero**
  `command/run` records.

It carries a `// PREREQ: absent-dsh-binary dsh …` header line and calls the shared `gatePrereqs`; the
manifest entry therefore declares **no** `prereq` array (the siblings do not either, and the runner's
`--no-skip` semantics would turn a wrong prereq into a false FAIL).

## 2. Hash lineage (UTC instants are the measurement moments)

| Artifact | When | sha256 |
|---|---|---|
| `skills/dsh-qa/cases.json` | 2026-09-20T03:42:08Z (read before the edit) | `939cd652bc4e927757541468cb65d6b8f75782b3471266f87c2b15e71eb1b51d` |
| `skills/dsh-qa/cases.json` | 2026-09-20T03:43:08Z (after the edit) | `646e16d2518d8f95d6efe3ffff641838f3ccd678da8211ce2af43cd79da8b381` |
| `skills/dsh-qa/scripts/ulw-command.mjs` | 2026-09-20T03:42:08Z | `5e03eec31c685370da69f75c08c047a8e2c7ce5591e73564372b3924a94add5f` |
| `skills/dsh-qa/scripts/ulw-command.mjs` | 2026-09-20T03:43:08Z (must equal the above) | `5e03eec31c685370da69f75c08c047a8e2c7ce5591e73564372b3924a94add5f` |

Raw: `before-hashes.txt`, `after-hashes.txt`.

## 3. Step 2 — RUN the lane (raw output, exit code)

```
$ node skills/dsh-qa/scripts/ulw-command.mjs
[ulw-command] ok=true -> /root/dshProj/my-power-dsh/evidence/dsh-qa/ulw-command/2026-09-20T03-42-12.956Z
  install: {"ok":true,"exit":0}
  artifact: {"ok":true,"sources":{"mpd-dsh-adapter":{"source":"shipped",…,"missingInShipped":[]},"mpd-ulw":{"source":"shipped",…,"missingInShipped":[]}}}
  shippedComposition: {"ok":true,"problems":[],"listing":["agent-teams","agent-teams-mpd","compact","feedback","goal","mpd","permission","plan","ultrawork","ulw"],"usage":{"kind":"error","text":"usage: /ulw <objective> (alias: /ultrawork <objective>) — starts an autonomous ULW run for that ob…"}}
  gesture: {"ok":true,"problems":[],"gating":true,"finding":null,"rewritten":true,"clauses":["triage","gate","team","loop","fixOnSight","closeOut"],"numbered":6,"commandRuns":0,"objectiveSeen":true}
  stubServed: {"ok":true,"requests":5}
  workspacesSandboxed: {"ok":true,"sandbox":"/tmp/mpd-ulw-command-FRW9Kc","gatedWorkspace":"/tmp/mpd-ulw-command-FRW9Kc/ws-shipped"}
  equivalenceTableTools: {"ok":true,"observed":true,"toolCount":103,"missing":[]}
  gatedProblems: []
[ulw-command] PASS
EXIT=0
```

Full capture: `lane-run.log`. The marker printed is `[ulw-command] PASS` (no `[mpd-qa] SKIP`/`FAIL`
marker), and the lane's `result.json` records `"ok": true` with steps
`install / artifact / shippedComposition / gesture / stubServed / workspacesSandboxed /
equivalenceTableTools / gatedProblems` all ok.

### 3.1 Evidence relocation (scope discipline, stated honestly)

The lane's own evidence writer targets `evidence/dsh-qa/ulw-command/<utc-stamp>/`, which is **outside**
this task's declared scope (`skills/dsh-qa/cases.json`, `evidence/install-deps/qa-lane-drift/**`). The
new run's directory (`2026-09-20T03-42-12.956Z`, pre-existing sibling `2026-09-18T02-25-31.584Z` left
untouched) was therefore copied **byte-for-byte** into
`lane-evidence/2026-09-20T03-42-12.956Z/` and the out-of-scope copy removed, so the run's proof is kept
inside the declared scope and no file outside it remains changed:

```
108700c71533efa8c866ee04e835fe3ce8fc954258dcf0982c2f919620ac0bef  ./output.log
383307a28ac4d4771ac6f4527a44af86de6638a097c78f0732b51948b7c173a5  ./raw/arm-gesture.session.decoded.jsonl
f7b4f3cdf34e59541a4f88a918488ba1c0dd2bc5c3e17ec41bbd9fa3ef64426e  ./raw/arm-gesture.session.jsonl.zstd
3742882fc734fe096c4283b5e482e54d1ffaa996a5a9ec0176cf6c5adfc6bb7e  ./raw/arm-shipped.session.decoded.jsonl
252fc5db9bbd9322aac6ea5919a9b1be9a12eae2e7af5921b0b25a398ed0e6f6  ./raw/arm-shipped.session.jsonl.zstd
999fa2f06d51a9bf3ad32b3610767d4d43ce0dcf2c72aa6c7df20f09dbd7cf20  ./result.json
```

(`lane-evidence-sha256.txt`; `git status evidence/` afterwards shows only the in-scope
`?? evidence/install-deps/` root.)

## 4. Step 3 — the registration (exact diff)

Reconstructed start-of-task file (`cases-before-t9-reconstructed.json`, produced by filtering the one
entry out of the current JSON — the repository file was never rewritten for this) vs the current file:

```diff
@@ -387,6 +387,14 @@
       "outsideSuites": "DSH-TUI edition lane: needs the dsh-tui binary, tmux and a TUI sandbox profile — run it explicitly: node scripts/run-qa-lanes.mjs --only=tui-team-surface"
     },
     {
+      "case": "ulw-command",
+      "script": "skills/dsh-qa/scripts/ulw-command.mjs",
+      "suites": [
+        "all"
+      ],
+      "immutabilityGuard": "exempt: no caller-supplied output target — the evidence dir is derived internally from a <utc-stamp> path, so a caller cannot point this lane at an existing directory"
+    },
+    {
       "case": "ultrawork-smoke",
       "script": "skills/dsh-qa/scripts/ultrawork-smoke.mjs",
       "suites": [
```

Raw: `cases-t9.diff`. The entry shape is byte-identical to its three siblings (`ultrawork-smoke`,
`plan-c-smoke`, `memory-smoke`): `case`, `script`, `suites: ["all"]`, the standard `immutabilityGuard`
exempt string, **no** `prereq` and **no** `outsideSuites` — it is a live-boot case of the same class,
not a lane deliberately outside every suite. Alphabetical position (between `tui-team-surface` and
`ultrawork-smoke`) is preserved.

## 5. Step 4 — the gates (raw output, exit codes)

Before (`drift-before.log`), captured at 2026-09-20T03:42:08Z:

```
$ node scripts/run-qa-lanes.mjs --check-drift
[run-qa-lanes] drift: 1 lane script(s) on disk in no manifest entry: skills/dsh-qa/scripts/ulw-command.mjs
[run-qa-lanes] discovery: 48 lane script(s) discovered (47 listed, 1 unlisted, 19 outside every suite); .mjs entries 48, underscore-excluded 0
[run-qa-lanes] immutability required=10: … exempt=37
exit=1
```

`--list` before: the lane appeared only under `drift unlistedScripts (1)` (`list-before.log`).

After (`drift-after.log`):

```
$ node scripts/run-qa-lanes.mjs --check-drift
[run-qa-lanes] discovery: 48 lane script(s) discovered (48 listed, 0 unlisted, 19 outside every suite); .mjs entries 48, underscore-excluded 0
[run-qa-lanes] immutability required=10: … exempt=38
[run-qa-lanes] manifest and disk agree (54 entries, 48 lane script(s) discovered) and the immutability guard is declared
exit=0
```

`--list` after (`list-after.log`, line 44):

```
ulw-command	lane	all	skills/dsh-qa/scripts/ulw-command.mjs
```

## 6. Scope

Changed: `skills/dsh-qa/cases.json` (the one inserted lane entry) and
`evidence/install-deps/qa-lane-drift/**`. Nothing else: `skills/dsh-qa/scripts/ulw-command.mjs` is
byte-identical (hash table §2), the lane's out-of-scope evidence byproduct was relocated into this
directory (§3.1), and no `docs/**`, `packages/**`, `scripts/**` or `README*` file was touched.
The lane was registered, never repaired — any repair stays a separate captain decision.
