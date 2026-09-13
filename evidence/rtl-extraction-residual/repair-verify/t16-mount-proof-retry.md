# t16 — C6 session-level carrier-hook proof (mount-proof retry)

**Task**: t16 · verification round 1 · **Verifier**: Architect (read-only role; every artifact written by this task lives under `repair-verify/`)
**Attempt**: 1 · `a48fc71d-4722-4dc3-99bb-3f39ab98da47`
**Pin**: HEAD `32ae54dd` — repair **staged, uncommitted** (porcelain 62 / staged 52, identical to the t15 baseline)
**Deliverable verdict line: C6 mount-proof half: CLOSED (evidence in §4).**

This supersedes t15's NOT-PROVEN half. t15's PROVEN half (sandbox prerequisites + resolvability) is carried
forward and re-measured, not re-derived.

---

## 1. Reused from t15 (no re-derivation)

| t15 prerequisite | Re-measured here |
|---|---|
| Isolated `DSH_HOME`/`HOME` + store/cache redirection (`npm_config_store_dir`, `npm_config_cache`, `PNPM_HOME`) so pnpm is not starved by the isolated HOME | reused verbatim; `install-profile.mjs` exit **0** |
| `@mpd-dsh/silicon` installed as a **real package directory** (never a symlink), `package.json` + `presets/` copied | planted at three node_modules locations under the sandbox; `isFile: true` |
| Planted profile file byte-identical to the sibling's | **10 327 B**, `sha256 1ff65b7c7aca8fde0722ad6f8cf1d99d0ed966ed4b06081db3411450c5c49ea6` — equals the sibling's sha |
| Resolvability from the hook's first candidate | `createRequire(<sandbox>/mpd-package/packages/mpd-agent-teams-plugin/lib/index.js).resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json")` → **RESOLVED** `<sandbox>/mpd-package/node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json` |
| Trap: the patch template ships `[]` — the stub row must REPLACE it | applied; no YAMLException |

## 2. Root cause of the t15 stall (new — and the handover's MCP hypothesis is disproved)

t15 recorded "0 model requests, exit 124" and suspected the stub's SSE reply. Both are wrong:

1. **The pack-only profile has no headless driver rows.** Composed row sets, same harness, two layouts:
   `pack-only = 105 rows`, `install-profile headless = 108 rows`; **the three rows present only in the
   working layout are `code-runtime`, `headless-runner`, `headless-startup`** — the rows that drive a
   one-shot prompt. Without them the process boots the plugin tree and then waits forever: no model
   request is ever issued. (Composition evidence only; the row-set diff is a diagnosis, not load proof.)
2. **The stub was never the problem.** The identical SSE stub in the working layout answered
   **2 requests** and the session exited **0 in 5.6 s** (`t16-diag2`: `stubRequests: 2`, log tail
   `diag2-ok`), with the same provider-row patch (id-target `llm-deepseek`, `baseURL` → local stub).
3. **The MCP rows are not the blocker either.** The pack-only layout still stalled with every MCP
   binary/CLI pinned (`MPD_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`, `MPD_DSH_GITBASH_CLI`, `MPD_DSH_LSP_CLI`)
   — 180 s cap, **0 requests**, log ending at the same place. The working lanes compose the same MCP rows.

## 3. The lane as built

1. `install-profile.mjs --yes --dsh-home <sb>/dsh-home --profile mpd-headless --skip-toolchain` → exit 0
   (supplies the headless driver rows).
2. `dsh plugin --profile mpd-headless add <sb>/mpd-package` → exit **0**: the profile's
   `@mpd-dsh/mpd` dependency now resolves to the **packed copy**, which is what the hook's
   candidate walk must see. (`remove` of the repo layer exited 1 and is unnecessary once the dep points
   at the pack.)
