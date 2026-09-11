# Captain-request reconciliation — t10 (Lead)

Recorded `2026-09-10T14:47Z` on the **current bytes**. Every claim below is a command whose output is
reproduced verbatim in `output-captain-reconciliation.log` in the sibling lane
(`evidence/workmate/rename-delete-docs/2026-09-10T14-26-06Z/`).

The captain asked for two doc corrections and both authoritative fingerprint checks. **The two corrections
were already in the tree before this message arrived**; this file documents that with the exact greps the
captain cited, explains why the captain's reads disagree, adds the one clause that was genuinely missing,
and then re-proves everything — including the mount claim on today's bytes.

---

## 1. `AGENTS.md` — BOTH lines are already correct. Evidence, not assertion.

| Captain's report | Actual current bytes |
|---|---|
| `AGENTS.md:157` = `\| Boot check \| dsh --profile headless --dump-config \|` | **`\| Boot check (MOUNT) \| a boot that really applies the rows in an isolated DSH_HOME + sandbox HOME — e.g. bun skills/dsh-qa/scripts/bundle-lifecycle.mjs (or the full-profile-boot.sh / mount-proof.sh pattern with registration instrumentation) \| any patch change, and REQUIRED for any tool-schema change \|`** |
| `AGENTS.md:254` = `- Provability: assert --dump-config rows, …` | **line 254 is now blank**; the bullet moved to **line 265**: `- Provability: assert a REAL tool result (never just "it ran"), or — for composition-only questions —` … |

```
$ grep -n "Boot check" AGENTS.md
157:| Boot check (MOUNT) | a boot that really applies the rows in an isolated `DSH_HOME` + sandbox `HOME` — …

$ grep -n "Provability" AGENTS.md
265:- Provability: assert a REAL tool result (never just "it ran"), or — for composition-only questions —

$ grep -c -- "dsh --profile headless --dump-config" AGENTS.md
0
```

§4's explanatory paragraph states **“`--dump-config` proves COMPOSITION ONLY — never a plugin load”**, and §7
confines `--dump-config` to composition-only questions. The §13 glossary warning and the §4 gate therefore
**agree**; the manual does not contradict itself on this point. The remaining `--dump-config` mentions in
`AGENTS.md` are troubleshooting rows that use it for *composition* checks (are the rows/presets composed, did
an id-targeted patch land) — the correct use.

### Why the captain's reads disagreed — RETRACTED AND CORRECTED

**My earlier explanation was wrong and is withdrawn.** I had attributed the captain's reads to session
transcripts or a mirror. The actual sequence is simpler and the reads were **correct for their timestamps**:

| time (local) | event |
|---|---|
| 14:25, 14:29 | the captain greps the **real** `AGENTS.md` and sees `\| Boot check \| dsh --profile headless --dump-config … \|` at line 157 and the `Provability: assert --dump-config rows` bullet at 254 — both true of the file at that moment |
| **22:35:03** | my rewrite lands (`AGENTS.md` mtime, verified on disk) |
| 14:35 | the captain re-greps and sees `Boot check (MOUNT)` at 157 and the rewritten §7 bullet at 265 — which is what was accepted |

So this was **"captain read the pre-fix file, then the fix landed"**, not "captain read a mirror" and not
"captain read a transcript". The live file's current mtime (`2026-09-10 22:35:03`) confirms the fix landed after
those reads, and the ordering is exactly what the captain reports.

