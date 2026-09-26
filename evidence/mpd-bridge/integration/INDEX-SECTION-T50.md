
## 7.1 The settings bridge (t35–t50) — claims added after t14

The `/settings` section's named follow-up became delivered behaviour in the bridge wave. These paths
back the bridge's own claims; the docs that state them are `docs/tui.md`/`docs/tui.zh-CN.md`
§3.1/§6.2/§6.5/§11.1.

| Claim | Artifact |
|---|---|
| The bridge's requirements and frozen scope | `evidence/mpd-bridge/requirements/`, `evidence/mpd-bridge/design/` |
| Two real boots: one live root (file rewritten, comment/key order/trailing comma preserved) and two live roots (REFUSED `ambiguous-multi-root`, both candidates named, no file changed, value still applied) | `evidence/mpd-bridge/implementation/20260915T080138Z/{result.json,REPORT.md,artifact-hashes.txt,gates.log,lane-tui,lane-web,lane-web-noskip}` |
| The TUI lane that asserts the bridged disclosure + write-back (`allPatterns`, per-result `REVISION.json`) | `skills/dsh-qa/scripts/tui-settings-bridge.mjs`; hardening `skills/dsh-qa/scripts/tui-panels.mjs` (settings step `allPatterns`) |
| The Web-side lane (card mount, skip cases, no-skip control) | `skills/dsh-qa/scripts/web-settings-bridge.mjs`; run `evidence/mpd-bridge/implementation/20260915T080138Z/lane-web`, control `…/lane-web-noskip` |
| Duplicate-key ruling (SET = last occurrence, UNSET = every occurrence, refusal classes) | `evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md` |
| Independent re-review of the bridge (verdict PASS) and its coverage/dispositions | `evidence/mpd-bridge/review/REREVIEW-t49.md`, `evidence/mpd-bridge/review/t49-DISPOSITIONS-AND-COVERAGE.md`, `evidence/mpd-bridge/review/RESOLUTION-*.md`, `evidence/mpd-bridge/review/raw/`, `evidence/mpd-bridge/review/lane-run-{1,2}` |
| Consumer activation (the namespace served by the config plugin, base from `<workspace>/.mpd/mpd.jsonc`) | `evidence/mpd-bridge/consumer-activation/` |
| Dual-path behaviour (settings layer vs file) | `evidence/mpd-bridge/dual-path/` |
| Web card registration + built bytes (browser render NOT witnessed) | `evidence/mpd-bridge/web-card/`; built client `packages/mpd-bundle-plugin/client.js` sha256 `dd9c88933a316277…` (282453 bytes) |
| **t50** documentation/record pass: bilingual doc rewrite, duplicate-key table, Web-card docs, ledger + report amendments, expanded path check | `evidence/mpd-bridge/integration/{REPORT.md,result.json,AMENDMENT-3.md,LEDGER-AMENDMENT-T50.md,INDEX-SECTION-T50.md,raw/}` |
| The de-branding pass that rode this wave (t33): t33 `verdict: passed` on the RTL/EDA rename, with its own gates and the remaining known breakage named | `evidence/mpd-ext-debranding/20260915T074904Z/` (`result.json`, `verify-debranding.mjs`, `typecheck.log`, `validate.log`, `ext-tests.log`, `roles-tests.log`, `qa-isolation-breakage.log`) + the captain's independent re-run `evidence/mpd-ext-debranding/captain-verify/` |
| **Negative controls** for the bridge lanes (a lane that cannot fail is not evidence) | `evidence/mpd-bridge/implementation/20260915T080138Z/lane-web-noskip` (the Web lane re-run without the skip fixture), the TUI panel step's `allPatterns` requirement (a pane missing ANY of the four disclosure sentences — bridge, restart, never-lost, the workspace path — fails), and the two-boot contrast (one live root writes the file; two live roots refuse with `ambiguous-multi-root` and still apply the value) |
| t50 re-run of the shipped bilingual checker (28/28, exit 0) | `evidence/mpd-bridge/integration/raw/doc-assertion-t27-t50.log` (checker: `evidence/tui/docs/20260915T070743Z/doc-assertion.mjs`) |
| t50 re-run of the captain's cited-path checker (0 missing across the nine amended files; 11 pre-existing bare-token misses made precise) | `evidence/mpd-bridge/integration/raw/cited-paths-t50.log` (checker: `evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs`) |
| t29's frozen checker now also fails `entry-unmoved` (its pin is the superseded TUI-edition digest, not a regression) | `evidence/mpd-bridge/integration/raw/doc-assertion-t29-t50.log`; recorded in `evidence/tui/ACCEPTANCE-LEDGER.md` (third amendment, item 3) |

Re-run (from the repository root):

```sh
node evidence/tui/docs/20260915T070743Z/doc-assertion.mjs                    # expect verdict passed, 28/28, exit 0
node evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs docs/tui.md docs/tui.zh-CN.md \
  docs/tui-edition-report.md evidence/tui/ACCEPTANCE-LEDGER.md evidence/tui/EVIDENCE-INDEX.md \
  packages/mpd-tui-plugin/README.md packages/mpd-tui-plugin/README.zh-CN.md \
  packages/mpd-config-plugin/README.md packages/mpd-config-plugin/README.zh-CN.md
bun skills/dsh-qa/scripts/tui-settings-bridge.mjs --sandbox-root <root>      # needs a real TTY (tmux)
```
