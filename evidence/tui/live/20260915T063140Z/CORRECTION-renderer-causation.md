# CORRECTION — the renderer gap: corrected causation, and a bug in my own t8 canary

Written after t8 was already terminal, at the captain's request. The original t8 conclusion is kept
above (in `T8-LIVE-VERIFY.md` and `result.json`); this block corrects it. Same pattern the implementer
used for `FINDING-CORRECTION.md`: the original stays, the correction is appended.

## What was wrong in my t8 conclusion

I concluded "two independent plugins, same host path, **no renderer row can be produced in this
composition**". Both halves of that are now refuted:

1. **Scope**: my canary registered a renderer only for `mpd-tui/board-opened` — an ALREADY-SEEN type.
   Under the corrected host rule that type is refused no matter who registers it, so the canary could
   not speak for "any renderer row".
2. **My own canary was buggy** — found while reproducing the corrected rule. I wrote
   `scoped.effect(() => { d1?.(); d2?.() })`. Cordis `ctx.effect(fn)` invokes `fn` **immediately** and
   treats its **return value** as the disposer, so my "cleanup" body ran at apply time and
   **unregistered both renderers instantly**. The correct form (what our plugin's `effectOn` does) is
   `scoped.effect(() => () => cleanup)`. My first cross-run comparison — "their fresh types render,
   mine do not" — is fully explained by this bug, not by the host.

## The decisive single-boot comparison (both probes in ONE process)

The implementer's `probe9.mjs` was copied verbatim (only its output path rewritten into my evidence
dir) and mounted as a second profile-patch row beside my canary. Same boot, same session, same
command path, same payload shape. Instrument: BOTH the visible tmux panes AND the full ANSI-stripped
`pipe-pane` log (the implementer's instrument).

| Probe | Type | Already persisted? | Row rendered? |
|---|---|---|---|
| probe9-copy | `mpd-tui/board-opened` | yes (earlier boots) | **NO** |
| probe9-copy | `mpd-tui/never-used-before-9` | no | **YES** |
| probe9-copy | `t4probe/plain9` | no | **YES** |
| my canary | `t8probe/known-0710` | no — and I ADDED it to `KNOWN_SESSION_EVENT_TYPES` at apply | **YES** |
| my canary | `t8probe/plain-0710` | no — deliberately NOT added | **YES** |

Artifacts: `raw/canary/cross.result.json`, `cross.panes.json`, `cross.log`,
`probe9-copy-report.json`, `t8-canary-trace.log`.

**Verdict on the captain's three outcomes: (i) — the corrected rule holds.** A fresh type renders; the
seen type does not. Reproduced independently in my own fresh root, by a different probe, in the same
process.

## Sharpening the mechanism (one measured refinement)

The implementer's stated trigger is "already persisted by a previous boot". My `known-0710` result
narrows it: adding a brand-new type to `KNOWN_SESSION_EVENT_TYPES` **at the profile-patch layer did NOT
deny its renderer**, so "is in the known set" is not the trigger by itself.

What fits every observation is **ORDER**: the denial list is the known-set **as captured when
`renderers.js` is evaluated**, and the host's row order puts that evaluation after the bundle layer but
before the profile-patch layer.

- Our plugin is a **bundle** row: `registration.ts` adds `mpd-tui/board-opened` to the known set during
  its apply — i.e. **before** the capture — so the type is denied, permanently, from the first boot on.
  Iron rule 2 (make the type known so the session stays resumable) and the renderer seam are therefore
  **mutually exclusive for a bundle-shipped plugin**, by construction.
- A later-mounted row (my canary, `probe4/5/7/9`) adds types **after** the capture — so they render.

This is testable and is the sharper upstream ask: the seam should refuse only the **true built-ins**
(frozen at process start), not whatever any plugin legitimately registered before the capture — or it
should expose a read-back so a plugin can tell a refusal from a registration.

## What this changes, and what it does not

- **Changes**: the recorded CAUSE (host deny-list capture + the ordering above), and the removal of my
  "no renderer row can be produced" claim, which was wrong.
- **Does not change**: the DISPOSITION. The renderer line stays **NOT CLAIMED** — a stable line is
  unattainable for any type our bundle appends, because the only renderer-safe types are ones we can
  never legitimately append. And our package's `requested`-never-`confirmed` reporting for this seam
  remains the honest maximum a plugin can do, since the host gives no read-back and a refusal returns
  the same no-op disposer as a success.

## Method note worth keeping

Two of my three failed attempts were self-inflicted, and both were invisible to the instrument:
a relative `name:` in the generated patch row (the loader reported
`Cannot find package 'evidence'` and the whole profile exited 7), and the `ctx.effect` form above.
The successful run differs only in those two details. When a probe says "nothing rendered", the probe
itself is a candidate — which is exactly why the cross-run mounted BOTH probes in one boot instead of
trusting either alone.
