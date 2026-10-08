# ast-grep — Vendored Structural-Search Skill

**Generated:** 2026-08-24 (f3642fcda)

## OVERVIEW

Vendored skill teaching agents ast-grep (`sg`) structural search/rewrite, plus a stdlib-Python helper CLI that wraps the `sg` binary. Vendoring pin in `SOURCE`: upstream `code-yeongyu/ast-grep-skill @ 3148c69` (ast-grep 0.45.0), "vendored as a sync; do not fork-drift". Earned this file: own executable surface (749-LOC helper + installers + smoke tests) and a no-fork-drift upstream contract that has no analogue elsewhere in the skill corpus.

## STRUCTURE

```
ast-grep/
├── SKILL.md / README.md          # agent workflow / user overview
├── SOURCE                        # upstream pin — the no-fork-drift contract
├── scripts/ast_grep_helper.py    # 749-LOC stdlib CLI (argparse; no deps)
├── install.sh / install.ps1      # macOS/Linux + Windows installers
├── references/                   # cli, install, patterns, pitfalls, recipes, yaml-rules (510 LOC), sgconfig
└── tests/smoke.{sh,ps1}          # POSIX + PowerShell smoke (also shell syntax + content checks)
```

## HELPER CLI (`scripts/ast_grep_helper.py`)

Subcommands: `search`, `replace` (dry-run; `--apply` to write), `scan`, `test`, `new`, `langs`, `doctor`, `install`, `validate`. Resolves the `sg`/`ast-grep` binary across PATH, Homebrew, npm, and MPD caches, validates patterns before executing, and shells out — it never links ast-grep as a library. Internal handlers `cmd_*`; utilities `validate_pattern`, `normalize_lang`, `resolve_binary`, `run_sg`. Nothing in-repo imports it; docs and skills invoke it by path. In this bundle the corpus is SERVED BY REFERENCE — the `mpd-bootstrap` row registers a skills provider over `<bundle>/skills` — so no copy of this directory is installed into a home, and the `sg` binary is resolved at runtime by the helper and the installers themselves through `MPD_AST_GREP_SG_PATH` (explicit binary) and `MPD_AST_GREP_BIN_DIR` (cached-binary directory).

## CONVENTIONS

- AST patterns, never regex, for syntax-shaped queries; `$VAR` singles, `$$$` multis; patterns must parse as complete code in the target language.
- Two-pass rewrites: preview with `--json=compact`, apply separately with `--update-all` — the flags are mutually exclusive in `sg`.
- `sgconfig.yml` discovered upward; `ruleDirs`, optional `testConfigs`/`utilDirs`, language globs, custom languages, injections.
- Upstream syncs land as whole vendored refreshes matching `SOURCE`; local edits ride along until the next sync absorbs or reverts them.

## ANTI-PATTERNS

- NO regex constructs (`.*`, `.+`, `\w`, `\d`, literal `|`) inside AST patterns — that is the skill's #1 pitfall.
- No incomplete patterns (e.g. Python `def $F($$$):` without a body).
- NEVER `--apply` a rewrite without the dry-run preview first.
- Text/comment/byte queries go to `rg`, not structural matching.
- Do not fork-drift from the `SOURCE` pin; a sync is a vendored refresh, not a merge.

## COMMANDS

```bash
# from skills/ast-grep/
python3 scripts/ast_grep_helper.py search '<PATTERN>' --lang ts [path]
python3 scripts/ast_grep_helper.py replace '<PATTERN>' '<REWRITE>' --lang ts   # dry-run; add --apply
python3 scripts/ast_grep_helper.py doctor
bash tests/smoke.sh          # or: pwsh tests/smoke.ps1
# direct:  sg run -p '<PATTERN>' --lang ts path
```

- Parent: [this repository's root `AGENTS.md`](../../AGENTS.md).
