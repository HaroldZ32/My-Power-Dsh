// src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// src/vendor/constants.ts
var NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
var HASHLINE_DICT = Array.from({ length: 256 }, (_, i) => {
  const high = i >>> 4;
  const low = i & 15;
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`;
});
var HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/;
// src/vendor/xxhash32.ts
var runtime = globalThis;
var encoder = new TextEncoder;
var PRIME32_1 = 2654435761;
var PRIME32_2 = 2246822519;
var PRIME32_3 = 3266489917;
var PRIME32_4 = 668265263;
var PRIME32_5 = 374761393;
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
function xxHash32Js(input, seed) {
  let offset = 0;
  const length = input.length;
  let hash;
  if (length >= 16) {
    const limit = length - 16;
    let value1 = seed + PRIME32_1 + PRIME32_2 >>> 0;
    let value2 = seed + PRIME32_2 >>> 0;
    let value3 = seed >>> 0;
    let value4 = seed - PRIME32_1 >>> 0;
    while (offset <= limit) {
      value1 = round32(value1, readUint32LittleEndian(input, offset));
      offset += 4;
      value2 = round32(value2, readUint32LittleEndian(input, offset));
      offset += 4;
      value3 = round32(value3, readUint32LittleEndian(input, offset));
      offset += 4;
      value4 = round32(value4, readUint32LittleEndian(input, offset));
      offset += 4;
    }
    hash = rotateLeft32(value1, 1) + rotateLeft32(value2, 7) >>> 0;
    hash = hash + rotateLeft32(value3, 12) >>> 0;
    hash = hash + rotateLeft32(value4, 18) >>> 0;
  } else {
    hash = seed + PRIME32_5 >>> 0;
  }
  hash = hash + length >>> 0;
  while (offset + 4 <= length) {
    hash = hash + Math.imul(readUint32LittleEndian(input, offset), PRIME32_3) >>> 0;
    hash = Math.imul(rotateLeft32(hash, 17), PRIME32_4) >>> 0;
    offset += 4;
  }
  while (offset < length) {
    hash = hash + Math.imul(input[offset] ?? 0, PRIME32_5) >>> 0;
    hash = Math.imul(rotateLeft32(hash, 11), PRIME32_1) >>> 0;
    offset += 1;
  }
  hash = (hash ^ hash >>> 15) >>> 0;
  hash = Math.imul(hash, PRIME32_2) >>> 0;
  hash = (hash ^ hash >>> 13) >>> 0;
  hash = Math.imul(hash, PRIME32_3) >>> 0;
  return (hash ^ hash >>> 16) >>> 0;
}
function hashXxh32(input, seed) {
  const bun = runtime.Bun;
  if (bun !== undefined) {
    return bun.hash.xxHash32(input, seed);
  }
  return xxHash32Js(encoder.encode(input), seed >>> 0);
}

// src/vendor/hash-computation.ts
var RE_SIGNIFICANT = /[\p{L}\p{N}]/u;
function computeNormalizedLineHash(lineNumber, normalizedContent) {
  const stripped = normalizedContent;
  const seed = RE_SIGNIFICANT.test(stripped) ? 0 : lineNumber;
  const hash = hashXxh32(stripped, seed);
  const index = hash % 256;
  return HASHLINE_DICT[index];
}
function computeLineHash(lineNumber, content) {
  return computeNormalizedLineHash(lineNumber, content.replace(/\r/g, "").trimEnd());
}
function computeLegacyLineHash(lineNumber, content) {
  return computeNormalizedLineHash(lineNumber, content.replace(/\r/g, "").replace(/\s+/g, ""));
}
// src/vendor/validation.ts
var MISMATCH_CONTEXT = 2;
var LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2})/;
function isCompatibleLineHash(line, content, hash) {
  return computeLineHash(line, content) === hash || computeLegacyLineHash(line, content) === hash;
}
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
    return extracted[1];
  }
  return originalTrimmed;
}
function parseLineRef(ref) {
  const normalized = normalizeLineRef(ref);
  const match = normalized.match(HASHLINE_REF_PATTERN);
  if (match) {
    return {
      line: Number.parseInt(match[1], 10),
      hash: match[2]
    };
  }
  const hashIdx = normalized.indexOf("#");
  if (hashIdx > 0) {
    const prefix = normalized.slice(0, hashIdx);
    const suffix = normalized.slice(hashIdx + 1);
    if (!/^\d+$/.test(prefix) && /^[ZPMQVRWSNKTXJBYH]{2}$/.test(suffix)) {
      throw new Error(`Invalid line reference: "${ref}". "${prefix}" is not a line number. ` + `Use the actual line number from the read output.`);
    }
  }
  throw new Error(`Invalid line reference format: "${ref}". Expected format: "{line_number}#{hash_id}"`);
}
function validateLineRef(lines, ref) {
  const { line, hash } = parseLineRefWithHint(ref, lines);
  if (line < 1 || line > lines.length) {
    throw new Error(`Line number ${line} out of bounds. File has ${lines.length} lines.`);
  }
  const content = lines[line - 1];
  if (!isCompatibleLineHash(line, content, hash)) {
    throw new HashlineMismatchError([{ line, expected: hash }], lines);
  }
}

class HashlineMismatchError extends Error {
  mismatches;
  fileLines;
  remaps;
  constructor(mismatches, fileLines) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines));
    this.mismatches = mismatches;
    this.fileLines = fileLines;
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
function suggestLineForHash(ref, lines) {
  const hashMatch = ref.trim().match(/#([ZPMQVRWSNKTXJBYH]{2})$/);
  if (!hashMatch)
    return null;
  const hash = hashMatch[1];
  for (let i = 0;i < lines.length; i++) {
    if (isCompatibleLineHash(i + 1, lines[i], hash)) {
      return `Did you mean "${i + 1}#${computeLineHash(i + 1, lines[i])}"?`;
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
function validateLineRefs(lines, refs) {
  const mismatches = [];
  for (const ref of refs) {
    const { line, hash } = parseLineRefWithHint(ref, lines);
    if (line < 1 || line > lines.length) {
      throw new Error(`Line number ${line} out of bounds (file has ${lines.length} lines)`);
    }
    const content = lines[line - 1];
    if (!isCompatibleLineHash(line, content, hash)) {
      mismatches.push({ line, expected: hash });
    }
  }
  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, lines);
  }
}
// src/vendor/edit-text-normalization.ts
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
  if (equalsIgnoringWhitespace(newLines[0], anchorLine)) {
    return newLines.slice(1);
  }
  return newLines;
}
function stripInsertBeforeEcho(anchorLine, newLines) {
  if (newLines.length <= 1)
    return newLines;
  if (equalsIgnoringWhitespace(newLines[newLines.length - 1], anchorLine)) {
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
  const beforeIdx = startLine - 2;
  if (beforeIdx >= 0 && out[0] === lines[beforeIdx]) {
    out = out.slice(1);
  }
  const afterIdx = endLine;
  if (afterIdx < lines.length && out.length > 0 && out[out.length - 1] === lines[afterIdx]) {
    out = out.slice(0, -1);
  }
  return out;
}

// src/vendor/edit-deduplication.ts
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

// src/vendor/edit-ordering.ts
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
    if (edit.op !== "replace" || !edit.end)
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
    if (curr.start <= prev.end) {
      return `Overlapping range edits detected: ` + `edit ${prev.idx + 1} (lines ${prev.start}-${prev.end}) overlaps with ` + `edit ${curr.idx + 1} (lines ${curr.start}-${curr.end}). ` + `Use pos-only replace for single-line edits.`;
    }
  }
  return null;
}

// src/vendor/autocorrect-replacement-lines.ts
function normalizeTokens(text) {
  return text.replace(/\s+/g, "");
}
function stripAllWhitespace(text) {
  return normalizeTokens(text);
}
function stripTrailingContinuationTokens(text) {
  return text.replace(/(?:&&|\|\||\?\?|\?|:|=|,|\+|-|\*|\/|\.|\()\s*$/u, "");
}
function stripMergeOperatorChars(text) {
  return text.replace(/[|&?]/g, "");
}
function leadingWhitespace2(text) {
  if (!text)
    return "";
  const match = text.match(/^\s*/);
  return match ? match[0] : "";
}
function restoreOldWrappedLines(originalLines, replacementLines) {
  if (originalLines.length === 0 || replacementLines.length < 2)
    return replacementLines;
  const canonicalToOriginal = new Map;
  for (const line of originalLines) {
    const canonical = stripAllWhitespace(line);
    const existing = canonicalToOriginal.get(canonical);
    if (existing) {
      existing.count += 1;
    } else {
      canonicalToOriginal.set(canonical, { line, count: 1 });
    }
  }
  const candidates = [];
  for (let start = 0;start < replacementLines.length; start += 1) {
    for (let len = 2;len <= 10 && start + len <= replacementLines.length; len += 1) {
      const span = replacementLines.slice(start, start + len);
      if (span.some((line) => line.trim().length === 0))
        continue;
      const canonicalSpan = stripAllWhitespace(span.join(""));
      const original = canonicalToOriginal.get(canonicalSpan);
      if (original && original.count === 1 && canonicalSpan.length >= 6) {
        candidates.push({ start, len, replacement: original.line, canonical: canonicalSpan });
      }
    }
  }
  if (candidates.length === 0)
    return replacementLines;
  const canonicalCounts = new Map;
  for (const candidate of candidates) {
    canonicalCounts.set(candidate.canonical, (canonicalCounts.get(candidate.canonical) ?? 0) + 1);
  }
  const uniqueCandidates = candidates.filter((candidate) => (canonicalCounts.get(candidate.canonical) ?? 0) === 1);
  if (uniqueCandidates.length === 0)
    return replacementLines;
  uniqueCandidates.sort((a, b) => b.start - a.start);
  const correctedLines = [...replacementLines];
  for (const candidate of uniqueCandidates) {
    correctedLines.splice(candidate.start, candidate.len, candidate.replacement);
  }
  return correctedLines;
}
function maybeExpandSingleLineMerge(originalLines, replacementLines) {
  if (replacementLines.length !== 1 || originalLines.length <= 1) {
    return replacementLines;
  }
  const merged = replacementLines[0];
  const parts = originalLines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (parts.length !== originalLines.length)
    return replacementLines;
  const indices = [];
  let offset = 0;
  let orderedMatch = true;
  for (const part of parts) {
    let idx = merged.indexOf(part, offset);
    let matchedLen = part.length;
    if (idx === -1) {
      const stripped = stripTrailingContinuationTokens(part);
      if (stripped !== part) {
        idx = merged.indexOf(stripped, offset);
        if (idx !== -1)
          matchedLen = stripped.length;
      }
    }
    if (idx === -1) {
      const segment = merged.slice(offset);
      const segmentStripped = stripMergeOperatorChars(segment);
      const partStripped = stripMergeOperatorChars(part);
      const fuzzyIdx = segmentStripped.indexOf(partStripped);
      if (fuzzyIdx !== -1) {
        let strippedPos = 0;
        let originalPos = 0;
        while (strippedPos < fuzzyIdx && originalPos < segment.length) {
          if (!/[|&?]/.test(segment[originalPos]))
            strippedPos += 1;
          originalPos += 1;
        }
        idx = offset + originalPos;
        matchedLen = part.length;
      }
    }
    if (idx === -1) {
      orderedMatch = false;
      break;
    }
    indices.push(idx);
    offset = idx + matchedLen;
  }
  const expanded = [];
  if (orderedMatch) {
    for (let i = 0;i < indices.length; i += 1) {
      const start = indices[i];
      const end = i + 1 < indices.length ? indices[i + 1] : merged.length;
      const candidate = merged.slice(start, end).trim();
      if (candidate.length === 0) {
        orderedMatch = false;
        break;
      }
      expanded.push(candidate);
    }
  }
  if (orderedMatch && expanded.length === originalLines.length) {
    return expanded;
  }
  const semicolonSplit = merged.split(/;\s+/).map((line, idx, arr) => {
    if (idx < arr.length - 1 && !line.endsWith(";")) {
      return `${line};`;
    }
    return line;
  }).map((line) => line.trim()).filter((line) => line.length > 0);
  if (semicolonSplit.length === originalLines.length) {
    return semicolonSplit;
  }
  return replacementLines;
}
function restoreIndentForPairedReplacement(originalLines, replacementLines) {
  if (originalLines.length !== replacementLines.length) {
    return replacementLines;
  }
  return replacementLines.map((line, idx) => {
    if (line.length === 0)
      return line;
    if (leadingWhitespace2(line).length > 0)
      return line;
    const indent = leadingWhitespace2(originalLines[idx]);
    if (indent.length === 0)
      return line;
    if (originalLines[idx].trim() === line.trim())
      return line;
    return `${indent}${line}`;
  });
}
function autocorrectReplacementLines(originalLines, replacementLines) {
  let next = replacementLines;
  next = maybeExpandSingleLineMerge(originalLines, next);
  next = restoreOldWrappedLines(originalLines, next);
  next = restoreIndentForPairedReplacement(originalLines, next);
  return next;
}

// src/vendor/edit-operation-primitives.ts
function shouldValidate(options) {
  return options?.skipValidation !== true;
}
function applySetLine(lines, anchor, newText, options) {
  if (shouldValidate(options))
    validateLineRef(lines, anchor);
  const { line } = parseLineRef(anchor);
  const result = [...lines];
  const originalLine = lines[line - 1] ?? "";
  const corrected = autocorrectReplacementLines([originalLine], toNewLines(newText));
  const replacement = corrected.map((entry, idx) => {
    if (idx !== 0)
      return entry;
    return restoreLeadingIndent(originalLine, entry);
  });
  result.splice(line - 1, 1, ...replacement);
  return result;
}
function applyReplaceLines(lines, startAnchor, endAnchor, newText, options) {
  if (shouldValidate(options)) {
    validateLineRef(lines, startAnchor);
    validateLineRef(lines, endAnchor);
  }
  const { line: startLine } = parseLineRef(startAnchor);
  const { line: endLine } = parseLineRef(endAnchor);
  if (startLine > endLine) {
    throw new Error(`Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`);
  }
  const result = [...lines];
  const originalRange = lines.slice(startLine - 1, endLine);
  const stripped = stripRangeBoundaryEcho(lines, startLine, endLine, toNewLines(newText));
  const corrected = autocorrectReplacementLines(originalRange, stripped);
  const restored = corrected.map((entry, idx) => {
    if (idx !== 0)
      return entry;
    return restoreLeadingIndent(lines[startLine - 1] ?? "", entry);
  });
  result.splice(startLine - 1, endLine - startLine + 1, ...restored);
  return result;
}
function applyInsertAfter(lines, anchor, text, options) {
  if (shouldValidate(options))
    validateLineRef(lines, anchor);
  const { line } = parseLineRef(anchor);
  const result = [...lines];
  const newLines = stripInsertAnchorEcho(lines[line - 1], toNewLines(text));
  if (newLines.length === 0) {
    throw new Error(`append (anchored) requires non-empty text for ${anchor}`);
  }
  result.splice(line, 0, ...newLines);
  return result;
}
function applyInsertBefore(lines, anchor, text, options) {
  if (shouldValidate(options))
    validateLineRef(lines, anchor);
  const { line } = parseLineRef(anchor);
  const result = [...lines];
  const newLines = stripInsertBeforeEcho(lines[line - 1], toNewLines(text));
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
  return [...lines, ...normalized];
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

// src/vendor/edit-operations.ts
function arraysEqual(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
function applyHashlineEditsWithReport(content, edits) {
  if (edits.length === 0) {
    return {
      content,
      noopEdits: 0,
      deduplicatedEdits: 0
    };
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
        const next = edit.end ? applyReplaceLines(lines, edit.pos, edit.end, edit.lines, { skipValidation: true }) : applySetLine(lines, edit.pos, edit.lines, { skipValidation: true });
        if (arraysEqual(next, lines)) {
          noopEdits += 1;
          break;
        }
        lines = next;
        break;
      }
      case "append": {
        const next = edit.pos ? applyInsertAfter(lines, edit.pos, edit.lines, { skipValidation: true }) : applyAppend(lines, edit.lines);
        if (arraysEqual(next, lines)) {
          noopEdits += 1;
          break;
        }
        lines = next;
        break;
      }
      case "prepend": {
        const next = edit.pos ? applyInsertBefore(lines, edit.pos, edit.lines, { skipValidation: true }) : applyPrepend(lines, edit.lines);
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
// src/vendor/diff-utils.ts
function toHashlineContent(content) {
  if (!content)
    return content;
  const lines = content.split(`
`);
  const lastLine = lines[lines.length - 1];
  const hasTrailingNewline = lastLine === "";
  const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const hashlined = contentLines.map((line, i) => {
    const lineNum = i + 1;
    const hash = computeLineHash(lineNum, line);
    return `${lineNum}#${hash}|${line}`;
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
      dp[i2][j2] = oldLines[i2] === newLines[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ t: "eq", a: i, b: j, lines: [oldLines[i]] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "del", a: i, b: j, lines: [oldLines[i]] });
      i++;
    } else {
      ops.push({ t: "ins", a: i, b: j, lines: [newLines[j]] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ t: "del", a: i, b: j, lines: [oldLines[i]] });
    i++;
  }
  while (j < m) {
    ops.push({ t: "ins", a: i, b: j, lines: [newLines[j]] });
    j++;
  }
  return ops;
}
function generateUnifiedDiff(oldContent, newContent, filePath) {
  const oldLines = oldContent.split(`
`);
  const newLines = newContent.split(`
`);
  const ops = lcsOp(oldLines, newLines);
  const context = 3;
  const out = [];
  out.push("--- " + filePath);
  out.push("+++ " + filePath);
  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].t === "eq") {
      idx++;
      continue;
    }
    const start = Math.max(0, idx - context);
    let end = idx + context;
    while (end < ops.length && ops[end].t === "eq")
      end++;
    end = Math.min(ops.length, end + context);
    let aStart = 0, aCount = 0, bStart = 0, bCount = 0;
    const body = [];
    for (const op of ops.slice(start, end)) {
      if (op.t === "eq") {
        aStart === 0 && (aStart = op.a);
        bStart === 0 && (bStart = op.b);
        aCount++;
        bCount++;
        body.push(" " + op.lines[0]);
      } else if (op.t === "del") {
        aStart === 0 && (aStart = op.a);
        bStart === 0 && (bStart = op.b);
        aCount++;
        body.push("-" + op.lines[0]);
      } else {
        aStart === 0 && (aStart = op.a);
        bStart === 0 && (bStart = op.b);
        bCount++;
        body.push("+" + op.lines[0]);
      }
    }
    const aPos = aCount ? aStart + 1 : 0;
    const bPos = bCount ? bStart + 1 : 0;
    out.push("@@ -" + aPos + "," + aCount + " +" + bPos + "," + bCount + " @@");
    out.push(...body);
    idx = end;
  }
  return out.join(`
`) + `
`;
}
// src/index.ts
var name = "mpd-hashline";
var inject = ["tools"];
function textBlock(text) {
  return [{ type: "text", text }];
}
function cwd() {
  return process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
}
function registryPath(config) {
  return config.registryFile ? resolve(config.registryFile) : join(cwd(), ".mpd", "hashline-files.json");
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
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify([...new Set(files)], null, 2));
}
function registered(config, fp) {
  const list = readRegistry(registryPath(config));
  const target = resolve(fp);
  return list.some((x) => resolve(x) === target);
}
function editFile(fp, edits, maxDiffChars) {
  const raw = readFileSync(fp, "utf8");
  const report = applyHashlineEditsWithReport(raw, edits);
  writeFileSync(fp, report.content);
  const diff = report.content === raw ? "" : generateUnifiedDiff(raw, report.content, fp).slice(0, maxDiffChars);
  return {
    path: fp,
    lines: report.content === "" ? 0 : report.content.split(`
`).length,
    noopEdits: report.noopEdits,
    deduplicatedEdits: report.deduplicatedEdits,
    diff
  };
}
function apply(ctx, config = {}) {
  const maxDiffChars = config.maxDiffChars ?? 4000;
  ctx.tools.register({
    name: "mpd_hashline_read",
    description: "Show a file as hashline view: one 'LINE#HASH|content' line per source line, where LINE#HASH is the anchor to use with mpd_hashline_edit. Read-only; the file on disk stays plain.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a, v) => textBlock(v.view) },
    execute: async (args) => {
      const fp = resolve(String(args?.path));
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const raw = readFileSync(fp, "utf8");
      const out = toHashlineContent(raw);
      return { path: fp, lines: out === "" ? 0 : out.split(`
`).length, view: out };
    }
  });
  ctx.tools.register({
    name: "mpd_hashline_edit",
    description: "Apply hash-anchored edits to a file: edits are {op: replace|append|prepend, pos: 'LINE#HASH' anchor, end?: 'LINE#HASH' (replace range), lines: 'new text' | ['line1', ...]}. Obtain anchors from mpd_hashline_read. Anchors are validated against current hashes (HashlineMismatchError on drift, with remapped refs); matched edits are applied to plain content and the file is written back plain. Returns noop/deduped counts and a unified diff.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["replace", "append", "prepend"] }, pos: { type: "string" }, end: { type: "string" }, lines: { type: ["string", "array"], items: { type: "string" } } }, required: ["op"], additionalProperties: false } }
      },
      required: ["path", "edits"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, noopEdits: { type: "integer" }, deduplicatedEdits: { type: "integer" }, diff: { type: "string" } }, required: ["path", "lines"], additionalProperties: false },
      render: (_a, v) => textBlock("hashline edited: " + v.path + " (" + v.lines + " lines, noop=" + v.noopEdits + ", deduped=" + v.deduplicatedEdits + `)
` + (v.diff ?? ""))
    },
    execute: async (args) => {
      const fp = resolve(String(args?.path));
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const edits = Array.isArray(args?.edits) ? args.edits : [];
      if (edits.length === 0)
        throw new Error("mpd-hashline: at least one edit required");
      return editFile(fp, edits, maxDiffChars);
    }
  });
  ctx.tools.register({
    name: "mpd_hashline_format",
    description: "Register a file for the hashline discipline (idempotent; the file on disk is NOT changed). After registration the post-edit guard warns when plain edit/write tools change the file. The returned view is the hashline anchor view.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a, v) => textBlock("hashline disciplined: " + v.path + `
` + v.view) },
    execute: async (args) => {
      const fp = resolve(String(args?.path));
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const rp = registryPath(config);
      writeRegistry(rp, [...readRegistry(rp), fp]);
      const raw = readFileSync(fp, "utf8");
      const out = toHashlineContent(raw);
      return { path: fp, lines: out === "" ? 0 : out.split(`
`).length, view: out };
    }
  });
  ctx.tools.register({
    name: "mpd_hashline_restore",
    description: "Unregister a file from the hashline discipline (the plain file content is untouched). After this, plain edits no longer trigger the hashline guard.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, render: (_a, v) => textBlock("hashline discipline removed: " + v.path) },
    execute: async (args) => {
      const fp = resolve(String(args?.path));
      const rp = registryPath(config);
      writeRegistry(rp, readRegistry(rp).filter((x) => resolve(x) !== fp));
      return { path: fp };
    }
  });
  if (config.guardEditTools !== false) {
    ctx.on("tools/post-execute", async (exec, result, next) => {
      const out = await next();
      if (out.kind !== "accept")
        return out;
      const isEdit = exec.name === "edit" || exec.name === "str_replace_editor" || exec.name === "write";
      if (!isEdit)
        return out;
      const fp = exec.arguments?.file_path ?? exec.arguments?.path;
      if (typeof fp !== "string" || !registered(config, fp))
        return out;
      const hint = `
[mpd-hashline guard] ` + fp + " is hashline-disciplined and was changed with a plain edit tool, so the LINE#HASH anchors you saw are now stale. Re-read with mpd_hashline_read and continue with mpd_hashline_edit, or run mpd_hashline_restore to drop the discipline.";
      const content = out.content ?? result?.content ?? "";
      return { ...out, content: typeof content === "string" ? content + hint : content };
    });
  }
}
export {
  apply,
  inject,
  name
};
