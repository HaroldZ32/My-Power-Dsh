import re, random, sys

PATH = "tests/golden/hw-verilog-adder8/adder8.v"
try:
    src = open(PATH).read()
except FileNotFoundError:
    print("FAIL adder8.v missing"); sys.exit(1)

def fail(msg):
    print("FAIL " + msg); sys.exit(1)

if "module adder8" not in src:
    fail("module adder8 not found")
ports = {}
for m in re.finditer(r"input\s+\[7:0\]\s+(a|b)", src): ports[m.group(1)] = 8
m = re.finditer(r"input\s+(cin)", src)
for mm in m: ports[mm.group(1)] = 1
for m in re.finditer(r"output\s+\[7:0\]\s+(sum)", src): ports[m.group(1)] = 8
for m in re.finditer(r"output\s+(cout)", src): ports[m.group(1)] = 1
if sorted(ports) != sorted(["a", "b", "cin", "sum", "cout"]):
    fail("ports mismatch: " + repr(ports))
if "wire [8:0] wide" not in re.sub(r"\s+", " ", src):
    fail("wire [8:0] wide missing")
if re.search(r"always\b|initial\b|\bmodule\s+\w+\s+[A-Za-z]", src):
    fail("non-assign constructs present")

# restricted expression evaluator
TOK = re.compile(r"\s*(\d+'[bBdhHD][0-9a-fA-FxXzZ]+|\d+|[A-Za-z_][A-Za-z0-9_]*|<<|>>|[+\-*&|^~()])")
def toks(s):
    return [t for t in TOK.findall(s) if t]

def lit(t):
    if re.fullmatch(r"\d+'[bB][01xX]+", t):
        return int(t.split("'")[1], 2)
    if re.fullmatch(r"\d+'[dDhH][0-9a-fA-F]+", t):
        return int(t.split("'")[1], 16)
    return int(t)

def eval_expr(tks, env, i=0):
    # precedence: | ^ & << >> + - * (lowest first), inline descent
    def atom(i):
        t = tks[i]
        if t == "(":
            v, i = eval_expr(tks, env, i + 1)
            if tks[i] != ")": raise ValueError("paren")
            return v, i + 1
        if t == "~":
            v, i = atom(i + 1)
            return (~v) & 0x1FF, i
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", t):
            if t not in env: raise ValueError("unknown " + t)
            return env[t], i + 1
        return lit(t), i + 1
    PREC = {"|": 1, "^": 2, "&": 3, "<<": 4, ">>": 4, "+": 5, "-": 5, "*": 6}
    def op(i, min_prec):
        v, i = atom(i)
        while i < len(tks) and tks[i] in PREC and PREC[tks[i]] >= min_prec:
            o = tks[i]
            r, i = op(i + 1, PREC[o] + 1)
            if o == "*": v = v * r
            elif o == "+": v = v + r
            elif o == "-": v = v - r
            elif o == "<<": v = v << r
            elif o == ">>": v = v >> r
            elif o == "&": v = v & r
            elif o == "|": v = v | r
            elif o == "^": v = v ^ r
        return v, i
    return op(i, 1)

env = {name: 0 for name in ports}
assigns = [(m.group(1), m.group(2)) for m in re.finditer(r"assign\s+([A-Za-z_]\w*)(?:\[\d+:\d+\])?\s*=\s*([^;]+);", src)]
if len(assigns) < 3:
    fail("need at least 3 assigns")

def simulate(a, b, cin):
    env["a"], env["b"], env["cin"] = a, b, cin
    for lhs, rhs in assigns:
        v, _ = eval_expr(toks(rhs), env)
        if lhs == "sum": env["sum"] = v & 0xFF
        elif lhs == "cout": env["cout"] = (v >> 8) & 1
        elif lhs == "wide": env["wide"] = v & 0x1FF
    return env["sum"], env["cout"]

random.seed(7)
for _ in range(60):
    a = random.randint(0, 255); b = random.randint(0, 255); cin = random.randint(0, 1)
    total = a + b + cin
    s, c = simulate(a, b, cin)
    if s != (total & 0xFF) or c != ((total >> 8) & 1):
        fail(f"wrong result a={a} b={b} cin={cin} got sum={s} cout={c}")
for (a, b, cin) in [(0, 0, 0), (255, 255, 1), (128, 127, 1), (1, 255, 0)]:
    total = a + b + cin
    s, c = simulate(a, b, cin)
    if s != (total & 0xFF) or c != ((total >> 8) & 1):
        fail(f"edge fail a={a} b={b} cin={cin}")
print("hw-verilog-adder8 OK (60 random + 4 edge vectors)")
