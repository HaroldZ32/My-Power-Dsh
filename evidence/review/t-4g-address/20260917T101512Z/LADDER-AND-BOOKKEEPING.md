# LADDER + BOOKKEEPING CHECK — lane A's message vs my own records
READ-AT: 2026-09-17T10:16:12Z   (distinct moment from probe-matrix.txt in this dir)

## 1. ATTRIBUTION (lane A, point 2): 'you verified b09bf3e7…/48,475 B'
PARTIALLY RIGHT, and the unit is WHICH MESSAGE:
  - banner-move message of mine: read b09bf3e7…/48,475 B      -> their attribution CORRECT
  - my most recent message:      named 62b3aa953e8cf2ba / 49,767 B
  - their message calls 62b3aa95…/49,767 B 'current'
  => the two most recent messages held the SAME rung: first convergence of the exchange;
     the 'one rung short' streak was broken by both sides together, not continued.
  My own record of that read: CITATIONS-durable-form.md (71bc5d9b7bcf65bf) records the
  revision READ (e7a95869…/37,340 B) and the last OBSERVED (17920a1a…/44,742 B).

## 2. THEIR FILE CLAIM vs MEASUREMENT
  claim : 62b3aa95… / 49,767 B current, +387/−0 vs HEAD, pointer pattern 0
  now   : 33d62d60a9f1d469 / 51097 B
  git diff --numstat vs HEAD: 400 0 evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md
  pointer pattern (path:line, 6 exts): 0
  RULING: 49,767 B is a HISTORICAL revision (+630 B since); +387/−0 is stale by 6 lines (393 now);
          pointer-pattern 0 CONFIRMED and STRENGTHENED (holds 630 B later, not only at the cited rung).

## 3. STRUCTURAL CONCLUSION (the reason this is not a defect)
  A message is written BEFORE it is read, so its top rung is unreachable by construction:
  'current' is NOT a citable property of a file. The citable forms are (a) a NAMED revision plus
  'it has moved since', or (b) no revision at all — record only the revision READ. My durable-forms
  page chose (b) before I had this measurement; the measurement now says (b) was right.

## 4. THEIR OTHER CLAIMS
  plan body: claim 40,382 B / N1=0 @10:14:34Z -> measured 40382 B / N1 rows 0: CONFIRMED to the byte, settled.
  'the twelfth revision observed': unit = their observation history, list not held by me -> NOT VERIFIABLE, not scored.

## 5. CORRECTION, appended not rewritten (the original bytes above stand)
This file's own "now" reading rotted BETWEEN TWO SHELL COMMANDS of the same turn that wrote it.
Lane A's file, at three reads inside ~60 s:
  62b3aa953e8cf2ba / 49,767 B   <- the revision lane A's message called "current"
  e68a54e815e7b7be / 50,397 B   <- my first re-check (~1 min later)
  33d62d60a9f1d469 / 51,097 B   <- my second re-check, seconds later; diff now 400/0 vs HEAD
RULING: section 2's "+630 B since" and "393 now" are themselves moment-bound — the writer is STILL
IN FLIGHT and no reading in this file is "current". The only non-rotting content here is: the named
revision I read, the direction of movement (+), and the fact that pointer-pattern 0 held at EVERY
revision of this sequence (the one property that survived the movement).
This is the doctrine demonstrating itself inside the record that states it: do not chase "now",
name the revision you read and say that it moved.

## 6. LANE A'S CLOSE, CHECKED — the rule lands and its FIRST APPLICATION is a match
READ-AT: 2026-09-17T10:17:48Z
1. CLAIM (point 1, the rule as filed): CONFIRMED verbatim at lines 426-432 —
   "a message that asserts a file's state should carry the SHA IT READ — not \"current\", not \"now\"",
   attributed to `code-reviewer`, costed "five crossings in one evening", companion nomination attached.
2. CLAIM (point 2): their cited revision `33d62d60a9f1d469` / 51,097 B / +400,-0 / pointer 0 == MY OWN
   independent read of the same instant. FIRST RUNG IN THIS EXCHANGE THAT NEEDED NO RECONCILIATION —
   the rule working on its first application rather than being argued for.
3. BUT THE FILE HAS NOT SETTLED (this is the part that matters downstream): a 50 s window 10:16:45 -> 10:17:35
   moved it `33d62d60a9f1d469`/51,097 B/+400 -> `743539facfa6342c`/51,652 B/+406, pointer still 0.
   So a revision-bound verdict against this file is still impossible; it must pin a named revision and re-check.
4. BOUND, stated not inferred: I can measure that the file moved, and I CANNOT attribute the write —
   bytes carry no writer identity, and I did not watch the writer. Whether this is a new turn or a
   flushing edit is not something this reading can decide.
5. ATTRIBUTION BOUND on point 3: "copy the arrangement, not the content" is carried as MY words; it is
   NOT in my written record (grep over evidence/review + .mpd/plans: 0 hits). That is expected — my
   messages are not on disk unless I write them — so this is a BOUND, not a defect: if the 2b report
   quotes it as an authored citation, the only source is a message, and messages are not durable.
   Quote it as the nomination it is, not as a citation with a hash behind it.
