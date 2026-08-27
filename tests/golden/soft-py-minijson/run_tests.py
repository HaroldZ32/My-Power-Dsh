import json, random, sys
sys.path.insert(0, "tests/golden/soft-py-minijson")
from solution import parse

def case(text, expected):
    got = parse(text)
    assert got == expected, f"{text!r}: {got!r} != {expected!r}"

case("null", None)
case("true", True)
case("false", False)
case("42", 42)
case("-3.5", -3.5)
case("1e3", 1000.0)
case('"hi\\nthere"', "hi\nthere")
case("[1, 2, 3]", [1, 2, 3])
case('{"a": 1, "b": [true, null]}', {"a": 1, "b": [True, None]})
case(" { \"k\" : \"v\" } ", {"k": "v"})
for _ in range(50):
    obj = {"x": random.randint(-100, 100), "y": [random.random(), None, "s"]}
    case(json.dumps(obj), obj)
for bad in ["", "{", "[1,]", '{"a":}', "01", '{"a": 1,}']:
    try:
        parse(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for " + repr(bad))
print("soft-py-minijson OK")
