# t41 — Web settings card for the `mpd` namespace

Task t41 (Senior Engineer), attempt 2, attempt_id `d55d4d15-91eb-4db6-8306-28c6360f0986`.
The user's requirement, verbatim: **"这套配置想办法以选项卡的形式做到 web 的『设置』里，可以参考其他的插件怎么做进去的"**.

## 1. What was built

| Item | File |
|---|---|
| The card module (registration + controller + component + dictionaries) | `packages/mpd-bundle-plugin/src/settings-card.js` |
| The single call site + the locale registration | `packages/mpd-bundle-plugin/src/web-client.js` |
| The embedded client module (one line pair) | `scripts/build-mpd-client.mjs` |
| The card's own tests | `packages/mpd-bundle-plugin/test/settings-card.test.mjs` |
| The rebuilt bundle client | `packages/mpd-bundle-plugin/client.js` |
| The shared field/schema descriptor both front doors read | `packages/mpd-config-plugin/src/settings-schema.ts` (t39's package; the card MIRRORS it and a test asserts parity) |

The card was implemented in the round that followed the captain's `c3c709c0` reversal (the revert that
preceded it was the correct execution of the then-current instruction); this task verifies it against the
canonical pattern, documents it, and adds the evidence the contract asks for. Nothing outside
`packages/mpd-bundle-plugin/`, `scripts/build-mpd-client.mjs` and `evidence/mpd-bridge/web-card/` was
written for t41.

## 2. The canonical pattern, measured (not paraphrased)

Read from `@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js`:

* the Plugins settings surface is a **section with tabs**; the tablist comes from the slot
  `settings.plugins.tab` (entries carry `options.id`/`options.order`/`options.label`), and each tab's
  panel renders its own keyed contribution;
* the host's own tab is `id: "configurable"`, whose panel renders
  `renderSlot("settings.plugin.item", {}, { entryKey: ns })` for every **served settings namespace**
  (`ConfigurablePluginsTabController.publish` dispatches `entry.options.key` only when the host also
  serves that namespace) — which is exactly why the six `mpd` knobs were invisible in the Web GUI
  before this card existed;
* the host's four cards (`BashCard`, `AgentLoopCard`, `SubagentModelSelectionCard`, `WebSearchCard`)
  register as `ctx.slots.inject("settings.plugin.item", function* () { yield ctx.slots.register({ name,
  key: <ns>, locale: <dict ns>, inject: () => <controller>.inject() }, <Card>) })` (`:1785-1810`), and
  each card is a plain React function component receiving
  `{ t, save, discard, edit(field, text), resetField(field), use<X>Card(selector) }` with
  `state.writable` gating the inputs (`BashCard`, `:329-367`);
* `PluginCard`/`ValueField` are that package's **private** components — they are NOT imported; our card
  is self-contained markup.

Our card mirrors all four points; `settings-card.test.mjs` asserts the registration SHAPE
(`ctx.slots.register({ name: SLOT, key: NS, locale: LOCALE_NS, inject: () => controller.inject() }, Card)`),
that the mount is deferred, and that the client's declared dependencies stay `["slots", "locale"]`.

## 3. Acceptance, criterion by criterion

1. **Canonical mechanism** — registered into `settings.plugin.item` with `key: "mpd"` from the bundle's
   own client. No new sidebar tab, no route, no page, no private-component import (asserted in
   `settings-card.test.mjs`: the slot/namespace constants, the absence of any `PluginCard`/`ValueField`
   import, and the single `require("@mpd-dsh/settings-card")` site).
2. **Self-contained component + the public seam** — the component renders our own markup and reads
   through `props.useMpdCard(...)` from the controller's store; every write goes through
   `scope.mutate(ops, revision)` on `ctx.settingsScope.bind({ namespace: "mpd" })`. Nested paths are
   why `mutate` — not `set(field, …)`, which is top-level-only on this host — is the member of the
   public surface the six knobs need; `resetField` sends `{op:'unset', path}` through the same call.
   Tests: an edit produces `[{op:'set',path:["hashline","maxDiffChars"],value:4096}]` with the revision
   fence from `getSnapshot()`; `resetField` produces `[{op:'unset',path:["ulw","maxRounds"]}]`; an
   invalid draft carries NO write; a read-only snapshot does not attempt a write at all.
3. **Deferred mount** — `ctx.inject(["settingsScope"], …)`; absence logs exactly one warning and the
   page still mounts. `bun skills/dsh-qa/scripts/web-client-adapt.mjs --self-test` → **ok: 14 checks**
   (it asserts the stable-dependency rule and the deferred-inject shape against the built client).
