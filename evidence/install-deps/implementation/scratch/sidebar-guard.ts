// The ONE source of the sidebar mount guard expression, shared by
// packages/mpd-bundle/cordis.patch.yml (`disabled: !!js "<expr>"`) and
// scripts/install-profile.mjs (the legacy installer's same row). Printed as the
// exact YAML scalar body so the two writers cannot drift.
//
// Shape (measured, see evidence/install-deps/implementation/**):
//  1. the package must be resolvable from the profile node_modules;
//  2. `dsh-better-sidebar` itself as a declared bundle layer -> its own patch mounts it;
//  3. any OTHER bundle layer whose patch text names the package -> it mounts it
//     (order-independent: declarations, never the forward-blind entry list);
//  4. no web plane (no enabled webserver entry AND no dsh-web-app layer) -> disabled.
// Any throw returns TRUE (disabled): the worst case is a missing sidebar, never a
// dead boot. The decision is logged once per distinct outcome for the QA lane.
export const SIDEBAR_GUARD = "(() => { const say = (decision, reason) => { try { const seen = globalThis.__mpdSidebarGuardSeen || (globalThis.__mpdSidebarGuardSeen = {}); const key = decision + '|' + reason; if (!seen[key]) { seen[key] = 1; console.warn('[mpd-better-sidebar] mount guard: ' + decision + ' - ' + reason) } } catch (e) {} }; try { const fs = process.getBuiltinModule('node:fs'); const path = process.getBuiltinModule('node:path'); const profileDir = path.normalize(decodeURIComponent(new URL('.', baseUrl).pathname)); const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return null } }; const readText = (p) => { try { return fs.readFileSync(p, 'utf8') } catch (e) { return null } }; const ownModules = path.join(profileDir, 'node_modules'); if (!fs.existsSync(path.join(ownModules, 'dsh-better-sidebar'))) { say('DISABLED', 'dsh-better-sidebar is not resolvable from the profile node_modules'); return true } const manifest = readJson(path.join(profileDir, 'package.json')); const bundles = manifest && manifest.dsh && manifest.dsh.profile && Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []; if (bundles.indexOf('dsh-better-sidebar') >= 0) { say('DISABLED', 'dsh-better-sidebar is itself a declared bundle layer'); return true } for (const bundle of bundles) { const name = String(bundle); for (const dir of [path.join(ownModules, name), path.join(profileDir, '..', 'node_modules', name)]) { const other = readJson(path.join(dir, 'package.json')); const rel = other && other.dsh && other.dsh.bundle ? other.dsh.bundle.patch : undefined; if (typeof rel !== 'string') continue; const text = readText(path.join(dir, rel)); if (text && text.indexOf('dsh-better-sidebar') >= 0 && text.indexOf('mpd-better-sidebar') < 0) { say('DISABLED', 'bundle layer ' + name + ' already mounts it in its own patch'); return true } } } const entries = [...ctx.loader.entries()]; const hasWebEntry = entries.some((e) => e.options && e.options.name === '@deepseek-ai/dsh-host-webserver' && e.options.disabled !== true); const hasWebLayer = bundles.indexOf('@deepseek-ai/dsh-web-app') >= 0; if (!hasWebEntry && !hasWebLayer) { say('DISABLED', 'no web plane in this composition'); return true } say('ENABLED', 'web plane present and no other layer mounts dsh-better-sidebar'); return false } catch (e) { try { console.warn('[mpd-better-sidebar] mount guard: DISABLED - guard threw ' + String(e && e.message ? e.message : e)) } catch (e2) {} return true } })()"

if (process.argv[1] && process.argv[1].endsWith("sidebar-guard.mjs")) {
  const quoted = JSON.stringify(SIDEBAR_GUARD)
  if (quoted.includes("\\")) throw new Error("guard text must not need YAML escapes")
  if (quoted.includes('\n')) throw new Error("guard text must stay one line")
  console.log(quoted)
  console.error("bytes=" + Buffer.byteLength(SIDEBAR_GUARD, "utf8"))
}
