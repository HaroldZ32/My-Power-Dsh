# t34 — mpd settings bridge design (`mpd` settings namespace ↔ `.mpd/mpd.jsonc`)

Task `t34` (work / design), member **Architect** (read-only role: the ONLY writes are the files in
`evidence/mpd-bridge/design/`, granted by this task's `inScope`). Attempt id
`767661e6-a36e-4d8d-8073-4bf5b698f51e`. **Design only — no source is edited by this task.**

Source material: the Researcher's dossier
`evidence/mpd-bridge/requirements/20260915T074601Z/HOST-SEAMS.md` (verdict pass), cited inline as
**[DOSSIER p.N]**, plus first-hand reads of this repo and the installed host packages.

Labels: **[MEASURED]** = verified against bytes on disk, with a path. **[DECIDED]** = my design choice.
**[UNVERIFIED]** = a claim a later lane must measure; never a load-bearing assumption.

The captain's four dispatch inputs are answered in order at the top: §A (workspace identity / the honest
target rule), §B (**refuse rather than corrupt**, incl. the full JSONC edge-case matrix), §C (the web
card must be exercised from a LOOPBACK page, with the honest evidence level here), §D
(`applies: 'restart'` — which knobs are live, which need a restart, and what the hints must say).

---

## ERRATUM — t40 (2026-09-15): the last surviving "fan-out" sentence

**What changed.** §7 item 3 carried a stale sentence from the FIRST draft of this design. It is corrected
in place (struck through, original wording kept visible below) and recorded here so a reader can see
exactly what changed and on whose authority.

**The superseded sentence, verbatim as it stood:**

> 3. **Fan-out is real:** one settings document + N live workspaces ⇒ one edit writes N files, reported
>    per root.

**The governing rule (this is the answer every other section already gave):** with **N > 1 live session
workspaces the target is ambiguous, so the write-back REFUSES** with reason `ambiguous-multi-root`, names
every candidate root, writes **no** file, and tells the user how to make the target unambiguous. There is
**no fan-out** in this design.

**Governing sections and entries:** §A.1 (the three-cardinality table), §3 (Workspace selection),
§10.3 (refusal conditions), **D-5** (decision log), **U14** (the unit test that must fail if any fan-out
or single-root pick is implemented) and **F5** (the falsifier for two live roots). The refusal rule was
introduced as **D-12** when the contradiction with the implementing task's acceptance (t35 A3 — "never
silently write to a guessed path") was found by the implementer reading that acceptance at source; the
captain's ruling settled the ambiguity on the REFUSE side, and the implementation matches REFUSE.

**Authority.** Captain ruling of 2026-09-15 (message `c8a03ba6`), which resolved the disagreement between
this design's first-draft fan-out and t35 acceptance A3 in favour of REFUSE. The implementation in
`packages/mpd-config-plugin` already behaves this way, so this erratum aligns the DESIGN RECORD with the
code and with the acceptance, and changes nothing else.

**Scope of this erratum.** One paragraph in §7 plus this block, plus the matching entry in `result.json`.
No other part of the design is revised — the implementer is working against the current text and a broad
rewrite would invalidate work in flight.

**Digests.** `DESIGN.md` pre-erratum
`2e990f1b750f2081230fec4128c84816ed20548cc9b50690d099576798f139eb`. Post-erratum, a *verifiable payload
digest* is recorded instead of the file's own hash, because a file cannot contain its own SHA-256:
sha256 of this file with the digest below replaced by 64 `1` characters =
`3d8cd3c0211f615154348a6c03347a7fd0141ac90263a80df1afbe91639cd339` (recompute that way to verify).

---

## A. The write-back target is a DECISION (input 1)

**[MEASURED]** The settings path carries **no** workspace identity: the service API and provider take
`(ns, …)` only; every `settings/*` wire signature is namespace-only; **both** change events
(`settings/updated`, `settings/document-updated`) carry `(ns, …)` and nothing else; the client's
locality is loopback-vs-remote, not workspace [DOSSIER pp.139-157]. So *which* `.mpd/mpd.jsonc` to write
is a decision this design must state with its failure mode.

### A.1 The decision

**[DECIDED] The target set is the set of DISTINCT LIVE SESSION WORKSPACE ROOTS at event time, obtained
through the adapter's existing `dsh.workspaceRootsAll()`** (union of live session cwds, `[]` when the
agent registry is absent) [MEASURED: `packages/mpd-dsh-adapter-plugin/src/index.ts:173,298,415`].

`workspaceRootsAll()` is the *only* honest attribution available: it answers "which workspaces does this
host currently serve?", which is a fact, rather than "which workspace did this user mean?", which the
event cannot tell us.

| Live roots | Target | Failure mode of this case | What the USER sees (loud, never a guess) |
|---|---|---|---|
| **0** | none — write no file | a Web edit with no live session has no workspace to write to | The settings edit still succeeds and the card says: **"saved to settings — not yet written to any `.mpd/mpd.jsonc` (no live session)"**, with the reason `no-live-session` and `writtenTo: []`. The bridge warns once. To make it unambiguous the user starts a session in the intended workspace. |
| **1** | that root | none | The card/TUI says: **"saved to settings and written to `<root>/.mpd/mpd.jsonc`"**. |
| **N** | **none — REFUSE**, write no file | the target is AMBIGUOUS: one host-global document, N candidate workspaces, and the event carries no identity to choose between them | The settings edit still succeeds and the surface says: **"saved to settings — NOT written to any file: N live workspaces, so the target is ambiguous. Candidates: `<root1>`, `<root2>`, … . To make it unambiguous, keep one session live, or edit that workspace's `.mpd/mpd.jsonc` directly."** Reason `ambiguous-multi-root` with the candidate list and `writtenTo: []`. One warning, never N writes. |

**[DECIDED] `process.cwd()` is NEVER a write fallback**, in any of the three cases.

**[DECIDED]** The three shapes the captain's dispatch names are applied literally: *"per-session
attribution where the event carries it"* is impossible because the events carry no identity
[DOSSIER §c]; *"silent best-guess"* (last-writer-wins, or a single guessed root) is the forbidden
outcome [DOSSIER p.165 R2]; and for every case where the target is not uniquely determined — **0 roots
and N roots alike** — the bridge **refuses, warns once with the concrete reason, and tells the user how
to make it unambiguous**.

