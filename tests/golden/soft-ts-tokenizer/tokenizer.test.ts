import { test, expect } from "bun:test"
import { tokenize, type Token } from "./tokenizer.ts"

function types(t: Token[]): string[] { return t.map((x) => x.type) }

test("numbers and operations", () => {
  const t = tokenize("12 + 3.5*2")
  expect(types(t)).toEqual(["num", "op", "num", "op", "num"])
  expect(t.map((x) => x.value)).toEqual(["12", "+", "3.5", "*", "2"])
})
test("identifiers and parens", () => {
  const t = tokenize("foo(a , b)")
  expect(types(t)).toEqual(["ident", "lparen", "ident", "op", "ident", "rparen"])
})
test("string escapes", () => {
  const t = tokenize('"a\\"b\\n"')
  expect(t[0]).toEqual({ type: "string", value: '"a\\"b\\n"', pos: 0 })
})
test("comparison and logic ops", () => {
  const t = tokenize("a <= b && c != d")
  expect(types(t)).toEqual(["ident", "op", "ident", "op", "ident", "op", "ident"])
  expect(t.map((x) => x.value)).toEqual(["a", "<=", "b", "&&", "c", "!=", "d"])
})
test("positions are absolute", () => {
  const t = tokenize("  ab")
  expect(t[0].pos).toBe(2)
})
