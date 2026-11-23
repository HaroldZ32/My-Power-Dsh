/** A small LSP peer that diagnoses only the document text it receives over the wire. */
interface Message {
  /** Present on requests and omitted on notifications. */
  readonly id?: number
  /** The LSP operation the client sent. */
  readonly method: string
  /** Document payload used for open and change notifications. */
  readonly params?: {
    readonly textDocument?: { readonly uri: string; readonly version: number; readonly text?: string }
    readonly contentChanges?: readonly { readonly text: string }[]
  }
}

/** Write a byte-framed LSP message on the configured child's stdout. */
function send(message: object): void {
  /** A JSON text frame needs its UTF-8 byte length, including non-ASCII diagnostic text. */
  const body = JSON.stringify({ jsonrpc: "2.0", ...message })
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

/** Acknowledge startup and make published diagnostics reflect the latest synchronized content. */
function handle(message: Message): void {
  if (message.method === "initialize") {
    send({ id: message.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1 } } } })
    return
  }
  if (message.method === "initialized") {
    // cclsp 0.7.0 waits for this extra notification, although the server normally sends no response.
    send({ method: "initialized", params: {} })
    return
  }
  if (message.id !== undefined) {
    send({ id: message.id, error: { code: -32601, message: "Push diagnostics only" } })
    return
  }
  /** Use the wire content, so an ordinary filesystem edit alone cannot change the answer. */
  const document = message.params?.textDocument
  /** Opening sends text on the document itself while a full change sends it in contentChanges. */
  const text = document?.text ?? message.params?.contentChanges?.at(-1)?.text
  if (!document || text === undefined) return
  /** Simple deterministic diagnostic markers, independent of any installed language toolchain. */
  const issue = text.includes('"wrong"') ? "string type mismatch" : text.includes("false") ? "boolean type mismatch" : undefined
  send({ method: "textDocument/publishDiagnostics", params: {
    uri: document.uri,
    version: document.version,
    diagnostics: issue === undefined ? [] : [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: issue,
    }],
  } })
}

/** A header or UTF-8 body can straddle more than one input chunk. */
let pending = Buffer.alloc(0)
process.stdin.on("data", (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk])
  while (pending.length > 0) {
    /** Delimiter separating the header block from one JSON frame. */
    const boundary = pending.indexOf("\r\n\r\n")
    if (boundary < 0) return
    /** The header can contain other fields, but Content-Length is required. */
    const length = Number(/Content-Length: (\d+)/i.exec(pending.subarray(0, boundary).toString())?.[1])
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error("Invalid LSP frame")
    /** The byte offset just past this message. */
    const end = boundary + 4 + length
    if (pending.length < end) return
    handle(JSON.parse(pending.subarray(boundary + 4, end).toString()) as Message)
    pending = pending.subarray(end)
  }
})
