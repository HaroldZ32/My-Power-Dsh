# FINDING — parallel chunk scheduling caused one INTERFERENCE red; the serial re-run is the verdict
# t26 attempt 7 · 2026-09-17T04:42Z · docs-gate-engineer

## WHAT HAPPENED
I launched 8 chunks CONCURRENTLY to beat the ~17-min job bound. In chunk **c4**
(`preset-conformance`, `bundle-lifecycle`) the runner recorded:

  `bundle-lifecycle` — **fail**, `reason: exit-1`, exitCode 1, 39,415 ms
  its own record: `boot: {"ok":false,"http":true,"corpus":"<repo>/skills","preset":null,"trust":null,
                    "bundleReal":"<repo>","adapterSeams":null}` with `install/composed/noHomeCopy/
                    layerDurability/uninstall` all ok

The `install`, `composed`, `layerDurability` and `uninstall` steps passed; only the BOOT step — the one that
starts a web server and probes a live session — returned nulls for `preset`/`trust`/`adapterSeams`.

## THE RE-RUN (the contract's rule: a red with a chunk is re-run in its own chunk)
`evidence/dsh-qa/full-sweep/t26-attempt7/c4b-bundle-lifecycle-serial/` — `--only=bundle-lifecycle`, run
ALONE with no other chunk active:

  `complete:true`, counts `{pass:1, unavailable:0, fail:0}`, `bundle-lifecycle` **pass**

## CLASSIFICATION (honest, and it is my own scheduling artefact)
**INTERFERENCE / NOT A LANE DEFECT.** The same lane, same revision, passes when it is the only thing
running; the failing step is precisely the one that boots a second dsh and binds an HTTP port while seven
other chunks were doing the same. The authoritative verdict for `bundle-lifecycle` is therefore the SERIAL
re-run (**pass**), and the parallel-run failure is reported WITH this reading rather than silently dropped
or counted as a red.

## CONSEQUENCE FOR THE BOARD
- `bundle-lifecycle` ⇒ **pass** (serial, `c4b`), with the c4 interference reading recorded beside it.
- The remaining parallel chunks produced no other red of this shape; if any other lane shows a boot-step
  null-set, it gets the same serial treatment before it is published.
- Chunk count and lanes-run-vs-selected are unaffected (the re-run is of an already-selected entry).
