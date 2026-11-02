# Falsifiability of the three defect arms (measured, not reasoned)

The four new arms were run against the PRE-FIX source (`git show HEAD:packages/mpd-bundle-plugin/src/web-client.ts`,
read-only), with the new test file and the REAL rebuilt artifact in place. Full transcript:
`falsifiability.log`.

    (fail) a failed watchdog read is an UNKNOWN hold, never the claim 'not held' > a refused watchdog read renders the unknown sentence and never claims 'not held'
    (fail) a failed watchdog read is an UNKNOWN hold, never the claim 'not held' > an unreadable watchdog payload (no ok:true) is unknown too, and its holds are not trusted
    (fail) a failed watchdog read is an UNKNOWN hold, never the claim 'not held' > an unknown hold freezes Pause (button AND action) while Resume stays live
     18 pass / 3 fail  (exit 1)

The fourth new arm — "a successful read with no hold still says 'not held' and offers Pause" — passes in BOTH
states on purpose: it is the unchanged-behaviour CONTROL for the KNOWN-empty branch. All 17 pre-existing arms
pass in both states, so the fix changes no existing behaviour.

The fixed source and artifact were then restored from a workspace snapshot, rebuilt (back to 884633 bytes),
and re-checked with `sha256sum -c` (three `OK` lines, RESTORE OK); the snapshot was removed afterwards. Every
gate log in this directory was re-run AFTER that restore, so each one describes the bytes in the tree now
(see `sha256.log`).
