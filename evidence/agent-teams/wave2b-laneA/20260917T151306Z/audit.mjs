// T-92 AUDIT — lane A's absence-pin audit, REUSED from the instrument this lane already measured
// (`evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §8) and re-taken at THIS
// revision rather than inherited.
//
// §8's scope rule, verbatim: "an absence assertion must be evaluated against the file its SUBJECT came
// from, not against the tree. Mechanically: parse each arm for its own binding
// (`const <var> = readFileSync(join(libDir|LIB_DIR, "<file>"))`), then test only
// `expect(<var>).not.toContain("<literal>")` against that file."
//
// It also reports the two matcher-error directions it measured on itself, because a base rate without
// its error directions is the census/executed-set trap one level down.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = new URL("../../../../packages/mpd-agent-teams-plugin/", import.meta.url).pathname
const CORPORA = ["self-fix-tests", "test"]

/** Every file under a directory (no file-type assumption — §8 trap 2). */
function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path, out)
        else out.push(path)
    }
    return out
}

/** T-92's rule, in CODE: comments removed, string literals KEPT (a literal is code for this purpose). */
export function stripComments(text) {
    let out = ""
    let index = 0
    while (index < text.length) {
        const two = text.slice(index, index + 2)
        if (two === "//") {
            const end = text.indexOf("\n", index)
            index = end === -1 ? text.length : end
            continue
        }
        if (two === "/*") {
            const end = text.indexOf("*/", index + 2)
            index = end === -1 ? text.length : end + 2
            continue
        }
        const char = text[index]
        if (char === '"' || char === "'" || char === "`") {
            let cursor = index + 1
            while (cursor < text.length) {
                if (text[cursor] === "\\") {
                    cursor += 2
                    continue
                }
                if (text[cursor] === char) {
                    cursor += 1
                    break
                }
                cursor += 1
            }
            out += text.slice(index, cursor)
            index = cursor
            continue
        }
        out += char
        index += 1
    }
    return out
}

const occurrences = []
const subjectScoped = []
const files = CORPORA.flatMap((corpus) => walk(join(ROOT, corpus)).filter((path) => !path.includes("fixtures/")))
// The ROW's unit is `not.toContain(` OCCURRENCES, not the subset whose literal is an inline string —
// so the raw count is taken over the same no-file-type-assumption scope and reported separately.
const rawOccurrences = files.map((file) => (readFileSync(file, "utf8").match(/not\.toContain\(/gu) ?? []).length)
const mjsOnlyFiles = files.filter((path) => path.endsWith(".mjs"))
const mjsOnlyOccurrences = mjsOnlyFiles.map((file) => (readFileSync(file, "utf8").match(/not\.toContain\(/gu) ?? []).length)
for (const file of files) {
    const text = readFileSync(file, "utf8")
    const bindings = new Map()
    for (const match of text.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?readFileSync\(\s*join\(\s*(?:libDir|LIB_DIR|[A-Za-z_$][\w$]*)\s*,\s*"([^"]+)"\s*\)/gu)) {
        bindings.set(match[1], match[2])
    }
    // T-92's FIX shape: `const <view> = codeOf(<subject>)` — a DERIVED view of the same subject file.
    // The audit must follow that derivation, or the fix would hide the pins from the audit that exists
    // to find them (a green that cannot redden).
    for (const match of text.matchAll(/const\s+(\w+)\s*=\s*codeOf\(\s*(\w+)\s*\)/gu)) {
        const source = bindings.get(match[2])
        if (source !== undefined) bindings.set(match[1], source)
    }
    for (const match of text.matchAll(/expect\(\s*([\w.$]+)\s*(?:,\s*[^)]*)?\)\s*\.not\.toContain\(\s*"([^"]*)"/gu)) {
        const [, subject, literal] = match
        occurrences.push({ file: file.slice(ROOT.length), subject, literal })
        const moduleFile = bindings.get(subject)
        if (moduleFile !== undefined) subjectScoped.push({ file: file.slice(ROOT.length), subject, literal, moduleFile })
    }
}

/** Test one literal against ONE subject file in the three readings that matter. */
function readings(entry) {
    const text = readFileSync(join(ROOT, "lib", entry.moduleFile), "utf8")
    const stripped = stripComments(text)
    return {
        ...entry,
        full: text.includes(entry.literal),
        code: stripped.includes(entry.literal),
        commentOnly: text.includes(entry.literal) && !stripped.includes(entry.literal),
    }
}

const resolved = subjectScoped.map(readings)
const summary = {
    revision_note: "re-taken by t43 at the working revision; the wave-2a readings are NOT inherited",
    not_toContain_occurrences: rawOccurrences.reduce((sum, value) => sum + value, 0),
    not_toContain_per_corpus: Object.fromEntries(CORPORA.map((corpus) => [corpus, files.map((file, index) => ({ file, value: rawOccurrences[index] })).filter((entry) => entry.file.startsWith(join(ROOT, corpus))).reduce((sum, entry) => sum + entry.value, 0)])),
    literal_bearing_arms_parsed: occurrences.length,
    literal_bearing_per_corpus: Object.fromEntries(CORPORA.map((corpus) => [corpus, occurrences.filter((entry) => entry.file.startsWith(corpus + "/")).length])),
    subject_scoped_over_module_sources: resolved.length,
    subject_scoped: resolved,
    reddened_on_full_text: resolved.filter((entry) => entry.full).length,
    reddened_on_code_only: resolved.filter((entry) => entry.code).length,
    comment_only_hits: resolved.filter((entry) => entry.commentOnly).length,
    matcher_error_directions: [
        {
            direction: "over-report",
            alternative: "test every literal against EVERY lib file (the subject binding ignored)",
            measured: `every one of the ${occurrences.length} literal-bearing arm(s) tested against every lib file instead of its own subject: ${resolved.length} subject-scoped`,
        },
        {
            direction: "under-report",
            alternative: "a *.mjs-only glob over both corpora (the file-type assumption)",
            measured: `${mjsOnlyOccurrences.reduce((sum, value) => sum + value, 0)} occurrence(s) over ${mjsOnlyFiles.length} .mjs file(s), against ${rawOccurrences.reduce((sum, value) => sum + value, 0)} over ${files.length} with no extension assumption`,
        },
    ],
}
console.log(JSON.stringify(summary, null, 2))
