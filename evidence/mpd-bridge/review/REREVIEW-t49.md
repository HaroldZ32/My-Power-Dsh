# t49 — re-review on settled bytes: the two HIGH findings resolved

Judged revision (hashed at judgement time):

| file | sha256 (prefix) |
|---|---|
| `packages/mpd-config-plugin/src/index.ts` | `e89179338d47c5fb…` |
| `packages/mpd-tui-plugin/src/settings.ts` | `70e1d4752b261c56…` |
| `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` | `4474be1e00523d06…` |

## B1 (file-derived base) — FIXED, confirmed by a second, independent observation

Two witnesses in different sandboxes agree:

1. **Mine** (`evidence/mpd-bridge/review/`): the web plane's own `settings/mutate` response carried
   `base.hashline.maxDiffChars = 35000` — the workspace file's value, not the 20000 schema default —
   and lane check **W13** passes on a settled tree, plus `baseForNamespace()`
   (`packages/mpd-config-plugin/src/index.ts:511`) implements the cardinality rule
   (1 root → that file; 0 → mount-time root; N → `reason: "ambiguous-multi-root"`, no base invented).
2. **t42's** (`evidence/mpd-bridge/consumer-activation/20260915T092639Z/`): `fileValue 30`,
   `writtenValue 31415`, descriptor `base: 30` with `value: 31415` / `user: 31415`; the CONSUMER
   (`mpd-hashline-plugin`, which captures the knob at `apply()`) truncated its diff to 30 before the
   write, **still 30 in the same process after the write** while the config layer already read 31415,
   and **1032 after a genuine restart**; a fresh EMPTY DSH_HOME resolved 1032 from
   `<workspace>/.mpd/mpd.jsonc` alone.

**What the base does and does not do is stated correctly and with nothing stronger.** The shipped
on-screen hint (built bytes, `packages/mpd-tui-plugin/src/settings.ts` `BRIDGE_DISCLOSURE`):
"a save writes `<workspace>/.mpd/mpd.jsonc` for the live session workspace(s) **and takes effect for the
mpd plugins after a restart** (this knob is read at plugin mount)". The source records the mechanism
("the base is fixed for the process lifetime — the host exposes no disposal handle for a live
registration"). The other "immediately" statements I found are about a DIFFERENT axis and are TRUE per
t42's measurement: the config layer / `mpd_config_get` observe a settings edit immediately, while a
running consumer needs the restart. No shipped sentence claims the namespace base is refreshed live.

## B2 (disagreeing surfaces) — RESOLVED: a stale-field read in the LANE, not a product divergence

**Authoritative surface (measured):** the host's settings RPC envelope is
`{type, rpcId, result: { ok, value: <namespace descriptor> }}`, and the descriptor carries
`value` / `base` / `user` / `revision`. The knob therefore lives at
`response.result.value.<knobPath>`; the L3 user section at `response.result.value.user`.

**The line that had to change** — `mutateOutcome()` in
`skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`:

```js
const envelope = response?.result
const descriptor = envelope?.value ?? envelope ?? null     // ← the unwrap the old form lacked
const resolved = KNOB.reduce(…, descriptor?.value)
const base     = KNOB.reduce(…, descriptor?.base)
const user     = KNOB.reduce(…, descriptor?.user)
```

Reading the envelope directly (no `envelope?.value` unwrap) makes `descriptor` the envelope
`{ok, value:<descriptor>}`; then `descriptor.value.<…>` walks into the DESCRIPTOR rather than the knob
container and yields **`undefined`**, and `descriptor.user` is `undefined` because the envelope has no
`user`. That reproduces BOTH failing detail strings from my t36 runs **exactly** —
`(descriptor value = undefined)` and `(undefined)` — while the raw payload logged in those same runs
carried `value.hashline.maxDiffChars = 31415` and `user.hashline.maxDiffChars = 31415`. The product was
never divergent; the lane observed one level too shallow.

Honest residual: the old lib was untracked and overwritten at 16:41 (a repo-wide grep finds only the
current file), so the OLD line cannot be quoted — I name the current line and reproduce the failure by
arithmetic instead. Confirmed fixed at the settled revision: the write-path arm passes
**W1–W13** with the tree frozen across the run.

## Open item (medium) — the Chinese README's seam table still carries the killed claim

`packages/mpd-tui-plugin/README.md:23` is repaired (0 occurrences of "not bridged" / "does not
rewrite"), and both languages now describe the bridge and the restart. But
`packages/mpd-tui-plugin/README.zh-CN.md:22` still reads:

> 「| 设置区块 | `ctx.tuiSettingsSections` | 把 mpd.jsonc 的可调项声明为 `/settings` 中可编辑的字段 —— **未与文件打通**；每个字段的提示在界面上直接写明（见"明确不声明"第 2 条） |」

i.e. "**not bridged to the file**" — the pre-t35 claim, in the same table whose English row now says the
opposite, with a cross-reference to a section that has since been rewritten. Owner: t50 (the
integration/docs task). File+line given above.

## Limits stated rather than worked around

- **No model credentials in this environment**, so a MODEL-DRIVEN tool call inside a booted host cannot
  be witnessed here at all (the same limit t42 states). My B1/B2 resolution does not need one: it rests
  on the host's own authenticated RPC, the lane's raw output, and t42's real tool behaviour.
- The two low findings from t38 are unchanged and not this task's: D1 (separate DSH homes do not share
  the settings document) and D2 (the skills corpus `treeSha` moved again; the single re-pin is owed).

## Verdict

**PASS** — zero blocker/high findings at the judged revision. B1 is fixed and independently
corroborated; B2 is a lane-side stale-field read with the reproducing arithmetic and the authoritative
surface named; the shipped copy claims exactly the restart semantics and nothing stronger. The one open
medium is the zh-CN seam-table row above, owned by t50.
