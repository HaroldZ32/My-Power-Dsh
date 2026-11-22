// T4 static lane — assembles result.json from the captured metas/logs (no re-measurement).
const fs = require('node:fs')
const path = require('node:path')
const D = __dirname
const read = (f) => fs.readFileSync(path.join(D, f), 'utf8')
const grab = (text, re, limit) => {
  const out = text.split('\n').filter((l) => re.test(l)).map((l) => l.trim())
  return limit ? out.slice(0, limit) : out
}
const meta = (id, name) => {
  const t = read(`${id}-${name}.meta`)
  const g = (k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] ?? null
  return { id, argv: g('argv'), exit: Number(g('exit')), startUtc: g('start'), endUtc: g('end'), log: `${id}-${name}.log` }
}
const withKeys = (base, logName, re, extra) => ({ ...base, keyLines: grab(read(logName), re), ...(extra || {}) })
const freeze = read('00-freeze-proof.log')
const cross = read('11-cross-checks.log')
const probe = read('13-repair-probe.log')
const integrity = read('15-docs-integrity.log')
const scope = read('16-scope-diff.log')
const commands = [
  withKeys(meta('01', 'verify-gates'), '01-verify-gates.log', /^\[verify-gates\] member .*: exit=|^\[verify-gates\] PASS/),
  withKeys(meta('02', 'verify-tui-admission'), '02-verify-tui-admission.log', /^\[tui-admission\] arm COMPAT\.|^\[tui-admission\] arm H\.host |^\[tui-admission\] REPORT/),
  withKeys(meta('03', 'verify-no-host-override'), '03-verify-no-host-override.log', /bundle id-targets|bundle inserted rows|^\[verify-no-host-override\] PASS/),
  withKeys(meta('04', 'verify-manual-paths'), '04-verify-manual-paths.log', /manual-sha256|^\[verify-manual-paths\] PASS/),
  withKeys(meta('05', 'install-profile-dry-run'), '05-install-profile-dry-run.log', /^\[install-profile\] (dshHome=|rows about to be written|toolchain missing)/),
  withKeys(meta('06', 'preset-conformance-self-test'), '06-preset-conformance-self-test.log', /^\[preset-conformance self-test\] ok:/),
  withKeys(meta('07', 'bundle-lifecycle'), '07-bundle-lifecycle.log', /^\[bundle-lifecycle\] (ok=|PASS)/),
  withKeys(meta('08', 'test-qa'), '08-test-qa.log', /^\[test:qa\] (preset-register|dual-track-smoke)\.ts|^\[(llm-dual-track|preset-register) self-test\] ok:|^\[test:qa\] all self-tests passed/, { casesRun: grab(read('08-test-qa.log'), /^\[test:qa\] /).length }),
  withKeys(meta('09', 'typecheck'), '09-typecheck.log', /^\$ /, { note: 'no diagnostics emitted; exit 0 is the whole output' }),
  withKeys(meta('10a', 'verify-dist'), '10a-verify-dist.log', /^\[verify-dist-fresh\] (ok:|NOT COVERED)/),
  withKeys(meta('10b', 'verify-docs'), '10b-verify-docs.log', /^\[verify-docs-parity\] root=.*PASS$/),
  withKeys(meta('10c', 'verify-manifest'), '10c-verify-manifest.log', /packed-content|^VERDICT: PASS/),
  withKeys(meta('11', 'cross-checks'), '11-cross-checks.log', /^\[cross\] (A\.|B\.|C\.|D\.|F\.bilingual|G\.|RESULT)/, { note: 'run2; run1 (11-cross-checks-run1.log) failed only its over-literal ./ switch-link form on three pre-existing bare-form links' }),
  withKeys(meta('14', 'bun-test-packages'), '14-bun-test-packages.log', /^ *[0-9]+ (pass|skip|fail)$|Ran 4186|^\(skip\)/, { note: 'SUPPLEMENTARY arm: AGENTS.md §4 requires bun test on a plugin change; not part of the wave contract §7 list; repo-root bun test avoided by design' }),
]
const result = {
  lane: 'T4 — static verification (direct captain commission; no board task, no claim, no dispatch)',
  wave: 'dsh-022rc5-tui-0202',
  contract: '.mpd/plans/adapt-dsh-022rc5-tui-0202.md — §7 acceptance text (judged), §3 measured facts, §4 decisions',
  verdict: 'PASS',
  riskLevel: 'low',
  summary:
    'Every command in the frozen §7 sweep plus both §4 members outside the aggregate is green on the certified commit, all five COMPAT arms and the host arm pass individually, the three-way TUI band is identical and sorted, the three version carriers cohere at 0.21.0, the harness/TUI distribution refs are rc.5/0.20.2, engines.dsh and engines.node are unchanged, no live old pin survives outside dated history, every changed bilingual pair carries its switch link and a real Chinese body, and the pre-existing test:qa red was repaired by NARROWING a false-positive sentinel without weakening the leak checks (proved arithmetically on byte-identical patch bytes). Two Nits and no Blocker/High.',
  certifiedCommit: {
    sha: 'd2a93abcda80a27cf9da725413613486895549eb',
    short: 'd2a93abc',
    subject: 'feat(adapt): support DSH 0.2.2-rc.5 and dsh-tui 0.20.2 (0.21.0)',
    branch: 'feature/dsh-022rc5-tui-0202',
    filesInCommit: 45,
    insertions: 535,
    deletions: 191,
    trackedDirty: 0,
    diffSha256: '9d9d5726d518bef3bbbbeebeaa3faaa67b553139bda420e9cc365137ed988ba7',
    preFreezeWorktreeDiffSha256: '9d9d5726d518bef3bbbbeebeaa3faaa67b553139bda420e9cc365137ed988ba7',
    byteIdenticalToPreFreezeRun: true,
    skillsFilesInCommit: 11,
    proofLog: '00-freeze-proof.log',
  },
  postFreeze: {
    headAtReportTime: '8828e3c9 chore(evidence): record the v0.21.0 gate transcripts for commit d2a93abc',
    nonEvidenceDiffVsCertified:
      'EMPTY — `git diff --name-only d2a93abc HEAD` filtered to non-evidence paths is empty, so the certified code/doc/manifest bytes are still d2a93abc; 8828e3c9 adds evidence transcripts only.',
    laneDirCommittedIn:
      '8828e3c9 committed this lane dir up to 16-scope-diff.log (17:39:07+08:00). result.json, 17-build-result.cjs and 18-post-freeze-head.log were written after it and are still untracked: the captain needs ONE follow-up evidence commit.',
    log: '18-post-freeze-head.log',
  },
  environment: {
    dshPrefixBin: '0.2.2-rc.5',
    dshPrefixPath: '/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/.qa-tmp/dsh-022/bin/dsh -> .qa-tmp/dsh-022/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
    dshAmbientBin: '0.2.2-rc.5',
    dshAmbientPath: '/home/haroldzhao/.nvm/versions/node/v24.21.0/bin/dsh',
    d5Note:
      'The documented prefix held 0.2.2-rc.1 when this lane first read it (09:04Z) and 0.2.2-rc.5 at 09:07Z (package.json version + bin/dsh --version, dir mtime 2026-11-22T17:06:25+08:00): it was refreshed by another lane, not by me. Both the prefix bin and the ambient bin then measured 0.2.2-rc.5, so the documented prefixed command measured the wave target; no version substitution is claimed.',
    node: 'v24.21.0',
    distToolchain: 'bun 1.4.0 from .toolchain/node_modules/.bin/bun (verify-dist-fresh prints it)',
    xdgRuntimeDir: '<repo>/.qa-tmp/xdg',
    dshgoKit: '<repo>/.mpd/tmp-dshgo/kit',
  },
  commands,
  aggregateMembers: Object.fromEntries(
    grab(read('01-verify-gates.log'), /^\[verify-gates\] member [a-z0-9-]+: exit=/).map((l) => {
      const m = l.match(/member ([a-z0-9-]+): exit=(\d+) (PASS|FAIL)/)
      return [m[1], { exit: Number(m[2]), verdict: m[3] }]
    }),
  ),
  compatArms: {
    'COMPAT.band': 'PASS (both manifests: 0.18.0, 0.19.0, 0.20.0, 0.20.1, 0.20.2)',
    'COMPAT.band-parity': 'PASS (both manifests identical)',
    'COMPAT.distribution-ref': 'PASS (host-tui ref pkg:npm/@deepseek-harness-tui/dsh-tui@0.20.2 inside the band)',
    'COMPAT.declared-hosts': 'PASS (every declared host inside each of the 2 bands)',
    'COMPAT.host-version': 'PASS (discovered host 0.20.2 inside the band)',
    'H.host (host arm)': 'PASS (installed @deepseek-harness-tui/dsh-tui 0.20.2 resolved from the dsh-tui profile)',
    report: 'PASS — 49 arms passed, 1 allowed deviation, 5 bounds',
  },
  crossChecks: {
    band: 'identical across dsh-plugin.json / packages/mpd-tui-plugin/dsh-plugin.json / specs/tui-hosts.json and strictly ascending (5 hosts)',
    carriers: 'package.json 0.21.0, dsh-plugin.json 0.21.0, dsh-distribution.json distribution.version 0.21.0',
    engines: 'engines.dsh ">=0.2.1-rc.5 <0.3.0-0" and engines.node ">=24.9.0" both byte-identical to base e3f36a99',
    distributionRefs: 'host-base pkg:npm/@deepseek-ai/dsh-base@0.2.2-rc.5, host-tui pkg:npm/@deepseek-harness-tui/dsh-tui@0.20.2',
    oldPins:
      '135 occurrences of 0.2.2-rc.3 / 0.20.1 in tracked files (evidence/** excluded): 0 in runtime, CI or QA default files (dsh-distribution.json, docker/entrypoint.sh, docker/docker-compose.yml, docker/tui-lane.sh, docker/ui/docker-compose.yml, docker/ui/entrypoint.sh, .github/workflows/gates.yml, skills/dsh-qa/scripts/tui-mount.ts, scripts/mpd-tui-panels.ts all 0); the rest are the 5-host admitted band (3 files, 1 line each), the support-band claims in AGENTS/README/docs, the updated adapter note, and dated history (CHANGELOG 0.20.0 section; docs/tui.md/.zh-CN §11.16; the §11.17 before→after table; README/docker/README history rows)',
    bilingual: '8 changed pairs: switch link present in both directions and CJK body present (cjk 2621–39431); verify:docs independently reports pairs=61 failed=0 violations=0',
    agentsBudget: 'AGENTS.md 63152 bytes, budget 65536, margin 2384',
    docsHistory: 'CHANGELOG has 89 additions and 0 deletions (new 0.21.0 section; 0.20.0 untouched); docs/tui.md adds §11.17 after the intact §11.16 (body at old lines 1959-1997 untouched by the hunks)',
    noRuntimeChange: 'packages/*/dist unchanged (NONE); the only package-src and patch-file edits are comments (adapter JSDoc, test-comment, presets/mpd.patch.yml tool-web comment); typecheck + dist-fresh + bun test packages corroborate',
    logs: ['11-cross-checks.log', '15-docs-integrity.log', '16-scope-diff.log'],
  },
  repairReview: {
    subject: 'skills/dsh-qa/scripts/preset-register.ts + skills/dsh-qa/scripts/dual-track-smoke.ts (pre-existing test:qa red on dev)',
    claim: 'typeof baseUrl === \'string\' is a TYPE GUARD around fileURLToPath(baseUrl) (no decode, no path concat), so the old sentinel includes("typeof baseUrl") reddened on a healthy rewrite',
    independentlyVerified: true,
    proof: {
      patchBlobBase: '655b8624a8e55f5e9e47c63b5fb51e3cb599f911',
      patchBlobHead: '655b8624a8e55f5e9e47c63b5fb51e3cb599f911 (cordis.patch.yml is NOT part of this wave)',
      typeofBaseUrlOccurrences: 14,
      decodeOperandOccurrences: 5,
      fileURLToPathGuardOccurrences: 7,
      arithmetic: 'after stripping the 5 packed operands (one typeof baseUrl each), 9 typeof baseUrl occurrences remain from the guards => the OLD sentinel was necessarily TRUE on a healthy rewrite; the NEW sentinel decodeURIComponent(baseUrl) is 0 on the same rewrite',
      log: '13-repair-probe.log',
    },
    doesItWeakenTheCheck: 'NO — it narrows a false-positive predicate to the packed operand\'s decode call, keeps both real probes (the @mpd-dsh/mpd/ leak sentinel, the MCP launcher checks, the web-compat entry check), makes the stripper quote-agnostic (double + single), and ADDS a negative control in each file so the narrowed predicate cannot become vacuous silently (if the declared patch ever loses the decode form, the self-test reddens, which is loud rather than silent)',
    residualRisk: 'A hand-written baseUrl concat with no decodeURIComponent call would not trip the narrowed sentinel; that shape is not produced by the packer, and the @mpd-dsh/mpd/ leak sentinel still catches the packed-layout leak class. Recorded as a Nit, not a defect.',
    verdict: 'REPAIR ACCEPTED — not a gate game',
  },
  findings: [
    {
      severity: 'Nit',
      where: 'skills/dsh-qa/scripts/preset-register.ts, skills/dsh-qa/scripts/dual-track-smoke.ts — BASEURL_DECODE control',
      what: 'The non-vacuity control asserts only the decode half; a future non-packer concat without decodeURIComponent would be invisible to it.',
      whyItMatters: 'Only a hypothetical hand-written operand; the packed layout always carries the decode call and the @mpd-dsh/mpd/ leak sentinel still fires.',
      direction: 'If desired, also assert the exact operand constants (BASEURL_RESOLVE_DQ/SQ) in the negative control — described, not applied.',
    },
    {
      severity: 'Nit',
      where: '.mpd/plans/adapt-dsh-022rc5-tui-0202.md §5 write scopes vs the shipped diff',
      what: '11 skills/dsh-qa/scripts files changed; the frozen §5 board named only skills/dsh-qa/scripts/tui-mount.ts (T1) and scripts/mpd-tui-panels.ts prose. Eight further QA scripts (install-dependencies, lib/tui-lane, tui-admission, tui-deps-ctrla, tui-keeper-standdown, tui-panels, tui-team-surface, user-surface-mount) carry consistent 0.20.1 -> 0.20.2 default/remedy updates that no frozen task row declared.',
      whyItMatters: 'Content is consistent and every gate is green, but a frozen contract whose write scopes do not match the shipped diff weakens the audit trail for the next wave.',
      direction: 'Amend §5 (or list the files in the T1 row) and name the QA consistency pass in the bilingual PR body — described, not applied.',
    },
    {
      severity: 'Nit',
      where: 'docs/index.md, docs/development.md, docs/user-guide.md (+ .zh-CN twins)',
      what: 'These three pairs spell the switch link as [中文](index.zh-CN.md) (bare relative) while AGENTS.md shows [中文](./index.zh-CN.md); pre-existing at base e3f36a99 and accepted by verify:docs (which is green).',
      whyItMatters: 'Cosmetic inconsistency with the documented example only; not caused by this wave and not a policy violation the gate recognises.',
      direction: 'Optional normalisation when those docs are next edited.',
    },
  ],
  declinedToJudge: [
    'Docker real-machine lane(s) — T5 is a parallel lane owning evidence/release/v0.21.0/docker-*; a static sweep cannot see an install (contract §5).',
    'Harness 0.2.2-rc.4 — admitted by engines.dsh but not separately claimed or measured (contract §6); I did not measure it.',
    '0.2.3-alpha.1 and its fileAddressFor relative-address migration — out of scope by contract §2/§6.',
    'The +277-byte lib/types/dsh-adapter/index.d.ts delta (F10) — declared UNVERIFIED by the contract; nothing in this wave depends on it.',
    'A live TTY mount and any "Verified" claim — tui-admission\'s own BOUND: static admission + the host\'s negotiation only, no artifact digest exists.',
    'The tool-office guarded-row statement on rc.5 — docs keep it HOST-SPECIFIC and say it was not re-measured on rc.5; no install lane in my lane could re-measure it.',
    'The base-commit reproduction of the pre-existing test:qa red — I did not check out base (that would mutate the tree mid-wave); I proved the false positive arithmetically on byte-identical patch bytes (13-repair-probe.log) and the wave\'s test:qa is green.',
    'The three bare-form switch links — pre-existing and gate-green; judged cosmetic, not a defect.',
    'The repo-root `bun test` — deliberately not run (it scans evidence/** fixtures per AGENTS.md §11); the per-package form `bun test packages` was run instead.',
    'Individual per-package test inventories / coverage — not measured; the suite result is the claim.',
  ],
  bounds: [
    'Static only: no Docker build, no install of the PUBLISHED package, no live TTY mount, no browser lane, no npm publish.',
    'Certified bytes are commit d2a93abc (45 files, +535/-191, diff sha256 9d9d5726…) with a clean tracked tree; the pre-freeze working tree was byte-identical (00-freeze-proof.log).',
    'Commands 01-07 also ran pre-freeze at 09:30:35-09:31:39Z on the byte-identical working tree; the verdict dir re-ran all of them on the frozen commit (09:32:18Z onward), so all evidence in the verdict dir post-dates the freeze.',
    'Harness measured: dsh 0.2.2-rc.5 both from .qa-tmp/dsh-022/bin and from the ambient PATH; TUI host 0.20.2 as installed in the dsh-tui profile.',
    'install-profile.ts --dry-run used the default DSH_HOME /home/haroldzhao/.dsh with write=false: it reads home paths and wrote nothing; this is the documented gate spelling, not an isolated-home run.',
    'bundle-lifecycle.ts built its own sandbox DSH_HOME + HOME; its log never mentions the real ~/.dsh; it wrote its own evidence at evidence/dsh-qa/bundle-lifecycle/2026-11-22T09-32-28.237Z.',
    'bun test packages: 4180 pass, 6 skip, 0 fail — skips are toolchain/environment (svn binary absent x2, live team readout x1, comment-checker binary absent x3), not failures.',
    'The `pack` gate is exercised through verify:manifest --pack (10c: npm pack --dry-run, 1300 files, 0 required paths absent); no separate npm pack artifact was produced.',
    'Docker lane not run and not judged (T5).',
  ],
  evidenceDir: 'evidence/release/v0.21.0/static-2026-11-22T09-32-05Z/ (final verdict dir)',
  preFreezeRunDir: 'evidence/release/v0.21.0/static-2026-11-22T09-06-54Z/ (precondition snapshot + first-pass logs)',
  verifyPlane: 'mpd_verify_* tools are mounted in this session, but no wave loop exists to bind: the only loop dated today is loop-20261122T074548-852bb1, opened BEFORE this team/wave (created 07:45Z, taskId null, gateFile state=absent, scope []). Per my brief I did not invent a recorded verdict; the verdict stands as this evidence record plus the captain\'s board verdict.',
}
fs.writeFileSync(path.join(D, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log('[result] wrote result.json · verdict=' + result.verdict + ' · commands=' + commands.length + ' · members=' + Object.keys(result.aggregateMembers).length)
