# Plan D — Decouple the bundle from its checkout location (one-plugin install)

Status: audited + mechanism-verified 2026-08-26; awaiting execution sign-off.
Goal: the repo must be installable ANYWHERE and MOVABLE, through ONE `dsh plugin add`
command (the same flow dsh-agent-teams and the web third-party bundles use), with zero
absolute paths tied to any fixed checkout.

## 1. Audit: current location couplings

| # | File / surface | Coupling | Fix
|---|---|---|---|
| 1 | `packages/mpd-bundle/cordis.patch.yml` | absolute dev paths for every mpd plugin row, MCP `args`/`env`, skill dirs, `.toolchain` binaries | rewrite with node-resolvable `name:` for plugin rows + `!!js baseUrl`-relative paths for `args`/`env`/dirs (mechanism verified, see 2) |
| 2 | `scripts/install-profile.mjs` | writes absolute paths into the user's home patch; preset copy step; two-step install | superseded by the bundle package + a bootstrap plugin (preset auto-copy); kept only as a dev-QA helper |
| 3 | `tests/overlays/*.yml` | QA-only absolute paths | make them template/env-generated, or keep QA-only with a note (they never ship) |
| 4 | `mpd-codegraph-plugin` / `mpd-comment-checker-plugin` | binary fallback derived from the plugin's dist location (repo-relative) | package-relative via `createRequire(import.meta.url)` (plugin code CAN require) + env override first + binaries ship inside the package |
| 5 | `.toolchain/` provisioning | installer-time npm install into the repo | binaries ship inside the package (`toolchain/`), or installed as optionalDependencies; native bins wrapped by tiny JS shims so patch rows stay path-stable |
| 6 | Preset delivery | installer copies `mpd-*` into `$DSH_HOME/.agent-presets` | `mpd-bootstrap` plugin copies them at apply via the official `agentPresets` service (idempotent; user root trust) |
| 7 | `mpd-codegraph` init | runs `codegraph init` against the session cwd; on the real machine cwd = `$HOME` → 60 s scan → `status=fail` every boot | skip when cwd is the user home (or too broad) with a one-line hint; init only in project dirs |
| 8 | `llm-pi-ai` row | adds a second DeepSeek provider on top of the stock official one | `disabled: true` by default; `MPD_DSH_COMPAT_TRACK=1` env opt-in |
| 9 | Preset display names | 4 presets still say `OmO …` | already fixed (names now `MPD …`); preset `skill-filesystem` no longer bakes a dev path (11/11 inherit the global row) |
| 10 | QA sandboxes under `/tmp` | `/tmp` is wiped between tool calls on this host (killed the long C2 run) | QA sandboxes must live under the workspace (gitignored) |

## 2. Mechanism verification (done this round)

- `!!js` patch scope: `process` YES, `require` NO, `import.meta` NO, and **`baseUrl` =
  `file://` URL of the profile directory** (live probe: `baseUrl:file://…/profiles/t/`).
  => every patch-time path can be `!!js baseUrl.replace(/^file:\/\//, "").replace(/\/+$/, "") + "/node_modules/<pkg>/<file>"`.
- Loader `name:` resolution is node resolution anchored at the profile dir
  (documented two-anchor design) => plugin rows can be plain `name: '@mpd-dsh/mpd/packages/…/dist/index.js'`
  once the bundle package declares a wildcard `exports` map.
