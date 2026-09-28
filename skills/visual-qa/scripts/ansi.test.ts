import { describe, expect, test } from "bun:test"

import { hasAnsi, stripAnsi } from "./ansi.ts"

/** The ESC control character, used to build the fixtures' escape sequences without raw control bytes. */
const ESC = String.fromCharCode(0x1b)

describe("stripAnsi", () => {
	test("#given an ANSI-wrapped string #when stripped #then escape codes are removed", () => {
		// given
		const input = `${ESC}[31mred${ESC}[0m`
		// when
		/** The fixture text with its SGR sequence stripped, expected to be the bare word. */
		const stripped = stripAnsi(input)
		// then
		expect(stripped).toBe("red")
	})

	test("#given a plain string #when stripped #then it is unchanged", () => {
		// given
		const input = "plain text"
		// when
		/** Strip of an escape-free string, which must come back byte-identical. */
		const stripped = stripAnsi(input)
		// then
		expect(stripped).toBe("plain text")
	})
})

describe("hasAnsi", () => {
	test("#given a string with ANSI codes #when checked #then it is true", () => {
		// given
		const input = `${ESC}[1mbold${ESC}[0m`
		// when
		/** Detection result for a string that does carry an SGR sequence. */
		const detected = hasAnsi(input)
		// then
		expect(detected).toBe(true)
	})

	test("#given a plain string #when checked #then it is false", () => {
		// given
		const input = "no ansi here"
		// when
		/** Detection result for an escape-free string, expected to be false. */
		const detected = hasAnsi(input)
		// then
		expect(detected).toBe(false)
	})
})
