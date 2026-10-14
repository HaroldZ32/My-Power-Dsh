# Wave D — the draft → final sequence, and the final overlap numbers on the pinned hashes

Documentary repair, 2026-10-08T16:53Z–16:56Z. It answers the blind verifier's findings **D-VER-1**,
**D-VER-2** and **D-VER-3**. **D-VER-6** (the misnamed `NOTICE` probe) is recorded in `result.json`.
No persona text and nothing under `packages/**` was touched by this repair; the three original overlap
logs are INTACT (`analysis/original-logs.sha256` records their sha256 and write instants, so a later
reader can tell they were not rewritten).

## 1. What each original log measured, and when

| log | written (UTC) | pairs | subject it measured |
|---|---|---|---|
| `analysis/overlap-previous.log` | 2026-10-08T16:44:12Z | 11 | the then-current drafts vs the pre-wave-D texts (`analysis/old-*.md`) |
| `analysis/overlap-seeds.log` | 2026-10-08T16:44:12Z | 9 | the then-current drafts vs each role's DECLARED seed |
| `analysis/overlap-final.log` | 2026-10-08T16:44:47Z | 20 | 9 declared seed pairs + 11 pre-wave-D pairs, plus the alias scan |

The two 16:44:12Z logs have the same write second, so their mutual order is not recoverable from the
packet; both are earlier than `overlap-final.log`.

Delivery order, from file mtimes (UTC):

```
16:44:03  analysis/overlap.mjs
16:44:08  packages/mpd-roles-plugin/personas/explore.md
16:44:12  analysis/overlap-previous.log + analysis/overlap-seeds.log   <-- drafts measured here
16:44:20  multimodal-looker.md
16:44:24  librarian.md
16:44:37  atlas.md · hephaestus.md · metis.md · oracle.md · prometheus.md · sisyphus.md · sisyphus-junior.md
16:44:44  momus.md                          <-- last persona write
16:44:47  analysis/overlap-final.log        <-- the only measurement that postdates it
16:45:03  packages/mpd-roles-plugin/personas/ATTRIBUTION.md
16:45:14  output.log (the 7-gate sweep, 16:45:14Z–16:45:17Z)
```

**The measured text therefore MOVED between runs: 10 of the 11 persona files were written again after
the 16:44:12Z measurement** (only `explore.md`, 16:44:08Z, was not). This is exactly the hole D-VER-1
names, and it is why the numbers below are only meaningful together with the sha256 in §4.

The invisibility is concrete, not theoretical: of the 20 rows in the two early logs (11 + 9), only 10
moved numerically (2 seed rows, 8 pre-wave-D rows). The other 10 rows report the SAME number before and
after a rewrite — a reader of the early logs could not have told that those files had changed at all.

## 2. Which draft carried the 14- and 15-word runs, and what changed

`analysis/overlap-previous.log` measured an **intermediate wave-D draft** (the text as it stood at
16:44:12Z, before the 16:44:37Z rewrite of `hephaestus.md` and `sisyphus.md`) against the pre-wave-D
SUL-1.0 text:

```
hephaestus.md  run = 14  ("spawn teammate you are the implementer take a ready task from the shared board")
sisyphus.md    run = 15  ("check the skill catalog before every delegation and name the skills the child must load")
atlas.md       run =  9  ("their write tools are denied by the roster guard")
multimodal-looker.md run = 8 ("whose domain matches the analysis request if any")
momus.md       run =  6  ("your job is to unblock work")
sisyphus-junior.md run = 6 ("the last mile not an orchestrator")
oracle.md      run =  5 · librarian.md run = 5
```

What changed: those runs were rewritten out of the drafts; the DELIVERED texts, measured on the pinned
hashes, share at most **6** words with the same baseline — `sisyphus.md` 6 ("you are the senior engineer
the", a role-name opening) and `prometheus.md` 5 ("under mpd plans slug md", the `.mpd/plans/<slug>.md`
path convention); every other persona is 4 or 5, its role-name opening. See §5(c).

**Declared bound:** the intermediate drafts were not archived, so their bytes cannot be recovered and
re-hashed. The proof that the measured text changed is the mtime order plus the numeric delta between
the two runs — *not* a recovered draft. Anything stronger is not claimed.

The same defect shows in the seed direction: `analysis/overlap-seeds.log` measured the 16:44:12Z drafts
against the declared seeds and reported **prometheus 5, metis 6**; both files were rewritten at
16:44:37Z, and the delivered bytes measure **prometheus 3, metis 4**. The other seven declared pairs
report the same number in both runs (their files were rewritten too — the rewrite simply did not change
that maximum).

