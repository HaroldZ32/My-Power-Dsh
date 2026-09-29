// INTENTIONAL golden fixture: math.ts deliberately ships `add(a,b){return a-b}`
// (a seeded bug) so benchmark runs can grade whether a model detects/reports it.
// This file is NOT auto-discovered by `bun test` (renamed away from *.test.mjs);
// run it explicitly (RED expected): `bun tests/golden/fixtures/math.bench.ts`.
// The gate `bun run test` runs `bun test packages` and never scans tests/golden.
import { add, mul } from "./math.ts"

/** The bench's verdict primitive: print FAIL and exit 1 on a mismatch, otherwise stay silent. */
const ok = (condition: boolean): void => { if (!condition) { console.error("FAIL"); process.exit(1) } }
ok(add(2, 3) === 5)
ok(mul(4, 5) === 20)
console.log("ALL OK")
