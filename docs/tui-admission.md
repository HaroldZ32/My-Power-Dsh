# DSH-TUI admission conformance

**English** | [中文](./tui-admission.zh-CN.md)

This page records where this bundle stands against the dsh-TUI ecosystem's plugin admission rulebook:
which host the measurement ran against, which instrument produced it, what each of the seven admission
checklist groups and the seven quality and safety red lines actually answers, and what none of it
proves. It is a self-assessment. No ecosystem body reviewed it, and the bundle publishes no conformance
claim.

## 1. What this page is, and where the rulebook lives

The governing document is 《终端交互生态插件准入与开发指南》 — the dsh-TUI plugin admission and
development guide. It lives upstream at `tui-profile/docs/plugin-admission-and-development.md`, commit
`a2600c37720366bc0ca1187e848f718071f7a433`, 99,723 bytes.

**The npm payload does not ship it.** The installed host's `package.json#files` admits only four
entries under `tui-profile/` — `feed`, `registry`, `protocols` and `schemas` — so a
reference to the guide's own path from inside an installed package dangles: on
`@deepseek-harness-tui/dsh-tui` 0.18.0 the file is absent at
`<host>/tui-profile/docs/plugin-admission-and-development.md`. Read the copy committed here instead;
everything this page says about the rules was read from it.

| Artifact | Path | What it is |
|---|---|---|
| The guide, repo-local copy | [`evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/admission-guide.md`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/admission-guide.md) | 1,629 lines, 99,723 bytes: the rulebook text this page cites, fetched from the pinned upstream commit. |
| The admission measurement | [`evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/result.json`](../evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/result.json) | The 2026-11-06 verdict of both shipped manifests against the installed host's own admission library, with the two instrument runs and their exit codes. |
| The instrument | [`skills/dsh-qa/scripts/tui-admission.ts`](../skills/dsh-qa/scripts/tui-admission.ts) | The repository's own admission case: `bun skills/dsh-qa/scripts/tui-admission.ts --static-only`. |
| The host-library probe | [`evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/probe-negotiation.mjs`](../evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/probe-negotiation.mjs) | Calls the installed host's admission chain directly on both manifests, so the verdict does not rest on our wrapper. |

The 2026-11-03 negotiation pair is also kept, because it is the evidence for §3's permission story:
[`negotiation-before.json`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/negotiation-before.json)
against
[`negotiation-final-root.json`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/negotiation-final-root.json)
and
[`negotiation-final-package.json`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/negotiation-final-package.json).

## 2. The three layers, and why their verdicts cannot substitute for one another

The ecosystem has three layers with different maintainers, different criteria and different
conclusions. The guide names them in one table; this is that table, with what each layer can and cannot
say:

