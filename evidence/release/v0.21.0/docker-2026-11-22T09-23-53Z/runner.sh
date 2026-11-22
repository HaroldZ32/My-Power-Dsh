#!/usr/bin/env bash
# LANE T5 runner: cut the pack, run one docker-e2e invocation, anchor the tree before and after,
# and collect the driver's verdict. Evidence bookkeeping only; the credential is read from the
# operator's credentials file into the environment and never printed or written to disk.
set -uo pipefail
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
EVID="$1"
export XDG_RUNTIME_DIR="$REPO/.qa-tmp/xdg"
mkdir -p "$XDG_RUNTIME_DIR"
export DEEPSEEK_API_KEY="$(node -e 'const fs=require("node:fs");const t=fs.readFileSync(process.env.HOME+"/.dsh/.credentials.yaml","utf8");const m=t.match(/DEEPSEEK_API_KEY\s*:\s*([^\s#]+)/);if(m)process.stdout.write(m[1])')"
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then echo "[lane] FATAL: no refs.DEEPSEEK_API_KEY available; --live would exit 3"; exit 9; fi
echo "[lane] credential present (len=${#DEEPSEEK_API_KEY}) — value never printed"

anchor() {
  local out="$1"
  {
    echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "head=$(git -C "$REPO" rev-parse --short HEAD)"
    echo "headFull=$(git -C "$REPO" rev-parse HEAD)"
    echo "branch=$(git -C "$REPO" branch --show-current)"
    echo "diffSha=$(git -C "$REPO" diff | sha256sum | cut -d' ' -f1)"
    echo "trackedChangedCount=$(git -C "$REPO" status --porcelain -uno | wc -l)"
    git -C "$REPO" status --porcelain -uno | sort
  } > "$out"
}

cut_pack() {
  local label="$1"
  node "$REPO/scripts/pack-mpd.ts" > "$EVID/pack-$label.log" 2>&1
  local rc=$?
  echo "exit=$rc" >> "$EVID/pack-$label.log"
  node -e '
    const fs = require("node:fs"), crypto = require("node:crypto"), path = require("node:path")
    const root = process.argv[1]
    const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const files = []
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(root, p)) } }
    walk(root)
    files.sort()
    const h = crypto.createHash("sha256")
    for (const f of files) h.update(f + "\0").update(fs.readFileSync(path.join(root, f))).update("\0")
    process.stdout.write(JSON.stringify({ name: pj.name, version: pj.version, fileCount: files.length, treeSha256: h.digest("hex"), packedAtUtc: new Date().toISOString() }, null, 2) + "\n")
  ' "$REPO/dist/mpd-package" > "$EVID/pack-$label.manifest.json"
  echo "[lane] pack $label exit=$rc"
}

run_case() {
  local n="$1" slug="$2" args="$3"
  local dir="$EVID/run-$n-$slug"
  local evslug="client-install"
  [ "$slug" = "oneclick-live" ] && evslug="client-install-oneclick"
  mkdir -p "$dir"
  echo "[lane] ===== run $n ($slug) args: $args ====="
  printf '%s\n' "$args" > "$dir/args.txt"
  anchor "$dir/anchor-before.txt"
  ls -1 "$REPO/evidence/docker/$evslug" 2>/dev/null | sort > "$dir/before-evidence-dirs.txt" || true
  local startUtc; startUtc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local startLocal; startLocal="$(date '+%Y-%m-%d %H:%M:%S %z')"
  local t0; t0="$(date +%s)"
  # shellcheck disable=SC2086
  node "$REPO/scripts/docker-e2e.ts" $args > "$dir/console.out" 2>&1
  local rc=$?
  local t1; t1="$(date +%s)"
  echo "$rc" > "$dir/exit-code.txt"
  {
    echo "startUtc=$startUtc"
    echo "startLocal=$startLocal"
    echo "endUtc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "durationSeconds=$((t1 - t0))"
  } > "$dir/wall.txt"
  anchor "$dir/anchor-after.txt"
  node "$EVID/collect.mjs" "$dir" "$rc" "$slug" "$args" | tee "$dir/collect.log"
  echo "[lane] run $n exit=$rc"
}

cut_pack "1-before-source-live"
run_case 1 "source-live" "--mode source --require-docker --live"
cut_pack "2-before-oneclick-live"
run_case 2 "oneclick-live" "--mode oneclick --require-docker --live"
cut_pack "3-before-source-nobrowser"
run_case 3 "source-nobrowser" "--mode source --require-docker --no-browser"
anchor "$EVID/anchor-final.txt"
echo "[lane] done"
