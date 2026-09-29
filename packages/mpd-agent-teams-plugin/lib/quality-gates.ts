// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
/**
 * Pure quality-gate rules: contracts, path audit, completion, follow-up,
 * coverage, and resume. Tools and persistence call these; they do not I/O.
 * @module dsh-agent-teams/quality-gates
 */
import { FINDING_SEVERITIES, REVIEW_VERDICTS, TASK_KINDS, } from "./types.ts";
const QUALITY_KINDS = [
    'requirements',
    'implementation',
    'verification',
    'review',
    'repair',
    'integration',
];
const WRITE_KINDS = ['implementation', 'repair'];
const OPEN_STATUSES = ['pending', 'claimed', 'in_progress'];
const DEFAULT_REVIEW_POLICY = {
    requirementsMinRounds: 1,
    requirementsMaxRounds: 4,
    codeMaxRounds: 3,
    maxRepairAttempts: 2,
};
export const DEFAULT_REVIEW_ACCEPTANCE = [
    'The latest implementation meets the user goal',
    'No unresolved blocker or high findings',
];
export const DEFAULT_REVIEW_OBJECTIVE = 'Review whether the latest implementation satisfies the user goal';
const GATE_TEST_CONTRACT = /needs[_ ]revision|拒绝路径|verdict\s*=\s*needs_revision|cannot complete|不能完成|触发拒绝/iu;
export function taskKindOf(task) {
    return task?.kind ?? 'work';
}
export function isQualityKind(kind) {
    return kind !== undefined && kind !== 'work' && QUALITY_KINDS.includes(kind);
}
export function resolveReviewPolicy(policy) {
    return {
        ...DEFAULT_REVIEW_POLICY,
        ...policy,
        requirementsMinRounds: policy?.requirementsMinRounds ?? DEFAULT_REVIEW_POLICY.requirementsMinRounds,
        requirementsMaxRounds: policy?.requirementsMaxRounds ?? DEFAULT_REVIEW_POLICY.requirementsMaxRounds,
        codeMaxRounds: policy?.codeMaxRounds ?? DEFAULT_REVIEW_POLICY.codeMaxRounds,
        maxRepairAttempts: policy?.maxRepairAttempts ?? DEFAULT_REVIEW_POLICY.maxRepairAttempts,
    };
}
export function isReviewPolicy(value) {
    if (value === undefined)
        return true;
    if (!isRecord(value))
        return false;
    const numbers = ['requirementsMinRounds', 'requirementsMaxRounds', 'codeMaxRounds', 'maxRepairAttempts'];
    for (const key of numbers) {
        const item = value[key];
        if (item === undefined)
            continue;
        if (!Number.isSafeInteger(item) || item < 1)
            return false;
    }
    const min = value['requirementsMinRounds'] ?? DEFAULT_REVIEW_POLICY.requirementsMinRounds;
    const max = value['requirementsMaxRounds'] ?? DEFAULT_REVIEW_POLICY.requirementsMaxRounds;
    if (min > max)
        return false;
    if (value['requiredReviewers'] !== undefined) {
        if (!Array.isArray(value['requiredReviewers']))
            return false;
        if (!value['requiredReviewers'].every((item) => typeof item === 'string' && item.trim() !== ''))
            return false;
    }
    const allowed = new Set([...numbers, 'requiredReviewers']);
    return Object.keys(value).every((key) => allowed.has(key));
}
/** Normalize a workspace-relative POSIX path. `undefined` means illegal. */
export function normalizeWorkspacePath(path) {
    if (typeof path !== 'string')
        return undefined;
    const trimmed = path.trim();
    if (trimmed === '')
        return undefined;
    if (trimmed.startsWith('~') || /^[A-Za-z]:/.test(trimmed))
        return undefined;
    const posix = trimmed.replaceAll('\\', '/');
    if (posix.startsWith('/'))
        return undefined;
    const parts = [];
    for (const part of posix.split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..')
            return undefined;
        parts.push(part);
    }
    return parts.join('/');
}
/**
 * Match a workspace path against one inScope/outOfScope pattern with unified
 * directory-prefix semantics (B5): a pattern matches its exact path AND every
 * path beneath it, whether or not it carries a trailing slash. Callers never
 * need to remember the slash — `packages/foo` and `packages/foo/` behave
 * identically and both cover `packages/foo/bar.js`. File patterns are
 * unaffected: the prefix boundary is a `/`, so `lib/a.js` does not match
 * `lib/a.js.map`. `'.'` / `'./'` (the root) matches everything.
 */
//#region mpd-delta scope-glob (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
export function pathMatchesScope(path, pattern) {
    const normalizedPath = normalizeWorkspacePath(path);
    if (normalizedPath === undefined)
        return false;
    const rawPattern = pattern.trim().replaceAll('\\', '/');
    if (rawPattern.startsWith('~') || rawPattern.startsWith('/') || /^[A-Za-z]:/.test(rawPattern))
        return false;
    const normalizedPattern = normalizeWorkspacePath(rawPattern);
    if (normalizedPattern === undefined) {
        if (rawPattern === './' || rawPattern === '/' || rawPattern === '.')
            return true;
        return false;
    }
    if (normalizedPattern === '')
        return true;
    return pathMatchesScopeNormalized(normalizedPath, normalizedPattern);
}
const SCOPE_SEGMENT_WILDCARD = /[*?]/u;
/** Whether one pattern segment carries a `*` / `?` wildcard. */
function scopeSegmentHasWildcard(segment) {
    return SCOPE_SEGMENT_WILDCARD.test(segment);
}
/**
 * Match ONE path segment against ONE pattern segment. `*` and `?` never cross
 * the segment separator, which is what keeps `srcx/a.ts` out of `src/**`.
 */
function scopeSegmentMatches(name, pattern) {
    let nameAt = 0;
    let patternAt = 0;
    let star = -1;
    let starName = 0;
    while (nameAt < name.length) {
        const ch = pattern[patternAt];
        if (ch !== undefined && (ch === '?' || ch === name[nameAt])) {
            nameAt += 1;
            patternAt += 1;
            continue;
        }
        if (ch === '*') {
            star = patternAt;
            patternAt += 1;
            starName = nameAt;
            continue;
        }
        if (star !== -1) {
            starName += 1;
            nameAt = starName;
            patternAt = star + 1;
            continue;
        }
        return false;
    }
    while (pattern[patternAt] === '*')
        patternAt += 1;
    return patternAt === pattern.length;
}
/** Recursive segment matcher with memoization (`**` crosses zero or more segments). */
function scopeSegmentsMatch(segments, pattern, pathAt, patternAt, memo) {
    const key = `${pathAt}:${patternAt}`;
    const cached = memo.get(key);
    if (cached !== undefined)
        return cached;
    let result;
    if (patternAt === pattern.length) {
        result = pathAt === segments.length;
    }
    else if (pattern[patternAt] === '**') {
        result = scopeSegmentsMatch(segments, pattern, pathAt, patternAt + 1, memo)
            || (pathAt < segments.length && scopeSegmentsMatch(segments, pattern, pathAt + 1, patternAt, memo));
    }
    else {
        result = pathAt < segments.length
            && scopeSegmentMatches(segments[pathAt], pattern[patternAt])
            && scopeSegmentsMatch(segments, pattern, pathAt + 1, patternAt + 1, memo);
    }
    memo.set(key, result);
    return result;
}
/**
 * The B5 no-wildcard semantics (exact path OR directory prefix) kept first and
 * bit-identical, so every declaration that worked before this delta still
 * resolves the same way; a wildcard pattern additionally supports `**`
 * (crosses separators), `*` and `?` (single segment only).
 */