**[DECIDED] Why refusal rather than fan-out for N roots — this rule was CHANGED from the first draft.**
The first draft fanned the edit out to all N files. That is rejected because it violates the binding
contract of the implementing task: t35 acceptance A3 requires the write-back to be loud on the
*ambiguous multi-root target* path and to "never silently write to a guessed path", so a fan-out — which
writes N files the user did not individually choose — fails the acceptance the design must serve. The
correct reading is that N candidates mean the bridge **cannot prove** which workspace the edit belongs
to, and an unprovable target is refused exactly like an unprovable key span (§B): the settings layer
keeps the value, no file is touched, and the diagnostic names every candidate so the user can make it
unambiguous. Consequence accepted and disclosed: on a host with several live sessions a front-door edit
persists to settings but not to a file until one workspace is live (or the user edits the file
directly); that is a visible, actionable state rather than a silent multi-file write.

**[DECIDED]** A session that starts **later** reads the file at its own mount/reload and therefore sees
the value through the file layer; no push is attempted.

**[UNVERIFIED]** Whether `workspaceRootsAll()` deduplicates and how it treats a session whose cwd was
deleted. The design is safe either way (a dead root fails loudly per §B.2/E11, and a duplicate changes
only the candidate list), but the implementation lane must pin it with a test.

---

## B. Refuse rather than corrupt (input 2)

**[MEASURED]** A comment-aware **reader** exists in this repo: the string-aware `stripJsonc` at
`packages/mpd-config-plugin/src/index.ts:22-48`, used by `parseJsonc` (`:50-52`), re-exported with
`deepMerge` (`:94`). `writeFileSync` is imported at `:8` and **never called** — the layer is a reader
today [DOSSIER pp.171-176]. **No comment-preserving JSONC editor exists offline**: no `jsonc-parser`,
`comment-json`, `json5`, `strip-json-comments` or `yaml` in `node_modules`; the only `_deps` tree is the
agent-teams one; the host's own comment-preserving machinery is the YAML `Document` path and rejects any
extension other than `.yaml/.yml/.json` [DOSSIER pp.178-196].

**The single most important rule of this design [DECIDED]: the writer is REFUSE-FIRST.** The editor
returns a **result**, never a best effort:

```
surgicalEdit(rawText, path, value) ->
    { ok: true, text }                 // only when the exact span was proven
  | { ok: false, reason: <named> }     // file is left BYTE-UNTOUCHED
```

If the rewriter **cannot prove** that it located the exact value span for the requested key path, it
must: (1) leave the file byte-untouched, (2) warn loudly with the path and the named reason, and (3)
**still let the settings layer take effect** — the settings write is the front door's contract and must
not be rolled back or blocked by a file-writing problem. A config file destroyed by a UI save is the
worst outcome this feature can produce, so every ambiguity resolves to "do not write".

### B.1 The structured editor

**[DECIDED] Primary: extend the existing scanner inside `mpd-config-plugin`** into a path-addressed
**value-span rewriter** — no new dependency, no vendoring. Tokenise once recording, for every object
member, its **key span** and **value span** (offsets), then splice only the target span. Everything else
is byte-identical **by construction**, because the writer never re-serialises a byte it did not target.

**[DECIDED] Fallback (explicitly second choice):** vendor a small JSONC editor into
`packages/mpd-config-plugin/_deps/`, following the `mpd-agent-teams-plugin/_deps` convention. It must
ship the same byte-fidelity tests, or it is not an acceptable fallback.

### B.2 The edge-case matrix (each must have a stated behaviour and a test)

| # | Case | [DECIDED] Behaviour | Why |
|---|---|---|---|
| E1 | **Strings and escapes** | The scanner is already string-aware and skips `\\"` and `\\\\` (`index.ts:28-33`). The rewriter writes the new value with `JSON.stringify(value)` and never re-escapes a *neighbouring* string. A path segment containing `.` or odd characters is matched against **decoded** key text, not raw source bytes. | A naive rewriter corrupts `"a\"b"` or a key that looks like a path. |
| E2 | **Comments before / inside objects** | Both `//` and `/* */` are skipped by the tokeniser and are **outside every spliced span**, so they survive verbatim — including a comment sitting between a `{` and the first member, and a comment after the last member. | This is the whole point of span surgery vs re-serialisation. |
| E3 | **Trailing commas** | The existing scanner already detects a trailing comma before `}`/`]` (`index.ts:38-43`). The rewriter records whether the file USES trailing commas and matches that style on insert, so it never both adds a new comma and leaves a dangling one. On delete it removes the member's key, value and one adjacent comma, then re-checks that no `,,` or `[ ,` remains. | A naive writer produces `{a:1,,}`. |
| E4 | **Arrays** | A numeric path segment indexes an array. Replacement splices that element's span; insertion appends before `]`; deletion removes the element plus the comma that separates it. **Deleting into an empty array is allowed** (`[]` is valid). | Arrays are in the schema (`extensions.enable/disable` are lists) and must not be a hole. |
| E5 | **Duplicate keys** | `JSON.parse` is **last-wins** [MEASURED: `JSON.parse('{"a":1,"a":2}')` → `{"a":2}`]. **[DECIDED] The rewriter edits only the LAST occurrence** — the one the runtime actually reads — and **refuses** (`ok:false, reason:'duplicate-key'`) when the requested path would be ambiguous through a duplicated *intermediate* object (two `"hashline"` objects). It never merges duplicates silently. | Editing the first occurrence would look successful and change nothing observable. Ambiguous intermediates cannot be resolved honestly. |
| E6 | **Missing key path (insert position)** | Materialise missing intermediates at the deepest existing point, then **append the new leaf as the LAST member of its object**. The inserted subtree is plain `JSON.stringify(v, null, 2)` and carries **no invented comment**. If the parent object is empty, insert immediately after `{`. | D-7: appending preserves a human's key order everywhere else; alphabetical insert would reorder their file on unrelated edits. Inventing a comment would fabricate a human artifact. |
| E7 | **CRLF vs LF** | The scanner treats `\r` as whitespace, and **[MEASURED]** there is no explicit CRLF handling in the reader. **[DECIDED]** The writer detects the file's dominant line ending and, when it must emit a NEW line (an insert), uses that ending; it never rewrites existing line endings. If a file is mixed-ending, the dominant one wins and the choice is recorded in the write-back result. | A writer that emits LF into a CRLF file produces a mixed file that diffs as fully rewritten. |
| E8 | **File changed on disk between read and write** | **Compare-and-swap on the raw bytes read before the edit.** If the file no longer matches, re-read and retry up to **N = 3**; after that, `ok:false, reason:'conflict'`, file left exactly as the human left it, loud warning. | Never overwrite a human edit the bridge did not see. |
| E9 | **File is not valid JSONC** | Parse fails → **no edit attempted at all**, `reason:'unparsable'`, error text recorded, zero bytes written. | The bridge must never "repair" a file a human is editing into a different file. |
| E10 | **Target file missing** | Create it with a short header comment naming the writer and date, then insert the key. | Creating is the only sane reading of "persisted to the JSONC file"; refusing would make a first edit impossible. |
| E11 | **Target read-only** (`EACCES`/`EPERM`) | Settings edit still succeeds; file untouched; one warning naming the exact path and errno; status `writeback:'denied'`. | Loud degradation. |

