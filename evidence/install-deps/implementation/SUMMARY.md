# t2 — implementation summary (author-run, ADVISORY)

**Task:** t2, team `mpd-install-deps`, member Senior Engineer, attempt 2.
**Objective:** a plain install of `@mpd-dsh/mpd` must deliver a WORKING sidebar: the
bundle's external runtime plugin dependency is declared (and carried into the packed
manifest) and ONE guarded loader row mounts the sidebar host — never twice, never on a
plane where it cannot activate, never taking a boot down when the package is absent.
**Everything below is AUTHOR-RUN and therefore ADVISORY.** The verification lane
re-measures on the revision hashes it reads itself.
**Run label** `run-20260920T0328Z` (chosen before the run); authoritative instants are
the per-artifact `measured_at_utc` / `read_at_utc` (run spans 03:28:42Z–03:31:35Z).

## 1. The six measured compositions (real boots, isolated sandboxes)

## Ledger (author-run, ADVISORY)

| composition | expectation | guard decision | sidebar rows in the entry list (last probe) | fatal signatures | HTTP | boot log sha256 | measured_at_utc |
|---|---|---|---|---|---|---|---|
| comp1_web_bundle_only | guard ENABLED; exactly one sidebar mount (ours); client half served | ENABLED - web plane present and no other layer mounts dsh-better-sidebar | mpd-better-sidebar|js-guarded|fiber=true | none | index 200 (28318B), sidebar client 200 (870764B), /sidebar/api 405 | e771f63d67dc4a8f… | 2026-09-20T03:29:00.730Z |
| comp2_web_aggregate_after | guard DISABLED (another layer's patch mounts it); aggregate owns the single mount | DISABLED - bundle layer @linxin666/dsh-web-all already mounts it in its own patch | mpd-better-sidebar|js-guarded|fiber=false, web-ui-better-sidebar|raw-enabled|fiber=true | none | index 200 (35092B), sidebar client 200 (870764B), /sidebar/api 405 | 5aa50d7a980aa555… | 2026-09-20T03:29:20.322Z |
| comp3_web_aggregate_before | guard DISABLED even though the aggregate layer precedes ours; single mount | DISABLED - bundle layer @linxin666/dsh-web-all already mounts it in its own patch | web-ui-better-sidebar|raw-enabled|fiber=true, mpd-better-sidebar|js-guarded|fiber=false | none | index 200 (35092B), sidebar client 200 (870764B), /sidebar/api 405 | beab25190a96ad89… | 2026-09-20T03:29:41.904Z |
| comp4_tui | guard DISABLED (no web plane); zero pending/failed entries | DISABLED - no web plane in this composition |  | none | TUI pane 2659 chars | a33233f1536d07b0… | 2026-09-20T03:30:51.969Z |
| comp6_packed_artifact | the PACKED artifact ships the same guarded row + the runtime dependencies arm | ENABLED - web plane present and no other layer mounts dsh-better-sidebar | mpd-better-sidebar|js-guarded|fiber=true | none | index 200 (28318B), sidebar client 200 (870764B), /sidebar/api 405 | ab56b9809dca85a6… | 2026-09-20T03:31:08.532Z |
| comp5_web_package_absent | guard DISABLED (package not resolvable); boot green, degraded | DISABLED - dsh-better-sidebar is not resolvable from the profile node_modules | mpd-better-sidebar|js-guarded|fiber=false | none | index 200 (27913B), sidebar client - (0B), /sidebar/api 404 | 3e0a513dfc43efc6… | 2026-09-20T03:31:35.109Z |

## Source revision under test (sha256 read at the UTC instant shown)

| path | sha256 | read_at_utc |
|---|---|---|
| package.json | 64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f | 2026-09-20T03:28:42.085Z |
| packages/mpd-bundle/cordis.patch.yml | 6ab4df7eb2e4dbe515406044ef580c698f004b355f4ea0bde4d2e327baeb711a | 2026-09-20T03:28:42.085Z |
| scripts/pack-mpd.mjs | 52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07 | 2026-09-20T03:28:42.085Z |
| scripts/install-profile.mjs | 98b29e101bd0e7d146311e9f191905389d0fd0c645275044950bde232220b94a | 2026-09-20T03:28:42.086Z |
| bun.lock | 92b9f18df2eb4d5f53c4f89e229b9021008a3e6be4d0fb2422513cbdf39aab7a | 2026-09-20T03:28:42.086Z |

ledger.at_utc = 2026-09-20T03:28:42.084Z; kind = author-run boots (ADVISORY; the QA lane re-measures)

Composition 6 is the extra arm that proves the PACKED artifact ships the same guarded row
(after the packer fix described in `README.md` §5). Composition 4 is a real dsh-tui boot
inside tmux (pane captured, 2659 chars) and the probe row is not applied there — the guard
line plus the FATAL-signature scan are its evidence.
`fiber=true` is the loader's own activation state: in compositions 1, 2, 3 and 6 it appears
EXACTLY ONCE, which is the countable form of "exactly one mount".

## 2. Gate sweep (all exit 0; full transcript in `gates.log`)

started_at_utc: 2026-09-20T03:32:21Z
--- node scripts/verify-rows-parity.mjs
[verify-rows-parity] ok: 26 row ids match the bundle patch insert list (agent-teams, mcp-astgrep, mcp-codegraph, mcp-context7, mcp-gitbash, mcp-grepapp, mcp-lsp, mpd-better-sidebar, mpd-bootstrap, mpd-boulder, mpd-codegraph, mpd-comment-checker, mpd-config, mpd-dsh-adapter, mpd-ext, mpd-hashline, mpd-memory, mpd-modelchain, mpd-roles, mpd-team-compact, mpd-team-watchdog, mpd-tools, mpd-tui, mpd-ulw, mpd-web-compat, mpd-workmate)
exit=0
--- bun run verify:rows
[verify-rows-parity] ok: 26 row ids match the bundle patch insert list (agent-teams, mcp-astgrep, mcp-codegraph, mcp-context7, mcp-gitbash, mcp-grepapp, mcp-lsp, mpd-better-sidebar, mpd-bootstrap, mpd-boulder, mpd-codegraph, mpd-comment-checker, mpd-config, mpd-dsh-adapter, mpd-ext, mpd-hashline, mpd-memory, mpd-modelchain, mpd-roles, mpd-team-compact, mpd-team-watchdog, mpd-tools, mpd-tui, mpd-ulw, mpd-web-compat, mpd-workmate)
exit=0
--- node scripts/verify-dist-fresh.mjs
[verify-dist-fresh] ok: 20/20 targets fresh (each rebuilt twice, byte-identical) — 7 NOT COVERED files listed — 502ms
exit=0
--- node scripts/install-profile.mjs --self-test
[install-profile self-test] ok: path model + row set + agent-teams main-code path + profiles.mpd + web-compat entry + id-target render verified
exit=0
--- node scripts/install-profile.mjs --dry-run | grep mpd-better-sidebar row
exit=0
--- node scripts/verify-rows-parity.mjs --self-test
[verify-rows-parity] self-test PASS - (f) hermetic: temp fixtures only; the live patch's bytes + mtime are unchanged :: fixture root /tmp/mpd-rows-parity-selftest-LfJRmb (temp); live patch bytes unchanged, mtime 1789874281736.3982 -> 1789874281736.3982; elapsed 439ms
[verify-rows-parity] self-test PASS: 6/6 arms
exit=0
--- node scripts/verify-pack-closure.mjs
[verify-pack-closure] ok: 17 dist/index.js row(s) + 1 adopted lib/index.js row(s) + 4 mcp row(s) of the bundle patch all resolve; 18 PLUGIN_PKGS + 4 MCP_PKGS entries all exist; root assets skills/presets/extensions/templates/docs/agent-references declared and present; CLI validator surface 9 exports in step; packed tree: /root/dshProj/my-power-dsh/dist/mpd-package (382 asset files); agent references 3/3; root files 1/1; declared packages 23/23 present in the artifact; content bytes: 1185 file(s) compared, 1183 identical, 0 drift, 2 expected-after-pack; completeness: 410 declared source file(s) compared, 408 present, 1 declared exemption(s), 0 absent; pack stamp 2026-09-20T03:27:36.721Z (inferred: the newest mtime among the artifact's own files (cpSync gives every copied file the pack's write time)); exemption exercised: packages/mpd-qa-roles-probe/dist/index.js
exit=0
--- guard clause cases
exit=0
finished_at_utc: 2026-09-20T03:32:22Z

