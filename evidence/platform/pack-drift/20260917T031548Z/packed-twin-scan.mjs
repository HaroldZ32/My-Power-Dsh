#!/usr/bin/env node
// Packed-vs-checkout twin scan, BOTH directions — the post-pack completeness+drift check.
//
// v2 (2026-09-17): a forward-only scan cannot see a file that was ADDED to the checkout AFTER the
// packer ran (the pack simply lacks the entry, so there is nothing to compare and drift stays 0).
// This version also walks the checkout side of every root the packer copies and requires a
// byte-identical packed twin, so `ok` means BOTH "nothing drifted" and "nothing is missing".
//
// usage: node packed-twin-scan.mjs [--pack dist/mpd-package] [--repo .] [--json] [--self-test]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const BY_DESIGN = [
  { rel: "package.json", why: "packer-generated packed-form manifest (scripts/pack-mpd.mjs:372)" },
  { rel: "packages/mpd-ext-plugin/dist/validator.js", why: "packer-generated CLI validator entry (scripts/pack-mpd.mjs:125)" }
];
// The packer's own declaration is authoritative; parse it so this instrument follows it.
function shippedRoots(repo) {
  try {
    const src = fs.readFileSync(path.join(repo, "scripts", "pack-mpd.mjs"), "utf8");
    const roots = parseDeclaredArray(src, "ROOT_ASSET_DIRS");
    if (roots.length > 0) return roots;
  } catch { /* fall through */ }
  return ["skills", "presets", "extensions", "templates", "docs", "agent-references"];
}
// Paths the packer copies with a filter (see scripts/pack-mpd.mjs:165,229) — never reverse-required.
const NOT_SHIPPED = (rel) =>
  /^packages\/(mpd-agent-teams-plugin|mpd-mcp-shared)\/(test|self-fix-tests)\//.test(rel) ||
  (/^packages\/mpd-mcp-shared\//.test(rel) && rel.endsWith(".test.mjs"));

// t71 A3: never fall back silently. `declaredRootFilesSource` reports WHERE the list came from; a
// fallback (or a failed parse) while the packer DOES declare ROOT_FILES is reported loudly, so a
// fixture that forgets the fourth list cannot hide behind the legacy literal.
export function declaredRootFilesSource(repo) {
  const files = declaredRootFiles(repo);
  try {
    const src = fs.readFileSync(path.join(repo, "scripts", "pack-mpd.mjs"), "utf8");
    if (/const ROOT_FILES = \[/.test(src)) {
      return files.length > 0 ? { files, source: "packer" } : { files, source: "parse-failed" };
    }
  } catch { /* no packer to read */ }
  return { files, source: "fallback" };
}

// t71 A7 (found by packaging-engineer): a naive `\[[\s\S]*?\]` parse stops at the FIRST `]`, and
// the packer's own comments contain one (`` `[pack-mpd] FAIL: …` `` at scripts/pack-mpd.mjs:58), which
// silently dropped the LAST TWO plugin entries (mpd-team-watchdog-plugin, mpd-bundle-plugin) — i.e.
// the same false-green class one level down again, inside the parser. This lexer walks the array with
// bracket depth while skipping line comments, block comments and quoted strings/quasi-quotes as units.
export function parseDeclaredArray(src, name) {
  const anchor = "const " + name + " = [";
  let i = src.indexOf(anchor);
  if (i < 0) return [];
  i = src.indexOf("[", i + anchor.length - 1);
  let depth = 0;
  const out = [];
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++; let v = "";
      while (i < src.length && src[i] !== q) { v += src[i]; i++; }
      i++;
      if (depth === 1 && v !== "") out.push(v);
      continue;
    }
    if (c === "[") { depth++; i++; continue; }
    if (c === "]") { depth--; i++; if (depth === 0) break; continue; }
    i++;
  }
  return out;
}

// The root FILES the packer copies (its own ROOT_FILES list, v6). Same rule as the three other
// declarations: enumerate from the packer, never from a literal that drifts behind it.
export function declaredRootFiles(repo) {
  try {
    const src = fs.readFileSync(path.join(repo, "scripts", "pack-mpd.mjs"), "utf8");
    const files = parseDeclaredArray(src, "ROOT_FILES");
    if (files.length > 0) return files;
  } catch { /* fall through */ }
  return ["LICENSE.md", "LICENSE-NOTICES.md", "README.md", "README.zh-CN.md"];
}

