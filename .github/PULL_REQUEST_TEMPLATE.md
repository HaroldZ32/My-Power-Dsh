<!-- Thanks for contributing! Please read CONTRIBUTING.md before opening this pull request. -->

## What does this change?

<!-- One short paragraph. Link the defect or the requirement this serves. -->

## Type of change

- [ ] Bug fix (`fix/<slug>`)
- [ ] New capability (`feature/<slug>`)
- [ ] Documentation (both the English file and its `*.zh-CN.md` twin are in this commit)
- [ ] Tests, QA or gates
- [ ] Chore or refactor

## How was it verified?

<!--
Name the gates you ran and where the evidence landed:
evidence/<domain>/<slug>/<timestamp>/{result.json,output.log}
-->

| Gate | Command | Result |
|---|---|---|
| Static gates | `bun run verify:gates` | |
| Typecheck | `bun run typecheck` | |
| Unit tests | `bun test packages` | |
| Documentation pairs | `bun run verify:docs` | |
| Other (name it) | | |

## Checklist

- [ ] The pull request is one focused piece of work, with no unrelated refactors.
- [ ] A source change and its rebuilt `dist/` are in this commit (built from the repository root with
      `bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`).
- [ ] Every human-facing document I touched ships its English and `简体中文` version in this commit,
      each with its language switch link under the title.
- [ ] Evidence is committed under `evidence/` and contains no credentials, tokens or private data.
- [ ] Nothing in this description claims more than the evidence supports (`--dump-config` is a
      composition check, never proof that a plugin loaded).