function pathMatchesScopeNormalized(normalizedPath, normalizedPattern) {
    const patternSegments = normalizedPattern.split('/');
    if (!patternSegments.some(scopeSegmentHasWildcard)) {
        return normalizedPath === normalizedPattern
            || normalizedPath.startsWith(`${normalizedPattern}/`);
    }
    return scopeSegmentsMatch(normalizedPath.split('/'), patternSegments, 0, 0, new Map());
}
//#endregion mpd-delta scope-glob
function isDefaultExcluded(path) {
    const normalized = normalizeWorkspacePath(path);
    if (normalized === undefined)
        return false;
    const segments = normalized.split('/');
    const base = segments[segments.length - 1] ?? '';
    if (segments[0] === '.git' || segments[0] === '.dsh')
        return true;
    if (base === '.env' || base.startsWith('.env.'))
        return true;
    if (segments.includes('secrets'))
        return true;
    if (base.startsWith('id_rsa'))
        return true;
    return false;
}
export function classifyChangedPath(path, inScope = [], outOfScope = []) {
    if (normalizeWorkspacePath(path) === undefined)
        return 'illegal';
    if (isDefaultExcluded(path))
        return 'out_of_scope';
    if (outOfScope.some((pattern) => pathMatchesScope(path, pattern)))
        return 'out_of_scope';
    if (inScope.some((pattern) => pathMatchesScope(path, pattern)))
        return 'in_scope';
    return 'undeclared';
}
export function collectChangedPaths(gitStatusText) {
    const paths = [];
    const seen = new Set();
    for (const rawLine of gitStatusText.split(/\r?\n/u)) {
        const line = rawLine.trimEnd();
        if (line.trim() === '')
            continue;
        let candidate = line;
        const rename = /->\s+(\S+)$/u.exec(line);
        if (/^[ MADRCU?!]{1,2}\s+/u.test(line)) {
            candidate = rename?.[1] ?? line.replace(/^[ MADRCU?!]{1,2}\s+/u, '');
        }
        const cleaned = candidate.replace(/^"|"$/gu, '').trim();
        const normalized = normalizeWorkspacePath(cleaned);
        if (normalized === undefined || seen.has(normalized))
            continue;
        seen.add(normalized);
        paths.push(normalized);
    }
    return paths;
}

//#region mpd-delta scope-overlap (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
export function inScopeOverlap(left, right) {
    if (left === undefined || right === undefined)
        return [];
    const hits = [];
    for (const a of left) {
        for (const b of right) {
            const hit = a === b
                ? true
                : scopePatternsOverlap(normalizeScopePattern(a), normalizeScopePattern(b));
            if (hit) {
                if (!hits.includes(a))
                    hits.push(a);
            }
        }
    }
    return hits;
}
// T-01 (wave 1, t20): the OWNERSHIP QUERY shares this delta's match rule on purpose —
// the "who owns <path>" answer and the overlap refusal must never drift apart.
/**
 * T-01 (wave 1, t20): WHO OWNS A PATH.
 *
 * The overlap gate refuses a create whose `inScope` collides with an OPEN write task, but it
 * never said how to repair the collision: the only escape was to destroy a task and recreate it,
 * which changes its id (`tools.js` monotone ids) and downgrades it. This is the QUERY half — the
 * same match rule the gate itself uses (`pathMatchesScope`), so the answer cannot drift from the
 * refusal — and `agent_teams_move_path` is the repair half.
 *
 * @param team - the team record (read-only).
 * @param path - the workspace-relative path to look up.
 * @param options.openOnly - restrict to tasks that can still be dispatched.
 * @returns one entry per write task whose inScope matches, with the matching patterns and any
 *          outOfScope pattern that excludes it (an excluded task is reported, never silently
 *          dropped: the caller needs to know WHY it can write the path).
 */
export function scopeOwners(team, path, options = {}) {
    const owners = [];
    if (team === undefined || team === null || !Array.isArray(team.tasks))
        return owners;
    if (typeof path !== 'string' || path.trim() === '')
        return owners;
    for (const task of team.tasks) {
        if (!WRITE_KINDS.includes(taskKindOf(task)))
            continue;
        const open = OPEN_STATUSES.includes(task.status);
        if (options.openOnly === true && !open)
            continue;
        const matched = (task.inScope ?? []).filter((pattern) => pathMatchesScope(path, pattern));
        if (matched.length === 0)
            continue;
        const excludedBy = (task.outOfScope ?? []).filter((pattern) => pathMatchesScope(path, pattern));
        owners.push({
            task_id: task.id,
            subject: task.subject ?? '',
            kind: taskKindOf(task),
            status: task.status,
            assignee: task.assignee ?? '',
            matched,
            excluded_by: excludedBy,
            open,
        });
    }
    return owners;
}
/** Whether a task status can still be dispatched (the gate's own OPEN_STATUSES rule). */
export function isOpenTaskStatus(status) {
    return OPEN_STATUSES.includes(status);
}
/** One human-readable owner, for a refusal message. */
export function describeScopeOwner(owner) {
    const subject = owner.subject === '' ? '' : ` ("${owner.subject}")`;
    const assignee = owner.assignee === '' ? '' : ` assigned to ${owner.assignee}`;
    return `${owner.task_id}${subject}${assignee} [${owner.status}]`;
}

//#endregion mpd-delta scope-overlap
//#region mpd-delta scope-overlap-normalize (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** Normalize a scope pattern for the overlap relation (`undefined` -> empty). */
function normalizeScopePattern(pattern) {
    const normalized = normalizeWorkspacePath(pattern.trim().replaceAll('\\', '/'));
    return normalized === undefined || normalized === '' ? '.' : normalized;
}
//#endregion mpd-delta scope-overlap-normalize
function nonemptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}
function nonemptyStringList(value) {
    return Array.isArray(value) && value.length > 0 && value.every(nonemptyString);
}
//#region mpd-delta contract-contradiction (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/** Whether a scope pattern matches EVERY path (root / `**` spellings). */
function isMatchEverythingPattern(pattern) {
    const raw = pattern.trim().replaceAll('\\', '/');
    return raw === '.' || raw === './' || raw === '/' || raw === '**' || raw === '**/';
}
/**
 * A scope pair (inScope, outOfScope) that no path can satisfy, or undefined.
 * The wave-1 defect this closes: an auto-generated repair contract listed one
 * path in BOTH lists, so the edit its own acceptance REQUIRED was classified
 * `out_of_scope` by the update gate (t13). Either the inScope declaration is
 * itself forbidden by outOfScope (`pathMatchesScope(allowed, forbidden)`), or
 * outOfScope forbids everything.
 */
export function contractContradiction(inScope = [], outOfScope = []) {
    const universal = outOfScope.find((pattern) => isMatchEverythingPattern(pattern));
    if (universal !== undefined)
        return { inScope: inScope[0] ?? '', outOfScope: universal };
    for (const allowed of inScope) {
        for (const forbidden of outOfScope) {
            // pathMatchesScope(path, pattern): `path` is the candidate changed
            // path. A carve-out (`packages/foo` allowed + `packages/foo/vendor`
            // forbidden) stays satisfiable because the forbidden pattern does
            // not cover the allowed DECLARATION itself.
            if (pathMatchesScope(allowed, forbidden))
                return { inScope: allowed, outOfScope: forbidden };
        }
    }
    return undefined;
}
/**
 * The scope part of an auto-generated repair contract, contradiction-free.
 *
 * A finding's file that the source contract FORBIDS is CARVED OUT of the
 * inherited outOfScope: the covering patterns are dropped from the result and
 * the file is admitted to inScope, so a `needs_revision` verdict can always be
 * acted on. The repair's own acceptance text is the authority for the paths it
 * requires — leaving the prohibition in place would make the verdict
 * unsatisfiable and deadlock the automatic repair loop (the wave-1 t13 defect:
 * the generated repair listed `AGENTS.md` in BOTH lists because t10's finding
 * required an edit that the source t7 contract's outOfScope forbade).
 * Admissions are deduplicated against the source declaration, a path the repair
 * is NOT required to touch keeps its prohibition, and a path the source already
 * declared inScope does not get a second scope entry.
 */
