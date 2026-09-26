# By-design audit for the packed tree (t25 requirement 3)

Recorded in **this task's** evidence, on the revision t25 measured, so no reader has to re-chase
these five items as suspected packing defects. Re-derived from the packed tree produced by t25's own
`node scripts/pack-mpd.mjs` run plus the current source tree; the discovery-pass copy of the same
list lives at `evidence/tui/composition/20260915T062202Z/PACKAGING.md` section 4.

| # | Observation | Why it is BY DESIGN |
|---|---|---|
| 1 | **21 plugin packages have no `package.json` in the packed tree** (`mpd-bootstrap-plugin`, `mpd-boulder-plugin`, `mpd-bundle`, `mpd-bundle-plugin`, `mpd-comment-checker-plugin`, `mpd-config-plugin`, `mpd-dsh-adapter-plugin`, `mpd-ext-plugin`, `mpd-hashline-plugin`, `mpd-mcp-astgrep`, `mpd-mcp-gitbash`, `mpd-mcp-lsp`, `mpd-memory-plugin`, `mpd-modelchain-plugin`, `mpd-qa-roles-probe`, `mpd-roles-plugin`, `mpd-team-compact-plugin`, `mpd-tools-plugin`, `mpd-tui-plugin`, `mpd-ulw-plugin`, `mpd-workmate-plugin`) | Rows resolve through the ROOT packed manifest's `"./packages/*"` export and the root declares `"type": "module"`, so no sub-package manifest is required. |
| 2 | `packages/mpd-bundle` is not in the packed tree, but `<outDir>/cordis.patch.yml` and `<outDir>/{README.md,README.zh-CN.md}` are | `mpd-bundle` **is** the layer: its patch ships as the package's own `cordis.patch.yml` and the bundle README pair ships at the package root. |
| 3 | `mpd-qa-roles-probe` is absent (`qaRolesProbeInPacked: false`) | QA-only probe, mounted by `tests/overlays/roles-probe.yml`, never by the shipped patch — deliberately never shipped. |
| 4 | `mpd-mcp-shared/bin-resolve.test.mjs` is absent while `bin-resolve.mjs` ships | The shared package is copied wholesale **with a filter that drops `*.test.mjs`** (dev-only); the runtime module ships. |
| 5 | `packages/mpd-mcp-lsp/overlay/` exists in source but is absent from the packed tree | Build-time input for `scripts/build-mcp.mjs` ("in-repo patched copies of the upstream lsp-core files"), not a runtime asset. |

Machine-readable form (with the exact derivation and counts): `raw/by-design-audit.json`.
