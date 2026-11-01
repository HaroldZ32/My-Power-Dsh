# Falsifiability of the two new arms (measured, not reasoned)

Both new arms were run against the PRE-FIX source (`git show HEAD:packages/mpd-team-watchdog-plugin/src/web.ts`,
read-only), with the new test file kept in place:

    (fail) registration > a REPLACED web-server object gets its own registration, and the same object is never registered twice
    (fail) the mutations > the 200 hold answer keeps the consumer fields and carries NO filesystem path at any depth
     11 pass / 2 fail  (exit 1)

The other eleven arms of that file pass in BOTH states, so the fix changes no existing behaviour.
The fixed source was restored from a /tmp copy and its sha256 re-checked equal (`RESTORE_OK`).
