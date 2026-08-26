# Integration Review — tests/mcp-fixtures/sample.c

Reviewed object: `tests/mcp-fixtures/sample.c` (single line: `int main(void) { return 0; }`)

## Team members

- **librarian** — documentary / structural review
- **oracle** — correctness / memory-safety review

## 1. Librarian — documentary / structural suggestions

- **Add a header comment** identifying this fixture as the ast-grep scan target for `skills/dsh-qa/scripts/mcp-call.mjs`. The QA case scans this file for the `return 0` pattern via `mcp__ast_grep__search` (mcp-call.mjs lines 13 and 56); a short header comment makes that role discoverable for anyone reading the fixture.
- **Keep the code as-is.** The file is already a minimal, valid C99/C11 entry point (`int main(void)` prototype, explicit `return 0`, trailing newline, no `#include` needed). No structural reformatting is required.
- **Do not rename `sample.c`.** The path is referenced by the QA job prompt in `mcp-call.mjs` and by golden-task evidence; renaming would break the scan target and the QA assertions.

## 2. Oracle — correctness / memory-safety verdict

- **Verdict: conforming.** The code is a standard-compliant minimal C entry point with correct signature and explicit return; **no bugs, no undefined behavior, no memory-safety issues, no security issues** were found.
- **Keep the literal `return 0` token.** It is the functional payload that the `mcp__ast_grep__search` call must match; changing or removing it would break the QA case.
- **No behavioral change required.** The file is already correct as-is; no edits that alter behavior are needed.
- **Optional:** a self-documenting comment (e.g., `/* MCP fixture: minimal C entry point scanned by skills/dsh-qa/scripts/mcp-call.mjs — keep valid C and minimal. */`) is acceptable since it improves discoverability without changing behavior, but it is optional and not required for correctness.

## Conclusion

Both team members agree the fixture should remain functionally unchanged: the code is conforming and safe, the `return 0` token must be kept for the ast-grep scan, and any change is limited to an optional documentary header comment — with `sample.c` staying in place as the scan target for `skills/dsh-qa/scripts/mcp-call.mjs`.
