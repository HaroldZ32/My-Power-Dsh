# Revision resolution — why two honest measurements contradicted each other (t8)

Answering the captain's first-class question: **at the CURRENT revision, in the CURRENT lane composition,
do the seams register?** — plus the digest discipline that was missing.

## The artifact my lanes measured

| Field | Value |
|---|---|
| Path | `packages/mpd-tui-plugin/dist/index.js` |
| sha256 | `5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f` |
| bytes | 98883 |
| mtime | `2026-09-15 14:23:20 +0800` = `2026-09-15T06:23:20Z` |

**Proof this is what MY lanes ran against** (the lanes themselves do not record it — see the gap below):
the artifact's mtime `06:23:20Z` precedes my lane runs (`tui-mount` 06:34:12Z, `tui-panels` 06:34:39Z),
the digest is unchanged when re-measured now, and no file under `packages/mpd-tui-plugin` has been rebuilt
after `06:23:21Z`. Same bytes before and after the runs ⇒ the runs measured this revision.

## The composition I booted

| Dimension | Value |
|---|---|
| Sandbox root | `.mpd/recon/qa/t8-reviewer-20260915T063140Z` (created + installed by `raw/install-fresh-root.sh`) |
| Workspace target | `<root>/ws` — **required**; set by the lane helper; proved by the store key `--root-dshProj-my-power-dsh-.mpd-recon-qa-t8-reviewer-20260915T063140Z-ws--` |
| Profile | `dsh-tui` (host `@deepseek-harness-tui/dsh-tui@0.10.1`), presets default `mpd` |
| Profile bundles | `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]` — in that order |
| Session isolation | created key = the sandbox key above; `inherited: []`; `isolationOffenders: 0` |
| Chrome language | zh — patterns accepted both languages (`MPD 插件包|MPD bundle`) |

## Plain answer

**Six of the seven activation-gated seams register and take effect at this revision:**

| Surface | Result | Witness |
|---|---|---|
| `tuiStatus` | registers | `mpd: team … · plans N · workmates N` in the captured pane |
| `commands` (`/mpd`) | registers | harness `command/run`+`command/done` records (`mpd workmates (1): qa-tui-probe`) |
| `tuiCommandTrees` | registers | `/mpd ` completion advertises the tree child |
| `tuiScenes` | registers | `MPD board` scene opens |
| `tuiSettingsSections` | registers | `MPD 插件包 (mpd)` section renders |
| `tuiDialogs` | registers | `mpd workmates` dialog opens |
| `tuiRenderers` | **does not** | reproduced RED; **host-side**, recorded NOT CLAIMED — the surface the captain excluded from this question |

So the seams **DO register** at the current revision. The renderer row remains the single exception and is
**not** a plugin registration failure.

## Chronology — the contradiction is REVISION, not composition

| Revision | When | Measured behaviour | Where it is recorded |
|---|---|---|---|
| `695f68c4858745cc…` (93206 B) | t4 era (~05:34Z) | **INERT** — no status contribution, `/mpd status` sent to the model (Senior Engineer's instrumented mount) | `evidence/tui/composition/20260915T053445Z/raw/admission-static.json`, `evidence/tui/docs/20260915T060010Z/` |
| `710d3eef5d0f451b…` | built ~06:00Z | 5–6 seams taking effect (Lead's panel runs 06:12–06:22Z) | `evidence/tui/plugin-followup/20260915T060032Z/` |
| `5dce2563…` (98883 B) | rebuilt 06:23:20Z | **6/7 seams register** (my run 06:34Z) | this directory; `evidence/tui/composition/20260915T062602Z/` and `…/064009Z/` cite the same digest |

The two camps were describing **different artifacts of the same package**, not different compositions:
the `dsh-tui` profile, the triple bundle layering and the workspace-target rule are the same shape across
all three. The pre-repair artifact was inject-free (every seam took the "service not composed" branch);
the repaired artifact uses the deferred `ctx.inject(['<service>'], scoped => …)` form, which is what makes
registrations take effect. Same composition, different code ⇒ no contradiction remains once the revision
is pinned.

## The gap that allowed it (finding T8-F5, owner t7)

Neither lane result recorded the artifact revision: `lanes/tui-mount/result.json` and
`lanes/tui-panels/result.json` carry **zero** occurrences of `5dce2563` and **zero** mentions of
`dist/index.js`. A lane result is therefore not self-identifying — it cannot say which artifact it proved
anything about, which is precisely how two honest measurements drifted apart for a wave.

**Recommended fix:** every lane writes, alongside `result.json`, the measured
`{path, sha256, bytes, mtime}` of `packages/mpd-tui-plugin/dist/index.js` (and fails loudly if the digest
changes mid-run), so a verdict can always be anchored to the bytes it measured.
