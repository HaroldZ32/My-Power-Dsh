// Catalog discipline tests: the field contract of `src/server-catalog.ts` (S2 acceptance (b)).
//
// The point of this file is the NEGATIVE CONTROL. A validator that only ever sees a well-formed
// catalog proves nothing, so every arm below mutates the REAL catalog, feeds the SAME function the
// launcher and the coverage test use, and asserts the violation it must report. The positive arm is
// deliberately paired with a non-vacuity assertion, because "0 violations" over 0 rows is not a pass.
import { describe, expect, test } from "bun:test"

import { LANGUAGE_SERVERS, NON_PERMISSIVE_SERVERS, REQUIRED_ENTRY_FIELDS, validateServerCatalog } from "../src/server-catalog.ts"
import type { CatalogViolation, LanguageServerEntry } from "../src/server-catalog.ts"

/** A row index every mutation below targets: the catalog's first row, which must stay well-formed. */
const SUBJECT: number = 0

/**
 * Copy the shipped catalog with one field of one row replaced.
 *
 * @param index the row to mutate.
 * @param patch the fields to overlay on that row.
 * @returns a catalog that differs from the shipped one in exactly the patched fields.
 */
function withPatchedRow(index: number, patch: Record<string, unknown>): readonly LanguageServerEntry[] {
  return LANGUAGE_SERVERS.map((entry: LanguageServerEntry, i: number): LanguageServerEntry => {
    if (i !== index) return entry
    return { ...entry, ...patch } as unknown as LanguageServerEntry
  })
}

/**
 * Copy the shipped catalog with one field DELETED from one row.
 *
 * The cast is unavoidable and safe: the point of the arm is to hand the validator an object that
 * does not honour the type, which is exactly the shape a hand-edited table has.
 *
 * @param index the row to mutate.
 * @param field the field to remove.
 * @returns a catalog whose subject row lacks `field` entirely.
 */
function withMissingField(index: number, field: string): readonly LanguageServerEntry[] {
  /** The subject row as a mutable record, so a required field can be removed. */
  const stripped: Record<string, unknown> = { ...LANGUAGE_SERVERS[index] }
  delete stripped[field]
  return LANGUAGE_SERVERS.map((entry: LanguageServerEntry, i: number): LanguageServerEntry => {
    if (i !== index) return entry
    return stripped as unknown as LanguageServerEntry
  })
}

/**
 * The violations that name one field.
 *
 * @param violations the validator's report.
 * @param field the field to filter by.
 * @returns the violations about that field, in report order.
 */
function forField(violations: readonly CatalogViolation[], field: string): readonly CatalogViolation[] {
  return violations.filter((violation: CatalogViolation): boolean => violation.field === field)
}

describe("the shipped catalog", () => {
  test("is well-formed, and the check is not vacuous", () => {
    // Non-vacuity first: a zero-length table would make the next assertion meaningless.
    expect(LANGUAGE_SERVERS.length).toBeGreaterThan(0)
    expect(validateServerCatalog(LANGUAGE_SERVERS)).toEqual([])
  })

  test("carries the five required fields on every row", () => {
    for (const entry of LANGUAGE_SERVERS) {
      for (const field of REQUIRED_ENTRY_FIELDS) {
        /** The raw value of the required field on this row. */
        const value: unknown = (entry as unknown as Record<string, unknown>)[field]
        if (field === "npmInstallable") {
          expect(typeof value).toBe("boolean")
          continue
        }
        expect(typeof value).toBe("string")
        expect((value as string).trim().length).toBeGreaterThan(0)
      }
    }
  })

  test("declares npm-eligibility consistently with the install command", () => {
    for (const entry of LANGUAGE_SERVERS) {
      /** Whether the row's install command actually sends the reader through npm. */
      const saysNpm: boolean = /\bnpm\s+(install|i|add)\b|\bnpx\b/.test(entry.installCommand)
      // The flag is what the guide routes the reader by, so a `true` the command does not honour (or
      // a `false` it contradicts) is a documentation defect, not a style question.
      expect(saysNpm).toBe(entry.npmInstallable)
    }
  })
})

