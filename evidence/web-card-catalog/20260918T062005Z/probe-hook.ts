// web-card-catalog lane — PRE-DOCUMENT PROBE (installed with CDP
// `Page.addScriptToEvaluateOnNewDocument`, so it runs BEFORE any page script).
//
// It answers MEASUREMENT E on the REAL client runtime, without touching the served bytes:
//   1. every `window.__ModuleLoader__.load({id, factory})` registration is recorded, so the mpd
//      bundles' arrival is provable;
//   2. the `@mpd-dsh/mpd` entry's `apply(ctx)` and the settings card's `mountSettingsCard(ctx)` are
//      wrapped, so the EXACT ctx the card uses is captured;
//   3. `ctx.inject` on that ctx is wrapped: every call records its dependency list, whether its
//      callback EVER fires, and what the callback's scoped ctx resolves for
//      `modelDirectories`/`sessions` plus the bound session id and the directory snapshot;
//   4. a MutationObserver watches the card's `[data-mpd-catalog-state]` paragraph and records every
//      DISTINCT state it takes, i.e. whether a later catalog update reaches the card's render.
//
// The loader facade is taken over by assignment (`target.load = …` in the client-modules system),
// so `load` is redefined as an ACCESSOR: the setter keeps the newest implementation and the getter
// always returns the inspecting wrapper.
(() => {
  const probe = {
    installedAt: new Date().toISOString(),
    loaderLoadCalls: [],
    factoryWraps: [],
    applyCalls: [],
    mountCalls: [],
    injectCalls: [],
    cardStates: [],
    directoryLoads: [],
    warnings: [],
    errors: [],
    notes: [],
    ctxCaptured: false,
    injectWrapped: false,
    observerInstalled: false,
  }
  window.__MPD_PROBE__ = probe
  const note = (text) => { try { probe.notes.push({ at: Date.now(), text: String(text) }) } catch { /* ignore */ } }

  // ── console capture (verbatim, in call order) ───────────────────────────────────────────────
  const fmt = (args) => args.map((value) => {
    if (typeof value === "string") return value
    if (value instanceof Error) return value.stack ?? value.message
    try { return JSON.stringify(value) } catch { return String(value) }
  }).join(" ")
  for (const level of ["warn", "error"]) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      try { probe[level === "warn" ? "warnings" : "errors"].push({ at: Date.now(), text: fmt(args) }) } catch { /* ignore */ }
      return original(...args)
    }
  }
  window.addEventListener("error", (event) => { try { probe.errors.push({ at: Date.now(), text: "window.error: " + String(event.message) }) } catch { /* ignore */ } })
  window.addEventListener("unhandledrejection", (event) => { try { probe.errors.push({ at: Date.now(), text: "unhandledrejection: " + String(event.reason && event.reason.message ? event.reason.message : event.reason) }) } catch { /* ignore */ } })

  // ── the card's rendered state ───────────────────────────────────────────────────────────────
  const readCard = () => {
    const node = document.querySelector("[data-mpd-catalog-state]")
    if (node === null || node === undefined) return null
    return {
      at: Date.now(),
      state: node.getAttribute("data-mpd-catalog-state"),
      providers: node.getAttribute("data-mpd-catalog-providers"),
      models: node.getAttribute("data-mpd-catalog-models"),
      text: (node.textContent ?? "").trim(),
    }
  }
  probe.readCard = readCard

  let lastCardKey = null
  const sampleCard = (why) => {
    const now = readCard()
    if (now === null) return
    const key = JSON.stringify([now.state, now.providers, now.models, now.text])
    if (key === lastCardKey) return
    lastCardKey = key
    probe.cardStates.push({ ...now, why })
  }
  window.__MPD_SAMPLE_CARD__ = sampleCard

  const installObserver = () => {
    if (probe.observerInstalled) return true
    if (document.documentElement === null) return false
    const observer = new MutationObserver(() => { try { sampleCard("mutation") } catch { /* ignore */ } })
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["data-mpd-catalog-state", "data-mpd-catalog-providers", "data-mpd-catalog-models"],
    })
    probe.observerInstalled = true
    return true
  }
  window.__MPD_INSTALL_OBSERVER__ = installObserver
  if (document.documentElement !== null) installObserver()
  else document.addEventListener("DOMContentLoaded", installObserver, { once: true })

  // ── ctx.inject instrumentation ──────────────────────────────────────────────────────────────
  const summariseScoped = (scoped) => {
    const out = { hasGet: typeof scoped?.get === "function" }
    try {
      const dirs = typeof scoped?.get === "function" ? scoped.get("modelDirectories") : scoped?.modelDirectories
      out.modelDirectories = dirs === undefined ? "undefined" : (dirs === null ? "null" : typeof dirs)
      out.directoryFor = typeof dirs?.directoryFor
      out.hasStore = dirs !== undefined && dirs !== null && typeof dirs.directoryFor === "function"
      const sessions = typeof scoped?.get === "function" ? scoped.get("sessions") : scoped?.sessions
      out.sessions = sessions === undefined ? "undefined" : (sessions === null ? "null" : typeof sessions)
      const snapshot = sessions?.list?.getSnapshot?.()
      out.currentSession = snapshot?.current?.sessionId ?? snapshot?.current?.id ?? null
      out.sessionCount = Array.isArray(snapshot?.sessions) ? snapshot.sessions.length : (Array.isArray(snapshot?.items) ? snapshot.items.length : null)
      if (out.hasStore && out.currentSession !== null && out.currentSession !== undefined) {
        try {
          const directory = dirs.directoryFor(out.currentSession)
          out.directoryFound = directory !== undefined && directory !== null
          const storeSnapshot = directory?.store?.getSnapshot?.()
          const groups = storeSnapshot?.value?.groups ?? storeSnapshot?.groups ?? []
          out.directorySnapshot = {
            status: storeSnapshot?.status ?? null,
            groupCount: Array.isArray(groups) ? groups.length : null,
            groups: Array.isArray(groups) ? groups.map((group) => ({ id: group?.id ?? null, models: Array.isArray(group?.models) ? group.models.length : null })) : [],
          }
        } catch (error) {
          out.directoryForThrew = String(error?.message ?? error)
        }
      }
    } catch (error) {
      out.error = String(error?.message ?? error)
    }
    return out
  }
  window.__MPD_SUMMARISE_SCOPED__ = summariseScoped

  const wrapInject = (ctx, tag) => {
    if (ctx === undefined || ctx === null || typeof ctx.inject !== "function" || ctx.__mpdInjectWrapped === true) return false
    const originalInject = ctx.inject.bind(ctx)
    ctx.inject = (...args) => {
      const dependencies = Array.isArray(args[0]) ? args[0].slice() : args[0]
      const record = { at: Date.now(), tag, dependencies, callbackFired: false, scoped: null, returnedFiber: null }
      probe.injectCalls.push(record)
      const callback = args[1]
      if (typeof callback === "function") {
        args[1] = (scoped) => {
          record.callbackFired = true
          record.firedAt = Date.now()
          record.scoped = summariseScoped(scoped)
          window.__MPD_SCOPED__ = scoped
          // The load() the card itself performs: a second, INDEPENDENT load proves the service is
          // functional, and the store snapshot after it says whether the catalog really arrives.
          const directories = scoped && typeof scoped.get === "function" ? scoped.get("modelDirectories") : undefined
          const sessionId = record.scoped?.currentSession
          if (directories !== undefined && directories !== null && typeof directories.directoryFor === "function" && sessionId !== null && sessionId !== undefined) {
            try {
              const directory = directories.directoryFor(sessionId)
              const entry = { at: Date.now(), sessionId, source: "probe" }
              probe.directoryLoads.push(entry)
              Promise.resolve(directory.load()).then(() => {
                const storeSnapshot = directory.store?.getSnapshot?.()
                const groups = storeSnapshot?.value?.groups ?? storeSnapshot?.groups ?? []
                entry.afterLoad = { status: storeSnapshot?.status ?? null, groupCount: Array.isArray(groups) ? groups.length : null, groups: Array.isArray(groups) ? groups.map((group) => ({ id: group?.id ?? null, models: Array.isArray(group?.models) ? group.models.length : null })) : [] }
                sampleCard("after-probe-load")
              }, (error) => { entry.loadError = String(error?.message ?? error) })
            } catch (error) {
              record.probeDirectoryThrew = String(error?.message ?? error)
            }
          }
          sampleCard("inject-callback")
          return callback(scoped)
        }
      }
      try {
        record.returnedFiber = typeof originalInject(...args) === "object" ? "object" : "other"
      } catch (error) {
        record.injectThrew = String(error?.message ?? error)
      }
      return undefined
    }
    ctx.__mpdInjectWrapped = true
    probe.injectWrapped = true
    note("wrapped ctx.inject for " + tag)
    return true
  }
  window.__MPD_WRAP_INJECT__ = wrapInject

  const captureCtx = (ctx, tag) => {
    window.__MPD_CTX__ = ctx
    probe.ctxCaptured = true
    probe.applyCalls.push({ at: Date.now(), tag, hasInject: typeof ctx?.inject === "function", hasGet: typeof ctx?.get === "function" })
    note("captured ctx via " + tag)
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
