# R2-3 — citation repair in `packages/mpd-bundle/cordis.patch.yml` (evidence, not a claim)

Finding (t18 round 2, reviewer-verified): the id-target comment block cited
`evidence/tui/composition/20260915T053445Z/` as "Live proof (session record with agentPreset mpd, and
the web profile unchanged)" while that directory held **no session record** (the records lived only
in the scratch sandbox store) and the web artifact cited there is a `--dump-config`, which proves
**composition only**, never a boot. Repaired as ordered — comment-only, no row, id, config or
declaration touched.

## What changed

1. **The relied-upon session records are now durable inside this evidence directory**, byte-identical
   to the sandbox originals (sha256 asserted equal after copy):
   - `raw/sessions/--root-dshProj-my-power-dsh--/683c0f89-…/session.v3.jsonl.zstd`
     `sha256:d78ddb81aafad905ba8085db6f86d64807f5043ddadb884f39337c9f9e147689` — `agentPreset: "mpd"`
   - `…/a9eea0a3-…` `sha256:225152d4eb4bb04c037b9d455562d8af03c136a898ea287d37fb9f5c958c8763` — `"mpd"`
   - `…/c7f6db60-…` `sha256:4471a31dab863c1fda8733de49bb29e3edaa2ec61e0366e08077780409671f03` — `"mpd"`
   - the **contrast** (before the id-target existed), each `agentPreset: "standard"`:
     `…/de5fde53-…` `sha256:0e67008c…`, `…/1a5d7e6f-…` `sha256:ff7954b5…`, `…/e11887f7-…` `sha256:6f3e02ec…`
   - `raw/session-records-index.json` indexes **all 39** records in the store (id, workspace key,
     bytes, sha256, `agentPreset`, `cwd`, `createdAt`, `reliedUpon`, and the copy path for the six),
     so a reader can see exactly which records the D10 claim rests on and which it does not.
2. **The comment now says what each citation proves.** The block is retitled
   "Evidence, split by claim — every citation names an artifact that exists AND says what it proves
   (a `--dump-config` file proves COMPOSITION only, never a load)". The D10 bullet cites the durable
   copies above by path + id + sha256 and names the contrast; the web bullet keeps
   "a COMPOSITION check only" and now names the **web-profile BOOT as R6**
   (`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs`, AGENTS.md §4 — never a `--dump-config` result).

## Re-verified after the comment edit (comment-only, so nothing functional moved)

| Check | Result |
|---|---|
| `node scripts/verify-rows-parity.mjs` | exit 0 — `24 row ids match … mpd-tui …` |
| R11 | exit 0 — `16 patch rows present in pack-mpd PLUGIN_PKGS` |
| `dsh --profile dsh-tui --dump-config` | exit 0; 126 ids, **0 duplicates**; `mpd-tui` row present; roster row carries `default: mpd`; sole stderr `patch: entry "agent-presets" not found` (`raw/tui-dump-config-after-citation.{txt,err}`) |
| `dsh --profile web --dump-config` | exit 0; 201 ids, **0 duplicates**; `mpd-tui` row present; single `agent-presets` row `default: mpd`; sole stderr `patch: entry "dsh-tui-agent-presets" not found` (`raw/web-dump-config-after-citation.{txt,err}`) |

**Not claimed:** no web-profile *boot* is asserted by this directory. R6 belongs to the conformance
lane (t9) and is still pending; the comment names that gate as the boot proof rather than implying
one here.

**Kept, as instructed:** the delivered pair (column-0 `- id: agent-presets` + the second column-0
`- id: dsh-tui-agent-presets`) is unchanged — the mechanism the reviewer measured as correct, and
the insert-with-guard alternative the plan prescribed stays rejected (it would put a second
`agent-presets` entry beside dsh-web-app's own insert, and `group.update()` throws
`duplicate loader entry id` with no `disabled` exemption).

## Verification pass against reality (not against the text)

`R2-3-verification.json` records it; the checks were mechanical:

| Claim in the comment | Measured |
|---|---|
| `683c0f89-…` = `sha256:d78ddb81…`, `agentPreset "mpd"` | durable copy exists, full digest matches |
| `a9eea0a3-…` = `sha256:225152d4…`, `"mpd"` | durable copy exists, full digest matches |
| `c7f6db60-…` = `sha256:4471a31d…`, `"mpd"` | durable copy exists, full digest matches |
| the contrast: `de5fde53-…`/`0e67008c…`, `1a5d7e6f-…`/`ff7954b5…`, `e11887f7-…`/`6f3e02ec…`, each `"standard"` | all three durable copies exist, prefixes match, all three record `agentPreset: "standard"` |
| `web-dump-config.err`'s sole warning is `patch: entry "dsh-tui-agent-presets" not found` | exact match, sole line |
| `web-dump-config.txt` holds exactly ONE `agent-presets` row | count == 1, `default: mpd` |
| web side labelled COMPOSITION only, R6 named as the boot proof | text says exactly that; **no boot is claimed** (R6 is t9's pending lane) |

Two notes for the record:

- **The contrast is THREE records, not two.** The store holds 39 decoded session records at
  measurement time: **3 × `agentPreset "standard"`** (all created before this id-target existed:
  `de5fde53`, `1a5d7e6f`, `e11887f7`) and **36 × `"mpd"`**. The comment lists all three digests.
- **Path precision (one small follow-up edit, comment-only).** The D10 bullet's first path was a
  bare `raw/sessions/…`, which does not resolve from the repo root; it now carries the full
  `evidence/tui/composition/20260915T053445Z/` prefix and the second/third records are described as
  living in that same named directory. `dsh --profile dsh-tui --dump-config` (exit 0; 125 ids, 0
  duplicates, `mpd-tui` row present, roster `default: mpd`) and `dsh --profile web --dump-config`
  (exit 0; 201 ids, 0 duplicates, one `agent-presets` row `default: mpd`) confirm the patch still
  parses and composes after it (`raw/*-dump-config-final.{txt,err}`).

## Authorship split (for the delivery report)

The citation block as originally written was authored by **t19 (Lead)**; `packages/mpd-bundle/cordis.patch.yml`
as a whole is **this worker's (t5) inScope file**. The current text carries this worker's subsequent
precision edit — the durable-copy paths, the honest "Evidence, split by claim … says what it proves"
header, and the contrast ids — applied before the coordination message arrived, and verified against
reality afterwards. Rows, ids and configs were never touched by either edit. `packages/mpd-tui-plugin/**`
was not touched (its owner, t21, is the only writer there).