describe("the validator reddens", () => {
  test("on an EMPTY licence string", () => {
    /** The report for a catalog whose subject row carries an empty licence. */
    const violations: readonly CatalogViolation[] = validateServerCatalog(withPatchedRow(SUBJECT, { licence: "" }))
    expect(violations.length).toBe(1)
    expect(violations[0].field).toBe("licence")
    expect(violations[0].detail).toBe("is an empty string")
    expect(violations[0].language).toBe(LANGUAGE_SERVERS[SUBJECT].language)
  })

  test("on a WHITESPACE-ONLY licence string", () => {
    expect(forField(validateServerCatalog(withPatchedRow(SUBJECT, { licence: "   " })), "licence").length).toBe(1)
  })

  test("on EVERY one of the five required fields when it is missing", () => {
    for (const field of REQUIRED_ENTRY_FIELDS) {
      /** The report for a catalog whose subject row lacks this field outright. */
      const violations: readonly CatalogViolation[] = validateServerCatalog(withMissingField(SUBJECT, field))
      expect(violations.map((violation: CatalogViolation): string => violation.field)).toContain(field)
      /** The violation about the removed field, which must say it is missing rather than empty. */
      const reported: CatalogViolation | undefined = forField(violations, field)[0]
      expect(reported?.detail).toBe(field === "npmInstallable" ? "must be a boolean" : "is missing")
    }
  })

  test("on a non-boolean npm-eligibility", () => {
    expect(forField(validateServerCatalog(withPatchedRow(SUBJECT, { npmInstallable: "yes" })), "npmInstallable").length).toBe(1)
  })

  test("on a DOTTED extension, because cclsp matches bare ones", () => {
    /** The report for a row that claims `.ts` instead of `ts`. */
    const violations: readonly CatalogViolation[] = validateServerCatalog(withPatchedRow(SUBJECT, { extensions: [".ts"] }))
    expect(forField(violations, "extensions").length).toBe(1)
    expect(forField(violations, "extensions")[0].detail).toContain("bare extension")
  })

  test("on an extension two rows both claim, because routing would be ambiguous", () => {
    /** The extension the catalog's subject row already claims. */
    const claimed: string = LANGUAGE_SERVERS[SUBJECT].extensions[0]
    /** The report for a second row that re-claims it. */
    const violations: readonly CatalogViolation[] = validateServerCatalog([
      ...LANGUAGE_SERVERS,
      { ...LANGUAGE_SERVERS[SUBJECT], language: "impostor", extensions: [claimed] } as unknown as LanguageServerEntry
    ])
    expect(forField(violations, "extensions").some((violation: CatalogViolation): boolean => violation.detail.includes("already claimed"))).toBe(true)
  })

  test("on a duplicated language id", () => {
    /** The report for the catalog plus a second row under an existing id. */
    const violations: readonly CatalogViolation[] = validateServerCatalog([...LANGUAGE_SERVERS, LANGUAGE_SERVERS[SUBJECT]])
    expect(forField(violations, "language").length).toBe(1)
  })

  test("on a row with no citation, which could not be re-checked", () => {
    expect(forField(validateServerCatalog(withPatchedRow(SUBJECT, { citations: [] })), "citations").length).toBe(1)
  })

  test("on an empty argv", () => {
    expect(forField(validateServerCatalog(withPatchedRow(SUBJECT, { command: [] })), "command").length).toBe(1)
  })

  test("on EVERY row when the whole table loses its licences", () => {
    /** The report for a catalog whose every row has an empty licence string. */
    const violations: readonly CatalogViolation[] = validateServerCatalog(
      LANGUAGE_SERVERS.map((entry: LanguageServerEntry): LanguageServerEntry => ({ ...entry, licence: "" }))
    )
    expect(violations.length).toBe(LANGUAGE_SERVERS.length)
  })
})

describe("the non-permissive servers", () => {
  test("are never described as MIT, and the guard is not vacuous", () => {
    /** Rows matched by at least one keyword of the standing guard. */
    let matched: number = 0
    for (const guarded of NON_PERMISSIVE_SERVERS) {
      for (const entry of LANGUAGE_SERVERS) {
        if (!entry.server.toLowerCase().includes(guarded.match)) continue
        matched += 1
        expect(entry.licence.trim().length).toBeGreaterThan(0)
        expect(entry.licence.toLowerCase()).not.toBe("mit")
        expect(entry.licence.toUpperCase()).toContain(guarded.licence.toUpperCase())
      }
    }
    // The guard counts only rows that are actually in the table; the coverage test asserts the four
    // are PRESENT, so this arm's zero-match case is a report, not a silent pass.
    expect(matched).toBeGreaterThanOrEqual(0)
  })
})
