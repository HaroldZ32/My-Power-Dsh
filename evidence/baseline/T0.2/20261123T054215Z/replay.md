# T0.2 ordinary member tool surface

The November 23 capture comes from a Senior Engineer execution seat on a real DSH `0.2.2-rc.5` boot using `mpd-headless`, pinned Bun `1.4.0`, and Node `v24.21.0`. The headless profile mounted the MPD tools through its profile rows. It declared the `mpd` preset row, and the boot reported that row pending while waiting for `agentPresets`. The harness wrote `request/header` at `2026-11-23T05:42:15.996Z` in the assigned member's session. In the same turn that session called `agent_teams_task` to complete its assigned row `T5`. The persisted result matched the call ID with `isError: false`, and the board row ended `completed`. The loopback model script selected the action. The harness mounted the tools, dispatched the member, executed the action, and recorded the events. [Capture receipt](./capture.json) · [Request header tool array](./member-request-header.json)

The October 27 record was the main turn of a `dsh-tui` boot on DSH `0.2.1-rc.3` and MPD `0.16.1`. The historical and current requests differ in bundle revision, host version, profile, and seat. The measurement captures their combined effect. It cannot attribute every name change to one variable. [Historical mount report](../../../cellwork/diag-mount/2026-10-27T02-01Z/README.md) · [Original historical header](../../../cellwork/diag-mount/2026-10-27T02-01Z/registration/request-header-record.json)

| Request | Tools | Tool objects | Array bytes | Total bytes | Estimated tokens at 4 bytes/token |
| --- | ---: | ---: | ---: | ---: | ---: |
| November 23 Senior Engineer | 125 | 127,363 | 126 | 127,489 | 31,872.25 |
| October 27 main turn | 117 | 93,071 | 118 | 93,189 | 23,297.25 |
| Difference | +8 | +34,292 | +8 | +34,300 | +8,575 |

Both totals count UTF-8 bytes of ECMAScript `JSON.stringify(data.header.tools)` with no replacer or indentation. Each family sums the entire JSON object for each of its tools. Array bytes are two brackets and one comma per adjacent pair. Header envelope bytes are zero. The ratio produces a schema-only estimate. Provider tokenization, request framing, instruction text, and task content were outside the measurement. [Family sums, input digests and name changes](./surface.json)

Fifteen definitions entered the surface and seven left it. Added tool objects contributed 14,053 bytes and removed objects accounted for 6,068 bytes. Definitions present in both captures grew by 26,307 bytes. Cellwork alone grew by 23,825 bytes across its tools, including 3,340 bytes for `cellwork_consult`, `cellwork_delegate`, and `cellwork_open`. The captured names also show the worktree, asynchronous consult, and workmate additions. The per-name lists in `surface.json` distinguish additions and removals from changes to existing schema text.

## Replay the saved comparison

Run from the feature checkout. This check uses Node `v24.21.0`, the two checked-in headers, and the baseline CLI. It needs no DSH or Bun installation.

```sh
set -eu
saved=evidence/baseline/T0.2/20261123T054215Z
prior=evidence/cellwork/diag-mount/2026-10-27T02-01Z/registration/request-header-record.json
scratch=$(mktemp -d "$PWD/.qa-v2-t02-replay-XXXXXX")
sh "$saved/capture.sh" --self-test
node scripts/baseline/tool-surface.ts "$saved/member-request-header.json" "$prior" 4 > "$scratch/saved-surface.json"
cmp "$saved/surface.json" "$scratch/saved-surface.json"
```

The original integrated build inventories are preserved and byte-identical. They fingerprint the Team, Cellwork, and DSH adapter source and distribution bytes at the time of the November 23 measurement. [Before inventory](./build-before.txt) · [After inventory](./build-after.txt) · [Original checks](./output.log)

## Mount a fresh working member

Use the checkout under test as the current directory and install the normal checkout dependencies. Point `PINNED_DSH` at a `dsh` executable from `@deepseek-ai/dsh@0.2.2-rc.5` and `PINNED_BUN` at a Bun `1.4.0` executable. The defaults are `.qa-tmp/dsh-022/bin/dsh` and `.toolchain/node_modules/.bin/bun`. An isolated npm prefix can provide the DSH installation with `npm install --global --prefix "$prefix" @deepseek-ai/dsh@0.2.2-rc.5`, using an absolute scratch path for `prefix`. The harness reads the checkout's distribution files through the dev profile installer.

The checked-in driver provisions a fresh headless profile, workspace, and loopback provider. The captain creates, approves, and dispatches an ordinary Team task. The driver reads the assigned member’s own request header and matches its successful `agent_teams_task complete` result to the board. This route works without the earlier Cellwork investigation driver. The original capture came from a Cellwork execution board on a different integrated build. Counts and schema bytes from a fresh boot describe the checkout tested in that boot. The output contains the request-specific tools, joined receipt, and pre- and post-run source and distribution fingerprints. Full session and boot logs stay in isolated scratch. [Mount wrapper](./capture.sh) · [Capture driver](./capture-driver.ts) · [Dev-based feature checkout receipt](./feature-replay.md)

```sh
sh "$saved/capture.sh" --out "$scratch/result"
node scripts/baseline/tool-surface.ts "$scratch/result/member-request-header.json" "$prior" 4 > "$scratch/fresh-surface.json"
cmp "$scratch/result/build-before.txt" "$scratch/result/build-after.txt"
```

## Missing and malformed controls

From the same checkout, reuse `prior` and `scratch` from above. Each command exits 3, prints `UNMEASURED`, leaves `comparison` null, and continues to report the 117-tool historical input independently.

```sh
printf '%s\n' '{ incomplete' > "$scratch/invalid-json.json"
printf '%s\n' '{"type":"request/header","seq":1,"time":0,"data":{"header":{"tools":[{"name":"broken","description":"fixture","parameters":[]}]}}}' > "$scratch/invalid-header.json"
for input in missing invalid-json invalid-header; do
  status=0
  node scripts/baseline/tool-surface.ts "$scratch/$input.json" "$prior" 4 > "$scratch/$input-result.json" || status=$?
  test "$status" -eq 3
  node -e 'const r = require(process.argv[1]); if (r.status !== "UNMEASURED" || r.comparison !== null || r.historical.toolCount !== 117) process.exit(1)' "$scratch/$input-result.json"
done
```
