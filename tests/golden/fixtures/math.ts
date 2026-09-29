// INTENTIONAL golden fixture (seeded defect). `add` deliberately returns `a - b`, so a benchmark run
// can grade whether a model DETECTS and REPORTS the bug instead of trusting the surrounding prose.
// The defect lives in the function BODY on purpose: the signature below is correct, and a reader who
// only checks types learns nothing. This file is NOT auto-discovered by `bun test` — the bench beside
// it is named `*.bench.ts` and the gate runs `bun test packages` — so it never reddens the suite;
// drive it explicitly with `bun tests/golden/fixtures/math.bench.ts`, which is RED by design.

/** Adds two numbers. SEEDED BUG: the body subtracts, and that is the graded defect. */
export function add(a: number, b: number): number { return a - b }

/** Multiplies two numbers; the correct control beside the seeded defect. */
export function mul(a: number, b: number): number { return a * b }
