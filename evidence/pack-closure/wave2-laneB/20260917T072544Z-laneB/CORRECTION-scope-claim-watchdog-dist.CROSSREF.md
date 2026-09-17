# CROSS-REFERENCE — the two lanes' records now point at each other (filed beside `CORRECTION-scope-claim-watchdog-dist.md`, not over it)

`watchdog-engineer` (lane C) answered the correction and mirrored it on its own side. Filed here so the
reviewer can walk from this lane's record into theirs without reconstructing anything.

## Lane C's record (their files, quoted as reported to me)

- `evidence/team-watchdog/lane-c-2a/20260917T074144Z/raw/readings.log` — **ADDENDUM 9** (append-only; the
  sealed terminal text stays).
- `result.json` — amendment **A9**.
- What those record: `t10` is at **revision 6**, `inScope` includes
  `packages/mpd-team-watchdog-plugin/{src,test,dist}/**` plus `lib/scheduler.js`,
  `agent-references/troubleshooting.md` and `evidence/team-watchdog/**`; the stored `changedPaths` lists
  `dist/index.js`; therefore the wording is from here on **"the dist is DECLARED (revision 6, the hop)"**,
  and their earlier phrase "ONE DECLARED DEVIATION: dist/index.js is rebuilt although the contract's
  inScope names src/**" is historical-window-only. My 07:33Z and 07:38Z readings are filed there as the
  INTERMEDIATE states of the sha timeline, not as contradictions.

## The flag, run by both lanes now

Lane C ran it before answering (they would not accept a flag a second time on someone else's reading):
`--only mpd-team-watchdog-plugin --quiet` → exit 0; `--only packages/mpd-team-watchdog-plugin --quiet` →
exit 0, `ok: 1/1 targets fresh (each rebuilt twice, byte-identical)`. With my two runs (`--only
mpd-ext-plugin`, `--only packages/mpd-tui-plugin`, both exit 0) the flag is confirmed by four measured runs
in two lanes, against the script's own USAGE line.

## The instance that sharpens the carry-forward row (lane C's own route)

At completion-attempt time the platform refused: `implementation t10 cannot complete: 1 changed path(s) not
covered by inScope: packages/mpd-team-watchdog-plugin/dist/index.js is undeclared`. Lane C's account of the
three routes is the part worth keeping: (a) leave a shared gate red, (b) rebuild undeclared and be refused,
(c) **request the hop with the exact amendment text, keep the task in_progress with the reason recorded, and
re-submit after the read-back** — which is what it did, and it cost one message and no work. It also states
plainly that it never dropped `dist/index.js` from `changedPaths` to force a pass, "because the green gate
would then have been a lie about the shipped artifact".

That sentence is the general rule, and it matches this lane's own handling on `t9`/`t26`: a red is REPORTED
with its cause and its clearing command, never reshaped into a green; and a declared path is never
undeclared to satisfy a validator.
