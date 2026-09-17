# Lane A2 (t13) — evidence index: hold lifecycle, PARKED derivation, pause union, knob divergence

Task `t13` — contract §6 (T-16, T-17), §7.2/§7.3, §8 (T-19, T-20) of
`.mpd/plans/watchdog-redesign-contract.md` (frozen; §0 amendments win over the body).

## Decisive artifacts

| Artifact | What it proves | Decisive line |
|---|---|---|
| `20260917T020000Z/result.json` + `output.log` (`rows-bf-driver.mjs`) | §9 rows **(b)** and **(f)** FAIL on the RED worktree and PASS on the new tree, per row, on SETTLED hashes | `DRIVER RESULT: PASS — every row fails RED and passes GREEN on settled hashes` |
| `20260917T020000Z/gates` readings below | the three `verify` commands | see "Gates" |

Row readings (each tree driven by its OWN modules, identical scenario, injected clock):

| Row | RED (`.mpd/red-baseline`) | GREEN (this tree) |
|---|---|---|
| **(b)** member whose only open tasks are dependency-blocked | `FAIL`: `91000:warn, 181000:warn, 271000:escalate` + **hold on disk** — a team that is merely WAITING is paused | `PASS`: every tick empty, no hold, `dependencyParked=4`, and the fold separately reports `a1: OUTSTANDING` — so the suppression is the DERIVATION, not the fold |
| **(f)** only evidence is a previous generation's stamp (empty `attemptId`, one day old, record created 30 min before the run) + a task nobody attempted | `FAIL`: `1000:warn, 2000:warn, 3000:escalate` + **hold on disk** — the pre-`createdAt` stamp holds the team | `PASS`: every tick empty, no hold, `neverStarted=1` (the report that never holds) |

Settled: the measured fingerprints are identical before and after a 50 s window, the RED tree
matches the contract's frozen `fc10fc41…`/`f529ca2c…`, and it carries **no** `channel.ts`.
Green fingerprint at the settled reading:
`machine=ce8bd54c…`, `engine=47c24bd6…`, `channel=b9d7acaf…`, `team=c3f49511…`, `tools=aca511e2…`.

## Gates (captured 2026-09-17T01:46–01:48Z)

| Command | Result |
|---|---|
| `bun test packages/mpd-team-watchdog-plugin` | **127 pass / 0 fail** (609 expect() calls, 24 files; was 107 → +20 new in `test/holds-lifecycle.test.ts`) |
| `bun run typecheck` | **exit 0**, zero diagnostics, zero in this package |
| `(cd packages/mpd-team-watchdog-plugin && bun run build)` | exit 0, `dist/index.js` sha256 `ddb30834942b3b4f755ab88adc1507a3f45b3c5268839c61544471d5eddcd53e` |
| `bun run verify:docs` | PASS (pairs=37 failed=0 violations=0) |

## Changed files (sha256)

| File | sha256 |
|---|---|
| `src/config-file.ts` (NEW) | `c1c40153c3474528b57268c0144edfffdfcc6fb3ed71744dc7a24d95f4c4f774` |
| `src/machine.ts` | `ce8bd54cba5164dec1740b6a7d0e0d1a55eb3f8d675d0a4010675f30ff0b9a41` |
| `src/team.ts` | `c3f495118d547abb7b658062b9b118430ca24861e9ae404688d37a34e1eb0168` |
| `src/engine.ts` | `47c24bd678ae45e0655c10373d1e64655b495c1ba8f136a66e44eda38c177694` |
| `src/actions.ts` | `4b568d5dcd266243382af62eaed19954bcf96bc81adeebf563873ebbe8e2bb50` |
| `src/sidecars.ts` | `febae8f4a2debc73f5dd85bfa40d30250eef2edd7dfbc033ee958332dd1a1358` |
| `src/holds.ts` | `c66f0ffc55af41f6157fdad11b3736b6e9b3bad73667d6dcf0dd64d0eaf42471` |
| `src/index.ts` | `80c1b014d002421e94f43e36a5be0bcfef626c85d6ca1c87971698a29b7fd72a` |
| `dist/index.js` | `ddb30834942b3b4f755ab88adc1507a3f45b3c5268839c61544471d5eddcd53e` |
| `test/holds-lifecycle.test.ts` (NEW, 20 cases) | `e68545e5cbd073a7bc0ee5f7554e90e8a0a11eed0141119d9a9787d6d830b3a3` |
| `test/support.ts` | `b6783b06298c0b73053b93b56a5935430cf8b9a5ac8b00b9cf6e4ca419d7a33a` |
| `README.md` | `bd887558cdc833db0bae1e3c8a1a6a0ea130636c0d7dbb8447f01b9044d24793` |
| `README.zh-CN.md` | `a5cd1023620e9ba698c2c5e2f2d8d0beeba4d58fb951a9a235e61dafe54a6a4b` |

