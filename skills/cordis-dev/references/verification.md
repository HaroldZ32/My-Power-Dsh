# What counts as proof

Installation, registration and "it ran" are not verification. The standard is: **the change was
exercised, and the evidence comes from a source that cannot be produced by narration.**

## The evidence ladder (strongest first)

1. **A real call recorded by the harness.** The session log (`<DSH_HOME>/sessions/<projectKey>/<id>/`,
   a CONCATENATED-ZSTD-FRAME container — decode frame by frame) holds `tool/call.data.name` plus a
   non-error `tool/result`. Asserting a tool NAME against the model's ANSWER is wrong in both
   directions: a run can call the tool without naming it, and name it without calling it.
2. **A mount boot with registration instrumentation** in an isolated `DSH_HOME`: the rows activate,
   the tools register, the route answers, the schema accepts. `--dump-config` is NOT this — it
   composes rows and never executes plugin code.
3. **A deterministic artifact assertion:** a committed `dist` rebuilt byte-identically, a hash, a
   file whose content the change must produce, a `--self-test` with a negative control that reddens.
4. **A read of the source.** Necessary for orientation, never sufficient for a behaviour claim.

## Isolation is three things, not one

- `DSH_HOME=<sandbox>` (credentials copied ONCE into it; the real `~/.dsh` never read or written).
- `HOME=<sandbox>` (skill roots leak through HOME; the workmate library lives under the real home).
- a SANDBOXED WORKSPACE: every `dsh` spawn and `session/create` payload carries an explicit sandbox
  cwd, and each live case asserts no session key for the real cwd exists. Without it an "isolated"
  boot writes the real `<repo>/.mpd/**` and `.codegraph`.

Live-LLM cases must also copy `settings.yaml` when present, or a gateway-backed route degrades to the
base provider and fails with `MISSING_CREDENTIAL`.

## Verification limits — state them, never paper over them

- **No browser control**: a UI plugin's honest proof is JavaScript syntax, manifest validation and the
  LIVE slot registration. Do not launch a separate browser, change `HOME`, inspect personal profiles,
  search for tokens, alter keychains, or hunt for a rasterizer to manufacture a screenshot; a
  screenshot of a mock page is not verification of the running plugin.
- **A skipped step is not a pass.** A Docker lane that printed a NOTICE and exited 0 (rootless absent,
  daemon absent) carries nothing; the steps above it carry the wave. Use `--require-docker` when a
  skip must be loud.
- **Verify settled hashes.** Pin the revision by hash, re-check it after a settle window, run the
  contract, and quote each hash WITH the UTC instant it was read — so "settled" is distinguishable
  from "another writer edited the file while I sampled".
- Clean up test subprocesses and temporary resources with a unique owned directory and bounded
  execution; a failed optional preview must not turn into environment repair.
- Report the limitation and the residual risk in the same message as the result.
