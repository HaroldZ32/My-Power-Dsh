
## Third amendment — the settings-bridge wave (t50, 2026-09-15)

The bridge capability was built and verified by t35–t49; t50 is its documentation and record half. **No
AC row above changes status** — this amendment records what the docs and the records now say, and two
checker observations that a later reader must not mistake for regressions.

1. **AC-16 (bilingual docs exist and stay wired) — re-witnessed on the t50 text.** The shipped checker
   `evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` was re-run on the amended pair and returns
   `"verdict": "passed"`, **28/28 items, exit 0** (raw:
   `evidence/mpd-bridge/integration/raw/doc-assertion-t27-t50.log`), on `docs/tui.md` sha256
   `ee99c11ea97332f8…` and `docs/tui.zh-CN.md` sha256 `63f282fa12a63d94…`. The new sections exist in
   both languages: §3.1 (Web card), §6.2 (bridged behaviour), §6.5 (duplicate keys), §11.1
   (superseding table).
2. **AC-17 (the docs are honest) — extended, same standard.** The bridge is documented with its measured
   evidence level (`Observed`, two real boots), its two disclosed skip cases (`no-live-session`,
   `ambiguous-multi-root` — no file written, value never lost), its restart caveat, and the Web card's
   **not witnessed** browser render. NOT-CLAIMED #9 no longer leads with the bridge; the §11 statements
   the wave moved are superseded in §11.1 rather than rewritten.
3. **A stale checker pin, named — not a regression.** t29's frozen checker
   (`evidence/tui/composition/20260915T071619Z-docs-mpd-command/doc-assertion-t29.mjs`) now reports
   **two** failures instead of one: the already-recorded predicate residual (`item3.docs/tui.zh-CN.md`)
   plus `entry-unmoved`, because that script pins the TUI-edition entry digest `5dce2563…` while the
   bridge wave legitimately rebuilt the package to `cf4b3813…`. The script was **left untouched** (it is
   another task's evidence) and its pin is superseded by the t27 checker above, which is green on the
   current revision. Neither failure is caused by this pass's text.
4. **A phantom-reference class closed.** The captain's independent checker
   `evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs`, re-run across all nine amended files,
   now reports **0 missing** (it previously flagged 11: 14 bare `<workspace>/.mpd/mpd.jsonc` tokens that are
   workspace-relative rather than repo-relative, the package-local `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md`, and one
   protocol-checkout command path). Each was made precise (`<workspace>/.mpd/mpd.jsonc`,
   `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md`, `<protocol-repo>/packages/conformance/lib/cli.js`)
   — no citation was deleted and no path was invented. Raw:
   `evidence/mpd-bridge/integration/raw/cited-paths-t50.log`.
5. **Pins moved by the wave, re-measured at write time.** `packages/mpd-tui-plugin/dist/index.js`
   `5dce2563fd0e3b20…` (98883 bytes) → `cf4b3813a344c9d5…` (**105305 bytes**);
   `packages/mpd-config-plugin/dist/index.js` `15733c1e0791aee1…` (99868 bytes);
   `packages/mpd-bundle-plugin/client.js` `dd9c88933a316277…` (282453 bytes, unchanged);
   `dsh-plugin.json` `84ed4a5d5aac3fb0…` (8088 bytes, unchanged). `VENDOR_LOCK.json` carries the wave's
   single re-pin (`assets/skills`: 307 files / treeSha `ba0c3922889614225dfd…`) and was not touched here.
6. **What is still NOT claimed after this pass** — unchanged from the rows above and from t49: the Web
   card's real browser render, a specific front door's rendering, the decision-event seam, the seventh
   activation-gated surface (NOT-CLAIMED #10), and the spec-suite/host-gate blockers (AC-20).