### B.3 Atomicity

**[DECIDED]** Per file: read raw → locate spans → build new text → **compare-and-swap** → write to a
sibling temp file in the same directory → `rename` over the target. `rename` within one filesystem is
atomic, so a reader sees the old or the new file, never a truncated one. The host's own settings provider
uses the same shape for `settings.yaml` ("writes atomically", [DOSSIER p.64]) and is the precedent.

**[DECIDED]** Multi-file writes are **not** transactional and must not pretend to be: each root gets its
own result, and a failure on root B after success on root A is reported per root, never collapsed into
one boolean.

---

## C. The web half: loopback-only, and what can honestly be witnessed here (input 3)

**[MEASURED]** `$H/dsh-client-ui-settings/lib/client.js:1345`:
`const persistence = ctx.remote.$host.isLoopback ? "host" : "memory"`. In `memory` mode the snapshot is
`status:'unavailable'`, `writable:false`, `mode:'memory'` [DOSSIER pp.133-137]. **A non-loopback page's
settings writes never reach the host document.**

**[DECIDED]** Therefore:
1. The web card **must be exercised from a LOOPBACK page**. That is the only configuration in which a
   web write can reach `settings.yaml`, the bridge, and the file.
2. The card's own copy must state the limit — a remote page is read-only in practice — so a user on a
   non-loopback URL is not misled into believing a save persisted.
3. **Honest evidence level, stated before any lane is written.** No browser exists in this environment
   (no Playwright/Chromium in the checkout; the QA isolation story is `DSH_HOME` + sandbox `HOME` +
   sandbox workspace, not a browser). The reviewer will not accept a claim that a card *rendered*.
   What **can** be witnessed, and what the lane must therefore assert:
   - **W1 (witnessable, protocol level):** the card's write path exists and works end-to-end over the
     **host HTTP API** — an authenticated `settings/mutate` (303 + launch-token cookie exchange, then
     the mutate RPC) changes the namespace, the bridge runs, and the JSONC file changes. This proves the
     **bridge**, which is this design's subject.
   - **W2 (witnessable, static):** the built client bundle contains the `settings.plugin.item`
     registration for `key:'mpd'` — asserted against the shipped/served bytes (the repo's existing
     pattern for client claims, e.g. the sidebar-tab test pins served bytes).
   - **W3 (NOT witnessable here — must be recorded as NOT-CLAIMED, never implied):** that the card
     renders, is dispatched for the `mpd` namespace, and that a human click produces the mutate. This
     needs a browser and stays unclaimed with the reason recorded.
4. Consequently the design does **not** claim "the Web page persists". It claims: "a loopback client's
   mutate persists; the card renders in a browser (unverified here)".

**[DECIDED]** The card is added to the existing bundle client
(`packages/mpd-bundle-plugin/src/web-client.js`, built by `scripts/build-mpd-client.mjs`) as
`ctx.slots.inject("settings.plugin.item", …) → ctx.slots.register({ name, key: 'mpd', locale, inject }, Card)`
[DOSSIER pp.90-96], reading/writing through `ctx.settingsScope.bind({ namespace: 'mpd' })` and writing
with `mutate([{op:'set', path, value}], draftRevision)` [DOSSIER pp.114-123]. The client performs **no
filesystem I/O** — it cannot, and this design adds none.

---

## D. `applies: 'restart'` — what a saved value means for a running session (input 4)

**[MEASURED]** The namespace is declared with `{ applies: "restart" }`
(`packages/mpd-tui-plugin/src/settings.ts:141`).

**[MEASURED — the reason it is genuinely `restart` for our knobs]** The mpd consumers resolve their
config **once, at `apply()`**, and capture the result:
`packages/mpd-boulder-plugin/src/index.ts:31,45` (`mergedConfig(ctx, config)` at apply, then a captured
`merged`), `packages/mpd-comment-checker-plugin/src/index.ts:26,99` (same shape),
`packages/mpd-hashline-plugin/src/index.ts:40` (`hashline.maxDiffChars`),
`packages/mpd-ulw-plugin/src/index.ts:26` (`ulw.maxRounds`),
`packages/mpd-memory-plugin/src/index.ts:24` (`memory.vcs`).

**[MEASURED — the one exception]** `packages/mpd-ext-plugin` reads the layer **lazily per use**, never
from an apply-time snapshot: `src/manifest.ts:193-210` and the documented invariant at
`src/mcp.ts:50` ("Read lazily, per use (never an apply-time mpdConfig snapshot)").

**[MEASURED]** `mpd_config_reload` (`packages/mpd-config-plugin/src/index.ts:104,134-141`) only refreshes
the layer's own `state`; it cannot force an already-applied plugin to re-read, and the README claims
nothing more than "`get(key?)`, `reload()`, `states()` + two tools"
(`packages/mpd-config-plugin/README.md:21-22`).

### D.1 The honest per-knob table [DECIDED, derived from the measured read sites]

| Knob | Consumer | Effective when |
|---|---|---|
| `hashline.maxDiffChars` | `mpd-hashline-plugin` | **restart** (captured at apply) |
| `commentChecker.autoCheck` (+ bin/timeout/maxMessageChars) | `mpd-comment-checker-plugin` | **restart** (captured at apply) |
| `ulw.maxRounds` | `mpd-ulw-plugin` | **restart** (captured at apply) |
| `memory.vcs` | `mpd-memory-plugin` | **restart** (captured at apply) |
| `team.stateDir` | the adopted agent-teams plugin (row config) | **restart** |
| `boulder.dir` | `mpd-boulder-plugin` | **restart** (captured at apply) |
| `extensions.*` | `mpd-ext-plugin` | **immediate** — read lazily on each use |
| any knob observed through `mpd_config_get` / `mpd_config_reload` | the config layer itself | **immediate** — the layer re-reads the files on `reload(exec)` |

