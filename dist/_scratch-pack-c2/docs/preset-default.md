# Making the `mpd` preset the default

[中文](./preset-default.zh-CN.md)

This page explains where the **deployment default agent preset** lives, why this bundle cannot set it
for you, and the exact steps that do — for a dsh-tui profile and for a web/headless one. Read it if a
new session no longer starts on the `mpd` preset after upgrading this bundle.

## The deployment default is a host-owned row

The default preset is `config.default` on **one row of the host**, `@deepseek-ai/dsh-agent-preset-registry`.
Two host layers declare it, each in its own composition:

| Composition | Row id | Declared by | Out-of-the-box default |
|---|---|---|---|
| web / headless | `agent-preset-registry` | `@deepseek-ai/dsh-web-app`'s own `cordis.patch.yml` | `standard` |
| dsh-tui | `dsh-tui-agent-preset-registry` | `@deepseek-harness-tui/dsh-tui`'s own `cordis.patch.yml` | `standard` |

This bundle **ships the `mpd` preset additively** — the `preset-mpd` row in
[`presets/mpd.patch.yml`](../presets/mpd.patch.yml), listed as the second layer of the manifest's
`dsh.bundle.patch` — so after installing the bundle `mpd` is **available** in both compositions but
**not** the default.

The bundle deliberately does **not** overwrite those rows (strict zero-override, see
[`cordis.patch.yml`](../cordis.patch.yml)). Two facts make that the only correct behaviour:

1. An **id-target on a host row replaces a host decision**. A shipped row may add a capability; it may
   not silently take over a choice that belongs to the deployment, which is what the two removed
   id-targets did.
2. Adding a **second registry row does not work either**, and this is measured rather than assumed: two
   rows mounting `@deepseek-ai/dsh-agent-preset-registry` both provide the `agentPresets` service, and
   the second one fails to mount with
   `Error: service "agentPresets" has been registered at <AgentPresetRegistry>` (measured in an
   isolated sandbox with exactly such an additive row). The composition survives, but the extra row
   never activates — so it is no route to changing the deployment default. The default is therefore
   yours to set through one of the supported channels below.

## Making `mpd` the default

### Option 1 — dsh-tui: `/preset mpd`

Run `/preset` inside dsh-tui and pick **MPD (Main Working Agent)**. The TUI persists your choice to
`~/.dsh-tui/agent-preset.json`, so it survives restarts. This is the intended interactive path and it
edits nothing by hand.

### Option 2 — dsh-tui: `DSH_TUI_PRESET=mpd`

In **your own** profile patch (`<DSH_HOME>/profiles/<profile>/cordis.patch.yml`), the TUI host row
accepts an explicit preset:

```yaml
- id: dsh-tui
  name: "@deepseek-harness-tui/dsh-tui"
  config:
    preset: mpd
```

`DSH_TUI_PRESET` read from the environment is the equivalent one-liner (`preset: !!js process.env.DSH_TUI_PRESET ?? undefined`),
and it **wins over** the persisted preference file. Prefer this when a whole profile must be pinned,
for example in a container image.

### Option 3 — web and headless: the Settings `selectedDefault`

In the web UI, open **Settings → Agent preset** and pick `mpd`. That writes the `selectedDefault`
**volatile field of the `agent-preset-registry` entry**, which the registry resolves for new sessions
in preference to the deployment `default`. No file is edited and no host row is overridden. There is no
preference file for this plane — the field is the channel.

### Option 4 — the one-command helper

```
node scripts/set-default-preset.ts                 # dry run: prints the resolved path and the bytes
node scripts/set-default-preset.ts --yes           # applies it (writes ~/.dsh-tui/agent-preset.json)
node scripts/set-default-preset.ts --profile web   # web/headless: prints the Settings steps, writes nothing
node scripts/set-default-preset.ts --home /tmp/qa  # sandbox HOME for QA
```

The helper is **dry-run by default** and always prints the resolved absolute path first; `--yes` is
required to write. For a dsh-tui profile it writes exactly the bytes dsh-tui's own writer produces. For
a web/headless profile it writes nothing and prints the Settings and `DSH_TUI_PRESET` paths instead.
`--home` and `--dsh-home` point it at a sandbox; the real `~/.dsh-tui` is only written when the
resolved target **is** the real one **and** `--yes` was passed.

## The exact file format

`~/.dsh-tui/agent-preset.json` holds one key. This is byte-for-byte what dsh-tui's own
`writePresetPref` writes — two-space JSON, **no trailing newline**:

```json
{
  "preset": "mpd"
}
```

An id outside dsh-tui's own boundary (`^[a-z0-9][a-z0-9-]*$`) is ignored by its reader, so the helper
refuses such an id instead of writing a file that would be silently dropped.

## What changes for an existing user

If you installed an earlier version of this bundle, its two id-targets used to make `mpd` the default
for you. They are gone, which means:

- **Your default stops being `mpd`** until you run one of the four options above. The bundle still
  ships the `mpd` preset; it is simply opt-in now.
- In a **dsh-tui** profile the fallback is the host default `standard`, and dsh-tui ships no such
  preset row. MEASURED: the session still starts, and its own record reads `agentPreset: "standard"`,
  but it composes WITHOUT the `mpd` preset — no mpd persona, instructions or tool rows are applied.
  The resolution path is read from the source, not observed: the registry answers
  `agent-preset/not-found` (`Unknown agent preset: standard`) for an id it has no record for, and the
  TUI composes anyway. That warning was NOT captured — it appeared nowhere on the terminal byte stream
  of four sandbox boots (a stream that merges stdout and stderr), and no file under the profile's home
  carries it. Options 1 and 2 close this in one step.
- In a **web/headless** profile the fallback is whatever `default` your profile already had, usually
  `standard`, which that plane does ship.
- Nothing else is lost: no capability moved, no row disappeared, and a session explicitly asking for
  `agentPreset: mpd` keeps working exactly as before.

## Verifying that the default is set

Two repo gates cover the policy and the mount:

```
node scripts/verify-no-host-override.ts            # fails if any shipped patch row id-targets a host row
node scripts/verify-no-host-override.ts --self-test
node skills/dsh-qa/scripts/preset-conformance.ts  # the `mpd` preset really mounts on the installed harness
```

Both ship `--self-test` arms with negative controls, so a green run is falsifiable. To confirm the
user-side channel end to end, run the helper with `--home <sandbox>` and start a dsh-tui session with
`HOME=<sandbox>`: the session resolves `mpd` from the file the helper wrote.

Back to the documentation hub: [`docs/index.md`](./index.md).
