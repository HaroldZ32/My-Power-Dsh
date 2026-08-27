# Golden task: soft-py-minijson (Python 3, stdlib only)

Objective: implement `tests/golden/soft-py-minijson/solution.py` with
`def parse(text: str) -> object` returning the JSON value. Support objects, arrays,
strings (escapes), integers/floats (incl. exponent), true/false/null, whitespace.
Invalid input raises ValueError. No third-party packages.

Acceptance: `python3 tests/golden/soft-py-minijson/run_tests.py` passes.
