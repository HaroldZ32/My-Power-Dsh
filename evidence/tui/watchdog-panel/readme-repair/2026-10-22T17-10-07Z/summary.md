# T14 — README nit repair (T6 verdict finding)

Scope: `packages/mpd-tui-plugin/README.md` + `README.zh-CN.md` only. No src, no dist, no git write.

The `/mpd-model` dialog paragraph (the “Model menu (R3)” row) now names the typed degrade in BOTH halves:

* an unconfigured slot renders `<unconfigured>` **with its missing leaves**, from the config service's
  typed `slotResolutionOf` answer (contract AMENDMENT 1);
* a malformed leaf renders `<invalid>`;
* a composition with no config service renders `<unavailable>`;
* the dialog **never wraps that read in a try/catch** — a degrade is a state the service reports, not an
  exception swallowed on the display path.

Gate: `bun run verify:docs` → exit **0** (`verify-docs.log` / `verify-docs.exit`).
File mtimes and sizes: `readme-mtimes.txt`. Exact diff: `readme.diff`.

Note on `readme.diff`: it is `git diff` for the two files, so it also contains this lane's earlier
uncommitted README changes from T4. The T14 hunk itself is isolated in `changed-clauses.txt`.
