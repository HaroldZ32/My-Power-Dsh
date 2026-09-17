#!/usr/bin/env python3
# t15 reviewer's OWN implementation of the vendor tree fold (repin-vendor/verify-vendor spec):
# files sorted by relative path; text (no NUL) CRLF/CR -> LF; fold "rel\n<sha256 hex>\n" into a sha256.
# Used to (a) cross-validate against the real tool on the current tree and (b) attribute the corpus
# delta since t11's dry run by folding a scratch copy with ONE file reverted to HEAD.
import hashlib, os, subprocess, sys

def list_files(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "__pycache__")]
        for name in filenames:
            if name.endswith((".pyc", ".pyo")):
                continue
            out.append(os.path.join(dirpath, name))
    return out

def read_bytes(p):
    with open(p, "rb") as f:
        buf = f.read()
    if b"\0" not in buf:
        return buf.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return buf

def fingerprint(root):
    lf = hashlib.sha256()
    raw = hashlib.sha256()
    n = 0
    normalized = 0
    for rel in sorted(os.path.relpath(p, root) for p in list_files(root)):
        p = os.path.join(root, rel)
        lfb = read_bytes(p)
        rawb = open(p, "rb").read()
        if lfb != rawb:
            normalized += 1
        lf.update((rel + "\n" + hashlib.sha256(lfb).hexdigest() + "\n").encode())
        raw.update((rel + "\n" + hashlib.sha256(rawb).hexdigest() + "\n").encode())
        n += 1
    return {"fileCount": n, "treeSha": lf.hexdigest(), "rawTreeSha": raw.hexdigest(), "normalized": normalized}

mode = sys.argv[1]
if mode == "current":
    print(fingerprint("skills"))
elif mode == "reverted":
    # build a scratch copy of skills/ with the second-writer file replaced by its HEAD content
    scratch = sys.argv[2]
    subprocess.run(["mkdir", "-p", scratch], check=True)
    subprocess.run(["cp", "-r", "skills/.", scratch + "/"], check=True)
    head = subprocess.run(["git", "show", "HEAD:skills/dsh-qa/scripts/lib/immutable-output.mjs"], capture_output=True, check=True).stdout
    with open(os.path.join(scratch, "dsh-qa/scripts/lib/immutable-output.mjs"), "wb") as f:
        f.write(head)
    print(fingerprint(scratch))
