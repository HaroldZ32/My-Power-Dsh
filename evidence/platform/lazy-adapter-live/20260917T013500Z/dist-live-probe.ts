#!/usr/bin/env node
// dist-live-probe.mjs — t40's second, faster arm: the SHIPPED dist bytes (not src) carry the lazy
// behaviour, including the half a mounted boot cannot show.
//
// WHY IT EXISTS: a mounted boot captures the rows' `adapterIdentity` when the service object is
// built, so it can show the FIRST-USE miss but not the later RECOVERY of the same facade. Here the
// vendored cordis drives a real sibling window (provider provides `mpdDsh`, fiber stays non-ACTIVE
// while the consumer's apply runs) and we read the SAME facade again after the provider activates.
//
// Imports resolve to `dist/index.js`, so this is evidence about the artifact the bundle rows load.
import { Context } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.js"

const ADAPTER = "/root/dshProj/my-power-dsh/packages/mpd-dsh-adapter-plugin/dist/index.js"
const adapterDist = await import(ADAPTER)
const out = { adapter: ADAPTER, steps: [] }

const mark = (id, detail) => { out.steps.push({ id, ...detail }); console.log("[" + id + "] " + JSON.stringify(detail)) }

// ── arm 1: registered-but-not-ACTIVE (the transient window) ────────────────────────────────
{
  const root = new Context()
  const warnings = []
  const provider = root.plugin({
    name: "t40-provider",
    apply(inner) { inner.provide("mpdDsh", { marker: "mounted" }) },
  })
  let facade
  let markerDuringApply
  let providerStateDuringApply
  const consumer = root.plugin({
    name: "t40-consumer",
    apply(inner) {
      providerStateDuringApply = provider.state
      facade = adapterDist.createLazyDshAdapter(inner, { label: "t40-probe", warn: (line) => warnings.push(line) })
      markerDuringApply = facade.marker
      out.identityDuringApply = adapterDist.dshAdapterIdentity(inner)
    },
  })
  await consumer
  const identityAfterActivation = adapterDist.dshAdapterIdentity(root)
  mark("pending-window", {
    providerFiberStateDuringApply: providerStateDuringApply === 2 ? "ACTIVE (state 2)" : "not-ACTIVE (state " + providerStateDuringApply + ")",
    markerDuringApply: markerDuringApply === undefined ? "undefined (temporary adapter)" : String(markerDuringApply),
    identityDuringApply: out.identityDuringApply,
    warnings: warnings.length,
    warningIsHonest: warnings.some((line) => line.includes("NOT YET ACTIVE")),
    warningBlamesRowOrder: warnings.some((line) => line.includes("ROW ORDER")),
  })
  mark("recovery-after-activation", {
    providerFiberState: provider.state,
    markerAfterActivation: facade.marker,
    identityAfterActivation,
  })
}

// ── arm 2: provably absent provider keeps the row-order hint (and only that case does) ─────
{
  const root = new Context()
  const warnings = []
  const facade = adapterDist.createLazyDshAdapter(root, { label: "t40-probe-absent", warn: (line) => warnings.push(line) })
  facade.capabilities()
  mark("absent-provider", {
    identity: adapterDist.dshAdapterIdentity(root),
    warningBlamesRowOrder: warnings.some((line) => line.includes("ROW ORDER")),
    warningClaimsNotYetActive: warnings.some((line) => line.includes("NOT YET ACTIVE")),
  })
}

// ── arm 3: the dist really is the new code (no eager idiom left in the shipped bytes) ──────
{
  const { readFileSync } = await import("node:fs")
  const dists = {
    adapter: ADAPTER,
    ext: "/root/dshProj/my-power-dsh/packages/mpd-ext-plugin/dist/index.js",
    roles: "/root/dshProj/my-power-dsh/packages/mpd-roles-plugin/dist/index.js",
  }
  const scan = {}
  for (const [key, file] of Object.entries(dists)) {
    const text = readFileSync(file, "utf8")
    scan[key] = {
      createLazyDshAdapter: (text.match(/createLazyDshAdapter/g) ?? []).length,
      dshAdapterIdentity: (text.match(/dshAdapterIdentity/g) ?? []).length,
      pendingIdentityLiteral: text.includes("pending:provider-not-active"),
      eagerInlineIdiom: (text.match(/\?\?\s*createDshAdapter\(ctx\)/g) ?? []).length,
    }
  }
  mark("shipped-bytes", scan)
}

const ok = out.steps.some((s) => s.id === "pending-window" && s.warningIsHonest === true && s.warningBlamesRowOrder === false)
  && out.steps.some((s) => s.id === "recovery-after-activation" && s.markerAfterActivation === "mounted" && s.identityAfterActivation === "mounted:mpdDsh")
  && out.steps.some((s) => s.id === "absent-provider" && s.warningBlamesRowOrder === true && s.warningClaimsNotYetActive === false)
console.log("[dist-live-probe] ok=" + ok)
process.exit(ok ? 0 : 1)
