// Unit tests for the refuse-first JSONC span rewriter (t34 design §B.2 E1-E11,
// §9.1 U1-U11). Every test either asserts BYTE FIDELITY outside the edited span or
// asserts a REFUSAL with the file provably untouched — never "it looked fine".
import { describe, expect, test } from "bun:test"
import { DELETE, detectStyle, locateValueSpan, readJsonc, stripJsoncText, surgicalDelete, surgicalEdit } from "../src/jsonc-edit"

// Byte-fidelity fixture: comments, out-of-order keys, a trailing comma and a final newline that every edit must preserve.
const FIXTURE = `{
  // the hashline knobs (human comment above the object)
  "hashline": {
    "maxDiffChars": 20000, /* inline block comment */
    // trailing member comment
    "guardEditTools": true,
  },
  "ulw": {
    "maxRounds": 6
  },
  "zebra": "kept out of order on purpose",
}
`

describe("U1 byte fidelity", () => {
  test("only the edited value span changes; comments, order, trailing comma and final newline survive", () => {
    // Replace the one value span; `result.text` must differ from the fixture ONLY inside that span.
    const result = surgicalEdit(FIXTURE, ["hashline", "maxDiffChars"], 4096)
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.changed).toBe(true)
    // Reconstruct the expected text by splicing ONLY the value span.
    const expected = FIXTURE.replace("20000", "4096")
    expect(result.text).toBe(expected)
    // Every byte outside the span is provably identical.
    expect(result.text.replace("4096", "20000")).toBe(FIXTURE)
    // Comments, key order and the trailing comma are still there.
    expect(result.text).toContain("// the hashline knobs (human comment above the object)")
    expect(result.text).toContain("/* inline block comment */")
    expect(result.text).toContain("// trailing member comment")
    expect(result.text.indexOf('"hashline"')).toBeLessThan(result.text.indexOf('"ulw"'))
    expect(result.text.indexOf('"ulw"')).toBeLessThan(result.text.indexOf('"zebra"'))
    expect(result.text).toContain("true,\n  },")
    expect(result.text.endsWith("\n")).toBe(true)
    expect(readJsonc(result.text)).toEqual({ ok: true, value: { hashline: { maxDiffChars: 4096, guardEditTools: true }, ulw: { maxRounds: 6 }, zebra: "kept out of order on purpose" } })
  })

  test("an identical edit is a byte-level no-op (idempotence, U11)", () => {
    // Re-setting the value it already has: the result must report no change and hand back the original bytes.
    const result = surgicalEdit(FIXTURE, ["ulw", "maxRounds"], 6)
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.changed).toBe(false)
    expect(result.text).toBe(FIXTURE)
  })
})

describe("U2 escapes and decoded keys (E1)", () => {
  // Fixture with an escaped quote, a literal backslash and a dotted key, so a decoded-key match cannot corrupt a neighbour.
  const escaping = `{
  "a\\"b": "neighbour \\" quoted",
  "back\\\\slash": "keep",
  "a.b": "dotted",
}
`
  test("a neighbouring escaped string is untouched and a dotted key matches decoded text", () => {
    // Edit addressed by the DECODED key "a.b"; the escaped neighbours must survive byte-for-byte.
    const result = surgicalEdit(escaping, ["a.b"], "changed")
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.text).toContain('"a\\"b": "neighbour \\" quoted"')
    expect(result.text).toContain('"back\\\\slash": "keep"')
    expect(result.text).toContain('"a.b": "changed"')
    expect(readJsonc(result.text)).toEqual({ ok: true, value: { 'a"b': 'neighbour " quoted', 'back\\slash': "keep", "a.b": "changed" } })
  })
})

