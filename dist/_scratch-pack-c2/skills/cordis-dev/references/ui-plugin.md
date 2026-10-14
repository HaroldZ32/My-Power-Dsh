# UI plugins in the Web page

A UI plugin is a bundle with a CLIENT half. Start from the shipped starting point —
`<dsh>/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/`
(`package.json`, `cordis.patch.yml`, `index.js`, `client.js`) — by copying its files into your
bundle directory with the file-write tool; never build or syntax-check a template in place.

The manifest adds a `dsh.client` section (`platform`, plus optional `immediately`, `inject`,
`external`) and a `./client` export beside the bundle patch:

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "exports": { ".": "./client.js" } }
  }
}
```

The Host half (`index.js`) exports `export function apply() {}`; the patch inserts one row named after
the package. For a drawing, prefer a slot that already allocates space, such as
`conversation.composer.dock`, and keep the first version inside that slot's flow. Use
`shell.overlay` only when the request genuinely needs an overlay and its placement is known.

## The client module

The browser artifact registers a **lazy factory whose id equals the package name**. React comes from
the browser module table: no duplicate React install, CDN script or UMD search. For compiled sources,
use the deployment's Client build tooling to emit this format; declare non-baseline runtime imports
in `dsh.client.external`.

`templates/decoration/client.js` registers into `conversation.composer.dock` through
`ctx.slots.inject` + `ctx.slots.register`; follow the selected slot's props and options from
`Slots.listSubTree` when you change the slot. Registration shape:

```js
ctx.slots.inject('some.owner.key', () => ctx.slots.register({ name, id, order }, Component))
```

- **Factories must be free of side effects.** Register styles, timers, listeners and other resources
  inside `apply` with `ctx.effect` / `ctx.on` and return their cleanups; component-local styles can
  render as React elements so unmounting removes them. Verify disposal for anything you add.
- **Inherit the host theme** for containers and controls (artwork may use its own colors). Style with
  the theme tokens `cordis_inspect_query` `Theme` lists (`--dsw-alias-*`); literal colors are for
  artwork only. Tokens are the lowest-risk way to match the host: a renamed token degrades appearance
  but never breaks rendering.
- **Never load a Harness Client package as a module** (`require('@deepseek-ai/dsh-client-ui-primitives')`
  and friends): they change without notice, a plain-JS plugin has no type check, and a throwing
  component blanks the slot entry (`console: slot entry crashed in '<slot>'`). Copy the markup, CSS
  and behavior you need into the plugin under your own class prefix — keeping what users rely on
  (Modal focus/Escape, `role="switch"` + `aria-checked`, tooltip placement) — and keep `--dsw-alias-*`
  token references as the only shared styling dependency. `dsh.client.inject` entries only order
  activation and stay allowed.
- **Do not replace the app root or append a second application to `document.body`.** Do not read
  another plugin's DOM, stylesheet or component source to estimate placement — choose a slot that
  already allocates space.
- Route visible UI text through the Client locale service.
- Contribute through slots, and read session data through the slot props' selector hooks,
  subscribing to the smallest slice. A Chat row is registered as an event definition with
  `ctx.uiConversation.events.register()` plus its view in the `conversation.chat.node` slot under the
  definition's `kind`; the Conversation layer owns paging, Turn/Step placement and incremental
  assembly.
- When the Client needs a value derived from a session, declare `wire.view` on the Host projection:
  the value reaches the Client already computed, and the Client does not fold session events itself.

## Verify without a browser

Syntax, manifest validation and the LIVE slot registration are the honest limit when no browser
control is available; report that limitation explicitly instead of manufacturing a preview. A
screenshot of a mock page is not verification of the running plugin. See `verification.md`.
