# readonly-deny (t5) — gate evidence

Baseline untouched by this change: HEAD f697088 + 33 pre-existing dirty entries
(`git status --porcelain` snapshot sha256 recorded in the task report).

## Change under test
- `packages/mpd-roles-plugin/src/index.ts` — READONLY_DENY reduced to the seven
  live-registered write-capable names (only the two unregistered legacy editor
  names removed; `bash` and the three MCP names deliberately kept).
- `packages/mpd-roles-plugin/dist/index.js` — rebuilt from that src (the repo loads dist).
- `packages/mpd-roles-plugin/test/roles.test.ts` — the assertion that pinned the two
  dead names is re-pointed at the live names; dead-name guards (list + src + built dist)
  and the roles/workmate parity guard added.
- `skills/dsh-qa/scripts/readonly-deny.mjs` (+ SKILL.md row) — new QA case with `--self-test`.
- `AGENTS.md` §12 — troubleshooting row for this defect class.
- `VENDOR_LOCK.json` — skills asset fingerprint refreshed (363→364 files, new treeSha)
  because the new QA case grows the corpus; hash computed with the gate's own algorithm
  (including its LF normalization).

## Gates
| Gate | Result |
|---|---|
| `bun run typecheck` | PASS (exit 0) |
| `bun test packages/mpd-roles-plugin` | PASS — 11 pass / 0 fail / 139 expect calls |
| `bun test packages` | 284 pass / 3 skip / 4 fail — ALL FOUR failures are mpd-bundle-plugin workmate-page UI tests owned by t4, none in the roles package |
| `node scripts/verify-vendor.mjs` | PASS (commit/version/stats + all 6 assets OK) |
| `node skills/dsh-qa/scripts/readonly-deny.mjs --self-test` | PASS — 23 checks |
| isolated `DSH_HOME` boot (`dsh --profile mpd-headless --dump-config`) | PASS — mpd-roles, mpd-workmate, mpd-hashline, mcp-astgrep, mcp-lsp all composed |

## Static registry proof (credential-free, in the case self-test)
The harness validates a restriction list against the tools the AGENT PLANE composes:
- `@deepseek-ai/dsh-tool-str-replace-editor` IS installed in the harness closure and its
  row IS composed into the profile, yet it is ABSENT from every preset → `str_replace_editor`
  never registers (this is exactly why the live error names it as unknown).
- `apply_patch` has no package anywhere in the harness.
- All seven retained names map to composed, live sources: tool-bash→`bash`, tool-fs→
  `write`/`edit`, mpd-hashline→`mpd_hashline_edit`, mcp-astgrep→`rewrite`/`scan`,
  mcp-lsp→`rename`.

## Live spawn proof: BLOCKED (environment), not failed
`dsh --profile mpd-headless "<read-only spawn probe>"` in the isolated sandbox dies with
`dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`.
This deployment has no reachable provider credential: `~/.dsh/.credentials.yaml` carries
only a `client-connection/browser-session` grant, no `DEEPSEEK_API_KEY` exists in the
environment, and there is no `.env` fallback. The case reports this as `status: "blocked"`
with the remedy (`export DEEPSEEK_API_KEY=<key>` and re-run; no case change needed) and
exits 2 rather than reporting a false failure.

Second, independent blocker observed after t3's in-flight edits: the profile currently
cannot boot because `packages/mpd-workmate-plugin` fails loader apply with
`unsupported JSON schema: schema.properties.archived.type must be a single type string
(type arrays are not supported)` (src line 654). Reported to its owner with a one-line fix.

## Isolation
The case asserts the REAL `~/.mpd/workmate` bytes are unchanged across the run (name+size+mtime
fingerprint before/after) rather than asserting its absence — the captain's own earlier runs
had legitimately left `oracle-1` there, so an absence assertion was wrong.

## Update — t3's profile-boot blocker RESOLVED
The `JsonSchemaError` that stopped the profile from booting was reported to its owner with the
exact location and a one-line fix. It is now fixed, so the profile boots again: an isolated
`DSH_HOME` `dsh --profile mpd-headless --dump-config` composes mpd-roles, mpd-workmate,
mpd-hashline, mcp-astgrep and mcp-lsp, and the workmate row applies with no loader failure
(exit 0, 774 composed lines). The live read-only spawn proof remains blocked ONLY by the
missing provider credential described above.