4. **Rebuild + automated W2 assertion + sidebar unaffected** — rebuilt with
   `node scripts/build-mpd-client.mjs`; the artifact is **282453 bytes** (the builder's own
   `out.length` reports 277939 UTF-16 code units; the byte count is 282453) with sha256
   **`dd9c88933a31627739eb04d0ad46208499ab4a5eb8a415f209477d30c9d999b7`**. The built bundle contains
   the registration (automated: `settings-card.test.mjs` W2 block + the lane's W2a-W2e), and the
   previously verified sidebar behaviour is intact — `bun test packages/mpd-bundle-plugin` **68 pass /
   0 fail**, `node skills/dsh-qa/scripts/agent-teams-sidebar.mjs --self-test` **ok: 17 checks**
   (its module list now includes `@mpd-dsh/settings-card` alongside the sidebar page).
5. **The card's own tests run in the package suite** — `packages/mpd-bundle-plugin/test/settings-card.test.mjs`
   (12 tests) is part of `bun test packages/mpd-bundle-plugin`: registration shape, deferred mount,
   render of the six fields, the write path with paths + revision, invalid-draft refusal, read-only
   honesty, isolation rules, and field parity with the shared descriptor.
6. **Evidence level, plainly, with repro steps** — see §4.
7. **Re-runnable write-path proof + no forbidden writes** — `bun skills/dsh-qa/scripts/web-settings-bridge.mjs`
   (real boot, authenticated `settings/mutate`, W1-W13 incl. the file-derived base, two negative
   controls; its sibling `bun skills/dsh-qa/scripts/tui-settings-bridge.mjs` covers the TUI bytes).
   t41 wrote nothing in `docs/`, `skills/`, `VENDOR_LOCK.json` or `package.json`.

## 4. Evidence level — what is witnessed and what is NOT

**Witnessed here:**
* the registration contract in the **built and served** client bytes (automated assertion, plus the
  lane's W2a-W2e re-hashing the artifact it judged);
* the card module's behaviour in the **offline hook harness**: renders the six fields, drives the scope
  write with the right path/value/revision, refuses an invalid draft, renders read-only with the reason;
* the **write path end to end** through the host's own authenticated API (`web-settings-bridge.mjs`):
  namespace → bridge → `<workspace>/.mpd/mpd.jsonc` with comments intact → the resolved value changed.

**NOT witnessed in this environment (recorded as NOT-CLAIMED):**
* a real BROWSER rendering the card, the host dispatching this key in a live page, and a click-driven
  save. No browser binary exists here. The lane records this as `cardClaim.W3.witnessed === false` with
  the reason, and this report repeats it rather than implying otherwise.

**Human repro steps (a person at their own GUI):**
1. Install/point the profile at this checkout (`dsh plugin --profile web add <repo>`) and start it
   (`dsh --profile web`), then open the printed `http://127.0.0.1:<port>/?token=…` URL.
2. Open **Settings → Plugins** and select the **Plugin configuration** tab (the host's own
   `configurable` tab). Its panel dispatches `settings.plugin.item` per served namespace, so a card
   titled **MPD bundle** appears for namespace `mpd` — six fields: inline diff limit, comment checker,
   ultrawork rounds, memory backend, team state directory, boulder directory.
3. Edit a field and press **Save** (the button is disabled when a draft is invalid or nothing is
   dirty). The card sends `settings/mutate` for namespace `mpd`; the bridge writes the value into the
   live session workspace's `.mpd/mpd.jsonc` and reports per root — or refuses loudly with
   `no-live-session` / `ambiguous-multi-root` and says the value is never lost.
4. Consistency check: with exactly one session open, `grep maxDiffChars <workspace>/.mpd/mpd.jsonc`
   shows the saved value and the surrounding comments are untouched. On a **non-loopback** page the card
   renders read-only with its reason (the host keeps that page's writes in memory only).

## 5. Commands (exact, re-runnable)

```
bun run typecheck                                             # exit 0
bun test packages/mpd-bundle-plugin                            # 68 pass / 0 fail / 8 files
node scripts/build-mpd-client.mjs                              # rebuilds client.js (deterministic)
sha256sum packages/mpd-bundle-plugin/client.js                 # dd9c8893… ; 282453 bytes
node skills/dsh-qa/scripts/agent-teams-sidebar.mjs --self-test # ok: 17 checks
bun skills/dsh-qa/scripts/web-client-adapt.mjs --self-test     # ok: 14 checks
bun skills/dsh-qa/scripts/web-settings-bridge.mjs              # the write path, real boot (W1-W13)
bun skills/dsh-qa/scripts/tui-settings-bridge.mjs              # the TUI bytes (T1-T8)
```

Raw outputs: `verify-output.log` in this directory. Machine-readable summary: `result.json`.

## 6. Named follow-up (not t41's scope)

The `mpd-config` row in `packages/mpd-bundle/cordis.patch.yml` still mounts at line 216, before the
settings provider is reliably up and before `mpd-tui` (line 300). The code works around it (deferred
registration + the deterministic owner check, t39), but moving the row remains a patch change for the
captain.
