import re, random, sys

PATH = "tests/golden/hw-sv-mux4/mux4.sv"
try:
    src = open(PATH).read()
except FileNotFoundError:
    print("FAIL mux4.sv missing"); sys.exit(1)

def fail(msg):
    print("FAIL " + msg); sys.exit(1)

if "module mux4" not in src:
    fail("module mux4 not found")
sp = re.sub(r"\s+", " ", src)
for p in ["input logic [1:0] sel", "input logic [3:0] a0", "input logic [3:0] a1",
          "input logic [3:0] a2", "input logic [3:0] a3", "output logic [3:0] out"]:
    if p not in sp:
        fail("port missing: " + p)
if "always_comb" not in sp or "case (sel)" not in sp:
    fail("always_comb/case not found")
mcase = re.search(r"case\s*\(\s*sel\s*\)([\s\S]*?)endcase", src)
if not mcase:
    fail("case block missing")
block = mcase.group(1)
arms = {}
for m in re.finditer(r"2'd\s*(\d)\s*:\s*out\s*=\s*(a\d)\s*;", block):
    arms[int(m.group(1))] = m.group(2)
if sorted(arms) != [0, 1, 2]:
    fail("case arms mismatch: " + repr(arms))
d = re.search(r"default\s*:\s*out\s*=\s*(a\d)\s*;", block)
if not d:
    fail("default missing")

def run(sel, a0, a1, a2, a3):
    table = {0: a0, 1: a1, 2: a2, 3: a3}
    if sel in arms:
        return table[int(arms[sel][1:])]
    return table[int(d.group(1)[1:])]

random.seed(11)
for _ in range(80):
    sel = random.randint(0, 3)
    vals = [random.randint(0, 15) for _ in range(4)]
    if run(sel, *vals) != vals[sel]:
        fail(f"sel={sel} vals={vals}")
assert run(0, 5, 6, 7, 8) == 5 and run(3, 5, 6, 7, 8) == 8
print("hw-sv-mux4 OK (80 random + edge vector)")