**[DECIDED]** So the truthful statement is: **a saved value is durable and visible immediately
(`mpd_config_get` after a reload), but a RUNNING session's plugin behaviour changes only after a
restart** — for every knob in the six-knob `/settings` section, and immediately only for the
lazily-read `extensions.*` family, which the section does not expose.

**[DECIDED] Consequence for the write path:** the bridge writes the file immediately, but it must not
imply that the running session changed behaviour. It reports `applies: 'restart'` alongside the
per-root write result.

### D.2 What the TUI hints must therefore say after the bridge

**Today [MEASURED]:** `UNBRIDGED_MARKER = "not bridged: a save here does not rewrite .mpd/mpd.jsonc"`
(`settings.ts:50`), and all six hints go through `knobHint()` (`:53-55`), asserted by
`test/plugin.test.ts`.

**[DECIDED]** That sentence must **become true or disappear**. After the bridge a save DOES rewrite the
file (for the live roots, when the write succeeds) — but the *behaviour* change needs a restart. So the
marker is replaced by a two-part statement, and the word "not bridged" is **deleted**, not softened:

| Case | Hint text [DECIDED] |
|---|---|
| default | ``mpd.jsonc <key> — a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount)`` |
| no live root at save time | the same, plus the runtime notice ``saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)`` |

**[DECIDED]** One constant and one helper stay the single source (so a field cannot silently lose the
disclosure), and the existing assertion in `test/plugin.test.ts` is extended to the new sentence. This is
a **reword-only, explicitly-scoped** change in the TUI package: no new seam, and no filesystem write.

---

## 1. Layer precedence

### 1.1 The four layers

| # | Layer | Where | Written by | Present when |
|---|---|---|---|---|
| L0 | schema defaults | the namespace schema | plugin code | always |
| L1 | user file | `$DSH_HOME/mpd.jsonc` | humans, `mpd_config_set` (existing) | if the file exists |
| L2 | project file | `<workspace>/.mpd/mpd.jsonc` | humans, **the bridge (new)**, tools | if the file exists |
| L3 | settings user section | `<DSH_HOME>/settings.yaml` | both front doors, **the bridge on migration** | if an explicit edit exists |

**[DECIDED] Runtime precedence `L0 < L1 < L2 < L3`** — the settings user layer wins at runtime because it
is the freshest explicit human intent and carries the revision fence. **[DECIDED] Persistence precedence:
L2 is the durable home** — a front-door edit is persisted into L2, so after a successful write-back
`L2 == L3` for that key and the divergence is transient.

Why not "the file always wins": that makes a UI edit invisible until something re-reads the file — the
exact bug this bridge exists to remove.

### 1.2 What the user sees when a key exists in more than one layer

| Step | `mpd.jsonc` | settings `user` | runtime value | what the user sees |
|---|---|---|---|---|
| start | `hashline.maxDiffChars: 20000` | — | 20000 | file value, no override |
| edit UI → 4096 | unchanged so far | `4096` | **4096** (L3 wins) | new value immediately |
| write-back succeeds | `4096` | `4096` | 4096 | file updated; UI and file agree |
| later, user edits the FILE → 9999 | `9999` | `4096` (stale) | **4096** ❌ | **the file edit appears ignored** |

**[DECIDED] The last row must not happen: a fresh file edit CLEARS the corresponding override.** The
bridge observes the file and, for every leaf whose on-disk value differs from the recorded file-derived
value, **unsets that leaf** from the settings user section with the revision fence. `unset` is the
provider's own reset-to-inherited operation [DOSSIER p.73: absent keys re-inherit base/defaults], so this
is a first-class path. Result: file edit → override cleared → runtime returns to the file's new value;
UI edit → L3 wins → written back to the file. Both directions converge and neither silently loses.

**[DECIDED]** The namespace's `base` carries **L1+L2** (not the resolved value), so a form can mark
`user`-overridden fields and a reset returns to the file's value, not a schema default
[DOSSIER pp.62-68, 231-232].

### 1.3 One measured constraint on the base layer

`installSection` (the "optional-settings consumer" helper, [DOSSIER p.246]) is **`register` + hooks**: I
read the implementation — `$H/dsh-settings/lib/index.js:327-331` calls
`this.register(ns, schema, { base: entry })` — and duplicate registration fails loud [DOSSIER p.30].
**[DECIDED]** So the file-derived base is refreshed by a **re-registration cycle** (dispose the namespace
effect, register again), and **not** by calling `installSection` twice. **[DECIDED]** The documented
fallback if re-registration proves unsafe against a live namespace: keep the base fixed for the process
lifetime and make the resolved value the authority, with the cards showing "inherited (read at mount)".
The fallback is strictly worse for the user (a file edit needs a restart) and is recorded so it is not
discovered late. **[UNVERIFIED]** which path is safe — a mounted boot must measure it.

---

## 2. Write-back ownership

**Owner: `packages/mpd-config-plugin` [DECIDED, following [DOSSIER p.238]]** — the only module that
already owns `<workspace>/.mpd/mpd.jsonc`, `$DSH_HOME/mpd.jsonc`, the JSONC reader, `deepMerge` and the
workspace-root helper. It must **not** be `mpd-tui-plugin`: that keeps the verified zero-write property
and keeps the TUI package out of config-layer ownership.

### 2.1 The trigger

**[DECIDED]** Primary trigger **`settings/document-updated(ns, revision)`**, because it fires whenever the
RAW section changed "whether or not the resolved value did" [DOSSIER pp.51-55] — the revision-surfacing
event, so the deep-equal gate cannot drop a write-back. `settings/updated(ns, next, prev, source)` is a
secondary signal used to skip needless work.

**[DECIDED]** `source` is load-bearing: `source:'provider'` means the settings document itself was
reloaded (e.g. a human edited `settings.yaml`) — that is a **read-in** event and must **not** echo into a
file write. Only `source:'update'` (an API/mutate-driven change, i.e. a front-door edit) triggers
write-back. This filter is what prevents a write-back ↔ document-reload loop.

### 2.2 The sequence

