// Pins the TUI language for the test PROCESS, so an assertion about user-visible copy does not
// depend on the machine's locale.
//
// WHY A PIN IS NEEDED AT ALL: R4 routes every string that has no localized host field through
// `src/i18n.ts`, which resolves the language from the host's own chain
// (`DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → `LC_ALL`/`LC_MESSAGES`/`LANG` → zh). That makes the
// rendered copy a function of the ENVIRONMENT, and the measured default of a bare machine — no
// locale variables at all — is `zh` (the host's own default). Without a pin, the pre-existing
// English assertions in this package would pass on a developer box with `LANG=en_US.UTF-8` and
// fail in a CI sandbox, which is exactly the flakiness the host's `C.UTF-8 ⇒ en` rule exists to
// prevent.
//
// WHAT IS PINNED, AND WHAT IS NOT: only `DSH_TUI_LANG` — step 1 of the chain, the value the host
// documents as "pinned at process start", which is what a repro script is expected to set. The
// resolution logic itself is NOT under test here: `test/model-menu.test.ts` drives all four
// precedence steps with explicit inputs, including the `C.UTF-8 ⇒ en` case.
//
// A CALLER THAT NEEDS ANOTHER LANGUAGE overrides the variable, e.g.
// `DSH_TUI_LANG=zh bun test packages/mpd-tui-plugin`.
if (process.env.DSH_TUI_LANG === undefined) process.env.DSH_TUI_LANG = "en"
