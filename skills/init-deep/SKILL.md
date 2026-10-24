---
name: init-deep
description: "(builtin) Initialize hierarchical AGENTS.md knowledge base"
---
# /init-deep

Generate hierarchical AGENTS.md files. Root + complexity-scored subdirectories.

## Usage

```
/init-deep                      # Update mode: modify existing + create new where warranted
/init-deep --create-new         # Read existing → remove all → regenerate from scratch
/init-deep --max-depth=2        # Limit directory depth (default: 3)
```

---

## Workflow (High-Level)

1. **Discovery + Analysis**
   - Issue the `Explorer` consults (serial; team plane only when the lanes are truly concurrent)
   - Main session: bash structure + LSP/ast-grep code map + read existing AGENTS.md
2. **Score & Decide** - Determine AGENTS.md locations from merged findings
3. **Generate** - Root first, then subdirs as serial consults (or team lanes)
4. **Review** - Deduplicate, trim, validate

<critical>
**todo_write ALL phases. Mark in_progress → completed in real-time.**
```
todo_write([
  { "content": "Fire explore agents + LSP/ast-grep map + read existing", "status": "pending" },
  { "content": "Score directories, determine locations", "status": "pending" },
  { "content": "Generate AGENTS.md files (root + subdirs)", "status": "pending" },
  { "content": "Deduplicate, validate, trim", "status": "pending" }
])
```
</critical>

---

## Phase 1: Discovery + Analysis

**Mark "discovery" as in_progress.**

### Explore with serial consults

`mpd_role_spawn` is ONE-SHOT and synchronous: each `Explorer` consult returns its report as the tool result, so there is no background child, no `job_output` poll and no completion notice to wait for. Issue the six consults SERIALLY and fold each report as it returns. When the project is large enough that the lanes are genuinely concurrent, stage them on the mpd team plane instead (`agent_teams_plan` `create` → one `add_member` per lane → one `create_task` with `independent:true` → `approve` → `agent_teams_dispatch {action:"run"}`).

**Equip every consult with the code graph**: any task touching structure, entry points, dependencies, or hotspots MUST query `mcp__codegraph__codegraph_explore` (overview plus the call path, callers and impact) and `mcp__lsp__find_workspace_symbols` when present, and ground its claims in that data instead of guessing from conventions. Richer real-graph context per consult = a more accurate project map.

```
mpd_role_spawn(role="Explorer", task="TASK: map the real project layout via mcp__codegraph__codegraph_explore. DELIVERABLE: deviations from standard patterns. SCOPE: read-only. VERIFY: name the query behind each claim.")
mpd_role_spawn(role="Explorer", task="TASK: find entry points and trace reach via mcp__codegraph__codegraph_explore + mcp__lsp__find_workspace_symbols. DELIVERABLE: non-standard organization. SCOPE: read-only. VERIFY: cite the symbol and its caller/callee edge.")
mpd_role_spawn(role="Explorer", task="TASK: find conventions from config files (.eslintrc, pyproject.toml, .editorconfig). DELIVERABLE: project-specific rules. SCOPE: read-only. VERIFY: quote the config key.")
mpd_role_spawn(role="Explorer", task="TASK: find anti-patterns in 'DO NOT', 'NEVER', 'ALWAYS', 'DEPRECATED' comments. DELIVERABLE: forbidden patterns. SCOPE: read-only. VERIFY: quote the comment and path.")
mpd_role_spawn(role="Explorer", task="TASK: explore build/CI (.github/workflows, Makefile). DELIVERABLE: non-standard patterns. SCOPE: read-only. VERIFY: cite the file.")
mpd_role_spawn(role="Explorer", task="TASK: find test patterns/configs; mcp__codegraph__codegraph_explore on core modules to see what is covered. DELIVERABLE: unique conventions. SCOPE: read-only. VERIFY: cite the test path.")
```

<dynamic-agents>
**DYNAMIC CONSULT FANNING**: After bash analysis, issue ADDITIONAL `Explorer` consults based on project scale:

| Factor | Threshold | Additional Consults |
|--------|-----------|---------------------|
| **Total files** | >100 | +1 per 100 files |
| **Total lines** | >10k | +1 per 10k lines |
| **Directory depth** | ≥4 | +2 for deep exploration |
| **Large files (>500 lines)** | >10 files | +1 for complexity hotspots |
| **Monorepo** | detected | +1 per package/workspace |
| **Multiple languages** | >1 | +1 per language |