export function repairScopeFromFindings(findings, source) {
    const sourceInScope = (source?.inScope ?? []).filter((pattern) => nonemptyString(pattern));
    const sourceOutOfScope = (source?.outOfScope ?? []).filter((pattern) => nonemptyString(pattern));
    const allowed = [];
    const allow = (path) => {
        if (allowed.includes(path))
            return;
        allowed.push(path);
    };
    for (const pattern of sourceInScope)
        allow(pattern);
    const required = [];
    for (const finding of findings) {
        const file = finding.file;
        if (!nonemptyString(file) || normalizeWorkspacePath(file) === undefined)
            continue;
        if (!required.includes(file))
            required.push(file);
        if (allowed.some((pattern) => pathMatchesScope(file, pattern)))
            continue;
        allow(file);
    }
    if (allowed.length === 0)
        return undefined;
    // A pattern the repair now requires a path through stops being a prohibition
    // (it is dropped); a pattern unrelated to any finding file is preserved as-is.
    const carved = sourceOutOfScope.filter((pattern) => !required.some((file) => pathMatchesScope(file, pattern)));
    return { inScope: allowed, ...(carved.length > 0 ? { outOfScope: carved } : {}) };
}
/**
 * The B7 overlap test, as a true "may two writers touch the same path" relation:
 * two declarations overlap when at least one workspace path can match BOTH, where a
 * declaration covers exactly what `pathMatchesScope` covers — the declaration itself
 * and everything beneath it (the dir-prefix rule), with `**` crossing separators and
 * `*` / `?` staying inside one segment.
 *
 * The wave-2 body this replaces was inverted for its ONLY caller (`inScopeOverlap`,
 * i.e. the create-task sibling validator): it called two DIFFERENT same-depth paths a
 * collision (`docs/index.md` vs `scripts/build-mcp.mjs`) while reporting a parent and
 * the file inside it as disjoint (`docs` vs `docs/index.md`), so it refused independent
 * lanes and waved through the one shape that really races on a file. Measured
 * 2026-09-14: three task creations were only unblocked by naming an unrelated task as a
 * dependency (`evidence/mpd-naming/verifier-contract/`). The carve-out question it used
 * to answer is asked by `contractContradiction`/`repairScopeFromFindings` through
 * `pathMatchesScope`, never through this relation.
 */
function scopePatternsOverlap(left, right) {
    if (isMatchEverythingPattern(left) || isMatchEverythingPattern(right))
        return true;
    return scopeSegmentsOverlap(left.split('/'), 0, right.split('/'), 0);
}
/**
 * Whether two segment lists can describe the same path. A side that runs out first
 * COVERS every path below the other (dir-prefix), which is exactly the parent/child
 * overlap; two different literal segments can never meet.
 */
