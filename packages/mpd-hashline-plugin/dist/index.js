// packages/mpd-hashline-plugin/src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolve2 } from "node:path";

// packages/mpd-hashline-plugin/src/vendor/constants.ts
var NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
var HASHLINE_DICT = Array.from({ length: 256 }, (_, i) => {
  const high = i >>> 4;
  const low = i & 15;
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`;
});
var HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/;
// packages/mpd-hashline-plugin/src/vendor/xxhash32.ts
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

// packages/mpd-hashline-plugin/src/vendor/hash-computation.ts
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
// packages/mpd-hashline-plugin/src/vendor/validation.ts
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
// packages/mpd-hashline-plugin/src/vendor/edit-text-normalization.ts
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

// packages/mpd-hashline-plugin/src/vendor/edit-deduplication.ts
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

// packages/mpd-hashline-plugin/src/vendor/edit-ordering.ts
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

// packages/mpd-hashline-plugin/src/vendor/autocorrect-replacement-lines.ts
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

// packages/mpd-hashline-plugin/src/vendor/edit-operation-primitives.ts
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

// packages/mpd-hashline-plugin/src/vendor/edit-operations.ts
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
// packages/mpd-hashline-plugin/src/vendor/normalize-edits.ts
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
  const normalized = {
    op: "replace",
    pos: anchor,
    lines
  };
  if (end)
    normalized.end = end;
  return normalized;
}
function normalizeAppendEdit(edit, index) {
  const pos = normalizeAnchor(edit.pos);
  const end = normalizeAnchor(edit.end);
  const anchor = pos ?? end;
  const lines = requireLines(edit, index);
  const normalized = {
    op: "append",
    lines
  };
  if (anchor)
    normalized.pos = anchor;
  return normalized;
}
function normalizePrependEdit(edit, index) {
  const pos = normalizeAnchor(edit.pos);
  const end = normalizeAnchor(edit.end);
  const anchor = pos ?? end;
  const lines = requireLines(edit, index);
  const normalized = {
    op: "prepend",
    lines
  };
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
// packages/mpd-hashline-plugin/src/vendor/diff-utils.ts
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
// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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
function message(error) {
  return error instanceof Error ? error.message : String(error);
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
    return resolve(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve(override);
  return process.cwd();
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
        roots.add(resolve(cwd));
    }
    return [...roots];
  } catch {
    return [];
  }
}
function noop() {}
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
  const engineCache = new Map;
  function compactionEngineForAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const cached = engineCache.get(id);
    if (cached !== undefined)
      return cached;
    const agent = liveAgent(id);
    const scoped = agent?.ctx;
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
    engineCache.set(id, engine);
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
      console.warn("mpd-dsh-adapter: llmCatalog degraded — " + detail);
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
      warnLlmCatalogOnce("listProviders() failed: " + message(error));
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
        subagentsProviderRegister: typeof subagents?.registerProvider === "function"
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
    llmCatalog,
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
            submit: (message2) => adapter.submitUserTurn(host.agent, message2)
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
    hasTool(toolName) {
      const tools = service("tools");
      if (typeof tools?.get !== "function")
        return false;
      try {
        return tools.get(toolName) !== undefined;
      } catch {
        return false;
      }
    },
    toolRuntime() {
      const tools = service("tools");
      return {
        get: (toolName) => typeof tools?.get === "function" ? tools.get(toolName) : undefined,
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
        const isError = raw?.isError === true;
        if (isError) {
          const error = raw?.error;
          return { ok: false, isError: true, error: error?.message ?? error ?? "tool error", raw };
        }
        return { ok: true, isError: false, value: raw?.value, raw };
      } catch (error) {
        return { ok: false, isError: true, error: message(error) };
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
        console.warn("[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)");
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
              console.warn("[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27");
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
    startAgentTurn(agent, message2) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn");
      followup.call(agent, message2);
    },
    cancelAgentTurn(agent, cause, options) {
      const cancel = agent?.cancel;
      if (typeof cancel !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn");
      cancel.call(agent, cause, options);
    },
    steerAgentTurn(agent, message2) {
      const steer = agent?.steer;
      if (typeof steer !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn");
      steer.call(agent, message2);
    },
    injectAgentMessage(agent, message2) {
      const inject = agent?.inject;
      if (typeof inject !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it");
      inject.call(agent, message2);
    },
    submitUserTurn(agent, message2) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        return false;
      try {
        followup.call(agent, message2);
        return true;
      } catch {
        return false;
      }
    }
  };
  return adapter;
}

// packages/mpd-hashline-plugin/src/index.ts
var name = "mpd-hashline";
var inject = ["tools"];
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
function textBlock2(text) {
  return [{ type: "text", text }];
}
function registryPath(config, dsh, exec) {
  return config.registryFile ? resolve2(config.registryFile) : join(dsh.workspaceRoot(exec), ".mpd", "hashline-files.json");
}
function sessionPath(target, dsh, exec) {
  return isAbsolute(target) ? resolve2(target) : resolve2(dsh.workspaceRoot(exec), target);
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
function registered(config, dsh, fp, exec) {
  const list = readRegistry(registryPath(config, dsh, exec));
  const target = sessionPath(fp, dsh, exec);
  return list.some((x) => sessionPath(x, dsh, exec) === target);
}
function editFile(fp, edits, maxDiffChars) {
  const raw = readFileSync(fp, "utf8");
  const report = applyHashlineEditsWithReport(raw, edits);
  writeFileSync(fp, report.content);
  const diff = report.content === raw ? "" : generateUnifiedDiff(raw, report.content, fp).slice(0, maxDiffChars);
  const contentForCount = report.content.endsWith(`
`) ? report.content.slice(0, -1) : report.content;
  return {
    path: fp,
    lines: contentForCount === "" ? 0 : contentForCount.split(`
`).length,
    noopEdits: report.noopEdits,
    deduplicatedEdits: report.deduplicatedEdits,
    diff
  };
}
function apply(ctx, config = {}) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  const cfg = mergedConfig(ctx, config);
  const maxDiffChars = cfg.maxDiffChars ?? 4000;
  dsh.registerTool({
    name: "mpd_hashline_read",
    description: "Show a file as hashline view: one 'LINE#HASH|content' line per source line, where LINE#HASH is the anchor to use with mpd_hashline_edit. Read-only; the file on disk stays plain.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a, v) => textBlock2(v.view) },
    execute: async (args, exec) => {
      const fp = sessionPath(String(args?.path), dsh, exec);
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const raw = readFileSync(fp, "utf8");
      const out = toHashlineContent(raw);
      return { path: fp, lines: out === "" ? 0 : out.split(`
`).length, view: out };
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
      render: (_a, v) => textBlock2("hashline edited: " + v.path + " (" + v.lines + " lines, noop=" + v.noopEdits + ", deduped=" + v.deduplicatedEdits + `)
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
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a, v) => textBlock2("hashline disciplined: " + v.path + `
` + v.view) },
    execute: async (args, exec) => {
      const fp = sessionPath(String(args?.path), dsh, exec);
      if (!existsSync(fp))
        throw new Error("mpd-hashline: file not found: " + fp);
      const rp = registryPath(cfg, dsh, exec);
      writeRegistry(rp, [...readRegistry(rp), fp]);
      const raw = readFileSync(fp, "utf8");
      const out = toHashlineContent(raw);
      return { path: fp, lines: out === "" ? 0 : out.split(`
`).length, view: out };
    }
  });
  dsh.registerTool({
    name: "mpd_hashline_restore",
    description: "Unregister a file from the hashline discipline (the plain file content is untouched). After this, plain edits no longer trigger the hashline guard.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, render: (_a, v) => textBlock2("hashline discipline removed: " + v.path) },
    execute: async (args, exec) => {
      const fp = sessionPath(String(args?.path), dsh, exec);
      const rp = registryPath(cfg, dsh, exec);
      writeRegistry(rp, readRegistry(rp).filter((x) => resolve2(x) !== fp));
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
