# Redaction record — credentials scrubbed before publication

Scope: the two evidence trees committed with this wave, both of which are about to land in a PUBLIC
repository (AGENTS.md §10: evidence logs must not contain secret material).

- `evidence/web-plane/tool-web-fetch/2026-10-31T02-39-06-583Z/`
- `evidence/dsh-qa/preset-conformance/2026-10-31T03-22-39.227Z/`

## Pattern classes scanned

| Class | Pattern | Hits that carried a real value |
|---|---|---|
| URL query token | `token=<value>` | 5 |
| Bearer / Authorization header | bearer and authorization header values | 0 |
| Provider key | DeepSeek env-var assignment, bare `sk-` key form | 0 |
| GitHub token | `gho_`, `ghp_`, `github_pat_` | 0 |
| Password / secret assignment | password and secret fields carrying a value | 0 |

## Substitutions (in place, one line changed per file, line counts unchanged)

| File | Class | Substitutions |
|---|---|---|
| `raw/positive.boot.log` | URL query token | 1 |
| `raw/negative.boot.log` | URL query token | 1 |
| `raw/call-live.boot.log` | URL query token | 1 |
| `post-change/positive/raw/positive.boot.log` | URL query token | 1 |
| `post-change/negative/raw/negative.boot.log` | URL query token | 1 |

Total: 5 substitutions across 5 files. Each replaced the value only, keeping the surrounding
structure (`?token=<redacted>`), so every file keeps its byte layout apart from the substituted value.

The substituted values were **ephemeral loopback gateway tokens** minted by a throwaway `dsh web`
boot on `127.0.0.1` inside a QA sandbox. **No credential value survived** the pass: every matched
value in both trees is now `<redacted>`, and no API key, bearer value, GitHub token or password value
was present to begin with.

## Deliberately not redacted

- `driver.ts` matches are code shapes, not secrets: the redaction regexes themselves
  (`token=[A-Za-z0-9_-]+`, `sk-[A-Za-z0-9_-]{8,}`, `Bearer\s+…`), the `DEEPSEEK_API_KEY` environment
  variable name, and the declared throwaway stub key that exists precisely so the stub arms never use
  a real credential.
- Prose and field names that merely mention the word token (`"tokenSeen": true`, `tokenMeter` comments,
  tool descriptions) are unchanged.
- `evidence/dsh-qa/preset-conformance/2026-10-31T03-22-39.227Z/` already carried `<redacted>` in
  `boot.log`, `control-boot.log` and `output.log`; nothing there needed a change.

## Files untouched

No file was added, deleted, renamed or reformatted. No binary or compressed (`.zstd`) file exists in
either tree, so none had to be skipped.
