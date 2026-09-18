// mpd settings section — the browser half of the `mpd` settings namespace (t35; moved to its own
// top-level section by w14/t83 at the user's request: "web的设置栏请单开一栏MPD设置，别混在插件栏里").
//
// WHERE THIS MOUNTS: its OWN top-level `MPD` section of the Web settings dialog. The same
// mpd.jsonc knobs (thirteen scalar knobs plus the nine team-model slot leaves) used to ride the
// Plugins tab's keyed per-namespace item slot; this file no longer
// registers anything there, so the Plugins tab shows no mpd card.
//
// THE PATTERN IS THE HOST'S OWN, MEASURED in the host's settings-models section
// (`@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:2936-2952`):
//   • `ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section",
//     id, order, label: () => t("nav"), inject, children }, Component))` — the settings shell
//     collects that LIST slot (`ctx.slots.entries("settings.section")`, sorted by `order`) and
//     renders the ACTIVE one (`dsh-client-ui-settings/lib/client.js:561-572`, `:167`);
//   • `label` is a FUNCTION resolved through the registration's locale dictionaries, so the nav
//     text lives in the `mpdSettings` dictionaries below (key `nav`);
//   • the host's own sections are `general` 0, `models` 10 and `plugins` 15; this section takes
//     `order: 20`, i.e. AFTER them, so no existing section moves;
//   • `children` is DELIBERATELY OMITTED: this section renders no nested slot (the host's `models`
//     section declares its provider card + footer there; ours has none), which is a declared
//     absence rather than a copy of their list;
//   • the component receives `{ t, edit, resetField, save, discard, use<X>Card }`, where `t` comes
//     from the registered `locale` dictionaries and `use<X>Card` is the hook the registration's
//     `inject()` result provides;
//   • the write goes through the PUBLIC client seam `ctx.settingsScope.bind({namespace})`, whose
//     actions are `set`/`unset`/`mutate(ops, expectedRevision)` — i.e. the `settings/mutate` RPC
//     the bridge consumes. The client performs NO filesystem I/O and cannot.
// The host's `PluginCard`/`ValueField` are that package's PRIVATE components and are NOT imported
// here: this component is self-contained markup.
//
// WHAT IS CLAIMED (recorded in the lane/evidence): the registration is present in the BUILT and
// SERVED client, and the write path it drives (settings namespace -> bridge ->
// `<workspace>/.mpd/mpd.jsonc`) is proven by `web-settings-bridge.mjs` over the host's own
// authenticated API. WHAT IS NOT CLAIMED: that a browser renders this section or that a click
// produces the mutate — no browser exists in this environment; the user sees that in their own GUI.
//
// Labels/hints/zh descriptions are MIRRORED from the TUI section
// (`packages/mpd-tui-plugin/src/settings.ts`) and a test asserts the two lists stay identical, so
// the two front doors cannot drift.
(require) => {
  const NS = "mpd"
  /** The locale namespace the section's own labels live in. */
  const LOCALE_NS = "mpdSettings"
  /** The LIST slot the settings shell renders as top-level sections. */
  const SECTION_SLOT = "settings.section"
  /** This section's stable id (the shell keys the active section by it). */
  const SECTION_ID = "mpd"
  /** After `general` 0, `models` 10 and `plugins` 15 — so no existing section moves. */
  const SECTION_ORDER = 20

  /** The disclosure both front doors state (byte-identical to the TUI's BRIDGE_DISCLOSURE). */
  const BRIDGE_DISCLOSURE = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount) — it applies at the next dsh boot, because the file-derived base is fixed for the running process's lifetime"
  /**
   * The HOST LIMITATION half of the truth (T-18), byte-identical to
   * `packages/mpd-config-plugin/src/settings-schema.ts` `BRIDGE_RESTART_LIMIT` and rendered as the
   * card's second disclosure paragraph: the file-derived base is fixed for the running process, so
   * a hand edit of `.mpd/mpd.jsonc` applies at the next `dsh` boot and never mid-process, and only
   * a change made through the settings document can reach a running plugin (where it subscribes).
   * This is the honest replacement for the old "any settings edit wins from the next tick on"
   * claim, which the host's mount-time base read does not support.
   */
  const BRIDGE_RESTART_LIMIT = "the file half is host-limited: a .mpd/mpd.jsonc edit is read once at plugin mount and stays fixed for the running process, so it applies at the next dsh boot and never mid-process; only a change made through this settings document can reach a running plugin, and only where the plugin subscribes to the host's settings-document update"
  const NO_WORKSPACE_NOTICE = "if no session is live, the save stays in settings — not written to any .mpd/mpd.jsonc"
  // The clause that keeps a settings-only save from reading as a lost one (same sentence the TUI
  // hint and the status line carry).
  const NOT_LOST = "the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session"

  /**
   * The twenty-two knobs — the SAME fields the TUI `/settings` section declares (the thirteen
   * scalar knobs, then the nine team-model slot leaves). `hint` is the knob's mpd.jsonc key + the
   * shared disclosure, exactly as the TUI builds it; a knob whose effect is not self-evident from
   * its label also carries a `semantics` sentence the row renders (w16). The slot leaves take
   * their option lists from the live catalog at render time instead.
   */
  const FIELDS = [
    { path: ["hashline", "maxDiffChars"], label: "Inline diff limit", zh: "行内 diff 上限", kind: "number" },
    { path: ["commentChecker", "autoCheck"], label: "Comment checker", zh: "注释检查", kind: "boolean" },
    { path: ["ulw", "maxRounds"], label: "Ultrawork rounds", zh: "Ultrawork 轮数", kind: "number" },
    { path: ["memory", "vcs"], label: "Memory backend", zh: "记忆后端", kind: "select", options: ["git", "svn"] },
    { path: ["team", "stateDir"], label: "Team state directory", zh: "团队状态目录", kind: "text" },
    { path: ["boulder", "dir"], label: "Boulder directory", zh: "Boulder 目录", kind: "text" },
    { path: ["watchdog", "enabled"], label: "Watchdog enabled", zh: "看门狗启用", kind: "boolean" },
    { path: ["watchdog", "warnSilenceMs"], label: "Silence warning threshold (ms)", zh: "静默告警阈值（毫秒）", kind: "number" },
    { path: ["watchdog", "tickIntervalMs"], label: "Watchdog tick interval (ms)", zh: "看门狗轮询间隔（毫秒）", kind: "number" },
    { path: ["watchdog", "warnStreakToEscalate"], label: "Warn streak before escalation", zh: "升级前连续告警次数", kind: "number" },
    { path: ["watchdog", "actionOnEscalate"], label: "Action on escalation", zh: "升级时的动作", kind: "select", options: ["pause", "warn-only"] },
    { path: ["watchdog", "toolInFlightMaxMs"], label: "Tool-in-flight bound (ms, 0 = no bound)", zh: "工具在飞上限（毫秒，0 表示不设上限）", kind: "number", semantics: "how long ONE tool call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a `tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables the bound" },
    { path: ["watchdog", "holdTtlMs"], label: "Hold TTL (ms, 0 = no expiry)", zh: "暂停持有有效期（毫秒，0 表示不设有效期）", kind: "number", semantics: "how long a watchdog hold may stay latched before it auto-releases: past this bound the hold releases itself and changes ZERO team bytes, and activity newer than the hold releases it sooner — `0` disables the expiry" },
    // The three team-model slots (nine leaves, mirrors of the ONE knob declaration in
    // packages/mpd-config-plugin/src/settings-schema.ts). Every slot leaf is a `select`: the
    // options come from the live catalog at render time (see optionsFor) and fall back to the
    // declared lists below, so no slot value is ever typed. The DECLARED lists are the parity
    // surface with the TUI; the LIVE lists are a different source by construction.
    { path: ["teamModels", "slot1", "provider"], label: "Slot 1 provider", zh: "槽位 1 提供商", kind: "select", options: ["deepseek-official"] },
    { path: ["teamModels", "slot1", "model"], label: "Slot 1 model", zh: "槽位 1 模型", kind: "select", options: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"] },
    { path: ["teamModels", "slot1", "reasoningEffort"], label: "Slot 1 reasoning effort", zh: "槽位 1 推理强度", kind: "select", options: ["off", "low", "high", "max"] },
    { path: ["teamModels", "slot2", "provider"], label: "Slot 2 provider", zh: "槽位 2 提供商", kind: "select", options: ["deepseek-official"] },
    { path: ["teamModels", "slot2", "model"], label: "Slot 2 model", zh: "槽位 2 模型", kind: "select", options: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"] },
    { path: ["teamModels", "slot2", "reasoningEffort"], label: "Slot 2 reasoning effort", zh: "槽位 2 推理强度", kind: "select", options: ["off", "low", "high", "max"] },
    { path: ["teamModels", "slot3", "provider"], label: "Slot 3 provider", zh: "槽位 3 提供商", kind: "select", options: ["deepseek-official"] },
    { path: ["teamModels", "slot3", "model"], label: "Slot 3 model", zh: "槽位 3 模型", kind: "select", options: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"] },
    { path: ["teamModels", "slot3", "reasoningEffort"], label: "Slot 3 reasoning effort", zh: "槽位 3 推理强度", kind: "select", options: ["off", "low", "high", "max"] },
  ]

  // The per-row hint: the real mpd.jsonc key, the bridge disclosure, the not-lost clause and (for
  // a knob whose effect is not self-evident) its semantics sentence — byte-identical to the hint
  // the TUI section builds for the same knob, so the two front doors state the same thing.
  const hintOf = (field) => `mpd.jsonc ${field.path.join(".")} — ${BRIDGE_DISCLOSURE} ${NOT_LOST}${field.semantics === undefined ? "" : " " + field.semantics}`
  const fieldKey = (field) => field.path.join(".")
  const leafOf = (value, path) => path.reduce((acc, part) => (acc === null || acc === undefined ? undefined : acc[part]), value)

  /** Parse the control's text into a value for this field, or undefined when it is not one. */
  function parse(kind, text) {
    if (kind === "number") {
      const n = Number(String(text).trim())
      return Number.isFinite(n) ? n : undefined
    }
    if (kind === "boolean") {
      const t = String(text).trim().toLowerCase()
      if (t === "true" || t === "1") return true
      if (t === "false" || t === "0") return false
      return undefined
    }
    const t = String(text)
    return t.length === 0 ? undefined : t
  }

  const format = (kind, value) => (value === undefined || value === null ? "" : String(value))

  /**
   * The namespace sub-tree that renders as a DEPENDENT picker: for each slot the provider, the
   * model (grouped by provider) and the reasoning effort (the SELECTED model's own efforts) are
   * all selections, so no slot value is ever typed. The card MIRRORS this declaration instead of
   * importing the TypeScript plugin's knob list: the web client must not reference that symbol (a
   * QA gate pins it), and the parity test compares the mirror with the real one.
   */
  const TEAM_MODEL_SLOT = "teamModels"

  /**
   * The session the catalog probe binds to: `sessions.list.getSnapshot().current` is the shape
   * `team-page.js` already reads. Guarded, so a missing sessions service, a missing list or an
   * unbound session all answer undefined instead of throwing.
   */
  function currentSessionId(ctx) {
    try {
      const sessions = ctx && typeof ctx.get === "function" ? ctx.get("sessions") : undefined
      const list = sessions ? sessions.list : undefined
      const snapshot = list && typeof list.getSnapshot === "function" ? list.getSnapshot() : undefined
      const current = snapshot ? snapshot.current : undefined
      if (current === undefined || current === null) return undefined
      return current.sessionId ?? current.id
    } catch {
      return undefined
    }
  }

  /**
   * The live model catalog: the host client's own provider groups
   * (`{ id, name, models: [{ id, name, reasoning?: { efforts: [{ id, name }] } }] }`), reached
   * exactly the way `team-page.js` reaches a model directory — guarded probes of
   * `ctx.get("sessions")` + `ctx.get("modelDirectories")`, never a declared inject (a
   * declared-but-absent service is fatal to the whole page). `directoryFor` THROWS for a session
   * the host does not know, so every step is wrapped: any absence or throw answers [] and the
   * slot controls fall back to their declared option lists.
   */
  function readCatalog(ctx) {
    try {
      const directories = ctx && typeof ctx.get === "function" ? ctx.get("modelDirectories") : undefined
      if (directories === undefined || directories === null || typeof directories.directoryFor !== "function") return []
      const sessionId = currentSessionId(ctx)
      if (sessionId === undefined) return []
      const directory = directories.directoryFor(sessionId)
      if (directory === undefined || directory === null) return []
      const store = directory.store
      const snapshot = store && typeof store.getSnapshot === "function" ? store.getSnapshot() : undefined
      const groups = snapshot && Array.isArray(snapshot.groups) ? snapshot.groups : []
      return groups.filter((group) => group !== null && typeof group === "object" && typeof group.id === "string" && Array.isArray(group.models))
    } catch {
      return []
    }
  }

  /** The declared fallback options of one knob, in the { value, label } shape the card renders. */
  function declaredOptions(field) {
    return (Array.isArray(field.options) ? field.options : []).map((value) => ({ value, label: value }))
  }

  /** The catalog entry of one exact provider/model pair (the provider leaf picks the group). */
  function findModel(groups, providerId, modelId) {
    const preferred = groups.filter((group) => group.id === providerId)
    for (const group of [...preferred, ...groups.filter((group) => group.id !== providerId)]) {
      for (const model of group.models) if (model && model.id === modelId) return model
    }
    return undefined
  }

  /**
   * The options ONE field renders. Non-slot knobs keep their declared list. Slot leaves derive
   * theirs from the catalog and fall back to the declared list whenever the catalog is empty or
   * lacks the requested entry — a missing catalog degrades the OPTIONS, never the section:
   *   provider          -> the catalog's provider ids (label = the provider's display name)
   *   model             -> every provider's models, GROUPED by provider (optgroup label)
   *   reasoningEffort   -> the SELECTED model's own efforts, so changing the model re-derives them
   */
  function optionsFor(field, groups, controls) {
    const declared = declaredOptions(field)
    if (field.path[0] !== TEAM_MODEL_SLOT || groups.length === 0) return declared
    const slot = field.path[1]
    const leaf = field.path[2]
    if (leaf === "provider") return groups.map((group) => ({ value: group.id, label: typeof group.name === "string" && group.name.length > 0 ? group.name : group.id }))
    if (leaf === "model") {
      const options = []
      for (const group of groups) {
        for (const model of group.models) if (model && typeof model.id === "string") options.push({ value: model.id, label: typeof model.name === "string" && model.name.length > 0 ? model.name : model.id, group: typeof group.name === "string" && group.name.length > 0 ? group.name : group.id })
      }
      return options.length > 0 ? options : declared
    }
    const textOf = (path) => {
      const control = controls ? controls[path.join(".")] : undefined
      return control ? control.text : undefined
    }
    const model = findModel(groups, textOf([TEAM_MODEL_SLOT, slot, "provider"]), textOf([TEAM_MODEL_SLOT, slot, "model"]))
    const efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : []
    const derived = efforts.filter((effort) => effort && typeof effort.id === "string").map((effort) => ({ value: effort.id, label: typeof effort.name === "string" && effort.name.length > 0 ? effort.name : effort.id }))
    return derived.length > 0 ? derived : declared
  }

  /**
   * The option children of one select: `optgroup`s keyed by provider when the options carry a
   * group (the model control, where the provider is shown as a group), a flat list otherwise.
   */
  function optionElements(createElement, options) {
    if (!options.some((option) => typeof option.group === "string")) {
      return options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))
    }
    const labels = []
    const byGroup = new Map()
    for (const option of options) {
      const label = typeof option.group === "string" ? option.group : ""
      if (!byGroup.has(label)) {
        byGroup.set(label, [])
        labels.push(label)
      }
      byGroup.get(label).push(option)
    }
    return labels.map((label) =>
      createElement(
        "optgroup",
        { key: label, label },
        ...byGroup.get(label).map((option) => createElement("option", { key: option.value, value: option.value }, option.label)),
      ),
    )
  }

  /** A minimal snapshot store (the host's own is private): subscribe + getSnapshot, stable refs. */
  function createStore(initial) {
    let snapshot = initial
    const listeners = new Set()
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set(next) {
        snapshot = next
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* a broken listener must not break the card */
          }
        }
      },
    }
  }

  /**
   * The card's form controller: reads the bound settings scope, stages edits, and writes them with
   * `scope.mutate(ops, revision)` — nested paths included, which `scope.set(field, …)` cannot
   * express (it writes top-level fields only).
   */
  function createMpdCardController(scope, fields = FIELDS, disclosure = { BRIDGE_DISCLOSURE, BRIDGE_RESTART_LIMIT, NO_WORKSPACE_NOTICE }) {
    const staged = new Map()
    // Declared BEFORE the first projection: `project()` reads all three, and a `let` below the
    // call site is a TDZ ReferenceError (measured by this module's own test).
    let saving = false
    let failed = false
    let lastError = ""
    const store = createStore(project())

    function readScope() {
      const snapshot = scope.getSnapshot()
      return { snapshot, section: snapshot?.value ?? snapshot?.user }
    }

    function project() {
      const { snapshot, section } = readScope()
      const controls = {}
      let dirty = false
      let invalid = false
      for (const field of fields) {
        const key = fieldKey(field)
        const stagedEdit = staged.get(key)
        if (stagedEdit !== undefined) {
          const parsed = stagedEdit.clear ? { kind: "clear" } : parse(field.kind, stagedEdit.text)
          controls[key] = { text: stagedEdit.text, overridden: parsed?.kind === "set", invalid: parsed === undefined }
          if (parsed === undefined) invalid = true
          dirty = true
          continue
        }
        controls[key] = { text: format(field.kind, leafOf(section, field.path)), overridden: leafOf(snapshot?.user, field.path) !== undefined, invalid: false }
      }
      return {
        available: snapshot?.status === "ready",
        writable: snapshot?.writable === true,
        mode: snapshot?.mode ?? "memory",
        dirty,
        invalid,
        saving,
        failed,
        error: lastError,
        controls,
        disclosure,
      }
    }

    function publish() {
      store.set(project())
    }
    try {
      scope.subscribe(publish)
    } catch {
      /* a scope without subscribe still renders its first snapshot */
    }

    /** Every staged edit a save would write (an unparsable draft contributes no write). */
    function plan() {
      const writes = []
      for (const field of fields) {
        const key = fieldKey(field)
        const stagedEdit = staged.get(key)
        if (stagedEdit === undefined) continue
        if (stagedEdit.clear) {
          writes.push({ op: "unset", path: [...field.path] })
          continue
        }
        const parsed = parse(field.kind, stagedEdit.text)
        if (parsed === undefined) continue
        if (format(field.kind, leafOf(readScope().section, field.path)) === format(field.kind, parsed)) continue
        writes.push({ op: "set", path: [...field.path], value: parsed })
      }
      return writes
    }

    async function save() {
      const writes = plan()
      // A scope that is not writable (a non-loopback page keeps its snapshot in memory) must not
      // even ATTEMPT a write: the card renders the reason, and the edit stays staged for the user
      // rather than being silently dropped on the wire.
      if (saving || writes.length === 0 || readScope().snapshot?.writable !== true) return
      saving = true
      failed = false
      lastError = ""
      publish()
      try {
        // The revision fence: the scope reports the revision it read, so a concurrent change is a
        // conflict the user can retry rather than a silent overwrite.
        await scope.mutate(writes, scope.getSnapshot()?.revision)
        staged.clear()
      } catch (error) {
        failed = true
        lastError = String(error?.message ?? error)
      }
      saving = false
      publish()
    }

    function stage(key, edit) {
      staged.set(key, edit)
      failed = false
      lastError = ""
      publish()
    }

    return {
      /** The face the slot registration injects: one hook store plus the form actions. */
      inject() {
        return {
          hooks: { mpdCard: store },
          edit: (key, text) => stage(key, { text, clear: false }),
          resetField: (key) => stage(key, { text: "", clear: true }),
          save: () => {
            void save()
          },
          discard: () => {
            if (staged.size === 0 && !failed) return
            staged.clear()
            failed = false
            lastError = ""
            publish()
          },
        }
      },
      store,
      dispose: () => {
        try {
          scope.dispose()
        } catch {
          /* already disposed */
        }
      },
    }
  }

  /** The card component: self-contained markup, no private host components. */
  function createCardComponent(react, fields = FIELDS, readGroups = () => []) {
    const { createElement } = react
    return function MpdSettingsCard(props) {
      const state = props.useMpdCard((snapshot) => snapshot)
      const t = typeof props.t === "function" ? props.t : (key) => key
      const disabled = !state.writable
      let groups = []
      try {
        const probed = readGroups()
        if (Array.isArray(probed)) groups = probed
      } catch {
        /* a broken catalog probe degrades the OPTIONS, never the section */
      }
      const rows = fields.map((field) => {
        const key = fieldKey(field)
        const control = state.controls[key] ?? { text: "" }
        const label = t(key)
        const hint = t(key + ".hint")
        const options = field.kind === "select" ? optionsFor(field, groups, state.controls) : []
        const input = field.kind === "select" && options.length > 0
          ? createElement(
              "select",
              { value: control.text, disabled, onChange: (event) => props.edit(key, event.target.value), style: { width: "100%" } },
              createElement("option", { value: "" }, "—"),
              ...optionElements(createElement, options),
            )
          : createElement("input", {
              value: control.text,
              disabled,
              onChange: (event) => props.edit(key, event.target.value),
              style: { width: "100%" },
            })
        return createElement(
          "label",
          { key, style: { display: "block", margin: "8px 0" } },
          createElement("span", { style: { display: "block", fontSize: 13, fontWeight: 600 } }, label),
          createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.7, marginBottom: 2 } }, hint),
          input,
          createElement(
            "span",
            { style: { fontSize: 11, opacity: 0.7 } },
            (control.overridden ? "overridden · " : "") + (control.invalid ? "not a valid value · " : ""),
            createElement("button", { type: "button", disabled, onClick: () => props.resetField(key) }, t("reset")),
          ),
        )
      })
      return createElement(
        "div",
        { style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: 12 } },
        createElement("h3", { style: { margin: "0 0 4px" } }, t("title")),
        createElement("p", { style: { margin: "0 0 8px", fontSize: 12, opacity: 0.75 } }, t("intro")),
        disabled
          ? createElement("p", { style: { margin: "0 0 8px", fontSize: 12, opacity: 0.75 } }, t("readOnly"))
          : null,
        ...rows,
        createElement(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 10 } },
          createElement("button", { type: "button", disabled: disabled || !state.dirty || state.invalid, onClick: () => props.save() }, t("save")),
          createElement("button", { type: "button", disabled: !state.dirty, onClick: () => props.discard() }, t("discard")),
          createElement("span", { style: { fontSize: 12, opacity: 0.75 } }, state.saving ? t("saving") : state.failed ? state.error : state.dirty ? t("unsaved") : ""),
        ),
        createElement("p", { style: { fontSize: 12, opacity: 0.75, margin: "8px 0 0" } }, state.disclosure?.BRIDGE_DISCLOSURE ?? ""),
        createElement("p", { style: { fontSize: 12, opacity: 0.75, margin: "4px 0 0" } }, state.disclosure?.BRIDGE_RESTART_LIMIT ?? ""),
        createElement("p", { style: { fontSize: 12, opacity: 0.75, margin: "4px 0 0" } }, state.disclosure?.NO_WORKSPACE_NOTICE ?? ""),
        state.mode === "memory"
          ? createElement("p", { style: { fontSize: 12, opacity: 0.75, margin: "4px 0 0" } }, t("memoryMode"))
          : null,
      )
    }
  }

  /** The zh/en dictionaries: the TUI section's labels and zh descriptions, plus the card's copy. */
  function dictionaries(fields = FIELDS) {
    const en = {
      nav: "MPD",
      title: "MPD bundle",
      intro: "The mpd.jsonc knobs this bundle's plugins read. namespace mpd · applies at the next dsh boot",
      save: "Save",
      discard: "Discard",
      reset: "Reset to the file value",
      saving: "Saving…",
      unsaved: "Unsaved",
      readOnly: "This deployment stores settings read-only (a non-loopback page never reaches the host document).",
      memoryMode: "This page is not loopback: settings writes stay process-local and never reach the host document.",
    }
    const zh = {
      nav: "MPD",
      title: "MPD 插件包",
      intro: "本插件包读取的 mpd.jsonc 配置项。命名空间 mpd · 下次启动 dsh 时生效",
      save: "保存",
      discard: "放弃",
      reset: "重置为文件值",
      saving: "保存中…",
      unsaved: "未保存",
      readOnly: "当前部署以只读方式存储设置（非回环页面无法写入宿主文档）。",
      memoryMode: "该页面不是回环地址：设置写入仅保留在进程内，不会写入宿主文档。",
    }
    for (const field of fields) {
      const key = fieldKey(field)
      en[key] = field.label
      zh[key] = field.zh
      en[key + ".hint"] = hintOf(field)
      zh[key + ".hint"] = hintOf(field)
    }
    return { en, zh }
  }

  /**
   * Mount the section. `settingsScope` is a PLUGIN-provided service, so it is reached through
   * `ctx.inject` — never a declared dependency (a declared-but-absent service makes the whole page
   * fail as `entry: pending`; `web-client-adapt --self-test` asserts this rule against the built
   * client). One warning on absence, never a throw.
   * @param ctx - the client entry's context.
   * @returns true when the registration was attempted.
   */
  function mountSettingsCard(ctx, options = {}) {
    try {
      if (ctx === undefined || ctx === null || ctx.slots === undefined || typeof ctx.slots.inject !== "function") return false
      const fields = options.fields ?? FIELDS
      const dicts = dictionaries(fields)
      try {
        if (ctx.locale !== undefined && typeof ctx.locale.register === "function") ctx.locale.register(LOCALE_NS, dicts)
      } catch (error) {
        console.warn("[mpd] settings section: locale registration failed: " + String(error))
      }
      ctx.slots.inject(SECTION_SLOT, function* () {
        try {
          ctx.inject(["settingsScope"], (scoped) => {
            const service = typeof scoped.get === "function" ? scoped.get("settingsScope") : scoped.settingsScope
            if (service === undefined || service === null || typeof service.bind !== "function") {
              console.warn("[mpd] settings section: the settings scope is unavailable — the mpd section is not registered")
              return
            }
            const scope = service.bind({ namespace: NS })
            const controller = createMpdCardController(scope, fields)
            // The slot leaves render their option lists from the LIVE catalog, probed through the
            // guarded client seams on every render (never a declared inject — see readCatalog).
            const Section = createCardComponent(require("react"), fields, () => readCatalog(ctx))
            // The host's descriptor: id + explicit order + a label resolved through this
            // registration's locale dictionaries. `children` is omitted because this section
            // renders no nested slot of its own.
            const unregister = ctx.slots.register(
              { name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() },
              Section,
            )
            return () => {
              try {
                unregister()
              } catch {
                /* the slot may be gone */
              }
              controller.dispose()
            }
          })
        } catch (error) {
          console.warn("[mpd] settings section: could not mount the mpd section: " + String(error))
        }
        yield undefined
      })
      return true
    } catch (error) {
      console.warn("[mpd] settings section: slot registration failed: " + String(error))
      return false
    }
  }

  return {
    mountSettingsCard,
    createMpdCardController,
    createCardComponent,
    dictionaries,
    readCatalog,
    optionsFor,
    optionElements,
    FIELDS,
    SETTINGS_NS: NS,
    LOCALE_NS,
    SECTION_SLOT,
    SECTION_ID,
    SECTION_ORDER,
    BRIDGE_DISCLOSURE,
    BRIDGE_RESTART_LIMIT,
    NO_WORKSPACE_NOTICE,
  }
}