## How each contract clause is satisfied (and where it is pinned)

* **T-16 (§6)** — `machine.ts` `generationFloorOf` + the floor inside `candidateFor`'s SILENCE slice
  (`forTask`). The bound lands there and NOT on the dispatch disjunction, and an absent
  `createdAt`/`approvedAt` stays permissive: §0/A3's ruling, which is what keeps the r7 pin
  (`test/dispatch-precondition.test.ts:157-172`) green — verified in the same 127-test run.
  RED-first is the driver's row (f): the same shape holds a team on the RED tree.
* **T-17 (§6)** — `HoldRecord.ttlMs` (legacy files read as 0), `applyHold`'s explicit/default TTL,
  the engine's `autoReleaseHolds` pass (TTL | activity, reading the hold FILES so an un-hydrated
  reader still releases), one durable `hold-auto-released` incident per release with
  `cause.release`, one log line, and `team.json` byte-identical before/after (asserted for both
  paths). The pass runs at the head of every tick.
* **T-19 (§8)** — `session-watchdog-status` prints the union and names the active mechanism in the
  rendered text and as a per-team `pause` object in the JSON; no new verb exists (asserted: the
  action surface is exactly hold/resume/status).
* **T-20 (§8)** — `TeamTask.dependencies` in the projection + `dependencyBlocked` + the PARKED
  override in `engine.candidates()`, applied BEFORE every channel question (so a blocked member
  never falls into the §4 report-only path either). No new member-facing tool.
* **§7.2/§7.3** — `knobReadings` (pure) + `readWatchdogSection` (tolerant JSONC, workspace file,
  never `DSH_HOME`) + the engine's once-per-process `KNOBS DIVERGE (§7.3)` warning and the status
  view's per-knob `live` / `file` / `restartRequired`.

## Bound on this evidence

* The rows run the REAL engines of both trees against synthetic records, stamps and event streams
  with an injected clock; they are not recordings of a live team. The permanent pins for the same
  behaviour (plus the pure-unit level) are `test/holds-lifecycle.test.ts` and the T-19/T-20/§7.2
  cases inside it.
* The typecheck reading is the attribution style the captain asked for: total error count, the
  per-file breakdown, and the count inside `packages/mpd-team-watchdog-plugin` (0 at this reading;
  no foreign file was edited by this lane).
* `test/support.ts` gained `deadTeamGraceMs` because the fixture was missing a required
  `EngineConfig` key: with a `createdAt` in the record the r4 grace path becomes live, and an
  `undefined` grace made every such team read as "dead". `engine.liveness` was hardened in the same
  change to treat a missing/non-finite bound as `0` (tick everything) — a watchdog that stops
  observing is the one failure this package exists to prevent.

---

## Rulings and carry-forward (recorded 2026-09-17 after t13's acceptance)

Three items from this lane's acceptance that outlive the task — recorded here so wave 2 can act on
them even if the team is archived and the mailbox is gone.

1. **`dependencyBlocked`'s reading is KEPT as implemented** (captain's ruling): a dependency id
   naming a task ABSENT from the record counts as UNFINISHED — "what cannot be shown finished is
   not finished". A false wedge costs more than a late report, which is also why `warn-only` is the
   §3 default; flipping it would additionally invalidate the four fingerprints this lane's verdict
   is anchored to. **Carry-forward `T-64` (wave 2, new scoped change + its own test): an
   UNRESOLVABLE dependency is a THIRD state, not "unfinished"** — it deserves its own
   record-integrity report naming the missing id, because parking hides the corruption while a
   silence warning blames the member.
2. **Two invariants this lane measured, worth quoting in the wave report:**
   * *"I have no bound" must never become "I watch nothing".* A REQUIRED `EngineConfig` key
     (`deadTeamGraceMs`) was missing from the test fixture — invisible because tests live OUTSIDE
     the root tsgo program — and its effect only appeared once `createdAt` activated the r4 grace
     path, where `age <= undefined` silently made EVERY team read as dead. Fixed on both sides:
     the fixture states `86_400_000`, and `engine.liveness` treats a missing/non-finite bound as
     `0` (= tick everything).
   * Same family as t8's latent defect: `resolveConfig`'s `actionOnEscalate` comparison had to be
     inverted to `=== "pause" ? "pause" : "warn-only"`, or an explicit `pause` is silently
     discarded once the default stops being `pause`.
