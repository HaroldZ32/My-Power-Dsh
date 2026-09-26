This directory documents the SERVICE-PRIMARY revision of the w7 hold gates.

It SUPERSEDES the gate-read path recorded in
  evidence/team-watchdog/pause/20260915T163526Z/
which enforced the hold by reading the durable file directly from each gate.
That directory is left untouched as a record of the earlier iteration; the
regions it describes (same ids) now read the watchdog's `mpdWatchdog` service.
