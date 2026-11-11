# CodeRabbit round 3 — findings #1–#3 verified against HEAD 52bb524c

All line numbers below are from `HEAD` (`52bb524c`), i.e. BEFORE this round's edits; the
current-file numbers are quoted where they moved.

## #1 — README §rebind says the handle "must be named by the CURRENT record" and contradicts the journal fallback — **STALE**

`packages/mpd-cellwork-plugin/README.md:425-429` (the OR sentence starts on line 427):

> **`rebind` validates its handle and records its own claims (M1/N1/F1):** the handle is trimmed, must be
> the host-minted 8-4-4-4-12 UUID form, and must be
> named by the seat's CURRENT record — its TEAM row or its CELL row — **OR, when NEITHER current row names a
> handle, by the journal's LATEST hand-over row.** **The current record wins; the journal only
> corroborates:** that latest hand-over decides only in the record-silent case, and it can never veto a
> handle either row names.

`packages/mpd-cellwork-plugin/README.zh-CN.md:336-337`:

> 8-4-4-4-12 UUID 形态，且必须被本座位**当前的记录**点名——TEAM 行或 CELL 行；**当两条当前行都没有点名任何 handle
> 时，journal 的最新一条交接行同样可以作证**。

The OR-fallback is present in BOTH READMEs; the "must be named by the current record" sentence is
qualified by it. `docs/cellwork.md:672-673` and `docs/cellwork.zh-CN.md:527-529` carry the same rule.
**Conclusion: STALE — the README was already correct; only the docs had been fixed in the previous round.**
(The same README paragraph WAS edited this round for finding #5's new orphan-child exception — that is a
new evidence path, not a repair of the alleged contradiction.)

## #2 — README treats `previousSessionId`/`previousSessionIdLiveness` as present on every outcome — **STALE**

`packages/mpd-cellwork-plugin/README.md:435-438`:

> Every outcome reports `namedBy` (`team`/`cell`/`journal:<event>`);
> `previousSessionId`/`previousSessionIdLiveness` (`live`/`unproven`/`unknown`) is reported **WHEN THE TEAM ROW
> IS READABLE** and is **OMITTED when the TEAM record is missing or unreadable** (there is no displaced handle to
> report).

`packages/mpd-cellwork-plugin/README.zh-CN.md:344-345`:

> `previousSessionId`/`previousSessionIdLiveness`（`live`/`unproven`/`unknown`）**只在 TEAM 行可读时**报告，
> TEAM 记录缺失或不可读时会**省略**（没有可报告的被替换 handle）。

**Conclusion: STALE — already qualified; no change needed.**

## #3 — `keepChild` still releases the child when a concurrent `cancelTasks` may write back a stale roster — **STALE**

`packages/mpd-cellwork-plugin/src/protocol-core.ts:1307`:

```ts
const keepChild = bind.rollback === "failed" || bind.rollback === "refused"
```

`packages/mpd-cellwork-plugin/src/protocol-core.ts:1316`:

```ts
const released = keepChild ? false : await releaseActivation(activation)
```

Both `refused` and `failed` rollbacks keep the child; only a `restored` rollback releases it.
**Conclusion: STALE — already implemented in round 2.**
