# Captain-directed paste — Chinese mirror of `docs/tui.md` §6.4

**Closes:** t30 finding `T30-DOCS-1` (medium, `resolved=false`) and the single failed check in t29's
own `doc-assertion.json` (`item3.docs/tui.zh-CN.md`).

## What landed

Two insertions in `docs/tui.zh-CN.md`, and nothing else:

| # | Location | Payload |
|---|---|---|
| 1 | after the five-state admission line (§4.1, `:86`) | the pointer to §6.4 |
| 2 | after §6.3, before `## 7.` (`:182-198`) | the new `### 6.4` section |

Payload source: `evidence/tui/composition/20260915T071619Z-docs-mpd-command/zh-6.4-snippet.md`,
pre-staged by t29 so this was a paste and not an authoring task. t29's dispatch kept
`docs/tui.zh-CN.md` OUT of its `inScope`, so the paste is recorded here as captain-directed work —
the same treatment as `evidence/tui/composition/20260915T061519Z`.

## Measured

| Artifact | Before | After |
|---|---|---|
| `docs/tui.zh-CN.md` | `6e7a61a9ffcf5d03…` (t27/t28/t29 pin) | **`c1c0dc39ba6485af…`** (27746 B, mtime 2026-09-15 15:21:39 +0800) |
| `docs/tui.md` | `0d899a4d308fdf17…` | unchanged (t29 landed the English half) |
| `dsh-plugin.json` | `84ed4a5d5aac3fb0…` | unchanged |
| `packages/mpd-tui-plugin/dist/index.js` | `5dce2563fd0e3b20…` (98883 B) | unchanged |
| `packages/mpd-bundle/cordis.patch.yml` | `3866dc11b52aa3ae…` | unchanged |
| `presets/mpd/agent.cordis.yml` | `0be8781f1570e9ca…` | unchanged |

## Gates run

| Script | Result | Raw |
|---|---|---|
| `doc-assertion-captain-zh-mirror.mjs` (this dir) | **14/14 passed, exit 0** | `result.json` |
| `evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` (t27's shipped checker) | **28/28 passed, exit 0** | `raw/t27-doc-assertion.json` |
| `evidence/tui/composition/20260915T071619Z-docs-mpd-command/doc-assertion-t29.mjs` | 12/13, exit 1 — see the residual below | `raw/t29-doc-assertion.json` |

The captain assertion proves the paste byte-exactly: both fenced payloads of the snippet (1 line and
16 lines) are literal substrings of the Chinese page, so "the mirror landed" is a byte measurement,
not a reading.

## Residual — `t29`'s zh predicate is a false negative by construction (disclosed, not rounded to pass)

`doc-assertion-t29.mjs:102-110` gates the mirror on
``/commands` service|commands 服务|commands 服务/`` — i.e. on the service name being **unbackticked**.
Both the English section and the pre-staged Chinese snippet write `` `commands` 服务`` / `` `commands`
service``, so the predicate is **false for the document AND for the snippet it instructed to paste**
(measured: `t29PredicateResidual.onZhDocument=false`, `onPreStagedSnippet=false` in `result.json`).
It was written to fail while the mirror was missing and never validated against the payload it
prescribes, so it cannot witness the mirror now that it exists.

Treating it as a doc defect would be wrong (the page states nothing false and omits nothing), and
rewriting the page to carry a redundant unbackticked token — or editing t29's evidence script, which
is a record of a past task's measurement — would be worse. The residual is therefore **recorded**:
an independent re-run of `doc-assertion-t29.mjs` shows 12/13 with this one id, and the reason is in
`result.json` next to the measurement. The delivery report must disclose it.

## Files

- `doc-assertion-captain-zh-mirror.mjs` — the assertion (self-contained; run with `node`).
- `result.json` — its report: anchors, before/after digests, the predicate residual, 14 checks.
- `raw/t27-doc-assertion.json`, `raw/t27-doc-assertion.err` — t27's checker re-run on the new bytes.
- `raw/t29-doc-assertion.json`, `raw/t29-doc-assertion.err` — t29's checker re-run on the new bytes.
- `raw/assertion.err` — empty (no stderr from the assertion).