| Layer | Maintained by | Criterion | Can conclude | Cannot conclude |
|---|---|---|---|---|
| In-repository profile admission | the dsh-TUI repository (`tui-profile/`, revised with the code) | protocols, shapes, coordinates, digest, conformance (the guide and `conformance/`) | one of the five states: `compatible`, `compatible_degraded`, `waiting_authorization`, `rejected`, `unknown` | safety, quality, "officially certified" |
| First-party feed | the dsh-TUI repository, shipped in the package (`tui-profile/feed/first-party.json`) | an exact `name@version`, scoped packages only, one pinned artifact per version | an entry on the list that skips ONE trust confirmation at install | an admission verdict; absence from the list does not mean a package is unusable |
| Ecosystem listing | the ecosystem organisation (`dsh-tui-ecosystem`) | `plugins.json` plus the `plugins-pr.yml` checks (§6) | a directory entry at [dshtui.com/plugins](https://dshtui.com/plugins) | admission, verification, endorsement |

The order matters and the conclusions do not compose. A `compatible` negotiation says the manifest and
the protocol coordinates line up; it says nothing about whether the plugin is safe or good. A
first-party feed entry says an install of one exact version skips one confirmation; it is not an
admission verdict, and it is scoped packages only. A directory entry says a public repository asked to
be listed and its README links back to dsh-TUI; it checks neither the manifest nor npm. The guide's own
line is the summary: **收录 ≠ 准入 ≠ 背书** — a listing is not an admission, and an admission is not an
endorsement.

## 3. The admission result

The admission vocabulary has exactly five values, and a run answers one of them:

| State | What it means for this bundle |
|---|---|
| `compatible` | Every required contract resolves and nothing optional is degraded. |
| `compatible_degraded` | Admission succeeds while a declared optional contract degrades along its written fallback. |
| `waiting_authorization` | A declared permission is not granted by the host's default-deny registry, so no component identity is bound. |
| `rejected` | The manifest or a protocol coordinate fails validation or negotiation. |
| `unknown` | The chain cannot decide — for example a host descriptor it cannot read. |

The guide presents these five as the product-policy projection of the dsh-std validation,
composition, negotiation and authorization reports; the one-line meanings above are this page's
reading of them, and only `compatible` and `waiting_authorization` were actually observed for this
bundle.

**Measured 2026-11-06T02-09-20Z against the installed host `@deepseek-harness-tui/dsh-tui` 0.18.0:
both manifests answer `validatePlugin: ok` and `negotiate: compatible`.**

| Manifest | SHA-256 (truncated) | `validatePlugin` | Negotiation |
|---|---|---|---|
| `dsh-plugin.json` (bundle root) | `b807ad68…` | `ok` | `compatible` |
| `packages/mpd-tui-plugin/dsh-plugin.json` | `2354afb9…` | `ok` | `compatible` |

Both numbers come from one run of the installed host's own chain,
`loadSpecData -> createContractIndex -> validatePlugin(index, manifest) -> negotiate(index, manifest,
legacyHostDescriptor, [])`, wrapped by our probe and corroborated by the repository's own instrument:

```sh
bun skills/dsh-qa/scripts/tui-admission.ts --static-only
node evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/probe-negotiation.mjs
```

Both exited 0. The 2026-11-06 measurement is a re-run after the permission change below; the
2026-11-03 run is what that change was made against.

**What turned `waiting_authorization` into `compatible`.** The 2026-11-03 run answered
`waiting_authorization` with reason code `PERMISSION_NOT_GRANTED` over four declared permissions, all
`session.*.intercept` points:

- `session.input.intercept@tui/input`
- `session.rewind.intercept@tui/rewind-prompt`
- `session.switch.intercept@tui/session-switch`
- `session.compact.intercept@tui/compact`

A Community v0.15 permission object carries no `optional` flag and the host's registry default is deny,
so a manifest that requests an unused permission never gets past admission. The four entries were
removed — `permissions: []` in both manifests — and the same chain answered `compatible`. The
`tui.dsh/v1alpha1#DecisionEvents` contract stayed declared, as an OPTIONAL requirement with a written
fallback; no interception behaviour was lost, because the handlers at those four points express no
opinion. The before/after artifacts are named at the end of §1.

**The bound this verdict carries.** It is a static admission verdict: it proves parse, validate and
negotiate, not a live TTY mount and not grant-ledger attribution. The host prints its own warning while
producing it — `legacy compatibility descriptor: contracts declared from the mounted legacy service
topology without live probe evidence` — and both the probe result and the repository instrument record
that warning rather than hiding it.

## 4. The A–G checklist

The guide's checklist is seven groups, machine and human together. A group is `PASS` only when every
line in it is met; a group with at least one unmet line stays `PARTIAL` here even when the unmet line
blocks a claim and not admission.

| Group | Verdict | Evidence | Remaining gap |
|---|---|---|---|
| A. Package and identity | **PARTIAL** | Met: `$schema` is an absolute URI (`https://dsh.community/schemas/dsh-plugin-0.15.json`), `manifestVersion` is `0.15`, the `id` is stable and unique (`com.mpd-dsh.mpd-tui`), `facets.host` names an entry with `apiVersion: v1alpha1`, no `client` or `worker` facet appears, and the source repository plus the MIT licence are locatable (`dsh-plugin.json`, `LICENSE.md`). | **Not met: no artifact SHA-256 digest is recorded anywhere.** Neither manifest, `dsh-distribution.json`, `VENDOR_LOCK.json` nor `scripts/pack-mpd.ts` carries one; what exists is prose — hashes quoted inside `docs/tui.md`, several of them truncated with `…` — not a digest the admission path can read. The guide scopes the digest to a Verified claim, so this **blocks a claim, not admission**. |
| B. Declaration completeness | **PARTIAL** | Met: `requires.contracts` carries ONE optional `tui.dsh/v1alpha1#DecisionEvents` with a written fallback; `permissions: []`; `subscriptions: []`; `contributes.commands: []`; neither `provides` nor `requires.services` appears in either manifest. | **Not met:** `contributes.commands: []` while `/mpd` and `/mpd-model` ARE registered through the harness `commands` service, so the host's effect ledger attributes them `undeclared`. This is already documented in [`tui.md` §6.4](./tui.md#64-the-mpd-command-uses-the-hosts-unattributed-commands-service); the declaration and the behaviour still disagree. |
| C. TUI compatibility | **PASS** | Negotiation passes on 0.18.0 for both manifests (`result.json` above); no `Backend` contribution is declared, so `TUI-BACKEND-001` does not apply; no remote attach is claimed, so no remote profile test is owed. | None inside this group. The `compatible` result is a negotiation result, not a live-mount result (§3). |
| D. Runtime behaviour | **PARTIAL** | `apply` is synchronous — no `await`, no `ctx.root` capture; repeated activation is deterministic; cleanup ownership is covered by `packages/mpd-tui-plugin/test/plugin.test.ts`, which records every disposer and counts the disposals. | **Not met:** `effectOn` (`packages/mpd-tui-adapter-plugin/src/index.ts`) wraps the ownership call in `try` with an empty `catch`, so a scope that cannot own an effect fails silently instead of leaving a diagnosable, retryable state; and no activation or runtime-generation id is recorded, so a registered resource cannot be traced to the activation instance that owns it. |
| E. Cleanup and recovery | **PARTIAL** | The documentation half is closed by [`tui.md` §2.1](./tui.md#21-removal-levels-and-the-retention-policy-tui-obs-002): the three removal levels, what a removal revokes, and what it keeps per resource class. | **Not automated.** The pinned conformance matrix (`evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/requirements-v0.15.json`) has no `TUI-OBS-002` row, and `skills/dsh-qa/scripts/tui-spec-conformance.ts` has no evaluator arm for it — an unknown id reports `blocked`. Nothing in the lane certifies §2.1 today. |
| F. Trust and claims | **PARTIAL** | The `trusted-in-process` disclosure is the host's own `/plugin` surface, not a sentence of ours; the dependency closure is reproducible (committed `bun.lock`, and the published dependency closure carries no install script). | **Not met:** this bundle deliberately makes NO conformance claim, so `TUI-CLAIM-001` is never exercised; there is no provenance or attestation, and the artifact digest that would bind a claim does not exist (§4 group A). |
| G. Market display | — (not the author's) | The directory's own display rule: compatibility decision, verification level and restrictions are shown separately, and unauthorised wording is refused. | Not applicable to this repository. What a listing does and does not mean is §6. |

## 5. Quality and safety red lines

The guide's red-line section is five bullets; this wave splits them into seven testable rules so each
one can carry its own verdict.

| ID | Rule | Verdict | Evidence |
|---|---|---|---|
| R1 | No appends to the host's surface events; model-visible surface only through existing services (tools, prompt sections, presets). | **PASS** | The TUI surfaces bind through the host's own service seams (`ctx.get(id, false)` then `service.register(...)`), not by appending to a host event stream; both manifests declare `subscriptions: []`. |
| R2 | No credential injection. | **PASS** | Neither manifest requests a permission (`permissions: []`), and the two TUI packages contain no credential reference (`apiKey`, `api_key`, `credential`) — the seam adapter binds host services, and credential handling stays in the harness. |
| R3 | stdout stays quiet during TUI activity: no `console.log` diagnostics; debug output goes to stderr through `DSH_TUI_DEBUG` or `DSH_TUI_RENDER_LOG`. | **PASS** | `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` enforces it, and its shrink-only inventory (`SWEEP_INVENTORY`) is empty — the eleven frozen files were swept and every entry deleted; the gate reddens if an entry is re-added. |
| R4 | Long sessions stay bounded: per-session state is cleaned on `session/disposed` instead of accumulating. | **PASS** | Nothing accumulates per session: the workspace root, the team view and the home directory are resolved on every call and never cached at module level (`packages/mpd-tui-plugin/src/index.ts`, `apply`), and the only process-wide latch is a single boolean. There is no per-session registry that grows with the number of sessions. |
| R5 | User data only under the existing `~/.dsh-tui` locations. | **FAIL** | Three home roots outside it are written — `~/.mpd/workmate` (`packages/mpd-workmate-plugin`), `~/.mpd/memory` (`packages/mpd-memory-plugin`) and `~/.mpd/codegraph` (the adopted CodeGraph server, a third-party component) — and the bundle writes nothing under `~/.dsh-tui` itself. Recorded as a deviation, not repaired: §5.1. |
| R6 | External JSON is always validated; corruption falls back instead of crashing. | **PASS** | Every external read goes through a validate-then-fallback path; the honest bound is that the validation is structural (shape and type), not schema validation. |
| R7 | Plugin config and file content are untrusted input, especially strings on the render path: width is measured in terminal cells, never `string.length`. | **PASS** | `cellWidth` lives in `packages/mpd-tui-plugin/src/sanitize.ts` and is the width primitive the render path uses; two `.length` aliases recorded when the rule landed remain in the tree and are benign today — they are recorded, not re-derived in this wave, and they are not a licence for a third. |

### 5.1 R5: user data outside `~/.dsh-tui` — a recorded deviation

R5 fails and this wave does not fix it. The user decision of 2026-11-06 records it as a known
deviation with a reason:

- **This bundle is multi-surface.** One install ships the Web GUI surface, the DSH-TUI surface and a
  dsh-Go native interface. Its state roots serve all three; they are not TUI-only state.
- **It predates the TUI ecosystem.** `~/.mpd` has been this bundle's own namespace since 0.1, and the
  workmate library and the memory store are user data that already lives there.
- **Relocating it would break existing work.** Moving `~/.mpd/workmate` and `~/.mpd/memory` under
  `~/.dsh-tui` would strand every existing workmate library and memory store, for a rule that is about
  placement rather than behaviour.

This is a deviation, not a defect being ignored: the rule is not met, the page says so, and no
statement anywhere claims `~/.dsh-tui` compliance. If the rule ever becomes a hard gate, three things
would have to change together: the three plugins would need their data roots resolved through one
configurable root that defaults to `~/.dsh-tui`; a migration path would have to carry existing
`~/.mpd/workmate` and `~/.mpd/memory` stores to the new root; and the adopted CodeGraph server — a
third-party component, not our code — would need its index root to follow that override instead of
`~/.mpd/codegraph`. Until all three land, a listing or a `compatible` verdict must not be read as
`~/.dsh-tui` conformance.

## 6. What this bundle does not claim, and how a directory entry is obtained

The explicit non-claims, so a reader never has to infer them:

- **No Verified claim.** No digest of the packed plugin artifact is recorded in either manifest, in
  `dsh-distribution.json`, in `VENDOR_LOCK.json` or in `scripts/pack-mpd.ts`. The guide scopes the
  digest to a Verified claim, so no claim artifact is published and none may be implied.
- **No `Backend` contribution.** No `tui.dsh/v1alpha1#Backend` contract is declared, so
  `TUI-BACKEND-001` does not apply and there is no backend picker entry.
- **No remote attach.** No remote presentation or attach mode is claimed, so no remote profile test is
  owed and none was run.
- **No `~/.dsh-tui` user data.** R5 fails (§5.1). The bundle writes `~/.mpd/workmate`,
  `~/.mpd/memory` and `~/.mpd/codegraph`.
- **No package-shape conformance.** Two deviations are recorded rather than repaired: the root
  `engines.node` is `>=22.18` where the guide writes `^22.19 || >=24`; and there is no
  `peerDependencies["@deepseek-ai/cordis"]`, recorded in
  `packages/mpd-tui-plugin/dsh-plugin.json` under `x-mpd-tui-package` with the reason (a private
  in-workspace package that is never installed standalone, and a second `cordis` by name is forbidden).
- **No TUI-OBS-002 automation.** The pinned conformance matrix
  (`evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/requirements-v0.15.json`) has no `TUI-OBS-002`
  row, and `skills/dsh-qa/scripts/tui-spec-conformance.ts` has no evaluator arm for it, so an unknown
  id reports `blocked`. [`tui.md` §2.1](./tui.md#21-removal-levels-and-the-retention-policy-tui-obs-002)
  is the manual answer to that requirement; the lane does not certify it.
- **No ecosystem review.** No ecosystem body read this page. The `compatible` verdict is a measurement
  against the installed host's admission library, nothing more.

**How a directory entry is obtained.** The listing layer is the ecosystem's own repository
(`dsh-tui-ecosystem/dsh-tui-ecosystem`): one object per plugin in its `plugins.json`, added by pull
request. This repository stages its entry at `docs/market/dsh-tui-ecosystem-entry.json` so the fields
can be reviewed in-tree before submission; the catalogue keeps the authoritative copy. The five checks
the pull request runs, at the guide's 2026-10 scope:

1. `plugins.json` is valid JSON and `plugins` is an array.
2. Every entry carries the seven required fields — `name`, `displayName`, `description`, `author`,
   `repo`, `kind`, `addedAt` — and `kind` is one of `plugin`, `template`, `core`.
3. `repo` matches `https://github.com/owner/repo`, and neither the plugin name nor the repository URL
   is a duplicate (case-insensitive).
4. A NEW entry: the repository really exists and is public, and the pull request's author is that
   repository's owner or a collaborator.
5. A NEW entry: the repository README links to dsh-TUI (`https://dshtui.com` or the main repository).

Two gotchas inside those checks: the validator lowercases the README before matching, so casing is
free, but the link must be a real link and not a bare mention; and the README is read from the
repository's DEFAULT branch — `master` here — not from the branch the entry was prepared on.

What the five checks do **not** look at is as important as what they do: npm publication, whether the
package name is bare or scoped, whether a `dsh-plugin.json` exists, whether the manifest parses,
provenance or attestation, and which capabilities or permissions are declared. That is why the guide
writes 收录 ≠ 准入 ≠ 背书: an entry says the repository is public, the author submitted it, and the
README links back — it carries no statement about this page's checklist, and no endorsement by dsh-TUI
or the ecosystem organisation.
