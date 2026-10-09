// Coverage: the SIZE and the licence guards of the S2 acceptance contract.
//
// The count floor and the guards are asserted BY DATA, so this file is the mechanical reason the
// catalog cannot quietly shrink or mislabel a server. Two kinds of guard are exercised:
//   * NON_PERMISSIVE_SERVERS — an 8-entry list; a row whose server name matches one of its keywords
//     must carry that licence and must not be labelled MIT (presence is NOT required: the list also
//     guards servers this catalog chooses not to wire, such as `nixd`).
//   * the contract's own FOUR servers — these must be PRESENT, because the contract names them.
import { describe, expect, test } from "bun:test"

import { LANGUAGE_SERVERS, LICENCE_DISPUTES, NON_PERMISSIVE_SERVERS, NPM_TRAPS, UNVERIFIED_MARKER, validateServerCatalog } from "../src/server-catalog.ts"
import type { CatalogViolation, LanguageServerEntry } from "../src/server-catalog.ts"

/** The language count the user's decision 3 (the FULL ~40 languages) sets as the floor. */
const REQUIRED_LANGUAGES: number = 40

/** The four servers the CONTRACT §3 S2 names, with the licence their own project states.
 *  They must be PRESENT in the catalog, unlike the rest of the non-permissive guard list. */
const CONTRACT_SERVERS: readonly { readonly match: string; readonly licence: string }[] = [
  { match: "jdt", licence: "EPL-2.0" },
  { match: "terraform-ls", licence: "MPL-2.0" },
  { match: "intelephense", licence: "proprietary" },
  { match: "c# dev kit", licence: "proprietary" }
]

/**
 * The catalog rows whose server name carries a keyword.
 *
 * @param keyword the lower-case keyword to look for.
 * @returns the matching rows, in catalog order.
 */
function rowsMatching(keyword: string): readonly LanguageServerEntry[] {
  return LANGUAGE_SERVERS.filter((entry: LanguageServerEntry): boolean => entry.server.toLowerCase().includes(keyword))
}

describe("language coverage (acceptance (a))", () => {
  test("the catalog carries at least the full ~40-language set", () => {
    expect(LANGUAGE_SERVERS.length).toBeGreaterThanOrEqual(REQUIRED_LANGUAGES)
  })

  test("the catalog is still well-formed at this size", () => {
    expect(validateServerCatalog(LANGUAGE_SERVERS)).toEqual([])
  })

  test("every language id and every claimed extension is unique", () => {
    // Reported through the validator rather than re-implemented, so the field discipline and the
    // coverage contract can never disagree about what "a duplicate" is.
    expect(validateServerCatalog(LANGUAGE_SERVERS).filter((violation: CatalogViolation): boolean => violation.field === "language" || violation.field === "extensions")).toEqual([])
  })

  test("every row is marked primary or unverified, and no row is silently weak", () => {
    for (const entry of LANGUAGE_SERVERS) {
      expect(entry.verification === "primary" || entry.verification === "unverified").toBe(true)
      if (entry.verification === "unverified") expect(entry.caveat.startsWith(UNVERIFIED_MARKER)).toBe(true)
    }
  })
})

describe("non-permissive servers (the guide must never call them MIT)", () => {
  test("the contract's four servers are PRESENT, each with its real licence", () => {
    for (const guarded of CONTRACT_SERVERS) {
      /** The rows carrying this contract server's keyword. */
      const rows: readonly LanguageServerEntry[] = rowsMatching(guarded.match)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.licence.toUpperCase()).toContain(guarded.licence.toUpperCase())
        expect(row.licence.toLowerCase()).not.toBe("mit")
      }
    }
  })

  test("every guarded keyword this catalog wires is labelled correctly, and the list is not a dead letter", () => {
    /** How many guarded keywords matched at least one row; a zero-match keyword is a standing rule
     *  for a server this catalog does not wire, which is counted rather than failed. */
    let wired: number = 0
    for (const guarded of NON_PERMISSIVE_SERVERS) {
      /** The rows this keyword guards. */
      const rows: readonly LanguageServerEntry[] = rowsMatching(guarded.match)
      if (rows.length > 0) wired += 1
      for (const row of rows) {
        expect(row.licence.toUpperCase()).toContain(guarded.licence.toUpperCase())
        expect(row.licence.toLowerCase()).not.toBe("mit")
      }
    }
    expect(wired).toBeGreaterThanOrEqual(6)
  })

  test("every recorded LICENCE DISPUTE names its row and speaks in the caveat", () => {
    for (const dispute of LICENCE_DISPUTES) {
      /** The rows carrying the disputed server's keyword. */
      const rows: readonly LanguageServerEntry[] = rowsMatching(dispute.match)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.caveat).toContain(dispute.caveatMustMention)
      }
    }
  })

  test("no install command points at an npm TRAP", () => {
    for (const trap of NPM_TRAPS) {
      /** The wiring that would be wrong: an npm install of the trap's package name. */
      const wrong: RegExp = new RegExp(`npm\\s+(i|install|add)\\b[^"]*\\b${trap.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
      for (const entry of LANGUAGE_SERVERS) {
        expect(wrong.test(entry.installCommand)).toBe(false)
      }
    }
  })
})
