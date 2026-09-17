# t57 RE-VERIFICATION under the moved docs-claims driver — 2026-09-17T03:32:33Z

WHY THIS FILE EXISTS
t57 (repair, attempt 5b843e79-1e80-44af-86f8-17fbdb8561e4) is COMPLETE and its evidence is
`../20260917T035000Z/`. After it closed, the captain reported that the checker had moved twice more
(`e332da70…` → `dfe26090…`). This re-run answers one question under the CURRENT driver: are the five
anchors t57 created still CHECKED (not merely present), and is the driver still green?

DRIVER REVISION MEASURED (pinned, which t57's own evidence did NOT do — see lesson below)
  sha256 dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c
  30,345 B  ·  `evidence/extensions/docs-claims/check-citations.mjs`
  the driver's own header: "task t21 (upgraded from the t9 checker: CONTENT claims + negative control)"

COMMAND
  node evidence/extensions/docs-claims/check-citations.mjs --out=evidence/gates/extensions-unanchored-refs/20260917T033233Z-recheck-dfe26090
  (explicit `--out` on purpose: a bare run writes into the driver's own default run dir, which belongs
   to t21's inScope, not mine — the mistake I made at t50 and disclosed)

DECISIVE LINES (driver-written result.json + output.log sit in this directory)
  ok   citations:EXTENSIONS-FOR-AGENTS.md — 59 citation(s) (checked 55: path 38, dir 5, command 12; pending 0, illustrative 4), 0 unresolved
  ok   content:anchors — 46 anchored citation(s) verified against their claimed symbol/phrase on the cited line; 0 anchor(s) without a content claim
  [docs-claims] 12/12 checks passed, 0 failed, 249 citation(s) resolved, 0 pending, 12 illustrative
  exit 0

COMPARISON WITH t57's RECORDED POST-CHANGE READING
  t57 (20260917T035000Z): 59 citations / checked 55 (path 38, dir 5, command 12), 0 unresolved;
                          content:anchors 41 → 46 verified
  now, driver dfe26090…:   59 citations / checked 55 (path 38, dir 5, command 12), 0 unresolved;
                          content:anchors 46 verified
  ⇒ IDENTICAL. The five anchors t57 created are still counted as checked and still content-verified
    by the moved driver; nothing in t57 needs redoing.
  Note: `symbol_only_anchors_verified: 0` in this run — the driver now carries T-72's symbol-only arm
  but no citation in these files uses that grammar yet (T-72's migration stays t21's window).

LESSON (register-worthy, exactly the T-78 class)
  A verdict that depends on a DRIVER must pin the driver's revision, not only name its command.
  t57's evidence records the command, the counts and the exit code, but no hash of
  `check-citations.mjs` (grep of its `check-after.log` / `sha-after.txt`: no revision line), so
  "still green under the newer driver" can only be established by re-measuring — which is what this
  file does. From here on, evidence for a driver-dependent verdict names the driver's sha256.
