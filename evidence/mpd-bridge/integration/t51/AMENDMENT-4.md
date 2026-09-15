
> **Amendment 4 (t51, documentation closure — 2026-09-15).** Three documentation deltas that t50 could
> not carry (it was already terminal when their dispatch arrived) are now closed, in both languages and
> additively: §6.2 gained the namespace base's **cardinality rule** and the **fixed-for-process-lifetime**
> disclosure; a new **§6.6** states the scopes and the **cross-home boundary** (t38's D1); and §3.1's
> Web-card evidence level is now complete (offline hook harness + built/served bytes witnessed; a real
> browser render and a click-driven save NOT witnessed). Nothing already-correct was rewritten, no AC
> row changed status, and no source, `skills/**`, `VENDOR_LOCK.json` or `package.json` was touched.
> Full block: §10.

## 10. Amendment 4 — closing the documentation deltas (2026-09-15, t51)

**Inputs read before writing:** `evidence/mpd-bridge/review/REREVIEW-t49.md`,
`evidence/mpd-bridge/review/RESOLUTION-ruling-and-base.md` (the FINAL base/ownership state — the shipped
`baseForNamespace()`), `evidence/mpd-bridge/dual-path/REPORT.md` (t38's PASS + D1),
`evidence/mpd-bridge/web-card/{report.md,result.json}` (`claims.witnessed` / `notClaimed` / `reproSteps`),
and `packages/mpd-config-plugin/src/index.ts:511`.

| Delta | Where it landed (both languages) | What it now says |
|---|---|---|
| **A — the base and its cardinality** | `docs/tui.md` §6.2 (+ zh twin): a three-row table; also `packages/mpd-tui-plugin/README{,.zh-CN}.md` item 2 and both `mpd-config-plugin` READMEs | one live root ⇒ that workspace's `<workspace>/.mpd/mpd.jsonc`; zero roots ⇒ the mount-time (exec-less) root (`DSH_WORKSPACE_ROOT` or the process cwd), an absent file there giving an **empty base** = schema defaults — the **normal boot path**, since this row usually precedes any live session; more than one root ⇒ **no file base invented** (`base: undefined`, reason `ambiguous-multi-root`, every candidate warned and surfaced by `states()`), and a save in that state is refused, so the ambiguity cannot reach disk |
| **A — the timing disclosure** | same places | the base is **fixed for the process lifetime** because the host exposes **no disposal handle** for a live registration (its own settings installers keep their base fixed the same way) — which is exactly why the shipped sentence is "takes effect for the mpd plugins **after a restart**"; the **resolved value** plus the config layer's **per-call file reads** are what the plugins use, so each session still resolves its own file. No sentence on the page promises a live-refreshed base |
| **B — D1, the cross-home boundary** | `docs/tui.md` §6.6 (new) + zh twin | the four scopes by mechanism (DSH-HOME `settings.yaml` + user `mpd.jsonc`; workspace `<workspace>/.mpd/**`; HOME `~/.mpd/workmate`; bundle presets + corpus), and the boundary: **one DSH home ⇒ the settings document is shared; separate DSH homes ⇒ two documents, so an edit is invisible as a settings VALUE across doors — while `<workspace>/.mpd/mpd.jsonc` still converges because both doors write that same file** |
| **C — the Web card's complete evidence level** | `docs/tui.md` §3.1 + zh twin | witnessed: the registration contract in the **built and served** `client.js` (`dd9c8893…`, 282453 B), the registration shape + field parity in the card's suite, the module's render/write/refuse/read-only behaviour in the **offline hook harness**, and the **write path end to end** through the host's authenticated settings API (`web-settings-bridge.mjs` W1–W13); **NOT witnessed**: a real browser render and a click-driven save (`cardClaim.W3.witnessed === false`), with the human repro steps retained |

**Records.** This report (and its `.mpd` twin) carry Amendment 4 + §10; `evidence/tui/ACCEPTANCE-LEDGER.md`
carries a fourth amendment; `evidence/tui/EVIDENCE-INDEX.md` §7.1 indexes the added claims and this pass's
raw output. Attribution: the facts ← t34 (design), t35 (implementation), t38 (D1), t39 (final base
ruling), t41 (card), t49 (re-review), t50 (the surrounding docs); the closure edits ← **t51** (Lead).

**Gates.** `node evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` and the captain's
`cited-paths-exist.mjs` were re-run over the edited files; their verdicts and digests are recorded in
`evidence/mpd-bridge/integration/t51/` and in the ledger's fourth amendment.

**Gate state at t51's close (re-measured, after the captain's re-pin landed):**
`VENDOR_LOCK.json` `assets/skills` = **310 files / treeSha
`8ec53287296edb43b1f622046ff932a8e339f081184622854db4a2c0445a3268`**; `node scripts/verify-vendor.mjs`
→ **exit 0** (`asset OK: skills 310 files`, `PASS`); `bun run test:qa` → **exit 0**, `all self-tests
passed` (`evidence/mpd-bridge/integration/t51/raw/test-qa-t51.log`). The re-pin is therefore **closed**, not owed.

**Still NOT claimed (unchanged):** AC-4 6/7 (the renderer's transcript row, NOT-CLAIMED #10), AC-20's
blocked host gates, the Web card's real browser render and click-driven save, and the packed-install e2e
boot.