## 3. The instrument, and its declared cap

`analysis/overlap.mjs`, sha256 `2c67d2083f8a7ad0a216d4d765b1025d78dd7cac81112848a2836b1b688aebbb`.
Exact per-pair command, run once per pair listed in §5:

```
node evidence/de-omo/personas/20261008T163931Z/analysis/overlap.mjs <PERSONA> <REFERENCE>
```

**Declared cap:** the tool builds reference substrings of at most 24 words, so a reported run of exactly
24 means "≥ 24". The rule is therefore: *a reported value below 24 is exact.* No pair anywhere in this
run reports 24 (the global maximum is 7), so no number below is truncated. A pair reporting 24 would
have to be re-measured with a raised cap before being quoted.

## 4. The binding (D-VER-1)

`analysis/bind-personas.sh` (transcript: `analysis/bind-personas.log`, exit 0):

```
start read (UTC) : 2026-10-08T16:55:26Z   -> analysis/persona-hashes-start.tsv
work             : 240 pairs (12 delivered files × 20 fetched seed files) + 11 pre-wave-D pairs
                   -> analysis/overlap-matrix.log
settle window    : 50 s (AGENTS.md §7)
end read (UTC)   : 2026-10-08T16:56:24Z   -> analysis/persona-hashes-end.tsv
verdict          : START == END — analysis/persona-hash-diff.txt is EMPTY (0 bytes)
```

The 12 hashed files are the 11 persona texts **and** `packages/mpd-roles-plugin/personas/ATTRIBUTION.md`;
the sha256 values are in `analysis/persona-hashes-start.tsv` and in `result.json` (`measurementBinding`).

Two further bindings were checked in the same run and are recorded in `analysis/overlap-matrix.log`:

- the **20 fetched seed files** re-hash byte-identical to `seed-manifest.txt` (20 matched, 0 mismatched);
- the **11 pre-wave-D baselines** (`analysis/old-*.md`) are byte-identical to
  `git show HEAD:packages/mpd-roles-plugin/personas/<n>.md` at `16dbeb211afe8501e8df6f133033504ffb513399`
  (11/11, checked read-only), so the "previous" column compares against the real pre-wave-D text.

And the delivered bytes **reproduce `overlap-final.log` exactly**: `analysis/reproduce-final-log.sh`
selected the same 20 pairs out of the matrix and diffed them against the original log —
`analysis/overlap-final-vs-matrix.diff` is EMPTY. The final log's numbers belong to the revision on
disk, and this is what makes it admissible as the wave's evidence.

## 5. The final numbers, measured on the pinned hashes

### (a) The 9 DECLARED pairs — the claim's real subject

| persona | declared seed | run | shared text |
|---|---|---|---|
| `oracle.md` | anthropics/…/architecture-critic.md | 4 | "you are read only" |
| `librarian.md` | voltagent/…/research-analyst.md | 2 | "you are" |
| `prometheus.md` | gsd-2/…/planner.md | 3 | "planning specialist you" |
| `hephaestus.md` | gsd-2/…/worker.md | 3 | "if the task" |
| `sisyphus.md` | voltagent/…/fullstack-developer.md | 2 | "you are" |
| `atlas.md` | voltagent/…/multi-agent-coordinator.md | 3 | "you are a" |
| `explore.md` | overstory/agents/scout.md | 4 | "you are read only" |
| `metis.md` | superpowers/…/code-reviewer.md | 4 | "by what a reasonable" |
| `momus.md` | vgv-wingspan/…/shared/references/plan-review.md | 3 | "a written plan" |

Maximum: **4 generic words** — well below the 14- and 15-word runs of §2.

### (b) The WIDENED matrix — every one of the 20 fetched seed files

`analysis/overlap-matrix.log` holds all 240 pairs (12 delivered files × 20 seed files, the two
`seed: null` personas and `ATTRIBUTION.md` included). Per-file maximum over the 20, with the pair and
the shared text — **this is what each result is, plainly**:

