# Pristine upstream fixtures (agent-teams self-fix tests)

**Provenance (one-time extraction):** `git show d510a16^:<path>` —
`packages/mpd-agent-teams-plugin/lib/{tools.js,quality-gates.js}` at the revision **before**
`d510a16` committed the mpd delta bodies into those files.

| Fixture | Source path | Commit | bytes | lines | sha256 |
|---|---|---|---|---|---|
| `tools.js` | `packages/mpd-agent-teams-plugin/lib/tools.js` | `d510a16^` | 128218 | 2279 | `ba1f6ab20d18285956c1cf206762f5a751eacd584513fa0d0f0c798e8bfc9ce7` |
| `quality-gates.js` | `packages/mpd-agent-teams-plugin/lib/quality-gates.js` | `d510a16^` | 40467 | 862 | `4907ff10a45351af8080b0a6203239012e25028c8175bd7588d31a7aa7481b57` |

Every fixture contains **zero** `mpd-delta` markers. The tests read these files and assert the pinned
sha256, so a fixture edit cannot silently relax an assertion.

## Why a checked-in copy, in plain text (t8 / F2 ruling)

The tests below exercise the healer against a **re-materialized upstream** file. Their fixture used to
be `git show HEAD:…`, which stopped being pristine the moment `d510a16` committed the delta bodies
into `HEAD` — the three failing assertions were a broken fixture premise, not a plugin defect.

Two alternatives were measured and rejected:

- **Read the vendored checkout (`.mpd-dsh/upstream`)** — that tree is gitignored
  (`.gitignore:11`), so it is not a stable fixture source, and its `team-core` package carries no
  `lib/tools.js`.
- **Reconstruct by stripping the registry's marked regions from the current file** — it cannot
  restore the REPLACEMENT-shaped regions (the upstream `description:` line and the upstream
  `pathMatchesScope` declarations were replaced), so it would corrupt the very premises these three
  tests assert.

The copy is stored **uncompressed on purpose**: a future reader must be able to open the fixture and
compare it with the current file to understand a failure. Gzip would trade ~169 KB for an unreadable
indirection an agent cannot inspect. That trade-off is a decision, not an oversight.

The change is confined to `self-fix-tests/**`: `lib/**` and `lib/mpd-deltas.js` (the adopted
upstream tree and its governed delta registry, AGENTS.md §6) are untouched.