```bash
# Measure project scale first
total_files=$(find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l)
total_lines=$(find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.go" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
large_files=$(find . -type f \( -name "*.ts" -o -name "*.py" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | awk '$1 > 500 {count++} END {print count+0}')
max_depth=$(find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' | awk -F/ '{print NF}' | sort -rn | head -1)
```

Example fanning:
```
// 500 files, 50k lines, depth 6, 15 large files → 5+5+2+1 = 13 additional consults
mpd_role_spawn(role="Explorer", task="TASK: analyze files >500 lines. DELIVERABLE: complexity hotspots. SCOPE: read-only. VERIFY: cite the file and its size.")
mpd_role_spawn(role="Explorer", task="TASK: explore modules at depth 4+. DELIVERABLE: hidden patterns, internal conventions. SCOPE: read-only. VERIFY: cite the path.")
mpd_role_spawn(role="Explorer", task="TASK: find shared utilities across directories. DELIVERABLE: cross-cutting concerns. SCOPE: read-only. VERIFY: cite each import site.")
// ... more based on the calculation
```
</dynamic-agents>

### Main Session: Structural Analysis

**Between consults**, main session does:
#### 1. Bash Structural Analysis
```bash
# Directory depth + file counts
find . -type d -not -path '*/\\.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/dist/*' -not -path '*/build/*' | awk -F/ '{print NF-1}' | sort -n | uniq -c

# Files per directory (top 30)
find . -type f -not -path '*/\\.*' -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Code concentration by extension
find . -type f \\( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.go" -o -name "*.rs" \\) -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20

# Existing AGENTS.md / CLAUDE.md
find . -type f \\( -name "AGENTS.md" -o -name "CLAUDE.md" \\) -not -path '*/node_modules/*' 2>/dev/null
```

#### 2. Read Existing AGENTS.md
```
For each existing file found:
  Read(filePath=file)
  Extract: key insights, conventions, anti-patterns
  Store in EXISTING_AGENTS map
```

If `--create-new`: Read all existing first (preserve context) → then delete all → regenerate.

#### 3. Code Map - drive LSP AND ast-grep (do NOT skip)

Highest-signal source for the CODE MAP and the Symbol/Export/Reference scoring rows. Complementary, not alternatives - run BOTH when present, alongside the explore agents.

**LSP** - the mounted surface is `mcp__lsp__*`; model-facing names are `mcp__lsp__find_definition`, `mcp__lsp__find_references`, `mcp__lsp__find_workspace_symbols`, `mcp__lsp__get_diagnostics`, `mcp__lsp__get_hover`, `mcp__lsp__rename_symbol`, `mcp__lsp__rename_symbol_strict`, `mcp__lsp__find_implementation`, `mcp__lsp__prepare_call_hierarchy`:
- `mcp__lsp__get_diagnostics` on each entry point -> the server answers, and its current errors come back with the file.
- `mcp__lsp__find_workspace_symbols` query by kind (class/interface/function) -> symbol inventory (no per-file outline tool is mounted, so scope the query by name).
- `mcp__lsp__find_references` on top exports (line/character from a definition hit) -> reference centrality.

**codegraph** - the mounted surface is the single `mcp__codegraph__codegraph_explore` tool (an absent row answers nothing; no `codegraph_status` probe is mounted); a first-class peer to LSP, NOT a last resort:
- `mcp__codegraph__codegraph_explore` on an entry-point symbol or file -> overview, plus the call path and blast radius for the scoring matrix; ask again with more names when a query comes back thin.

Only if NEITHER exists: `Explorer` consults + the ast-grep skill (`sg`), and mark centrality unmeasured in the CODE MAP.

### Fold consult reports as they return

Each `mpd_role_spawn` returns its report as the tool result: there is no `job_output` to poll and no `bg_*` task id. Fold every report into the merge below as it arrives; a report that returns without its deliverable is re-issued once with the missing field named.

**Merge: bash + LSP/codegraph + existing + Explorer findings. Mark "discovery" as completed.**

---

## Phase 2: Scoring & Location Decision

