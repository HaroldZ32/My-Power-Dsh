# Two measured dsh-tui 0.12.0 host constraints (captain diagnosis, 2026-10-05)

Method: the REAL TUI booted inside tmux against the sandbox profile
(`.qa-tmp/tui-dep-lane/dshhome/profiles/dsh-tui`, a `cp -a` of the operator's own install), driven with
`send-keys`, with a temporary FILE probe inside the plugin component (console output from inside a React
render/effect is swallowed by the host's console interception, so a file was the only channel). All
temporary probes were removed before the wave was committed; the source files were restored to the
lane-reported sha256 and verified against them.

## Constraint 1 — a status registration's identity must be the CALLING ACTIVATION

`tuiStatus.registerView(descriptor, identity)` returned `undefined` (refusal) for three different keys,
including a fresh key and a call with NO identity at all, so the rich status view never mounted and
`Ctrl+A` could not be intercepted. Replacing the identity with the BOUND INJECTED SCOPE — the activation
the host's `assertCallerContext` sees as the caller — made all three registrations return a real
disposer, and a temporary visible-row probe then appeared on the pane THREE times, proving the views
mounted. The same rule applies to `set`: the `mpd:` status line had never rendered on this host build
either, and it renders again with the fix (see `boot.pane.txt` of the passing lane, `mpd: team …`).

Host code that decides this: `dsh-adapter/host-access.js` `assertCallerContext(caller, target, …)` —
`caller === target || callerFiber === targetFiber`, else `context must be the calling activation`.

## Constraint 2 — the live input context is only reachable through a SCENE's kit

Measured, same session, two call sites:

    status view, adapter's file-URL import : useStdin() -> undefined   ("answered no context value")
    scene component, host kit (props.ui)   : useStdin() -> { stdin, setRawMode, isRawModeSupported,
                                             internal_exitOnCtrlC, internal_eventEmitter, internal_querier }

`internal_querier` was non-null and `internal_eventEmitter` present in the second read, i.e. the LIVE
provider value. Importing the host package entry first, or importing `<root>/lib/types/ui.js` by file URL,
never changed the first result: the imported module instance is NOT the one the running host renders with.

Workaround, verified end-to-end before it was implemented: stash the kit a scene render receives and call
ITS `useStdin()` from the status view. The final probe of that run shows `effect: attaching emitter`,
`event input=a ctrl=true meta=false`, `intercept -> true`, and the captured pane carries
`MPD subagents + team` + `task dependency graph`.

Consequence, documented rather than hidden: the take-over arms on the first MPD scene/panel render of a
session (`alt+a`, `alt+t`, `alt+m`, `/mpd board`) and stays inert before that. The QA lane
`tui-deps-ctrla` drives the baseline `alt+a` step FIRST, exactly because that is the order a user meets.
