export type Token = {
  type: "num" | "ident" | "op" | "lparen" | "rparen" | "string"
  value: string
  pos: number
}

const NUM_RE = /^[0-9]+(?:\.[0-9]+)?/
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/
const MULTI_OPS = ["==", "!=", "<=", ">=", "&&", "||"]
const SINGLE_OPS = ["+", "-", "*", "/", "=", "<", ">", ","]

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = src.length

  while (i < n) {
    const ch = src[i]

    // skip whitespace between tokens
    if (/\s/.test(ch)) {
      i++
      continue
    }

    // lparen / rparen
    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(", pos: i })
      i++
      continue
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")", pos: i })
      i++
      continue
    }

    // double-quoted string (kept verbatim, including quotes and escapes)
    if (ch === '"') {
      const start = i
      i++
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          i += 2
        } else {
          i++
        }
      }
      if (i < n) i++ // consume closing quote
      tokens.push({ type: "string", value: src.slice(start, i), pos: start })
      continue
    }

    // number
    const numMatch = NUM_RE.exec(src.slice(i))
    if (numMatch) {
      const value = numMatch[0]
      tokens.push({ type: "num", value, pos: i })
      i += value.length
      continue
    }

    // identifier
    const identMatch = IDENT_RE.exec(src.slice(i))
    if (identMatch) {
      const value = identMatch[0]
      tokens.push({ type: "ident", value, pos: i })
      i += value.length
      continue
    }

    // operators (multi-char first)
    const two = src.slice(i, i + 2)
    if (MULTI_OPS.includes(two)) {
      tokens.push({ type: "op", value: two, pos: i })
      i += 2
      continue
    }
    if (SINGLE_OPS.includes(ch)) {
      tokens.push({ type: "op", value: ch, pos: i })
      i++
      continue
    }

    // unrecognized character: skip it
    i++
  }

  return tokens
}