function scopeSegmentsOverlap(left, leftAt, right, rightAt) {
    if (leftAt >= left.length || rightAt >= right.length)
        return true;
    const one = left[leftAt];
    const other = right[rightAt];
    if (one === '**')
        return scopeSegmentsOverlap(left, leftAt + 1, right, rightAt) || scopeSegmentsOverlap(left, leftAt, right, rightAt + 1);
    if (other === '**')
        return scopeSegmentsOverlap(left, leftAt, right, rightAt + 1) || scopeSegmentsOverlap(left, leftAt + 1, right, rightAt);
    const oneWild = scopeSegmentHasWildcard(one);
    const otherWild = scopeSegmentHasWildcard(other);
    if (oneWild || otherWild) {
        // The concrete side is the witness for the patterned side; when BOTH sides are
        // patterned the relation stays conservative (serialize rather than guess).
        if (!oneWild && !scopeSegmentMatches(one, other))
            return false;
        if (!otherWild && !scopeSegmentMatches(other, one))
            return false;
        return scopeSegmentsOverlap(left, leftAt + 1, right, rightAt + 1);
    }
    if (one !== other)
        return false;
    return scopeSegmentsOverlap(left, leftAt + 1, right, rightAt + 1);
}
//#endregion mpd-delta contract-contradiction
function dependencyClosureContains(tasks, dependencies, targetId) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const pending = [...dependencies];
    const visited = new Set();
    while (pending.length > 0) {
        const id = pending.pop();
        if (id === undefined || visited.has(id))
            continue;
        if (id === targetId)
            return true;
        visited.add(id);
        pending.push(...(byId.get(id)?.dependencies ?? []));
    }
    return false;
}
export function validateCreateTask(team, input) {
    const kind = input.kind ?? 'work';
    if (!TASK_KINDS.includes(kind)) {
        return { ok: false, error: `unknown task kind "${String(kind)}"` };
    }
    if (team.halted === true) {
        const reason = input.resumeReason?.trim() ?? '';
        if (input.resume !== true || reason === '') {
            return { ok: false, error: 'team is halted; resume with a non-empty reason before create_task' };
        }
    }
    if (isQualityKind(kind)) {
        if (!nonemptyString(input.objective)) {
            return { ok: false, error: `${kind} tasks require a non-empty objective` };
        }
        if (!nonemptyStringList(input.acceptance)) {
            return { ok: false, error: `${kind} tasks require at least one acceptance criterion` };
        }
    }
    //#region mpd-delta create-contract-gate (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    if (WRITE_KINDS.includes(kind)) {
        if (!nonemptyStringList(input.inScope)) {
            return { ok: false, error: `${kind} tasks require a non-empty inScope` };
        }
        if (!nonemptyStringList(input.verify)) {
            return { ok: false, error: `${kind} tasks require a non-empty verify list` };
        }
        const contradiction = contractContradiction(input.inScope, input.outOfScope ?? []);
        if (contradiction !== undefined) {
            return {
                ok: false,
                error: `${kind} contract is unsatisfiable: no path can ever be in scope — declared "${contradiction.inScope}" is forbidden by outOfScope "${contradiction.outOfScope}"`
                    + `\nFix: drop the duplicate from outOfScope or narrow it (e.g. outOfScope "packages/foo/vendor" instead of "packages/foo").`,
            };
        }
    }
    //#endregion mpd-delta create-contract-gate
    if (kind === 'review') {
        if (!nonemptyString(input.reviewedTaskId)) {
            return { ok: false, error: 'review tasks require reviewedTaskId' };
        }
        if (!team.tasks.some((item) => item.id === input.reviewedTaskId)) {
            return { ok: false, error: `reviewed task "${input.reviewedTaskId}" does not exist` };
        }
    }
    if (kind === 'repair') {
        if (!nonemptyString(input.sourceTaskId) || !nonemptyStringList(input.sourceFindingIds)) {
            return { ok: false, error: 'repair tasks require sourceTaskId and at least one sourceFindingId' };
        }
        if (!team.tasks.some((item) => item.id === input.sourceTaskId)) {
            return { ok: false, error: `source task "${input.sourceTaskId}" does not exist` };
        }
    }
    let dependencies = (input.dependencies ?? []).slice();
    // A review must wait for its reviewed task (the successful source): the
    // protocol promises "reviews depend on the successful source, never the
    // failed review". Auto-wire reviewedTaskId into the dependency list so a
    // review can never dispatch before its source completes — otherwise a
    // deps-empty review dispatches immediately, rejects the not-yet-existing
    // implementation, and starts a false-reject loop. A repair likewise must
    // wait for its source implementation before it can touch the same paths.
    if (kind === 'review' && input.reviewedTaskId !== undefined && !dependencies.includes(input.reviewedTaskId)) {
        dependencies.push(input.reviewedTaskId);
    }
    //#region mpd-delta repair-source-open-edge (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // T-81 (wave 2, lane A) — the repair auto-wire DEADLOCKED on an OPEN source.
    //
    // MEASURED (wave 1, `t21`): a repair created on a task whose own `verify` was blocked by the
    // very defect the repair existed to fix acquired the implicit edge `repair -> source`, so the
    // repair waited for a source that could only complete AFTER the repair; the captain had to
    // take the task over to break the cycle. The edge's stated purpose — "a repair must wait for
    // its source implementation before it can touch the same paths" (the comment above) — holds
    // only for a source that has ALREADY finished: for an OPEN source the source is not a
    // deliverable to wait for, and waiting can park the pair forever.
    //
    // The edge is therefore kept for every NON-open source: `completed` keeps the protection, and
    // `failed`/`cancelled` KEEP the edge so the refusal loop below still fires (`repair must not
    // depend on failed task …`) — that guard is a regression control of this change, not a
    // casualty of it. `sourceTaskId` stays on the record either way: provenance is not a
    // dependency.
    const repairSource = kind === 'repair' && input.sourceTaskId !== undefined
        ? team.tasks.find((item) => item.id === input.sourceTaskId)
        : undefined;
    if (kind === 'repair' && input.sourceTaskId !== undefined && !dependencies.includes(input.sourceTaskId)
        && (repairSource === undefined || !OPEN_STATUSES.includes(repairSource.status))) {
        dependencies.push(input.sourceTaskId);
    }
    //#endregion mpd-delta repair-source-open-edge
    for (const dependency of dependencies) {
        const upstream = team.tasks.find((item) => item.id === dependency);
        if (upstream === undefined) {
            return { ok: false, error: `dependency "${dependency}" does not exist` };
        }
        if ((kind === 'repair' || kind === 'review') && (upstream.status === 'failed' || upstream.status === 'cancelled')) {
            return { ok: false, error: `${kind} must not depend on ${upstream.status} task "${dependency}"` };
        }
    }
    if (WRITE_KINDS.includes(kind) && nonemptyStringList(input.inScope)) {
        for (const other of team.tasks) {
            if (!WRITE_KINDS.includes(taskKindOf(other)))
                continue;
            if (!OPEN_STATUSES.includes(other.status))
                continue;
            if (dependencies.includes(other.id) || other.dependencies.includes('pending-new'))
                continue;
            if (dependencies.includes(other.id))
                continue;
            const overlap = inScopeOverlap(input.inScope, other.inScope);
            if (overlap.length > 0) {
                //#region mpd-delta scope-overlap-refusal (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
                // T-01 (wave 1, t20): name the OWNING task and offer a repair. Measured 2026-09-17:
                // this wave hit the old wording ("inScope overlaps t1 at ...; serialize these tasks
                // or split the paths") three times while its own plan was being built, and the only
                // escape was remove+re-add, which renumbers the task and downgrades it. The refusal
                // now carries the owner's subject/assignee/status and the exact repair call.
                const owner = describeScopeOwner({
                    task_id: other.id,
                    subject: other.subject ?? '',
                    kind: taskKindOf(other),
                    status: other.status,
                    assignee: other.assignee ?? '',
                });
                return {
                    ok: false,
                    error: `inScope overlaps ${owner} at ${overlap.join(', ')}; repair WITHOUT remove+re-add: agent_teams_move_path { path: "${overlap[0]}", from_task: "${other.id}", to_task: "<the task that should own it>" } to hand the path over, or agent_teams_update_task { task_id: "${other.id}", status: "${other.status}", amend: { inScope: ["<the narrowed list>"] } } to edit ONE contract in place — or split the paths`,
                    owner: {
                        task_id: other.id,
                        subject: other.subject ?? '',
                        assignee: other.assignee ?? '',
                        status: other.status,
                        matched: overlap,
                    },
                    repair: { tool: 'agent_teams_move_path', path: overlap[0], from_task: other.id },
                };
                //#endregion mpd-delta scope-overlap-refusal
            }
        }
    }
    if (kind === 'implementation') {
        const requirements = team.tasks.filter((item) => taskKindOf(item) === 'requirements');
        const passed = requirements.some((item) => item.status === 'completed' && item.verdict === 'pass');
        const stagedBehindRequirements = team.phase === 'staged' && requirements.some((item) => (dependencyClosureContains(team.tasks, dependencies, item.id)));
        if (requirements.length > 0 && !passed && !stagedBehindRequirements) {
            return {
                ok: false,
                error: team.phase === 'staged'
                    ? 'implementation must depend on the staged requirements task; it will run only after requirements passes'
                    : 'implementation is blocked until a requirements task completes with verdict=pass',
            };
        }
    }
    const nextTeam = team.halted === true && input.resume === true
        ? { ...team, halted: false, haltedAt: undefined }
        : team;
    return {
        ok: true,
        kind,
        team: nextTeam,
        task: {
            subject: input.subject,
            kind,
            ...input.description === undefined ? {} : { description: input.description },
            ...input.assignee === undefined ? {} : { assignee: input.assignee },
            dependencies,
            ...input.round === undefined ? {} : { round: input.round },
            ...input.objective === undefined ? {} : { objective: input.objective },
            ...input.inScope === undefined ? {} : { inScope: input.inScope },
            ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
            ...input.acceptance === undefined ? {} : { acceptance: input.acceptance },
            ...input.verify === undefined ? {} : { verify: input.verify },
            ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
            ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
            ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
            ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
            ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
            ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
        },
    };
}
const STATUS_TRANSITIONS = {
    pending: ['claimed', 'cancelled'],
    claimed: ['in_progress', 'failed', 'cancelled'],
    in_progress: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
};
function openHighFindings(findings) {
    return (findings ?? []).filter((finding) => (finding.resolved !== true && (finding.severity === 'high' || finding.severity === 'blocker')));
}
//#region mpd-delta coverage-name-match (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * T-29 (review R5/R6, the captain's NAME ruling): a coverage fallback compares NAMES, never counts.
 * The normalisation is deliberately lenient — whitespace collapsed, case folded, trailing punctuation
 * dropped — which is the paraphrase tolerance the count-only fallback existed for; the hole the ruling
 * closes is a WRONG name of the RIGHT count, which used to be accepted.
 */
