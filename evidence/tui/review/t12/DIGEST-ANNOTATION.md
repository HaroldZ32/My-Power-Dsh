# t12 digest annotation + corrected renderer causation (added, never rewritten)

Two lineage records for a later reader, so no verdict in this directory is anchored to bytes it did
not measure. `result.json` and `REVIEW.md` are unchanged measurement records.

## 1. Plugin artifact revision chain (`packages/mpd-tui-plugin/dist/index.js`)

| sha256 | bytes | when | behaviour measured | who measured it |
|---|---|---|---|---|
| `695f68c4858745cc…` | 93206 | t4 era | **INERT** in a real boot (inject-free probes; `/mpd status` reached the model) | Senior Engineer, instrumented mount |
| `710d3eef5d0f451b…` | — | built ~06:00Z | 5–6 seams take effect | Lead's panel runs 06:12–06:22Z |
| **`5dce2563fd0e3b20…`** | 98883 | mtime `2026-09-15T06:23:20Z` | **6/7 seams register; renderer line absent (host-side)** | **t12 reviewed THIS revision**; t8's live lanes measured it at 06:34Z |

t12's package-side conclusions are anchored to the third row only. The first two are superseded
revisions kept for lineage, exactly as `evidence/tui/composition/…/T24-DIGEST-ANNOTATION.md` does for
the manifest.

## 2. Manifest digest chain (`dsh-plugin.json`)

`sha256:7701c48c…` (t22) → `sha256:824b74f8…` (consequence statement) → **`sha256:84ed4a5d…` (t24, current)**.

`result.json` cites `824b74f8…` in exactly one place, **explicitly as a superseded earlier reading**
("an earlier reading in this session was 7602 B / 824b74f8") while anchoring every manifest statement
to `84ed4a5d…`. t24 moved the manifest's identity pair (`name` `@mpd-dsh/mpd-tui` → `@mpd-dsh/mpd`,
version kept `0.9.1`, `id` unchanged) and touched nothing else, so the declarations t12 reasoned about
are the same ones. No package-side conclusion changes.

## 3. Corrected renderer causation (carried here for t12)

The revised cause for the missing `tuiRenderers` row is **not** the channel capturing its renderer
facade once at construction (that attribution is retracted). It is the host's deny-list capture in
`dsh-renderers`: the renderer refuses a type that is in the known-type set **as captured when the
renderer module is evaluated** — which, by host row order, is after the bundle layer and before the
profile-patch layer. Our plugin is a bundle row, so its own iron-rule-2 type registration (needed to
keep sessions resumable) lands before that capture and its renderer is refused from the first boot.
A later-mounted row's fresh types render — verified by a single-boot cross-run mounting the
implementer's `probe9` verbatim beside my canary (`t8probe/known-0710` renders; `mpd-tui/board-opened`
does not).

Full record, including the bug in my own first canary (`ctx.effect(fn)` invokes `fn` immediately and
uses its RETURN as the disposer — my body unregistered the renderers at apply time):
**`../../live/20260915T063140Z/CORRECTION-renderer-causation.md`**.

**Effect on this directory's verdict: none.** t12's PASS rests on the two closed defects (the ctx.inject
rework and the F1 disposer inference) and on the seam/sanitize/cleanup audit — none of them depends on
the renderer cause. The disposition is also unchanged: the renderer line stays **NOT CLAIMED**, and the
package's `requested`-never-`confirmed` reporting for that seam remains the honest maximum, since the
host exposes no read-back and a refusal returns the same no-op disposer as a success.
