// Isolated-boot probe: runs INSIDE the real harness tree (mounted by an overlay
// row), so the effort value is resolved by the real `llm` service — the same call
// the adopted agent-teams plugin makes for every profile member right before it
// creates the member subagent. Prints machine-readable markers for the boot log.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const libDir = join(ROOT, "packages", "mpd-agent-teams-plugin", "lib")

export const name = "mpd-qa-retier-probe"
export const inject = ["llm"]

export async function apply(ctx) {
  const say = (line) => console.log("[retier-probe] " + line)
  try {
    // 1. The resolved profile, computed by the SHIPPED plugin code from the row
    //    config the loader actually parsed.
    const { Config } = await import(pathToFileURL(join(libDir, "index.js")).href)
    const { resolveTeamProfile } = await import(pathToFileURL(join(libDir, "profiles.js")).href)
    // The row config is handed to the probe through the environment by the driver
    // (ctx.config is not an injectable service — a Cordis proxy throws on it).
    const rowConfig = JSON.parse(readFileSync(process.env.MPD_RETIER_ROW_CONFIG, "utf8"))
    const cfg = Config(rowConfig)
    const profile = resolveTeamProfile(cfg.profiles, "mpd", Number(cfg.maxMembers ?? 16))
    say("PROFILE_MEMBERS=" + profile.members.length)
    for (const m of profile.members) {
      say("MEMBER=" + m.name + " model=" + m.model + " effort=" + String(m.reasoningEffort) + " fallback=" + String(m.fallback?.model))
    }
    // 2. The EXACT call-config resolution the member spawn performs.
    for (const [label, provider, model, effort] of [
      ["member-expro", "deepseek-official", "deepseek-v4-flash", "max"],
      ["member-vision", "deepseek-official", "deepseek-v4-flash-vision-exp", undefined],
    ]) {
      try {
        const resolved = await ctx.llm.resolveCallConfig({ provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
        say("RESOLVE=" + label + " ok provider=" + resolved.provider + " model=" + resolved.model + " effort=" + String(resolved.reasoningEffort))
      } catch (e) {
        say("RESOLVE=" + label + " FAIL " + String(e?.message ?? e))
      }
    }
    // 3. Negative control: the same resolution must REJECT an illegal effort, so
    //    the green lane above cannot be vacuous.
    try {
      await ctx.llm.resolveCallConfig({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "bogus-effort" })
      say("NEGATIVE_CONTROL=accepted (NOT falsifiable)")
    } catch (e) {
      say("NEGATIVE_CONTROL=rejected :: " + String(e?.message ?? e).slice(0, 120))
    }
    say("PROBE_DONE")
  } catch (e) {
    say("PROBE_ERROR=" + String(e?.message ?? e))
  }
}
