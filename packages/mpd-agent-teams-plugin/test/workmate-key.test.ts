import { test, expect } from "bun:test"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { workmateKey } from "../lib/members.ts"

// The member-name → workmate directory key must stay byte-for-byte identical to
// mpd-workmate-plugin's `sanitizeName`, otherwise multi-word members (e.g.
// "Deep Worker") never resolve the directory the workmate library creates.
test("workmateKey maps the five multi-word roster members to kebab keys", () => {
  expect(workmateKey("Deep Worker")).toBe("deep-worker")
  expect(workmateKey("Senior Engineer")).toBe("senior-engineer")
  expect(workmateKey("Plan Reviewer")).toBe("plan-reviewer")
  expect(workmateKey("Vision Analyst")).toBe("vision-analyst")
  expect(workmateKey("Junior Engineer")).toBe("junior-engineer")
})

test("workmateKey mirrors sanitizeName edge cases", () => {
  expect(workmateKey("  Alice Cooper  ")).toBe("alice-cooper")
  expect(workmateKey("Alice_Cooper")).toBe("alice_cooper")
  expect(workmateKey("Foo__Bar")).toBe("foo__bar")
  expect(workmateKey("A--B")).toBe("a-b")
  expect(workmateKey("")).toBe("")
  expect(workmateKey("   ")).toBe("")
})
