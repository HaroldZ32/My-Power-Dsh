import { createRequire } from "node:module";
const r = createRequire("/root/dshProj/my-power-dsh/evidence/rtl-extraction-residual/repair-verify/raw/mount-proof/mpd-package/packages/mpd-agent-teams-plugin/lib/index.js");
try { console.log("RESOLVED " + r.resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json")) } catch (e) { console.log("UNRESOLVED " + e.code) }
