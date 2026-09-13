# t15 — carrier-hook mount proof (session level)

**Task**: t15 · verification · **Verifier**: Reviewer (read-only; no repo file modified)
**Pin**: HEAD `32ae54dd` — repair **staged, uncommitted** (52 staged paths, porcelain 62)
**Deliverable verdict line**: **C6 mount-proof half: STILL OPEN (reason in §4).**

## 1. What was built (and how)

Sandbox `repair-verify/raw/mount-proof/` (untracked; nothing written into the tracked tree):

1. **Packed bundle copied into the sandbox** — `cpSync(<repo>/dist/mpd-package, <sandbox>/mpd-package)`
   (read-only source; the pack is the one t11 verified current: all three packed `cli.js` = vendor pins,
   0 HDL/RTL content).
2. **Bundle installed into a sandbox profile** — `dsh plugin --profile mpd-headless add <sandbox>/mpd-package`
   with `DSH_HOME=<sandbox>/dsh-home`, `HOME=<sandbox>/run-home` and sandbox `npm_config_store_dir` /
   `npm_config_cache` (the first attempt failed: `pnpm failed in profile directory …` because the isolated
   `HOME` starved pnpm's store — the same class t4 F3 recorded). With store/cache redirected the install
   **succeeded (exit 0)**: `dsh: initialized profile mpd-headless at …/dsh-home/profiles/mpd-headless`.
3. **`@mpd-dsh/silicon` genuinely installed** — `npm pack <sibling>` was attempted first and failed
   offline (`npm error Log files were not written … /root/.npm/_logs`), so the package was installed as a
   **real package directory** (a copy, never a symlink): `package.json` + `presets/` copied into
   `<sandbox>/node_modules/@mpd-dsh/silicon`, `<sandbox>/mpd-package/node_modules/@mpd-dsh/silicon` and
   `<profile>/node_modules/@mpd-dsh/silicon`.
   **Planted profile file: `10327 B`, `sha256 1ff65b7c…`, byte-identical to the sibling's
   `presets/rtl-ip.profile.json`, `isFile: true` (not a symlink).**
4. **Resolution proof from the plugin's own location** (the hook's candidate (a)):
   `createRequire("<sandbox>/mpd-package/packages/mpd-agent-teams-plugin/lib/index.js")
   .resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json")` →
   `RESOLVED <sandbox>/mpd-package/node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json`.
   So the package is genuinely resolvable by the hook's first candidate — no env var, no symlink trick.
5. **Stub model** (the QA smoke pattern): local HTTP server on `127.0.0.1:0`, profile patch row
   `- id: llm-deepseek` with `baseURL: http://127.0.0.1:<port>/v1` + `apiKeyEnv: DEEPSEEK_API_KEY`
   (throwaway key). The profile patch template ships an empty top-level array `[]`; the stub row
   **replaces** it (appending after `[]` yields a second YAML document and the boot dies with
   `failed to parse … cordis.patch.yml: YAMLException: end of the stream or a document separator is
   expected (6:1)` — observed, then fixed).

## 2. What was OBSERVED

| Observation | Result |
|---|---|
| Sandbox profile install | **exit 0** (`dsh: initialized profile mpd-headless`) |
| `@mpd-dsh/silicon` resolvable from the plugin lib dir | **RESOLVED** (path above) |
| Planted profile file | **10327 B**, sha = sibling sha, `isFile: true` |
| Boot #1 (before the YAML fix) | **exit 1** — `failed to parse … cordis.patch.yml` |
| Boot #2 (YAML fixed) | **exit 124 — harness timeout (1700 s); the session HUNG** |
| Model requests received by the stub | **0** in both boots |
| Agent-teams `config.profiles` observation (present direction) | **NOT OBSERVED** |
| Sibling-absent direction | **NOT REACHED** (the harness never completed a present-direction session) |

Raw logs: `raw/mount-proof-run.log`, `raw/mount-proof-result.json` (stale-but-real run-#2 record:
`present.exit 1`, `stubCalls 0`), `raw/mount-proof/boot-manual.log` (parse error), `raw/t15-evidence-snapshot.txt`,
harness `raw/mount-proof-harness.mjs`.

## 3. Why this is NOT a substitute for the obligation

Nothing here is offered as the session-level merge evidence. No `--dump-config` was used and none is
cited; no function-level probe is reported as a session result. The only merge evidence that would
satisfy C6 is a live session whose prompt/tool surface carries both `mpd` and `rtl-ip`.

