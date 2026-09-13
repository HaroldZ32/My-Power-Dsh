### Absent prerequisites: SKIP with a reason (fresh clones)

A case whose prerequisite is not present must SKIP, not FAIL — while an explicit strict request
must still fail loudly, and a *broken* prerequisite always fails:

| lane | prerequisite | strict flag | exit | stdout |
|---|---|---|---|---|
| `--self-test` | absent | none | 0 | one `[mpd-qa] SKIP …` line as the FIRST stdout line |
| `--self-test` | absent | `--no-skip` or `--require-pack` | 1 | one `[mpd-qa] FAIL …` line (first on stdout) |
| real run | absent pack | none | 0 | one `[mpd-qa] SKIP …` line (first on stdout), NO evidence directory |
| real run | absent pack | either strict flag | 1 | one `[mpd-qa] FAIL …` line |
| real run | absent credentials in a case that does NOT declare them skippable | any | 1 | the case's own failure (e.g. `missing credentials`) |
| any | present but broken | any | 1 | the case's own FAIL — a skip is never allowed here |

Marker grammar (exactly one line per invocation, the FIRST stdout line of the case's output; emitted
on stdout in both the SKIP and the FAIL mode):
[mpd-qa] SKIP case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<command|doc:path#section|->"
[mpd-qa] FAIL case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<command|doc:path#section|->"

Reason codes: absent-staged-pack / absent-toolchain-binary / absent-credentials /
absent-model-route / absent-dsh-binary / absent-harness-closure / absent-runtime /
absent-fixture / unsupported-platform.

Rules: probe the exact prerequisite positively (never catch a failure); run prerequisite-independent
assertions first; a present prerequisite is always checked and always fails loudly when broken;
a prerequisite that is not declared skippable is never routed through the gate; never build/execute
the remedy from a lane; never print a PASS after a skip; one marker per case.

Callers: exit 0 + a SKIP line = skipped (never a pass); exit 0 with no marker = pass; exit 1 = fail.
Count skips: `bun run test:qa 2>&1 | grep -c '^\[mpd-qa\] SKIP '`.
Strict suites (no skips tolerated): `bun run test:qa:strict` (self-tests), `bun run test:qa:all` (real lanes).
Declare prerequisites in the case header, one line each, in check order:
`// PREREQ: <reason-code> <repo-relative-path-or-probe> <remedy>`
Strict flag spellings: `--no-skip` (generic) and `--require-pack` (the reserved, case-specific name for
the staged pack); a case that has both accepts either, with identical semantics.