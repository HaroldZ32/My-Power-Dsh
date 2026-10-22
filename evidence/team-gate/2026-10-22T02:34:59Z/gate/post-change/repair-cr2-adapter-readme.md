# Repair — CR round-2 follow-up: qualify the adapter README dispose claim (T17)

Task **T17** (repair, owner Senior Engineer), 2026-10-22. **README pair only**; no source, no dist.

## Finding

`packages/mpd-dsh-adapter-plugin/README.md` stated that `spawnAgent` disposes the exact activation
once the report settles — unconditionally. The adapter's RETIRED `start` fallback returns only
`run.result`: there is no activation handle, and nothing is disposed. Same claim in the zh twin.

## Fix

`packages/mpd-dsh-adapter-plugin/README.md` (consult paragraph):

> is ONE-SHOT: on a host exposing `startActivation` the adapter disposes that exact activation once
> the report settles (best-effort; a failing teardown never changes the report), so the live child is
> released instead of accumulated; the retired `start` fallback returns only `run.result` and has no
> activation to dispose.

`packages/mpd-dsh-adapter-plugin/README.zh-CN.md` (same paragraph, 简体中文):

> 该咨询是**一次性（one-shot）**的：在暴露 `startActivation` 的宿主上，报告落定后 `spawnAgent`
> 会释放（dispose）**这次**激活（尽力而为；清理失败绝不改写报告），因此活着的子会话被释放而不是
> 被不断堆积；旧版 `start` 回退路径只返回 `run.result`，没有可供释放的 activation。

Both files changed though T17's declared `writeScopes` names only `README.md`: the bilingual policy
(AGENTS.md §Language policy) requires a human-facing doc change to update BOTH files in the same
commit, and the zh twin carried the identical unqualified claim. The honest bound paragraph and the
durable-continuity wording are unchanged.

## Interface doc — checked, deliberately NOT changed

`DshAdapter.spawnAgent` in `packages/mpd-dsh-adapter-plugin/src/index.ts` says "the moment
`activation.result` settles, the adapter disposes that exact activation (best-effort, once)". That
sentence is scoped to the activation HANDLE (the `startActivation` generation): it asserts disposal
of `activation`, so it makes no claim about the retired arm, where no `activation` exists. The
generation-independent instruction (one-shot; a new question means a new consult) is already stated
there. Aligning it further would be a `src` edit — expressly outside "README only / no dist", and it
would stale the adapter dist fan-out. Left as is; no false statement remains.

## Gates (observed, quoted)

- `bun run verify:docs` → **exit 0**:
  `[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=49 failed=0 violations=0 exempt=24 derived=3 links=440 dead=0 — PASS`
- `bun run verify:comments` → **exit 0**:
  `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.`
- `git status --short -- packages/mpd-dsh-adapter-plugin` → **exactly the two README files modified**
  (`README.md`, `README.zh-CN.md`). No `src`, no `dist`.

## Dist note

No build run and no `dist/**` write (T-88: derived surfaces belong to Integration). The wave's only
remaining stale target is `packages/mpd-workmate-plugin/dist/index.js` from T16's description edit;
the adapter packages were not touched by T17.

## Not touched

No `packages/*/src/**`, no `dist/**`, no `packages/mpd-roles-plugin/**`, no `skills/**`, no git write
command.
