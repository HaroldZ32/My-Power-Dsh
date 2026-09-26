# CORRECTION + sharper root cause: why no `tuiRenderers` row appeared (t23)

Written after t23 was already submitted, by follow-up measurement in the same warm
sandbox. It does NOT change t23's verdict (criterion 1 stays unsatisfied); it
corrects the *reason* recorded in the t23 finding, which attributed the miss to
the channel capturing its renderer facade once at construction. That attribution
was wrong. The real mechanism is narrower and reproducible.

## What was measured (six instrumented boots, one variable at a time)

Each probe was mounted as a scratch row in the sandbox PROFILE patch (restored
afterwards), registered renderers for specific event types, then appended those
events from its own command in the same session. Output: the raw pane log,
ANSI-stripped before counting.

| Probe | Type registered + appended | Rendered? |
|---|---|---|
| probe4 | `t4probe/notice` (fresh) | **yes** — `PROBE ROW` + payload row in the pane |
| probe5 | `t4probe/with-identity` (fresh, registered with the identity arg AND `scoped.effect` cleanup — our exact shape) | **yes** |
| probe5 | `t4probe/plain` (fresh, plain host idiom) | **yes** |
| probe7 | `mpd-tui/probe-xyz` (fresh) | **yes** |
| probe7 | `agent-teams/task-updated` (a bundle-declared type) | **no** |
| probe6/8 | `mpd-tui/board-opened` (our package's type; already present in the sandbox session store) | **no** — even with OUR renderers disabled via an id-targeted `renderers: false`, so the probe's registration was the only one |
| probe9 | `mpd-tui/board-opened` (previously used) vs `mpd-tui/never-used-before-9` (never used) vs `t4probe/plain9` (control) — **same boot, same command, same payload shape** | **no / yes / yes** |

probe9 is the decisive one: the only difference between the two `mpd-tui/*` cases
is that the first name already existed in the persisted session store.

## Corrected mechanism

The host's renderer seam refuses types it considers built-in
(`dsh-adapter/renderers.ts`: `BUILTIN_SESSION_EVENT_TYPES = new Set(KNOWN_SESSION_EVENT_TYPES)`
captured at module load, then
`if (BUILTIN_SESSION_EVENT_TYPES.has(normalized) …) { warn; return () => {} }` — the
host's comment: "built-in event types keep their own projection"). Plugin event
types that have already been persisted by a previous boot are therefore treated
as built-in from the next boot on, the plugin's registration is silently refused
(a no-op disposer, no ledger record because `tuiEffectLedger` is not reachable
from the service's ctx — measured: `ledger: absent`), and no host-side projection
exists for them, so those events never appear in the transcript.

Two consequences that matter:

1. **A plugin renderer can only ever work for a never-before-seen type** — on the
   first boot that uses it. From the second boot on it is dead. A stable
   "renderer line" is therefore not attainable for any type our bundle appends,
   by construction. This is a host-side (dsh-tui 0.10.1) limitation.
2. **What DOES work** is proven: the seam, the registration shape this package
   uses (identity argument + `scoped.effect` cleanup), the transcript projection
   and the plugin's own event append all function — see probe4/probe5/probe7's
   fresh types rendering their rows.

## Repro

Run any probe from this directory the way the mount lane does: add it to
`$DSH_HOME/profiles/dsh-tui/cordis.patch.yml` as an `insert:` row, boot
`dsh-tui` in tmux, invoke its `/t4probeN` command, then count the row text in the
ANSI-stripped `pipe-pane` log. `reportN.json` records what the probe observed
(service reachable, register returned a function, ledger absent, events appended).
