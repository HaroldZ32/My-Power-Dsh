import re
import sys
import pathlib

target = pathlib.Path(sys.argv[1])
before = target.read_text()
after, count = re.subn(r"\n  rules: \{\n.*?\n  \},\n", "\n", before, count=1, flags=re.S)
assert count == 1, "the rules block was not found"
target.write_text(after)
print("FU-1 strip: removed", len(before) - len(after), "bytes")
print("FU-1 strip: 'rules: {' still in source:", "rules: {" in after)
print("FU-1 strip: 'doc_rewrite: {' still in source:", "doc_rewrite: {" in after)
