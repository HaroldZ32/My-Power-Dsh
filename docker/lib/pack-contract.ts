// Pack assertion names shared by the reporter and the driver that requires their measurements.

/** Both modes grade the packed artifact against the source bytes carried into the image. */
export const COMMON_PACK_ASSERTIONS = [
  "pack.present", "pack.licenceCoherence", "pack.declarationCoherence", "pack.staticCoherence",
] as const

/** Only source mode rebuilds dist and can measure freshness, compiler identity and the mutation control. */
export const SOURCE_PACK_ASSERTIONS = [
  "pack.distFreshRebuild", "pack.rebuildToolchain", "pack.distFreshRebuildControl",
] as const
