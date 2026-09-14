# interject-tools (t52 execution, no slot — see result.json)

This directory holds the captain-dispatched round that added the COMPOSITION-ROOT
registration move on top of the interjection tool surface.

| Artifact | What it is |
|---|---|
| `result.json` | the full record: the move, the user's ruling, every acceptance item, gates, pins, findings |
| `reachability.md` | the per-export production-reachability inventory (261 exports; 3 with no production caller + a decision each) |
| `raw/mount-proof-t52.mjs` | the real-boot mount proof driver (run it with `--self-test` first) |
| `raw/reachability-inventory.mjs` / `.json` | the generator and its machine-readable output |
| `raw/write-reachability-md.mjs` | renders the inventory into `reachability.md` |

The FIRST half of this work (the three tools, the QA probe instrumentation) was delivered and
COMMITTED under `evidence/omo-align/interjection-tools/` — that directory is the earlier
record and was not modified here. The mount proof and inventory are mirrored here for
convenience; `interjection-tools/` keeps its own copies.

No delivered evidence was overwritten: every file in this directory is new.