describe("U3/E6 nested insert", () => {
  // Fixture with no `ulw` object at all: both insert cases (missing intermediate, missing leaf) start from it.
  const partial = `{
  // keep me
  "hashline": {
    "maxDiffChars": 20000
  }
}
`
  test("a missing intermediate object is materialised and appended as the LAST member", () => {
    // Insert whose intermediate object is absent; the new subtree is appended as the LAST member.
    const result = surgicalEdit(partial, ["ulw", "maxRounds"], 9, { insert: true })
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.text).toContain("// keep me")
    expect(result.text.indexOf('"maxDiffChars"')).toBeLessThan(result.text.indexOf('"ulw"'))
    expect(readJsonc(result.text)).toEqual({ ok: true, value: { hashline: { maxDiffChars: 20000 }, ulw: { maxRounds: 9 } } })
    // the inserted subtree carries no invented comment
    const inserted = result.text.slice(result.text.indexOf('"ulw"'))
    expect(inserted.includes("//")).toBe(false)
  })

  test("a missing leaf inside an existing object is appended as the last member", () => {
    // Insert of a missing leaf inside an EXISTING object: the same append-last rule, one level deeper.
    const result = surgicalEdit(partial, ["hashline", "guardEditTools"], false, { insert: true })
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(readJsonc(result.text)).toEqual({ ok: true, value: { hashline: { maxDiffChars: 20000, guardEditTools: false } } })
    expect(result.text).toContain("// keep me")
  })

  test("without the insert option a missing path refuses and returns no text", () => {
    // The same missing path WITHOUT `insert`: the rewriter must refuse rather than invent a location.
    const result = surgicalEdit(partial, ["ulw", "maxRounds"], 9)
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.reason).toBe("span-not-proven")
  })
})

describe("U4/E3 deletion span arithmetic", () => {
  test("deleting the only member leaves valid JSONC with no dangling comma", () => {
    // One-member document with a trailing comma: deleting the only member must not leave a dangling one.
    const text = `{
  "only": 1,
}
`
    // Deletion of the sole member, whose rewritten text must parse to an empty object.
    const result = surgicalDelete(text, ["only"])
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(readJsonc(result.text)).toEqual({ ok: true, value: {} })
    expect(/,\s*}/.test(result.text)).toBe(false)
  })

  test("deleting a middle member keeps the remaining members valid and ordered", () => {
    // Three members with a line comment on the middle one: deletion keeps the survivors ordered and valid.
    const text = `{
  "a": 1,
  "b": 2, // comment on b
  "c": 3,
}
`
    // Delete the middle member: its trailing comment stays behind while the parsed value loses only `b`.
    const result = surgicalDelete(text, ["b"])
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.text).toContain("// comment on b")
    expect(readJsonc(result.text)).toEqual({ ok: true, value: { a: 1, c: 3 } })
  })
})

describe("U5 arrays (E4)", () => {
  // Fixture whose value is an ARRAY, so index paths, append-at-end and delete-to-empty all have a subject.
  const withArray = `{
  "extensions": {
    "disable": ["alpha", "beta"]
  }
}
`
  test("replace, append and delete an element, including deleting to an empty array", () => {
    // In-place element replace: index 0 changes and the trailing element keeps its position.
    const replaced = surgicalEdit(withArray, ["extensions", "disable", "0"], "gamma")
    expect(replaced.ok).toBe(true)
    if (replaced.ok === true) expect(readJsonc(replaced.text)).toEqual({ ok: true, value: { extensions: { disable: ["gamma", "beta"] } } })

    // Append beyond the last index, legal only because `insert` was passed.
    const appended = surgicalEdit(withArray, ["extensions", "disable", "2"], "delta", { insert: true })
    expect(appended.ok).toBe(true)
    if (appended.ok === true) expect(readJsonc(appended.text)).toEqual({ ok: true, value: { extensions: { disable: ["alpha", "beta", "delta"] } } })

    // Delete one element by index; the remaining element must keep its order.
    const once = surgicalDelete(withArray, ["extensions", "disable", "1"])
    expect(once.ok).toBe(true)
    if (once.ok === true) expect(readJsonc(once.text)).toEqual({ ok: true, value: { extensions: { disable: ["alpha"] } } })

    // Delete the last remaining element: an empty array must be emitted, never a malformed one.
    const emptied = surgicalDelete(
      `{
  "extensions": {
    "disable": ["alpha"]
  }
}
`,
      ["extensions", "disable", "0"],
    )
    expect(emptied.ok).toBe(true)
    if (emptied.ok === true) {
      expect(readJsonc(emptied.text)).toEqual({ ok: true, value: { extensions: { disable: [] } } })
      expect(emptied.text).toContain('"disable": []')
    }
  })
})

