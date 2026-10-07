// t12 harness (read-only lane). The comment-only property is proved WITHOUT needing the previous
// revision's bytes: in a COPY of the shipped script every comment BODY is replaced (newlines and lines
// preserved) and the run output is compared byte-for-byte with the shipped script's own output. A
// behaviour change hiding in the comments would move that output; comments cannot execute.
import { readFileSync, readdirSync, lstatSync, mkdirSync, rmSync, symlinkSync, readlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const repo = process.cwd();
const scratch = "/tmp/t12";
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const current = readFileSync(join(repo, "scripts/verify-docs-parity.mjs"), "utf8");

/** Replace every comment BODY with a marker, preserving the number of newlines (so line numbers hold). */
function mutateComments(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const prevSig = () => {
    for (let k = out.length - 1; k >= 0; k -= 1) {
      const ch = out[k];
      if (ch !== " " && ch !== "\n" && ch !== "\t") return ch;
    }
    return "";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      out.push("//");
      i += 2;
      while (i < n && src[i] !== "\n") {
        out.push("X");
        i += 1;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      out.push("/*");
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : "X");
        i += 1;
      }
      out.push("*/");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out.push(c);
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          out.push(src[i], src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out.push(src[i]);
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/") {
      const p = prevSig();
      if ("=(,:[!&|?{};+-*%~^<>".includes(p) || p === "") {
        out.push(c);
        i += 1;
        let inClass = false;
        while (i < n) {
          const ch = src[i];
          if (ch === "\\") {
            out.push(ch, src[i + 1] ?? "");
            i += 2;
            continue;
          }
          out.push(ch);
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) {
            i += 1;
            break;
          } else if (ch === "\n") break;
          i += 1;
        }
        continue;
      }
    }
    out.push(c);
    i += 1;
  }
  return out.join("");
}

const CRLF = (s) => s.replace(/\r\n/g, "\n");
const mutated = mutateComments(current);
const origLines = CRLF(current).split("\n");
const mutLines = CRLF(mutated).split("\n");
const checks = {
  currentSha256: sha(current),
  mutatedSha256: sha(mutated),
  differsInBytes: current !== mutated,
  sameLineCount: origLines.length === mutLines.length,
  changedLinesAreCommentLines: origLines.every((l, idx) => mutLines[idx] === l || l.trimStart().startsWith("//") || l.trim() === "" || l.trimStart().startsWith("*") || l.trimStart().startsWith("/*")),
};

const writeScript = (text, name) => {
  const f = join(scratch, `${name}.mjs`);
  writeFileSync(f, text);
  return f;
};
const currentScript = writeScript(current, "shipped");
const mutantScript = writeScript(mutated, "comments-mutated");
const nodeCheck = spawnSync("node", ["--check", mutantScript], { encoding: "utf8" });

const copy = join(scratch, "tree");
const SKIP = new Set([".git", "node_modules", "evidence"]);
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const s = join(dir, e.name);
    const rel = relative(repo, s);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      mkdirSync(join(copy, rel), { recursive: true });
      walk(s);
      continue;
    }
    const st = lstatSync(s);
    if (st.isFile()) writeFileSync(join(copy, rel), readFileSync(s));
    else if (st.isSymbolicLink()) symlinkSync(readlinkSync(s), join(copy, rel));
  }
};
walk(repo);

const run = (script, args) => {
  const r = spawnSync("node", [script, ...args], { cwd: repo, encoding: "utf8" });
  return { exit: r.status, stdout: r.stdout, stderr: r.stderr };
};

const live = run(currentScript, []);
const liveMutant = run(mutantScript, []);
const self = run(currentScript, ["--self-test"]);
const selfMutant = run(mutantScript, ["--self-test"]);

const target = join(copy, "docs/design.md");
const original = readFileSync(target, "utf8");
const probes = [];
const probe = (label, md) => {
  writeFileSync(target, original + md);
  const a = run(currentScript, ["--root", copy]);
  const b = run(mutantScript, ["--root", copy]);
  writeFileSync(target, original);
  probes.push({
    label,
    injected: md.trim(),
    shippedExit: a.exit,
    mutatedExit: b.exit,
    outputsByteIdentical: a.stdout === b.stdout,
    summary: a.stdout.split("\n").filter((l) => l.startsWith("[verify-docs-parity]")).join(" | "),
    violations: a.stdout.split("\n").filter((l) => l.includes("link-missing:")).slice(0, 2),
  });
};
probe("P0 baseline copy", "\n// t12 probe\n");
probe("P1 root-relative target EXISTS (file)", "\n// t12 probe\n[x](/docs/index.md)\n");
probe("P2 root-relative target MISSING", "\n// t12 probe\n[x](/nowhere/absent.md)\n");
probe("P3 dead RELATIVE link", "\n// t12 probe\n[x](./t12-injected-dead-link.md)\n");
probe("P4 fragment on EXISTING file, fragment absent", "\n// t12 probe\n[x](./index.md#no-such-anchor)\n");
probe("P5 fragment on MISSING file", "\n// t12 probe\n[x](./no-such-file.md#x)\n");
probe("P6 restore control", "\n// t12 probe\n");

rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify({
  at: new Date().toISOString(),
  checks,
  nodeCheckMutated: nodeCheck.status,
  behaviourComparison: {
    shippedTree: { shippedExit: live.exit, mutatedExit: liveMutant.exit, stdoutByteIdentical: live.stdout === liveMutant.stdout, shippedLine: live.stdout.trim().split("\n").at(-1) },
    selfTest: { shippedExit: self.exit, mutatedExit: selfMutant.exit, stdoutByteIdentical: self.stdout === selfMutant.stdout, shippedSummary: (self.stdout.split("\n").find((l) => l.includes("self-test]")) ?? "").trim() },
  },
  probes,
}, null, 2));
