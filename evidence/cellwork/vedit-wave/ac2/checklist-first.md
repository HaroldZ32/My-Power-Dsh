# R1 checklist-first — CR repairs A, B, C and the mail repair M (T25)

Basis: board rows T18 (lane A: CR#2, CR#4, CR#7), T19 (lane B: CR#5), T20 (lane C: CR#3, CR#6),
T23 (mail: CR#9), plus T25's item wording. Written BEFORE reading the repaired code. The CJK identity-key
follow-up (T28) is EXPLICITLY OUT of this checklist: I judge only the stable CR#5 property.

Each item is PASS only when MY OWN probe (never the lane's test) shows the stated behaviour.

1. **CR#2 (T18/R-A1)** — `cellwork_dispatch {reassign}` to a member whose status is `failed` or
   `provisioning` is REFUSED as a REPORTED outcome (never a throw); the board row stays `pending`; the
   transport is NOT called for that target.
2. **CR#4 (T18/R-A2)** — a cell-record `executorRef` that is `""` (and a whitespace-only one) falls
   through to the LIVE roster handle in BOTH the dispatch pass and the reassign path, so the row is
   DELIVERED instead of skipped "no executor handle"; a genuinely absent handle on both sides still
   reports.
3. **CR#7 (T18/R-A3)** — the N1 end-to-end mail arm is skipped-as-root WITH its reason stated, and its
   three claims still hold as a non-root run; the seam-level arm is unconditional. I probe the seam-level
   behaviour unconditionally: a `wake`-record append that fails ⇒ answer says NOT sent with a reason
   naming the record failure, while the durable `send` row landed and a re-read fold reports the message
   present and undelivered; and the failed-`send`-append path still sends NO wake.
4. **CR#5 (T19/R-B1)** — at split submit: a work/review pair spelling the same member `"Seat A"` vs
   `"seat-a"` is REFUSED (`self-review`), the same pair with different roles is REFUSED
   (`member-role-conflict`), a punctuation-only member name is REFUSED (`member-invalid`), identical
   spellings still SHARE one member, and `activate.ts` was not changed to accommodate the validation.
   (CJK names are NOT judged — T28 is in flight.)
5. **CR#3 (T20/R-C1)** — two consecutive requirements `update`s with no splitter progress append exactly
   ONE replacement split row and the second update REUSES it (its id written back); a LIVE row is
   preferred over a recorded CLOSED one.
6. **CR#6 (T20/R-C2)** — an owner repair that FAILS still records the split-ticket id and journals the
   repair error, and a later ID-first lookup FINDS that row.
7. **CR#9 (T23/R-M1)** — a supplied-but-unresolvable `member` on `agent_teams_mail {unread}` is REFUSED
   naming the value and lists NO mail; an explicit valid member id and an explicit valid name still
   resolve; omitting `member` still reads the caller's own inbox.
8. **Gates** — `bun test packages/mpd-cellwork-plugin`, `bun test packages/mpd-team-core-plugin`,
   `node scripts/verify-comment-coverage.ts`, each quoted with its exit code.
9. **Scope** — each repair stayed inside its declared write scope; drift caused by T28 is NOT a finding
   against a lane, and is reported as a bound if it moves a file I pin.