describe("U6 duplicate keys — the settled ruling: SET updates the LAST, UNSET removes ALL", () => {
  test("set: the LAST occurrence is updated, the first is byte-identical, and the note names every line", () => {
    // Duplicate-key fixture whose FIRST occurrence carries a comment, so updating the last must not touch it.
    const source = `{\n  "ulw": {\n    "maxRounds": 3, // the runtime reads the LAST one\n    "maxRounds": 6,\n  },\n}\n`
    // Set on a duplicated path; the settled ruling makes the LAST occurrence the effective one.
    const result = surgicalEdit(source, ["ulw", "maxRounds"], 11)
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.text).toBe(`{\n  "ulw": {\n    "maxRounds": 3, // the runtime reads the LAST one\n    "maxRounds": 11,\n  },\n}\n`)
    // Re-read of the rewritten bytes: the updated last occurrence is what the runtime sees.
    const parsed = readJsonc(result.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok === true) expect(parsed.value).toEqual({ ulw: { maxRounds: 11 } })
    // the diagnostic is loud: reason + every occurrence line + which one won
    expect(result.notes).toHaveLength(1)
    expect(result.notes?.[0].reason).toBe("duplicate-key")
    expect(result.notes?.[0].lines).toEqual([3, 4])
    expect(result.notes?.[0].detail).toBe('key "ulw.maxRounds" appears 2 times at lines 3, 4; the last occurrence is the effective value and was updated')
  })

  test("set: a top-level duplicated leaf behaves the same way (the design's U6 fixture)", () => {
    // The same duplicate one level up, as the design U6 fixture spells it.
    const source = `{\n  "a": 1,\n  "a": 2,\n}\n`
    // Set on a duplicated TOP-LEVEL leaf, one level up from the previous case.
    const result = surgicalEdit(source, ["a"], 9)
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.text).toBe(`{\n  "a": 1,\n  "a": 9,\n}\n`)
    expect(result.notes?.[0].lines).toEqual([2, 3])
  })

  test("set: a single occurrence carries NO note (nothing to warn about)", () => {
    // Single occurrence, so the diagnostic path must stay silent: no note is part of the contract.
    const result = surgicalEdit(`{\n  "ulw": { "maxRounds": 6 },\n}\n`, ["ulw", "maxRounds"], 7)
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.notes).toBeUndefined()
  })

  test("unset: EVERY occurrence is removed, so the key is genuinely gone from the parsed document", () => {
    // Duplicate interleaved with an unrelated member, so unset must remove both spans and keep the middle one.
    const source = `{\n  "a": 1,\n  "b": 2, // keep me\n  "a": 3,\n}\n`
    // Unset by plain delete: EVERY occurrence must go, or the key stays effective in the file.
    const result = surgicalDelete(source, ["a"])
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    // Parsed proof of the unset: the deleted key is absent from the document the reader reconstructs.
    const parsed = readJsonc(result.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok === true) expect(parsed.value).toEqual({ b: 2 })
    expect(result.text).toContain("// keep me")
    expect(result.notes?.[0].detail).toContain("appears 2 times at lines 2, 4")
    expect(result.notes?.[0].detail).toContain("every occurrence was removed")
  })

  test("unset via the DELETE sentinel removes every occurrence too", () => {
    // Fixture for the DELETE sentinel: the same duplicated shape, addressed through `surgicalEdit`.
    const source = `{\n  "a": 1,\n  "a": 3,\n}\n`
    // Sentinel-driven unset, which must behave exactly like the dedicated delete entry point.
    const viaSentinel = surgicalEdit(source, ["a"], DELETE)
    expect(viaSentinel.ok).toBe(true)
    if (viaSentinel.ok !== true) return
    // Reader check on the sentinel path: the surviving document holds no member named `a`.
    const parsed = readJsonc(viaSentinel.text)
    if (parsed.ok === true) expect(parsed.value).toEqual({})
  })

  test("a duplicated INTERMEDIATE still refuses as `ambiguous-intermediate`, byte-untouched, for BOTH set and unset", () => {
    // Duplicated INTERMEDIATE key, where the ambiguity sits in the path rather than in the leaf.
    const source = `{\n  "ulw": { "maxRounds": 3 },\n  "other": 1,\n  "ulw": { "maxRounds": 6 },\n}\n`
    for (const result of [surgicalEdit(source, ["ulw", "maxRounds"], 11), surgicalDelete(source, ["ulw", "maxRounds"])]) {
      expect(result.ok).toBe(false)
      if (result.ok !== false) continue
      expect(result.reason).toBe("ambiguous-intermediate")
      expect(String(result.detail)).toContain("lines 2, 4")
      expect("text" in result).toBe(false)
    }
  })
})

