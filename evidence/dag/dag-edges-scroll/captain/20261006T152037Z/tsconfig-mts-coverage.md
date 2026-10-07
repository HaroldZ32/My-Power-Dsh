# Measured finding — the `docker/**/*.mts` type-coverage gap (recorded, NOT fixed in this wave)

Raised by the WEB lane while checking its own `docker/ui/capture.mts`. Measured by the captain on
2026-10-06 with a TEMPORARY root config (created, used, deleted — `tsconfig.json` is untouched).

## The gap

`tsconfig.json`'s include carries `docker/**/*.ts`. **That glob does not match `.mts`**, so every
`.mts` driver under `docker/` — including the wave's own `docker/ui/capture.mts` and the previous
wave's PTY drivers — is OUTSIDE the root type program. `bun run typecheck` therefore cannot see them,
and `tsgo --noEmit` stays green no matter what those files contain.

## The measurement

A temp config with `docker/**/*.ts` replaced by `docker/**/*.mts`, run from the repo root:

```
docker/ui/capture.mts(739,36): error TS2307: Cannot find module '/tmp/mpd-fixture/team-fixture.mts' or its corresponding type declarations.
docker/ui/capture.mts(817,36): error TS2307: Cannot find module '/tmp/mpd-fixture/team-fixture.mts' or its corresponding type declarations.
docker/ui/capture.mts(865,34): error TS2307: Cannot find module '/tmp/mpd-fixture/team-fixture-records.mts' or its corresponding type declarations.
packages/mpd-tui-plugin/src/panel-dag.ts(570,81): error TS2551: Property 'viewportCols' does not exist on type 'PanelViewport'. …
```

The fourth line is the sibling lane's file IN FLIGHT and is transient. **The first three are the real
result**: they are imports of `/tmp/mpd-fixture/*.mts`, paths that exist only INSIDE the capture
container. Widening the include therefore reddens the standing `typecheck` gate until those three
specifiers stop being statically resolvable.

## Why this wave does NOT close it

- The gap is PRE-EXISTING and not introduced here; closing it is a change to a STANDING gate's subject
  set, which deserves its own evidence rather than a last-minute edit while two lanes are in flight.
- Closing it needs a decision the wave has not made: either a `.d.ts` shim declaring the container-path
  modules, or making the three specifiers non-literal so the checker cannot resolve them. Both are
  reasonable; neither was scoped.

## What is recorded instead

- The gap, the exact measurement, and the three error sites above.
- The mitigation the lanes used meanwhile: the WEB lane typed its own driver by hand where it could and
  reported the three container-path imports as unresolvable BY CONSTRUCTION rather than hiding them.
- A QUEUED follow-up: widen the include AND handle the three specifiers in the same change, so the
  drivers that produce this wave's most persuasive evidence stop being untypechecked.
