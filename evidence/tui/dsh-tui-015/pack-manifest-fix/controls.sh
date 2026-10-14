#!/usr/bin/env bash
# Wave tui-015 pack-manifest fix — the pack-time arm's negative controls.
#
# Each control mutates ONE input of the arm, runs the real packer, records the exit code and the full
# log, then RESTORES the input and asserts the restore by sha256. The packer is never edited to pass:
# the controls only remove a declaration the arm is supposed to require.
#
# Run from the repository root:  bash evidence/tui/dsh-tui-015/pack-manifest-fix/controls.sh
set -u
EV="evidence/tui/dsh-tui-015/pack-manifest-fix"

fail() { echo "CONTROLS: $1" >&2; exit 1; }

# Run one control: $1 id, $2 input file, $3 scratch out dir, $4 the mutation to apply to that file.
# The input is restored from the pre-control COPY (never from git: the packer fix that the control
# exercises is itself uncommitted, so `git checkout` would silently revert the subject under test).
control() {
  local id="$1" file="$2" out="$3" mutate="$4" before after
  cp "$file" "$EV/.tmp-$id.orig"
  before="$(sha256sum "$file" | cut -d' ' -f1)"
  bash -c "$mutate" || fail "$id: mutation did not apply"
  diff -u "$EV/.tmp-$id.orig" "$file" > "$EV/control-$id.mutation.diff"
  node scripts/pack-mpd.ts --out "$out" > "$EV/control-$id.log" 2>&1
  echo "exit=$?" >> "$EV/control-$id.log"
  cp "$EV/.tmp-$id.orig" "$file"
  rm -f "$EV/.tmp-$id.orig"
  after="$(sha256sum "$file" | cut -d' ' -f1)"
  [ "$before" = "$after" ] || fail "$id: restore is not byte-identical ($before -> $after)"
  echo "control $id: log written, $file restored byte-identical ($after)"
}

sha256sum package.json scripts/pack-mpd.ts > "$EV/inputs-sha-before.txt"

# C1 — the DEFECT CLASS: a dependency a shipped row's launcher resolves stops being declared in the
#      root manifest (the mcp-lsp row's launcher resolves `cclsp`; without it the row starts with ZERO
#      tools, exactly the red the Docker oneclick lane measured).
control C1-red-cclsp-not-declared package.json dist/_scratch-pack-c1 \
  'node -e '"'"'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));delete p.optionalDependencies.cclsp;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'"'"''

# C2 — the packer's policy overlay is load-bearing: the ast-grep launcher resolves `@ast-grep/cli`, a
#      pack-ONLY key the root manifest does not declare.
control C2-red-pack-only-key-dropped scripts/pack-mpd.ts dist/_scratch-pack-c2 \
  'node -e '"'"'const fs=require("fs");const f="scripts/pack-mpd.ts";const t=fs.readFileSync(f,"utf8");const n=t.replace(`{ "@ast-grep/cli": "0.45.2", `,"{ ");if(n===t)throw new Error("C2 mutation did not apply");fs.writeFileSync(f,n)'"'"''

# C3 — the anti-rot half: a launcher a shipped row names while the table does not know it must redden,
#      so a new MCP row cannot ship with undeclared npm needs.
control C3-red-launcher-unknown scripts/pack-mpd.ts dist/_scratch-pack-c3 \
  'node -e '"'"'const fs=require("fs");const f="scripts/pack-mpd.ts";const t=fs.readFileSync(f,"utf8");const n=t.replace(`  { launcher: "packages/mpd-mcp-codegraph/dist/launch.js", dependencies: ["@colbymchenry/codegraph"] },\n`,"");if(n===t)throw new Error("C3 mutation did not apply");fs.writeFileSync(f,n)'"'"''

sha256sum package.json scripts/pack-mpd.ts > "$EV/inputs-sha-after.txt"
diff "$EV/inputs-sha-before.txt" "$EV/inputs-sha-after.txt" || fail "an input was not restored"
echo "CONTROLS: 3 controls ran; every input is byte-identical to its pre-control state"
