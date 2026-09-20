# Loader-evaluator probes for the sidebar guard (captain-measured)

Method: a real web boot in an isolated sandbox (`DSH_HOME`/`HOME`/workspace all inside the repo),
with extra patch layers passed as `--patch <file>`. Each probe row is force-disabled and its `!!js`
body only reports through `console.warn`, so the probes never mount anything. Booted with

    dsh --profile web --patch <probe>.yml --port <p> --no-open    # stdio to a FILE, never a pipe

## Measured facts (each one decides a clause of the guard)

| Question | Measurement | Consequence for the guard |
|---|---|---|
| What is the `!!js` scope? | `new Function("ctx","expr","with (ctx) { return eval(expr) }")` (cordis-plugin-loader) | `ctx.*` and ctx properties are in scope |
| Are Node builtins reachable? | `process` = object; `require`/`createRequire` = **undefined**; **`process.getBuiltinModule` = function**, and `('node:fs')`/`('node:path')` return the modules (probe4) | the guard can read `<profile>/package.json` and test paths |
| Can the profile manifest be read? | probe4: `baseUrl` → `new URL('.', baseUrl).pathname` = the profile dir; `package.json` read OK; `dsh.profile.bundles` and `dependencies` parsed OK | the guard can detect a declared sidebar layer and a resolvable package WITHOUT depending on row order |
| Is an unresolvable row fatal? | dsh-app-boot `assertEntriesLoaded` throws `plugin(s) failed to load: <names>`; a DISABLED row named `dsh-better-sidebar` (package absent) was created and evaluated with **no error** (probe3 `PROBE3-FAKE evaluated`) | a disabled row never resolves; the guard must disable itself when the package is absent |
| Is a pending row fatal? | `assertEntriesActivated` throws for an enabled PENDING entry | the row must be disabled where webServer/webRuntime do not exist (dsh-tui) |
| Which entries exist at evaluation time? | probe3: FIRST evaluation of an early row saw **neither** a later row of its own layer **nor** a row from a later `--patch` layer (179 entries); the SAME expression was re-evaluated later with 184/185 entries visible | the first evaluation is FORWARD-BLIND; `Entry.refresh()` returns early once `fiber` exists, so the first decision stands — an entries-only guard is order-DEPENDENT |
| Is a web-plane marker available? | probe2 (web): `webserver\|@deepseek-ai/dsh-host-webserver`, `web-runtime\|@deepseek-ai/dsh-web-app`, `web-startup\|…/startup`, `agent-presets\|@deepseek-ai/dsh-agent-presets` all present; the repo's own TUI dump has none of them | `@deepseek-ai/dsh-host-webserver` is the recommended discriminator |
| Can services be used as the discriminator? | probe1: `ctx.get('webServer')` and `ctx.get('sessions')` are **false** at evaluation time | no — services are unresolved during tree construction |
| Is `ctx.loader.internal.resolveSync` usable? | probe1 and probe2: **all six call shapes threw** (arity 2; `#defaultConditions` private-field error, `Invalid URL`, `Cannot find package 'undefined'`); `typeof internal.import` = function but async | resolvability must be probed with `fs`, not with the loader |
| Is reading another row's evaluated `.disabled` safe? | probe1: the expression that read `e.disabled` for every entry printed **nothing** — mutual recursion with the other probe rows (stack overflow). Replace `e.disabled` by the raw `e.options.disabled !== true` and it works (probe3) | the guard must never read the evaluated getter of a row that itself carries a `!!js` disabled |

## Structural facts the guard relies on (read, not probed)

- `dsh plugin --profile <p> add <spec>` = pnpm forwarder + `reconcilePlugins` over the PROFILE manifest's own `dependencies` only → a bundle's dependency never joins `dsh.profile.bundles`.
- `@deepseek-ai/dsh-app-boot#healProfileModuleFallback` symlinks the dependency closure of every non-installation bundle layer into `<profile>/node_modules` → a DECLARED dependency of the bundle becomes resolvable at the profile root.
- `@deepseek-ai/dsh-client-modules` discovers a plugin's web client from LOADER ENTRIES (`dsh.client` + `exports["./client"]`) → one row named `dsh-better-sidebar` delivers both halves.
- `dsh-better-sidebar@0.19.0-alpha.1` injects `['webServer','sessions','webRuntime','tools']` and registers `/sidebar/api` through `ctx.webServer.register`; its browser half is reached only through the runtime `betterSidebar` service.

## Ordering fact that makes the fs-resolvability clause valid

`composeProfile` (dsh CLI lib/profile-boot-Dk-7KqJc.js) runs, in this order:

1. `prepareProfile` → `loadProfile` (resolves every `dsh.profile.bundles` entry to a package dir),
2. **`healProfilesModuleFallback({ installAnchor, profile })`** → symlinks the dependency closure of
   every non-installation bundle layer into `<profile>/node_modules`,
3. patch composition (bundle layers, profile layer, home layer, `--patch` overlays),
4. `boot(...)` → the Loader builds the tree and evaluates the `!!js` `disabled` expressions.

So when a guard reads `<profile>/node_modules/dsh-better-sidebar`, the healer has ALREADY run: the
path exists exactly when the package is resolvable from the bundle's own manifest anchor (the packed
install resolves it through pnpm; a checkout install resolves it through the repository's
`node_modules`). A missing package therefore disables the row instead of failing the boot.
