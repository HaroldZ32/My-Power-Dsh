// Container-side probe: why is `mpd-config` not in `settings.describe()`? Distinguish the three
// possible reasons — not in the editor's configuration(), no schema on the fiber runtime, or no
// volatile node in that schema.

/** The cordis plugin name this probe registers under inside the booted profile. */
export const name: string = "mpd-settings-probe"
/** The single service the probe reads; injected so the scoped ctx may touch `settings`. */
export const inject: readonly string[] = ["settings"]

/** One row of the editor's `configuration()` list, narrowed to the members this probe reads. */
interface SettingsRow {
  /** The loader entry this settings row belongs to. */
  entry?: {
    /** The row id the configuration is keyed by. */
    id?: unknown
    /** The mounted fiber, where a row's `Config` schema lives once the row activated. */
    fiber?: { runtime?: { Config?: ConfigSchema }; state?: unknown }
    /** The row's own options, including the config object it was created with. */
    options?: { id?: unknown; config?: unknown }
  }
}

/** The subset of a schemastery `Config` schema this probe inspects. */
interface ConfigSchema {
  /** Schema metadata; `meta.volatile` decides whether the settings card can edit the row. */
  meta?: { volatile?: unknown }
  /** The serializer, whose presence is part of the identity check below. */
  toJSON?: unknown
}

/** One `settings.describe()` descriptor, narrowed to the members this probe reads. */
interface SettingsDescriptor {
  /** The namespace the descriptor describes. */
  ns?: unknown
  /** The effective value. */
  value?: unknown
  /** The inherited value (used when the namespace carries no explicit one). */
  inherited?: unknown
  /** The per-field metadata of the namespace, keyed by field name. */
  fields?: Record<string, unknown>
}

/** The `settings` service as this probe reads it. */
interface SettingsService {
  /** The owning context, where the config editor lives. */
  ownerContext?: { configEditor?: { configuration?: () => readonly SettingsRow[] } }
  /**
   * The public descriptor list. Declared REQUIRED on purpose: the probe calls it unguarded, so a
   * service without it must throw into the outer catch exactly as the original expression did.
   */
  describe: () => readonly SettingsDescriptor[] | undefined
}

/** The ctx handed to `apply`, narrowed to the seam this probe reads. */
interface ProbeContext {
  /**
   * Cordis service lookup. Declared REQUIRED on purpose: the probe calls it unguarded (the ctx of a
   * loaded row always exposes it), and a missing seam must throw into the caller's own catch.
   */
  get: (name: string) => unknown
}

/**
 * View an unknown value as a string-keyed bag, so a service read out of the registry can be walked.
 *
 * @param value - The value returned by `ctx.get(...)`.
 * @returns The value viewed as a bag, or `undefined` for a primitive (including `null`).
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the service arrives from the harness registry as `unknown`.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

/**
 * The built plugin's file URL inside the container. Kept in a constant because the specifier is an
 * absolute path that exists only in the image, so it must not be resolved at typecheck time.
 */
const MODULE_URL: string = "file:///src/packages/mpd-config-plugin/dist/index.js"

/**
 * The probe's plain message extractor, matching `String(error?.message ?? error)` exactly. It is
 * the one used by the two inner catches, which deliberately report the short message and not a stack.
 *
 * @param error - The caught value (typed `unknown` because a `catch` binding has no static shape).
 * @returns The message text the probe prints.
 */
function messageOf(error: unknown): string {
  if (error !== null && typeof error === "object") {
    // A cast is used because `message` is read off a value with no static shape.
    const message = (error as { message?: unknown }).message
    if (message !== undefined) return String(message)
  }
  return String(error)
}

/**
 * The probe's DETAIL extractor for the outer catch, matching
 * `String(error?.stack ?? error?.message ?? error)` exactly (the stack is preferred there, so a
 * thrown schema error is reported with its origin).
 *
 * @param error - The caught value (typed `unknown` because a `catch` binding has no static shape).
 * @returns The stack text, the message text, or the stringified value.
 */
function detailOf(error: unknown): string {
  if (error !== null && typeof error === "object") {
    // A cast is used because the two keys are read from a value with no static shape.
    const shaped = error as { stack?: unknown; message?: unknown }
    if (shaped.stack !== undefined) return String(shaped.stack)
    if (shaped.message !== undefined) return String(shaped.message)
  }
  return String(error)
}

/**
 * Load the container's own built `mpd-config` plugin and compare its `Config` export with the one
 * the live fiber holds — the identity check that distinguishes a duplicate module from a bug.
 *
 * @param ctx - The booted profile's ctx.
 */
