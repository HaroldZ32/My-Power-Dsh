export function probe(config) {
const loadSiliconProfiles = () => {
        const fs = process.getBuiltinModule("node:fs");
        const path = process.getBuiltinModule("node:path");
        const require = process.getBuiltinModule("node:module").createRequire(import.meta.url);
        const candidates = [];
        try {
            candidates.push(require.resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json"));
        }
        catch { /* package not resolvable: the bundle-relative walk-up below may still find it */ }
        let dir = path.dirname(process.getBuiltinModule("node:url").fileURLToPath(import.meta.url));
        for (let up = 0; up < 8; up += 1) {
            candidates.push(path.join(dir, "node_modules", "@mpd-dsh", "silicon", "presets", "rtl-ip.profile.json"));
            const parent = path.dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        // Presence decides, not parseability: the FIRST candidate that EXISTS ends the search, so a
        // nearer copy is never silently superseded by a farther (older/different) one.
        //   - absent (ENOENT)          -> keep looking; an mpd-only install is the normal case
        //   - exists but unreadable    -> warn once naming the path + error, then {} (broken install)
        //   - readable but corrupt /
        //     non-object (incl. null,
        //     arrays)                  -> warn once naming the path, then {}
        //   - readable valid object    -> merge it
        for (const file of candidates) {
            let text;
            try {
                text = fs.readFileSync(file, "utf8");
            }
            catch (err) {
                if (err?.code === "ENOENT")
                    continue;
                console.warn(`[mpd] agent-teams: cannot read the silicon rtl-ip profile at ${file} (${err?.code ?? err}); ignoring it`);
                return {};
            }
            let parsed;
            try {
                parsed = JSON.parse(text);
            }
            catch {
                console.warn(`[mpd] agent-teams: ignoring the silicon rtl-ip profile at ${file} (invalid JSON)`);
                return {};
            }
            if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
                return parsed;
            console.warn(`[mpd] agent-teams: ignoring the silicon rtl-ip profile at ${file} (not a JSON object)`);
            return {};
        }
        return {};
    };
    config = { ...config, profiles: { ...loadSiliconProfiles(), ...(config.profiles ?? {}) } };

  return config.profiles;
}
