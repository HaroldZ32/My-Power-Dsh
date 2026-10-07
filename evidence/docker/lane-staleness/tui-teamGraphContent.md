# The `tui.teamGraphContent` lane assertion had been stale since 12:39 UTC

Found while running the Docker real-machine release sweep for the v0.12.0 wave. Recorded here because
the finding is **not** about that wave, and because the reasoning is a reusable pattern: a red lane is
not evidence against the change in front of you until you have run the change's absence.

## Symptom

`node scripts/docker-e2e.ts --mode source --require-docker` fails **2 of 94** assertions:

```
[driver] ok=false complete=false passed=62 failed=2 null=30
FAILED=[tui.teamGraphContent,tui.laneExit]
```

The 30 NULLs are declared "not attempted" — no credentials are staged, and the driver says so per arm
rather than reporting a pass. The real failure is one arm plus the abort it causes:

```
FAIL tui.teamGraphContent — the boxes carry the record's own task ids and subjects
FAIL tui.laneExit — the TUI lane exited with 1 without the ERR trap seeing it
```

## What the pane actually shows

From `evidence/docker/client-install/2026-10-07T14-49-16Z/tui-panes/pane-team.txt`:

```
  │ ╭────────╮
  │ │ ✓ T1   │
  │ ╰───┬────╯
```

Task ids drawn, **no subjects in the boxes**. `grep -c 'build the graph'` on that pane returns **0**.

The last GREEN run (`2026-10-07T10-58-18Z`) shows the same scene with the subjects:

```
  │ ╭─────────────────────────────╮
  │ │ ✓ T1 REQ freeze the contract│
  │ ╰──────────────┬──────────────╯
```

Same pane geometry in both (`216x48`), same fixture, same toolchain.

## Two measurements that separate the causes

**1. It is not this wave.** The same lane was run against the PRE-wave commit (`c905894`, the dev HEAD
before the v0.12.0 wave merged) with the working tree checked out to it:

```
pre-wave dev = c905894ce84cc3c3e01567f485c761b3ad14f267
[driver] ok=false complete=false passed=62 failed=2 null=30 FAILED=[tui.teamGraphContent,tui.laneExit]
```

Identical failure. The wave's diff touches no `packages/**` file at all — its changed paths are
`README*.md`, `docs/**`, `CHANGELOG.md`, `SECURITY*.md`, `docker/ui/**`, the three version carriers,
`.github/ISSUE_TEMPLATE/bug_report.yml` and `evidence/**`.

**2. It is not environmental.** The first hypothesis was resource contention (a UI container was
running throughout), then a floated dependency. Both were tested:
- Stopping the UI container and re-running reproduced the failure exactly.
- Toolchain and harness identity are byte-identical between the passing and failing runs:
  `node v24.21.0 (npm 11.19.0)`, `bun 1.4.2 (route=official-script)`, `pnpm 11.23.0`,
  `ubuntu 24.04.5 LTS`, `@deepseek-ai/dsh 0.2.0-rc.2`.
- The TUI host's `@dsh-std/*` dependencies ARE wildcards (`"*"`), which was a plausible float — but the
  newest of them (`0.1.1-rc.2`) was published 2026-09-13, weeks before either run.

## The actual mechanism

`git log -S"the drawing's own label" -- packages/mpd-tui-plugin/src/graph.ts`:

```
2026-10-07 20:39:24 +0800 6fdfc012 fix(tui): the DAG click resolves the box you pointed at, and the page gets its own chrome
```

That commit froze a new contract in `graph.ts`:

> EVERY NODE READS `<marker> <id>` AND NOTHING ELSE (frozen clause AC1, this wave). The drawing used to
> append a three-letter kind and the graph-safe subject … The subject and the description are NOT lost:
> they are verbatim in the pinned detail body (clause C3), which is text rather than a drawing.

`6fdfc012` landed at **12:39 UTC**. The last green lane run was **10:58 UTC**. `c905894` (the pre-wave
dev HEAD) was committed at **13:46 UTC**, i.e. ON TOP of it.

So `docker/tui-lane.sh`'s

```
grep -q 'T1' && grep -q 'build the graph'
```

has been unable to succeed since 12:39 UTC. **Nobody re-ran the release lane in that window**, and this
wave is simply the first run since — which is why a stale assertion presented itself as a regression.

## A second defect in the same record: a `raw` that is not evidence

```
record tui.teamGraphContent "…" "the boxes carry the record's own task ids and subjects" "ids=T1 subject=build the graph"
```

`ids=T1 subject=build the graph` is a **hard-coded string literal**, not a measurement. It reads
identically in the passing and the failing run, and it says "subject=build the graph" while the pane
contains no such text. A reader — including the author of this note, on the first pass — can take it
for evidence that the grep found both. Any repair should replace it with the values actually observed.

## Lesson

**Run the change's ABSENCE before blaming it.** One `git checkout <parent>` plus one five-minute lane
run turned "my wave broke the TUI graph" into "an assertion has been stale for four hours", and it cost
less than the speculative debugging it replaced. The corollary that cost more: the environment
hypotheses (load, floating dependencies) were both plausible, both cheap to state, and both WRONG —
while the cheap decisive experiment had already answered the question.