## 4. Exact blocker

The boot reaches profile composition and then never issues a model request: boot #1 died in composition
(my malformed patch append — since fixed), and boot #2 produced **0** requests and hung until the outer
timeout (`timeout 1700` → exit 124), so the session's prompt was never captured.

Failing command (reproducible):

```
DSH_HOME=<sandbox>/dsh-home HOME=<sandbox>/run-home DEEPSEEK_API_KEY=sk-t15-local-stub \
  dsh --profile mpd-headless "prove the mount"
# observed: exit 1 with the pre-fix patch (parse error); after the fix: no model request, session hangs
#           (harness killed at 1700 s, exit 124)
```

Most likely causes, in order: (i) the stub's minimal SSE reply is not accepted by this harness build's
model client, so the session waits without ever counting a request at the stub; (ii) the profile needs
the harness's own credential/`settings.yaml` handling before it will call the provider at all. The QA
case `skills/dsh-qa/scripts/software-smoke.mjs` already solves both (it emits a complete
`chat.completion.chunk` sequence with tool calls and asserts a real write/bash round-trip), so the next
attempt should reuse its `makeStub` verbatim rather than a reduced reply, and run the boot with a longer
budget while streaming the session log.

## 5. Repo untouched

```
$ git status --short          # 62 entries: 52 staged repair paths + untracked evidence dirs
$ git rev-parse --short HEAD  # 32ae54d
```
Tracked-modified-or-staged entries = **52** — identical to t11's baseline; every artifact of this task
lives under `evidence/rtl-extraction-residual/repair-verify/`.

## 6. Retry (packed-copy layout + FULL OpenAI-shaped stub) — same verdict, sharper blocker

After the fixes in §4, the experiment was re-run end-to-end with a complete SSE stub (multi-chunk
`chat.completion.chunk` stream, tool-call branch, `text/event-stream` headers) modelled on
`software-smoke.mjs`'s `makeStub`; harness `raw/mount-proof2-harness.mjs`, result
`raw/mount-proof2-result.json`, boot logs `raw/mount-proof2/boot-*.log`.

| Step | Retry result |
|---|---|
| Sandbox profile install (`dsh plugin … add`, store/cache redirected) | **exit 0** |
| `@mpd-dsh/silicon` planted (real directory) | **10327 B, isFile true** |
| Present boot | **killed at the 420 s cap (exit null, SIGKILL); 0 model requests** |
| Absent boot | **killed at the 300 s cap; 0 model requests** |
| Profile observation | **NOT OBSERVED** |

**What the boot log proves (and why this is the precise blocker):** the session really boots and mounts
rows — `[mpd-dsh-adapter] mpdDsh provided`, `[mpd-bootstrap] skill corpus served from <sandbox>/mpd-package/skills`,
`[mpd-codegraph] init status=no-binary` — but it issues **no** model request within 420 s, so the merged
profile set is never rendered into a prompt that could be captured. The stall follows the MCP rows
(`CodeGraph MCP skipped: codegraph binary not found` appears twice) and is not a credential error
(`MISSING_CREDENTIAL` never appears).

**Revised next step** (narrower than §4's): boot with the MCP rows disabled (or with a codegraph binary
present) so the session reaches the model turn, then capture the first request; only then can the
`mpd` + `rtl-ip` listing be asserted. Everything else in the harness is already correct and reusable.

**C6 mount-proof half: STILL OPEN (two full-stub attempts: 0 model requests; present boot killed at
420 s, exit null).**

## 7. Decisive constructibility result — the outside-the-repo walk-up level is NOT writable here

The captain's hint names the one legitimate layout that needs no repo write: the bundle-relative walk-up
reaches **outside** the repository (`/root/dshProj/node_modules/@mpd-dsh/silicon`), where a genuine
sibling install would be found. I attempted exactly that, read-only repo preserved:

```
$ mkdir -p /root/dshProj/node_modules/@mpd-dsh
mkdir: cannot create directory '/root/dshProj/node_modules': Read-only file system   # exit 1
$ ln -sfn /root/dshProj/my-power-dsh-silicon /root/dshProj/node_modules/@mpd-dsh/silicon
ln: failed to create symbolic link '…': No such file or directory                    # exit 1
$ node -e 'createRequire("<repo>/packages/mpd-agent-teams-plugin/lib/index.js")
            .resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json")'
UNRESOLVED MODULE_NOT_FOUND
```

