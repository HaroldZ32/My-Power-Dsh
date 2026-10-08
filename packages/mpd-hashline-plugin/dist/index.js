// packages/mpd-hashline-plugin/src/index.ts
import { existsSync, mkdirSync as mkdirSync2, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join as join2, resolve as resolve3 } from "node:path";

// packages/mpd-hashline-plugin/src/vendor/constants.ts
var NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
var HASHLINE_DICT = Array.from({ length: 256 }, (_, i) => {
  const high = i >>> 4;
  const low = i & 15;
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`;
});
var HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/;
// packages/mpd-hashline-plugin/src/vendor/hash.ts
var PRIME32_1 = 2654435761;
var PRIME32_2 = 2246822519;
var PRIME32_3 = 3266489917;
var PRIME32_4 = 668265263;
var PRIME32_5 = 374761393;
var encoder = new TextEncoder;
var RE_SIGNIFICANT = /[\p{L}\p{N}]/u;
function rotateLeft32(value, bits) {
  return (value << bits | value >>> 32 - bits) >>> 0;
}
function readUint32LittleEndian(input, offset) {
  return ((input[offset] ?? 0) | (input[offset + 1] ?? 0) << 8 | (input[offset + 2] ?? 0) << 16 | (input[offset + 3] ?? 0) << 24) >>> 0;
}
function round32(accumulator, value) {
  const added = accumulator + Math.imul(value, PRIME32_2) >>> 0;
  return Math.imul(rotateLeft32(added, 13), PRIME32_1) >>> 0;
}
function xxh32(text, seed) {
  const input = encoder.encode(text);
  const length = input.length;
  let offset = 0;
  let hash;
  if (length >= 16) {
    let lane1 = seed + PRIME32_1 + PRIME32_2 >>> 0;
    let lane2 = seed + PRIME32_2 >>> 0;
    let lane3 = seed >>> 0;
    let lane4 = seed - PRIME32_1 >>> 0;
    const stripeLimit = length - 16;
    while (offset <= stripeLimit) {
      lane1 = round32(lane1, readUint32LittleEndian(input, offset));
      offset += 4;
      lane2 = round32(lane2, readUint32LittleEndian(input, offset));
      offset += 4;
      lane3 = round32(lane3, readUint32LittleEndian(input, offset));
      offset += 4;
      lane4 = round32(lane4, readUint32LittleEndian(input, offset));
      offset += 4;
    }
    hash = rotateLeft32(lane1, 1) + rotateLeft32(lane2, 7) + rotateLeft32(lane3, 12) + rotateLeft32(lane4, 18) >>> 0;
  } else {
    hash = seed + PRIME32_5 >>> 0;
  }
  hash = hash + length >>> 0;
  while (offset + 4 <= length) {
    hash = Math.imul(rotateLeft32(hash + Math.imul(readUint32LittleEndian(input, offset), PRIME32_3) >>> 0, 17), PRIME32_4) >>> 0;
    offset += 4;
  }
  while (offset < length) {
    hash = Math.imul(rotateLeft32(hash + Math.imul(input[offset] ?? 0, PRIME32_5) >>> 0, 11), PRIME32_1) >>> 0;
    offset += 1;
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, PRIME32_2) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, PRIME32_3) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}
function digestLine(lineNumber, normalizedContent) {
  const seed = RE_SIGNIFICANT.test(normalizedContent) ? 0 : lineNumber;
  const index = xxh32(normalizedContent, seed) % 256;
  return HASHLINE_DICT[index] ?? "";
}
function computeLineHash(lineNumber, content) {
  return digestLine(lineNumber, content.replace(/\r/g, "").trimEnd());
}

// packages/mpd-hashline-plugin/src/vendor/anchors.ts
var MISMATCH_CONTEXT = 2;
var LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2})/;
function normalizeLineRef(ref) {
  const originalTrimmed = ref.trim();
  let trimmed = originalTrimmed;
  trimmed = trimmed.replace(/^(?:>>>|[+-])\s*/, "");
  trimmed = trimmed.replace(/\s*#\s*/, "#");
  trimmed = trimmed.replace(/\|.*$/, "");
  trimmed = trimmed.trim();
  if (HASHLINE_REF_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const extracted = trimmed.match(LINE_REF_EXTRACT_PATTERN);
  if (extracted) {
    return extracted[1] ?? originalTrimmed;
  }
  return originalTrimmed;
}
function parseLineRef(ref) {
  const normalized = normalizeLineRef(ref);
  const match = normalized.match(HASHLINE_REF_PATTERN);
  if (match) {
    return {
      line: Number.parseInt(match[1] ?? "", 10),
      hash: match[2] ?? ""
    };
  }
  const hashIndex = normalized.indexOf("#");
  if (hashIndex > 0) {
    const prefix = normalized.slice(0, hashIndex);
    const suffix = normalized.slice(hashIndex + 1);
    if (!/^\d+$/.test(prefix) && /^[ZPMQVRWSNKTXJBYH]{2}$/.test(suffix)) {
      throw new Error(`Invalid line reference: "${ref}". "${prefix}" is not a line number. ` + "Use the actual line number from the read output.");
    }
  }
  throw new Error(`Invalid line reference format: "${ref}". Expected format: "{line_number}#{hash_id}"`);
}
function suggestLineForHash(ref, lines) {
  const hashMatch = ref.trim().match(/#([ZPMQVRWSNKTXJBYH]{2})$/);
  if (!hashMatch)
    return null;
  const hash = hashMatch[1];
  for (let i = 0;i < lines.length; i++) {
    if (computeLineHash(i + 1, lines[i] ?? "") === hash) {
      return `Did you mean "${i + 1}#${computeLineHash(i + 1, lines[i] ?? "")}"?`;
    }
  }
  return null;
}
function parseLineRefWithHint(ref, lines) {
  try {
    return parseLineRef(ref);
  } catch (parseError) {
    const hint = suggestLineForHash(ref, lines);
    if (hint && parseError instanceof Error) {
      throw new Error(`${parseError.message} ${hint}`);
    }
    throw parseError;
  }
}

class HashlineMismatchError extends Error {
  remaps;
  constructor(mismatches, fileLines) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines));
    this.name = "HashlineMismatchError";
    const remaps = new Map;
    for (const mismatch of mismatches) {
      const actual = computeLineHash(mismatch.line, fileLines[mismatch.line - 1] ?? "");
      remaps.set(`${mismatch.line}#${mismatch.expected}`, `${mismatch.line}#${actual}`);
    }
    this.remaps = remaps;
  }
  static formatMessage(mismatches, fileLines) {
    const mismatchByLine = new Map;
    for (const mismatch of mismatches)
      mismatchByLine.set(mismatch.line, mismatch);
    const displayLines = new Set;
    for (const mismatch of mismatches) {
      const low = Math.max(1, mismatch.line - MISMATCH_CONTEXT);
      const high = Math.min(fileLines.length, mismatch.line + MISMATCH_CONTEXT);
      for (let line = low;line <= high; line++)
        displayLines.add(line);
    }
    const sortedLines = [...displayLines].sort((a, b) => a - b);
    const output = [];
    output.push(`${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. ` + "Use updated {line_number}#{hash_id} references below (>>> marks changed lines).");
    output.push("The file changed between the read that issued these anchors and this edit. Re-read it with " + "mpd_hashline_read to refresh every anchor, and never reuse an anchor from an earlier session.");
    output.push("");
    let previousLine = -1;
    for (const line of sortedLines) {
      if (previousLine !== -1 && line > previousLine + 1) {
        output.push("    ...");
      }
      previousLine = line;
      const content = fileLines[line - 1] ?? "";
      const hash = computeLineHash(line, content);
      const prefix = `${line}#${hash}|${content}`;
      if (mismatchByLine.has(line)) {
        output.push(`>>> ${prefix}`);
      } else {
        output.push(`    ${prefix}`);
      }
    }
    return output.join(`
`);
  }
}
function validateLineRefs(lines, refs) {
  const mismatches = [];
  for (const ref of refs) {
    const { line, hash } = parseLineRefWithHint(ref, lines);
    if (line < 1 || line > lines.length) {
      throw new Error(`Line number ${line} out of bounds (file has ${lines.length} lines)`);
    }
    if (computeLineHash(line, lines[line - 1] ?? "") !== hash) {
      mismatches.push({ line, expected: hash });
    }
  }
  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, lines);
  }
}
// packages/mpd-hashline-plugin/src/vendor/text.ts
function detectLineEnding(content) {
  const lfIndex = content.indexOf(`
`);
  if (lfIndex === -1)
    return `
`;
  const crlfIndex = content.indexOf(`\r
`);
  if (crlfIndex === -1)
    return `
`;
  return crlfIndex < lfIndex ? `\r
` : `
`;
}
function stripBom(content) {
  if (!content.startsWith("\uFEFF")) {
    return { content, hadBom: false };
  }
  return { content: content.slice(1), hadBom: true };
}
function normalizeToLf(content) {
  return content.replace(/\r\n/g, `
`).replace(/\r/g, `
`);
}
function restoreLineEndings(content, lineEnding) {
  if (lineEnding === `
`)
    return content;
  return content.replace(/\n/g, `\r
`);
}
function canonicalizeFileText(content) {
  const stripped = stripBom(content);
  return {
    content: normalizeToLf(stripped.content),
    hadBom: stripped.hadBom,
    lineEnding: detectLineEnding(stripped.content)
  };
}
function restoreFileText(content, envelope) {
  const withLineEnding = restoreLineEndings(content, envelope.lineEnding);
  if (!envelope.hadBom)
    return withLineEnding;
  return `\uFEFF${withLineEnding}`;
}
// packages/mpd-hashline-plugin/src/vendor/edits.ts
var HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+\s*#\s*[ZPMQVRWSNKTXJBYH]{2}\|/;
var DIFF_PLUS_RE = /^[+](?![+])/;
function equalsIgnoringWhitespace(a, b) {
  if (a === b)
    return true;
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}
function leadingWhitespace(text) {
  if (!text)
    return "";
  const match = text.match(/^\s*/);
  return match ? match[0] : "";
}
function arraysEqual(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
function stripLinePrefixes(lines) {
  let hashPrefixCount = 0;
  let diffPlusCount = 0;
  let nonEmpty = 0;
  for (const line of lines) {
    if (line.length === 0)
      continue;
    nonEmpty += 1;
    if (HASHLINE_PREFIX_RE.test(line))
      hashPrefixCount += 1;
    if (DIFF_PLUS_RE.test(line))
      diffPlusCount += 1;
  }
  if (nonEmpty === 0) {
    return lines;
  }
  const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5;
  const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5;
  if (!stripHash && !stripPlus) {
    return lines;
  }
  return lines.map((line) => {
    if (stripHash)
      return line.replace(HASHLINE_PREFIX_RE, "");
    if (stripPlus)
      return line.replace(DIFF_PLUS_RE, "");
    return line;
  });
}
function toNewLines(input) {
  if (Array.isArray(input)) {
    return stripLinePrefixes(input);
  }
  return stripLinePrefixes(input.split(`
`));
}
function restoreLeadingIndent(templateLine, line) {
  if (line.length === 0)
    return line;
  const templateIndent = leadingWhitespace(templateLine);
  if (templateIndent.length === 0)
    return line;
  if (leadingWhitespace(line).length > 0)
    return line;
  if (templateLine.trim() === line.trim())
    return line;
  return `${templateIndent}${line}`;
}
function stripInsertAnchorEcho(anchorLine, newLines) {
  if (newLines.length === 0)
    return newLines;
  if (equalsIgnoringWhitespace(newLines[0] ?? "", anchorLine)) {
    return newLines.slice(1);
  }
  return newLines;
}
function stripInsertBeforeEcho(anchorLine, newLines) {
  if (newLines.length <= 1)
    return newLines;
  if (equalsIgnoringWhitespace(newLines[newLines.length - 1] ?? "", anchorLine)) {
    return newLines.slice(0, -1);
  }
  return newLines;
}
function stripRangeBoundaryEcho(lines, startLine, endLine, newLines) {
  const replacedCount = endLine - startLine + 1;
  if (newLines.length <= 1 || newLines.length <= replacedCount) {
    return newLines;
  }
  let out = newLines;
  const beforeIndex = startLine - 2;
  if (beforeIndex >= 0 && out[0] === lines[beforeIndex]) {
    out = out.slice(1);
  }
  const afterIndex = endLine;
  if (afterIndex < lines.length && out.length > 0 && out[out.length - 1] === lines[afterIndex]) {
    out = out.slice(0, -1);
  }
  return out;
}
function applySetLine(lines, anchor, newText) {
  const { line } = parseLineRef(anchor);
  const result = [...lines];
  const originalLine = lines[line - 1] ?? "";
  const replacement = toNewLines(newText).map((entry, index) => {
    if (index !== 0)
      return entry;
    return restoreLeadingIndent(originalLine, entry);
  });
  result.splice(line - 1, 1, ...replacement);
  return result;
}
function applyReplaceLines(lines, startAnchor, endAnchor, newText) {
  const { line: startLine } = parseLineRef(startAnchor);
  const { line: endLine } = parseLineRef(endAnchor);
  if (startLine > endLine) {
    throw new Error(`Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`);
  }
  const result = [...lines];
  const stripped = stripRangeBoundaryEcho(lines, startLine, endLine, toNewLines(newText));
  const restored = stripped.map((entry, index) => {
    if (index !== 0)
      return entry;
    return restoreLeadingIndent(lines[startLine - 1] ?? "", entry);
  });
  result.splice(startLine - 1, endLine - startLine + 1, ...restored);
  return result;
}
function applyInsertAfter(lines, anchor, text) {
  const { line } = parseLineRef(anchor);
  const result = [...lines];
  const newLines = stripInsertAnchorEcho(lines[line - 1] ?? "", toNewLines(text));
  if (newLines.length === 0) {
    throw new Error(`append (anchored) requires non-empty text for ${anchor}`);
  }
  result.splice(line, 0, ...newLines);
  return result;
}
function applyInsertBefore(lines, anchor, text) {
  const { line } = parseLineRef(anchor);
  const result = [...lines];
  const newLines = stripInsertBeforeEcho(lines[line - 1] ?? "", toNewLines(text));
  if (newLines.length === 0) {
    throw new Error(`prepend (anchored) requires non-empty text for ${anchor}`);
  }
  result.splice(line - 1, 0, ...newLines);
  return result;
}
function applyAppend(lines, text) {
  const normalized = toNewLines(text);
  if (normalized.length === 0) {
    throw new Error("append requires non-empty text");
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized];
  }
  const base = lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  return [...base, ...normalized];
}
function applyPrepend(lines, text) {
  const normalized = toNewLines(text);
  if (normalized.length === 0) {
    throw new Error("prepend requires non-empty text");
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized];
  }
  return [...normalized, ...lines];
}
function normalizeEditPayload(payload) {
  return toNewLines(payload).join(`
`);
}
function canonicalAnchor(anchor) {
  if (!anchor)
    return "";
  return normalizeLineRef(anchor);
}
function buildDedupeKey(edit) {
  switch (edit.op) {
    case "replace":
      return `replace|${canonicalAnchor(edit.pos)}|${edit.end ? canonicalAnchor(edit.end) : ""}|${normalizeEditPayload(edit.lines)}`;
    case "append":
      return `append|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`;
    case "prepend":
      return `prepend|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`;
    default:
      return JSON.stringify(edit);
  }
}
function dedupeEdits(edits) {
  const seen = new Set;
  const deduped = [];
  let deduplicatedEdits = 0;
  for (const edit of edits) {
    const key = buildDedupeKey(edit);
    if (seen.has(key)) {
      deduplicatedEdits += 1;
      continue;
    }
    seen.add(key);
    deduped.push(edit);
  }
  return { edits: deduped, deduplicatedEdits };
}
function getEditLineNumber(edit) {
  switch (edit.op) {
    case "replace":
      return parseLineRef(edit.end ?? edit.pos).line;
    case "append":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY;
    case "prepend":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY;
    default:
      return Number.POSITIVE_INFINITY;
  }
}
function collectLineRefs(edits) {
  return edits.flatMap((edit) => {
    switch (edit.op) {
      case "replace":
        return edit.end ? [edit.pos, edit.end] : [edit.pos];
      case "append":
      case "prepend":
        return edit.pos ? [edit.pos] : [];
      default:
        return [];
    }
  });
}
function detectOverlappingRanges(edits) {
  const ranges = [];
  for (let i = 0;i < edits.length; i++) {
    const edit = edits[i];
    if (!edit || edit.op !== "replace" || !edit.end)
      continue;
    const start = parseLineRef(edit.pos).line;
    const end = parseLineRef(edit.end).line;
    ranges.push({ start, end, idx: i });
  }
  if (ranges.length < 2)
    return null;
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1;i < ranges.length; i++) {
    const prev = ranges[i - 1];
    const curr = ranges[i];
    if (prev && curr && curr.start <= prev.end) {
      return "Overlapping range edits detected: " + `edit ${prev.idx + 1} (lines ${prev.start}-${prev.end}) overlaps with ` + `edit ${curr.idx + 1} (lines ${curr.start}-${curr.end}). ` + "Use pos-only replace for single-line edits.";
    }
  }
  return null;
}
function normalizeAnchor(value) {
  if (typeof value !== "string")
    return;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
function requireLines(edit, index) {
  if (edit.lines === undefined) {
    throw new Error(`Edit ${index}: lines is required for ${edit.op ?? "unknown"}`);
  }
  if (edit.lines === null) {
    return [];
  }
  return edit.lines;
}
function requireLine(anchor, index, op) {
  if (!anchor) {
    throw new Error(`Edit ${index}: ${op} requires at least one anchor line reference (pos or end)`);
  }
  return anchor;
}
function normalizeReplaceEdit(edit, index) {
  const pos = normalizeAnchor(edit.pos);
  const end = normalizeAnchor(edit.end);
  const anchor = requireLine(pos ?? end, index, "replace");
  const lines = requireLines(edit, index);
  const normalized = { op: "replace", pos: anchor, lines };
  if (end)
    normalized.end = end;
  return normalized;
}
function normalizeAppendEdit(edit, index) {
  const pos = normalizeAnchor(edit.pos);
  const end = normalizeAnchor(edit.end);
  const anchor = pos ?? end;
  const lines = requireLines(edit, index);
  const normalized = { op: "append", lines };
  if (anchor)
    normalized.pos = anchor;
  return normalized;
}
function normalizePrependEdit(edit, index) {
  const pos = normalizeAnchor(edit.pos);
  const end = normalizeAnchor(edit.end);
  const anchor = pos ?? end;
  const lines = requireLines(edit, index);
  const normalized = { op: "prepend", lines };
  if (anchor)
    normalized.pos = anchor;
  return normalized;
}
function normalizeHashlineEdits(rawEdits) {
  return rawEdits.map((rawEdit, index) => {
    const edit = rawEdit ?? {};
    switch (edit.op) {
      case "replace":
        return normalizeReplaceEdit(edit, index);
      case "append":
        return normalizeAppendEdit(edit, index);
      case "prepend":
        return normalizePrependEdit(edit, index);
      default:
        throw new Error(`Edit ${index}: unsupported op "${String(edit.op)}". Legacy format was removed; use op/pos/end/lines.`);
    }
  });
}
function applyHashlineEditsWithReport(content, edits) {
  if (edits.length === 0) {
    return { content, noopEdits: 0, deduplicatedEdits: 0 };
  }
  const dedupeResult = dedupeEdits(edits);
  const EDIT_PRECEDENCE = { replace: 0, append: 1, prepend: 2 };
  const sortedEdits = [...dedupeResult.edits].sort((a, b) => {
    const lineA = getEditLineNumber(a);
    const lineB = getEditLineNumber(b);
    if (lineB !== lineA)
      return lineB - lineA;
    return (EDIT_PRECEDENCE[a.op] ?? 3) - (EDIT_PRECEDENCE[b.op] ?? 3);
  });
  let noopEdits = 0;
  let lines = content.length === 0 ? [] : content.split(`
`);
  const refs = collectLineRefs(sortedEdits);
  validateLineRefs(lines, refs);
  const overlapError = detectOverlappingRanges(sortedEdits);
  if (overlapError)
    throw new Error(overlapError);
  for (const edit of sortedEdits) {
    switch (edit.op) {
      case "replace": {
        const next = edit.end ? applyReplaceLines(lines, edit.pos, edit.end, edit.lines) : applySetLine(lines, edit.pos, edit.lines);
        if (arraysEqual(next, lines)) {
          noopEdits += 1;
          break;
        }
        lines = next;
        break;
      }
      case "append": {
        const next = edit.pos ? applyInsertAfter(lines, edit.pos, edit.lines) : applyAppend(lines, edit.lines);
        if (arraysEqual(next, lines)) {
          noopEdits += 1;
          break;
        }
        lines = next;
        break;
      }
      case "prepend": {
        const next = edit.pos ? applyInsertBefore(lines, edit.pos, edit.lines) : applyPrepend(lines, edit.lines);
        if (arraysEqual(next, lines)) {
          noopEdits += 1;
          break;
        }
        lines = next;
        break;
      }
    }
  }
  return {
    content: lines.join(`
`),
    noopEdits,
    deduplicatedEdits: dedupeResult.deduplicatedEdits
  };
}
// packages/mpd-hashline-plugin/src/vendor/diff.ts
var DIFF_CONTEXT = 3;
function toHashlineContent(content) {
  if (!content)
    return content;
  const lines = content.split(`
`);
  const lastLine = lines[lines.length - 1];
  const hasTrailingNewline = lastLine === "";
  const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const hashlined = contentLines.map((line, index) => {
    const lineNumber = index + 1;
    const hash = computeLineHash(lineNumber, line);
    return `${lineNumber}#${hash}|${line}`;
  });
  return hasTrailingNewline ? hashlined.join(`
`) + `
` : hashlined.join(`
`);
}
function lcsOp(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1;i2 >= 0; i2--) {
    for (let j2 = m - 1;j2 >= 0; j2--) {
      dp[i2][j2] = oldLines[i2] === newLines[j2] ? (dp[i2 + 1][j2 + 1] ?? 0) + 1 : Math.max(dp[i2 + 1][j2] ?? 0, dp[i2][j2 + 1] ?? 0);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ t: "eq", a: i, b: j, lines: [oldLines[i] ?? ""] });
      i++;
      j++;
    } else if ((dp[i + 1][j] ?? 0) >= (dp[i][j + 1] ?? 0)) {
      ops.push({ t: "del", a: i, b: j, lines: [oldLines[i] ?? ""] });
      i++;
    } else {
      ops.push({ t: "ins", a: i, b: j, lines: [newLines[j] ?? ""] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ t: "del", a: i, b: j, lines: [oldLines[i] ?? ""] });
    i++;
  }
  while (j < m) {
    ops.push({ t: "ins", a: i, b: j, lines: [newLines[j] ?? ""] });
    j++;
  }
  return ops;
}
function groupHunks(ops, context) {
  const changes = [];
  for (let index = 0;index < ops.length; index++) {
    if (ops[index]?.t !== "eq")
      changes.push(index);
  }
  if (changes.length === 0)
    return [];
  const hunks = [];
  let first = changes[0] ?? 0;
  let last = first;
  for (const index of changes.slice(1)) {
    if (index - last <= context * 2 + 1) {
      last = index;
      continue;
    }
    hunks.push({ start: Math.max(0, first - context), end: Math.min(ops.length, last + context + 1) });
    first = index;
    last = index;
  }
  hunks.push({ start: Math.max(0, first - context), end: Math.min(ops.length, last + context + 1) });
  return hunks;
}
function generateUnifiedDiff(oldContent, newContent, filePath) {
  const oldLines = oldContent.split(`
`);
  const newLines = newContent.split(`
`);
  const ops = lcsOp(oldLines, newLines);
  const out = [];
  out.push("--- " + filePath);
  out.push("+++ " + filePath);
  for (const hunk of groupHunks(ops, DIFF_CONTEXT)) {
    let aStart = -1;
    let aCount = 0;
    let bStart = -1;
    let bCount = 0;
    const body = [];
    for (const op of ops.slice(hunk.start, hunk.end)) {
      if (aStart === -1)
        aStart = op.a;
      if (bStart === -1)
        bStart = op.b;
      if (op.t === "eq") {
        aCount++;
        bCount++;
        body.push(" " + (op.lines[0] ?? ""));
      } else if (op.t === "del") {
        aCount++;
        body.push("-" + (op.lines[0] ?? ""));
      } else {
        bCount++;
        body.push("+" + (op.lines[0] ?? ""));
      }
    }
    const aPos = aCount ? aStart + 1 : 0;
    const bPos = bCount ? bStart + 1 : 0;
    out.push("@@ -" + aPos + "," + aCount + " +" + bPos + "," + bCount + " @@");
    out.push(...body);
  }
  return out.join(`
`) + `
`;
}
// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve as resolve2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/shared.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
var LOG_SUBDIR = join(".mpd", "logs");
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DEFAULT_MAX_LINE_BYTES = 8192;
var DEFAULT_RING_LINES = 64;
function truncationMarker(droppedBytes) {
  return ` … [mpd log sink: ${droppedBytes} more byte(s) truncated]`;
}
function resolveLogRoots(env = process.env, cwd) {
  let working = cwd;
  if (working === undefined) {
    try {
      working = process.cwd();
    } catch {
      working = undefined;
    }
  }
  const raw = [env.MPD_MCP_LOG_DIR, env.DSH_WORKSPACE_ROOT, working, tmpdir()];
  const roots = [];
  const seen = new Set;
  for (const candidate of raw) {
    if (typeof candidate !== "string" || candidate.trim().length === 0)
      continue;
    let absolute;
    try {
      absolute = resolve(candidate);
    } catch {
      continue;
    }
    if (seen.has(absolute))
      continue;
    seen.add(absolute);
    roots.push(absolute);
  }
  return roots;
}
function tryOpenRoot(root, name) {
  try {
    const dir = join(root, LOG_SUBDIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.log`);
    return { fd: openSync(file, "a"), file };
  } catch {
    return null;
  }
}
function owningRoot(roots, file) {
  for (const root of roots) {
    if (file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`))
      return root;
  }
  return null;
}
var captured = null;
function openLogSink(name, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const ringLines = options.ringLines ?? DEFAULT_RING_LINES;
  const timestamps = options.timestamps ?? true;
  const roots = options.roots ?? resolveLogRoots(options.env ?? process.env);
  let open = null;
  for (const root of roots) {
    const attempt = tryOpenRoot(root, name);
    if (attempt !== null) {
      open = attempt;
      break;
    }
  }
  let size = 0;
  if (open !== null) {
    try {
      size = statSync(open.file).size;
    } catch {
      size = 0;
    }
  }
  let accepted = 0;
  let droppedCount = 0;
  let rotations = 0;
  const ring = [];
  let undoCapture = null;
  let rebindOutcome = "skipped";
  let rebind = null;
  const remember = (record) => {
    if (ring.length >= ringLines) {
      ring.shift();
      droppedCount += 1;
    }
    ring.push(record);
  };
  const rotate = () => {
    if (open === null)
      return;
    try {
      closeSync(open.fd);
      rmSync(`${open.file}.1`, { force: true });
      renameSync(open.file, `${open.file}.1`);
      open = { fd: openSync(open.file, "a"), file: open.file };
      size = 0;
      rotations += 1;
      sink.rebindNow();
    } catch {
      try {
        open = { fd: openSync(open.file, "a"), file: open.file };
      } catch {
        open = null;
      }
    }
  };
  const append = (record) => {
    if (open === null) {
      remember(record);
      return;
    }
    const bytes = Buffer.byteLength(record, "utf8");
    if (size > 0 && size + bytes > maxBytes)
      rotate();
    if (open === null) {
      remember(record);
      return;
    }
    try {
      writeSync(open.fd, record);
      size += bytes;
    } catch {
      remember(record);
    }
  };
  const acceptedRoot = open === null ? null : owningRoot(roots, open.file);
  const sink = {
    name,
    file: open?.file ?? null,
    root: acceptedRoot,
    write(line) {
      try {
        const body = line.endsWith(`
`) ? line.slice(0, -1) : line;
        const capped = Buffer.byteLength(body, "utf8") > maxLineBytes ? capLine(body, maxLineBytes) : body;
        const record = `${timestamps ? `[${new Date().toISOString()}] ` : ""}${capped}
`;
        accepted += 1;
        append(record);
      } catch {}
    },
    fd() {
      return open?.fd ?? null;
    },
    written() {
      return accepted;
    },
    dropped() {
      return droppedCount;
    },
    rotations() {
      return rotations;
    },
    ring() {
      return [...ring];
    },
    stderrRebind() {
      return rebindOutcome;
    },
    restore() {
      if (undoCapture === null)
        return;
      undoCapture();
      undoCapture = null;
      if (captured === sink)
        captured = null;
    }
  };
  sink.attachCapture = (undo, onRebind) => {
    undoCapture = undo;
    rebind = onRebind;
  };
  sink.rebindNow = () => {
    if (rebind === null)
      return;
    rebindOutcome = rebind();
  };
  sink.setRebindOutcome = (outcome) => {
    rebindOutcome = outcome;
  };
  return sink;
}
function capLine(body, maxLineBytes) {
  const kept = Buffer.from(body, "utf8").subarray(0, maxLineBytes).toString("utf8");
  return kept + truncationMarker(Buffer.byteLength(body, "utf8") - Buffer.byteLength(kept, "utf8"));
}
// packages/mpd-dsh-adapter-plugin/src/index.ts
var DSH_SEAM_TOOLS = "tools";
function dshSeamInject(...names) {
  return [...names];
}
var OBJECT_SCHEMA = { type: "object", properties: {} };
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
var TEAM_TASK_METHODS = ["createTask", "getTask", "listTasks", "updateTask"];
function textBlock(content) {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }];
}
function userMessage(input) {
  const content = textBlock(input?.text);
  for (const block of content)
    Object.freeze(block);
  Object.freeze(content);
  const source = { kind: "user", ...input?.source ?? {} };
  Object.freeze(source);
  const message = { id: randomUUID(), role: "user", content, source };
  return Object.freeze(message);
}
function sessionCwdOf(agent) {
  try {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
  } catch {
    return;
  }
}
function workspaceRootOf(exec) {
  const session = sessionCwdOf(exec?.agent);
  if (session !== undefined)
    return resolve2(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve2(override);
  return process.cwd();
}
var rowLogSinks = new Map;
function rowLogLine(name, line) {
  try {
    const root = workspaceRootOf(undefined);
    let entry = rowLogSinks.get(name);
    if (entry === undefined || entry.root !== root) {
      entry = { root, sink: openLogSink(name, { roots: [root] }) };
      rowLogSinks.set(name, entry);
    }
    entry.sink.write(line);
  } catch {}
}
function workspaceRootsOf(agents) {
  if (agents === undefined || agents === null || typeof agents.list !== "function")
    return [];
  try {
    const list = agents.list();
    if (!Array.isArray(list))
      return [];
    const roots = new Set;
    for (const agent of list) {
      const cwd = sessionCwdOf(agent);
      if (cwd !== undefined)
        roots.add(resolve2(cwd));
    }
    return [...roots];
  } catch {
    return [];
  }
}
function noop() {}
var GOAL_TOOL_NAMES = ["get_goal", "create_goal", "update_goal"];
function goalSnapshotOf(view) {
  if (view === null || view === undefined || typeof view !== "object")
    return;
  const raw = view;
  if (typeof raw.id !== "string" || raw.id === "")
    return;
  const snapshot = {
    id: raw.id,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    objective: typeof raw.objective === "string" ? raw.objective : "",
    phase: raw.phase === "paused" || raw.phase === "blocked" || raw.phase === "complete" ? raw.phase : "active",
    maxGoalRounds: typeof raw.maxGoalRounds === "number" ? raw.maxGoalRounds : 0
  };
  if (typeof raw.roundsStarted === "number")
    snapshot.roundsStarted = raw.roundsStarted;
  if (raw.activation === "armed" || raw.activation === "disarmed")
    snapshot.activation = raw.activation;
  const reason = raw.blockedReason;
  if (reason !== null && typeof reason === "object") {
    const code = reason.code;
    const message = reason.message;
    if (typeof code === "string" && code !== "" && typeof message === "string" && message !== "") {
      snapshot.blockedReason = { code, message };
    }
  }
  return snapshot;
}
function goalValueOf(value) {
  if (value === null || value === undefined || typeof value !== "object")
    return { goal: null };
  const raw = value;
  const activation = raw.activation === "armed" || raw.activation === "disarmed" ? raw.activation : undefined;
  const goal = goalSnapshotOf(raw.goal);
  if (goal === undefined)
    return activation === undefined ? { goal: null } : { goal: null, activation };
  if (activation !== undefined)
    goal.activation = activation;
  return activation === undefined ? { goal } : { goal, activation };
}
function scopeOfAgentContext(agent) {
  let context;
  try {
    context = agent?.ctx;
  } catch {
    return;
  }
  if (context === undefined || context === null)
    return;
  const kind = typeof context;
  if (kind !== "object" && kind !== "function")
    return;
  let on;
  let effect;
  let restrict;
  try {
    const scoped = context;
    on = scoped.on;
    effect = scoped.effect;
    restrict = scoped.tools?.restrict;
  } catch {
    return;
  }
  if (typeof on !== "function" || typeof effect !== "function" || typeof restrict !== "function")
    return;
  const tools = context.tools;
  return {
    context,
    tools: { restrict: (filter) => restrict.call(tools, filter) },
    on: (event, handler) => on.call(context, event, handler),
    effect: (fn, label) => effect.call(context, fn, label)
  };
}
function teamContextOf(raw) {
  return raw === "fresh" || raw === "fork" ? raw : undefined;
}
function teamStatusOf(raw) {
  return raw === "running" || raw === "provisioning" || raw === "failed" ? raw : "inactive";
}
function teamTaskStatusOf(raw) {
  return raw === "in_progress" || raw === "completed" || raw === "deleted" ? raw : "pending";
}
function teamStrings(raw) {
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === "string") : [];
}
function teamMemberView(raw) {
  const row = raw ?? {};
  const context = teamContextOf(row.context);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: row.role === "lead" ? "lead" : "teammate",
    status: teamStatusOf(row.status),
    ...typeof row.description === "string" ? { description: row.description } : {},
    ...typeof row.provider === "string" ? { provider: row.provider } : {},
    ...context === undefined ? {} : { context },
    ...typeof row.model === "string" ? { model: row.model } : {},
    diagnostics: teamStrings(row.diagnostics)
  };
}
function teamTaskView(raw) {
  const row = raw ?? {};
  return {
    id: String(row.id ?? ""),
    revision: typeof row.revision === "number" ? row.revision : 0,
    subject: String(row.subject ?? ""),
    description: String(row.description ?? ""),
    status: teamTaskStatusOf(row.status),
    blockedBy: teamStrings(row.blockedBy),
    writeScopes: teamStrings(row.writeScopes),
    ...typeof row.ownerName === "string" ? { ownerName: row.ownerName } : {},
    ready: row.ready === true,
    writeScopeWarnings: teamStrings(row.writeScopeWarnings)
  };
}
function teamRows(teams, method, agent, project) {
  const reader = teams?.[method];
  if (typeof reader !== "function")
    return [];
  try {
    const rows = reader.call(teams, agent);
    return Array.isArray(rows) ? rows.map(project) : [];
  } catch {
    return [];
  }
}
function scopeContextOf(agent) {
  try {
    return agent?.ctx;
  } catch {
    return;
  }
}
function preStepWrapper(listener) {
  return async (payload, next) => {
    const fallback = { kind: "enter", messages: payload?.messages ?? [] };
    const downstream = typeof next === "function" ? await next() ?? fallback : fallback;
    try {
      const decided = await listener(payload ?? {}, downstream);
      return decided ?? downstream;
    } catch {
      return downstream;
    }
  };
}
function agentSystemPromptOf(agent) {
  const context = scopeContextOf(agent);
  if (context === undefined || context === null)
    return;
  try {
    const systemPrompt = context.systemPrompt;
    return typeof systemPrompt?.section === "function" ? systemPrompt : undefined;
  } catch {
    return;
  }
}
function createDshAdapter(ctx, config = {}) {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  let scopedSettings;
  const settingsService = () => scopedSettings ?? service("settings");
  const service = (serviceName) => {
    if (typeof ctx?.get === "function") {
      try {
        const viaGet = ctx.get(serviceName);
        if (viaGet !== undefined && viaGet !== null)
          return viaGet;
      } catch {}
    }
    try {
      return ctx?.[serviceName];
    } catch {
      return;
    }
  };
  function requireService(serviceName, needed) {
    const found = service(serviceName);
    if (found === undefined || found === null) {
      throw new Error(`mpd-dsh-adapter: harness service "${serviceName}" is unavailable — ${needed}`);
    }
    return found;
  }
  const workspaceRoot = (exec) => workspaceRootOf(exec);
  const workspaceRootsAll = () => workspaceRootsOf(service("agents"));
  const rowLog = (name, line) => rowLogLine(name, line);
  function liveAgents() {
    const agents = service("agents");
    if (agents === undefined || typeof agents.list !== "function")
      return [];
    try {
      const list = agents.list();
      return Array.isArray(list) ? list.filter((entry) => entry !== undefined && entry !== null) : [];
    } catch {
      return [];
    }
  }
  function liveAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const agents = service("agents");
    if (agents !== undefined && typeof agents.get === "function") {
      try {
        const found = agents.get(id);
        if (found !== undefined && found !== null)
          return found;
      } catch {}
    }
    return liveAgents().find((candidate) => candidate.id === id);
  }
  const engineCache = new WeakMap;
  function compactionEngineForAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const agent = liveAgent(id);
    if (agent === undefined || agent === null)
      return;
    const cached = engineCache.get(agent);
    if (cached !== undefined)
      return cached;
    const scoped = agent.ctx;
    if (scoped === undefined || scoped === null)
      return;
    let engine;
    try {
      engine = typeof scoped.get === "function" ? scoped.get("compaction") : undefined;
    } catch {
      return;
    }
    if (engine === undefined || engine === null)
      return;
    engineCache.set(agent, engine);
    return engine;
  }
  function onEvent(event, handler) {
    if (typeof ctx?.on !== "function")
      return;
    try {
      const disposer = ctx.on(event, handler);
      return typeof disposer === "function" ? disposer : () => {};
    } catch {
      return;
    }
  }
  const LLM_CATALOG_METHODS = ["listProviders", "listModels", "resolveModelInfo"];
  let llmCatalogWarned = false;
  function warnLlmCatalogOnce(detail) {
    if (llmCatalogWarned)
      return;
    llmCatalogWarned = true;
    try {
      rowLogLine("mpd-dsh-adapter", "mpd-dsh-adapter: llmCatalog degraded — " + detail);
    } catch {}
  }
  function catalogLabel(value, id) {
    return typeof value === "string" && value.length > 0 ? value : id;
  }
  async function llmCatalog() {
    const llm = service("llm");
    if (llm === undefined || llm === null) {
      warnLlmCatalogOnce("the harness llm service is unavailable");
      return { providers: [], degraded: true };
    }
    const missing = LLM_CATALOG_METHODS.filter((method) => typeof llm?.[method] !== "function");
    if (missing.length > 0) {
      warnLlmCatalogOnce("the harness llm service lacks " + missing.join(", "));
      return { providers: [], degraded: true };
    }
    let providers;
    try {
      providers = await llm.listProviders();
    } catch (error) {
      warnLlmCatalogOnce("listProviders() failed: " + errorMessage(error));
      return { providers: [], degraded: true };
    }
    if (!Array.isArray(providers)) {
      warnLlmCatalogOnce("listProviders() did not return an array");
      return { providers: [], degraded: true };
    }
    let degraded = false;
    const catalog = [];
    for (const rawProvider of providers) {
      const providerId = typeof rawProvider?.id === "string" ? rawProvider.id : undefined;
      if (providerId === undefined) {
        degraded = true;
        continue;
      }
      try {
        const models = await llm.listModels(providerId);
        if (!Array.isArray(models))
          throw new Error("listModels(" + providerId + ") did not return an array");
        const entries = [];
        for (const rawModel of models) {
          const modelId = typeof rawModel?.id === "string" ? rawModel.id : undefined;
          if (modelId === undefined) {
            degraded = true;
            continue;
          }
          let resolved;
          try {
            resolved = await llm.resolveModelInfo(providerId, modelId);
          } catch {
            degraded = true;
            continue;
          }
          const reasoning = resolved?.reasoning;
          const efforts = [];
          const rawEfforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : [];
          for (const rawEffort of rawEfforts) {
            const effortId = typeof rawEffort?.id === "string" ? rawEffort.id : undefined;
            if (effortId === undefined)
              continue;
            efforts.push({
              id: effortId,
              name: catalogLabel(rawEffort?.name, effortId),
              ...typeof rawEffort?.description === "string" ? { description: rawEffort.description } : {}
            });
          }
          const defaultEffort = typeof reasoning?.defaultEffort === "string" ? reasoning.defaultEffort : undefined;
          entries.push({
            id: modelId,
            name: catalogLabel(rawModel?.name, modelId),
            ...typeof rawModel?.description === "string" ? { description: rawModel.description } : {},
            efforts,
            ...defaultEffort === undefined ? {} : { defaultEffort }
          });
        }
        catalog.push({ id: providerId, name: catalogLabel(rawProvider?.name, providerId), models: entries });
      } catch {
        degraded = true;
        continue;
      }
    }
    return { providers: catalog, degraded };
  }
  function timeoutSignal(timeoutMs) {
    try {
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function")
        return AbortSignal.timeout(timeoutMs);
    } catch {}
    return;
  }
  const nativeMembers = new Map;
  const officialMembers = new Map;
  const neverAborted = () => new AbortController().signal;
  const sessionIdOfAgent = (agent) => {
    const session = agent?.session;
    return typeof session?.id === "string" ? session.id : "";
  };
  function nativeTeamExecutor(reason, ready) {
    const subagentsOf = () => service("subagents");
    return {
      kind: "native",
      reason,
      providers: () => {
        try {
          const list = subagentsOf()?.providers;
          if (typeof list !== "function")
            return [];
          const names = list.call(subagentsOf());
          return Array.isArray(names) ? names.filter((entry) => typeof entry === "string") : [];
        } catch {
          return [];
        }
      },
      async spawn(caller, request) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot raise team member "${request.name}"`);
        if (typeof subagents.startContinuable !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable() — cannot raise a team member");
        }
        const spec = {
          provider: typeof request.provider === "string" && request.provider !== "" ? request.provider : "spawn",
          label: `${request.name} · ${request.teamId}`,
          request: {
            prompt: textBlock(request.prompt),
            parent: caller,
            ...request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }
          },
          signal: request.signal ?? neverAborted()
        };
        const started = await subagents.startContinuable.call(subagents, spec);
        const handle = String(started?.childId ?? started?.id ?? "");
        if (handle === "")
          throw new Error(`mpd-dsh-adapter: the native backend raised "${request.name}" but reported no child id`);
        nativeMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name, description: request.description });
        return { handle, executor: "native" };
      },
      async send(caller, handle, content, signal) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot deliver a message to team member "${handle}"`);
        if (typeof subagents.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no sendMessage() — cannot deliver to a team member");
        }
        await subagents.sendMessage.call(subagents, caller, handle, textBlock(content), { signal: signal ?? neverAborted() });
      },
      async interrupt(caller, handle) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot interrupt team member "${handle}"`);
        if (typeof subagents.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt() — cannot interrupt a team member");
        }
        subagents.interrupt.call(subagents, handle, { kind: "ancestor", agent: caller });
      },
      membership(agent) {
        const id = sessionIdOfAgent(agent);
        if (id === "")
          return;
        const entry = nativeMembers.get(id);
        return entry === undefined ? undefined : { teamId: entry.teamId, role: "teammate", name: entry.name };
      },
      members: () => [...nativeMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name }))
    };
  }
  function officialTeamExecutor() {
    return {
      kind: "official",
      reason: "official: the native seams are unavailable, so the mounted Agent Teams service executes the team",
      providers: () => [],
      async spawn(caller, request) {
        const teams = requireService("agentTeams", `cannot raise team member "${request.name}"`);
        if (typeof teams.spawnTeammate !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no spawnTeammate() — cannot raise a team member");
        }
        const spawned = await teams.spawnTeammate.call(teams, caller, {
          name: request.name,
          description: request.description === "" ? request.name : request.description,
          prompt: request.prompt,
          ...request.signal === undefined ? {} : { signal: request.signal }
        });
        const handle = String(spawned?.id ?? spawned?.sessionId ?? spawned?.member?.id ?? "");
        if (handle === "")
          throw new Error(`mpd-dsh-adapter: the official backend raised "${request.name}" but reported no id`);
        officialMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name });
        return { handle, executor: "official" };
      },
      async send(caller, handle, content, signal) {
        const teams = requireService("agentTeams", `cannot deliver a message to team member "${handle}"`);
        if (typeof teams.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no sendMessage() — cannot deliver to a team member");
        }
        await teams.sendMessage.call(teams, caller, { target: handle, content: textBlock(content), ...signal === undefined ? {} : { signal } });
      },
      async interrupt(caller, handle) {
        const teams = requireService("agentTeams", `cannot interrupt team member "${handle}"`);
        if (typeof teams.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no interrupt() — cannot interrupt a team member");
        }
        const target = officialMembers.get(handle)?.name ?? handle;
        teams.interrupt.call(teams, caller, target);
      },
      membership: (agent) => {
        const teams = service("agentTeams");
        const tryMembership = teams?.tryMembership;
        if (typeof tryMembership !== "function")
          return;
        try {
          const membership = tryMembership.call(teams, agent);
          if (membership === undefined || membership === null)
            return;
          const role = membership.role;
          if (role !== "lead" && role !== "teammate")
            return;
          return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") };
        } catch {
          return;
        }
      },
      members: () => [...officialMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name }))
    };
  }
  function scopedToolRegistry(agent) {
    const scope = scopeOfAgentContext(agent);
    if (scope === undefined)
      return;
    try {
      const tools = scope.context?.tools;
      return typeof tools?.execute === "function" ? tools : undefined;
    } catch {
      return;
    }
  }
  function hostToolDefinition(name) {
    try {
      const hostView = service("tools");
      return typeof hostView?.get === "function" ? hostView.get(name) : undefined;
    } catch {
      return;
    }
  }
  function toolDefinitionFor(name, agent) {
    if (agent === undefined)
      return hostToolDefinition(name);
    const scoped = scopedToolRegistry(agent);
    if (scoped === undefined)
      return hostToolDefinition(name);
    try {
      return scoped.get(name, agent);
    } catch {
      return;
    }
  }
  function toolReachable(name) {
    if (hostToolDefinition(name) !== undefined)
      return true;
    return liveAgents().some((candidate) => toolDefinitionFor(name, candidate) !== undefined);
  }
  function projectToolResult(raw) {
    const record = raw;
    if (record?.isError === true) {
      const error = record.error;
      return { ok: false, isError: true, error: error?.message ?? error ?? "tool error", raw };
    }
    return { ok: true, isError: false, value: record?.value, raw };
  }
  async function executeToolForAgent(input) {
    const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10);
    const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs);
    const scoped = input.agent === undefined ? undefined : scopedToolRegistry(input.agent);
    if (scoped !== undefined) {
      try {
        const raw = await scoped.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...signal === undefined ? {} : { signal },
          ...input.agent === undefined ? {} : { agent: input.agent }
        });
        return { result: projectToolResult(raw), via: "agent-scope" };
      } catch (error) {
        return { result: { ok: false, isError: true, error: errorMessage(error) }, via: "agent-scope" };
      }
    }
    const result = await adapter.executeTool({
      name: input.name,
      arguments: input.arguments ?? {},
      callId,
      ...signal === undefined ? {} : { signal },
      ...input.agent === undefined ? {} : { agent: input.agent },
      ...input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }
    });
    return { result, via: "host-plane" };
  }
  const adapter = {
    capabilities() {
      const tools = service("tools");
      const subagents = service("subagents");
      const skills = service("skills");
      const presets = service("agentPresets");
      const commands = service("commands");
      const agents = service("agents");
      const compaction = service("compaction");
      const llmService = service("llm");
      const systemPrompt = service("systemPrompt");
      const agentTeams = service("agentTeams");
      const goalService = service("goals");
      const sample = liveAgents()[0];
      const sampleScoped = sample?.ctx;
      let scopedCompaction = false;
      try {
        scopedCompaction = sampleScoped !== undefined && typeof sampleScoped.get === "function" && sampleScoped.get("compaction") !== undefined;
      } catch {
        scopedCompaction = false;
      }
      return {
        tools: tools !== undefined,
        toolsRegister: typeof tools?.register === "function",
        toolsGuard: typeof tools?.guard === "function",
        toolsGet: typeof tools?.get === "function",
        toolsExecute: typeof tools?.execute === "function",
        toolsPreExecute: typeof ctx?.on === "function",
        toolsPostExecute: typeof ctx?.on === "function",
        subagents: subagents !== undefined,
        subagentsSpawn: typeof subagents?.start === "function",
        skills: skills !== undefined,
        skillsProvider: typeof skills?.registerProvider === "function",
        agentPresets: typeof presets?.resolve === "function",
        commands: commands !== undefined,
        commandsRegister: typeof commands?.register === "function",
        turnSubmit: liveAgents().some((candidate) => typeof candidate?.followup === "function"),
        agents: agents !== undefined && typeof agents?.list === "function",
        compaction: typeof compaction?.compactNow === "function",
        compactionForAgent: scopedCompaction,
        events: typeof ctx?.on === "function",
        llmCatalog: LLM_CATALOG_METHODS.every((method) => typeof service("llm")?.[method] === "function"),
        toolsRegisterHost: typeof tools?.register === "function",
        subagentsProvider: typeof subagents?.getProvider === "function" && typeof subagents?.list === "function",
        subagentsContinuable: typeof subagents?.startContinuable === "function",
        teamExecutorNative: typeof subagents?.startContinuable === "function",
        subagentsInterrupt: typeof subagents?.interrupt === "function",
        llmListModels: typeof llmService?.listModels === "function",
        llmResolveCallConfig: typeof llmService?.resolveCallConfig === "function",
        systemPromptSection: typeof systemPrompt?.section === "function",
        agentScope: liveAgents().some((candidate) => scopeOfAgentContext(candidate) !== undefined),
        agentTurnStart: liveAgents().some((candidate) => typeof candidate?.followup === "function"),
        agentTurnCancel: liveAgents().some((candidate) => typeof candidate?.cancel === "function"),
        agentTurnSteer: liveAgents().some((candidate) => typeof candidate?.steer === "function"),
        agentTurnInject: liveAgents().some((candidate) => typeof candidate?.inject === "function"),
        agentPromptSection: liveAgents().some((candidate) => agentSystemPromptOf(candidate) !== undefined),
        agentPreStep: typeof ctx?.on === "function",
        agentPreStepScope: liveAgents().some((candidate) => typeof scopeContextOf(candidate)?.on === "function"),
        team: typeof agentTeams?.tryMembership === "function" && typeof agentTeams?.listMembers === "function",
        teamTasks: TEAM_TASK_METHODS.every((method) => typeof agentTeams?.[method] === "function"),
        teamMessages: typeof agentTeams?.sendMessage === "function" && typeof agentTeams?.waitForChange === "function",
        subagentsProviderRegister: typeof subagents?.registerProvider === "function",
        goals: typeof goalService?.get === "function",
        goalTools: GOAL_TOOL_NAMES.every((goalToolName) => toolReachable(goalToolName))
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    rowLog,
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
    llmCatalog,
    goalState(agent) {
      const goals = service("goals");
      if (goals === undefined || typeof goals.get !== "function")
        return;
      try {
        const view = goals.get(agent);
        return goalSnapshotOf(view) ?? null;
      } catch {
        return;
      }
    },
    async goalControl(input) {
      if (input === null || typeof input !== "object" || typeof input.action !== "string") {
        return { ok: false, isError: true, error: "goalControl requires an action" };
      }
      if (input.agent === undefined)
        return { ok: false, isError: true, error: "goal tools require a calling agent" };
      let goalId = input.goalId;
      let revision = input.revision;
      const needsRef = input.action !== "create" && input.action !== "read";
      if (needsRef && (goalId === undefined || revision === undefined)) {
        const current = await executeToolForAgent({ name: "get_goal", agent: input.agent, callId: input.callId, signal: input.signal, timeoutMs: input.timeoutMs });
        if (!current.result.ok)
          return { ok: false, isError: true, error: current.result.error, via: current.via, raw: current.result.raw };
        const read = goalValueOf(current.result.value);
        if (read.goal === null)
          return { ok: false, isError: true, error: "no current goal", via: current.via, raw: current.result.raw };
        goalId = goalId ?? read.goal.id;
        revision = revision ?? read.goal.revision;
      }
      const toolName = input.action === "read" ? "get_goal" : input.action === "create" ? "create_goal" : "update_goal";
      const toolArguments = input.action === "read" ? {} : input.action === "create" ? { objective: input.objective, ...input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds } } : {
        goal_id: goalId,
        revision,
        action: input.action,
        ...input.objective === undefined ? {} : { objective: input.objective },
        ...input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds },
        ...input.blockedReason === undefined ? {} : { blocked_reason: input.blockedReason }
      };
      if (input.action === "create" && (typeof input.objective !== "string" || input.objective.trim() === "")) {
        return { ok: false, isError: true, error: "goalControl create requires a non-empty objective" };
      }
      if (needsRef && (goalId === undefined || revision === undefined)) {
        return { ok: false, isError: true, error: "goalControl " + input.action + " requires an exact goal id and revision" };
      }
      const call = await executeToolForAgent({
        name: toolName,
        arguments: toolArguments,
        agent: input.agent,
        callId: input.callId,
        signal: input.signal,
        timeoutMs: input.timeoutMs
      });
      if (!call.result.ok)
        return { ok: false, isError: call.result.isError, error: call.result.error, via: call.via, raw: call.result.raw };
      const value = goalValueOf(call.result.value);
      return {
        ok: true,
        isError: false,
        goal: value.goal,
        ...value.activation === undefined ? {} : { activation: value.activation },
        via: call.via,
        raw: call.result.raw
      };
    },
    llmListModels(provider) {
      const llm = requireService("llm", 'cannot list the models of provider "' + provider + '"');
      if (typeof llm.listModels !== "function")
        throw new Error("mpd-dsh-adapter: the harness llm service exposes no listModels()");
      return llm.listModels.call(llm, provider);
    },
    llmResolveCallConfig(config2, signal) {
      const llm = requireService("llm", "cannot resolve a call config");
      if (typeof llm.resolveCallConfig !== "function")
        throw new Error("mpd-dsh-adapter: the harness llm service exposes no resolveCallConfig()");
      return llm.resolveCallConfig.call(llm, config2, signal);
    },
    registerHostTool(definition) {
      const tools = requireService("tools", 'cannot register host tool "' + String(definition?.name) + '"');
      if (typeof tools.register !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()");
      const registered = tools.register(definition);
      return typeof registered === "function" ? registered : noop;
    },
    registerTool(definition) {
      const tools = requireService("tools", 'cannot register tool "' + String(definition?.name) + '"');
      if (typeof tools.register !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()");
      const output = definition.output ?? {};
      const render = typeof output.render === "function" ? output.render : (_args, value) => textBlock(value);
      const schema = output.schema ?? OBJECT_SCHEMA;
      return tools.register({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters ?? OBJECT_SCHEMA,
        output: { ...output, schema, render },
        ...definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs },
        execute: async (args, exec) => definition.execute(args ?? {}, exec ?? {})
      });
    },
    registerTools(definitions) {
      const disposers = definitions.map((definition) => adapter.registerTool(definition));
      return () => {
        for (const dispose of disposers)
          dispose();
      };
    },
    registerCommand(definition) {
      const commands = service("commands");
      if (commands === undefined || commands === null || typeof commands.register !== "function")
        return noop;
      const registered = commands.register({
        name: definition?.name,
        description: definition?.description,
        ...definition?.input === undefined ? {} : { input: definition.input },
        handler: (invocation) => {
          const host = invocation ?? { rawInput: "" };
          return definition.handler({
            ...host,
            submit: (message) => adapter.submitUserTurn(host.agent, message)
          });
        }
      });
      return typeof registered === "function" ? registered : noop;
    },
    registerPromptSection(section) {
      const systemPrompt = requireService("systemPrompt", 'cannot register prompt section "' + String(section?.name) + '"');
      if (typeof systemPrompt.section !== "function")
        throw new Error("mpd-dsh-adapter: the harness systemPrompt service exposes no section()");
      const registered = systemPrompt.section(section);
      return typeof registered === "function" ? registered : noop;
    },
    guardTool(guard) {
      const tools = requireService("tools", "cannot install a tool guard");
      if (typeof tools.guard !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()");
      return tools.guard((exec) => guard(exec ?? {}));
    },
    onPreToolExecute(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
      return ctx.on("tools/pre-execute", async (exec, next) => {
        const downstream = typeof next === "function" ? await next() : undefined;
        try {
          listener(Object.freeze({ ...exec ?? {} }), downstream);
        } catch {}
        return downstream;
      });
    },
    onPostToolExecute(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
      return ctx.on("tools/post-execute", async (exec, result, next) => {
        const downstream = typeof next === "function" ? await next() ?? { kind: "accept" } : { kind: "accept" };
        const decided = await listener(exec ?? {}, result ?? {}, downstream);
        return decided ?? downstream;
      });
    },
    onAgentPreStep(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
      return ctx.on("agent/pre-step", preStepWrapper(listener));
    },
    registerAgentPreStep(agent, listener) {
      const context = scopeContextOf(agent);
      if (typeof context?.on !== "function") {
        throw new Error("mpd-dsh-adapter: the agent's own scope exposes no on() — cannot register its agent/pre-step listener");
      }
      return context.on("agent/pre-step", preStepWrapper(listener));
    },
    webServerOf() {
      try {
        if (typeof ctx?.get !== "function")
          return;
        return ctx.get("webServer", false) ?? ctx.get("httpServer", false);
      } catch {
        return;
      }
    },
    onServiceBound(names, callback) {
      if (typeof ctx?.on !== "function")
        return () => {};
      const off = ctx.on("internal/service", (name) => {
        try {
          if (typeof name === "string" && names.includes(name))
            callback(name);
        } catch {}
      });
      return typeof off === "function" ? off : () => {};
    },
    hasTool(toolName, agent) {
      return toolDefinitionFor(toolName, agent) !== undefined;
    },
    toolRuntime() {
      return {
        get: (toolName, agent) => toolDefinitionFor(toolName, agent),
        execute: (input) => adapter.executeTool({ ...input, timeoutMs: defaultTimeoutMs }).then((result) => result.raw)
      };
    },
    async executeTool(input) {
      const tools = service("tools");
      if (tools === undefined || typeof tools.execute !== "function") {
        return { ok: false, isError: true, error: "the harness tool runtime has no execute()" };
      }
      const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10);
      const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs);
      try {
        const raw = await tools.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...signal === undefined ? {} : { signal },
          ...input.agent === undefined ? {} : { agent: input.agent }
        });
        return projectToolResult(raw);
      } catch (error) {
        return { ok: false, isError: true, error: errorMessage(error) };
      }
    },
    async spawnAgent(spec) {
      const subagents = requireService("subagents", 'cannot spawn subagent "' + String(spec?.label) + '"');
      if (typeof subagents.start !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagent service exposes no start()");
      const route = {
        ...spec.provider === undefined ? {} : { provider: spec.provider },
        ...spec.model === undefined ? {} : { model: spec.model },
        ...spec.agentOptions ?? {}
      };
      const run = await subagents.start(spec.mode ?? "spawn", {
        label: spec.label,
        prompt: typeof spec.prompt === "string" ? textBlock(spec.prompt) : spec.prompt,
        ...spec.parent === undefined ? {} : { parent: spec.parent },
        ...spec.signal === undefined ? {} : { signal: spec.signal },
        ...Object.keys(route).length === 0 ? {} : { agentOptions: route },
        ...spec.persona === undefined ? {} : { persona: spec.persona },
        ...spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema },
        ...spec.toolFilter === undefined ? {} : { toolFilter: spec.toolFilter },
        ...spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }
      });
      const result = await (run?.result ?? {});
      return {
        output: typeof result.output === "string" ? result.output : "",
        structured: result.structured,
        stopReason: result.stopReason ?? null
      };
    },
    subagentRuntime() {
      return service("subagents");
    },
    subagentProvider(name) {
      const subagents = service("subagents");
      const getProvider = subagents?.getProvider;
      if (typeof getProvider !== "function")
        return;
      return getProvider.call(subagents, name);
    },
    subagentProviders() {
      const subagents = service("subagents");
      const list = subagents?.list;
      if (typeof list !== "function")
        return [];
      const names = list.call(subagents);
      return Array.isArray(names) ? names.filter((entry) => typeof entry === "string") : [];
    },
    startContinuableAgent(spec) {
      const subagents = requireService("subagents", "cannot start a continuable agent");
      if (typeof subagents.startContinuable !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable()");
      return subagents.startContinuable.call(subagents, spec);
    },
    registerSubagentProvider(provider) {
      const subagents = requireService("subagents", "cannot register a subagent provider");
      if (typeof subagents.registerProvider !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no registerProvider()");
      const registered = subagents.registerProvider(provider);
      return typeof registered === "function" ? registered : noop;
    },
    interruptAgent(targetSessionId, authority) {
      const subagents = requireService("subagents", 'cannot interrupt subagent session "' + String(targetSessionId) + '"');
      if (typeof subagents.interrupt !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt()");
      subagents.interrupt.call(subagents, targetSessionId, authority);
    },
    teamExecutor() {
      const override = (() => {
        try {
          const raw = typeof process !== "undefined" && process.env ? process.env.MPD_DSH_TEAM_EXECUTOR : undefined;
          return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : undefined;
        } catch {
          return;
        }
      })();
      const nativeReady = typeof service("subagents")?.startContinuable === "function";
      const officialReady = service("agentTeams") !== undefined;
      const chosen = override === "official" && officialReady ? "official" : override === "native" && nativeReady ? "native" : nativeReady ? "native" : officialReady ? "official" : "native";
      if (chosen === "official")
        return officialTeamExecutor();
      return nativeTeamExecutor(nativeReady ? override === undefined ? "native: the default backend — it needs nothing from the official plugin" : "native: chosen by MPD_DSH_TEAM_EXECUTOR=native" : "native UNAVAILABLE: the harness subagents service exposes no startContinuable(), and no team service is mounted either — every team call will refuse", nativeReady);
    },
    teamService() {
      const teams = service("agentTeams");
      return teams === undefined || teams === null ? undefined : teams;
    },
    teamMembership(agent) {
      const teams = service("agentTeams");
      const tryMembership = teams?.tryMembership;
      if (typeof tryMembership !== "function")
        return;
      let membership;
      try {
        membership = tryMembership.call(teams, agent);
      } catch {
        return;
      }
      if (membership === undefined || membership === null)
        return;
      const role = membership.role;
      if (role !== "lead" && role !== "teammate")
        return;
      return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") };
    },
    teamListMembers(agent) {
      const teams = requireService("agentTeams", "cannot list the team roster of an agent");
      if (typeof teams.listMembers !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listMembers()");
      const rows = teams.listMembers.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamMemberView) : [];
    },
    teamListTasks(agent) {
      const teams = requireService("agentTeams", "cannot list the shared task board of an agent");
      if (typeof teams.listTasks !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listTasks()");
      const rows = teams.listTasks.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamTaskView) : [];
    },
    async teamCreateTask(caller, request) {
      const teams = requireService("agentTeams", 'cannot create team task "' + String(request?.subject) + '"');
      if (typeof teams.createTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no createTask()");
      return teamTaskView(await teams.createTask.call(teams, caller, request));
    },
    teamGetTask(caller, id) {
      const teams = requireService("agentTeams", 'cannot read team task "' + String(id) + '"');
      if (typeof teams.getTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no getTask()");
      return teamTaskView(teams.getTask.call(teams, caller, id));
    },
    async teamUpdateTask(caller, request) {
      const teams = requireService("agentTeams", 'cannot update team task "' + String(request?.taskId) + '"');
      if (typeof teams.updateTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no updateTask()");
      return teamTaskView(await teams.updateTask.call(teams, caller, request));
    },
    async teamSendMessage(caller, request) {
      const teams = requireService("agentTeams", 'cannot send a team message to "' + String(request?.target) + '"');
      if (typeof teams.sendMessage !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no sendMessage()");
      const result = await teams.sendMessage.call(teams, caller, request);
      return {
        messageId: String(result?.messageId ?? ""),
        status: result?.status === "queued" ? "queued" : "accepted"
      };
    },
    async teamSpawnTeammate(caller, request) {
      const teams = requireService("agentTeams", 'cannot spawn team member "' + String(request?.name) + '"');
      if (typeof teams.spawnTeammate !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no spawnTeammate()");
      const result = await teams.spawnTeammate.call(teams, caller, request);
      return { member: teamMemberView(result?.member) };
    },
    teamInterrupt(caller, targetName) {
      const teams = requireService("agentTeams", 'cannot interrupt team member "' + String(targetName) + '"');
      if (typeof teams.interrupt !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no interrupt()");
      const result = teams.interrupt.call(teams, caller, targetName);
      return { previousStatus: result?.previousStatus === "running" ? "running" : "inactive" };
    },
    async teamWaitForChange(caller, timeoutMs, signal) {
      const teams = requireService("agentTeams", "cannot wait for team activity");
      if (typeof teams.waitForChange !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no waitForChange()");
      const result = await teams.waitForChange.call(teams, caller, timeoutMs, signal);
      return { timedOut: result?.timedOut === true };
    },
    teamLiveTeams() {
      const teams = service("agentTeams");
      if (teams === undefined || teams === null || typeof teams.tryMembership !== "function")
        return [];
      if (typeof service("agents")?.list !== "function")
        return [];
      const views = [];
      for (const agent of liveAgents()) {
        let membership;
        try {
          membership = teams.tryMembership.call(teams, agent);
        } catch {
          continue;
        }
        if (membership?.role !== "lead")
          continue;
        views.push({
          teamId: String(membership.id ?? ""),
          leadName: String(membership.name ?? ""),
          leadSessionId: String(agent?.id ?? ""),
          members: teamRows(teams, "listMembers", agent, teamMemberView),
          tasks: teamRows(teams, "listTasks", agent, teamTaskView)
        });
      }
      return views;
    },
    registerSkillProvider(provider) {
      const skills = requireService("skills", "cannot register a skill provider");
      if (typeof skills.registerProvider !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no registerProvider()");
      return skills.registerProvider(provider);
    },
    async listSkills(options = {}) {
      const skills = requireService("skills", "cannot list skills");
      if (typeof skills.list !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no list()");
      return await skills.list(options) ?? [];
    },
    async loadSkill(skillName, options = {}) {
      const skills = requireService("skills", 'cannot load skill "' + skillName + '"');
      if (typeof skills.get !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no get()");
      return skills.get(skillName, options);
    },
    async resolvePreset(presetId) {
      const presets = requireService("agentPresets", 'cannot resolve preset "' + presetId + '"');
      if (typeof presets.resolve !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentPresets service exposes no resolve()");
      const preset = await presets.resolve(presetId);
      return {
        id: String(preset?.id ?? presetId),
        ...preset?.path === undefined ? {} : { path: String(preset.path) },
        ...preset?.trust === undefined ? {} : { trust: String(preset.trust) },
        ...preset?.broken === undefined ? {} : { broken: String(preset.broken) }
      };
    },
    settingsReader(namespace) {
      const settings = settingsService();
      if (settings === undefined || settings === null)
        return;
      return {
        get() {
          try {
            return typeof settings.get === "function" ? settings.get(namespace) : undefined;
          } catch {
            return;
          }
        },
        describe() {
          try {
            if (typeof settings.describe !== "function")
              return;
            const list = settings.describe();
            if (!Array.isArray(list))
              return;
            const found = list.find((entry) => entry?.ns === namespace);
            if (found === undefined)
              return;
            return {
              value: found.value,
              revision: typeof found.revision === "number" ? found.revision : undefined,
              user: found.user,
              base: found.base,
              applies: typeof found.applies === "string" ? found.applies : undefined
            };
          } catch {
            return;
          }
        }
      };
    },
    onSettingsDocumentUpdated(namespace, listener) {
      let pendingRevision;
      let pendingSource;
      let hasPending = false;
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        if (!hasPending)
          return;
        const revision = pendingRevision;
        const source = pendingSource;
        pendingRevision = undefined;
        pendingSource = undefined;
        hasPending = false;
        try {
          listener(revision, source);
        } catch {}
      };
      const offUpdated = adapter.onEvent("settings/updated", (ns, _next, _prev, from) => {
        if (String(ns) !== namespace)
          return;
        pendingSource = from === undefined ? undefined : String(from);
        return;
      });
      const offDocument = adapter.onEvent("settings/document-updated", (ns, revision) => {
        if (String(ns) !== namespace)
          return;
        pendingRevision = typeof revision === "number" ? revision : undefined;
        hasPending = true;
        if (!scheduled) {
          scheduled = true;
          Promise.resolve().then(flush);
        }
        return;
      });
      return () => {
        try {
          offUpdated?.();
        } catch {}
        try {
          offDocument?.();
        } catch {}
      };
    },
    whenSettingsAvailable(callback) {
      if (typeof ctx?.inject !== "function") {
        rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)");
        try {
          callback();
        } catch {}
        return;
      }
      try {
        ctx.inject(["settings"], (scoped) => {
          try {
            try {
              if (scopedSettings === undefined || scopedSettings === null)
                scopedSettings = scoped?.settings;
            } catch {}
            if (scopedSettings === undefined || scopedSettings === null) {
              try {
                scopedSettings = typeof scoped?.get === "function" ? scoped.get("settings") : undefined;
              } catch {}
            }
            if (scopedSettings === undefined || scopedSettings === null) {
              rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27");
            }
            callback();
          } catch {}
        });
      } catch {}
    },
    settingsRegister(namespace, schema, options) {
      const settings = settingsService();
      if (settings === undefined || settings === null) {
        return { ok: false, error: "settings service is unavailable" };
      }
      if (typeof settings.register !== "function") {
        return {
          ok: false,
          error: "the settings service is present but exposes no register() — harness 0.1.7-rc.2 replaced the namespace-registry model with the Cordis patch editor, where a plugin declares its editable fields in its own row Config with .volatile() (keys: " + Object.keys(settings).slice(0, 8).join(",") + ")"
        };
      }
      try {
        settings.register(namespace, schema, { ...options?.base === undefined ? {} : { base: options.base }, ...options?.applies === undefined ? {} : { applies: options.applies } });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    async settingsMutate(namespace, ops, expectedRevision) {
      const settings = settingsService();
      if (settings === undefined || settings === null || typeof settings.mutate !== "function") {
        return { ok: false, error: "settings service is unavailable" };
      }
      try {
        await settings.mutate(namespace, ops.map((op) => op.op === "unset" ? { op: "unset", path: [...op.path] } : { op: "set", path: [...op.path], value: op.value }), expectedRevision);
        return { ok: true };
      } catch (error) {
        const name = String(error?.name ?? "");
        const conflict = name === "SettingsConflictError" || /conflict/i.test(String(error?.message ?? ""));
        return { ok: false, error: String(error?.message ?? error), ...conflict ? { conflict: true } : {} };
      }
    },
    text: textBlock,
    userMessage,
    agentScope(agent) {
      return scopeOfAgentContext(agent);
    },
    agentPromptSection(agent, section) {
      const systemPrompt = agentSystemPromptOf(agent);
      if (systemPrompt === undefined) {
        throw new Error(`mpd-dsh-adapter: the agent's own scope exposes no systemPrompt.section() — cannot register prompt section "` + String(section?.name) + '" for it');
      }
      const registered = systemPrompt.section(section);
      return typeof registered === "function" ? registered : noop;
    },
    startAgentTurn(agent, message) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn");
      followup.call(agent, message);
    },
    cancelAgentTurn(agent, cause, options) {
      const cancel = agent?.cancel;
      if (typeof cancel !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn");
      cancel.call(agent, cause, options);
    },
    steerAgentTurn(agent, message) {
      const steer = agent?.steer;
      if (typeof steer !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn");
      steer.call(agent, message);
    },
    injectAgentMessage(agent, message) {
      const inject = agent?.inject;
      if (typeof inject !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it");
      inject.call(agent, message);
    },
    submitUserTurn(agent, message) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        return false;
      try {
        followup.call(agent, message);
        return true;
      } catch {
        return false;
      }
    }
  };
  return adapter;
}
var SERVICE_NAME = "mpdDsh";
function resolveDshAdapter(ctx, options = {}) {
  const mounted = probeMpdDsh(ctx, true);
  if (mounted.value !== undefined)
    return mounted.value;
  const warn = options.warn ?? ((line) => rowLogLine("mpd-dsh-adapter", line));
  warn(probeMpdDsh(ctx, false).missing ? adapterFallbackWarning() : adapterPendingWarning());
  return createDshAdapter(ctx);
}
var ADAPTER_IDENTITY_FALLBACK = "fallback:createDshAdapter";
function adapterPendingWarning() {
  return "ADAPTER NOT YET ACTIVE: " + SERVICE_NAME + " is registered in this composition but its provider fiber" + " is not ACTIVE yet (the loader applies sibling rows concurrently; cordis answers undefined for a non-ACTIVE" + " provider). This call is served by a TEMPORARY adapter and every later call re-probes, so the mounted" + " adapter is picked up as soon as it activates — this transient miss needs NO row-order change (T-50).";
}
function adapterFallbackWarning() {
  return "ADAPTER FALLBACK (adapterIdentity=" + ADAPTER_IDENTITY_FALLBACK + "): " + SERVICE_NAME + " is not provided" + " in this composition, so this row built its OWN adapter beside the tree's: it bypasses the mounted adapter" + " (the one-contact-surface rule, AGENTS.md §6), it does NOT inherit the adapter row's config (defaultTimeoutMs)" + " and it keeps its own per-instance caches (the per-agent compaction-engine memo). This boot keeps working," + " which is exactly why the branch is loud — fix the ROW ORDER (this row must sit BELOW mpd-dsh-adapter); the" + " canonical note lives in packages/mpd-ext-plugin/src/index.ts (resolveAdapter).";
}
function probeMpdDsh(ctx, strict) {
  const get = ctx?.get;
  if (typeof get !== "function")
    return { missing: true };
  try {
    const value = get.call(ctx, SERVICE_NAME, strict);
    return value === undefined || value === null ? { missing: true } : { value, missing: false };
  } catch {
    return { missing: true };
  }
}