3. **Obstacle and fix:** the home patch written by `install-profile` inserts the mpd rows with **repo
   absolute paths**, so after the swap the pack layer's identical ids collided —
   `failed to apply loader entry include (cordis:include): duplicate loader entry id: mpd-web-compat`
   (boot exit 1 in 196 ms). Fix: the home patch is reduced to the **provider row only**; the pack bundle
   patch supplies the whole row set. Boots then compose cleanly.
4. Silicon planted as a real package dir (step 1 of §1) + resolution probe.
5. Boots: `dsh --profile mpd-headless "<prompt>"`, **stdio to files** (never pipes), 240 s cap with
   SIGKILL on expiry, stub logging every request.

## 4. Results — all from captured session artifacts

### 4.1 Live session reached the model (both lanes)

| Lane | exit | elapsed | requests | tools offered | `agent_teams_create` offered | apply crash | warnings |
|---|---|---|---|---|---|---|---|
| **present** (silicon planted) | **0** | 62.2 s | **3** (and **5** in the tool-sequence run) | 86 | yes | no | **0** |
| **absent** (silicon dirs removed) | **0** | 63.7 s / 4-request run | **3** (4 in the bounded absent probe) | 86 | yes | no | **0** |

The session log ends with the model's own final text (`t16-done`), i.e. a completed turn — not a timeout.

### 4.2 Present lane — the merged profiles, verbatim from the captured system prompt

```
Configured team profiles (pass profile= to agent_teams_create):
- rtl-ip (7 members, captain planning): RTL-IP SWIMLANE FLOW (skills/rtl-ip-flow is the binding execution
  contract). Gate semantics: EVERY diamond is passed by a Reviewer check (red and green alike — Reviewer/Plan
  Reviewer findings must be clear before any review completes); the
- mpd (11 members, captain planning): Read-only members (Architect, Researche…
```
Source: the captured system message, persisted in `raw/t16c-present-result.json` (`systemProfilesPresent`, first 1200 chars of the listing) and `raw/t16d-result.json` (`finalListing`); the per-request digests (roles, tool count) are in `raw/t16c-present-requests.jsonl`.

**BOTH** profiles are visible to the live session, with `mpd` intact (11 members, the roster description) —
i.e. the hook merged the silicon `rtl-ip` profile without displacing mpd's own.

### 4.3 Present lane — a real `agent_teams_create` under `profile: rtl-ip`

Stub-driven sequence (`raw/t16d-result.json`, 5 requests, exit 0):

1. `agent_teams_create { profile: "rtl-ip" }` → `Error: you already lead team "MPD Default"
   (id mpd-default-7eca0048). Use agent_teams_status and continue the existing team…`
   (the session-start team policy provisioned a default team; the refusal is **not** a profile error);
2. `agent_teams_delete {}` → **`Team "MPD Default" ended and archived.`**
3. `agent_teams_create { profile: "rtl-ip", approval: "required" }` →
   **`Team "t16-rtl-ip-team" plan created under …/ws/.mpd/team/t16-rtl-ip-team. It is staged: finish the
   roster and DAG, then wait for the user to edit and approve it.`**

On-disk corroboration: `<sb>/ws/.mpd/team/t16-rtl-ip-team/team.json` carries `profile: "rtl-ip"` and the
seven rtl-ip members (`Requirement Analyst`, `Spec Designer`, `RTL Code Engineer — Verilog/SV`,
`RTL Code Engineer — SpinalHDL`, `Verification Engineer`, `Reviewer`, `Plan Reviewer`) — the merged profile
was not merely *listed*, it was **instantiated**.

### 4.4 Absent lane — no `rtl-ip`, zero warnings

```
Configured team profiles (pass profile= to agent_teams_create):
- mpd (11 members, captain planning): Read-only members (Architect, Researcher, Planner, Explorer,
  Plan Reviewer, Vision Analyst) take requirements/review/analysis tasks only and never edit files.
  Workers (Senior Engineer, Junior Engineer, Deep Worker, Lea…
```
Source: the captured system message in `raw/t16c-absent-result.json` (`systemProfilesPresent` — `rtl-ip`
absent, `mpd` present) and `raw/t16f-absent-result.json` (4 requests, every request's listing free of
`rtl-ip`). `warnCount 0` in both absent runs — the contract's **silent `{}`** for a
missing file, not a warning, which is the required absent-direction behaviour.