3. **Fingerprint discipline (what makes this a verdict rather than an anecdote):** the §9 rows (b)
   and (f) verdict is anchored to `machine=ce8bd54c…`, `engine=47c24bd6…`, `team=c3f49511…`,
   `tools=aca511e2…` on settled hashes (identical before/after the 50 s window). **Any later edit
   to those files invalidates the driver: it must be RE-RUN, never reinterpreted.** The same rule
   applies to the t8 evidence index (`../core/SUMMARY.md`), whose table and its **Revision
   boundary** note pin the t8 revision, and to the artifact: `dist/mpd-package/` (packed
   09:38:54–55 local) is stale for six `packages/**` files and only a byte-identity check
   (`diff -rq`, not presence/name) catches that class — t28's job, on a re-packed settled tree.

### t28 artifact-check checklist (captain-approved 2026-09-17; recorded here because t28's own evidence dirs are not writable until it is claimed)

Sequence, in order, on a **re-packed settled tree**:

1. **Re-pack AFTER the last writer of any copied tree** (`t40` was terminal at 01:33Z; the on-disk
   artifact's pack is 01:38:55Z → no pre-`t40` risk for it, but its six stale `packages/**` files
   are why the re-pack is mandatory). If any dependency rebuilds after my pack, the verdict states
   the bound instead of calling the artifact final.