export function apply(ctx: ProbeContext): void {
  /** The `Config` schema a row's fiber runtime carries, or `undefined` when the row never activated. */
  const runtimeOf = (row: SettingsRow | undefined): ConfigSchema | undefined => row?.entry?.fiber?.runtime?.Config
  setTimeout(async () => {
    try {
      // The live settings service. The lookup is UNGUARDED on purpose: the row declares `settings`
      // as an injected service, so a missing one must throw into the catch below exactly as before.
      const settings = ctx.get("settings") as SettingsService
      // The config editor on the owning context; `configuration()` lists every editable row.
      const editor = settings.ownerContext?.configEditor
      // The editor's row list, or an empty list when the editor cannot enumerate.
      const configuration: readonly SettingsRow[] = typeof editor?.configuration === "function" ? editor.configuration() : []
      // Every row id the editor knows about, in editor order.
      const ids = configuration.map((row) => row?.entry?.id)
      // The row ids that mention `mpd`, which is what the settings card is expected to contribute.
      const mpdIds = ids.filter((id) => typeof id === "string" && id.toLowerCase().includes("mpd"))
      console.log("[settings-probe] configuration=" + configuration.length + " mpdRows=" + mpdIds.slice(0, 8).join(",") + " sample=" + ids.slice(0, 6).join(","))
      // The `mpd-config` row itself, matched by the id suffix the bundle's row declares.
      const mine = configuration.find((row) => String(row?.entry?.id ?? "").endsWith("mpd-config"))
      console.log("[settings-probe] mpd-config in configuration: " + (mine === undefined ? "NO" : "YES"))
      if (mine !== undefined) {
        // The row's live fiber runtime, where the loaded plugin's `Config` export is attached.
        const runtime = mine.entry?.fiber?.runtime
        // The schema the fiber carries; ABSENT means the row never activated.
        const schema = runtime?.Config
        console.log("[settings-probe] runtime.Config: " + (schema === undefined ? "ABSENT" : "present, meta.volatile=" + String(schema.meta?.volatile) + " toJSON=" + String(typeof schema.toJSON)))
        console.log("[settings-probe] fiber state: " + String(mine.entry?.fiber?.state))
        console.log("[settings-probe] entry.id=" + String(mine.entry?.id) + " options.id=" + String(mine.entry?.options?.id))
        // The descriptor the PUBLIC describe() surface publishes for this namespace, if any.
        const descriptor = (settings.describe() ?? []).find((row) => String(row?.ns ?? "").includes("mpd-config"))
        console.log("[settings-probe] descriptor keys=" + (descriptor === undefined ? "none" : Object.keys(descriptor).join(",")))
        if (descriptor !== undefined) {
          console.log("[settings-probe] descriptor value=" + JSON.stringify(descriptor.value ?? descriptor.inherited ?? null).slice(0, 220))
          console.log("[settings-probe] descriptor fields=" + JSON.stringify(Object.keys(descriptor.fields ?? {})).slice(0, 220))
        }
        console.log("[settings-probe] options.config=" + JSON.stringify(mine.entry?.options?.config ?? null).slice(0, 160))
        try {
          // The full descriptor list, filtered here rather than trusting the find() above.
          const direct = settings.describe() ?? []
          console.log("[settings-probe] describe ns values=" + direct.filter((r) => String(r?.ns ?? "").includes("mpd")).map((r) => r.ns).join(","))
        } catch (error) { console.log("[settings-probe] describe filter failed: " + messageOf(error).slice(0, 120)) }
      }
      try {
        // The built plugin, imported by ABSOLUTE container path so it is the artifact the app loads.
        const mod = asRecord(await import(MODULE_URL))
        console.log("[settings-probe] identity: runtime.Config === module.Config ? " + String(runtimeOf(mine) === mod?.Config) + " | module meta.volatile=" + String((mod?.Config as ConfigSchema | undefined)?.meta?.volatile) + " | module apply.Config===Config: " + String(asRecord(mod?.apply)?.Config === mod?.Config))
      } catch (error) {
        console.log("[settings-probe] import compare failed: " + messageOf(error).slice(0, 160))
      }
      // The recorder's own view of the same list, for the report's `describe=` line.
      const described = settings.describe()
      console.log("[settings-probe] describe=" + (Array.isArray(described) ? described.length : "n/a") + " has=" + (Array.isArray(described) && described.some((row) => row?.ns === "mpd-config")))
    } catch (error) {
      console.log("[settings-probe] failed: " + detailOf(error).slice(0, 300))
    }
    process.exit(0)
  }, 1500)
}
