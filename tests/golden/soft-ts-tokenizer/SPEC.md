# Golden task: soft-ts-tokenizer (TypeScript)

Objective: implement `tests/golden/soft-ts-tokenizer/tokenizer.ts` exporting
`tokenize(src: string): Token[]` where
`type Token = { type: "num" | "ident" | "op" | "lparen" | "rparen" | "string"; value: string; pos: number }`.

Rules:
- skip whitespace between tokens;
- num: [0-9]+ (optionally . [0-9]+);
- ident: [A-Za-z_][A-Za-z0-9_]*;
- string: double-quoted with \\-escapes (\\", \\\\, \\n, \\t);
- ops: + - * / = == != <= >= < > && ||;
- ( ) are lparen/rparen tokens.

Acceptance: `bun test tests/golden/soft-ts-tokenizer` passes (tokenizer.test.ts).