function normalizeCoverageName(text) {
    return String(text ?? '').replace(/\s+/gu, ' ').trim().toLowerCase().replace(/[.;:,!?\u2026]+$/u, '');
}
/** True when `provided` names `expected` one-for-one (any order) under the normalised comparison. */
function coverageNamesMatch(expected, provided) {
    if (expected.length !== provided.length)
        return false;
    const pool = [...provided];
    for (const name of expected) {
        const at = pool.indexOf(name);
        if (at === -1)
            return false;
        pool.splice(at, 1);
    }
    return true;
}
//#endregion mpd-delta coverage-name-match
//#region mpd-delta acceptance-name-match (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// T-29 (review R6, the captain's NAME ruling): the fallback requires the NAMES to match one-for-one
// under a normalised comparison (whitespace / case / trailing punctuation tolerant), so a paraphrased
// but recognisable criterion still passes while a WRONG-named item of the right COUNT is refused; the
// count-only reading is withdrawn. The WHOLE function sits inside this ONE region on purpose — a
// region that SPLITS a function leaves the stripped skeleton with a mangled body, and the strip/heal
// cycle then cannot reproduce the canonical bytes (measured on the first attempt: two deltas became
// unplaceable).
function acceptanceCovered(required, results) {
    if (results === undefined)
        return false;
    const byCriterion = new Map(results.map((item) => [item.criterion, item]));
    if ((required ?? []).every((criterion) => byCriterion.get(criterion)?.status === 'passed'))
        return true;
    // Structured result arrays naturally preserve the contract order, and a model may paraphrase
    // punctuation/whitespace in `criterion` — so the fallback normalises the names. T-29 (review R6,
    // the captain's NAME ruling): it requires the NAMES to match one-for-one, not merely the COUNT, so
    // a wrong-named item of the right count is refused (the count-only reading is withdrawn).
    // Verification evidence remains independently required below.
    return results.every((item) => item.status === 'passed')
        && coverageNamesMatch((required ?? []).map(normalizeCoverageName), results.map((item) => normalizeCoverageName(item.criterion)));
}
//#endregion mpd-delta acceptance-name-match
//#region mpd-delta reported-red-coverage (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// T-84 (wave 2b, lane A): a RED the contract requires to be REPORTED has no ledger surface today,
// so a seat must either mislabel it (`passed`) or fail the task (`failed`). The third status
// `reported` carries a LABELLED red and DOES cover its command — while `failed` keeps its full
// force (this row's negative control: a genuinely failed command must still fail the task).
function verifyCovered(required, results) {
    if (results === undefined)
        return false;
    const byCommand = new Map(results.map((item) => [item.command, item]));
    const covers = (entry) => entry?.status === 'passed' || entry?.status === 'reported';
    if ((required ?? []).every((command) => covers(byCommand.get(command))))
        return true;
    // T-29 (review R5, the captain's NAME ruling): the fallback names, never counts — a `reported`
    // entry whose `command` is a DIFFERENT COMMAND no longer covers the required command, which is what
    // the gate's own refusal text ("no entry for <command>") always claimed.
    return results.length === (required ?? []).length && results.every((item) => covers(item))
        && coverageNamesMatch((required ?? []).map(normalizeCoverageName), results.map((item) => normalizeCoverageName(item.command)));
}
//#endregion mpd-delta reported-red-coverage
//#region mpd-delta coverage-gap-text (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * T-87 (wave 2b, lane A): WHAT IS MISSING, NAMED — the unmatched required items and the count,
 * appended to a completion refusal. `absent` = not present in the payload at all (the shape an
 * amended contract produces); `unpaid` = present but not in an accepted status. Both are named,
 * so a seat can repair the payload without a round trip.
 */