// The package list the packer DECLARES (PLUGIN_PKGS ∪ MCP_PKGS), parsed from the packer itself.
// v5: the reverse pass must enumerate this from the SOURCE of truth, never from the pack — a package
// directory that is absent from the pack has no entries to walk, so a pack-enumerated reverse pass
// cannot see it (measured: deleting `packages/mpd-workmate-plugin/` from the artifact produced NO
// missing entry, only a lower `identical` count).
// t71 A7: the DECLARED package set = the packer's PLUGIN_PKGS ∪ MCP_PKGS + the patch's class-B adopted
// main-code row (copied wholesale at scripts/pack-mpd.mjs:165 and counted by the closure gate). 18 + 4
// + 1 = 23, which is the number the gate prints as `declared packages 23/23`.
export function declaredPackageSet(repo) {
  return [...new Set([...declaredPackages(repo), "mpd-agent-teams-plugin"])];
}

export function declaredPackages(repo) {
  try {
    const src = fs.readFileSync(path.join(repo, "scripts", "pack-mpd.mjs"), "utf8");
    const names = [];
    for (const key of ["PLUGIN_PKGS", "MCP_PKGS"]) names.push(...parseDeclaredArray(src, key));
    if (names.length > 0) return [...new Set(names)];
  } catch { /* fall through */ }
  return [];
}

// t71 A6 — files the packer itself writes at pack time; anything ELSE newer than the manifest's
// stamp means the artifact was written AFTER the pack (the shape of an in-place edit through a
// hardlinked copy, or a stray writer), and neither can be read as a pack of one revision.
export const AFTER_PACK_ALLOWED = ["package.json", "cordis.patch.yml", "packages/mpd-ext-plugin/dist/validator.js"];