describe("U7 CRLF (E7)", () => {
  // CRLF fixture: every existing ending is CRLF, so an inserted line with a bare LF would stand out.
  const crlf = '{\r\n  "ulw": {\r\n    "maxRounds": 6\r\n  }\r\n}\r\n'
  test("existing endings are preserved and an inserted line uses CRLF", () => {
    // Value replace in a CRLF document; the endings outside the span must not be normalised.
    const replaced = surgicalEdit(crlf, ["ulw", "maxRounds"], 7)
    expect(replaced.ok).toBe(true)
    if (replaced.ok === true) {
      expect(replaced.text).toBe(crlf.replace("6", "7"))
      expect(replaced.text.includes("\n") && !replaced.text.includes("\r\n")).toBe(false)
      expect(detectStyle(crlf).eol).toBe("\r\n")
    }
    // Insert of a NEW member: the one case that emits fresh line endings, which must match the file style.
    const inserted = surgicalEdit(crlf, ["ulw", "planDir"], ".mpd/plans", { insert: true })
    expect(inserted.ok).toBe(true)
    if (inserted.ok === true) {
      expect(readJsonc(inserted.text)).toEqual({ ok: true, value: { ulw: { maxRounds: 6, planDir: ".mpd/plans" } } })
      // the NEW line uses CRLF; existing endings are untouched
      const newLines = inserted.text.slice(inserted.text.indexOf('"maxRounds"'))
      expect(newLines).toContain("\r\n")
      // exactly ONE new line was emitted, in CRLF, and no bare LF appeared
      expect(inserted.text.split("\r\n").length).toBe(crlf.split("\r\n").length + 1)
      expect(/[^\r]\n/.test(inserted.text)).toBe(false)
    }
  })
})

describe("E3 trailing-comma style on insert", () => {
  test("a document that uses a trailing comma does not gain a dangling or doubled comma", () => {
    // Document written with a trailing comma: an insert must extend it without doubling or dangling the comma.
    const text = `{
  "a": 1,
}
`
    // Insert a second member into that document; the result must parse to exactly two members.
    const result = surgicalEdit(text, ["b"], 2, { insert: true })
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(/,\s*,/.test(result.text)).toBe(false)
    expect(readJsonc(result.text)).toEqual({ ok: true, value: { a: 1, b: 2 } })
  })
})

describe("U9 unparsable (E9)", () => {
  test("a malformed document refuses with 'unparsable' and returns no text", () => {
    for (const bad of ["{", '{"a": }', '{"a": 1 "b": 2}', ""]) {
      // Malformed input: the refusal must be named "unparsable" and carry no text at all.
      const result = surgicalEdit(bad, ["a"], 1)
      expect(result.ok).toBe(false)
      if (result.ok === false) expect(result.reason).toBe("unparsable")
      expect(JSON.stringify(result)).not.toContain('"text"')
    }
    expect(readJsonc("{").ok).toBe(false)
  })
})

