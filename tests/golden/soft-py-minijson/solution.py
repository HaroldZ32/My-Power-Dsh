"""Minimal JSON parser (stdlib only) for the plan-f golden suite."""

import re

_TOKEN_RE = re.compile(r'\s*(?:(?P<true>true)|(?P<false>false)|(?P<null>null)|(?P<str>"(?:\\.|[^"\\])*")|(?P<num>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?P<l>[\[\]{}:,]))')


def _decode_string(tok: str) -> str:
    out = []
    i = 1
    while i < len(tok) - 1:
        c = tok[i]
        if c == "\\":
            n = tok[i + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/"}.get(n, n))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parse(text: str):
    pos = 0

    def skip():
        nonlocal pos
        while pos < len(text) and text[pos] in " \t\n\r":
            pos += 1

    def value():
        nonlocal pos
        skip()
        m = _TOKEN_RE.match(text, pos)
        if not m:
            raise ValueError("invalid JSON at " + str(pos))
        pos = m.end()
        g = m.groupdict()
        if g["true"]:
            return True
        if g["false"]:
            return False
        if g["null"]:
            return None
        if g["str"]:
            return _decode_string(m.group("str"))
        if g["num"]:
            if re.match(r"-?0\d", m.group("num")):
                raise ValueError("leading zero at " + str(pos))
            return float(m.group("num")) if ("." in m.group("num") or "e" in m.group("num")) else int(m.group("num"))
        ch = m.group()
        if ch == "[":
            arr = []
            skip()
            if pos >= len(text):
                raise ValueError("unterminated array at " + str(pos))
            if text[pos] == "]":
                pos += 1
                return arr
            while True:
                arr.append(value())
                skip()
                if text[pos] == ",":
                    pos += 1
                    continue
                if text[pos] == "]":
                    pos += 1
                    return arr
                raise ValueError("expected , or ] at " + str(pos))
        if ch == "{":
            obj = {}
            skip()
            if pos >= len(text):
                raise ValueError("unterminated object at " + str(pos))
            if text[pos] == "}":
                pos += 1
                return obj
            while True:
                skip()
                if pos >= len(text) or text[pos] != '"':
                    raise ValueError("expected object key at " + str(pos))
                m2 = _TOKEN_RE.match(text, pos)
                if not m2:
                    raise ValueError("bad key at " + str(pos))
                key = _decode_string(m2.group("str"))
                pos = m2.end()
                skip()
                if text[pos] != ":":
                    raise ValueError("expected : at " + str(pos))
                pos += 1
                obj[key] = value()
                skip()
                if text[pos] == ",":
                    pos += 1
                    continue
                if text[pos] == "}":
                    pos += 1
                    return obj
                raise ValueError("expected , or } at " + str(pos))
        raise ValueError("unexpected char " + repr(ch) + " at " + str(pos))

    result = value()
    skip()
    if pos != len(text):
        raise ValueError("trailing data at " + str(pos))
    return result
