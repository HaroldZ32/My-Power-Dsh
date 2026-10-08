# Git handoff — wave `tui-014-adaptation`

> **SUPERSEDED — the wave landed directly, 2026-10-08.** The handover existed because the bundle's
> guard read "captain" through the session's PRESET (`sessionQualifies`), and every top-level session on
> this machine records `agentPreset: "cordis"` — so no live session could be the workspace's git writer
> (`T-92`). The `fix(verify,roles)` commit in THIS branch replaces that test with the session's position
> in the delegation tree, and a top-level session is now admitted whatever preset it carries; the
> captain executed the commands below itself. `land-pr.sh` was deleted rather than shipped, because
> running it against an already-committed tree is a footgun and its header stated the belief this branch
> falsifies. The text below is kept verbatim as the incident record.

This session may not run git WRITE commands (AGENTS.md §5, the one-git-writer rule is mechanical for a
non-captain session; measured: `git commit --dry-run` and `git add --dry-run` are both refused with
`one-git-writer rule (AGENTS.md §5)`). Every file of the wave is therefore already IN THE WORKING TREE,
staged by nobody. The commands below are the whole remaining step, in order.

Two invariants this handoff carries, both from the repository's own rules:

- **ONE commit carries the `skills/**` change AND its single re-pin.** The wave touched 7 files under
  `skills/dsh-qa/scripts/**`, and `VENDOR_LOCK.json` was re-pinned to
  `skills.treeSha = 73a7311adfe2240cb742a21f5d3a53400210a03a9672f106bf273953198d356d` by
  `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`. (An earlier re-pin landed
  mid-wave and was superseded by the second `skills/**` batch; the FINAL tree carries exactly one pin,
  and this commit must not split them.)
- **Nothing is committed straight to `dev` or `master`.** Branch, commit, push, PR against `dev`; the
  PR description is `evidence/tui/dsh-tui-014/PR-BODY.md` (bilingual, English first) — paste it whole.

```bash
cd /root/dshProj/My-Power-Dsh

# 1. branch (from dev, as the model requires)
git checkout dev && git pull --ff-only
git checkout -b feature/tui-014-adaptation

# 2. review what will land: the wave touched 4 bands — the two TUI packages (+ their dist),
#    7 QA-lane scripts under skills/, the docker lane + descriptor carriers, and the docs band.
git status --short
git diff --stat

# 3. commit (message follows the repo's `<type>(<scope>): <summary>` form)
git add -A
git commit -m "feat(tui): adapt to dsh-tui 0.14.0, two sidebar pages, and the accumulating-legend fix" -m "Contract: .mpd/plans/tui-014-adaptation.md. Verified: loop-20261008T015701-2161e0 -> rec-20261008T030715-f1a2ad, rec-20261008T032957-8ebe48 (PASS, blind seats). Evidence: evidence/tui/dsh-tui-014/WAVE-REPORT.md. The single skills/** re-pin (VENDOR_LOCK.json 73a7311a...) lands in THIS commit."

# 4. push + PR (description = evidence/tui/dsh-tui-014/PR-BODY.md, bilingual, whole file)
git push -u origin feature/tui-014-adaptation
gh pr create --base dev --title "feat(tui): adapt to dsh-tui 0.14.0, two sidebar pages, and the accumulating-legend fix" --body-file evidence/tui/dsh-tui-014/PR-BODY.md
```

## The cleanup the user may want BEFORE the remedy script runs

`.mpd/logs/mpd-tui-panels.json` still holds the PRE-FIX pollution
(`{"version":1,"panelIds":["act0:team","act0:dag","act0:workmate"],"updatedAt":"2026-10-08T02:02:20.819Z"}`).
It is not wrong to keep it — the remedy now REFUSES it, which is the measured demonstration that the
guard works — but do not hand it to a user as a usable record. Two clean paths:

```bash
# (a) let a real boot rewrite it (the adapter writes a version-2 record with provenance), then:
node scripts/mpd-tui-panels.ts            # dry run: prints the ids it would append
node scripts/mpd-tui-panels.ts --apply    # writes the USER's profile patch (the captain's step, with approval)

# (b) or name the ids directly and skip the record entirely:
node scripts/mpd-tui-panels.ts --ids act1:team,act1:workmate --apply
```

`--apply` writes `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` (the settings user layer) and keeps a
`.bak-<stamp>` beside it; it never removes or reorders a token of the user's own list. It is a write
OUTSIDE the session workspace and therefore needs the user's explicit approval.