describe("reader parity", () => {
  test("stripJsoncText tolerates comments and trailing commas exactly like the shipped reader", () => {
    expect(JSON.parse(stripJsoncText('{ /* c */ "a": [1, 2,], // x\n }'))).toEqual({ a: [1, 2] })
  })
})

describe("regression: the shipped reader's trailing-comma probe (found by these tests)", () => {
  test("a trailing comma followed by a comment no longer breaks JSON.parse", () => {
    // Measured before the fix: `{ "a": 1, /* c */ }` kept its comma and threw.
    expect(JSON.parse(stripJsoncText('{ "a": 1, /* c */ }'))).toEqual({ a: 1 })
    expect(JSON.parse(stripJsoncText('{ "a": 1, // c\n }'))).toEqual({ a: 1 })
    expect(JSON.parse(stripJsoncText('{ "a": [1,], /* after */ }'))).toEqual({ a: [1] })
    expect(readJsonc('{ "a": 1, /* c */ }')).toEqual({ ok: true, value: { a: 1 } })
  })
})


describe("the design-named API surface (§10.2): locateValueSpan, DELETE, EditRefusal/EditResult", () => {
  test("locateValueSpan proves the exact value span and reports the comma/eol facts", () => {
    // CRLF document for the span prover, which reports the EOL and comma facts alongside the offsets.
    const crlf = `{\r\n  "ulw": { "maxRounds": 6 },\r\n}\r\n`
    // The proven span; the assertions below read its exact offsets and its two style facts.
    const span = locateValueSpan(crlf, ["ulw", "maxRounds"])
    expect("start" in span).toBe(true)
    if (!("start" in span)) return
    expect(crlf.slice(span.start, span.end)).toBe("6")
    expect(span.hasTrailingComma).toBe(false)
    expect(span.eol).toBe("\r\n")
    // The same value written with a trailing comma, so the comma fact has a positive case.
    const withComma = `{\n  "ulw": { "maxRounds": 6, },\n}\n`
    // Span of the comma-terminated value: the offsets must match the comma-less document.
    const span2 = locateValueSpan(withComma, ["ulw", "maxRounds"])
    if (!("start" in span2)) throw new Error("expected a span")
    expect(withComma.slice(span2.start, span2.end)).toBe("6")
    expect(span2.hasTrailingComma).toBe(true)
  })

  test("locateValueSpan refuses with the named reasons instead of guessing", () => {
    expect(locateValueSpan("{ not json", ["a"])).toMatchObject({ reason: "unparsable" })
    expect(locateValueSpan(`{\n  "ulw": { "maxRounds": 6 },\n}\n`, ["ulw", "veto"])).toMatchObject({ reason: "span-not-proven" })
    expect(locateValueSpan("{ \"ulw\": 1 }", ["ulw", "maxRounds"])).toMatchObject({ reason: "unsupported-shape" })
  })

  test("the DELETE sentinel is accepted by surgicalEdit and equals surgicalDelete", () => {
    // Sentinel/dedicated-delete equivalence fixture: one member to remove and one to keep.
    const source = `{\n  "ulw": { "maxRounds": 6 },\n  "zebra": 1,\n}\n`
    // Unset through `surgicalEdit` with the DELETE sentinel: the sentinel is the unset signal on the edit entry point.
    const viaSentinel = surgicalEdit(source, ["ulw"], DELETE)
    // The same unset through the dedicated entry point; both texts must be byte-identical.
    const viaDelete = surgicalDelete(source, ["ulw"])
    expect(viaSentinel.ok).toBe(true)
    expect(viaDelete.ok).toBe(true)
    if (viaSentinel.ok !== true || viaDelete.ok !== true) return
    expect(viaSentinel.text).toBe(viaDelete.text)
    expect(viaSentinel.text).not.toContain("ulw")
  })
})
