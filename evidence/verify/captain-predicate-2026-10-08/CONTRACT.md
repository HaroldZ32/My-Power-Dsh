# Contract — fix the captain test that silently denies the top-level session its git writes

FROZEN 2026-10-08 by the captain, on the USER's direct instruction: 「改规则，这什么狗屁规则，我没记得我定过这个」.
Agent-facing, English-only. A change to a clause is a CAPTAIN act.

## The defect, measured

1. `packages/mpd-roles-plugin/src/complexity-gate.ts`'s `sessionQualifies(agent, presets)` decides
   "is this the workspace's captain" as: header exists AND `header.parentSession === undefined` AND
   (`header.agentPreset === undefined` OR `presets.includes(header.agentPreset)`).
2. The row installs `presets: ["mpd"]` (`packages/mpd-roles-plugin/src/index.ts`, three call sites),
   and `DEFAULT_GATE_PRESETS = ["mpd"]`.
3. **Every TOP-LEVEL session on this machine records `agentPreset: "cordis"`.** Measured by decoding
   the first frame of every stored session log under `~/.dsh/sessions/**`: `cordis`/depth 0 = **17**,
   `mpd`/depth 1 = 11 (the team members this wave spawned), `cordis`/depth 1 = 5, `standard`/depth 0 = 3.
   No top-level `mpd` session has ever existed here, and the only `mpd` sessions are children.
4. Consequence: the captain branch of §5's ONE-GIT-WRITER rule is UNREACHABLE in this deployment —
   `git branch` / `git commit` / `git add` are refused for the user's own top-level session with a
   sentence that claims a fact it never tested ("this session is NOT the workspace's top-level captain").
   Measured on this session: `git checkout -b …` and `git commit --dry-run` both refused; the session's
   own decoded header is `{"delegationDepth":0,"agentPreset":"cordis"}` — top-level, but not `mpd`.
5. **The preset test is not in the manual.** `AGENTS.md` §5 states only the captain-vs-teammates rule
   ("ONE git writer per working tree — binding. Teammates share the captain's checkout …") and never
   mentions a preset; the same holds for the dependency-free statement of rule 4. The preset
   narrowing is an UNDOCUMENTED, stricter implementation — that is the defect, not the rule's intent.

## Frozen clauses

**F1 — A dedicated test for "the workspace's top-level session", separate from preset coverage.**
Add an exported predicate (e.g. `sessionIsTopLevel(agent)`; exact name is the writer's) that is true iff
a session header exists, `header.parentSession === undefined`, and `header.delegationDepth` is `0` or
absent. It must NOT consult `agentPreset`.

**F2 — The two rules that exist to protect the checkout use it.**
`verify-guard.ts` uses the new predicate for BOTH: §5's git rule (`gitWriterDecision({ topLevelCaptain })`)
and the captain WRITE rule (rule 4, `captainWriteDecision`). The row's `presets: ["mpd"]` option is no
longer what gates either; if a caller still wants a preset scope it must be an explicit, named choice.

**F3 — The session-start complexity gate and the roster section keep their existing preset semantics.**
They are deliberately NOT in this wave: whether the gate should also fire for a `cordis`-preset
top-level session is a SEPARATE question the captain will put to the user. `sessionQualifies` therefore
stays exported and unchanged in behaviour for those two callers, and its doc comment must say plainly
what it tests and what it does NOT (it does not answer "is this the captain").

**F4 — The denial sentence must not assert an untested fact.**
The git denial and the captain-write denial must say what was actually decided (e.g. "this session is a
member/child session of this workspace (its session header carries a parent session)") and must name the
one command that gets a legitimate writer (the user's own shell), never a claim about a fact the code
never checked.

**F5 — Falsifiers (each one an arm, not prose).**
- a TOP-LEVEL agent double with `agentPreset: "cordis"` (and depth 0, no parent) → git writes ALLOWED,
  captain-write rule applies as before;
- a top-level agent double with `agentPreset: "mpd"` → allowed (no regression for that deployment);
- a CHILD agent double (`parentSession` set, or `delegationDepth: 1`) with `agentPreset: "mpd"` →
  STILL DENIED, and a child with `agentPreset: "cordis"` → still denied (the rule's whole point survives);
- a session with NO header → denied (fail-closed);
- the denial sentence contains no claim about top-levelness.

**F6 — Documentation.** `AGENTS.md` §5 gains one sentence naming the classification the code actually
implements (the captain is the workspace's top-level session: no parent session, depth 0), and the
`complexity-gate.ts` / `verify-guard.ts` comments state the same. The manual edit is the CAPTAIN's; the
code comments are the writer's.

## Non-goals / declared bounds

- No change to the session-start gate's firing rule, to the roster section, or to any other consumer of
  `sessionQualifies` (F3).
- No change to what the guard denies a MEMBER session — rule 4's meaning is untouched.
- This wave cannot take effect in the RUNNING host process (T-21: no plugin hot reload): the fix is
  observable only after `dsh` restarts, and until then the captain's own git writes stay refused —
  the handover script `evidence/tui/dsh-tui-014/land-pr.sh` remains the path for the current tree.
