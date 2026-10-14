// docker/lib/owed-pack.ts — the apparatus arm that grades the PACKED artifact (§7 item 5).
//
// WHY IT EXISTS. `dist/mpd-package/` is the relocatable release artifact (`node scripts/pack-mpd.ts`),
// and on the developer host two of its claims cannot be settled: `verify-pack-closure.ts` certifies
// COMPLETENESS plus byte identity but says itself that freshness is NOT what its exit code reports
// (AGENTS §4, the T-91 bound), and a licence/declaration check over the packed tree does not exist in
// any host gate (`verify-plugin-manifest.ts --pack` has no licence assertion). This module answers
// both questions with measurements taken INSIDE the container, next to the tree the artifact was cut
// from:
//
//   · pack.licenceCoherence      — the licence carriers the artifact must ship are present, were not
//                                  edited on the way, and the artifact DECLARES the same licence.
//   · pack.declarationCoherence  — everything the artifact declares about itself is true of it: the
//                                  `files` allowlist resolves, its bundle-patch layers exist, and
//                                  every runtime path its own patch names resolves inside it.
//   · pack.staticCoherence       — every file the artifact carries with a twin in the source tree is
//                                  BYTE-IDENTICAL to that twin, with exactly two DECLARED generated
//                                  exceptions. This is the "was it cut from THIS tree" question.
//   · pack.distFreshRebuild      — every built `packages/<pkg>/dist/**` entry in the artifact equals
//                                  the container's OWN from-source rebuild of that entry. That is the
//                                  freshness chain the host gate refuses to certify.
//   · pack.rebuildToolchain      — the rebuild that produced those bytes ran under the SAME bun the
//                                  repository declares (`package.json.buildToolchain`), compared by
//                                  exact version equality against the rebuild's own witness file. A
//                                  byte difference is a toolchain statement until this holds.
//
// The module writes assertion rows straight into the run's NDJSON state (the `live-verdict.ts` and
// `report.ts` shape), so the entrypoint only has to invoke it under `run_step`.
//
// Usage:
//   node docker/lib/owed-pack.ts --artifact <dir> --source <dir> --rebuild <dir> \
//     [--rebuild-report <rebuild.json>] --state <file>
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// ── the two DECLARED generated exceptions ─────────────────────────────────────
// A file the packer GENERATES cannot equal a twin, and pretending otherwise would redden a healthy
// artifact. Both are named here, with the reason, so any OTHER difference is a real finding.
/** The artifact's own manifest: `writeManifest()` regenerates name/version/files/exports by design. */
const GENERATED_MANIFEST: string = "package.json"
/** The ext validator entry: the shipped bundle plus one re-export line (`VALIDATOR_ENTRY`). */
const GENERATED_VALIDATOR: string = join("packages", "mpd-ext-plugin", "dist", "validator.js")
/** The generated paths, as a set for the walk below. */
const GENERATED: ReadonlySet<string> = new Set([GENERATED_MANIFEST, GENERATED_VALIDATOR])

// ── the declaration the artifact must satisfy about ITSELF ────────────────────
/** Root-relative paths a packaged tree may never carry, whatever a caller's `files` says. */
const FORBIDDEN_ROOTS: readonly string[] = ["evidence", ".git", "docker", ".toolchain", ".selftest", ".qa-tmp", "node_modules"]
/** The licence carriers this repository ships in every distribution shape (AGENTS §10). */
const LICENCE_FILES: readonly string[] = ["LICENSE.md", "LICENSE-NOTICES.md"]

/** One assertion row, in the exact shape `docker/lib/report.ts` reads out of the state file. */
interface Row {
  /** Assertion name, e.g. `pack.licenceCoherence`. */
  readonly name: string
  /** Verdict: true pass, false fail, null deliberately not evaluated. */
  readonly ok: boolean | null
  /** Human reason, carrying the measurement that produced the verdict. */
  readonly reason: string
  /** The raw witness: differing paths, counts, resolved roots. */
  readonly raw: string
}

/** The parsed command line of one invocation. */
interface Options {
  /** The packed artifact under test (`<repo>/dist/mpd-package`). */
  readonly artifact: string
  /** The tree the artifact was cut from, for the coherence comparison. */
  readonly source: string
  /** The from-source rebuilt tree, for the freshness comparison. */
  readonly rebuild: string
  /** The rebuild's own witness file (`rebuild.ts --json`), naming the compiler that produced it. */
  readonly rebuildReport: string
  /** The run's `assertions.ndjson` path. */
  readonly state: string
}