**`/root/dshProj` is mounted read-only in this session**, and no sandbox escalation is available
(approval prompts are disabled by policy), so the outside-the-repo level cannot be populated. Combined
with §6's stall (the session mounts rows but never reaches the model turn in the packed-copy layout),
**the mount-proof half is not constructible in this environment** — and per the task's rule I did not
improvise a proxy.

Sibling profile source recorded for the retry: `/root/dshProj/my-power-dsh-silicon/presets/rtl-ip.profile.json`,
**10327 B, sha256 `1ff65b7c7aca8fde…`** (the same bytes planted and verified resolvable in §1–§2).

**Final status: C6 mount-proof half — STILL OPEN (not constructible here: outside-the-repo level is on a
read-only filesystem; packed-copy layout stalls before the model turn).**

## 8. The unreadable/absent lanes — answered by code, with the codes that were actually measured

Adopting the captain's option (2) in substance: the lanes were driven **from the verbatim function body**
(t11's `probes-t11.mjs`, 53-line slice sha `5b40c5b180a8…`) against the **real filesystem**, not a mocked
`fs`, because the sandbox let me create the offending objects honestly. Measured codes and outcomes:

| Lane (constructed) | `readFileSync` code | Result | Warning count |
|---|---|---|---|
| valid nearest (level 0 of the probe tree) | — | `rtl-ip` merged, `mpd` kept | **0** |
| corrupt nearest + valid farther | parse failure | `{}`, farther **not** merged | **1**, names the corrupt path |
| unreadable nearest — true symlink cycle (`ELOOP`) | **`ELOOP`** | `{}`, farther not merged | **1** |
| all unreadable (`ELOOP` at two levels) | **`ELOOP`** | `{}` | **1** |
| all corrupt | parse failure ×2 | `{}` | **1** |
| all absent | **`ENOENT`** | `{}` | **0** (silent — correct) |
| dangling symlink nearest + valid farther | **`ENOENT`** | farther **merged** | **0** (the named residual) |

`EISDIR` and `ENOTDIR` were additionally measured at the fs level (`raw/t11-hook-errcode-mechanics.txt`:
directory in the slot → `EISDIR`; parent is a file → `ENOTDIR`), which is why `ELOOP` was used for the
region lanes — it reproduces the ruling's "present but unusable" shape and is uid-independent
(`chmod 000` is a no-op as root, measured `READ OK`).

So the source behaviour is confirmed: **`ENOENT` → continue; every other error → one warning + `return
{}`**, with the walk stopping at the first non-ENOENT candidate (one `readFileSync` call in those lanes).
The Senior Engineer's "EISDIR → 0 warnings" observation is therefore a probe-construction artefact — the
walk reaches the earliest candidate that EXISTS, and their planted object evidently was not on it (levels
1–3 are always checked first and are absent in the repo layout). That is a *branch* answer, not a session
answer: it does not move the C6 line, which needs the boot half.

## 9. C6 MOUNT-PROOF HALF — **CLOSED** (authorized closure update)

**Authority**: the captain closed this half from the Architect's t16 lane and authorized this single-file
update. **Independence**: I re-read the two result artifacts myself before writing this line — the values
below are what the files contain, not what a summary claimed.

| Lane | Artifact | exit | model requests | apply crash | warnings | merged set observed |
|---|---|---|---|---|---|---|
| **Present** (silicon genuinely installed) | `raw/t16c-present-result.json` | **0** | **3** | `false` | **0** | `systemHasRtlIp: true`, `hasMpdInListing: true` |
| **Absent** (falsification side) | `raw/t16b-absent-result.json` | **0** | **3** | `false` | **0** | `hasRtlIp: false` (silent `{}`) |

The captured system prompt carries the consumer's own listing, verbatim:

```
Configured team profiles (pass profile= to agent_teams_create):
- rtl-ip (7 members, captain planning): RTL-IP SWIMLANE FLOW …
- mpd (11 members, captain planning): Read-only members (Architect, …) …
```

**Roster intact**: the team records created in that sandbox are `mpd`-profiled with `members = 11`
(`ws/.mpd/team/mpd-default*/team.json`) — the merge did not disturb mpd's roster. **Roundness note**:
the merge is proven at the **listing level** (what the agent-teams consumer shows the model), not by an
`rtl-ip`-profiled team record.

**Why my two attempts stalled — harness defect, not session defect**: pointing `MPD_CODEGRAPH_BIN` at the
repo's `.toolchain` binary removes the `CodeGraph MCP skipped` stall and the session reaches the model
turn (0 requests → **3 requests**). My §6/§7 mechanism findings (MCP-layer startup stall; read-only
outside-repo walk-up level) therefore described my harness, not the product — the closure supersedes the
STILL OPEN lines in §6–§8, which are kept as the historical record they are.

**Final line: C6 mount-proof half — CLOSED (present lane: exit 0, 3 requests, `rtl-ip` + `mpd` in the
consumer listing, roster intact; absent lane: exit 0, 3 requests, zero warnings, silent `{}`).**


---

## 9.1 CORRECTION to §9 (added after the Architect's measurement; §9's causal claim is superseded)

Two statements in §9 above are wrong or outdated and are corrected here rather than rewritten in place:

1. **My stall attribution is DISPROVED.** §9 credits `MPD_CODEGRAPH_BIN` with clearing a `CodeGraph MCP
   skipped` stall. The Architect's control: the packed layout **still stalled** (0 requests, 180 s kill)
   with `MPD_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`, `MPD_DSH_GITBASH_CLI` and `MPD_DSH_LSP_CLI` all
   pinned, while the same stub in the correct profile answered 2 requests and exited 0 in **5.6 s**. The
   real mechanism is **row composition**: a profile built by `dsh plugin add <pack>` alone carries **105**
   composed rows versus **108** for the working headless profile — the missing `code-runtime`,
   `headless-runner` and `headless-startup` rows drive the one-shot prompt, so the process booted the
   plugin tree and waited forever. Third trap on that path: the install-profile home patch re-inserts the
   mpd rows with repo paths, duplicating ids after the layer swap (`duplicate loader entry id:
   mpd-web-compat`); reducing the home patch to the provider row clears it.
2. **The §9 "roundness note" is SUPERSEDED.** It said the merge was proven at listing level only, with no
   `rtl-ip`-profiled team record. The Architect's tool-sequence run drove a real
   `agent_teams_create(profile: "rtl-ip")` to success — after deleting the session's auto-provisioned
   default team — and the resulting `team.json` carries `profile: "rtl-ip"` with the seven rtl-ip members.
   Full report: `repair-verify/t16-mount-proof-retry.md`.

**Verdict unchanged: C6 mount-proof half — CLOSED** (present: exit 0, 3+ requests, `rtl-ip` + `mpd` in the
captured listing, roster intact, `rtl-ip` team record proven; absent: exit 0, zero warnings, silent `{}`).

---

## 10. t15 disposition (attempt 2) — closure CONFIRMED in the raw artifacts

Reassignment reason: t15's obligation was satisfied in the captain's t16 lane; this attempt **confirms**
it rather than re-running it, and does not touch any other lane. Everything below is read from the
artifacts themselves, not from a summary.

| Verification | Command / artifact | Observed |
|---|---|---|
| Repo untouched | `git status --short` | **62 entries**, 49 tracked changes (other lanes' staged work); no file written by this attempt |
| Region present | `grep -n 'rtl-ip-carrier' lib/index.js lib/mpd-deltas.js` | `index.js:117`/`:192` (region), `mpd-deltas.js:175` (id) + `:182` (block) |
| Present lane | `raw/t16c-present-result.json` | exit **0**, requests **3**, `applyCrash false`, `warnCount 0`, `systemHasRtlIp true`, `hasMpdInListing true`; listing carries `rtl-ip (7 members` **and** `mpd (11 members` |
| Absent lane | `raw/t16b-absent-result.json` | exit **0**, requests **3**, `applyCrash false`, `warnCount 0`, no `rtl-ip` in the listing |
| Mpcs roster | sandbox `ws/.mpd/team/mpd-default*/team.json` (per t16 report) | `mpd`-profiled, `members = 11` — merge did not disturb the roster |
| Consumer-level proof | `t16-mount-proof-retry.md` (11 045 B) | real `agent_teams_create(profile: "rtl-ip")` succeeded; resulting `team.json` carries `profile: "rtl-ip"` with the seven members |

**Not reproduced by this attempt (stated, not passed):** no new boot was run here — the session-level
evidence is the t16 lane's, which I re-read field by field; my own earlier two boots remain the historical
§6–§8 record with their superseded causal reading corrected in §9.1.

**Line for the ledger: C6 mount-proof half — CLOSED** (present lane exit 0 with both profiles in the
consumer listing and the roster intact; absent lane exit 0 with zero warnings and a silent `{}`).
