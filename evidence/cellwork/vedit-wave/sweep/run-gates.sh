#!/bin/bash
# T9 wave-gate runner: one log per gate, exit code appended as EXIT:<n> (verbatim output preserved).
cd /home/haroldzhao/MyProj/DshProj/My-Power-Dsh || exit 9
B=.toolchain/node_modules/.bin/bun
G=evidence/cellwork/vedit-wave/sweep/gates
run() { name="$1"; shift; echo "COMMAND: $*" > "$G/$name.log"; "$@" >> "$G/$name.log" 2>&1; echo "EXIT:$?" >> "$G/$name.log"; }
run dist-fresh node scripts/verify-dist-fresh.ts
run typecheck "$B" run typecheck
run docs "$B" run verify:docs
run comments "$B" run verify:comments
run manifest "$B" run verify:manifest
run rows "$B" run verify:rows
run no-host-override node scripts/verify-no-host-override.ts
run preset-conformance node skills/dsh-qa/scripts/preset-conformance.ts
echo DONE
