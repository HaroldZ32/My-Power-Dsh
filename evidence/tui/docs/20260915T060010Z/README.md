# t6 evidence — dsh-distribution.json + bilingual TUI docs

Everything in this directory backs the two deliverables of task `t6`
(`dsh-distribution.json` at the repo root, `docs/tui.md` + `docs/tui.zh-CN.md` with the four link
edits) and nothing else. No git write was performed by this task.

| File | What it is |
|---|---|
| `verify.json` | The gate report: R7, R8, the task contract's descriptor-identity assertion, the structural descriptor check, the forbidden/required-wording guard, the existence+digest of every evidence path the docs cite, and the digests of every artifact this task touched. |
| `verify-docs.mjs` | The script that produced `verify.json` (re-runnable). |
| `descriptor-check.mjs` / `descriptor-check.json` | A structural check of `dsh-distribution.json` against the dsh-distribution protocol's own schema files (descriptor + composition + layout, plus the layout validator's relational rules). The schema files it mirrors are pinned by sha256 inside the report. **This is not the protocol's conformance CLI** — that run is the distribution lane (AC-13, t9). |
| `dsh-distribution.json.snapshot` | The descriptor as written, kept for provenance. |
| `gates.log`, `typecheck.log` | Raw command output. |
| `wording-check.log` | The forbidden-wording / required-vocabulary check output. |
| `ledger-citation.md` | The ledger t6 cites (path, in-file timestamp, sha256, counts) and the staleness disclosure. |

Honesty boundary of this evidence: it proves the descriptor is structurally consistent with the
protocol's schemas and that the docs satisfy their wiring/disclosure gates. It does **not** prove
the descriptor passes the protocol's own CLI, and it does not upgrade any pending lane
(panels t7/t8, admission/distribution/spec-conformance t9) into a result.