function coverageGapText(required, results, key, accepted) {
    const named = required ?? [];
    if (named.length === 0)
        return ' — the contract declares no such item, so any payload is acceptable';
    const provided = new Map((results ?? []).map((item) => [item[key], item]));
    const absent = [];
    const unpaid = [];
    for (const name of named) {
        const entry = provided.get(name);
        if (entry === undefined)
            absent.push(name);
        else if (!accepted.includes(entry.status))
            unpaid.push(name);
    }
    if (absent.length === 0 && unpaid.length === 0)
        return '';
    const parts = [];
    if (absent.length > 0)
        parts.push(`no entry for ${absent.join(', ')}`);
    // T-29 (review R5/R6, the captain's NAME ruling): when an item is missing but the payload DID
    // carry unmatched entries, the refusal names the near-miss, so the seat sees what the payload
    // actually said instead of only what was expected.
    const unmatched = [...provided.keys()].filter((name) => !named.includes(name));
    if (absent.length > 0 && unmatched.length > 0)
        parts.push(`nearest provided: ${unmatched.slice(0, 3).map((name) => JSON.stringify(name)).join(', ')}`);
    if (unpaid.length > 0)
        parts.push(`not ${accepted.join('/')}: ${unpaid.join(', ')}`);
    return ` — ${parts.join('; ')} (matched ${named.length - absent.length - unpaid.length} of ${named.length})`;
}
//#endregion mpd-delta coverage-gap-text
export function evaluateQualityCompletion(task, update) {
    const nextStatus = update.status;
    if (nextStatus !== undefined && nextStatus !== task.status) {
        if (!STATUS_TRANSITIONS[task.status].includes(nextStatus)) {
            return { ok: false, error: `task status cannot move from "${task.status}" to "${nextStatus}"` };
        }
    }
    const kind = taskKindOf(task);
    if (kind === 'work')
        return { ok: true };
    const verdict = update.verdict ?? task.verdict;
    const findings = update.findings ?? task.findings;
    if (kind === 'review' || kind === 'requirements') {
        if (nextStatus === 'completed') {
            if (verdict === undefined)
                return { ok: false, error: `${kind} cannot complete without verdict=pass` };
            if (verdict !== 'pass')
                return { ok: false, error: `${kind} with verdict=${verdict} cannot complete` };
            if (openHighFindings(findings).length > 0) {
                return { ok: false, error: `${kind} pass cannot leave unresolved high/blocker findings` };
            }
        }
        if (nextStatus === 'failed' && (verdict === 'needs_revision' || verdict === 'reject')) {
            if ((findings ?? []).length < 1) {
                return { ok: false, error: `${kind} ${verdict} requires at least one finding` };
            }
        }
        return { ok: true };
    }
    if (kind === 'implementation' || kind === 'repair' || kind === 'verification' || kind === 'integration') {
        const commands = update.commandsRun ?? task.commandsRun;
        if (commands?.some((item) => item.status === 'failed') === true) {
            if (nextStatus === 'completed') {
                return { ok: false, error: 'verify failure must fail the task', requiredStatus: 'failed' };
            }
        }
        if (nextStatus !== 'completed')
            return { ok: true };
        //#region mpd-delta completion-coverage-refusals (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        // T-87 (wave 2b, lane A): the claim-time payload template is invalidated by an AMENDED
        // acceptance, and the refusal used to name nothing. BOTH refusals now name the unmatched
        // item(s) AND the count; a payload with a genuinely wrong item is still refused.
        const acceptanceResults = update.acceptanceResults ?? task.acceptanceResults;
        if (acceptanceResults === undefined || !acceptanceCovered(task.acceptance, acceptanceResults)) {
            return { ok: false, error: `${kind} completion requires passed acceptanceResults for every acceptance item${coverageGapText(task.acceptance, acceptanceResults, 'criterion', ['passed'])}` };
        }
        if (commands === undefined || !verifyCovered(task.verify, commands)) {
            return { ok: false, error: `${kind} completion requires a passed commandsRun entry for every verify command${coverageGapText(task.verify, commands, 'command', ['passed', 'reported'])}` };
        }
        //#endregion mpd-delta completion-coverage-refusals
        if (kind === 'implementation' || kind === 'repair') {
            const changed = update.changedPaths ?? task.changedPaths;
            if (changed === undefined) {
                return { ok: false, error: `${kind} completion requires changedPaths` };
            }
            // Report EVERY out-of-scope path at once (B6) instead of failing on
            // the first one, so the member can correct the whole set (or the
            // inScope contract) in one pass instead of a fix-retry loop.
            const offenders = [];
            for (const path of changed) {
                const classification = classifyChangedPath(path, task.inScope ?? [], task.outOfScope ?? []);
                if (classification !== 'in_scope')
                    offenders.push({ path, classification });
            }
            if (offenders.length > 0) {
                const listed = offenders.map((item) => `  - ${item.path} is ${item.classification}`).join('\n');
                return {
                    ok: false,
                    error: `${kind} ${task.id} cannot complete: ${offenders.length} changed path(s) not covered by inScope:\n${listed}\nFix: add the path(s) to inScope, or use a directory prefix pattern (e.g. "packages/foo" or "packages/foo/") that covers them.`,
                };
            }
        }
    }
    return { ok: true };
}
function unresolvedFindings(task) {
    return (task.findings ?? []).filter((finding) => finding.resolved !== true);
}
function findingKey(ids) {
    return [...ids].sort().join(',');
}
const CAPTAIN_ASSIGNEE = 'captain';
const OPEN_FOLLOW_UP_STATUSES = ['pending', 'claimed', 'in_progress'];
//#region mpd-delta repair-seat-capability (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * T-93 (wave 2b, lane A): can this seat EXECUTE the task the generator is about to create?
 *
 * The row: "the auto-generated repair routes to a seat that can execute it — write-kind tasks to a
 * writer, or to the reviewed artifact's author; the generator reads the seat's deny list the way the
 * spawn surface does." MEASURED at t51: `schedulableAssignee` read only the member's NAME, so a review
 * completed by a read-only seat generated a repair assigned to a reference-only owner — and the pool
 * guard dispatches an EXPLICIT assignment even to a restricted member (`nextCapableTask`'s own
 * documented rule), so the repair went to a seat whose `toolDeny` makes it unsatisfiable.
 *
 * The read is the dispatch's OWN model (`lib/scheduler.ts`, `taskCapabilityGap`): a WRITE half when
 * the task is `implementation`/`repair` or declares any `inScope`, an EXECUTION half when it declares
 * `verify` commands, and only the tool names that make those halves possible take part. It is
 * DUPLICATED rather than imported because `lib/state.ts` imports this module and `lib/scheduler.ts`
 * imports `state.js`, so importing the scheduler here would close a cycle; the arm asserts the two
 * reads AGREE on a fixture matrix (the equivalence the row's DECISIVE clause names).
 * @param task - the task about to be created (its own fields decide, never a caller's claim).
 * @param member - the candidate seat.
 * @returns the withheld tool names (empty = this seat can run it).
 */
export function generatedTaskCapabilityGap(task, member) {
    const denied = new Set(member?.toolDeny ?? []);
    const writes = task?.kind === 'implementation' || task?.kind === 'repair' || (task?.inScope ?? []).length > 0;
    const exec = (task?.verify ?? []).length > 0;
    const missing = [];
    if (writes)
        for (const tool of ['write', 'edit', 'mpd_hashline_edit'])
            if (denied.has(tool))
                missing.push(tool);
    if (exec && denied.has('bash'))
        missing.push('bash');
    return missing;
}
//#endregion mpd-delta repair-seat-capability
//#region mpd-delta repair-seat-selection (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
/**
 * Pick the seat for a generated task.
 *
 * T-93 (wave 2b, lane A): with `need` supplied, a candidate whose deny list withholds what the task
 * needs is SKIPPED — the reviewed artifact's author is still preferred, but only while the author can
 * execute the repair; otherwise the first capable member is chosen. With `need` omitted the selection
 * is unchanged (the read-only-writer exclusion is the repair's problem, not a review's).
 */
function schedulableAssignee(preferred, team, forbidden, need) {
    const capable = (member) => need === undefined || generatedTaskCapabilityGap(need, member).length === 0;
    if (preferred !== undefined && preferred !== CAPTAIN_ASSIGNEE && preferred !== forbidden) {
        const live = team.members.find((member) => member.name === preferred && member.status !== 'removed');
        if (live !== undefined && capable(live))
            return live.name;
    }
    return team.members.find((member) => (member.status !== 'removed'
        && member.name !== CAPTAIN_ASSIGNEE
        && member.name !== forbidden
        && capable(member)))?.name;
}
//#endregion mpd-delta repair-seat-selection
function countRepairAttempts(team, sourceTaskId, findingIds) {
    const key = findingKey(findingIds);
    return team.tasks.filter((item) => (taskKindOf(item) === 'repair'
        && item.sourceTaskId === sourceTaskId
        && findingKey(item.sourceFindingIds ?? []) === key)).length;
}
function hasOpenFollowUp(team, sourceTaskId, findingIds) {
    const key = findingKey(findingIds);
    return team.tasks.some((item) => (taskKindOf(item) === 'repair'
        && item.sourceTaskId === sourceTaskId
        && findingKey(item.sourceFindingIds ?? []) === key
        && OPEN_FOLLOW_UP_STATUSES.includes(item.status)));
}
export function planQualityFollowUp(team, closed) {
    const empty = { created: [], tasks: [] };
    const kind = taskKindOf(closed);
    if ((kind !== 'review' && kind !== 'requirements') || closed.status !== 'failed')
        return empty;
    if (closed.verdict === 'reject') {
        // "Implementation does not exist" class: the review rejected without a
        // workable source (missing / failed / cancelled / still pending). No
        // automatic repair can target such a premise — notify the captain only
        // instead of escalating the whole team or spawning a repair.
        const sourceId = closed.reviewedTaskId ?? closed.sourceTaskId;
        const source = sourceId === undefined ? undefined : team.tasks.find((item) => item.id === sourceId);
        const premiseBroken = source === undefined || source.status !== 'completed';
        if (premiseBroken) {
            return {
                ...empty,
                notifyCaptain: `Review ${closed.id} rejected (verdict=reject) but its reviewed task ${sourceId ?? '(missing)'} is not completed — no automatic repair was created; the captain must intervene before the review loop can continue.`,
            };
        }
        return { ...empty, escalated: true, status: 'escalated' };
    }
    if (closed.verdict !== 'needs_revision')
        return empty;
    const policy = resolveReviewPolicy(team.reviewPolicy);
    const currentRound = closed.round ?? 1;
    const nextRound = currentRound + 1;
    const maxRounds = kind === 'requirements' ? policy.requirementsMaxRounds : policy.codeMaxRounds;
    if (nextRound > maxRounds)
        return { ...empty, escalated: true, status: 'escalated' };
    if (kind === 'requirements') {
        const next = {
            kind: 'requirements',
            subject: `requirements-round-${nextRound}`,
            assignee: closed.assignee,
            dependencies: [],
            round: nextRound,
            objective: sanitizeReviewObjective(closed.objective, 'Converge remaining open questions'),
            acceptance: sanitizeReviewAcceptance(unresolvedFindings(closed).map((finding) => finding.requiredFix)),
            reasonTaskId: closed.id,
        };
        return { created: [next], tasks: [next] };
    }
    const sourceId = closed.reviewedTaskId ?? closed.sourceTaskId;
    if (sourceId === undefined)
        return empty;
    const source = team.tasks.find((item) => item.id === sourceId);
    const findings = unresolvedFindings(closed);
    const findingIds = findings.map((finding) => finding.id);
    if (hasOpenFollowUp(team, sourceId, findingIds))
        return empty;
    if (countRepairAttempts(team, sourceId, findingIds) >= policy.maxRepairAttempts) {
        return { ...empty, escalated: true, status: 'escalated' };
    }
    const files = findings.map((finding) => finding.file).filter((file) => nonemptyString(file));
    //#region mpd-delta repair-seat-required (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // T-93 (wave 2b, lane A): NO capable seat = NO repair. The generator used to fall back to ANY
    // member, so a team whose only seats are read-only got a repair that could never complete; the
    // row's negative control asks for a loud refusal or a captain route instead, and this is BOTH —
    // the repair is not created and the reason names what each seat withholds.
    const repairNeed = { kind: 'repair', verify: source?.verify };
    const implementer = schedulableAssignee(source?.assignee, team, undefined, repairNeed);
    if (implementer === undefined) {
        const gaps = team.members
            .filter((member) => member.status !== 'removed' && member.name !== CAPTAIN_ASSIGNEE)
            .map((member) => `${member.name} withholds ${generatedTaskCapabilityGap(repairNeed, member).join(', ') || 'nothing'}`);
        return {
            ...empty,
            notifyCaptain: `Review ${closed.id} needs a repair for ${sourceId}, but NO seat in this team can execute it — ${gaps.join('; ') || 'the team has no assignable member'}. The repair was NOT created: assign a write-capable seat (or widen the deny list) and re-run the review.`,
        };
    }
    //#endregion mpd-delta repair-seat-required
    //#region mpd-delta repair-scope (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
    // The generated scope never lists a path in both lists: a finding's file is
    // carved out of outOfScope by repairScopeFromFindings instead of being added
    // to inScope beside it (the t13 defect this delta closes).
    const repairScope = files.length > 0
        ? repairScopeFromFindings(findings, source)
        : { ...(source?.inScope === undefined ? {} : { inScope: source.inScope }), ...(source?.outOfScope === undefined ? {} : { outOfScope: source.outOfScope }) };
    //#endregion mpd-delta repair-scope
    const repair = {
        id: `repair-round-${nextRound}`,
        kind: 'repair',
        subject: `repair-round-${nextRound}`,
        assignee: implementer,
        dependencies: [sourceId],
        round: nextRound,
        objective: source?.objective ?? closed.objective ?? `Fix findings from ${sourceId}`,
        //#region mpd-delta repair-scope-fields (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
        ...repairScope,
        //#endregion mpd-delta repair-scope-fields
        verify: source?.verify,
        acceptance: findings.map((finding) => finding.requiredFix),
        sourceTaskId: sourceId,
        sourceFindingIds: findingIds,
        reasonTaskId: closed.id,
    };
    const reviewer = schedulableAssignee(closed.assignee !== implementer ? closed.assignee : undefined, team, implementer);
    const review = {
        id: `review-round-${nextRound}`,
        kind: 'review',
        subject: `review-round-${nextRound}`,
        assignee: reviewer,
        dependencies: [repair.id ?? `repair-round-${nextRound}`],
        round: nextRound,
        objective: sanitizeReviewObjective(closed.objective, DEFAULT_REVIEW_OBJECTIVE),
        acceptance: sanitizeReviewAcceptance(closed.acceptance),
        reviewedTaskId: repair.id,
        reasonTaskId: closed.id,
    };
    return { created: [repair, review], tasks: [repair, review] };
}
export function buildCoverageMatrix(goalItems, tasks) {
    return goalItems.map((goalItem) => {
        const covering = tasks.filter((item) => item.coverageOf?.includes(goalItem));
        const taskIds = covering.map((item) => item.id);
        if (covering.length === 0)
            return { goal_item: goalItem, task_ids: taskIds, status: 'missing' };
        if (covering.some((item) => item.status === 'failed' || item.status === 'cancelled')) {
            return { goal_item: goalItem, task_ids: taskIds, status: 'blocked' };
        }
        if (covering.every((item) => item.status === 'completed')) {
            return { goal_item: goalItem, task_ids: taskIds, status: 'passed' };
        }
        return { goal_item: goalItem, task_ids: taskIds, status: 'in_progress' };
    });
}
export function canDeclareDelivery(team) {
    const blockers = [];
    const quality = team.tasks.filter((item) => isQualityKind(taskKindOf(item)));
    const implementations = quality.filter((item) => taskKindOf(item) === 'implementation' || taskKindOf(item) === 'repair');
    const reviews = quality.filter((item) => taskKindOf(item) === 'review');
    for (const item of quality) {
        const kind = taskKindOf(item);
        if (item.status === 'completed') {
            if ((kind === 'review' || kind === 'requirements') && item.verdict !== 'pass') {
                blockers.push(`${item.id} completed without verdict=pass`);
            }
            continue;
        }
        if (item.status === 'failed') {
            const repaired = kind === 'review'
                ? quality.some((candidate) => (taskKindOf(candidate) === 'repair'
                    && candidate.sourceTaskId === (item.reviewedTaskId ?? item.sourceTaskId)
                    && (candidate.status === 'pending' || candidate.status === 'claimed' || candidate.status === 'in_progress' || candidate.status === 'completed')))
                : kind === 'requirements'
                    ? quality.some((candidate) => (taskKindOf(candidate) === 'requirements'
                        && (candidate.round ?? 1) > (item.round ?? 1)))
                    : quality.some((candidate) => (taskKindOf(candidate) === 'repair' && candidate.sourceTaskId === item.id));
            if (!repaired)
                blockers.push(`${item.id} failed without a follow-up repair`);
            continue;
        }
        if (item.status === 'cancelled')
            continue;
        blockers.push(`${item.id} (${kind}) is not completed`);
    }
    if (implementations.some((item) => item.status === 'completed') && !reviews.some((item) => item.status === 'completed' && item.verdict === 'pass')) {
        if (!blockers.some((item) => item.includes('review'))) {
            blockers.push('completed implementation has no passing review');
        }
    }
    for (const item of implementations) {
        for (const path of item.changedPaths ?? []) {
            if (classifyChangedPath(path, item.inScope ?? [], item.outOfScope ?? []) !== 'in_scope') {
                blockers.push(`${item.id} has unaudited path ${path}`);
            }
        }
    }
    return { ok: blockers.length === 0, blockers };
}
export function resumeTeamState(team, reason) {
    if (!nonemptyString(reason)) {
        return { ok: false, status: 'rejected', error: 'resume requires a non-empty reason' };
    }
    if (team.halted !== true) {
        return { ok: true, status: 'already_running', team };
    }
    return {
        ok: true,
        status: 'resumed',
        team: {
            ...team,
            halted: false,
            haltedAt: undefined,
        },
    };
}
export function isReviewFinding(value) {
    if (!isRecord(value))
        return false;
    return nonemptyString(value['id'])
        && FINDING_SEVERITIES.includes(value['severity'])
        && nonemptyString(value['problem'])
        && nonemptyString(value['requiredFix'])
        && (value['file'] === undefined || nonemptyString(value['file']))
        && (value['line'] === undefined || (Number.isSafeInteger(value['line']) && value['line'] >= 0))
        && (value['resolved'] === undefined || typeof value['resolved'] === 'boolean');
}
export function isAcceptanceResult(value) {
    if (!isRecord(value))
        return false;
    return nonemptyString(value['criterion'])
        && (value['status'] === 'passed' || value['status'] === 'failed')
        && (value['evidence'] === undefined || typeof value['evidence'] === 'string');
}
//#region mpd-delta reported-red-status (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)
// T-84 (wave 2b, lane A): `reported` is the third command status — a red the contract requires to
// be REPORTED. It must be LABELLED (`reason`), so the record carries why the red is acceptable;
// an unlabelled `reported` entry is refused, and `failed` keeps its meaning.
export const COMMAND_RESULT_STATUSES = ['passed', 'failed', 'reported'];
export function isCommandResult(value) {
    if (!isRecord(value))
        return false;
    return nonemptyString(value['command'])
        && COMMAND_RESULT_STATUSES.includes(value['status'])
        && (value['status'] !== 'reported' || nonemptyString(value['reason']))
        && (value['exitCode'] === undefined || (Number.isSafeInteger(value['exitCode'])))
        && (value['evidence'] === undefined || typeof value['evidence'] === 'string');
}
//#endregion mpd-delta reported-red-status
// Optional fields whose persisted values must be non-empty when present
// (mirrors the checks in hasValidQualityTaskFields). Some models materialize
// optional tool parameters as "" instead of omitting them (e.g. sending
// reviewedTaskId:"" or profile:""), which would otherwise be written to
// team.json and then brick the whole team state on reload.
const BLANK_SENSITIVE_STRING_FIELDS = ['objective', 'reviewedTaskId', 'sourceTaskId'];
const BLANK_SENSITIVE_STRING_LIST_FIELDS = ['inScope', 'outOfScope', 'acceptance', 'verify', 'deliverables', 'nonGoals', 'changedPaths', 'sourceFindingIds', 'coverageOf'];
/**
 * Normalize blank optional task fields to omitted ("blank means absent").
 * Blank string scalars are deleted; string lists have blank entries filtered
 * out, and a list that only contained blanks is omitted entirely. Non-blank
 * values and every other field are passed through untouched, so durable-state
 * validation stays strict.
 */
export function normalizeBlankOptionalTaskFields(task) {
    const next = { ...task };
    for (const key of BLANK_SENSITIVE_STRING_FIELDS) {
        const value = next[key];
        if (typeof value === 'string' && value.trim() === '')
            delete next[key];
    }
    for (const key of BLANK_SENSITIVE_STRING_LIST_FIELDS) {
        const value = next[key];
        if (!Array.isArray(value))
            continue;
        const kept = value.filter((item) => !(typeof item === 'string' && item.trim() === ''));
        if (kept.length === value.length)
            continue;
        if (kept.length === 0)
            delete next[key];
        else
            next[key] = kept;
    }
    return next;
}
export function hasValidQualityTaskFields(value) {
    if (value['kind'] !== undefined && !TASK_KINDS.includes(value['kind']))
        return false;
    if (value['verdict'] !== undefined && !REVIEW_VERDICTS.includes(value['verdict']))
        return false;
    if (value['round'] !== undefined && !(Number.isSafeInteger(value['round']) && value['round'] >= 1))
        return false;
    if (value['objective'] !== undefined && !nonemptyString(value['objective']))
        return false;
    if (value['reviewedTaskId'] !== undefined && !nonemptyString(value['reviewedTaskId']))
        return false;
    if (value['sourceTaskId'] !== undefined && !nonemptyString(value['sourceTaskId']))
        return false;
    if (value['reasonTaskId'] !== undefined && !nonemptyString(value['reasonTaskId']))
        return false;
    if (value['reassignReason'] !== undefined && !nonemptyString(value['reassignReason']))
        return false;
    if (value['reviewedAttempt'] !== undefined && !(Number.isSafeInteger(value['reviewedAttempt']) && value['reviewedAttempt'] >= 0)) {
        return false;
    }
    const stringLists = ['inScope', 'outOfScope', 'acceptance', 'verify', 'deliverables', 'nonGoals', 'changedPaths', 'sourceFindingIds', 'coverageOf'];
    for (const key of stringLists) {
        if (value[key] === undefined)
            continue;
        if (!Array.isArray(value[key]) || !value[key].every(nonemptyString))
            return false;
    }
    if (value['findings'] !== undefined) {
        if (!Array.isArray(value['findings']) || !value['findings'].every(isReviewFinding))
            return false;
        const ids = value['findings'].map((finding) => finding.id);
        if (new Set(ids).size !== ids.length)
            return false;
    }
    if (value['acceptanceResults'] !== undefined) {
        if (!Array.isArray(value['acceptanceResults']) || !value['acceptanceResults'].every(isAcceptanceResult))
            return false;
    }
    if (value['commandsRun'] !== undefined) {
        if (!Array.isArray(value['commandsRun']) || !value['commandsRun'].every(isCommandResult))
            return false;
    }
    return true;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isTaskKind(value) {
    return typeof value === 'string' && TASK_KINDS.includes(value);
}
export function isReviewVerdict(value) {
    return typeof value === 'string' && REVIEW_VERDICTS.includes(value);
}
export function isFindingSeverity(value) {
    return typeof value === 'string' && FINDING_SEVERITIES.includes(value);
}
export function looksLikeGateTestContract(value) {
    return typeof value === 'string' && GATE_TEST_CONTRACT.test(value);
}
export function sanitizeReviewObjective(value, fallback = DEFAULT_REVIEW_OBJECTIVE) {
    if (!nonemptyString(value) || looksLikeGateTestContract(value))
        return fallback;
    return value.trim();
}
export function sanitizeReviewAcceptance(values) {
    const cleaned = (values ?? []).map((item) => item.trim()).filter((item) => item !== '' && !looksLikeGateTestContract(item));
    return cleaned.length > 0 ? cleaned : [...DEFAULT_REVIEW_ACCEPTANCE];
}
export function defaultQualityDeliveryGraph(input) {
    const goal = input.goal.trim() || 'the stated user goal';
    const analyst = input.analyst;
    const implementer = input.implementer;
    const tester = input.tester ?? input.implementer;
    const reviewer = input.reviewer;
    const integrator = input.integrator ?? input.reviewer;
    return [
        {
            subject: 'requirements-round-1',
            kind: 'requirements',
            assignee: analyst,
            dependencies: [],
            objective: `Converge requirements for: ${goal}`,
            acceptance: ['Open questions are closed or explicitly deferred', 'Acceptance criteria are testable'],
            coverageOf: [goal],
        },
        {
            subject: 'implementation',
            kind: 'implementation',
            assignee: implementer,
            dependencies: ['requirements-round-1'],
            objective: `Implement the approved requirements for: ${goal}`,
            acceptance: ['The implementation matches the approved requirements'],
            inScope: ['src/'],
            verify: ['pnpm test'],
            coverageOf: [goal],
        },
        {
            subject: 'verification',
            kind: 'verification',
            assignee: tester,
            dependencies: ['implementation'],
            objective: `Verify the implementation of: ${goal}`,
            acceptance: ['Declared verification commands pass'],
            coverageOf: [goal],
        },
        {
            subject: 'review-round-1',
            kind: 'review',
            assignee: reviewer,
            dependencies: ['verification'],
            objective: DEFAULT_REVIEW_OBJECTIVE,
            acceptance: [...DEFAULT_REVIEW_ACCEPTANCE],
            coverageOf: [goal],
        },
        {
            subject: 'integration',
            kind: 'integration',
            assignee: integrator,
            dependencies: ['review-round-1'],
            objective: `Confirm the team can declare delivery for: ${goal}`,
            acceptance: ['All required quality tasks are completed with passing reviews'],
            coverageOf: [goal],
        },
    ];
}
export function qualityPlanningPrompt() {
    return [
        'When the user explicitly requests full quality-mode planning, use this order unless a constraint forbids a stage: requirements → implementation → verification → review → integration.',
        'Build that entire DAG while the team is staged: an implementation may be created before requirements finishes when its dependency chain includes that requirements task. This is supported; do not wait for requirements to run and do not inspect plugin source to confirm it.',
        'A staged integration task may depend on review round 1. If that review later returns needs_revision, the system automatically rewires still-pending downstream dependencies to the generated repair + next-review gate, so keep integration in the original plan instead of omitting or manually recreating it.',
        'Derive inScope and verification commands from the actual workspace or explicit profile; never assume src/ or pnpm test.',
        'Give every quality task a contract. Review acceptance must judge the latest implementation, not whether the gate rejects needs_revision.',
        'Do not write smoke-test scripts into tasks. Do not ask reviewers to submit needs_revision on purpose.',
        'Do not claim implementation or review yourself unless the user asked the captain to take over.',
        'After a failed review, wait for the automatic repair + next review. Do not recreate that loop by hand.',
        'halted means the human stopped the team; call agent_teams_resume before creating more work. escalated means the automatic review loop hit its ceiling; that is not halt.',
    ].join(' ');
}
export function describeQualityLoop(team) {
    const delivery = canDeclareDelivery(team);
    if (team.halted === true) {
        return {
            state: 'halted',
            halted: true,
            escalated: team.escalated === true,
            deliverable: false,
            summary: 'Team is halted. Call agent_teams_resume with a reason before creating more work.',
        };
    }
    if (delivery.ok) {
        return {
            state: 'deliverable',
            halted: false,
            escalated: team.escalated === true,
            deliverable: true,
            summary: 'All required quality gates passed. The captain may report delivery.',
        };
    }
    if (team.escalated === true) {
        return {
            state: 'escalated',
            halted: false,
            escalated: true,
            deliverable: false,
            summary: 'Automatic review/repair loop hit its ceiling. The team is still running; do not treat this as halt. Escalate to the user instead of inventing another needs_revision cycle.',
        };
    }
    const open = team.tasks.some((item) => OPEN_STATUSES.includes(item.status));
    return {
        state: open ? 'running' : 'blocked',
        halted: false,
        escalated: false,
        deliverable: false,
        summary: open
            ? 'Work remains on the shared task list; wait for the scheduler or complete owned tasks.'
            : `Delivery is blocked: ${delivery.blockers.join('; ') || 'unresolved quality gates'}.`,
    };
}
export { QUALITY_KINDS, WRITE_KINDS };
