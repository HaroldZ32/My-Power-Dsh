// Regression pin for the 2026-10-19 TURN failure reported against harness 0.2.1-rc.2:
//   turn error unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix";
//   registered variables: provider, model
//
// The `mpd` preset's persona row is HOST-owned (`@deepseek-ai/dsh-persona`), so it
// cannot pass `interpolate: false` the way the bundle's child-persona seam does; its
// `prefix` text interpolates with strict semantics. The loop registers ONLY `provider`
// and `model` (dsh-agent-loop), and the 0.2.1-rc.2 dsh-system-prompt README states that
// a custom persona must not reference a built-in `{{cwd}}`: the working-directory
// service supplies the directory as literal runtime context, and an unresolved
// reference throws before any model request. This test reads the SHIPPED preset, so a
// reintroduced template variable reddens here instead of in a user's first turn.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Repository root, three directories above this test file. */
const ROOT = join(import.meta.dirname, "..", "..", "..");
/** The shipped preset patch, read verbatim. */
const PRESET = readFileSync(join(ROOT, "presets", "mpd.patch.yml"), "utf8");
/** The prompt variables the harness loop registers; any other strict reference fails assembly. */
const LOOP_VARIABLES: readonly string[] = ["provider", "model"];

/**
 * Extract the persona row's folded `prefix: >-` scalar and dedent it.
 *
 * It stops at the first non-blank line indented no deeper than the `prefix:` key, so
 * the sibling rows below the persona never leak into the subject. Comments inside the
 * block are kept: `{{…}}` in prose is not the risk this pin covers only when the
 * scalar carries it, so the caller scans the scalar itself rather than the file.
 * @param text The preset patch text.
 * @returns The folded scalar's dedented content, or `""` when the block is absent.
 */
function personaPrefix(text: string): string {
  // The `prefix: >-` line, whose indentation is the boundary for the block below it.
  const header = /^([ \t]*)prefix: >-[ \t]*$/m.exec(text);
  if (header === null) return "";
  // The indentation of the key, used to recognise the block's end.
  const keyIndent = header[1].length;
  // The line ending the header, so the scan starts at the block body.
  const bodyStart = header.index + header[0].length;
  // The block's own lines, collected until a non-blank line at or above the key indent.
  const lines: string[] = [];
  for (const line of text.slice(bodyStart).split("\n").slice(1)) {
    if (line.trim() !== "" && (line.match(/^[ \t]*/) as RegExpMatchArray)[0].length <= keyIndent) break;
    lines.push(line);
  }
  // The indentation shared by the block's first non-blank line, which is what dedents it.
  const first = lines.find((line) => line.trim() !== "");
  // A block with no body contributes no prompt text.
  if (first === undefined) return "";
  // The common indentation prefix YAML already strips before folding.
  const pad = (first.match(/^[ \t]*/) as RegExpMatchArray)[0];
  return lines.map((line) => (line.startsWith(pad) ? line.slice(pad.length) : line)).join("\n");
}

describe("the mpd preset's persona prefix uses only loop-registered prompt variables", () => {
  /** The persona prefix as the loader folds it. */
  const prefix = personaPrefix(PRESET);
  /** Every strict `{{name}}` reference the prefix carries. */
  const references = [...prefix.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map((match) => match[1]);

  test("the subject really is the persona prefix (a lost block cannot pass vacuously)", () => {
    expect(prefix.length).toBeGreaterThan(1000);
    expect(prefix).toContain("You are MPD");
    expect(prefix).toContain("{{model}}");
  });

  test("no reference names `{{cwd}}` — the loop does not register it", () => {
    expect(references).not.toContain("cwd");
    expect(prefix).not.toContain("{{cwd}}");
  });

  test("every reference is one the harness loop registers", () => {
    for (const name of references) expect(LOOP_VARIABLES).toContain(name);
  });
});
