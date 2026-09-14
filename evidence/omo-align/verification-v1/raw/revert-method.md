# How the falsifiability A/B was built (reproducible)

Both arms run the SAME assertions (`raw/driver.mjs`) and the SAME implementer test file.

Arm A (shipped / fixed):
  node evidence/omo-align/verification-v1/raw/driver.mjs packages/mpd-agent-teams-plugin/lib/state.js
  bun test packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs
  -> raw/fixed.out.json, raw/fixed-test.tap.txt

Arm B (pre-fix):
  git archive 3096455 packages/mpd-agent-teams-plugin/lib | tar -x -C <dir>
  # 3096455 is the commit BEFORE the repair (0d52794 merged the repair).
  # In that copy, `enqueueInterjection` is the old body: it validates nothing and
  # writes the request verbatim, so a request without `content` fails the mailbox
  # shape check and is dropped by every reader.
  node evidence/omo-align/verification-v1/raw/driver.mjs <dir>/packages/mpd-agent-teams-plugin/lib/state.js
  # the implementer's own test file, with ONLY its state import repointed at <dir>:
  bun test <dir>/r1-message-channel.reverted.test.mjs
  -> raw/reverted.out.json, raw/reverted-test.tap.txt

The copied tree and the repointed test copy were DELETED after the run so the evidence
does not embed a stale full copy of product code; both are reconstructible from the
commit above plus this recipe. No product file was modified: the revert lived only
inside this evidence directory.