```
front door edits ns "mpd"
  -> provider validates, persists settings.yaml, bumps revision, publishes settings/document-updated
  -> bridge (source === 'update') diffs prev/next raw user section -> changed leaves
  -> bridge resolves the TARGET SET (§A.1)
  -> per root: refuse-first surgical edit (§B) under lock + compare-and-swap + atomic rename
  -> bridge re-reads the file layers and refreshes the namespace base (§1.3)
  -> bridge records the file-derived value per leaf (for the §1.2 clearing rule)
  -> bridge reports per root: written | denied | conflict | unparsable | skipped(no-live-session),
     each with the path and reason; applies:'restart' recorded for the behavior-change timing (§D.1)
```

---

## 3. Workspace selection

Answered in §A.1 (rule, failure mode and user-visible message for 0 / 1 / N live roots). Summarised:
target set = distinct live roots at event time via `workspaceRootsAll()`; **exactly one root ⇒ write it**;
**0 roots ⇒ persist + write nothing + warn `no-live-session`**; **N roots ⇒ REFUSE with
`ambiguous-multi-root`, name every candidate, write nothing**; `process.cwd()` is never a fallback. R2
(last-writer) and any single guessed root are rejected by name as the forbidden silent mis-targeting;
R3 (explicit workspace in the change) is documented as not expressible today because the card's owner
props are empty and the TUI section is display-only metadata [DOSSIER p.166]; R4 alone (user layer only)
is rejected because the user decision fixes `<workspace>/.mpd/mpd.jsonc` as the persisted target.

---

## 4. Comment and format preservation

Answered in full in §B (refuse-first rule, the structured editor, and the E1-E11 edge-case matrix with
CRLF, duplicate keys, arrays, trailing commas, missing-path insertion, and read/write races).

---

## 5. Invariants

| # | Invariant | How this design keeps it |
|---|---|---|
| 1 | `packages/mpd-tui-plugin` performs **ZERO** filesystem writes | The bridge lives in `mpd-config-plugin` (§2). The TUI package's only change is **string-constant** work in `settings.ts` (§D.2). **[MEASURED]** today it imports only `readFileSync`/`readdirSync`/`statSync` (`src/state.ts:11`, `src/registration.ts:17`) and no write API appears in `src/` or `dist/index.js`; test U11 must keep asserting that. |
| 2 | `packages/mpd-dsh-adapter-plugin` is the ONLY contact surface with harness services | The bridge reaches `ctx.settings` **through a new adapter seam** [DECIDED: e.g. `settingsNamespace({ns, schema, base}) -> scope` plus `onSettingsDocumentUpdated(cb)`], never via a bare `ctx.get("settings")` inside `mpd-config-plugin`. This is a deliberate, scoped adapter addition — the only way to satisfy both this invariant and the bridge. |
| 3 | `packages/mpd-config-plugin` owns the config layer | It owns namespace registration, the file reader/writer, precedence, and per-call workspace-root resolution (`dsh.workspaceRoot(exec)` / `workspaceRootsAll()`), never a cached module const, never `chdir`. |
| 4 | No new filesystem write from any web/client code | The card calls `settingsScope.mutate(...)`; the write rides the existing `settings/mutate` RPC. The client performs no filesystem I/O. |

**[DECIDED]** The TUI package **stops owning** the namespace registration when the config plugin
registers it, because duplicate registration fails loud [DOSSIER p.30]. Preferred order: (1) if the
namespace is already served (probe through the adapter), register nothing and only declare the section;
(2) otherwise keep the existing soft-probed registration as a **fallback** so the section is never
"unavailable" in a composition that lacks the config plugin.

---

## 6. Migration / back-compat

**The situation [MEASURED]:** the current section already writes values into the settings namespace
`mpd` (`settings.ts:141`; the TUI owns the writes), so those values sit in
`<DSH_HOME>/settings.yaml` under `mpd` while the mpd plugins read `.mpd/mpd.jsonc` — i.e. they are
**currently inert**, exactly as the unbridged marker says.

**[DECIDED]** On the first boot after the bridge lands, and only when a live root exists:
1. Make the namespace serve the **file-derived base** (§1) so the plugins begin honouring `mpd.jsonc`
   immediately.
2. **Migrate** each existing settings-`user` leaf into the project file through the same refuse-first
   editor, leaving the user leaf in place until the file write is **confirmed**. This makes saved values
   real instead of silently dropping them.
3. Record idempotence with a marker **inside the `mpd` namespace** (`bridge:{migratedRevision:N}`), not a
   side file: the settings document is already the durable store with a monotonic revision
   [DOSSIER pp.58-61]. A re-boot at the same revision does nothing.
4. With **no** live root, do nothing and report `migration:'deferred-no-workspace'`; a later boot with a
   root performs it. **Never** migrate into `process.cwd()`.

**[DECIDED] Pre-bridge documents carrying keys the schema no longer declares:** the schema is the judge
(an invalid stored section fails registration itself [DOSSIER pp.205-214]), so the bridge must not
silently drop unknown keys — it reports `migration:'ignored-keys'` and leaves the document untouched.
**[DECIDED]** No downgrade path is promised; once a value is in `mpd.jsonc`, an older bundle still reads
that file, so downgrade is naturally safe.

---

## 7. Failure modes and what the docs must disclose

**[DECIDED]** The documentation task must be able to state these without inventing:

1. **No live session ⇒ no file write.** A Web edit with zero live roots persists only in the settings
   document; the card says so (§A.1).
2. **Remote (non-loopback) Web pages never reach the host document** (memory mode) — and the card's copy
   must say it (§C).
3. ~~**Fan-out is real:** one settings document + N live workspaces ⇒ one edit writes N files, reported per
   root.~~ **[SUPERSEDED — see the ERRATUM at the top of this file.]** The correct disclosure is: **with N
   live workspaces the target is ambiguous, so the write-back REFUSES with `ambiguous-multi-root`, names
   every candidate and writes NO file** (§A.1, §3, §10.3, D-5, U14, F5). What the docs must disclose is
   therefore the refusal and how the user makes the target unambiguous, not a fan-out.
4. **`applies: 'restart'`:** a saved value is visible immediately to the config layer
   (`mpd_config_get` after reload) but a **running session's plugin behaviour changes only after a
   restart** for every knob in the section; `extensions.*` is the only lazily-read family and the section
   does not expose it (§D.1).
5. **File edits win by clearing the override** (§1.2) — disclose it so it reads as designed behaviour,
   not data loss.
