// web-card-catalog/20260918T073000Z — PRE-DOCUMENT MEASUREMENT PROBE.
//
// Installed with CDP `Page.addScriptToEvaluateOnNewDocument` (runs BEFORE any page script), so it
// can observe the harness's client module loader from its first registration.
//
// It answers ONE question with runtime truth: **how does a real client discover the LIVE session
// id that `modelDirectories.directoryFor(id)` accepts?** It therefore:
//   1. records every `window.__ModuleLoader__.load({id, factory})` registration;
//   2. wraps our bundle's `apply(ctx)` / `mountSettingsCard(ctx)` so the EXACT ctx the settings
//      card receives is captured (`window.__MPD_CTX__`);
//   3. wraps `ctx.inject(...)` so the caller-scoped ctx the card's own dynamic injection produces
//      is captured (`window.__MPD_SCOPED__`) — that ctx is the card's real access path;
//   4. exposes `window.__MPD_MEASURE__()`: a full, key-by-key dump of the client `sessions`
//      service reachable from that ctx (own keys, prototype keys, the list snapshot with every
//      key and its typeof, the candidate session ids each of the snapshot's id-bearing fields
//      carries, and — per candidate — whether `scope(id)` and `binding(id)` resolve), plus a live
//      `directoryFor(id)` probe reporting the store status and per-group model counts.
//
// NO app state is written by this file. It is read-only instrumentation.
(() => {
  const probe = {
    installedAt: new Date().toISOString(),
    loaderLoadCalls: [],
    factoryWraps: [],
    applyCalls: [],
    mountCalls: [],
    injectCalls: [],
    notes: [],
    errors: [],
    ctxCaptured: false,
    scopedCaptured: false,
  }
  window.__MPD_PROBE__ = probe
  const note = (text) => { try { probe.notes.push({ at: Date.now(), text: String(text) }) } catch { /* ignore */ } }

  const fmt = (args) => args.map((value) => {
    if (typeof value === "string") return value
    if (value instanceof Error) return value.stack ?? value.message
    try { return JSON.stringify(value) } catch { return String(value) }
  }).join(" ")
  for (const level of ["warn", "error", "info"]) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      try { (probe.console ??= []).push({ level, at: Date.now(), text: fmt(args) }) } catch { /* ignore */ }
      return original(...args)
    }
  }
  window.addEventListener("error", (event) => { try { probe.errors.push({ at: Date.now(), text: "window.error: " + String(event.message) }) } catch { /* ignore */ } })
  window.addEventListener("unhandledrejection", (event) => { try { probe.errors.push({ at: Date.now(), text: "unhandledrejection: " + String(event.reason?.message ?? event.reason) }) } catch { /* ignore */ } })

  // ── the measurement ────────────────────────────────────────────────────────────────────────
  /** Own + prototype key names of one object, without invoking getters. */
  const keyNames = (value) => {
    if (value === null || value === undefined) return []
    const names = new Set(Object.getOwnPropertyNames(value))
    let proto = Object.getPrototypeOf(value)
    let depth = 0
    while (proto !== null && proto !== Object.prototype && depth < 6) {
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name)
      proto = Object.getPrototypeOf(proto)
      depth += 1
    }
    return [...names].sort()
  }

  /** Safe read: never throws, reports the throw inline. */
  const probeCall = (label, fn) => {
    try {
      return { label, ok: true, value: fn() }
    } catch (error) {
      return { label, ok: false, threw: String(error?.message ?? error) }
    }
  }

  /**
   * A describe-only view of one value: typeof, constructor name, and — for plain objects — the
   * enumerable keys with each value's typeof (never JSON.stringify, so cycles and getters are safe).
   */
  const describe = (value, depth = 0) => {
    if (value === null) return { kind: "null" }
    const type = typeof value
    if (type !== "object" && type !== "function") return { kind: type, value: type === "string" ? value : String(value) }
    if (type === "function") return { kind: "function", arity: value.length }
    if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth < 2 ? value.slice(0, 3).map((entry) => describe(entry, depth + 1)) : undefined }
    const out = { kind: "object", ctor: value.constructor?.name ?? null, keys: {} }
    for (const key of Object.keys(value)) {
      const entry = value[key]
      const entryType = entry === null ? "null" : typeof entry
      out.keys[key] = entryType === "object" || entryType === "function" ? describe(entry, depth + 1) : { kind: entryType, value: entryType === "string" ? entry : String(entry) }
    }
    return out
  }

  /** Every session id candidate the list snapshot exposes, by field, so the path is measured. */
  const idCandidates = (snapshot) => {
    const found = []
    const push = (via, id) => { if (typeof id === "string" && id !== "") found.push({ via, id }) }
    if (snapshot === null || snapshot === undefined || typeof snapshot !== "object") return found
    push("snapshot.current", snapshot.current)
    push("snapshot.current.sessionId", snapshot.current?.sessionId)
    push("snapshot.current.id", snapshot.current?.id)
    push("snapshot.currentAddress.sessionId", snapshot.currentAddress?.sessionId)
    push("snapshot.currentAddress.id", snapshot.currentAddress?.id)
    if (Array.isArray(snapshot.ids)) for (const id of snapshot.ids) push("snapshot.ids[]", id)
    if (Array.isArray(snapshot.items)) for (const item of snapshot.items.slice(0, 12)) push("snapshot.items[].sessionId", item?.sessionId)
    if (snapshot.byId !== null && typeof snapshot.byId === "object") for (const key of Object.keys(snapshot.byId).slice(0, 12)) push("snapshot.byId key", key)
    return found
  }

  window.__MPD_MEASURE__ = (directoryProbe = false, depsKey = null) => {
    // A scoped ctx is per-INJECT-CALL, and several of our modules inject concurrently, so
    // `__MPD_SCOPED__` (last-writer-wins) is NOT necessarily the settings card's ctx. The caller
    // names the deps it wants; every captured scoped ctx is kept keyed by its dependency list.
    const byDeps = window.__MPD_SCOPED_BY_DEPS__ ?? {};
    const ctx = depsKey !== null && byDeps[depsKey] !== undefined ? byDeps[depsKey] : (window.__MPD_SCOPED__ ?? window.__MPD_CTX__)
    const out = {
      at: new Date().toISOString(),
      ctxSource: depsKey !== null && byDeps[depsKey] !== undefined ? "inject-scoped for deps " + depsKey : (window.__MPD_SCOPED__ !== undefined ? "inject-scoped (LAST inject to fire)" : (window.__MPD_CTX__ !== undefined ? "module apply ctx" : "none")),
      scopedKeys: Object.keys(byDeps),
      hasCtx: ctx !== undefined && ctx !== null,
    }
    if (!out.hasCtx) return out
    const sessions = probeCall("ctx.get('sessions')", () => (typeof ctx.get === "function" ? ctx.get("sessions") : ctx.sessions))
    out.sessionsResolved = { ok: sessions.ok, threw: sessions.threw, kind: sessions.ok ? (sessions.value === undefined ? "undefined" : typeof sessions.value) : undefined }
    const service = sessions.ok ? sessions.value : undefined
    if (service === undefined || service === null) return out

    out.sessionsKeys = keyNames(service)
    out.sessionsMethodKinds = {}
    for (const key of out.sessionsKeys) {
      try {
        out.sessionsMethodKinds[key] = typeof service[key]
      } catch (error) {
        out.sessionsMethodKinds[key] = "GETTER-THREW: " + String(error?.message ?? error)
      }
    }
    out.listKeys = keyNames(service.list)
    const snapshot = probeCall("sessions.list.getSnapshot()", () => service.list.getSnapshot())
    out.snapshot = snapshot.ok ? describe(snapshot.value) : { threw: snapshot.threw }
    out.snapshotCurrentTypeof = snapshot.ok && snapshot.value !== null && snapshot.value !== undefined ? typeof snapshot.value.current : "NO-SNAPSHOT"
    out.snapshotCurrentRaw = snapshot.ok ? (typeof snapshot.value?.current === "string" ? snapshot.value.current : JSON.stringify(snapshot.value?.current ?? null)) : null
    const candidates = snapshot.ok ? idCandidates(snapshot.value) : []
    out.idCandidates = candidates
    out.candidateResolution = []
    const seen = new Set()
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue
      seen.add(candidate.id)
      const scopeCall = probeCall("sessions.scope(id)", () => (typeof service.scope === "function" ? service.scope(candidate.id) : "NO-scope-method"))
      const bindingCall = probeCall("sessions.binding(id)", () => (typeof service.binding === "function" ? service.binding(candidate.id) : "NO-binding-method"))
      const entry = {
        via: candidate.via,
        id: candidate.id,
        scopeResolved: scopeCall.ok ? scopeCall.value !== undefined && scopeCall.value !== null : false,
        bindingResolved: bindingCall.ok ? bindingCall.value !== undefined && bindingCall.value !== null : false,
        scopeThrew: scopeCall.threw ?? null,
        bindingThrew: bindingCall.threw ?? null,
      }
      if (directoryProbe === true) {
        const directories = ctx.get("modelDirectories")
        if (directories !== undefined && directories !== null && typeof directories.directoryFor === "function") {
          const found = probeCall("directoryFor(id)", () => directories.directoryFor(candidate.id))
          entry.directoryForThrew = found.threw ?? null
          if (found.ok && found.value !== undefined && found.value !== null) {
            const storeSnapshot = probeCall("store.getSnapshot()", () => found.value.store?.getSnapshot())
            const raw = storeSnapshot.ok ? storeSnapshot.value : undefined
            const groups = Array.isArray(raw?.groups) ? raw.groups : (Array.isArray(raw?.value?.groups) ? raw.value.groups : [])
            entry.directory = {
              status: raw?.status ?? null,
              groupCount: groups.length,
              groups: groups.map((group) => ({ id: group?.id ?? null, models: Array.isArray(group?.models) ? group.models.length : null })),
            }
          }
        } else {
          entry.directoryForThrew = "no modelDirectories service on this ctx"
        }
      }
      out.candidateResolution.push(entry)
    }
    return out
  }

  // ── instrument the module loader (captures our bundle's ctx) ────────────────────────────────
  const wrapInject = (ctx, tag) => {
    if (ctx === undefined || ctx === null || typeof ctx.inject !== "function" || ctx.__mpdInjectWrapped === true) return false
    const originalInject = ctx.inject.bind(ctx)
    ctx.inject = (...args) => {
      const dependencies = Array.isArray(args[0]) ? args[0].slice() : args[0]
      const record = { at: Date.now(), tag, dependencies, callbackFired: false }
      probe.injectCalls.push(record)
      const callback = args[1]
      if (typeof callback === "function") {
        args[1] = (scoped) => {
          record.callbackFired = true
          record.firedAt = Date.now()
          // The session-list fact AT THE MOMENT the injection fires: `phase` + how many ids the
          // snapshot already carries. This is what distinguishes "no session because the list has not
          // enumerated yet" from "no session, list ready" — the two cases the console signal must not
          // conflate.
          try {
            const sessions = typeof scoped?.get === "function" ? scoped.get("sessions") : scoped?.sessions
            const snapshot = sessions?.list?.getSnapshot?.()
            record.listPhase = snapshot?.phase ?? null
            record.listIdCount = Array.isArray(snapshot?.ids) ? snapshot.ids.length : null
            record.listCurrentTypeof = typeof snapshot?.current
          } catch (error) {
            record.listProbeError = String(error?.message ?? error)
          }
          window.__MPD_SCOPED__ = scoped
          // Keyed by the exact dependency list: `@mpd-dsh/*` has several concurrent injections and
          // the LAST one to fire is not the one under test.
          const key = JSON.stringify(dependencies)
          ;(window.__MPD_SCOPED_BY_DEPS__ ??= {})[key] = scoped
          record.scopedKey = key
          probe.scopedCaptured = true
          return callback(scoped)
        }
      }
      try {
        return originalInject(...args)
      } catch (error) {
        record.injectThrew = String(error?.message ?? error)
        return undefined
      }
    }
    ctx.__mpdInjectWrapped = true
    return true
  }

  const captureCtx = (ctx, tag) => {
    window.__MPD_CTX__ = ctx
    probe.ctxCaptured = true
    probe.applyCalls.push({ at: Date.now(), tag, hasInject: typeof ctx?.inject === "function", hasGet: typeof ctx?.get === "function" })
    try { wrapInject(ctx, tag) } catch (error) { probe.wrapError = String(error?.message ?? error) }
  }

  const wrapFactory = (registration) => {
    const id = registration !== null && registration !== undefined ? String(registration.id) : "?"
    if (typeof registration?.factory !== "function") return registration
    const originalFactory = registration.factory
    registration.factory = (require) => {
      const exports = originalFactory(require)
      try {
        probe.factoryWraps.push({ at: Date.now(), id })
        if (exports !== null && exports !== undefined && typeof exports.apply === "function" && exports.__mpdApplyWrapped !== true) {
          const originalApply = exports.apply
          exports.apply = (ctx, ...rest) => {
            captureCtx(ctx, id + ".apply")
            return originalApply(ctx, ...rest)
          }
          exports.__mpdApplyWrapped = true
        }
        if (exports !== null && exports !== undefined && typeof exports.mountSettingsCard === "function" && exports.__mpdMountWrapped !== true) {
          const originalMount = exports.mountSettingsCard
          exports.mountSettingsCard = (ctx, ...rest) => {
            probe.mountCalls.push({ at: Date.now(), id })
            captureCtx(ctx, id + ".mountSettingsCard")
            return originalMount(ctx, ...rest)
          }
          exports.__mpdMountWrapped = true
        }
      } catch (error) {
        probe.factoryWrapErrors = (probe.factoryWrapErrors ?? []).concat([{ id, error: String(error?.message ?? error) }])
      }
      return exports
    }
    return registration
  }

  const installLoaderHook = (loader) => {
    if (loader === null || loader === undefined || loader.__mpdLoaderHooked === true) return loader
    let current = typeof loader.load === "function" ? loader.load.bind(loader) : null
    const wrapper = (registration) => {
      try {
        probe.loaderLoadCalls.push({ at: Date.now(), id: registration === null || registration === undefined ? null : String(registration.id) })
        if (registration !== null && registration !== undefined && String(registration.id).startsWith("@mpd-dsh/")) wrapFactory(registration)
      } catch (error) {
        note("load wrapper error: " + String(error?.message ?? error))
      }
      if (current === null) return undefined
      return current(registration)
    }
    try {
      Object.defineProperty(loader, "load", {
        configurable: true,
        get() { return wrapper },
        set(value) { current = typeof value === "function" ? value.bind(loader) : current },
      })
      loader.__mpdLoaderHooked = true
      note("__ModuleLoader__.load hooked (queue|live)")
    } catch (error) {
      probe.loaderHookError = String(error?.message ?? error)
    }
    return loader
  }
  window.__MPD_INSTALL_LOADER_HOOK__ = installLoaderHook

  let capturedLoader
  try {
    Object.defineProperty(window, "__ModuleLoader__", {
      configurable: true,
      get() { return capturedLoader },
      set(value) { capturedLoader = installLoaderHook(value) },
    })
  } catch (error) {
    probe.definePropertyError = String(error?.message ?? error)
  }
})()