/**
 * Parse argv into options, exiting 2 with the usage line when one is missing.
 *
 * @param argv - `process.argv.slice(2)`.
 * @returns The resolved option set.
 */
function parseArgs(argv: readonly string[]): Options {
  /** The option values as parsed, keyed by flag name without the leading dashes. */
  const found = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    /** The token being read; a non-flag ends the pair scan without consuming a value. */
    const flag = argv[index]
    if (!flag.startsWith("--")) continue
    found.set(flag.slice(2), argv[index + 1] ?? "")
    index += 1
  }
  // `rebuild` is OPTIONAL on purpose: a mode that produced no from-source rebuild passes an empty value
  // and the freshness row records `null` with that reason, rather than a green that measures nothing.
  /** The three required flags, so a missing one is named rather than silently empty. */
  const required: readonly string[] = ["artifact", "source", "state"]
  /** The flags this call did not receive. */
  const missing = required.filter((key) => (found.get(key) ?? "") === "")
  if (missing.length > 0) {
    console.error("usage: node docker/lib/owed-pack.ts --artifact <dir> --source <dir> [--rebuild <dir>] [--rebuild-report <json>] --state <ndjson>")
    console.error("[owed-pack] missing: " + missing.join(", "))
    process.exit(2)
  }
  return {
    artifact: found.get("artifact") ?? "",
    source: found.get("source") ?? "",
    rebuild: found.get("rebuild") ?? "",
    rebuildReport: found.get("rebuild-report") ?? "",
    state: found.get("state") ?? "",
  }
}

/**
 * Append one row to the run's assertion state file.
 *
 * @param state - The `assertions.ndjson` path.
 * @param row - The row to record.
 */
function record(state: string, row: Row): void {
  appendFileSync(state, JSON.stringify({ name: row.name, ok: row.ok, reason: row.reason, raw: row.raw.slice(0, 1500) }) + "\n")
  console.log("[owed-pack] " + row.name + "=" + String(row.ok) + " — " + row.reason)
}

/**
 * Every regular file under a directory, as root-relative POSIX paths, sorted.
 *
 * @param root - The directory to walk.
 * @returns The relative paths of the files it holds (empty when the root does not exist).
 */
function walk(root: string): readonly string[] {
  if (!existsSync(root)) return []
  /** The paths collected so far. */
  const out: string[] = []
  /** One directory's entries, pushed onto `pending` so the walk is iterative, not recursive. */
  const pending: string[] = [root]
  while (pending.length > 0) {
    /** The directory this iteration expands; `undefined` only when the stack just emptied. */
    const dir = pending.pop()
    if (dir === undefined) break
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      /** The entry's absolute path, tested for a directory before being queued. */
      const full = join(dir, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join("/"))
    }
  }
  return out.sort()
}

/**
 * The sha256 of a file, or `null` when it cannot be read.
 *
 * @param path - The file to hash.
 * @returns Its lowercase hex digest, or `null`.
 */
function sha256(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  } catch {
    return null
  }
}

/**
 * View an unknown value as a string-keyed bag, so a nested field of a parsed JSON document can be read.
 *
 * @param value - A value produced by `JSON.parse`, or a field of one.
 * @returns The value viewed as a bag, or `undefined` for a primitive (including `null`).
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the witness is parsed JSON, so nothing about its shape is static.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

/**
 * Read a JSON file, or `undefined` when it is absent or not an object.
 *
 * @param path - The file to read.
 * @returns The parsed object viewed as a string-keyed bag.
 */