6. **Inserted keys carry no comment**; a human who adds one keeps it on later edits (§B.2/E6).
7. **Refuse-first:** an unparsable, read-only, ambiguous or conflicting target leaves the file
   **byte-untouched** with a loud named reason, while the settings value still takes effect (§B).
8. **Still not bridged:** enumerate by name anything the bridge does not own (other plugins' namespaces;
   any mpd knob whose consumer never reads the config layer) rather than implying completeness.

**[DECIDED]** Items 1-4 and 7 must also be visible **in the product surface** (card copy, TUI runtime
notice, status output), not only in the docs.

---

## 8. Decision log (what a reviewer should attack)

| Id | Decision | If you disagree, the alternative is |
|---|---|---|
| D-1 | Runtime precedence `L0 < L1 < L2 < L3` | let the file outrank the settings layer — a UI edit is then invisible until a re-read, the bug being fixed |
| D-2 | A file edit **clears** the overlapping settings override | let L3 win forever — a file edit is silently ignored (§1.2) |
| D-3 | Write-back owned by `mpd-config-plugin` | the TUI package — rejected: breaks the verified zero-write property |
| D-4 | Trigger `settings/document-updated` filtered to `source==='update'` | `settings/updated` alone — its deep-equal gate can drop a raw-section change |
| D-5 | Target set = the live roots at event time; **exactly 1 root ⇒ write it; 0 roots ⇒ persist + warn `no-live-session`; N roots ⇒ REFUSE `ambiguous-multi-root` with the candidate list; never guess** | fan-out to all N — REJECTED, it fails t35 acceptance A3 ("never silently write to a guessed path"); or last-writer-wins / a single guessed root — the forbidden silent mis-targeting |
| D-6 | **Refuse-first** surgical span rewriter in-repo | edit-on-best-effort, or vendor an editor — both rejected as primary; the vendored editor is the fallback only |
| D-7 | New keys appended as the last member | alphabetical insert — reorders a human's file on unrelated edits |
| D-8 | Base refresh by re-registration; fixed-base is the documented fallback | `installSection` twice — impossible: duplicate registration fails loud (§1.3) |
| D-9 | TUI keeps a **fallback** namespace registration, not a second owner | leave both live — duplicate registration fails loud |
| D-10 | Web card claims loopback-only persistence; the rendered card stays **NOT-CLAIMED** here | claim the card renders — unverifiable without a browser, and the reviewer will not accept it (§C) |
| D-11 | Duplicate keys: edit the **last** occurrence, refuse on ambiguous intermediates | merge duplicates silently — looks successful and changes nothing observable (§B.2/E5) |

---

## 9. Test plan (falsifying)

### 9.1 Unit tests

| Id | Test | Falsifies |
|---|---|---|
| U1 | **Byte fidelity**: edit one leaf in a fixture with `//` and `/* */` comments, non-alphabetical key order, a trailing comma and a trailing newline; assert every byte outside the edited span is unchanged. | D-6 and the whole surgical premise (a re-serialising editor deletes comments / reorders keys). |
| U2 | **Escapes**: fixture with `"a\"b"`, `"\\\\"` and a key containing `.`; assert a neighbouring string is untouched and the target path matches the decoded key. | E1. |
| U3 | **Nested missing path**: edit `a.b.c` where `a` exists and `b` does not; assert `a`'s comments/order survive and the inserted subtree parses to the intended value. | E6 / D-7. |
| U4 | **Delete**: unset a leaf that is the only member; assert valid JSONC (no dangling comma, no empty-brace artefact). | E3 span arithmetic on deletion. |
| U5 | **Arrays**: replace, append and delete an element of `extensions.disable`; assert valid JSONC throughout, including deleting to an empty array. | E4. |
| U6 | **Duplicate keys**: fixture with `"a"` twice and with a duplicated intermediate object; assert the last occurrence is edited and the ambiguous intermediate **refuses** with the file byte-unchanged. | E5 / D-11. |
| U7 | **CRLF**: a CRLF fixture; assert existing endings are preserved and an inserted line uses CRLF. | E7. |
| U8 | **Compare-and-swap**: change the file between read and write; assert the writer refuses, retries, and after N tries reports `conflict` **without** writing. | E8. |
| U9 | **Unparsable**: malformed fixture; assert `unparsable` and **zero bytes written**. | E9 / refuse-first. |
| U10 | **Read-only target**: assert the settings edit still succeeds, the file is byte-identical, and the warning carries the exact path + errno. | E11 / loud degradation. |
| U11 | **Missing target**: assert the file is created with the header comment and the key present, and that a second identical edit is a no-op. | E10. |
| U12 | **Precedence**: with values in L1, L2 and L3, assert `get()` returns L3; after the file changes, assert the override is cleared and `get()` returns the file's new value. | D-1 / D-2 in both directions. |
| U13 | **No workspace identity**: with `workspaceRootsAll() === []`, assert no file is written anywhere, the settings write succeeds, and the status reports `writtenTo: []` + `no-live-session`. | §A.1's "never guess". |
| U14 | **Ambiguous multi-root REFUSAL**: two live roots; assert NO file is written anywhere, the settings write succeeds, the warning names BOTH candidate roots, and the status reports `writtenTo: []` + `ambiguous-multi-root`. | §A.1's "never guess" rule — this test must FAIL if any fan-out or single-root pick is implemented. |
| U15 | **Migration idempotence**: pre-seed settings `user`; boot; assert the file received the values, the marker records the revision, and a second boot writes nothing. | §6. |
| U16 | **TUI zero-write**: `grep` over `packages/mpd-tui-plugin/src/` and `dist/` for `writeFile|appendFile|mkdir|unlink|createWriteStream` stays empty, and `bun test packages/mpd-tui-plugin` passes. | Invariant 1. |
| U17 | **Restart timing**: assert the reported timing is `restart` for the six section knobs and that `mpd_config_get` reflects a new file value after `mpd_config_reload` without claiming the consumer changed. | §D.1 honesty. |

### 9.2 The two live lanes (concrete, falsifiable)

Lane shape for both: mount the bundle in an **isolated `DSH_HOME` + sandbox `HOME` + sandbox workspace**
with registration instrumentation (AGENTS.md §7 — env alone does not isolate workspace state), each lane
on **its own lane-root sandbox** (the t7/t8 independence precedent), and each asserting **three** things:
**(a)** the front door accepted the write; **(b)** `<workspace>/.mpd/mpd.jsonc` changed with comments
intact; **(c)** an mpd plugin's **behaviour** changed (and, per U17, that the change needed a restart).