`gates.log.sha256` is written beside it; the transcript itself carries the sweep's UTC
start/end instants.

## 3. Hash sandwich for the revision under test

The hashes below were read twice — once at the run's start (ledger) and once after the
run + gates — and are equal, so "settled" is distinguishable from "another lane edited the
file while I sampled". The artifact hashes are the ones the boots actually loaded.

final read at UTC 2026-09-20T03:32:30Z:
  64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f  package.json
  6ab4df7eb2e4dbe515406044ef580c698f004b355f4ea0bde4d2e327baeb711a  packages/mpd-bundle/cordis.patch.yml
  52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07  scripts/pack-mpd.mjs
  98b29e101bd0e7d146311e9f191905389d0fd0c645275044950bde232220b94a  scripts/install-profile.mjs
  92b9f18df2eb4d5f53c4f89e229b9021008a3e6be4d0fb2422513cbdf39aab7a  bun.lock
  ab7e521206eb8055c512be504b651d49a87c5bbddcf53c9db926e36ec684e9b7  dist/mpd-package/package.json
  6ab4df7eb2e4dbe515406044ef580c698f004b355f4ea0bde4d2e327baeb711a  dist/mpd-package/cordis.patch.yml
  a0b4ef1f6e2703bc5406fe6d1c6f372884c3a3aceb5ea62d3c55051debf21970  evidence/install-deps/implementation/guard-clause-cases.txt
  694736a5102a409f370f2c459dd7871342674c16495b84e5d8e1d857d0a531d5  evidence/install-deps/implementation/gates.log
  c17c210eb58d9e2df1ea9a2a3a8e2fe6b99f7c3d1bfa4cac8225d937802a1496  evidence/install-deps/implementation/w1-five-compositions/run-20260920T0328Z/ledger.json
