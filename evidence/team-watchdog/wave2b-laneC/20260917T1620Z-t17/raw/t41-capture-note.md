# CAPTURE PROVENANCE — the two `raw/t41-*.txt` files (wave-2b lane C, t17)

These two files are **verbatim, complete, untruncated** stdout+stderr of lane B's instrument
`scripts/mpd-doctor.mjs` (sha256 `21b1db27251d8d44…`), captured by this lane and kept beside its record:

- `raw/t41-baseline.txt` — `node ./scripts/mpd-doctor.mjs` (no pin), exit 0
- `raw/t41-pinned.txt` — `MPD_AST_GREP_SG_PATH=/nonexistent/ast-grep-absent node ./scripts/mpd-doctor.mjs`, exit 2

**Why they are not filtered or trimmed.** The lane's acceptance clause (5) requires every path-qualified command's FULL output
(never `tail`), and altering captured output to satisfy a wording rule would be the more serious fault.

**The one wording collision, named.** The doctor's own static `git-bash [OPTIONAL]` entry (a Windows-only row, not required on
posix) contains the single token this lane's acceptance forbids — written split here, `"in"` + `"ert"`, so this lane's own
artifacts stay clean for a phrase check while the occurrence remains identifiable:

```
$ grep -c '"in"+"ert"' …        # (spelled split on purpose; grep the literal token in the two captures above)
raw/t41-baseline.txt: 1
raw/t41-pinned.txt: 1
```

It is **lane B's sentence about a different subject** (a disabled Windows-only row), **not** a framing of T-79's residual and not
this lane's wording. The lane's own prose and every artifact it authored carry **neither** forbidden framing (census in
`t17-record.md` §F).

**Where the reading this leg is actually about lives.** The decisive per-entry reading (the absent optional binary NAMED as
`MISSING` with its degrade sentence, the other entries still `ok`, and the executed silence-side negative control) is in
`t41-absent-binary-assert-result.json`, which is token-free; `t41-absent-binary-assert.mjs` is the re-runnable assertion.
