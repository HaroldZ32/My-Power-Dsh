# Hash ledger — process-hardening wave (w1)

Measured by the captain in `/root/dshProj/my-power-dsh`. A hash is quoted WITH the moment it was
read (AGENTS.md §7, the rule this wave added); the per-file values below are the ones the lanes
verified, re-confirmed by the captain's sweep on the settled bytes.

## Shipped files, final revision

| File | sha256 (prefix → full where it matters) | Moments |
|---|---|---|
| `scripts/verify-docs-parity.mjs` | `06ee71ae8fdf4cbb7ffc0b87465cd3aca99cd71dd3a5c48fb8e1610aa1a1a8b8` | 7 reads 11:58:26Z → 12:00:40Z (t12) + captain sweep 12:0xZ |
| `AGENTS.md` | `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68` | t10 @11:52:18Z; stable in t9/t12 windows; captain sweep 12:0xZ |
| `.gitignore` | `9e86dd852cdf995a8e3ae1b43b7d373cb0e2145ecbc8668110fe1aba784a212f` | t4 @11:34:40Z == 11:35:30Z; stable in later passes; captain sweep 12:0xZ |
| `agent-references/troubleshooting.md` | `af5ec159114e51a7a34d531bd1a8c62c02de7c306bbe1ee9ba55976ce9948de0` | t2 @11:27:37Z; stable in t5/t6/t9/t12 windows |
| `evidence/process-fixes/*` | see each artifact header | produced 11:2xZ → 12:0xZ |

## The gate script's revision chain (provenance, not drift)

The script legitimately moved five times in this wave; every earlier value is recorded as a
SUPERSEDED SAMPLE, never as the judged revision.

| Revision | sha256 prefix | What moved it | Status |
|---|---|---|---|
| HEAD at wave open | `2bbe584a…` | — (no link logic at all) | pre-wave baseline |
| t3 | `c97c6520…` | link-target resolution landed (+302/−3) | superseded by t8 |
| t8 | `1cb83b13…` | t5-F1 repair: ROOT-relative `/x` resolves against the repo root + 34th arm | superseded by t11 |
| t11 (**final**) | `06ee71ae…` | O2: the top-of-file paragraph now names the ROOT-relative class (comment-only) | **the revision committed** |

Comment-only-ness of the last step was proved by EQUIVALENCE (t12): a copy with every comment body
replaced produced byte-identical stdout on the shipped tree across seven probes and 34/34 on
`--self-test`; the single raw difference isolated to a printed random `mkdtemp` path. t12 also
disclosed that t11's own "reversing reproduces 1cb83b13…" claim did NOT corroborate under that route
(`7b94d92f…` instead) and was therefore treated as unverified, not leaned on.

## Gate exit codes on the settled bytes

| Gate | Exit | Output |
|---|---|---|
| `node scripts/verify-docs-parity.mjs` | 0 | `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` (counters: `files=92 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4`) |
| `node scripts/verify-docs-parity.mjs --self-test` | 0 | `34/34 checks passed — PASS` (was 28 before the wave) |
| `node scripts/verify-gates.mjs` | 0 | `PASS - 5/5 member gate(s) green` |
| `bun run test:qa` | 0 | `[test:qa] all self-tests passed` |
| `bun run typecheck` | 0 | `tsgo --noEmit` clean |
| `git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox` | 0 | `.gitignore:56:evidence/**/sandbox` (was exit 1 + `??` before the wave) |

## Captain's own demonstration (the wave's central claim, not taken from a lane's report)

Self-contained demo tree (`README` pair + `docs/guide` pair + a root `AGENTS.md`), shipped script,
`--root /tmp/t7demo`:

- baseline: `links=4 dead=0` — the LINK check green;
- injected `[dead](./t7-injected-dead.md)` into `docs/guide.md` → `FAIL link-missing:docs/guide.md:./t7-injected-dead.md — … neither a file nor a directory exists at /tmp/t7demo/docs/t7-injected-dead.md`, `links=5 dead=1`;
- removed → `links=4 dead=0`, the link FAIL line gone.

Honest note: the demo fixture carried its own unrelated `failed=1` (my hand-written switch link sits
below a blank line, so it is not "directly under the title"), which is why every run of that fixture
exits 1. The LINK counter moved 0 → 1 → 0 and the injected target was named exactly. A first attempt
at this demo ALSO measured `dead=0` while injected — because the tree had no root `AGENTS.md`, so the
T-75 discriminator correctly treated it as a packed/partial copy and reported a NOTE instead of a
failure. That is the bound working, and it is recorded here rather than hidden.

## Attribution

By task ownership + content (AGENTS.md §5; the shared checkout writes one git identity):

| Task | Seat | Output |
|---|---|---|
| t1 | Architect | `fact-base.md` (632 lines) + `t7-preflight.md` |
| t2 | Lead | `troubleshooting-rows.md` + the reference section |
| t3, t8 | Senior Engineer | `gate-links.md` + the script's link resolution and its t5-F1 repair |
| t4, t10, t11 | Junior Engineer | `gitignore-and-manual.md`, `language-policy.md`, the O2 comment fix |
| t5, t9, t12 | Plan Reviewer | `verify-hardening*.json/.log` (three passes, all preserved) |
| t6 | Reviewer | `review-round1.md` |
| t7 | Captain | this ledger, `SUMMARY.md`, the commit |
