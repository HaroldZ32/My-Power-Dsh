# PREPARED, NOT APPLIED — the `commandsRun` branch of `evaluateQualityCompletion()` (message split)

Prepared by lane A at 2026-09-17T09:45Z. **Not applied** — lane A holds no task in wave 2b and this file
sits inside the wave-2b plan's write sets; applying it from here would move a path without a contract.
The arm beside this file (`arm.mjs` / `arm.out.txt`) is its acceptance instrument: case A must print a
message that NAMES the missing `commandsRun`, case B must stay `{"ok":true}`, and cases C/D/E must be
byte-identical to the current revision's results.

Module revision this text was taken from: sha256 `1b0eb60e61765f5eb55dfab94bdeed5fff916a4b8d2fb9081fde5ec9ed4f4ad6`.

## Current (byte-exact from the file at the revision below)

```js
        if (nextStatus !== 'completed')
            return { ok: true };
        const acceptanceResults = update.acceptanceResults ?? task.acceptanceResults;
        if (acceptanceResults === undefined || !acceptanceCovered(task.acceptance, acceptanceResults)) {
            return { ok: false, error: `${kind} completion requires passed acceptanceResults for every acceptance item` };
        }
        if (commands === undefined || !verifyCovered(task.verify, commands)) {
            return { ok: false, error: `${kind} completion requires a passed commandsRun entry for every verify command` };
        }
```

## Proposed

Replace ONLY the second `if` with two branches. The first branch keeps the CURRENT text, because it is
accurate whenever the contract really declares commands; only the missing-list case gets new text:

```js
        if (commands === undefined) {
            return {
                ok: false,
                error: `${kind} completion requires commandsRun — none was supplied. Pass the commands you ran;`
                    + ' when the contract declares no verify command and the seat could run none, pass an empty list.',
            };
        }
        if (!verifyCovered(task.verify, commands)) {
            return { ok: false, error: `${kind} completion requires a passed commandsRun entry for every verify command` };
        }
```

Behaviour is identical on every pass/fail path; only the refusal TEXT for a missing list changes, and it
now names the truthful payload.