## 5. C6 verdict

**C6 mount-proof half: CLOSED.** Six independent measurements on this pin support it: (a) both lanes reach
the model and complete a turn; (b) the present lane's captured prompt lists `rtl-ip` **and** `mpd`;
(c) the present lane instantiated a team under `profile: rtl-ip` (tool result + `team.json`);
(d) the absent lane's captured prompts list only `mpd`; (e) the absent lane emits **zero** warnings
(silent `{}`); (f) the planted package is the sibling's bytes and resolves from the plugin's own location.

Evidence hygiene stated explicitly: **no `--dump-config` result is used as load/session evidence** (the one
`--dump-config` call was used only to diagnose composition, and §2.1 labels the row-set diff as
composition-only), and **no region/file-level probe is presented as a session result**.

## 6. Honest limits

* The session-title generation request accounts for one of the three requests in a plain lane.
* `agent_teams_create` in a fresh sandbox is first refused by the session-start default team; the
  successful create therefore required the delete step (§4.3). This is harness policy, not hook behaviour.
* An extra absent-lane attempt to capture an "unknown profile" error looped and OOM-killed **my stub
  process** (`t16-lane5.mjs`); that was a harness bug (unbounded state machine), it is **not** evidence for
  or against the merge, and it was replaced by the bounded `t16-lane6.mjs` (4 requests, clean exit 0).
* The hook's internal branch matrix (corrupt / unreadable / ENOENT / dangling symlink) is the Reviewer's
  file-level work and is not re-run here.

## 7. Repo untouched

```
$ git status --short        # 62 entries: 52 staged repair paths + untracked evidence dirs
$ git rev-parse --short HEAD
32ae54d
```
`porcelain = 62`, `staged = 52` — **identical to the t15 baseline** (`raw/git-status-t15.txt`) and to the
t11 count. Every file this task created lives under
`evidence/rtl-extraction-residual/repair-verify/` (sandbox + logs + harnesses); no tracked file, no
`skills/**`, no `packages/**`, no `scripts/**` was written.

## 8. Raw inventory (this task)

| File | What it carries |
|---|---|
| `raw/t16-diag.mjs`, `raw/t16-diag-result.json`, `raw/t16-diag-boot.log` | packed-layout stall reproduction (0 requests, 180 s kill); also the MCP-pinned run |
| `raw/t16-diag2.mjs`, `raw/t16-diag2-result.json`, `raw/t16-diag2-boot.log` | **calibration**: same stub in the install-profile layout → exit 0, 2 requests, 5.6 s |
| `raw/t16-lane.mjs`, `raw/t16-lane-result.json`, `raw/t16-present-boot.log` | first lane attempt; carries the duplicate-id boot failure (`mpd-web-compat`) |
| `raw/t16-lane2.mjs`, `raw/t16b-*-result.json`, `raw/t16b-*-boot.log` | composition fix (home patch reduced to the provider row) — first green lanes |
| `raw/t16-lane3.mjs`, `raw/t16c-present|absent-requests.jsonl`, `raw/t16c-*-result.json` | hardened capture: per-request digests; §4.2/§4.4 quotes |
| `raw/t16-lane4.mjs`, `raw/t16d-result.json`, `raw/t16d-present-requests.jsonl` | §4.3 create/delete/create sequence + staged team |
| `raw/t16-lane6.mjs`, `raw/t16f-absent-result.json` | bounded absent-lane probe (zero warnings, no `rtl-ip`) |
| `raw/t16-lane/` | the sandbox (install + pack swap + planted silicon + staged rtl-ip team record) |
| `raw/t16-lane5.mjs` | the OOM'd unbounded variant — kept as the record of that harness bug |
