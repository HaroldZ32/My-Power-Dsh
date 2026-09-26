# t47 (repair-round-2) — the member's payload, preserved by the captain

t47 was CANCELLED by the captain (premise superseded by the t49 PASS on the settled revision) and is
terminal + immutable, so the Senior Engineer's structured payload could not be posted to it. Its
closing report is reproduced here so the substance survives; the code it produced is preserved
verbatim in `../DEFERRED-residual-notice-and-W14.{md,patch}` and its raw verify log beside this file.

## What t47 delivered (member's own account, 2026-09-15 ~23:5x local)

- **The base hazard is closed in the delivered build.** `packages/mpd-config-plugin` is the registrant
  and serves a `base` derived from `<workspace>/.mpd/mpd.jsonc`: 1 live root ⇒ that root's file;
  0 roots ⇒ the mount-time root (absent file ⇒ empty base); N roots ⇒ NO base invented, ambiguity
  surfaced (warn naming every candidate + `states().settings.baseReason == "ambiguous-multi-root"`).
  The TUI is a pure consumer with a guarded fallback that yields deterministically when `mpdConfig` is
  present; `two-plugin-ownership.test.ts` mounts BOTH orders against a double that throws like the host
  ⇒ exactly ONE registration in every composition.
- **Running-host witness:** the namespace's served `base` is `{hashline:{maxDiffChars:35000}}` — the
  FILE value — while the schema default is 20000 (lane W13 + the `settings/describe` read-back line).
- **The lane was wrong and was fixed**: the authoritative read-back surface is `settings/describe`;
  the first attempt read nothing because the RPC envelope nests as `{ok, value: …}`. Green run:
  `[read-back] settings/describe: status=200 envelope=ok,value ns=mpd resolved=31415
  base={"hashline":{"maxDiffChars":35000},"ulw":{"maxRounds":6}}`, with agreement asserted three ways —
  **W13** base == file value, **W14** namespace resolved == the value read independently from disk,
  **W15** describe resolved == the written value.
- **Item 3:** `packages/mpd-tui-plugin/README.md` + `.zh-CN.md` rewritten (bridge + restart semantics,
  refusal cases, "never a lost save"); no stale "not bridged" / "未打通" text in the package.
- **Item 4:** attribution — the card was delivered under t35, removed byte-exactly by captain
  instruction (0 changed paths; fresh build reproduced 259205 B / `0d20f4f9…`), then re-added by t41 at
  282453 B / `dd9c8893…`.
- **Item 5:** all `skills/**` edits went through that member; `VENDOR_LOCK.json` untouched; the pairing
  failure it printed (`lock=310/8ec53287296e tree=310/87521eda2ee8`) was caused by its own lane edit and
  is GONE after the captain's revert — `node scripts/verify-vendor.mjs` exits 0 on the reverted tree, so
  the wave owes exactly ONE re-pin and it belongs to w9.
- **Verify (member-run):** `bun run typecheck` 0; four suites 208 pass / 0 fail / 24 files;
  `tui-settings-bridge --self-test` ok (18 + 7 injected faults); `tui-panels --self-test` ok;
  zero-write grep 0; `test:qa` exit 1 only on the VENDOR_LOCK pairing case (now moot).

## Captain's disposition

Deferred, not discarded: the notice needs the ordering correction (fallback, never pre-empting the
write-skip notices), the lane checks need w9's single-writer slot + the corpus re-pin, and any re-run
must write a NEW timestamped evidence directory. See `../DEFERRED-residual-notice-and-W14.md`.
