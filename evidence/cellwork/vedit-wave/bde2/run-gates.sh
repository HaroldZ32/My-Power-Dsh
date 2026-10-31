#!/bin/bash
cd /home/haroldzhao/MyProj/DshProj/My-Power-Dsh || exit 9
B=.toolchain/node_modules/.bin/bun
G=evidence/cellwork/vedit-wave/bde2/logs
run() { name="$1"; shift; echo "COMMAND: $*" > "$G/$name.log"; "$@" >> "$G/$name.log" 2>&1; echo "EXIT:$?" >> "$G/$name.log"; }
run tests-verify "$B" test packages/mpd-verify-plugin
run tests-roles "$B" test packages/mpd-roles-plugin
run tests-workmate "$B" test packages/mpd-workmate-plugin
run tests-cellwork "$B" test packages/mpd-cellwork-plugin
run comments node scripts/verify-comment-coverage.ts
run docs "$B" run verify:docs
echo DONE
