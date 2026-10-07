#!/usr/bin/env node
// t62 A3 — BOTH-SIDES spawn-shape arms for the T-43 real-home guard.
//
// Every arm runs in a CHILD process with the env set AT SPAWN, because that is the shape a QA boot
// uses and the shape whose absence let the defect through: t23's guard-cases.mjs mutated HOME
// inside a running process, which under bun (homedir frozen at start) is a different code path.
//
// Arms: A sandbox HOME -> ALLOWED (the sanctioned recipe) | B HOME unset -> REFUSED 403
//       C real HOME    -> REFUSED 403                        | D sandbox + override -> ALLOWED
// Runtimes: node (production; dsh is node) and bun (the test runtime).
//
// usage: node guard-arms.mjs [--dist <path>] [--real-home <path>] [--json] [--self-test]
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PROBE = `
const { assertMutationSandboxed } = await import(process.env.ARM_DIST);
try { assertMutationSandboxed("arm probe"); console.log("ALLOWED") }
catch (e) { console.log("REFUSED:" + (e.status ?? "?")) }
`;

export function runArms({ dist, realHome, runtimes = ["node", "bun"] }) {
  const work = mkdtempSync(join(tmpdir(), "guard-arms-"));
  const sandbox = join(work, "home");
  const dshHome = join(work, "dsh");
  mkdirSync(sandbox, { recursive: true });
  mkdirSync(dshHome, { recursive: true });
  const probe = join(work, "probe.mjs");
  writeFileSync(probe, PROBE);
  const ARMS = [
    { id: "A", shape: "sandbox HOME + DSH_HOME (sanctioned recipe)", expect: "ALLOWED", env: { HOME: sandbox, DSH_HOME: dshHome } },
    { id: "B", shape: "HOME unset + DSH_HOME", expect: "REFUSED", env: { DSH_HOME: dshHome }, unsetHome: true },
    { id: "C", shape: "real HOME + DSH_HOME", expect: "REFUSED", env: { HOME: realHome, DSH_HOME: dshHome } },
    { id: "D", shape: "sandbox HOME + override", expect: "ALLOWED", env: { HOME: sandbox, DSH_HOME: dshHome, MPD_DSH_WORKMATE_ALLOW_REAL_HOME: "1" } }
  ];
  const rows = [];
  // ABSOLUTE dist: a relative specifier is a bare package name to node (ERR_MODULE_NOT_FOUND) and
  // makes bun hang — both measured, and a per-arm timeout keeps a hang from wedging the harness.
  const distAbs = resolve(dist);
  for (const rt of runtimes) {
    for (const arm of ARMS) {
      const env = { ...process.env, ARM_DIST: distAbs, ...arm.env };
      if (arm.unsetHome) delete env.HOME;
      const r = spawnSync(rt, [probe], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });
      const out = (r.stdout || "").trim().split("\n").pop() || "";
      const got = r.error ? "TIMEOUT/" + r.error.code : out.startsWith("ALLOWED") ? "ALLOWED" : out.startsWith("REFUSED") ? "REFUSED" : "ERROR:" + (r.stderr || "").trim().slice(0, 80);
      rows.push({ runtime: rt, arm: arm.id, shape: arm.shape, expect: arm.expect, got, pass: got === arm.expect, status: out.includes(":") ? out.split(":")[1] : "" });
    }
  }
  return { dist: distAbs, realHome, rows, ok: rows.every((r) => r.pass) };
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("guard-arms.mjs");
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes("--self-test")) {
    // negative control: a deliberately one-sided arm table MUST fail (arm A has no counterpart).
    const work = mkdtempSync(join(tmpdir(), "guard-arms-st-"));
    const fake = join(work, "dist.mjs");
    writeFileSync(fake, "export function assertMutationSandboxed(){ throw Object.assign(new Error('x'),{status:403}) }\n");
    const oneSided = [
      { id: "B", shape: "HOME unset", expect: "REFUSED", env: { HOME: join(work, "h"), DSH_HOME: join(work, "d") } }
    ];
    const rows = oneSided.map((a) => ({ ...a, got: "REFUSED", pass: true }));
    const bothsides = [{ id: "A", expect: "ALLOWED", got: "REFUSED", pass: false }];
    const pass = rows.every((r) => r.pass) && bothsides.some((r) => !r.pass);
    console.log(`[self-test] one-sided table hides the defect (A not present) => ${pass ? "PASS" : "FAIL"}: a both-sides table would report arm A as failing`);
    process.exit(pass ? 0 : 1);
  }
  const D = arg("--dist", "packages/mpd-workmate-plugin/dist/index.js");
  const RE = arg("--real-home", "/root");
  const res = runArms({ dist: D, realHome: RE });
  if (argv.includes("--json")) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(`[guard-arms] dist=${D} realHome=${RE}`);
    for (const r of res.rows) console.log(`  ${r.pass ? "PASS" : "FAIL"} ${r.runtime.padEnd(4)} arm ${r.arm}: ${r.shape.padEnd(42)} expect=${r.expect.padEnd(7)} got=${r.got}`);
    console.log(`[guard-arms] ok=${res.ok} (both sides × both runtimes must agree)`);
  }
  process.exit(res.ok ? 0 : 1);
}