**Mark "scoring" as in_progress.**

### Scoring Matrix

| Factor | Weight | High Threshold | Source |
|--------|--------|----------------|--------|
| File count | 3x | >20 | bash |
| Subdir count | 2x | >5 | bash |
| Code ratio | 2x | >70% | bash |
| Unique patterns | 1x | Has own config | explore |
| Module boundary | 2x | Has index.ts/__init__.py | bash |
| Symbol density | 2x | >30 symbols | LSP/cg |
| Export count | 2x | >10 exports | LSP/cg |
| Reference centrality | 3x | >20 refs | LSP/cg |

### Decision Rules

| Score | Action |
|-------|--------|
| **Root (.)** | ALWAYS create |
| **>15** | Create AGENTS.md |
| **8-15** | Create if distinct domain |
| **<8** | Skip (parent covers) |

### Output
```
AGENTS_LOCATIONS = [
  { path: ".", type: "root" },
  { path: "src/hooks", score: 18, reason: "high complexity" },
  { path: "src/api", score: 12, reason: "distinct domain" }
]
```

**Mark "scoring" as completed.**

---

## Phase 3: Generate AGENTS.md

**Mark "generate" as in_progress.**

<critical>
**File Writing Rule**: If AGENTS.md already exists at the target path → use `Edit` tool. If it does NOT exist → use `Write` tool.
NEVER use Write to overwrite an existing file. ALWAYS check existence first via `Read` or discovery results.
</critical>

### Root AGENTS.md (Full Treatment)

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}
**Commit:** {SHORT_SHA}
**Branch:** {BRANCH}

## OVERVIEW
{1-2 sentences: what + core stack}

## STRUCTURE
```
{root}/
├── {dir}/    # {non-obvious purpose only}
└── {entry}
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|

## CODE MAP
{From LSP/ast-grep - skip only if neither exists or project <10 files}

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|

## CONVENTIONS
{ONLY deviations from standard}

## ANTI-PATTERNS (THIS PROJECT)
{Explicitly forbidden here}

## UNIQUE STYLES
{Project-specific}

## COMMANDS
```bash
{dev/test/build}
```

## NOTES
{Gotchas}
```

**Quality gates**: 50-150 lines, no generic advice, no obvious info.

### Subdirectory AGENTS.md (serial consults or team)

For each location, issue ONE `mpd_role_spawn` consult, SERIALLY - each returns its report before the next is issued. When there are many locations and true concurrency helps, stage them on the mpd team plane (`create` → `add_member` per lane → `create_task` with `independent:true` → `approve` → `dispatch`) instead.

```
for loc in AGENTS_LOCATIONS (except root):
  mpd_role_spawn(role="Deep Worker", task=`
    TASK: generate AGENTS.md for ${loc.path}. Reason: ${loc.reason}
    DELIVERABLE: 30-80 lines max; NEVER repeat parent content; sections: OVERVIEW (1 line), STRUCTURE (if >5 subdirs), WHERE TO LOOK, CONVENTIONS (if different), ANTI-PATTERNS.
    SCOPE: ${loc.path}/AGENTS.md only.
    VERIFY: 50-150 lines, no generic advice, no obvious info.
  `)
```

**Mark "generate" as completed once every location has returned.**

---

## Phase 4: Review & Deduplicate

**Mark "review" as in_progress.**

For each generated file:
- Remove generic advice
- Remove parent duplicates
- Trim to size limits
- Verify telegraphic style

**Mark "review" as completed.**

---

## Final Report

```
=== init-deep Complete ===

Mode: {update | create-new}

Files:
  [OK] ./AGENTS.md (root, {N} lines)
  [OK] ./src/hooks/AGENTS.md ({N} lines)

Dirs Analyzed: {N}
AGENTS.md Created: {N}
AGENTS.md Updated: {N}

Hierarchy:
  ./AGENTS.md
  └── src/hooks/AGENTS.md
```

---

## Anti-Patterns

- **Static agent count**: MUST vary agents based on project size/depth
- **Sequential execution**: MUST parallel (explore + LSP + ast-grep concurrent)
- **Ignoring existing**: ALWAYS read existing first, even with --create-new
- **Over-documenting**: Not every dir needs AGENTS.md
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects
- **Verbose style**: Telegraphic or die