The transcript observation remains true **as a general hazard** and is kept for that reason alone: a repo-wide
grep for the retired wording does find it in one transcript
(`evidence/agent-teams/scheduler-wakeup-fix/2026-09-10T10-16-23Z/captain-session-f333e946.jsonl`, where a
member's *quoted message text* contains the old line). Quoted text inside a session log is not tree state — but
that is a caution about future greps, **not** the root cause of these two reads, and it must not be recorded as
such.

## 2. `skills/dsh-qa/SKILL.md` — the substance was present; the explicit word was not

Running the captain's exact greps against the live file:

| token | hits | why |
|---|---|---|
| `childRequests` | 0 | **case-script internal variable name** — never present in a case-table row; a 0 here is not evidence about the row |
| `childToolCounts` | 0 | same: an internal name, not table prose |
| `mutationLoaded` | **1** | the row already names the provenance guard |
| `EXPOSE NONE of the seven write-capable names` | **1** | the row already states the child-restricted assertion |
| `SILENT UN-GUARDING` | **1** | the measured failure mode, with both harness anchors |
| `falsifiable` / `independently witnessed` | **1** / **1** | added this pass |

So the row did **not** have "zero trace of t13's enforcement dimension" — it already said the load-bearing
part is that *the child's own requests expose none of the seven write-capable names while the parent's exposes
all seven*, with the `mutationLoaded` control lane. What was genuinely missing was the word **falsifiable**
tied to the independent witness, and that clause was added:

> “…and THEN shows the child receiving the FULL tool set with no refusal — so the enforcement assertion is
> genuinely **falsifiable**, and that falsifiability was independently witnessed from the reviewer's side on
> the final bytes rather than taken from the author's word.”

The row now also renders the captain's wording ("excludes") in its tested form (exposes none of the seven) plus
the measured counts, so the table cannot be read as "only proves the list was SENT".

## 3. The fingerprint: both authoritative checks, run last, plus the lock mtime

```
CHECK 1  node scripts/verify-vendor.mjs                     -> exit 0, [verify-vendor] PASS   (skills 364 files)
CHECK 2  find skills -newer VENDOR_LOCK.json -type f         -> NOTHING
lock     VENDOR_LOCK.json  mtime 2026-09-10 22:42:11 (+0800), fileCount 364
         treeSha 54e6cf4464a3ad10643717c39d539b2a9697e72af9e01b858a5d6e319e2f083f
```

Computed with the gate's own helpers (`readBytes` LF-normalising, raw for binaries; `listFiles` walks hidden
entries and skips only a `node_modules` entry) via `refresh-skills-fingerprint.mjs --write`, as the **last
action after the last `skills/**` write**.

**Reconciliation of the three `treeSha` values seen in this delivery — each correct for its own moment:**