// packages/mpd-hashline-plugin/src/index.ts
var name = "mpd-hashline";
var inject = dshSeamInject(DSH_SEAM_TOOLS);
function mergedConfig(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = (k) => svc.get(k);
  return {
    ...config,
    guardEditTools: typeof v("hashline.guardEditTools") === "boolean" ? v("hashline.guardEditTools") : config.guardEditTools,
    maxDiffChars: typeof v("hashline.maxDiffChars") === "number" ? v("hashline.maxDiffChars") : config.maxDiffChars,
    registryFile: typeof v("hashline.registryFile") === "string" ? v("hashline.registryFile") : config.registryFile
  };
}
function registryPath(config, dsh, exec) {
  return config.registryFile ? resolve3(config.registryFile) : join2(dsh.workspaceRoot(exec), ".mpd", "hashline-files.json");
}
function sessionPath(target, dsh, exec) {
  return isAbsolute(target) ? resolve3(target) : resolve3(dsh.workspaceRoot(exec), target);
}
function readRegistry(p) {
  try {
    const v = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeRegistry(p, files) {
  mkdirSync2(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify([...new Set(files)], null, 2));
}
function registered(config, dsh, fp, exec) {
  const list = readRegistry(registryPath(config, dsh, exec));
  const target = sessionPath(fp, dsh, exec);
  return list.some((x) => sessionPath(x, dsh, exec) === target);
}
function sourceLineCount(text) {
  const body = text.endsWith(`
`) ? text.slice(0, -1) : text;
  return body === "" ? 0 : body.split(`
`).length;
}
function readEnvelope(fp) {
  return canonicalizeFileText(readFileSync(fp, "utf8"));
}
function editFile(fp, edits, maxDiffChars) {
  const envelope = readEnvelope(fp);
  const before = envelope.content;
  const report = applyHashlineEditsWithReport(before, edits);
  writeFileSync(fp, restoreFileText(report.content, envelope));
  const diff = report.content === before ? "" : generateUnifiedDiff(before, report.content, fp).slice(0, maxDiffChars);
  return {
    path: fp,
    lines: sourceLineCount(report.content),
    noopEdits: report.noopEdits,
    deduplicatedEdits: report.deduplicatedEdits,
    diff
  };
}
function apply(ctx, config = {}) {
  const dsh = resolveDshAdapter(ctx);
  const cfg = mergedConfig(ctx, config);
  const maxDiffChars = cfg.maxDiffChars ?? 4000;
  dsh.registerTool({
    name: "mpd_hashline_read",
    description: "Show a file as hashline view: one 'LINE#HASH|content' line per source line, where LINE#HASH is the anchor to use with mpd_hashline_edit. Read-only; the file on disk stays plain.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a, v) => textBlock(v.view) },
    execute: async (args, exec) => {
      const fp = sessionPath(String(args?.path), dsh, exec);
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const raw = readEnvelope(fp).content;
      const out = toHashlineContent(raw);
      return { path: fp, lines: sourceLineCount(out), view: out };
    }
  });
  dsh.registerTool({
    name: "mpd_hashline_edit",
    description: "Apply hash-anchored edits to a file: edits are {op: replace|append|prepend, pos: 'LINE#HASH' anchor, end?: 'LINE#HASH' (replace range), lines: 'new text' | ['line1', ...]}. Obtain anchors from mpd_hashline_read. Anchors are validated against current hashes (HashlineMismatchError on drift, with remapped refs); matched edits are applied to plain content and the file is written back plain. Returns noop/deduped counts and a unified diff.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["replace", "append", "prepend"] }, pos: { type: "string" }, end: { type: "string" }, lines: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } }, required: ["op"], additionalProperties: false } }
      },
      required: ["path", "edits"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, noopEdits: { type: "integer" }, deduplicatedEdits: { type: "integer" }, diff: { type: "string" } }, required: ["path", "lines"], additionalProperties: false },
      render: (_a, v) => textBlock("hashline edited: " + v.path + " (" + v.lines + " lines, noop=" + v.noopEdits + ", deduped=" + v.deduplicatedEdits + `)
` + (v.diff ?? ""))
    },
    execute: async (args, exec) => {
      const fp = sessionPath(String(args?.path), dsh, exec);
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const rawEdits = Array.isArray(args?.edits) ? args.edits : [];
      if (rawEdits.length === 0)
        throw new Error("mpd-hashline: at least one edit required");
      const edits = normalizeHashlineEdits(rawEdits);
      return editFile(fp, edits, maxDiffChars);
    }
  });
  dsh.registerTool({
    name: "mpd_hashline_format",
    description: "Register a file for the hashline discipline (idempotent; the file on disk is NOT changed). After registration the post-edit guard warns when plain edit/write tools change the file. The returned view is the hashline anchor view.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a, v) => textBlock("hashline disciplined: " + v.path + `
` + v.view) },
    execute: async (args, exec) => {
      const fp = sessionPath(String(args?.path), dsh, exec);
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const rp = registryPath(cfg, dsh, exec);
      writeRegistry(rp, [...readRegistry(rp), fp]);
      const raw = readEnvelope(fp).content;
      const out = toHashlineContent(raw);
      return { path: fp, lines: sourceLineCount(out), view: out };
    }
  });
  dsh.registerTool({
    name: "mpd_hashline_restore",
    description: "Unregister a file from the hashline discipline (the plain file content is untouched). After this, plain edits no longer trigger the hashline guard.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, render: (_a, v) => textBlock("hashline discipline removed: " + v.path) },
    execute: async (args, exec) => {
      const fp = sessionPath(String(args?.path), dsh, exec);
      const rp = registryPath(cfg, dsh, exec);
      writeRegistry(rp, readRegistry(rp).filter((x) => resolve3(x) !== fp));
      return { path: fp };
    }
  });
  if (cfg.guardEditTools !== false) {
    dsh.onPostToolExecute(async (exec, result, out) => {
      if (out.kind !== "accept")
        return out;
      const isEdit = exec.name === "edit" || exec.name === "str_replace_editor" || exec.name === "write";
      if (!isEdit)
        return out;
      const fp = exec.arguments?.file_path ?? exec.arguments?.path;
      if (typeof fp !== "string" || !registered(cfg, dsh, fp, exec))
        return out;
      const hint = "[mpd-hashline guard] " + fp + " is hashline-disciplined and was changed with a plain edit tool, so the LINE#HASH anchors you saw are now stale. Re-read with mpd_hashline_read and continue with mpd_hashline_edit, or run mpd_hashline_restore to drop the discipline.";
      const content = out.content ?? result?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => b && b.type === "text" ? b.text : "").join(`
`) : "";
      return { ...out, content: [{ type: "text", text: (text ? text + `

` : "") + hint }] };
    });
  }
}
export {
  apply,
  inject,
  name
};