| delivered file | max | seed it was measured against | shared text |
|---|---|---|---|
| `atlas.md` | 3 | anthropics/…/architecture-critic.md | "you are a" |
| `explore.md` | 5 | gsd-2/…/scout.md | "another agent can use without" |
| `hephaestus.md` | 3 | anthropics/…/architecture-critic.md | "end to end" |
| `librarian.md` | 5 | overstory/agents/scout.md | "you are read only the" |
| `metis.md` | **7** | anthropics/…/architecture-critic.md | "with what where why it matters and" |
| `momus.md` | 5 | overstory/agents/scout.md | "you are read only the" |
| `multimodal-looker.md` | 5 | overstory/agents/scout.md | "you are read only the" |
| `oracle.md` | 5 | overstory/agents/scout.md | "you are read only the" |
| `prometheus.md` | 5 | overstory/agents/scout.md | "you are read only the" |
| `sisyphus.md` | 3 | anthropics/…/architecture-critic.md | "is a finding" |
| `sisyphus-junior.md` | 3 | gsd-2/…/worker.md | "if the task" |
| `ATTRIBUTION.md` (provenance doc, not a persona) | 5 | vgv-wingspan/…/references/plan-review.md | "shared references plan review md" |

Seven of the nine files that have a declared pair exceed that pair's value in the wider matrix (the
other two, `atlas.md` and `hephaestus.md`, tie at 3); the three files with no declared pair have no
declared value to compare against, and the global maximum **7** belongs to a pair that was never
declared (`metis.md` vs the anthropics seed, a seed the Reviewer was not modelled on). The runs are
generic function-word and role-label sequences plus one seed PATH string in `ATTRIBUTION.md`; they are
reported here rather than hidden, because the old sentence "the longest word run shared between a
persona and its seed is four generic words" is true ONLY of the declared pair — see §6.

### (c) The pre-wave-D baseline, 11 matched pairs

| persona | run | shared text |
|---|---|---|
| `sisyphus.md` | 6 | "you are the senior engineer the" |
| `atlas.md` · `explore.md` · `hephaestus.md` · `momus.md` · `multimodal-looker.md` · `prometheus.md` · `sisyphus-junior.md` | 5 | role-name opening ("you are the lead the" …); `prometheus.md` is the `.mpd/plans/<slug>.md` path convention ("under mpd plans slug md") |
| `librarian.md` · `metis.md` · `oracle.md` | 4 | role-name opening ("you are the researcher" …) |

Every row is a role-name opening or the path convention — the 14- and 15-word SUL runs of §2 are gone.

## 6. The claim, restated (D-VER-3), and what it is not

What the measurement supports, in exactly these words:

> **Against every DECLARED seed pair** (9 of the 11 personas; Vision Analyst and Junior Engineer have no
> seed): the longest contiguous word run shared with the declared seed is at most 4 generic words.
> **Against ALL 20 fetched seed files** (240 pairs): the longest run found anywhere is 7 words,
> `metis.md` vs `anthropics/claude-plugins-official/…/architecture-critic.md` — a seed it was not
> modelled on — and the text is generic connective prose. **Against the pre-wave-D SUL-1.0 texts**
> (11 pairs): at most 6 words, a role-name opening or the `.mpd/plans/<slug>.md` path convention.

Bounds attached to it:

- it is a **lexical** measure (case/punctuation-normalised word runs) on the 20 seed files that were
  FETCHED, not on the eight repositories as a whole;
- the instrument caps a run at 24 words, and no reported value is near that cap (§3);
- `ATTRIBUTION.md`'s own two sentences — "the longest word run shared between a persona and its seed is
  four generic words" and "the longest word run any persona still shares with its pre-wave-D text is its
  own role-name opening and the `.mpd/plans/<slug>.md` path convention" — are both **confirmed** by this
  run, each is scoped to the DECLARED seed / the matched baseline, and neither was edited by this repair
  (`packages/**` is outside its write scope).

## 7. Files this repair added

`SEQUENCE.md` (this file), `bind-personas.sh` + `bind-personas.log`, `persona-hashes-start.tsv`,
`persona-hashes-end.tsv`, `persona-hash-diff.txt` (empty), `persona-hash-verdict.txt`,
`overlap-matrix.log`, `reproduce-final-log.sh`, `reproduced-final-pairs.txt`,
`overlap-final-vs-matrix.diff` (empty), `original-logs.sha256`, `gate-rerun.log`; and
`seeds/anthropics__claude-plugins-official/NOTICE` was RENAMED to `NOTICE-ABSENT-404.txt` (D-VER-6) —
its 14-byte body is the string `404: Not Found`, the record that **no NOTICE file exists at that
revision**, never an Apache-2.0 §4(d) notice.