| Lane | Command shape | Falsifier it targets |
|---|---|---|
| **L1 — TUI edit** | `node skills/dsh-qa/scripts/tui-settings-bridge.mjs` (tmux-driven: the TUI needs a real TTY, so it is excluded from the automated `bun run test:qa` sweep, exactly like the existing TUI lanes) — edit one knob in `/settings`, then assert (a) the TUI accepted it, (b) the file changed with comments intact, (c) after a restart the consumer's behaviour reflects the new value. | F1/F2/F3 |
| **L2 — loopback Web edit** | `node skills/dsh-qa/scripts/web-settings-bridge.mjs` — authenticate with the loopback pattern (303 + launch-token cookie exchange), then issue the **same `settings/mutate` the card emits**, and assert (a) the mutate returned ok, (b) the file changed with comments intact, (c) the consumer's behaviour changed after restart. Plus the **static** assertion W2 that the built client contains the `settings.plugin.item` registration for `key:'mpd'`. | F1/F2/F3, and F8 (no direct client-side file write) |

**[DECIDED]** L2 explicitly records **W3 as NOT-CLAIMED**: no browser exists here, so "the card renders
and a click produces the mutate" is not witnessed and must never be reported as verified (§C.3).

### 9.3 What would prove the bridge does NOT work (state it so a green run cannot hide a dead bridge)

- **F1** The file is unchanged after a front-door edit the UI reported as saved.
- **F2** The file changed but a **comment or the key order** was lost, a duplicate key was merged
  silently, CRLF was rewritten, or the file no longer parses.
- **F3** The file changed but the **plugin's behaviour did not** after a restart — "takes effect for the
  mpd plugins" fails.
- **F4** With **zero live roots**, some file was written anyway (a guessed workspace).
- **F5** With **two live roots**, any file was written (fan-out or a picked root) instead of a refused
  `ambiguous-multi-root` — the target rule fails, and this is the falsifier the N-root negative control
  exercises.
- **F6** A read-only, conflicting or unparsable target produced **no diagnostic** and the UI said "saved
  to file".
- **F7** The TUI package gained a filesystem write (U16 red).
- **F8** The web card wrote to the file **directly** (no `settings/mutate` on the wire).
- **F9** The lane claims the card rendered, or claims a non-loopback page persisted.

A lane asserting only "the edit was accepted" is **not** sufficient evidence for any of F1-F9 and must
not be reported as a pass.

---

## 10. Interface contract for the implementer (answers to the 6 points raised by t35)

These are the points the implementer must not guess. They are decisions, not measurements; where a fact is
involved it carries a **[MEASURED]** tag.

### 10.1 Ownership split — who calls `ctx.settings.register('mpd', …)`

**[DECIDED] `packages/mpd-config-plugin` registers the namespace; `mpd-tui-plugin` becomes a pure
consumer** (declares the SECTION only). Rationale: the namespace must serve the **file-derived `base`**
(§1.1), which only the module that reads the files can supply, and the namespace registration is the
handle the write-back needs for the revision fence. The ownership moves with the reason, not with
convenience.

The TUI package keeps its **fallback** registration for compositions that lack the config plugin
(unchanged §5/D-9), probed in this order: if `mpd` is already served → register nothing; else register as
today. `mpd-tui-plugin` performs **zero filesystem writes** either way (A4 and U16 unchanged).

**[DECIDED] Duplicate-registration hazard, stated because it is the obvious failure:** the two plugins
must never both register in the same composition. The probe above is the guard, and the manifest/row story
is: `mpd-config` mounts before its consumers in the bundle patch — the implementer must confirm the row
order rather than assume it.

### 10.2 Module + API + the DISABLE SWITCH required by A6

**[DECIDED]** The rewrite lives in a NEW sibling module, not inside `index.ts`:

