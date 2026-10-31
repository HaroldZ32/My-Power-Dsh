// CELLWORK REQUIREMENTS — a `###` subheading belongs to the section above it (C10/D9).
//
// The parser is pure, so every arm is a document string plus the reading it must produce. The subject is
// the BODY RANGE: a nested heading no longer truncates its parent, while the outline itself is unchanged
// (a document title must not swallow the `##` sections below it). The negative arm pins the limit: a
// section whose body is only whitespace is still "missing or empty".
import { test, expect } from "bun:test"
import { parseSections, validateRequirementsText } from "../src/requirements.ts"

/** A complete six-section document whose every body sits UNDER a nested subheading (the D9 shape). */
const NESTED_DOCUMENT = [
  "## Goal",
  "### Objective",
  "Ship the overlay.",
  "",
  "## Non-goals",
  "### Out of scope",
  "No editor the project does not own.",
  "",
  "## Users / consumers",
  "### Primary",
  "The build engineer.",
  "",
  "## Constraints",
  "### Hard",
  "Rust toolchain only.",
  "",
  "## Acceptance criteria",
  "### Done when",
  "The gate is green.",
  "",
  "## Open questions",
  "### Remaining",
  "None.",
  "",
].join("\n")

test("C10: a ### subheading stays INSIDE its parent section's body", () => {
  /** The parsed sections of the D9-shaped document. */
  const sections = parseSections(NESTED_DOCUMENT)
  expect(sections.get("goal")).toBe("### Objective\nShip the overlay.")
  // The OUTLINE is unchanged: the subheading is also readable under its own name, and the `##` sections
  // below a title are still sections rather than part of the title's body.
  expect(sections.get("objective")).toBe("Ship the overlay.")
  /** The validation outcome. */
  const validation = validateRequirementsText(NESTED_DOCUMENT)
  expect(validation.missing).toEqual([])
  expect(validation.ok).toBe(true)
})

test("C10: nested headings of every deeper level stay in the parent body", () => {
  /** A `##` section holding a `###` and a `####` heading before its text. */
  const text = [
    "## Constraints",
    "### Toolchain",
    "#### Rust",
    "No C++.",
    "",
    "## Goal",
    "Ship it.",
    "",
    "## Non-goals",
    "No editor.",
    "",
    "## Users",
    "Engineers.",
    "",
    "## Acceptance criteria",
    "Green.",
    "",
    "## Open questions",
    "None.",
    "",
  ].join("\n")
  /** The parsed sections. */
  const sections = parseSections(text)
  expect(sections.get("constraints")).toBe("### Toolchain\n#### Rust\nNo C++.")
  /** The validation outcome. */
  const validation = validateRequirementsText(text)
  expect(validation.missing).toEqual([])
  expect(validation.ok).toBe(true)
})

test("C10: a body runs until the next heading of the SAME or a HIGHER level", () => {
  /** A level-2 section with a deeper neighbour, then a sibling and a shallower heading. */
  const text = [
    "## Goal",
    "First.",
    "",
    "### Sub",
    "Nested.",
    "",
    "## Non-goals",
    "Second.",
    "",
    "# Constraints",
    "Third.",
    "",
  ].join("\n")
  /** The parsed sections. */
  const sections = parseSections(text)
  // Same level and shallower both END the body; the deeper heading does not.
  expect(sections.get("goal")).toBe("First.\n\n### Sub\nNested.")
  expect(sections.get("non-goals")).toBe("Second.")
  expect(sections.get("constraints")).toBe("Third.")
})

test("C10: a #### heading nested under a ### section is body too", () => {
  /** A level-3 section containing a level-4 heading, then its level-3 sibling. */
  const text = ["### Goal", "Top.", "", "#### Detail", "Deep.", "", "### Non-goals", "None.", ""].join("\n")
  /** The parsed sections. */
  const sections = parseSections(text)
  expect(sections.get("goal")).toBe("Top.\n\n#### Detail\nDeep.")
  expect(sections.get("detail")).toBe("Deep.")
  expect(sections.get("non-goals")).toBe("None.")
})

test("C10: a section whose body is only whitespace is still missing or empty", () => {
  /** The complete document with the Goal body reduced to whitespace. */
  const text = NESTED_DOCUMENT.replace("### Objective\nShip the overlay.", "   \n\t")
  /** The validation outcome. */
  const validation = validateRequirementsText(text)
  expect(validation.ok).toBe(false)
  expect(validation.missing).toEqual(["Goal"])
  /** The Goal reading, which must still be PRESENT but carry no characters. */
  const goal = validation.sections.find((section) => section.key === "goal")
  expect(goal?.present).toBe(true)
  expect(goal?.chars).toBe(0)
})
