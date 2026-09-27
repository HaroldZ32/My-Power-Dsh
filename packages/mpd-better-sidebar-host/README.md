# mpd-better-sidebar-host

**English** | [中文](./README.zh-CN.md)

The bundle's own door to the **`dsh-better-sidebar`** host it ships.

## Why it exists

`dsh-better-sidebar` is a dependency this bundle declares, so a checkout install has it under
`<bundle>/node_modules`. But a row named `dsh-better-sidebar` resolves against the **profile's**
`node_modules`, and on a `link:` install (`dsh plugin add .`) that holds only the linked bundle —
`healProfileModuleFallback` does not materialize a declared dependency for a `link:` layer. Measured:
the bundle's sidebar guard disabled its row and the bundle contributed **no sidebar GUI at all**.

Two repairs were measured and **both fail**, which is why this package exists:

| Attempt | Result |
|---|---|
| a `file://` URL as the row NAME | the row MOUNTS, then the loader disables it: `its declared peer dependencies cannot be validated: name.startsWith is not a function` — the validator is handed a URL where it expects a package name |
| routing through the bundle's `exports` (`@mpd-dsh/mpd/node_modules/…`) | refused by **Node itself**: `Invalid "exports" target "./node_modules/*"` — an exports target may not contain `node_modules` |

A **relative, computed** import has neither problem: no exports target, no peer validation (the row
resolves to THIS package, whose peers are empty), and the host's own dependencies resolve upward from
its real location. The row is a normal `@mpd-dsh/mpd/packages/…` specifier, which both install layouts
resolve.

## The one thing that can rot

Cordis takes the DECLARED `inject` list from the module the row names — this one. With an empty list
the host applied and then threw `cannot get property "webServer" without inject`: it was loaded and
starved of the services it declares. The list is therefore restated here rather than imported (a static
import cannot name a path that exists in both layouts, and the dynamic import that solves that cannot
produce a static export).

`test/host-contract.test.ts` compares this list against the shipped host's own whenever that package is
resolvable, and says so in the log when it is not — a silent skip would be the same defect class this
package exists to fix.

## Configuration

None. The row that mounts it is `mpd-better-sidebar` in the bundle patch.

## Known limits

- The `inject` list is pinned to the host version the bundle declares
  (`dsh-better-sidebar@0.19.0-alpha.1`). A version bump that changes the list fails the contract arm
  rather than starving the host in silence.
- The host is reached by a path computed at runtime; a host installed somewhere else entirely is not
  found, and the row then fails loudly with the path it tried.