- Reference pattern confirmed: community bundles (nowledge-mem, dsh-agent-teams) install with
  `dsh plugin --profile <name> add <pkg|path|git-url>`; local path install links the checkout
  (dsh-agent-teams' "build from source" flow).

## 3. Target shape

- The REPO ROOT becomes the installable bundle package `@mpd-dsh/mpd`:
  - `package.json`: `dsh.bundle.patch: "./packages/mpd-bundle/cordis.patch.yml"`,
    `exports: { "./packages/*": "./packages/*" }`,
    `files`: `packages/*/dist/**`, `packages/mpd-skills-plugin/skills/**`,
    `packages/mpd-presets-plugin/presets/**`, `packages/mpd-mcp-*/dist/**`, `toolchain/**`,
    `packages/mpd-bundle/cordis.patch.yml`, `third-party/**`, `LICENSE*`.
  - dependency on `@nanmicoder/dsh-agent-teams` (the adopted team plugin) so one install
    materializes it too; its row keeps `stateDir: .mpd/team`.
- `packages/mpd-bundle/cordis.patch.yml` rewritten:
  - official rows unchanged (llm-deepseek config, agent-default-model, skill-filesystem),
    `llm-pi-ai` disabled by default (env opt-in);
  - `agent-teams` row via dependency name;
  - every mpd plugin row: `name: '@mpd-dsh/mpd/packages/<pkg>/dist/index.js'`;
  - MCP rows: `command: node`, `args: !!js [basePath + '/node_modules/@mpd-dsh/mpd/packages/mpd-mcp-<x>/dist/<cli>.js']`;
    binary envs via `!!js basePath + …toolchain shims`;
  - skill dir: `!!js basePath + '/node_modules/@mpd-dsh/mpd/packages/mpd-skills-plugin/skills'`;
  - remote MCP rows (context7/grep_app) unchanged.
- New `mpd-bootstrap-plugin`: at apply, if presets missing from the user root, copy from the
  package (agentPresets.copy / direct fs copy into `$DSH_HOME/.agent-presets`, idempotent),
  print one status line. `mpd-codegraph` keeps its init discipline but gains the skip-home
  guard + package-relative binary resolution.
- Install becomes ONE command (no installer script on the user machine):
  - from a checkout: `cd <repo> && dsh plugin --profile web add .`
  - from Gitee: `dsh plugin --profile web add <gitee-url>` (pnpm git; private repo needs
    git credentials — document; local-path install avoids this),
  - (optional future) npm publish `@mpd-dsh/mpd` → `dsh plugin --profile web add @mpd-dsh/mpd`.
- `scripts/install-profile.mjs`: deprecated for users; retained for dev QA only (AGENTS/README note).

## 4. Steps

P1. Immediate fixes (independent): codegraph skip-home guard + rebuild; verify preset fixes
    committed; `llm-pi-ai` disabled-by-default in bundle patch.
P2. Package layout: root package.json (exports/files/dsh.bundle), build/pack script
    (`scripts/pack-mpd.mjs`) that assembles dists + toolchain shims into the published tree.
P3. Rewrite `cordis.patch.yml` with baseUrl/name patterns (no absolute paths anywhere).
P4. Bootstrap plugin (preset copy) + package-relative binary resolution in codegraph/comment-checker
    plugins + native-bin shims (sg/codegraph/comment-checker).
P5. Relocation QA (`evidence/plan-d/relocate/`): copy the repo to a different path; isolated
    DSH_HOME; `dsh plugin --profile t add <copied-path>`; assert the composed dump contains NO
    reference to the original path; headless smoke (config/memory/boulder tools); presets probe;
    web `/state` route smoke; then MOVE the checkout and re-verify compose stays valid.
P6. Docs: AGENTS.md install section, README quickstart, plan-c/decisions append; deprecate
    installer; commit on `feature/plan-d-relocate`, merge to dev, push Gitee.

## 5. Risks / mitigations

- `baseUrl` URL form could differ across host versions: verified on this host; the P5
  relocation test re-verifies on the user's real profile.
- `exports` wildcard vs loader resolution: proven by P5 before docs claim it.
- pnpm git installs of a private Gitee repo need auth on the user machine: local-path install
  is the documented primary flow (same as building dsh-agent-teams from source).
- Profile `node_modules` layout (pnpm links) keeps `baseUrl + /node_modules/<pkg>` valid for
  both linked and copied installs (path-through-symlink).

## 6. Out of scope

- npm publishing (optional future step; not required for relocation).
- Removing the `omo`-named vendored upstream skill content inside the 17-skill corpus
  (provenance; separate decision if desired).