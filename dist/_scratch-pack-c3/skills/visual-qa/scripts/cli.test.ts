import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run, runImageDiff, runTuiCheck } from "./cli.ts"
import { encodeRgbaPng, solidRgba } from "./png-synth.ts"

/** A fresh temporary directory for one test's fixture files. */
function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "visual-qa-"))
}

describe("runImageDiff", () => {
	test("#given two identical PNG files #when diffed #then similarity is 100", () => {
		// given
		const dir = tempDir()
		/** Path of the reference PNG written for this test. */
		const reference = join(dir, "reference.png")
		/** Path of the actual PNG written for this test; identical pixels, different file. */
		const actual = join(dir, "actual.png")
		writeFileSync(reference, encodeRgbaPng(2, 2, solidRgba(2, 2, [1, 2, 3, 255])))
		writeFileSync(actual, encodeRgbaPng(2, 2, solidRgba(2, 2, [1, 2, 3, 255])))
		// when
		/** The diff verdict for the two identical images. */
		const result = runImageDiff([reference, actual])
		// then
		expect(result.command).toBe("image-diff")
		expect(result.similarityScore).toBe(100)
		expect(result.dimensionsMatch).toBe(true)
	})

	test("#given missing arguments #when diffed #then it throws a usage error", () => {
		// given / when / then
		expect(() => runImageDiff([])).toThrow("usage")
	})
})

describe("runTuiCheck", () => {
	test("#given a CJK capture file #when checked #then widths count wide characters", () => {
		// given
		const dir = tempDir()
		/** Path of the capture file written for this test. */
		const file = join(dir, "capture.txt")
		writeFileSync(file, "가나\nhello")
		// when
		/** The tui-check verdict for the two-line CJK capture. */
		const result = runTuiCheck([file, "--cols", "40"])
		// then
		expect(result.command).toBe("tui-check")
		expect(result.expectedColumns).toBe(40)
		expect(result.lineWidths).toEqual([4, 5])
	})
})

describe("run dispatch", () => {
	test("#given an unknown command #when run #then it throws", () => {
		// given / when / then
		expect(() => run(["bogus"])).toThrow("unknown command")
	})
})

describe("cli entry", () => {
	test("#given the Node bundle is spawned for image-diff without Bun on PATH #when it runs #then it prints JSON and exits zero", () => {
		// given
		const dir = tempDir()
		/** Path of the black reference PNG. */
		const reference = join(dir, "reference.png")
		/** Path of the white actual PNG, so every pixel of the overlap differs. */
		const actual = join(dir, "actual.png")
		writeFileSync(reference, encodeRgbaPng(2, 2, solidRgba(2, 2, [0, 0, 0, 255])))
		writeFileSync(actual, encodeRgbaPng(2, 2, solidRgba(2, 2, [255, 255, 255, 255])))
		/** Absolute path of the node binary, resolved through Bun so the spawn never depends on PATH. */
		const nodePath = Bun.which("node")
		if (nodePath === null) throw new Error("node not found on PATH")
		// when
		/** The spawned bundle process, run with a PATH that hides Bun so the shipped .mjs artifact is what executes. */
		const proc = Bun.spawnSync({
			cmd: [nodePath, join(import.meta.dir, "visual-qa.mjs"), "image-diff", reference, actual],
			env: { ...process.env, PATH: "/usr/bin:/bin" },
		})
		// then
		expect(proc.exitCode).toBe(0)
		/** The bundle's stdout parsed as the JSON verdict. */
		const parsed: Record<string, unknown> = JSON.parse(proc.stdout.toString())
		expect(parsed["command"]).toBe("image-diff")
		expect(parsed["similarityScore"]).toBe(0)
	})
})