export function scan({ pack = "dist/mpd-package", repo = "." } = {}) {
  const byDesign = new Map(BY_DESIGN.map((e) => [e.rel, e.why]));
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const exists = (f) => { try { return fs.lstatSync(f).isFile(); } catch { return false; } };
  const out = { pack, repo, identical: 0, drift: [], byDesign: [], noTwin: 0, missing: [], afterPack: [], symlinks: [], packStampUtc: null };
  const walk = (d, rel, fn) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      const full = path.join(d, e.name);
      if (e.isSymbolicLink() || e.name === "node_modules") continue;
      if (e.isDirectory()) walk(full, r, fn);
      else fn(full, r);
    }
  };
  // direction 1 — everything in the pack vs its checkout twin
  const manifestAbs = path.join(pack, "package.json");
  const manifestMtimeMs = exists(manifestAbs) ? fs.statSync(manifestAbs).mtimeMs : null;
  walk(pack, "", (full, r) => {
    if (manifestMtimeMs !== null && r !== "package.json" && !AFTER_PACK_ALLOWED.includes(r)) {
      const m = fs.statSync(full).mtimeMs;
      if (m > manifestMtimeMs) out.afterPack.push({ rel: r, mtime: new Date(m).toISOString(), manifestMtime: new Date(manifestMtimeMs).toISOString() });
    }
    const twin = path.join(repo, r);
    if (byDesign.has(r)) {
      out.byDesign.push({ rel: r, packedBytes: fs.statSync(full).size, packedSha256: sha(full), why: byDesign.get(r) });
      return;
    }
    if (!exists(twin)) { out.noTwin++; return; }
    if (sha(full) === sha(twin)) out.identical++;
    else out.drift.push({ rel: r, packedBytes: fs.statSync(full).size, checkoutBytes: fs.statSync(twin).size,
      packedSha256: sha(full).slice(0, 16), checkoutSha256: sha(twin).slice(0, 16),
      packedMtime: fs.statSync(full).mtime.toISOString(), checkoutMtime: fs.statSync(twin).mtime.toISOString() });
  });
  // direction 2 — everything the packer is contracted to ship must exist in the pack:
  //   (a) the ROOT_ASSET_DIRS it declares, (b) the root files and the two scripts it copies by name,
  //   (c) every non-excluded checkout file under each SHIPPED package directory (packages/<p> as it
  //       appears in the pack), which covers dist/, personas/, themes/, skills/, client.js, the
  //       bilingual READMEs and the launcher closures without enumerating each copy call.
  // The exclusion list mirrors the packer's own filters (src and overlay are build inputs and are
  // never copied — `overlay/` exists only as the offline MCP build's input and nothing in the packed
  // tree references it; test dirs and *.test.* are filtered; package.json is not copied for our
  // packages). Generated files (packed manifest, packed patch, packer validator entry) have no
  // comparable twin and are reported separately, never as drift.
  const REVERSE_EXCLUDED = (rel) =>
    /(^|\/)(src|overlay|test|self-fix-tests|node_modules)\//.test(rel) ||
    /\.test\.[cm]?[jt]s$/.test(rel) ||
    rel.endsWith("/package.json")
  const reverseCheck = (srcPath, rel) => {
    if (REVERSE_EXCLUDED(rel)) return;
    const packed = path.join(pack, rel);
    // absence only — a byte difference is the forward pass's finding, never double-reported here
    if (!exists(packed)) out.missing.push({ rel, checkoutBytes: fs.statSync(srcPath).size, reason: "absent from the packed tree" });
  };
  for (const root of shippedRoots(repo)) {
    const src = path.join(repo, root);
    if (fs.existsSync(src)) walk(src, root, (full, r) => { if (!NOT_SHIPPED(r)) reverseCheck(full, r) });
  }
  // v6: ROOT_FILES is parsed from the packer too — a hardcoded list here was a false green one
  // level down from the package/asset roots (t70 added EXTENSIONS-FOR-AGENTS.md to the packer's
  // ROOT_FILES while this scan stayed silent about it missing from the artifact).
  const rootFilesDecl = declaredRootFilesSource(repo);
  out.rootFilesSource = rootFilesDecl.source;
  out.rootFiles = rootFilesDecl.files;
  if (rootFilesDecl.source !== "packer") {
    console.error(`[packed-twin-scan] WARNING: the root-file list came from ${rootFilesDecl.source} — the packer's ROOT_FILES did not parse; refusing to treat that as a verified list (t71 A3)`);
  }
  for (const f of [...rootFilesDecl.files, "scripts/install-mcp.mjs", "scripts/mpd-ext.mjs"]) {
    const abs = path.join(repo, f);
    if (exists(abs)) reverseCheck(abs, f);
  }
  const pdir = path.join(pack, "packages");
  for (const pkg of fs.existsSync(pdir) ? fs.readdirSync(pdir) : []) {
    const cd = path.join(repo, "packages", pkg);
    if (fs.existsSync(cd)) walk(cd, "packages/" + pkg, reverseCheck);
  }
  // v5 — DECLARED packages and root asset dirs must EXIST in the pack, whatever the pack contains.
  // Without this, a wholly absent package/dir is invisible to a pack-enumerated reverse pass.
  // the patch's class-B adopted main-code row is copied wholesale (scripts/pack-mpd.mjs:165) and is
  // counted by the closure gate as a declared package — require it here too, or its absence is silent.
  for (const pkg of declaredPackageSet(repo)) {
    if (!fs.existsSync(path.join(repo, "packages", pkg))) continue;
    if (!fs.existsSync(path.join(pack, "packages", pkg))) {
      out.missing.push({ rel: "packages/" + pkg + "/", reason: "declared package directory absent from the packed tree" });
    }
  }
  for (const root of shippedRoots(repo)) {
    if (fs.existsSync(path.join(repo, root)) && !fs.existsSync(path.join(pack, root))) {
      out.missing.push({ rel: root + "/", reason: "declared root asset directory absent from the packed tree" });
    }
  }
  const manifest = path.join(pack, "package.json");
  out.declaredCounts = { rootAssetDirs: shippedRoots(repo).length, rootFiles: declaredRootFiles(repo).length, packages: declaredPackageSet(repo).length };
  out.packStampUtc = exists(manifest) ? fs.statSync(manifest).mtime.toISOString() : null;
  out.ok = out.drift.length === 0 && out.missing.length === 0 && out.afterPack.length === 0;
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (k, dflt) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : dflt; };
  if (argv.includes("--self-test")) {
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "twin-selftest-"));
    fs.mkdirSync(path.join(tmp, "pack", "skills"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "skills"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "scripts", "pack-mpd.mjs"), 'const ROOT_ASSET_DIRS = [\n  "skills",\n]\nconst PLUGIN_PKGS = [\n  "x",\n  // trap: a comment carrying a ] and a quoted "decoy" that a naive parse would stop on\n  "y",\n]\nconst MCP_PKGS = []\nconst ROOT_FILES = [\n  "same-root.md", "added-root.md",\n]\n');
    fs.writeFileSync(path.join(tmp, "skills", "same.md"), "A");
    fs.writeFileSync(path.join(tmp, "pack", "skills", "same.md"), "A");          // identical
    fs.writeFileSync(path.join(tmp, "skills", "mutated.md"), "A");
    fs.writeFileSync(path.join(tmp, "pack", "skills", "mutated.md"), "B");       // drift
    fs.writeFileSync(path.join(tmp, "skills", "added-late.md"), "A");            // MISSING from the pack
    // third shape: a shipped PACKAGE file absent from the pack (the set v3 added)
    fs.mkdirSync(path.join(tmp, "packages", "x", "dist"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "pack", "packages", "x", "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "packages", "x", "dist", "present.js"), "A");
    fs.writeFileSync(path.join(tmp, "pack", "packages", "x", "dist", "present.js"), "A");
    fs.writeFileSync(path.join(tmp, "packages", "x", "dist", "added-late.js"), "A");   // MISSING from the pack
    // fourth shape (v5): a DECLARED package whose directory is entirely absent from the pack — the
    // mirror hole packaging-engineer's seeded control exposed: no entries to walk, so only an
    // enumeration from the declaration can see it.
    fs.mkdirSync(path.join(tmp, "packages", "y", "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "packages", "y", "dist", "only.js"), "A");
    fs.writeFileSync(path.join(tmp, "same-root.md"), "A");
    fs.writeFileSync(path.join(tmp, "pack", "same-root.md"), "A");   // identical root file
    fs.writeFileSync(path.join(tmp, "added-root.md"), "A");          // declared root file MISSING from the pack
    fs.writeFileSync(path.join(tmp, "pack", "package.json"), "{}");
    // sixth shape (A6): a packed file written AFTER the pack (mtime > the manifest's)
    fs.writeFileSync(path.join(tmp, "pack", "written-after-pack.md"), "A");
    const future = new Date(Date.now() + 60000);
    fs.utimesSync(path.join(tmp, "pack", "written-after-pack.md"), future, future);
    const stubSrc = fs.readFileSync(path.join(tmp, "scripts", "pack-mpd.mjs"), "utf8");
    const lexed = parseDeclaredArray(stubSrc, "PLUGIN_PKGS");
    const naive = (stubSrc.match(/const PLUGIN_PKGS = \[([\s\S]*?)\]/) || ["", ""])[1];
    const naiveCount = [...naive.matchAll(/"([^"]+)"/g)].length;
    if (lexed.length !== 2 || naiveCount >= lexed.length) {
      console.log(`[self-test] FAIL — the declaration parser control did not discriminate (lexed=${lexed.length} naive=${naiveCount}); a comment carrying a ] must not truncate the list (t71 A7)`);
      process.exit(1);
    }
    const guard = declaredRootFilesSource(tmp);
    if (guard.source !== "packer" || !guard.files.includes("added-root.md")) {
      console.log(`[self-test] FAIL — the fixture's ROOT_FILES did not parse (source=${guard.source}); refusing the silent legacy fallback (t71 A3)`);
      process.exit(1);
    }
    const r = scan({ pack: path.join(tmp, "pack"), repo: tmp });
    const wantMissing = ["added-root.md", "packages/x/dist/added-late.js", "packages/y/", "skills/added-late.md"];
    const pass = r.afterPack.length === 1 && r.afterPack[0].rel === "written-after-pack.md" && r.identical === 3 && r.drift.length === 1 && r.drift[0].rel === "skills/mutated.md"
      && r.missing.length === wantMissing.length && wantMissing.every((m) => r.missing.map((x) => x.rel).includes(m))
      && r.byDesign.length === 1 && r.ok === false;
    console.log(`[self-test] identical=${r.identical} drift=${r.drift.map((d) => d.rel).join(",") || "-"} missing=${r.missing.map((m) => m.rel).join(",") || "-"} afterPack=${r.afterPack.map((a) => a.rel).join(",") || "-"} byDesign=${r.byDesign.length} ok=${r.ok} -> ${pass ? "PASS" : "FAIL"}`);
    process.exit(pass ? 0 : 1);
  }
  const r = scan({ pack: arg("--pack", "dist/mpd-package"), repo: arg("--repo", ".") });
  if (argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`[packed-twin-scan v6] pack stamp (manifest mtime): ${r.packStampUtc}`);
    console.log(`[packed-twin-scan v6] identical=${r.identical} drift=${r.drift.length} missing=${r.missing.length} afterPack=${r.afterPack.length} byDesign=${r.byDesign.length} noTwin=${r.noTwin} symlinks=${r.symlinks.length}`);
    for (const d of r.drift) console.log(`  DRIFT ${d.rel}: packed ${d.packedBytes}B ${d.packedSha256} (${d.packedMtime}) vs checkout ${d.checkoutBytes}B ${d.checkoutSha256} (${d.checkoutMtime})`);
    for (const m of r.missing) console.log(`  MISSING ${m.rel}: ${m.reason}${m.checkoutBytes === undefined ? "" : ` (checkout ${m.checkoutBytes}B)`}`);
    for (const a of r.afterPack) console.log(`  WRITTEN-AFTER-PACK ${a.rel}: mtime ${a.mtime} > manifest ${a.manifestMtime} — the artifact was written after it was packed; it is not a pack of one revision`);
    for (const b of r.byDesign) console.log(`  BY-DESIGN ${b.rel} — ${b.why}`);
    console.log(`[packed-twin-scan v6] ok=${r.ok} (drift==0 AND missing==0 AND afterPack==0 over the shipped set is the only passing reading)`);
  }
  process.exit(r.ok ? 0 : 1);
}
