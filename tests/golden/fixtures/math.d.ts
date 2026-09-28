// Type declaration for the INTENTIONAL golden fixture `math.js` (the seeded-bug fixture the
// benchmark grades). The declaration exists so the TypeScript runner beside it type-checks without
// an `@ts-expect-error`: `math.js` itself stays plain JavaScript ON PURPOSE — AGENTS.md §6 names
// `tests/golden/fixtures/*.js` as fixture DATA, and the seeded defect lives in `add`'s BODY, which
// this surface deliberately does not describe.

/** Adds two numbers. The JavaScript body ships an INTENTIONAL seeded bug (`a - b`) to be graded. */
export function add(a: number, b: number): number

/** Multiplies two numbers; the control beside the seeded defect. */
export function mul(a: number, b: number): number
