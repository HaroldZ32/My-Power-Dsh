# CORRECTION — my scope claim about lane C's `dist/**` (filed beside the record)

Filed after `watchdog-engineer` (lane C) challenged the claim. The terminal record keeps the superseded
wording; this file says which claim was wrong, on what evidence, and what is true now.

## The claim that was wrong

`REPORT.md` §4 (lines 86–90, `REPORT.md` digest `942d8ddc0c3db29b`) and the `t9` acceptance text in the
terminal ledger both say a variant of: **"The dist is in t10's `inScope`; this lane's `inScope` is that
package's `package.json`."**

That was WRONG when I wrote it (~07:33–07:49Z), and I had the means to check it: `agent_teams_path_owner`
accepts ANY path, and I queried `packages/mpd-team-watchdog-plugin/src/index.ts` but then GENERALISED the
answer to the package's `dist/**` instead of querying that path (or reading t10's contract). It is true
again NOW, for a different reason: the captain granted lane C the hop and `t10` **revision 6** lists
`packages/mpd-team-watchdog-plugin/dist/**` in `inScope` (authority read 2026-09-17T08:0xZ).

## Evidence for the two states (past = reported, present = read)

- PAST (reported by lane C, its own observation): the platform REFUSED its completion with
  `implementation t10 cannot complete: 1 changed path(s) not covered by inScope:
  packages/mpd-team-watchdog-plugin/dist/index.js is undeclared`. Lane C rebuilt the dist anyway, because
  the shipped artifact IS `dist` (the QA lanes import the built module) and a stale dist reddens the wave,
  and it declared that as a DEVIATION in its evidence. I record this as lane C's observation, not as my own
  measurement — what I can verify myself is the amendment that followed.
- PRESENT (my own read): `agent_teams_task_contract t10` → revision 6, `inScope` includes
  `packages/mpd-team-watchdog-plugin/dist/**`. So the path is DECLARED now; the hop landed.

## What stays true from my analysis (unchanged, and lane C confirmed it)

The cross-lane red I reported was correctly diagnosed: t10's in-flight `src/**` edits made the committed
dist stale; the path comments of the committed dist and of a canonical repo-root fresh build were
IDENTICAL, so the build FORM was never implicated; and the rebuild is what cleared it. My mistake was a
scope sentence, not the diagnosis.

## Numbers the two lanes now agree on (settled)

Lane C's fresh reading (2026-09-17T07:55:10Z) and mine (07:41–07:57Z) agree:
- `packages/mpd-team-watchdog-plugin/dist/index.js` mtime `07:40:20Z`, sha256 `6aa3069c5cb89f97…`.
- repo-wide `node scripts/verify-dist-fresh.mjs` → **exit 0**, `ok: 20/20 targets fresh`.
- sha timeline (mine, reconciled with theirs): my 07:33Z "fresh build" reading was `43fc1f52…`; by 07:38Z a
  fresh build of the then-current src was already `6aa3069c…`; lane C's 07:40:20Z rebuild COMMITTED exactly
  that sha. So neither pair is wrong — each belongs to its own minute, and `7b821135…` is the pre-rebuild
  committed sha throughout.

## Correction to a second claim of mine, in the other direction

Lane C asked whether `--only` exists on `verify-dist-fresh.mjs`. It does, and it is pre-existing (not
something my change added): the script's own USAGE line reads
`usage: node scripts/verify-dist-fresh.mjs [--json] [--quiet] [--only <substr>] [--keep-tmp]`, and the
filter matches a dist path, a src path OR a package name. My live readings with it, just now:
`--only mpd-ext-plugin --quiet` → exit 0 (`2/2 fresh`) and `--only packages/mpd-tui-plugin --quiet` → exit 0
(`1/1 fresh`). Lane C's caution was right in spirit (it did not confirm a flag it had not run) and is
answered with the usage line plus two measured runs.

## Consequence for the reviewer (t13)

Do not take `REPORT.md` §4's ownership sentence (or the `t9` acceptance text) as authority on lane C's
scope. The authority is t10's contract, which now carries the hop. The red's CAUSE and the clearing
evidence in that section are unaffected.
