# Diagnosis — `dual-track-smoke` / `deepseek` track: `NO_ADAPTER`

- Date (UTC): 2026-10-29
- Repo: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh` (branch `master`, read-only)
- Harness: `dsh` 0.2.1-rc.3 at `/home/haroldzhao/.nvm/versions/node/v24.21.0/bin/dsh`, node v24.21.0
- Evidence root: `evidence/dsh-qa/dual-track-deepseek/2026-10-29T01-30-11Z/`
- Scope: diagnosis only. No case file, `packages/**`, or `~/.dsh` file was modified. Only this artifact
  directory was written, plus the case's own untracked evidence from one reproduction run.

Line numbers below were read at 2026-10-29T01:31–01:35Z; per T-55 the SYMBOL is the durable anchor.

---

## 1. Symptom, reproduced on demand

`bun skills/dsh-qa/scripts/dual-track-smoke.ts` (unmodified, 2026-10-29T01:34Z):

```
[llm-dual-track] official ok=true (9545ms, exit=0)  -> .../official/2026-10-29T01-34-27.215Z
[llm-dual-track] deepseek ok=false (5665ms, exit=1) -> .../deepseek/2026-10-29T01-34-32.880Z
CASE_EXIT=1
```

- `evidence/dsh-qa/llm-dual-track/official/2026-10-29T01-34-27.215Z/result.json`:
  `{"ok":true,"provider":"deepseek-official","exit":0,"hasToolEvidence":true}`
- `evidence/dsh-qa/llm-dual-track/deepseek/2026-10-29T01-34-32.880Z/output.log` (64 bytes, whole file):

  ```
  dsh: NO_ADAPTER: no adapter registered for provider "deepseek"
  ```

- `result.json` for that run: `{"ok":false,"provider":"deepseek","exit":1,"hasToolEvidence":false}`

The 23 recorded deepseek-track runs in `evidence/dsh-qa/llm-dual-track/deepseek/` split into two eras
(classified from each `output.log` tail):

- 2026-09-27 → 2026-10-29 (13 runs, including this reproduction): `NO_ADAPTER` for provider `deepseek`.
- 2026-09-11 (2 later runs) and 2026-09-17 (2 early runs): `MISSING_CREDENTIAL: llm-deepseek: no API key
  for provider route "deepseek-official"` — the track's model request was being served by the OFFICIAL
  adapter, not pi-ai.
- 2026-09-11 (2 earliest runs): boot crash, `Cannot find module …/node_modules/@mpd-dsh/mpd/...` (the
  pre-`devPatch()` packed-operand era).
- Four older runs (2026-08-26, 2026-09-16, 2026-09-17 ×2) record `ok:true`; §7 shows, from the
  `deepseek-official` text in the adjacent failures, why those greens cannot be attributed to the pi-ai
  route either.

## 2. The track's exact boot invocation

`skills/dsh-qa/scripts/dual-track-smoke.ts`, symbol `TRACKS.deepseek`:

```
deepseek: { label: "deepseek (dsh-llm-pi-ai)", provider: "deepseek",
            overlay: "tests/overlays/compat-track.yml" }
```

`TRACKS.official` has `provider: "deepseek-official"` and no overlay.

Symbol `runReal` builds, for every track, a fresh `DSH_HOME` (`mkdtempSync`), seeds the credential
store from `~/.dsh/.credentials.yaml`, copies `~/.dsh/settings.yaml` **only when it exists**, writes the
dev-rewritten bundle patch (`devPatch()`), then spawns:

```
dsh --profile headless \
    --patch <DSH_HOME>/bundle.dev.patch.yml \
    --patch <repo>/tests/overlays/compat-track.yml \
    "List the files in the current working directory (first use the bash tool with pwd and ls), ..."
```

- env: `DSH_HOME=<sandbox>`, `DEEPSEEK_API_KEY=<resolved from the store>` (never printed), inherited `HOME`
- cwd: `sandboxWorkspace(sandbox)` = `<sandbox>/ws`
- `tests/overlays/compat-track.yml` (whole file) id-targets the base row `agent-default-model` and sets
  `provider: deepseek`, `model: deepseek-v4-flash`.
- The case therefore does NOT boot the machine's `dsh-tui`/`web` profile. `--profile headless` is an
  **installation-owned shipped profile**: `@deepseek-ai/dsh-app-boot` `PROFILE_TEMPLATES.headless` =
  `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]`, materialized into the fresh
  `$DSH_HOME/profiles/headless` on first use.

## 3. What `NO_ADAPTER` means, and where the `deepseek` adapter has to come from

### 3.1 The error is a REGISTRY miss, not a credential failure

Installed `@deepseek-ai/dsh-llm/lib/index.js`, symbol `LlmRuntime.registration(provider)`:

```js
registration(provider) {
    const registration = this.adapters.get(provider);
    if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
    return registration;
}
```

The repo carries a mirrored copy of this source at
`packages/mpd-schemastery/harness/dsh-llm/lib/index.ts` (same `LlmRuntime.registration`, same string).
`NO_ADAPTER` is thrown BEFORE any adapter is entered, so no credential is ever consulted. A route that
exists but has no key fails differently: `MISSING_CREDENTIAL` (e.g. `dsh-llm-deepseek-api-key`'s
`PROVIDER`-key error, or `dsh-llm-pi-ai`'s `resolveApiKey`).

### 3.2 Which row owns provider `deepseek`

- `@deepseek-ai/dsh-llm-deepseek` + `@deepseek-ai/dsh-llm-deepseek-api-key` own **only**
  `deepseek-official`: `const PROVIDER = "deepseek-official"` in `dsh-llm-deepseek-api-key/lib/index.js`.
  That is the row the `official` track uses, and it passes.
- Provider id `deepseek` is owned by **`@deepseek-ai/dsh-llm-pi-ai`** — the pi-ai multi-provider twin —
  mounted by the **`@deepseek-ai/dsh-base` bundle patch**, row `- id: llm-pi-ai`, name
  `'@deepseek-ai/dsh-llm-pi-ai'`. No mpd row and no `mpd` preset declares it: the repo's
  `cordis.patch.yml` mentions it only in a policy comment ("never id-target rows owned by the stock DSH
  templates … llm-pi-ai"), and `presets/mpd.patch.yml` does not mention it at all.
- The row is mounted **DORMANT**. `dsh-base/cordis.patch.yml` states it verbatim: "mounted dormant: zero
  routes … until a `llm-pi-ai:` settings section supplies provider profiles … Which adapters exist is
  composition; which providers run is the user's settings document."
- In `dsh-llm-pi-ai/lib/index.js`, `Config = z.object({ providers: z.dict(profile).default({}).volatile() })`,
  and `ensureRegistrationFacts` calls `ctx.llm.registerAdapter(routes, adapter)` **only when
  `routes.length > 0`**; zero routes means the adapter is never registered at all.

### 3.3 Which layer must carry the route

Three layers exist; the ROW comes from layer 1 and the ROUTE must come from layer 3:

1. The **bundle patch** (`@deepseek-ai/dsh-base`): carries the `llm-pi-ai` ROW but no providers. → the case's
   sandbox always has this layer.
2. The **preset** (`mpd`): does not touch `llm-pi-ai`. → irrelevant.
3. The **active profile patch + the settings document**: `dsh-settings`' `SettingsForms.importLegacyDocument`
   reads `<DSH_HOME>/settings.yaml`, renames it to `settings.yaml.imported`, and writes each top-level
   section into the profile entry of the same id — so a `llm-pi-ai:` section becomes
   `config.providers` on the `llm-pi-ai` row in
   `<DSH_HOME>/profiles/<name>/cordis.patch.yml`. A `--patch` overlay that id-targets `llm-pi-ai` is the
   alternative spelling.

The case honours surface 3 **only** through `~/.dsh/settings.yaml` (plus its own `--patch` operands).

### 3.4 What the case's sandbox actually carries

`probe1.ts dump` composed the exact boot argv. In `dump.log`:

```
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
```

— the row is present with **no `config`**, i.e. `providers = {}`. And:

```
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek
    model: deepseek-v4-flash
```

So the composition selects a provider the composition never registers. `ensureRegistrationFacts` sees
zero routes, never calls `registerAdapter`, and the first model call throws `NO_ADAPTER`. The machine's
real `~/.dsh/settings.yaml` is ABSENT (`environment.txt`), so nothing is copied; the machine's real
profiles are irrelevant to this boot and, in any case, carry no `deepseek` route (`dsh-tui` declares
`zai-coding-cn` + `kimi-coding`; `web` has no `llm-pi-ai` row).

## 4. Verdict

**Direct cause: (b) ENVIRONMENT GAP — this machine supplies no `llm-pi-ai` provider route named
`deepseek`, and `settings.yaml` would supply it (proven in §5).**
**(c) is ruled out.** **(a) is present as a secondary, case-side defect** — it is why the gap surfaces
as a hard FAIL instead of the declared `absent-model-route` UNAVAILABLE, and why the track's recorded
greens cannot be attributed to the pi-ai route. It is NOT the cause of `NO_ADAPTER`.

| # | Fact | Evidence |
|---|---|---|
| b-1 | `~/.dsh/settings.yaml` absent (and no `.imported`) | `environment.txt`; `ls -la ~/.dsh` |
| b-2 | No real profile declares a `deepseek` pi-ai route | `environment.txt` (`dsh-tui` = zai/kimi, `web` = none) |
| b-3 | The row is dormant by design; a settings section is the documented supplier | `dsh-base/cordis.patch.yml` row `llm-pi-ai`; `harness-rows-and-docker-live.txt` |
| b-4 | Supplying the section turns the route live and the job succeeds | §5, `live-declared-v4flash*.log` (exit 0, real answer) |
| a-0 | The recorded "deepseek" greens were never shown to use pi-ai; adjacent failures on the same track name `deepseek-official` | `evidence/dsh-qa/llm-dual-track/deepseek/2026-09-11T08-19-52.585Z/output.log`, `…/2026-09-17T01-37-15.981Z/output.log` |
| a-1 | `ok` is `exit 0 && /bash|tool/`, never a provider assertion | `dual-track-smoke.ts` symbol `runReal`; 2026-09-27 run has `hasToolEvidence:true` with `exit:1` |
| a-2 | No `PREREQ:` line, so `absent-model-route` is never emitted; suite `all` is strict → FAIL | `dual-track-smoke.ts` header; `skills/dsh-qa/SKILL.md` reason codes + marker rules; `cases.json` lane `dual-track-smoke` |
| a-3 | The overlay's model id is not the installed pi-ai catalog id: catalog = `deepseek-flash`, `deepseek-v4-pro`; overlay = `deepseek-v4-flash` | `environment.txt`; `live-defaultmodel.log` = `UNKNOWN_MODEL` |
| c-1 | The harness CAN serve it: same binary, same credential, same argv, green | §5 |
| c-2 | The credential shape is accepted: 35-char key resolved from the store's flat `DEEPSEEK_API_KEY` | probe JSON (`length: 35`, value never printed); green live arms |

## 5. Minimal change that makes the track green here (DESCRIBED, NOT APPLIED)

**No credential change is needed.** A `DEEPSEEK_API_KEY` is present in `~/.dsh/.credentials.yaml`
(flat layout, line 19, length 35) and the pi-ai adapter resolves it once the route exists.

### 5.1 Environment fix (zero repo edits) — proven

Create a `settings.yaml` that declares the route on the installed catalog provider. The case copies
`<HOME>/.dsh/settings.yaml` into its sandbox verbatim, and `SettingsForms.importLegacyDocument` imports
it into the fresh headless profile before the model call:

```yaml
llm-pi-ai:
  providers:
    deepseek:
      apiKeyEnv: DEEPSEEK_API_KEY
      models:
        - id: deepseek-v4-flash
```

`models` is required only because the installed pi-ai catalog names this model `deepseek-flash`; the
hand-declared id is accepted and api.deepseek.com serves it (green live arm below).

Where to put it:

- Preferred (no side effects on the real home): a QA-only `HOME`, e.g. `HOME=<qa-home>` containing
  `<qa-home>/.dsh/settings.yaml` (above) and a 0600 copy of `<qa-home>/.dsh/.credentials.yaml`, then
  `HOME=<qa-home> bun skills/dsh-qa/scripts/dual-track-smoke.ts`. The case derives both paths from
  `homedir()`, so it picks them up and the real `~/.dsh` is never written.
- Or `~/.dsh/settings.yaml` — but on 0.2.1 that file is a ONE-SHOT legacy import: the next real profile
  boot (tui/web) would import the section into that profile and rename the file to
  `settings.yaml.imported`. State that side effect to the user before choosing this spelling.

Proof of the content (the case's exact boot argv, same dev patch, same overlay, same credential seeding,
same cwd/job; only the sandbox `settings.yaml` differs):

| arm | staged settings | result |
|---|---|---|
| `live.log` | none | exit 1, 64 bytes: `NO_ADAPTER` |
| `live-defaultmodel.log` | route on catalog (`deepseek: {apiKeyEnv}`) but overlay model `deepseek-v4-flash` | exit 1: `UNKNOWN_MODEL: pi-ai provider "deepseek" has no configured model "deepseek-v4-flash"` |
| `live-overlay.log` | route on catalog + model switched to `deepseek-flash` | exit 0, real bash calls + answer |
| `live-declared-v4flash.log` / `…-repeat.log` | route + `models: [{id: deepseek-v4-flash}]`, overlay untouched | exit 0, real bash calls + answer (repeat: 2 × clean) |

After the green boot, `<sandbox>/profiles/headless/cordis.patch.yml` carries the imported row config
(`live-declared-v4flash-repeat.profile-patch.yml`), proving the route reached the profile patch rather
than a process environment accident. `live-official-v4flash.log` additionally shows `deepseek-official`
accepts the same stale model id (unlisted ids are accepted by the official adapter), which is consistent
with the measured `deepseek-official` failure text of the pre-NO_ADAPTER era (§7).

### 5.2 If the track must be self-contained (repo-side; DESCRIBED, NOT APPLIED)

Smallest honest repo change, in `skills/dsh-qa/scripts/dual-track-smoke.ts` symbol `runReal` plus its
header:

1. Add `// PREREQ: absent-model-route <probe> "add llm-pi-ai.providers.deepseek to ~/.dsh/settings.yaml …"`
   and probe the route positively (after copying settings, assert the document carries
   `providers:` → `deepseek:`, or boot `--dump-config` and assert the `llm-pi-ai` row has that provider).
   Emit the `[mpd-qa] SKIP|FAIL case=dual-track-smoke lane=real reason=absent-model-route …` marker as
   the FIRST stdout line, per `skills/dsh-qa/SKILL.md`.
2. Seed a track-local settings fixture into `<sandbox>/settings.yaml` when the host supplies none (e.g.
   a `tests/fixtures/llm-pi-ai-deepseek.settings.yaml` with the §5.1 content), so the lane does not
   depend on the operator's home.
3. Replace `ok = exit 0 && /bash|tool/` with an assertion that the harness session log names provider
   `deepseek` (`lib/session-evidence.ts`), i.e. prove the pi-ai route served the turn, not boot prose.
4. Either keep `deepseek-v4-flash` and declare it in the fixture's `models`, or switch the overlay to the
   installed catalog id `deepseek-flash` (then a catalog-fed route also works).

An `- id: llm-pi-ai` entry inside `tests/overlays/compat-track.yml` would also work, but it id-targets a
stock host row; the repo policy in `cordis.patch.yml` forbids that spelling for shipped patch rows, so
the fixture-settings route is the cleaner one. This is a description, not an applied change.

## 6. Sanity check: the credential and the official provider already work

- The `official` track (provider `deepseek-official`, same credential) passed on 2026-10-29 (exit 0,
  tool evidence) and on every recorded run since 2026-09-27. Its earlier failures (2026-09-11, 2026-09-17)
  are the same credential failures that hit the `deepseek` track — both tracks then resolving through
  `deepseek-official`.
- The Docker lane's credentialed run `evidence/release/v0.13.2/gates/docker-oneclick.log` records
  `live.credentialStaged=true`, `live.web.turnCompleted=true`, `live.tui.turnCompleted=true`,
  `live.headless.turnCompleted=true`. Those turns use the base `agent-default-model`
  (`provider: deepseek-official`) from `dsh-base/cordis.patch.yml`; Docker stages only
  `refs: DEEPSEEK_API_KEY`. So they prove **the credential and the official provider** work in the
  harness — they do NOT exercise provider `deepseek`.
- The decisive separation is our own arm: with the pi-ai route supplied, the **same credential** served a
  real turn through `dsh-llm-pi-ai` (exit 0, real tool calls). The credential/provider works; the QA
  case's gateway route simply does not exist on this machine.

## 7. Why the documented fallback does not fire, and the historical greens

- `AGENTS.md` §7 says a live case must copy `settings.yaml` "when present (gateway providers configure
  the chain there; otherwise headless falls back to `deepseek-official` → `MISSING_CREDENTIAL`)."
  That sentence describes the BASE composition (`agent-default-model` = `deepseek-official`). It is not
  a runtime fallback inside the model selection: `dsh-agent-default-model` does not validate catalog
  membership and has no fallback path, and the case's overlay **id-targets** `agent-default-model` to
  `provider: deepseek`, so the official route is removed from the selection. A missing route then
  reports `NO_ADAPTER` (registry miss), not `MISSING_CREDENTIAL` (key miss). That is the documented
  discrepancy.
- The case's own comment above the settings copy predicts `MISSING_CREDENTIAL`; the observed code is
  `NO_ADAPTER`. The comment is inaccurate on this harness.
- Historical greens (2026-08-26, 2026-09-16, 2026-09-17 ×2) have no provider attribution, but the
  adjacent 2026-09-11/2026-09-17 FAILURES on the same track name `llm-deepseek` and
  `provider route "deepseek-official"` — so in that era the request the overlay labelled `deepseek` was
  being served by the OFFICIAL adapter, and the greens that follow a credential fix were official-route
  passes, not pi-ai passes. A pi-ai feasibility lane two days later
  (`evidence/llm-pi-ai/20260918T053225Z/result.json`, harness 0.1.5) recorded the home's only
  `llm-pi-ai` provider as `opencode-go`, and its settings-absent arm F yielded only `deepseek-official`;
  `deepseek-v4-flash` WAS then listed under `deepseek-official`. The 2026-08-26 green ran from a
  different repo path (`oh-my-openagent/.omo/port/omo-dsh`) and keeps no boot log, so its provider is
  unknown. Conclusion: the recorded "deepseek" greens were most likely official-route passes; the old
  harness mapping that made that possible is what later became `NO_ADAPTER`.

## 8. Bounds / what remains unproven

- I did not execute the case under a QA-only `HOME`; I executed its exact boot argv with the settings
  document staged into the same sandbox the case stages (only variable: `<HOME>/.dsh/settings.yaml`,
  which the case copies verbatim). The expected green is by construction, not a recorded case run.
- The pre-NO_ADAPTER era is READ from the recorded failure text (the track's request named
  `deepseek-official`), which is measured; that the 2026-09-16/09-17 PASSES were official-route passes
  is a strong inference from that text plus the missing pi-ai route, but the passing runs themselves
  kept no session log. The 2026-08-26 green has no boot log at all.
- The 35-char key was resolved and used but never printed, echoed, or written to any artifact; only its
  length and source line are recorded.
- Out of scope, noted for the record: `runReal` sets `DSH_HOME` but leaves the child `HOME` inherited
  from the operator, so this lane does not meet AGENTS.md §7 isolation arm (b) `HOME=<sandbox>` (the
  sibling `mcp-call.ts` does set `HOME`). Unrelated to `NO_ADAPTER`; not edited.
- The one reproduction run rewrote the tracked summary `evidence/dsh-qa/llm-dual-track/dual-track.tsv`;
  it was restored byte-for-byte to HEAD, and `git diff` is empty. `git status` shows only untracked
  evidence directories.

## 9. Evidence inventory

| path (under `evidence/dsh-qa/dual-track-deepseek/2026-10-29T01-30-11Z/`) | what it shows |
|---|---|
| `probe1.ts` | the probe: same dev patch, same argv, same credential seeding; optional settings/overlay |
| `dump.log` | composed headless tree: `llm-pi-ai` row with no config; `agent-default-model` provider `deepseek` |
| `live.log` | baseline reproduction: 64-byte `NO_ADAPTER`, exit 1 |
| `live-defaultmodel.log` | route supplied from catalog + stale model → `UNKNOWN_MODEL` |
| `live-overlay.log` | route supplied + catalog model `deepseek-flash` → exit 0, real answer |
| `live-declared-v4flash.log`, `live-declared-v4flash-repeat.log` | route + declared `deepseek-v4-flash` → exit 0, real answers |
| `live-declared-v4flash-repeat.profile-patch.yml` | the imported `llm-pi-ai` row config in the sandbox's profile patch |
| `live-official-v4flash.log` | `deepseek-official` accepts the stale model id (consistent with §7's measured `deepseek-official` failure text) |
| `settings-deepseek-catalog.yaml`, `settings-deepseek-v4-flash.yaml` | the two candidate settings documents (no secrets) |
| `overlay-deepseek-flash.yml`, `overlay-official-v4flash.yml` | diagnostic-only overlays (no repo change) |
| `environment.txt` | versions, `~/.dsh` layout, settings/profile/credential presence, pi-ai catalog ids |
| `harness-rows-and-docker-live.txt` | dsh-base rows + Docker live-row citations + official `PROVIDER` |
| `source-facts.txt` | symbol excerpts: `LlmRuntime.registration`, `ensureRegistrationFacts`, `importLegacyDocument`, `PROFILE_TEMPLATES` |

Key commands (all exit codes as observed):

```
bun skills/dsh-qa/scripts/dual-track-smoke.ts                 # exit 1 (official pass, deepseek NO_ADAPTER)
bun evidence/.../probe1.ts <dir> dump                          # exit 0, dump.log 29,848 bytes
bun evidence/.../probe1.ts <dir> live                          # harness exit 1, NO_ADAPTER
bun evidence/.../probe1.ts <dir> live-overlay <settings> <overlay>       # harness exit 0
bun evidence/.../probe1.ts <dir> live-declared-v4flash <settings>        # harness exit 0
git status --porcelain | grep -v '^??'                         # empty (no tracked file modified)
```
