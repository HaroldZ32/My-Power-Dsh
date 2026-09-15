
> **Amendment 3 (t50, after the settings-bridge wave).** The wave t35–t49 turned the `/settings`
> section's named follow-up into delivered, evidenced behaviour (the `mpd` settings namespace is
> served by `packages/mpd-config-plugin`, whose write-back projects a saved edit into the live
> session workspace's `<workspace>/.mpd/mpd.jsonc`). That moved one artifact pin, closed one residual and
> narrowed one NOT-CLAIMED item, so the bilingual docs, both package README pairs, this report and
> the acceptance ledger carry dated amendments; §2/§3/§4 above and the ledger's rows are the
> TUI-edition records and stay as written. Full block: §9.

## 9. Amendment 3 — the settings-bridge wave (2026-09-15, t50)

**What changed, and where the change is recorded.** The bridge capability itself was built and
verified by t35–t49; this integration pass (t50) is the documentation and record half. Nothing in §1–§8
was rewritten — superseded statements are marked, in place, with the measured replacement.

| Record | Amendment |
|---|---|
| `docs/tui.md` §6.2 (+ `docs/tui.zh-CN.md` mirror) | the "not bridged" limitation text was REPLACED by the bridged behaviour: read-in precedence L0 < L1 < L2 < L3, write-back with comments/key order/trailing commas preserved, the workspace-target rule (`no-live-session` / `ambiguous-multi-root`, no file written, value never lost), `applies: 'restart'`, and the honest evidence level (`Observed`, two real boots) |
| `docs/tui.md` §6.5 (new, + zh mirror) | the duplicate-key table — SET edits the LAST occurrence (the warning names every occurrence line), UNSET removes EVERY occurrence, refusal only for unprovable spans / `ambiguous-intermediate` / unparsable / read-only, with the durable-projection rationale and a citation of `evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md` |
| `docs/tui.md` §3.1 (new, + zh mirror) | the Web GUI settings card — `ctx.slots.inject("settings.plugin.item", …)` registration with `key: "mpd"`, the `settingsScope.bind(...).mutate(...)` write seam, read-only scope behaviour, field parity with the TUI descriptor; evidence level `Observed` for registration + built bytes, with the **browser render explicitly NOT witnessed** and the exact steps to see it |
| `docs/tui.md` §10 item 9 / the §3 settings row / §11.1 (new, + zh mirror) | NOT-CLAIMED #9 no longer leads with the bridge (it is a claimed capability now); the §3 settings row points at §6.2/§6.5/§3.1; §11.1 supersedes the two §11 statements the wave moved |
| `packages/mpd-tui-plugin/README.zh-CN.md` | the zh settings row still read "**未与文件打通**" — corrected to mirror the EN row ("**bridged**"; a save writes the file, and the plugin behaviour needs a restart) |
| `packages/mpd-config-plugin/README.md` + `README.zh-CN.md` | new `/settings` bridge (write-back) section: precedence, trigger + lock/CAS/atomic rename, comment preservation, the workspace-target rule and the never-lost clause, restart timing, degenerate targets, the duplicate-key rule, and the evidence citations |
| this report, §9 | the record above |
| `evidence/tui/EVIDENCE-INDEX.md` | the bridge evidence directories and the bridge lanes are indexed with their re-run commands |
| `evidence/mpd-bridge/integration/` | this pass's raw path-existence and doc-consistency output |

**Pins re-measured at write time** (`sha256sum` + `stat -c %s`, 2026-09-15):

| Artifact | TUI-edition revision (§2) | Current revision |
|---|---|---|
| `packages/mpd-tui-plugin/dist/index.js` | `5dce2563fd0e3b20…`, 98883 bytes | `cf4b3813a344c9d5…`, **105305 bytes** |
| `packages/mpd-config-plugin/dist/index.js` | (pre-bridge) | `15733c1e0791aee1…`, 99868 bytes |
| `packages/mpd-bundle-plugin/client.js` | `dd9c88933a316277…`, 282453 bytes | unchanged, 282453 bytes |
| `dsh-plugin.json` | `84ed4a5d5aac3fb0…`, 8088 bytes | unchanged, 8088 bytes |

The package dist moved because the wave reworded the `/settings` field disclosure; the manifest and the
bundle client did not. `VENDOR_LOCK.json` is the captain's single re-pin for the wave (`assets/skills`:
307 files / treeSha `ba0c3922889614225dfd…`) and was not touched here.

**Gates on the FROZEN revision (the captain's t14/t31 sweep — unchanged by this documentation pass, which
writes no product artifact):** `bun run test:qa` all self-tests passed, exit 0; `node scripts/verify-vendor.mjs`
PASS; `bun run typecheck` 0; `bun test packages` 547/0; rows parity 24 ids; R6 `bundle-lifecycle` PASS.

> **Correction (t50, measured on the working tree — merge blocker, not caused by t50).** Two of those
> gates are **RED on the current tree**, because the bridge wave (t35–t49) added three lane scripts under
> `skills/` — `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`,
> `skills/dsh-qa/scripts/tui-settings-bridge.mjs`, `skills/dsh-qa/scripts/web-settings-bridge.mjs` — and
> modified three tracked ones (`skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/tui-panels.mjs`,
> `skills/dsh-qa/scripts/extension-isolation.mjs`) **after** the wave's single `VENDOR_LOCK` re-pin
> (307 / `ba0c3922…`) had landed. Measured: `node scripts/verify-vendor.mjs` exits 1 with
> `FAIL - asset skills count drifted: 310 vs 307` and a treeSha mismatch; `bun run test:qa` exits 1 at
> `agent-teams-messaging` with `VENDOR_LOCK skills asset is stale: lock=307/ba0c39228896
> tree=310/8ec53287296e`. The three files are still uncommitted (`git status` shows them untracked), so
> the remedy is the captain's single re-pin of `assets/skills` in the same commit as those `skills/**`
> changes (AGENTS.md §9/§11). **`VENDOR_LOCK.json` and `skills/**` are outside t50's scope and were not
> touched by this pass.** Raw logs: `evidence/mpd-bridge/integration/raw/{verify-vendor-t50.log,test-qa-t50.log}`;
> the finding is also recorded in `evidence/mpd-bridge/integration/REPORT.md` and the ledger's third
> amendment. No statement in this report claims a gate that the current tree fails.

**NOT-CLAIMED after this pass (the bridge's own edges, carried from t49):** the Web card's real browser
render (registration + built bytes only) and a specific front door's rendering are not witnessed here;
the decision-event seam and the seven-surface accounting are unchanged from §5; and the bridge's
`no-live-session` / `ambiguous-multi-root` skips change no file by design — they are disclosed
behaviour, never silent success. No statement in this amendment turns any of them into a pass.

**Attribution:** the capability and its lanes ← t35–t49 (their own evidence under `evidence/mpd-bridge/`,
re-review verdict PASS at `evidence/mpd-bridge/review/REREVIEW-t49.md`); the bilingual docs, the README
pairs, this amendment, the ledger and index amendments and the integration record ← **t50** (Lead).

**Honesty note (unchanged in kind).** Every digest in this amendment was measured in the same step that
wrote it; every superseded sentence is marked as superseded rather than deleted, and the original rows
above remain as the records of the revision that produced them.