2. **Closure checker**: `node scripts/verify-pack-closure.mjs` exit 0.
3. **Byte-identity per group** (`diff -rq <source> <artifact>`, recording every exit code and line
   count): `docs/`, `templates/`, `agent-references/`, **`packages/**`** (the captain's ruling
   extended the instruction to this group — it is the ONLY form that catches content-stale copies,
   and lane A's own t13 outputs are three of the six measured stale files), plus `skills/`,
   `presets/`, `extensions/`, `scripts/` and the root README pair. Any differing line that is NOT
   an intentional packed-form rewrite (`package.json`, `cordis.patch.yml`, the `validator.js`
   shim) is a FINDING.
4. **Four packed CLI commands** executed INSIDE the packed tree.
5. **Packed `--root` docs parity measured AFTER the re-pack** (expect 35/35); repo
   `bun run verify:docs` stays at **pairs=37** unchanged.
6. **Seeded-omission control on a byte-copy of the REAL artifact** for the `REFERENCES` group
   (delete one `agent-references/*` file, expect exit 1 naming it and the `REFERENCES` kind), and
   record the full finding list, noting that the set-equality leg is expected to fire too.
7. **RED source**: `git archive HEAD` (`646d8018a44bffb2d6e1c30afa090056f81b911e`, pre-wave base;
   `dist/` committed there so no build step) — t11's evidence holds NO artifact copy. The packed
   CLI must be run from inside the packed tree: `mpd-ext-plugin/src/registry.ts` exists in HEAD,
   so the RED is the packer shipping `dist/` only, not a missing source file.

**Wave-level rule this lane measured into existence:** the artifact must be packed after the LAST
writer of any copied tree, and a packed check that ran earlier is valid only for the revision it
measured — the 01:38:55Z artifact is superseded and must never be cited as final.

**Generalized in the wave record (captain, 2026-09-17):** *an evidence table is revision-bound
exactly like a packed copy.* The t8 index's `machine.ts fbe2db0b…` (t8) → `ce8bd54c…` (t13) move,
with the six §3 VALUES unchanged, is the same class as a stale packed copy — handled by a boundary
note naming the revision each row belongs to, never by silently updating a number. This is what
makes the four green fingerprints above meaningful rather than decorative.

### t28 byte-identity leg — tooling (peer-supplied, reproduced) + a THIRD leg the wave did not have

**Directional check (packaging-engineer's script, reproduced by lane A 2026-09-17):** for every file
IN the artifact, the source counterpart must exist and be byte-identical, with exactly three
generated files allowlisted by name — `package.json` (packed-form manifest), `cordis.patch.yml`
(decoupled patch), `packages/mpd-ext-plugin/dist/validator.js` (generated sidecar). A naive
`diff -rq packages dist/mpd-package/packages` is NOT the check: the artifact intentionally omits
`packages/*/src`, tests and similar, so it floods with "Only in …" noise.
Reproduced readings on the 09:38:55 pack: `compared=1183`, `not_in_source=0`, and the allowlist is
justified (all three differ from source). **The drift COUNT had moved from the peer's 6 to 32** —
the same six files plus **26 `skills/dsh-qa/scripts/*.mjs`** written by the QA lane at 09:57:20
(mid-`t17`). Not a tooling discrepancy: the artifact ages in real time, which is why the re-pack
must precede the check.

**THIRD leg — completeness (missing artifact files), added here because neither existing check sees
it:**
* the directional check cannot: it walks the ARTIFACT, so a source file with no counterpart is
  invisible;
* the closure checker cannot: set-equality runs over `docs`+`templates`+`agent-references` ONLY
  (`scripts/verify-pack-closure.mjs:256`), so `skills/**` is outside it, and the checker never
  compares content at all (verified: **0** occurrences of `createHash`; its `readFileSync` calls
  read the manifest, the packer, the patch and the CLI — T-63 confirmed precisely).
* **Live instance:** `skills/dsh-qa/scripts/lib/credentials.mjs` (22387 B, written 09:55:39) is
  ABSENT from the artifact. That is not a packer defect (the file did not exist at pack time) — it
  is the proof that a shipped file can be missing from a packed tree with both existing legs
  reporting clean.
At t28 the completeness leg is: for every SOURCE file matched by the packed manifest's `files`
patterns, an artifact counterpart must exist — asserted, not assumed.

---

## `T-65` (wave 2) — artifact COMPLETENESS, with the live instance (captain-accepted 2026-09-17)

**Registered:** the packing closure should assert **source → artifact completeness for every shipped
`files` pattern**, not only for the three asset groups. It joins `T-61`–`T-64` in the register rows
`t35` carries into `.mpd/TODO.md`.

**The live instance that proves the gap** (measured by lane A): `skills/dsh-qa/scripts/lib/credentials.mjs`
(22 387 B, written 09:55:39) is ABSENT from `dist/mpd-package/`, while BOTH existing checks report
clean — because
* the directional content check walks the ARTIFACT, so a source file with no counterpart is invisible
  to it, and
* the closure checker's set-equality loop covers `docs`+`templates`+`agent-references` only
  (`scripts/verify-pack-closure.mjs:256`) and never compares content at all (**zero** `createHash` in
  the file — its `readFileSync` calls read the manifest, the packer, the patch and the CLI).

### `t28`'s THREE legs, each reporting its OWN reading — the methodological rule

> **a clean leg cannot lend credit to an unchecked one.**

| Leg | Question it answers | Tool |
|---|---|---|
| (a) directional content equality | is every file IN the artifact byte-identical to its source? | the python walk + the three generated-file allowlist (`package.json`, `cordis.patch.yml`, `packages/mpd-ext-plugin/dist/validator.js`) |
| (b) presence / name / set equality | is every file the artifact CLAIMS to ship actually there, and is the `REFERENCES` group complete? | `node scripts/verify-pack-closure.mjs` + the seeded omission on a byte-copy of the real artifact |
| (c) completeness (NEW, `T-65`) | does every SOURCE file matched by the manifest's `files` patterns have an artifact counterpart? | to be written at `t28`; the register row carries the instance above |

### Ordering (measured, not assumed)

The artifact must be packed after the **LAST writer of any copied tree**: the re-pack therefore
follows `t17` (the QA lane, the wave's single `skills/**` writer — 26 drifted `skills/dsh-qa/scripts/*.mjs`
at 09:57:20) as well as `t23`/`t43`. Trivially: a clean leg recomputes its OWN counts at its own
revision — `t28` re-measures rather than inheriting 6 (the packaging lane's baseline), 32 (mine,
minutes later) or any number anyone quotes.

### CORRECTION to the `T-65` leg above — the completeness reading must be SCOPED (measured, packaging-engineer's finding, reproduced by lane A)

The wording "every source file matched by the manifest's `files` patterns" is **BORN BROKEN** — the same
shape as the glob rule `verify-pack-closure.mjs`'s own header rejects for `PLUGIN_PKGS`. Measured on the
current tree, both forms side by side:

| Reading | Result |
|---|---|
| naive `files`-pattern completeness (my original wording) | **235 files flagged** — `packages/**` 216+ (intentionally-absent `src/`, tests), `scripts/` 17 (only `install-mcp.mjs` + `mpd-ext.mjs` ship, so `scripts/**` describes the PACKED scripts dir, not the repo's), `skills/` 1. Noise that would drown the one true positive. |
| **wholesale groups only** (the correct scoping) | `skills/` **1** (`skills/dsh-qa/scripts/lib/credentials.mjs`), `presets/` 0, `extensions/` 0, `docs/` 0, `templates/` 0, `agent-references/` 0 |

So the `T-65` row must read: completeness applies to the **wholesale groups** — `skills/`, `presets/`,
`extensions/`, `docs/`, `templates/`, `agent-references/` — of which three (`docs`, `templates`,
`agent-references`) ALREADY have set-equality in the checker, so the genuinely new part is extending it
to `skills/`, `presets/`, `extensions/`. For `packages/**`, completeness cannot come from the `files`
glob at all: it must be derived from the **packer's own copy rules** (dist trees, launcher closure,
README pairs, declared asset dirs, the wholesale adopted plugin, `mpd-mcp-shared` minus `*.test.mjs`,
`client.js`).

**Two framing rules, both required in the `t28` report** (otherwise the leg misclassifies its findings):
1. The live `credentials.mjs` case is a **DRIFT** finding, not a packer omission — the file did not exist
   at 09:38:55, so the wave report must NOT record it as a missing-file defect in the packer.
2. A wholesale-group absence is **ambiguous between drift and omission** until a pack-time record exists;
   that is what `T-63`'s self-consistency map buys — `not-in-map` = drift, `in-map-but-absent-from-the-tree`
   = internally broken, i.e. two different remedies. **The third leg alone cannot classify its own
   findings** — which is itself an argument for landing `T-65` with the map, not instead of it.

**FINAL RULING (captain, 2026-09-17) — recorded verbatim so `t28` builds THIS and nothing wider:**

* **leg (c) = completeness over the SIX WHOLESALE-COPIED GROUPS ONLY** — `skills`, `presets`,
  `extensions`, `docs`, `templates`, `agent-references` — where the intent is "the whole directory
  ships". Today five are complete; `skills` is missing exactly one file
  (`skills/dsh-qa/scripts/lib/credentials.mjs`, 22 387 B, 09:55).
* **For `packages/**` there is NO source→artifact completeness leg.** Completeness there derives from
  the packer's COPY RULES (dist + the named asset dirs + the adopted plugin's whole-tree-minus-tests),
  which the checker's own asset table already asserts; leg (a) plus those rules govern that tree. Do
  NOT build a glob-shaped completeness check for it — that is the born-broken reading covered above.
* **leg (a)** = directional content equality over the artifact, three generated files allowlisted.
  **leg (b)** = presence/name/set equality for the three asset groups + the `REFERENCES` seeded
  omission on a byte-copy of the REAL artifact.
* Each leg reports its OWN reading independently: **a clean leg never lends credit to an unchecked one.**
* The `T-65` register row and the plan's `L46` are corrected by the captain to exactly this scope.

### The completeness count is EXPLAINED, not just observed (three datapoints, verified by lane A)

| Moment | naive `files`-pattern form | wholesale form | what moved it |
|---|---|---|---|
| ~10:0x (packaging lane) | **231** (`packages` 216, `scripts` 14, `skills` 1) | 1 (`skills`) | — |
| ~10:1x (lane A) | **235** (`packages` 217, `scripts` 17, `skills` 1) | 1 | the wave's own gate scripts landing |
| ~10:1x (packaging lane, again) | **235** | 1 | same |
| ~10:2x (lane A, latest) | **235** | 1 | growth paused with the writers |

Verified cause of the +4: `scripts/verify-dist-fresh.mjs` (10:14:25), `scripts/repin-vendor.mjs`
(10:14:50) and `scripts/dump-config.mjs` (10:12:34) are **repo-side** — the artifact ships only
`install-mcp.mjs` and `mpd-ext.mjs` from `scripts/`, so all three are `(repo-side)` in the packed tree
— plus one package-side file. That is why the naive count grows while the SCOPED count stays **1**
(`skills/dsh-qa/scripts/lib/credentials.mjs`): a second, independent argument for the scoping and for
the rule both lanes now keep — **never trust 6, 32, 231 or 235, not from anyone; only `drift==0`
measured AFTER the re-pack counts, with every number quoted next to its measurement moment.**
