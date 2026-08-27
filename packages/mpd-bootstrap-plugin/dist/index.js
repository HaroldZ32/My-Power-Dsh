// src/index.ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
var name = "mpd-bootstrap";
var inject = [];
function pkgRoot() {
  try {
    const req = createRequire(import.meta.url);
    return dirname(req.resolve("@mpd-dsh/mpd/package.json"));
  } catch {
    return dirname(dirname(dirname(new URL(import.meta.url).pathname)));
  }
}
function userPresetsDir() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, ".agent-presets");
}
function apply(ctx, config = {}) {
  if (config.skipPresets === true) {
    console.log("[mpd-bootstrap] presets skipped (config)");
    return;
  }
  const root = pkgRoot();
  const presetsSrc = config.presetsDir ? config.presetsDir : join(root, "presets");
  const dest = userPresetsDir();
  const stamp = join(dest, ".mpd-presets-version");
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown";
  } catch {}
  let installed = "";
  try {
    installed = readFileSync(stamp, "utf8").trim();
  } catch {}
  if (existsSync(presetsSrc) && readdirSync(presetsSrc).some((d) => d.startsWith("mpd-"))) {
    mkdirSync(dest, { recursive: true });
    if (installed !== version) {
      for (const d of readdirSync(presetsSrc)) {
        if (!d.startsWith("mpd-"))
          continue;
        const from = join(presetsSrc, d);
        const to = join(dest, d);
        try {
          cpSync(from, to, { recursive: true, force: true });
        } catch (e) {
          console.log("[mpd-bootstrap] preset copy failed: " + d + " " + String(e?.message ?? e));
        }
      }
      try {
        writeFileSync(stamp, version);
      } catch {}
      console.log("[mpd-bootstrap] presets installed (" + version + ") -> " + dest);
    } else {
      console.log("[mpd-bootstrap] presets up to date (" + version + ")");
    }
  } else {
    console.log("[mpd-bootstrap] no bundled presets found at " + presetsSrc);
  }
}
export {
  apply,
  inject,
  name
};