| Item | Value |
|---|---|
| Module | `packages/mpd-config-plugin/src/jsonc-edit.ts` |
| Mounting | no new row — it is imported by `packages/mpd-config-plugin/src/index.ts`, which is already mounted as the `mpd-config` row |
| Exports (pure, no fs) | `type EditResult = { ok: true; text: string } \| { ok: false; reason: EditRefusal; detail?: string }`; `type EditRefusal = 'span-not-proven' \| 'duplicate-key' \| 'ambiguous-intermediate' \| 'unparsable' \| 'unsupported-shape' \| 'read-only' \| 'conflict'`; `function locateValueSpan(rawText: string, path: readonly string[]): { start: number; end: number; hasTrailingComma: boolean; eol: '\n' \| '\r\n' } \| { reason: EditRefusal }`; `function surgicalEdit(rawText: string, path: readonly string[], value: unknown \| typeof DELETE): EditResult` |
| Bridge module | `packages/mpd-config-plugin/src/bridge.ts` — owns the subscription, target selection, the atomic write and the per-root report |
| Adapter seam | one addition in `packages/mpd-dsh-adapter-plugin/src/index.ts` (names/shape are the adapter owner's call; see §5 invariant 2) |

**[DECIDED] THE DISABLE SWITCH — this is the A6 negative-control hook, and it must be able to disable
the write-back WITHOUT disabling the settings layer.** Two levers, both named here so the lane does not
invent one:

1. **Primary (the one the negative control flips): a row config key** on the existing `mpd-config` row —
   `config.writeBack: false` (default `true`). It is a row key, not an env var, because AGENTS.md §6
   forbids logic in profiles/scripts and the row config is the composition truth; it also lets the lane
   compose a DISABLED bridge from its own patch layer, which is exactly what a negative control needs.
   With `writeBack: false`: the namespace still registers and still serves values, the file is never
   written, and the report says `status: 'disabled'` — so the lane can assert (a) the settings edit still
   lands and (b) **the file does NOT change**, which is a failing assertion when the switch works and a
   caught bug when it does not.
2. **Secondary (for a live boot without a patch edit): env `MPD_DSH_TUI_SETTINGS_BRIDGE=off`**, following
   the repo's existing `MPD_DSH_*` override convention. It is documented as a debugging/composition
   lever, not the lane's primary control.

**[DECIDED]** The switch disables ONLY the file write-back. It must never disable the namespace or the
precedence resolution — otherwise the negative control would be indistinguishable from "the feature is
absent".

### 10.3 The refusal conditions, exactly (t35 A3 + A6 depend on these)

A write-back is **refused with the file byte-untouched** when any of these holds. Each maps to a named
reason so the lane can assert on the *reason*, not on the prose:

| Condition | Reason | Byte-untouched |
|---|---|---|
| the target set has 0 live roots | `no-live-session` | yes |
| the target set has N > 1 live roots | `ambiguous-multi-root` (+ candidate list) | yes |
| `writeBack` is disabled (§10.2) | `disabled` | yes |
| the file is not valid JSONC | `unparsable` | yes |
| the exact value span for the path could not be proven | `span-not-proven` | yes |
| the path resolves through a duplicated intermediate object | `ambiguous-intermediate` | yes |
| the target file is read-only (`EACCES`/`EPERM`) | `read-only` | yes |
| the bytes changed between read and write, after N = 3 retries | `conflict` | yes |

**[DECIDED] A MISSING key path is INSERTED, not refused** (the captain ruled this explicitly): the
rewriter materialises missing intermediates at the deepest existing point and appends the leaf as the
**LAST member** of its object (§B.2/E6, D-7) — no reordering, no invented comment. `span-not-proven` is
therefore reserved for the genuinely unprovable cases (an unsupported shape, a malformed member), never
for "the key is absent".

**[DECIDED] DUPLICATE KEYS:** edit the **LAST** occurrence (`JSON.parse` is last-wins — [MEASURED]
`JSON.parse('{"a":1,"a":2}') === {"a":2}`); refuse `ambiguous-intermediate` only when the duplicated
object is an *intermediate* on the path. Never merge silently.

**[DECIDED] CRLF is PRESERVED, never normalised.** The editor detects the dominant line ending, keeps
every existing ending byte-identical, and uses the dominant ending only when it must emit a NEW line
(an insert). Mixed-ending files keep their dominant ending and record the choice in the result. A file
must never be reflowed by an unrelated edit (§B.2/E7).

### 10.4 Precedence, both directions (A1/A2 depend on this)

**READ:** `L0 schema defaults < L1 $DSH_HOME/mpd.jsonc < L2 <workspace>/.mpd/mpd.jsonc < L3 settings user
section` (§1.1). A value present in `.mpd/mpd.jsonc` is therefore *visible* to the plugins immediately
(it is L2, above the schema defaults), and a value in the settings namespace outranks it at runtime.

**WRITE — which layer receives a change:** the settings write lands in **L3** (the front door's own
contract, revision-fenced), and the bridge **also pushes that leaf into L2** `<workspace>/.mpd/mpd.jsonc`
(that is the whole point: the file is the durable home). **[DECIDED] Settings-only values ARE pushed to
the file** — otherwise A2 ("re-reading the file alone yields the written value") is unsatisfiable. After a
successful write-back `L2 == L3` for that leaf, so the two layers agree and no divergence is observable.

**The reverse direction must stay honest:** when the FILE changes underneath, the bridge **clears the
overlapping L3 override** (§1.2/D-2) so a file edit is never silently swallowed. That rule is the reason
the precedence order can be L3-highest without losing file edits.

Precedence conflict detail the implementer needs: if the same key exists in BOTH `$DSH_HOME/mpd.jsonc`
(L1) and `<workspace>/.mpd/mpd.jsonc` (L2), the read resolves **L2** (project wins) — the write-back
targets L2 only and must not "fix up" L1.

### 10.5 What the candidate set is, operationally

**[DECIDED]** The candidate set is **`dsh.workspaceRootsAll()` evaluated at write time** (the union of
live session cwds). It is NOT the subscribing session's cwd: the settings path carries no session
identity [DOSSIER §c], so there is no "subscribing session" to attribute to, and using a subscriber's cwd
would be exactly the guess A3 forbids. A "live root" is therefore *a workspace currently served by a live
session*, and the bridge treats the three cardinalities as §A.1 states: 1 ⇒ write it; 0 ⇒
`no-live-session`; N ⇒ `ambiguous-multi-root` refusal with all candidates named.

### 10.6 Test-plan hooks: must-succeed vs must-refuse fixtures

So the tests falsify these rules rather than restate them:

| Fixture | Expected | Falsifies |
|---|---|---|
| one live root, key absent | **succeed** — file created/appended with the key, comments elsewhere intact | E6 insertion + D-7 ordering |
| one live root, key present | **succeed** — only that span changes; byte-compare the rest | U1 byte fidelity |
| comment before `{`, after a member, `/* */` inline | **succeed** and all comments survive verbatim | E2 |
| trailing comma present / absent | **succeed**, style matched, no `,,` | E3 |
| `extensions.enable` array edit | **succeed**; delete-to-empty valid | E4 |
| key absent under an EXISTING parent | **succeed** (insert) | the "missing ⇒ refuse" misreading |
| duplicated leaf key `"a"` twice | **succeed**, LAST occurrence edited | E5/D-11 |
| duplicated INTERMEDIATE object | **REFUSE `ambiguous-intermediate`** | E5 |
| malformed JSONC | **REFUSE `unparsable`**, zero bytes written | E9 / refuse-first |
| read-only file | **REFUSE `read-only`**, settings edit still ok | E11 |
| file mutated between read and write | **REFUSE `conflict`** after retries | E8 |
| CRLF file | **succeed**, endings preserved | E7 |
| 0 live roots | **REFUSE `no-live-session`** | §A.1 |
| 2 live roots | **REFUSE `ambiguous-multi-root`**, both candidates named, NO file written | §A.1 / F5 — the negative control's core case |
| `writeBack: false` | **REFUSE `disabled`**, settings edit still ok, file unchanged | A6 negative control |

---

## 11. Not decided here (so the implementer does not inherit an unstated assumption)

- The exact adapter method names/shapes for the settings seam (§5, invariant 2) — a naming/typing
  question for the adapter owner.
- Whether `workspaceRootsAll()` deduplicates and how it treats a deleted cwd **[UNVERIFIED]**.
- Whether the re-registration refresh (§1.3) is safe against a live namespace — a mounted boot must
  measure it; the fixed-base fallback is documented.
- Performance of the span rewriter on very large files — not measured; it is O(n) and the config file is
  small by nature.
- Scope: the change is **one bridge module + one pure rewriter module inside `mpd-config-plugin`, one
  adapter seam, one web card, and one string constant in the TUI package** (§10.1–§10.2). Anything larger
  is outside this design and should be re-reviewed rather than absorbed.
