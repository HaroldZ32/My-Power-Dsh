#!/usr/bin/env bash
set -u
cd /root/dshProj/my-power-dsh
R=evidence/rtl-extraction-residual/repair/raw
log() { echo "$@" | tee -a $R/freshness.log; }
: > $R/freshness.log

log "### 0) pre-state"
for f in packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts packages/mpd-mcp-lsp/dist/cli.js dist/mpd-package/package.json; do
  [ -e "$f" ] && log "$(stat -c '%y %s %n' "$f")"
done
log "overlay sha256 (before): $(sha256sum packages/mpd-mcp-lsp/overlay/lsp/*.ts | sha256sum | cut -c1-16)"

log "### 1) regenerate cli.js AFTER the last overlay write"
MPD_UPSTREAM_ROOT=/root/dshProj/my-power-dsh/.mpd-dsh/upstream node scripts/build-mcp.mjs > $R/freshness-build.log 2>&1
log "build_exit=$?"
log "$(stat -c '%y %s %n' packages/mpd-mcp-lsp/dist/cli.js)"
log "cli sha256: $(sha256sum packages/mpd-mcp-lsp/dist/cli.js | cut -d' ' -f1)"
log "hdl hits in cli: $(grep -c 'verible\|slang-server' packages/mpd-mcp-lsp/dist/cli.js)"
log "overlay sha256 (after build): $(sha256sum packages/mpd-mcp-lsp/overlay/lsp/*.ts | sha256sum | cut -c1-16)"

log "### 1b) behaviour probe + builtin count"
node $R/lsp-mcp-probe.mjs packages/mpd-mcp-lsp/dist/cli.js > $R/probe-fresh.json 2>$R/probe-fresh.err
log "probe_exit=$? tools=$(python3 -c "import json;print(json.load(open('$R/probe-fresh.json'))['toolsCount'])")"
python3 - <<'PY' >> $R/freshness.log
import re
def builtin(path):
    t = open(path, encoding="utf8").read()
    i = t.index("BUILTIN_SERVERS = {"); j = t.index("{", i); depth = 0; k = j
    while True:
        if t[k] == "{": depth += 1
        elif t[k] == "}":
            depth -= 1
            if depth == 0: break
        k += 1
    keys = re.findall(r'(?m)(?:^|[,{])\s*"?([A-Za-z][A-Za-z0-9_@/.-]*)"?\s*:\s*\{', t[j:k+1])
    return sorted(set(keys))
new = builtin("packages/mpd-mcp-lsp/dist/cli.js")
old = builtin("evidence/rtl-extraction-residual/repair/raw/cli-old.js")
print("builtin servers: old=%d new=%d removed=%s added=%s" % (len(old), len(new), sorted(set(old)-set(new)), sorted(set(new)-set(old))))
PY

log "### 2) re-pin VENDOR_LOCK for the new cli.js"
node $R/repin-values.mjs > $R/repin-values-fresh.json
python3 - <<'PY' >> $R/freshness.log
import json, pathlib
vals = json.load(open("evidence/rtl-extraction-residual/repair/raw/repin-values-fresh.json"))
p = pathlib.Path("VENDOR_LOCK.json"); lock = json.loads(p.read_text())
import hashlib
sha = hashlib.sha256(pathlib.Path("packages/mpd-mcp-lsp/dist/cli.js").read_bytes()).hexdigest()
lock["assets"]["skills"]["fileCount"] = vals["skills"]["fileCount"]
lock["assets"]["skills"]["treeSha"] = vals["skills"]["treeSha"]
lock["assets"]["packages/mpd-mcp-lsp/dist/cli.js"]["sha256"] = sha
p.write_text(json.dumps(lock, indent=2) + "\n")
print("re-pinned: skills.fileCount=%d, lsp sha=%s" % (vals["skills"]["fileCount"], sha[:16]))
PY
node scripts/verify-vendor.mjs > $R/freshness-vendor.log 2>&1
log "verify_vendor_exit=$?  ($(tail -1 $R/freshness-vendor.log))"

log "### 3) repack AFTER the regeneration"
node scripts/pack-mpd.mjs > $R/freshness-pack.log 2>&1
log "pack_exit=$?"
log "$(stat -c '%y %s %n' dist/mpd-package/package.json)"
log "packed RTL case scripts: $(find dist/mpd-package -name 'rtl-*.mjs' | wc -l) | packed HDL pages: $(find dist/mpd-package -path '*references/verilog*' -o -path '*references/systemverilog*' | wc -l) | packed installer hdl hits: $(grep -c 'verible\|slang-server\|LSP_TARGETS' dist/mpd-package/scripts/install-mcp.mjs)"
log "packed cli hdl hits: $(grep -c 'verible\|slang-server' dist/mpd-package/packages/mpd-mcp-lsp/dist/cli.js)"

log "### 4) anchor guard failure side on the shipped revision"
cp packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts $R/lm.restore.ts
sed -i 's/mpd-lsp-overlay-v1/mpd-lsp-overlay-RENAMED-BY-PROBE/' packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts
MPD_UPSTREAM_ROOT=/root/dshProj/my-power-dsh/.mpd-dsh/upstream node scripts/build-mcp.mjs > $R/freshness-anchor-probe.log 2>&1
log "anchor_probe_exit=$?  msg=$(grep -o 'lacks drift-guard anchor[^)]*)' $R/freshness-anchor-probe.log | head -1)"
cp $R/lm.restore.ts packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts
rm -f $R/lm.restore.ts
log "anchor strings: mpd-rtl-overlay-v1=$(grep -c 'mpd-rtl-overlay-v1' scripts/build-mcp.mjs packages/mpd-mcp-lsp/overlay/lsp/*.ts | tr '\n' ' ') | mpd-lsp-overlay-v1=$(grep -c 'mpd-lsp-overlay-v1' scripts/build-mcp.mjs packages/mpd-mcp-lsp/overlay/lsp/*.ts | tr '\n' ' ')"
log "overlay sha256 (after probe restore): $(sha256sum packages/mpd-mcp-lsp/overlay/lsp/*.ts | sha256sum | cut -c1-16)"
log "cli sha256 (unchanged by the failing probe): $(sha256sum packages/mpd-mcp-lsp/dist/cli.js | cut -d' ' -f1)"
