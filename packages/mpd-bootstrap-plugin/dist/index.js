// src/index.ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var name = "mpd-bootstrap";
var inject = [];
function pkgRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
function userPresetsDir() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, ".agent-presets");
}
function userSkillsDir() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "skills");
}
function syncTree(src, dest, version, label, filter) {
  if (!existsSync(src)) {
    console.log("[mpd-bootstrap] no bundled " + label + " at " + src);
    return;
  }
  mkdirSync(dest, { recursive: true });
  const stamp = join(dest, ".mpd-" + label + "-version");
  let installed = "";
  try {
    installed = readFileSync(stamp, "utf8").trim();
  } catch {}
  if (installed === version) {
    console.log("[mpd-bootstrap] " + label + " up to date (" + version + ")");
    return;
  }
  for (const d of readdirSync(src)) {
    if (filter && !filter(d))
      continue;
    try {
      cpSync(join(src, d), join(dest, d), { recursive: true, force: true });
    } catch (e) {
      console.log("[mpd-bootstrap] " + label + " copy failed: " + d + " " + String(e?.message ?? e));
    }
  }
  try {
    writeFileSync(stamp, version);
  } catch {}
  console.log("[mpd-bootstrap] " + label + " installed (" + version + ") -> " + dest);
}
function apply(ctx, config = {}) {
  const root = pkgRoot();
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown";
  } catch {}
  if (config.skipPresets === true) {
    console.log("[mpd-bootstrap] presets skipped (config)");
  } else {
    const packedSrc = join(root, "presets");
    const devSrc = join(root, "packages", "mpd-bootstrap-plugin", "presets");
    const presetsSrc = config.presetsDir ? config.presetsDir : existsSync(packedSrc) ? packedSrc : devSrc;
    syncTree(presetsSrc, userPresetsDir(), version, "presets", (d) => d === "mpd" || d.startsWith("mpd-"));
  }
  if (config.skipSkills === true) {
    console.log("[mpd-bootstrap] skills skipped (config)");
  } else {
    const skillsSrc = config.skillsDir ? config.skillsDir : join(root, "skills");
    syncTree(skillsSrc, userSkillsDir(), version, "skills");
  }
}
export {
  name,
  inject,
  apply
};
