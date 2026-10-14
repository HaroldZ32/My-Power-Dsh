// VENDORED SHIM — G4 (defect wave 2026-10-06, branch `fix/surfaces-config`).
//
// `check-no-excuse-rules.ts` is written against the TypeScript 7 API surface published
// under the `typescript/unstable/*` subpaths, and it loads that API from the CALLER
// project at runtime (`createRequire(process.cwd())`), never from a static import.
// Its declarations must still resolve for the ROOT type program, because
// `tsconfig.json` includes `skills/*/scripts/**/*.ts`.
//
// THIS repository deliberately does not install a package NAMED `typescript`: its
// TypeScript 5 alias is `typescript5`, precisely so nothing shadows the caller's
// TypeScript 7 (see CHANGELOG "A canonical TypeScript plugin"). The TypeScript 7
// toolchain it DOES install is `@typescript/native-preview` — the package behind
// `node_modules/.bin/tsgo`, which is what `bun run typecheck` runs — and that package
// publishes the very same API under its own `unstable/*` subpaths.
//
// So the two specifiers the script names are mapped here onto the INSTALLED
// toolchain, and nothing else about the script's contract changes: at runtime the
// caller's `typescript` is still tried FIRST (a project whose `typescript` really is
// the TS 7 preview uses its own), and `@typescript/native-preview` is the declared
// fallback. This file is a TYPE-ONLY mapping — it emits nothing, changes no runtime
// resolution, and is NOT copied into any consumer project (the skill's script is).
//
// A refresh of the vendored `skills/programming` corpus from upstream drops this file
// and re-reddens `bun run typecheck`; re-apply it with the corpus, and keep the
// `VENDOR_LOCK.json` re-pin in the same commit (AGENTS.md §9).
declare module "typescript/unstable/ast" {
  export * from "@typescript/native-preview/unstable/ast"
}

declare module "typescript/unstable/async" {
  export * from "@typescript/native-preview/unstable/async"
}
