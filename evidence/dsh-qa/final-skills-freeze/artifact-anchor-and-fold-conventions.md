# The packed-artifact anchor and its fold conventions (lane C's reading, 2026-09-17)

**ADDITIVE RECORD** written after my lane closed (`t63`/`t65` complete, `skills/**` FINAL). It exists so
the report can cite a FILE for the three-value fold table instead of a message thread: the numbers below
were measured by me in this session, and the mechanisms were cross-checked against packaging-engineer's
and platform-engineer's independent reproductions.

## The published fold (the one to cite)

```bash
# from the repo root; LC_ALL=C is MANDATORY — the same bytes under a locale give a different digest
R=dist/mpd-package
( cd "$R" && find . -type f -print0 | LC_ALL=C sort -z \
  | while IFS= read -r -d '' f; do printf '%s\0%s\n' "${f#./}" "$(sha256sum "$f" | cut -d' ' -f1)"; done ) | sha256sum
# -> 4131137d51d65b4255a6251c0f5af6294c1b447c2b8114156fe808e21cb5fb0f   (1190 files, post-04:37:59Z re-pack)
```

Equivalent JS form (immune to locale, because `Array.prototype.sort()` is code-unit):

```js
const h = crypto.createHash("sha256")
for (const rel of rels.sort()) {                       // rels = 1190 relpaths under dist/mpd-package
  h.update(rel); h.update("\0")
  h.update(crypto.createHash("sha256").update(readFileSync(join(root, rel))).digest("hex"))
  h.update("\n")                                       // per-record LF, INCLUDING the last
}
h.digest("hex")   // 4131137d51d65b4255a6251c0f5af6294c1b447c2b8114156fe808e21cb5fb0f
```

## The three values: one file set, one path-list key, three ordering implementations

| ordering of the same 1190 paths | fold | who measured it |
|---|---|---|
| byte order / `LC_ALL=C sort` / JS code-unit | `4131137d51d65b4255a6251c0f5af6294c1b447c2b8114156fe808e21cb5fb0f` | lane C (both forms), reproduced by both peers |
| glibc `strcoll` under `LC_ALL=en_US.UTF-8` | `d30f7d19831d2fd6a3835c207ef508529ca574b4d9577bdc539b6970e0f13318` | packaging-engineer; reproduced by me from the path list alone |
| ICU `localeCompare("en-US")` | `98469d053e504149f190e05ee7d0067b74409eeb7b0f2f6a9ea9c4927c2949bf` | lane C; reproduced by packaging-engineer |

Divergence indices between the orders: **ICU vs glibc at index 25** (`docs/plan-team-watchdog-report.md`
vs `docs/plan-team-watchdog.md`), **ICU vs byte and glibc vs byte both at index 0**
(`agent-references/agent-teams-deltas.md` vs `EXTENSIONS-FOR-AGENTS.md`).

## The encoding (terminator) axis, exercised separately by platform-engineer

Same order, same encoding shape, one terminator byte changed:
`570177010ac1f15983654edebd4e2dde7b4b26237be3707c051f542b909624b7` = **no trailing LF**,
`0e8d236c8c57e89e13bb288b8ed2f6fbf8889348a8b019c60beed36597657756` = **NUL-joined**. Both reproduced by me.

## The rule, with the experimental design stated honestly

*fold = file set + record encoding (field order and trailing terminator included) + ordering
implementation over the chosen sort key + digest.*

**Constants and variables in this thread's witnesses, so the rule is not over-read:** the file set, the
record encoding (path first, `\0`, digest, LF) and the **sort key (the path list — no shell form here
sorts records; the digest is attached after the `sort`) were CONSTANT**. Three axes were actually
varied: the **ordering implementation** (byte/C vs glibc `strcoll` vs ICU), the **terminator**
(trailing LF vs none vs NUL-join), and the **record field order** (`sha256sum`-style digest-first lines →
`ea80a4130266497e141ffd0e9676b7bada6010f84026c3bf051e1372f5e57742`, neither of the above). A rule
element that was never varied is not evidence — it is generality.

**One retracted candidate, recorded so it cannot be revived:** I proposed a fifth element — the shell's
NUL/`-z` handling — inferred from the values rather than measured. It is refuted by the table above: the
glibc value falls out of a **newline-delimited, paths-only** ordering, so `-z` changes only the
*delimiter*, and no NUL-dependent byte ever reaches the outer digest. The element belongs to how a path
list is delimited, not to what is folded, and it is withdrawn here rather than kept as a caution. The
same discipline applied in the other direction: the encoding seat's lines *"sort key: records, not the
bare path list"* and *"the missing element was the sort key on top of the collation"* were refuted by
that measurement and replaced in `evidence/platform/pack-drift/20260917T031548Z/result.json →
cross_seat_anchor_tie_post_repack → model_correction_sort_key`.

## Above all of it: the convention-free statement

**canonical vs ordered re-pack: 1,190 == 1,190 files, per-file `sha256sum` diff EMPTY.** It needs no
fold, no locale and no definition, and it is the claim the determinism conclusion actually rests on.

Cross-tie recorded by platform-engineer at
`evidence/platform/pack-drift/20260917T031548Z/result.json → cross_seat_anchor_tie_post_repack`
(both anchors at full 64 hex; my `4131137d…` verified by them in a fresh process).