function readJson(path: string): Record<string, unknown> | undefined {
  try {
    /** The parsed document, still untyped until the object check below. */
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether one `files` allowlist entry resolves to at least one path inside the artifact, supporting
 * the two glob forms the packed manifest actually uses (`**` for any depth, `*` for one segment).
 *
 * @param files - The artifact's relative file list.
 * @param entry - One `files` entry (a literal path, a directory prefix, or a glob).
 * @returns True when the entry is satisfied by the artifact's carried paths.
 */
function allowlistEntryResolves(files: readonly string[], entry: string): boolean {
  if (!entry.includes("*")) {
    // A literal entry is satisfied by the file itself or by a directory carrying anything under it.
    return files.some((file) => file === entry || file.startsWith(entry.replace(/\/+$/, "") + "/"))
  }
  /** The entry as a regular expression, escaping everything that is not one of the two glob tokens. */
  const pattern = new RegExp(
    "^" + entry
      .split("**")
      .map((chunk) => chunk.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
      .join(".*")
      .replace(/\/+$/, "") + "(/.*)?$",
  )
  return files.some((file) => pattern.test(file))
}

/**
 * Grade the licence carriers: present in the artifact, byte-identical to the source tree's copies,
 * and declared by the artifact's own manifest with the same value the source manifest declares.
 *
 * @param options - The resolved paths.
 * @param files - The artifact's relative file list.
 */
function licenceCoherence(options: Options, files: readonly string[]): void {
  /** Licence files the artifact does not carry at all. */
  const absent = LICENCE_FILES.filter((name) => !files.includes(name))
  /** Licence files whose bytes differ from the source tree's copy. */
  const drifted = LICENCE_FILES.filter((name) => {
    if (absent.includes(name)) return false
    /** The artifact's copy digest and its twin's, compared so a byte edit cannot pass unnoticed. */
    const [packed, twin] = [sha256(join(options.artifact, name)), sha256(join(options.source, name))]
    return packed === null || twin === null || packed !== twin
  })
  /** The licence each manifest declares, read from the artifact and from the tree it was cut from. */
  const packedLicence = String(readJson(join(options.artifact, GENERATED_MANIFEST))?.license ?? "")
  /** The licence the tree the artifact was cut from declares, so a silent relicensing reddens. */
  const sourceLicence = String(readJson(join(options.source, GENERATED_MANIFEST))?.license ?? "")
  /** True when every carrier survived the pack AND the declared licence still matches the source. */
  const ok = absent.length === 0 && drifted.length === 0 && packedLicence !== "" && packedLicence === sourceLicence
  record(options.state, {
    name: "pack.licenceCoherence",
    ok,
    reason: ok
      ? "the packed artifact carries " + LICENCE_FILES.join(" + ") + " byte-identical to the tree it was cut from, and declares license=" + packedLicence + " as the source manifest does"
      : "the packed artifact's licence surface does not cohere: absent=" + (absent.join(",") || "none") + " drifted=" + (drifted.join(",") || "none") + " artifactLicense=" + (packedLicence || "<none>") + " sourceLicense=" + (sourceLicence || "<none>"),
    raw: "carried=" + LICENCE_FILES.filter((name) => files.includes(name)).join(",") + " artifactLicense=" + packedLicence + " sourceLicense=" + sourceLicence,
  })
}

/**
 * Grade what the artifact DECLARES about itself: the `files` allowlist resolves, the declared bundle
 * patch layers are present, every runtime module path the artifact's own patch names resolves inside
 * it, and no forbidden host tree travelled along.
 *
 * @param options - The resolved paths.
 * @param files - The artifact's relative file list.
 */
function declarationCoherence(options: Options, files: readonly string[]): void {
  /** The artifact's own manifest. */
  const manifest = readJson(join(options.artifact, GENERATED_MANIFEST))
  /** The declared `files` allowlist, or an empty list when the manifest carries none. */
  const declared = Array.isArray(manifest?.files) ? (manifest?.files as unknown[]).filter((entry): entry is string => typeof entry === "string") : []
  /** Allowlist entries that resolve to nothing inside the artifact. */
  const unresolved = declared.filter((entry) => !allowlistEntryResolves(files, entry))
  /** The declared bundle-patch layers that are absent from the artifact. */
  const patches = (() => {
    /** The `dsh.bundle.patch` array as declared. */
    const bag = manifest?.dsh !== null && typeof manifest?.dsh === "object" ? (manifest?.dsh as Record<string, unknown>) : undefined
    /** The patch array, only when it is really an array of strings. */
    const list = bag?.bundle !== null && typeof bag?.bundle === "object" ? (bag?.bundle as Record<string, unknown>)?.patch : undefined
    return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.replace(/^\.\//, "")) : []
  })()
  /** Patch layers the manifest declares but the artifact does not carry. */
  const missingPatches = patches.filter((name) => !files.includes(name))
  /** The row module paths the artifact's own host patch names, read out of its YAML text. */
  const rowPaths = (() => {
    try {
      /** The patch text as carried in the artifact. */
      const text = readFileSync(join(options.artifact, "cordis.patch.yml"), "utf8")
      return [...text.matchAll(/packages\/([a-z0-9-]+)\/(?:dist\/[A-Za-z0-9._/-]+\.js|launch\.mjs)/g)].map((match) => "packages/" + match[1] + "/" + match[0].split("/").slice(2).join("/"))
    } catch {
      return []
    }
  })()
  /** Row paths the patch names but the artifact does not carry — a user's mount would break here. */
  const missingRows = [...new Set(rowPaths)].filter((path) => !files.includes(path))
  /** Forbidden host trees that travelled into the artifact. */
  const forbidden = FORBIDDEN_ROOTS.filter((root) => files.some((file) => file === root || file.startsWith(root + "/")))
  /** True when every declaration about the artifact is true of the artifact. */
  const ok = declared.length > 0 && patches.length > 0 && unresolved.length === 0 && missingPatches.length === 0 && missingRows.length === 0 && forbidden.length === 0
  record(options.state, {
    name: "pack.declarationCoherence",
    ok,
    reason: ok
      ? "every declaration the artifact makes about itself holds: " + declared.length + " files entries resolve, its " + patches.length + " bundle-patch layers exist, all " + new Set(rowPaths).size + " row module paths its own patch names resolve inside it, and no host tree (evidence/.git/docker/.toolchain/node_modules) travelled along"
      : "a declaration the artifact makes about itself is false: filesEntries=" + declared.length + " unresolved=" + (unresolved.join(",") || "none") + " missingPatches=" + (missingPatches.join(",") || "none") + " missingRowPaths=" + (missingRows.slice(0, 6).join(",") || "none") + " forbiddenRoots=" + (forbidden.join(",") || "none"),
    raw: "rowPathsChecked=" + new Set(rowPaths).size + " files=" + files.length,
  })
}

/**
 * Grade the artifact against the TREE it was cut from: every carried file with a twin must be
 * byte-identical to it, with exactly the two generated paths exempted.
 *
 * @param options - The resolved paths.
 * @param files - The artifact's relative file list.
 */
function staticCoherence(options: Options, files: readonly string[]): void {
  /** Carried files whose twin differs, excluding the generated pair. */
  const drifted: string[] = []
  /** Carried files with no twin in the source tree at all, excluding the generated pair. */
  const untwinned: string[] = []
  /** Carried files that matched their twin byte for byte. */
  let identical = 0
  /** Carried files skipped because the packer generates them. */
  let generated = 0
  for (const file of files) {
    if (GENERATED.has(file)) {
      generated += 1
      continue
    }
    /** The source tree's copy of this artifact file, when there is one. */
    const twin = join(options.source, file)
    if (!existsSync(twin)) {
      untwinned.push(file)
      continue
    }
    if (sha256(join(options.artifact, file)) === sha256(twin)) identical += 1
    else drifted.push(file)
  }
  /** True when the artifact agrees with the tree it was cut from, generated paths aside. */
  const ok = untwinned.length === 0 && drifted.length === 0
  record(options.state, {
    name: "pack.staticCoherence",
    ok,
    reason: ok
      ? "the artifact agrees with the tree it was cut from: " + identical + " carried file(s) byte-identical, " + generated + " generated path(s) exempted (" + [...GENERATED].join(", ") + "), none missing"
      : "the artifact does NOT agree with the tree it was cut from — it is stale or was edited after the pack: " + drifted.length + " differing file(s), " + untwinned.length + " carried file(s) with no twin",
    raw: "drifted=" + (drifted.slice(0, 12).join(",") || "none") + " untwinned=" + (untwinned.slice(0, 6).join(",") || "none"),
  })
}

/**
 * Grade the artifact's built entries against the container's OWN from-source rebuild of the same
 * entries — the freshness chain a host gate documents that it cannot certify.
 *
 * @param options - The resolved paths.
 * @param files - The artifact's relative file list.
 */
function distFreshRebuild(options: Options, files: readonly string[]): void {
  // NO REBUILD GIVEN = NO MEASUREMENT, and the row says so instead of comparing the artifact with a
  // tree that still carries the committed dist (which would be a second `staticCoherence` wearing this
  // row's name). The one-click service runs no `bun install` and no from-source rebuild by design, so
  // the entrypoint passes an empty `--rebuild` there and the source lane carries the real measurement.
  if (options.rebuild === "" || !existsSync(options.rebuild)) {
    record(options.state, {
      name: "pack.distFreshRebuild",
      ok: null,
      reason: "not measured in this mode: no from-source rebuild of the tree was produced here, so there is nothing to compare the artifact against. A comparison against an un-rebuilt copy would be a second byte-coherence check wearing freshness's name — the source lane carries this measurement",
      raw: "rebuild=" + (options.rebuild === "" ? "<none passed>" : options.rebuild),
    })
    // The toolchain row shares this subject: with no rebuild there is no compiler to name, and a green
    // "the toolchain matched" here would be a claim about a build that never ran.
    record(options.state, {
      name: "pack.rebuildToolchain",
      ok: null,
      reason: "not measured in this mode: no from-source rebuild was produced, so no compiler produced the bytes this row would match against the artifact's declared buildToolchain",
      raw: "rebuild=" + (options.rebuild === "" ? "<none passed>" : options.rebuild),
    })
    return
  }
  /** The artifact's built entries, by the shape every plugin/MCP package ships. */
  const built = files.filter((file) => file.startsWith("packages/") && file.includes("/dist/") && !GENERATED.has(file))
  /** Built entries that differ from the container's rebuild of the same path. */
  const drifted = built.filter((file) => sha256(join(options.artifact, file)) !== sha256(join(options.rebuild, file)))
  /** Built entries the container's rebuild did not produce — the rebuild never covered them. */
  const uncovered = built.filter((file) => !existsSync(join(options.rebuild, file)))
  // THE TOOLCHAIN IS READ FROM THE REBUILD'S OWN WITNESS, and that is a MEASURED correction rather than
  // a preference (2026-10-09). The first version of this arm asked `bun --version` on THIS machine's
  // PATH and matched it against the declared pin with `declaredPin.includes(containerBun)`. Both halves
  // were wrong in the same direction: the PATH bun need not be the binary `rebuild.ts` invoked (the
  // entrypoint now selects it explicitly), and a substring test makes "1.4" match "bun@1.4.0" while a
  // two-part version reads as a match. The witness is now the rebuild's own `--json` payload — the bin
  // it selected and the version THAT binary printed — and the comparison is exact string equality.
  /** The rebuild's own witness: `{ bun: { bin, version } }`, as `docker/lib/rebuild.ts` wrote it. */
  const witness = readJson(options.rebuildReport)
  /** The compiler binary the rebuild used, or empty when the witness never arrived. */
  const rebuildBunBin = typeof asRecord(witness?.bun)?.bin === "string" ? String(asRecord(witness?.bun)?.bin) : ""
  /** The version that compiler reported — the measured half of the comparison below. */
  const rebuildBunVersion = typeof asRecord(witness?.bun)?.version === "string" ? String(asRecord(witness?.bun)?.version) : ""
  /** The bun the repository DECLARES for its canonical build (`package.json.buildToolchain`). */
  const declaredPin = String(readJson(join(options.source, GENERATED_MANIFEST))?.buildToolchain ?? "<none>")
  /** The version half of that declaration, or `null` when the record is absent or not a `name@version`. */
  const declaredVersion = /^bun@(.+)$/.exec(declaredPin)?.[1] ?? null
  /** True when the compiler that produced the rebuild IS the declared one, by exact version equality. */
  const exactMatch = declaredVersion !== null && rebuildBunVersion !== "" && rebuildBunVersion === declaredVersion
  /** Where the compiler witness came from, so a reader can tell a measured version from a missing one. */
  const witnessSource = options.rebuildReport === ""
    ? "<no --rebuild-report passed>"
    : (existsSync(options.rebuildReport) ? options.rebuildReport : "<missing: " + options.rebuildReport + ">")
  /** The toolchain witness, carried in the raw field of both rows below. */
  const note = " rebuildBun=" + (rebuildBunBin || "<unreadable>") + " rebuildBunVersion=" + (rebuildBunVersion || "<unreadable>") +
    " declaredBuildToolchain=" + declaredPin + " declaredVersion=" + (declaredVersion ?? "<unparsed>") +
    " exactMatch=" + String(exactMatch) + " witness=" + witnessSource
  record(options.state, {
    name: "pack.rebuildToolchain",
    ok: exactMatch,
    reason: exactMatch
      ? "the from-source rebuild ran under bun " + rebuildBunVersion + ", which IS the version the repository declares for its canonical build (" + declaredPin + "), so a byte difference from this rebuild can be read as staleness rather than as a compiler difference"
      : "the from-source rebuild did NOT run under the declared build toolchain: the rebuild's own witness names bun " + (rebuildBunVersion || "<unreadable>") + " at " + (rebuildBunBin || "<unreadable>") + " while " + (options.source === "" ? "the tree" : GENERATED_MANIFEST) + " declares " + declaredPin + " (witness: " + witnessSource + "). A bun MINOR rewrites the emitted helper preamble (AGENTS §6 T16), so `pack.distFreshRebuild` cannot attribute a byte difference to the artifact while this holds",
    raw: note,
  })
  if (built.length === 0) {
    record(options.state, {
      name: "pack.distFreshRebuild",
      ok: false,
      reason: "the artifact carries no built package entry, so nothing could be compared against a from-source rebuild",
      raw: "builtEntries=0" + note,
    })
    return
  }
  /** True when every built entry equals the rebuild AND the rebuild produced all of them. */
  const ok = drifted.length === 0 && uncovered.length === 0
  record(options.state, {
    name: "pack.distFreshRebuild",
    ok,
    reason: ok
      ? "every one of the " + built.length + " built entries in the artifact is byte-identical to the container's own from-source rebuild — the packed dist is FRESH, not merely present"
      : "the packed artifact's built entries do not match this container's from-source rebuild: " + drifted.length + " differing, " + uncovered.length + " not produced by the rebuild." + (exactMatch
        ? " Both the artifact and this rebuild are under bun " + rebuildBunVersion + " (the declared " + declaredPin + ", see pack.rebuildToolchain), so the difference is NOT explained by the compiler version"
        : " READ THIS WITH `pack.rebuildToolchain`, which is FALSE here: this machine rebuilt with bun " + (rebuildBunVersion || "<unreadable>") + " while the artifact declares " + declaredPin + ", and a bun minor changes the emitted bytes by itself (AGENTS §6 T16) — so a difference here is a TOOLCHAIN measurement first. The staleness question itself is `pack.staticCoherence`, which compares the artifact with the tree it was cut from"),
    raw: "drifted=" + (drifted.slice(0, 12).join(",") || "none") + " uncovered=" + (uncovered.slice(0, 6).join(",") || "none") + note,
  })
}

/**
 * The module entry point: grade the artifact and append one row per question to the state file.
 */
function main(): void {
  /** The resolved invocation. */
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.artifact)) {
    // A MISSING artifact is a FAIL, never a skip, and every owed row is recorded so the report cannot
    // read "not reached" (which a reader could mistake for an unnoticed gap): §7 item 5 owes this
    // measurement, and "the deliverable was not built" is a statement about the wave, not about this
    // machine.
    /** The one reason every row of this arm shares when the artifact never arrived. */
    const reason = "the packed artifact is not carried into this run at " + options.artifact + " — run `node scripts/pack-mpd.ts` before the acceptance lane, because §7 item 5 owes its coherence and freshness"
    for (const name of ["pack.present", "pack.licenceCoherence", "pack.declarationCoherence", "pack.staticCoherence", "pack.distFreshRebuild", "pack.rebuildToolchain"]) {
      record(options.state, { name, ok: false, reason, raw: "artifact=" + options.artifact })
    }
    return
  }
  record(options.state, {
    name: "pack.present",
    ok: true,
    reason: "the packed artifact travelled into the container and is graded below",
    raw: "artifact=" + options.artifact,
  })
  /** Every file the artifact carries. */
  const files = walk(options.artifact)
  // The carried BYTE total, summed per file: a directory's own `size` is a stat artifact, not a weight.
  /** The sum of the carried files' sizes, for the log line a reader uses to sanity-check the artifact. */
  let bytes = 0
  for (const file of files) {
    try { bytes += statSync(join(options.artifact, file)).size } catch { /* an unreadable file is reported by the rows below, not here */ }
  }
  console.log("[owed-pack] artifact files=" + files.length + " bytes=" + bytes)
  licenceCoherence(options, files)
  declarationCoherence(options, files)
  staticCoherence(options, files)
  distFreshRebuild(options, files)
}

main()
