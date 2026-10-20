# Final reading of the fix-wave sweep (`summary.tsv` is the raw run record)

- `docker-source-live` — the FIRST invocation in `summary.tsv` is **exit 3** because `--live` was passed
  without `DEEPSEEK_API_KEY` in the environment (the driver refuses rather than report a credential-free
  NULL). The credentialed rerun is `docker-source-live-rerun2.log`: **exit 0**, `ok=true`,
  **117 passed / 0 failed / 5 declared NULL**, evidence
  `evidence/docker/client-install/2026-10-20T10-55-05Z/`. The 5 NULLs are the four `oneclick.*`
  rows (not applicable in `--mode source`) and `ui.teamBoard` (no team build was requested).
  `result.json` carries `complete:false`; that flag reflects those 5 declared NULLs, not a failure —
  `ok=true`, `failed=0`, and the driver reports `passed=117`.
- `dual-track-smoke` — the case's overall **exit 1** is the GATEWAY track: `dsh: NO_ADAPTER: no adapter
  registered for provider "deepseek"`. The OFFICIAL track passed a real turn
  (`evidence/dsh-qa/llm-dual-track/official/2026-10-20T10-43-25.953Z/`). This is the same host bound
  recorded in v0.13.2 and v0.14.0.
- `session-start-team-live` — STOPPED after 2/15 sides in 11 minutes (optional 15-side live matrix; its
  contract self-test is green). Not a release gate.
- Every other case in `summary.tsv` is exit 0: static gates, pinned unit suite (2160 pass / 0 fail),
  typecheck, QA self-tests, `bundle-lifecycle` (green after F11/F12), real preset conformance,
  verify-law boot, delegation-gate live, captain-scope live, and `mcp-call`.