| value | what it was |
|---|---|
| `92209d2a85f6…` | quoted in the captain's message; matches **neither** the tree **nor** the lock at any point measured here |
| `d4a05ae26a0e…` | the **locked** value before this pass (t17's refresh at 22:36:44) — and my helper independently recomputed the *same* value against the tree before the edit, proving lock and tree were already consistent |
| `54e6cf4464a3…` | **CURRENT**, after this pass's one-clause edit |

Any single changed byte under `skills/**` — including a comment-only edit — moves the whole-tree hash.
**A fingerprint is a claim about a moment, never a constant.**

## 4. The mount claim, re-validated on TODAY's bytes

§4 of the manual asserts the `--dump-config` vs mounting distinction using evidence measured earlier
(`full-boot.result.json`, `mount-proof.result.json`). Because that claim is now load-bearing for a cold
reader, it was **re-measured today** against the current tree by re-running the proven instrumentation boot
(an isolated `DSH_HOME` + sandbox `HOME`, `dsh plugin add <repo>` then a real `dsh --profile mpd --patch
<probe row>` boot that MOUNTS the rows):

```
apply-crash signatures : 0 (MUST be 0)
probe completed        : 1
workmate tools present : WORKMATE_TOOLS_PRESENT=7/7
boot exit              : 124 (alive at the 60s cap — normal for a serving profile)
[mount-probe] WORKMATE_TOOLS=mpd_workmate_list:ok,mpd_workmate_init:ok,mpd_workmate_spawn:ok,
              mpd_workmate_reflect:ok,mpd_workmate_match:ok,mpd_workmate_rename:ok,mpd_workmate_delete:ok
```

Raw logs: `mount-revalidation/{install.log,mount-boot.log,VERDICT.txt}` (this directory). The claim in §4
therefore holds on the shipped bytes.

## 5. RETRACTION — the "stale dists" finding was a measurement artifact of MY comparison

**This section previously reported that four packages ship a `dist/` older than their own `src/`. That was
wrong, and the finding is withdrawn. No package ships stale code, and nothing needs rebuilding.**

The flaw was the comparison itself: I took the newest file **anywhere** under each `src/` and the newest
**anywhere** under each `dist/`, then subtracted. That pairs unrelated build families and says nothing about
whether an artifact matches its own source. Re-measured per artifact against **its own** source, with exact
sub-second deltas:

| package | artifact pair | Δ (dist − src) | verdict |
|---|---|---|---|
| `mpd-codegraph-plugin` | `dist/index.js` ← `src/index.ts` | **−1.0 ms** | build ordering, not staleness |
| `mpd-dsh-adapter-plugin` | `dist/index.js` ← `src/index.ts` | **−1.0 ms** | build ordering |
| `mpd-memory-plugin` | `dist/index.js` ← `src/index.ts` | **−1.0 ms** | build ordering |
| `mpd-bundle-plugin` | `dist/index.js` ← `src/index.ts` | **−1.0 ms** | build ordering |
| `mpd-workmate-plugin` | `dist/index.js` ← `src/index.ts` | **+19.5 min** | dist rebuilt after the fix (correct) |
| `mpd-roles-plugin` | `dist/index.js` ← `src/index.ts` | **+6.4 s** | dist rebuilt after the fix (correct) |
| `mpd-bundle-plugin` | `client.js` ← `src/web-client.js` | **+1.6 min** | client rebuilt after the edit (correct) |
| `mpd-bundle-plugin` | `client.js` ← `src/team-page.js` | **+5.6 h** | client newer than both sources (correct) |

A ~1 ms negative offset is simply a build writing `dist` immediately after reading `src`; it is the same in all
four cases, which is itself the signature of build ordering rather than of four independent stale artifacts.

The `mpd-bundle-plugin` row was the worst case, because the pairing never existed at all: `dist/index.js` is
the product of the long-stable `src/index.ts`, whereas `src/web-client.js` and `src/team-page.js` produce the
**root `client.js`** (a different artifact family entirely). Both real chains point the right way (table above).

So the statement "a checkout install executes stale copies" was **false**. Independently reproduced in the
correcting pass, and the captain's own sub-second measurements agreed exactly.

**A second methodological trap inside the same check, worth recording:** my first re-verification used
`stat -c %Y`, which truncates to whole **seconds** — so all four ~1 ms pairs compared EQUAL and my `-ge` test
printed "ok" for every package, including if a dist had genuinely been older. The direction only became visible
with nanosecond precision (`st_mtime_ns`). A freshness check whose resolution is coarser than the effect it is
looking for cannot see that effect.

**And the check that actually settles artifact coherence is not a timestamp at all — it is content:**

```
workmate dist carries both new tools : 2 occurrences of mpd_workmate_rename|mpd_workmate_delete
roles dist dead names                : 0 occurrences of str_replace_editor|apply_patch
client.js carries the mutation UI    : RENAME_URL=2, DELETE_URL=2
```

**The lesson, which is the same class as §3's other traps:** a freshness heuristic is only meaningful when the
two things being compared are actually the same lineage, and at a resolution finer than the effect. My
`find | sort | tail -1` per directory was a plausible-looking proxy that produced a confident, wrong finding —
one that would have sent the user to rebuild four packages for nothing. Correcting it required measuring each
artifact against its own source, not against its directory's newest neighbour.

## 6. Verdict on the captain's two items

- **Item 1 (`AGENTS.md`)**: already correct — no change was needed or made beyond what previous turns landed.
  No documented disagreement to declare; the manual is self-consistent (assertion above is falsifiable by the
  greps shown).
- **Item 2 (`SKILL.md`)**: the enforcement dimension was already present; the explicit **falsifiable** clause
  was added, and the row's own tokens are listed above so the next reader can verify completeness without
  guessing internal variable names.

Both authoritative fingerprint checks pass, the lock mtime is recorded, and the mount claim was re-measured on
today's bytes.
