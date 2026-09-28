/** Buffers formatted anchor lines and hands them back in size-bounded chunks. */
export interface HashlineChunkFormatter {
  /** Buffer one formatted line and return the chunks a threshold released; `[]` while buffering. */
  push(formattedLine: string): string[]
  /** Take the buffered remainder as the final chunk, or `undefined` when nothing is buffered. */
  flush(): string | undefined
}

/** The two size thresholds at which a buffered run of lines is closed and handed back as a chunk. */
interface HashlineChunkFormatterOptions {
  /** Line threshold, in lines per chunk; a full chunk is closed at or before this count. */
  maxChunkLines: number
  /** Byte threshold, measured in UTF-8 bytes joined by one `\n` per boundary, no trailing `\n`. */
  maxChunkBytes: number
}

/** Create a formatter that buffers lines and yields them only once a size threshold is reached. */
export function createHashlineChunkFormatter(options: HashlineChunkFormatterOptions): HashlineChunkFormatter {
  // The two thresholds, unpacked once so `push` reads them without going back through `options`.
  const { maxChunkLines, maxChunkBytes } = options
  // Lines buffered since the last chunk was released; joined with `\n` to form the chunk text.
  let outputLines: string[] = []
  // UTF-8 byte length of `outputLines` including its `\n` separators, so the budget is exact.
  let outputBytes = 0

  /** Release the buffered lines as one chunk, or `undefined` when the buffer is already empty. */
  const flush = (): string | undefined => {
    if (outputLines.length === 0) return undefined
    // The released chunk text: the buffered lines joined with `\n` and no trailing newline.
    const chunk = outputLines.join("\n")
    outputLines = []
    outputBytes = 0
    return chunk
  }

  /** Add one formatted line, returning the chunks its arrival closed (at most two, in order). */
  const push = (formattedLine: string): string[] => {
    // Chunks released by this call, in the order the caller must yield them.
    const chunksToYield: string[] = []
    // Bytes the `\n` before this line would cost: one per boundary, so zero on an empty buffer.
    const separatorBytes = outputLines.length === 0 ? 0 : 1
    // Cost of the arriving line alone, counted in UTF-8 bytes to match the byte threshold.
    const lineBytes = Buffer.byteLength(formattedLine, "utf-8")

    if (
      outputLines.length > 0 &&
      (outputLines.length >= maxChunkLines || outputBytes + separatorBytes + lineBytes > maxChunkBytes)
    ) {
      // The already-buffered run, closed here so the arriving line never overflows the budget.
      const flushed = flush()
      if (flushed) chunksToYield.push(flushed)
    }

    outputLines.push(formattedLine)
    outputBytes += (outputLines.length === 1 ? 0 : 1) + lineBytes

    if (outputLines.length >= maxChunkLines || outputBytes >= maxChunkBytes) {
      // The run that just reached a threshold on its own, so the buffer empties immediately.
      const flushed = flush()
      if (flushed) chunksToYield.push(flushed)
    }

    return chunksToYield
  }

  return {
    push,
    flush,
  }
}
