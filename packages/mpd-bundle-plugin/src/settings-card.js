// mpd settings section — the browser half of the `mpd` settings namespace (t35; moved to its own
// top-level section by w14/t83 at the user's request: "web的设置栏请单开一栏MPD设置，别混在插件栏里").
//
// WHERE THIS MOUNTS: its OWN top-level `MPD` section of the Web settings dialog. The same
// mpd.jsonc knobs (thirteen scalar knobs plus the twelve team-model slot leaves) used to ride the
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
//   • the write goes through the PUBLIC client seam `ctx.configForms.get(namespace)`, whose
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
   * scalar knobs, then the twelve team-model slot leaves). The composed hint LEADS with the knob's
   * human sentence (`semantics`/`semanticsZh`) and then states its mpd.jsonc key + the shared
   * disclosure, exactly as the TUI builds it; a scalar knob keeps its declared metadata (the two
   * watchdog rows carry the sentence they always had). The slot leaves take their option lists
   * from the live catalog at render time instead.
   */
  const SLOT_SLOTS = ["slot1", "slot2", "slot3", "slot4"]
  const SLOT_LEAVES = [
    { leaf: "provider", label: "provider", zh: "提供商", options: ["deepseek-official"] },
    { leaf: "model", label: "model", zh: "模型", options: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"] },
    { leaf: "reasoningEffort", label: "reasoning effort", zh: "推理强度", options: ["off", "low", "high", "max"] },
  ]
  /**
   * What each slot IS — the member group it routes, in the group's own order (mirror of
   * `TEAM_MODEL_SLOT_GROUPS`). The group name and the member list are the only inputs the twelve
   * shared human sentences interpolate, so the card cannot drift from the declaration by accident:
   * the parity test compares every sentence and heading below with the shared declaration's own
   * builders. Slot 4 carries its OWN sentences/impact (an image-input constraint, not a
   * shared-route one), mirrored from `TEAM_MODEL_SLOT_LEAF_OVERRIDES` / `…_IMPACT_OVERRIDES`.
   */
  const SLOT_GROUPS = {
    slot1: { en: "heavy members", zh: "重推理成员", members: "Architect, Planner, Reviewer, Lead, Senior Engineer", membersZh: "Architect、Planner、Reviewer、Lead、Senior Engineer" },
    slot2: { en: "analysis members", zh: "分析型成员", members: "Researcher, Explorer, Plan Reviewer", membersZh: "Researcher、Explorer、Plan Reviewer" },
    slot3: { en: "execution members", zh: "执行型成员", members: "Deep Worker, Junior Engineer", membersZh: "Deep Worker、Junior Engineer" },
    slot4: { en: "vision member", zh: "视觉成员", members: "Vision Analyst", membersZh: "Vision Analyst" },
  }
  /** The one-line impact under a slot's group heading (the shared text for slots 1-3). */
  const SLOT_IMPACT = {
    en: "When a team is created these members start on this slot's provider · model · reasoning effort; an unusable value fails team creation loudly, naming the member and the slot.",
    zh: "建队时这些成员默认用本档的 提供商 · 模型 · 推理强度 启动；填错会让建队直接失败并点名成员与槽位。",
  }
  /** The vision slot's OWN impact line (mirror of `TEAM_MODEL_SLOT_IMPACT_OVERRIDES.slot4`). */
  const SLOT_IMPACT_OVERRIDES = {
    slot4: {
      en: "When a team is created Vision Analyst starts on this slot's provider · model · reasoning effort; the model here MUST accept image input or image analysis fails; an unusable value fails team creation loudly, naming the member and the slot.",
      zh: "建队时 Vision Analyst 默认用本档的 提供商 · 模型 · 推理强度 启动；本档的模型必须支持图像输入，否则看图任务会失败；填错会让建队直接失败并点名成员与槽位。",
    },
  }
  /** Slot 4's OWN leaf sentences (mirror of `TEAM_MODEL_SLOT_LEAF_OVERRIDES.slot4`). */
  const SLOT_SENTENCE_OVERRIDES = {
    slot4: {
      provider: {
        en: "The provider half of this slot. It drives Vision Analyst only (the one member that reads images, diagrams and screenshots). What changing it does: effective at the next team creation; an unusable value fails team creation loudly, naming the member and the slot. The model here must be a vision model that accepts image input (for example deepseek-v4-flash-vision-exp) — a text-only model breaks image analysis.",
        zh: "这一档的提供商。它只驱动 Vision Analyst（唯一负责看图/读图/分析截图的成员）。改它的影响：下次建队生效；填成不可用会让建队直接失败并点名成员与槽位。注意本档的模型必须是支持图像输入的视觉模型（例如 deepseek-v4-flash-vision-exp），换成纯文本模型会让看图任务失败。",
      },
      model: {
        en: "This slot's model. It MUST accept image input: Vision Analyst's whole value is reading images, and a text-only model makes its image tasks fail. What changing it does: effective at the next team creation.",
        zh: "这一档的模型。必须选支持图像输入的模型：Vision Analyst 的全部价值在于读图，纯文本模型会让它的读图任务直接失败。改它的影响：下次建队生效。",
      },
      reasoningEffort: {
        en: "This slot's reasoning effort (off / low / high / max). It sets how much Vision Analyst thinks while reading an image. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot.",
        zh: "这一档的推理强度（off / low / high / max）。决定 Vision Analyst 读图时的思考深度。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。",
      },
    },
  }
  /** The impact line of ONE slot: the slot's own override, else the shared sentence. */
  const impactOf = (slot, lang) => (SLOT_IMPACT_OVERRIDES[slot] ?? SLOT_IMPACT)[lang]
  /** The HUMAN sentence of one slot leaf in both locales: what it IS, then what configuring it DOES. */
  function slotSentence(slot, leaf) {
    const override = SLOT_SENTENCE_OVERRIDES[slot]
    if (override !== undefined) return override[leaf]
    const group = SLOT_GROUPS[slot]
    if (leaf === "provider") {
      return {
        en: `The provider half of this slot. The slots are the default model route of team members: when a team is created, the ${group.en} (${group.members}) start on this slot's provider + model + reasoning effort. What changing it does: those members take the new route at the next team creation, and an unusable value makes team creation FAIL loudly, naming the member and the slot — it never silently substitutes another model. Vision Analyst is the vision member: slot 4 drives it.`,
        zh: `这一档的提供商。各槽位合起来是 team 成员的默认模型路由：建队时，${group.zh}（${group.membersZh}）会按本档的 提供商+模型+推理强度 启动。改它的影响：这些成员下次建队即走新路由；填成不可用会让建队直接失败并点名成员与槽位，不会静默换模型。Vision Analyst 是视觉成员：由槽位 4 驱动。`,
      }
    }
    if (leaf === "model") {
      return {
        en: `This slot's model. Together with the provider above, it decides the model the ${group.en} (${group.members}) start on. What changing it does: same as above — effective at the next team creation; a model the provider does not offer makes team creation fail with the member and slot named.`,
        zh: `这一档的模型。与上面的提供商共同决定 ${group.zh}（${group.membersZh}）建队时使用的模型。改它的影响：同上，下次建队生效；模型与提供商不匹配、或该提供商没有这个模型时，建队会点名失败。`,
      }
    }
    return {
      en: `This slot's reasoning effort (off / low / high / max). It sets how much the ${group.en} (${group.members}) think when a team is created: max is the strongest, high the usual balance, low cheaper, off disables reasoning. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot.`,
      zh: `这一档的推理强度（off / low / high / max）。它决定 ${group.zh}（${group.membersZh}）建队时的思考深度：max 最强、high 是常规平衡、low 更省、off 关闭思考。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。`,
    }
  }
  /** The group heading a slot renders above its three rows, e.g. `Slot 2 — analysis members (…)`. */
  function slotHeading(slot, index) {
    const group = SLOT_GROUPS[slot]
    return { en: `Slot ${index} — ${group.en} (${group.members})`, zh: `槽位 ${index} —— ${group.zh}（${group.membersZh}）` }
  }
  /** The twelve slot rows: the same order, paths and DECLARED option lists as the shared declaration. */
  const SLOT_FIELDS = SLOT_SLOTS.flatMap((slot, index) => SLOT_LEAVES.map(({ leaf, label, zh, options }) => {
    const sentence = slotSentence(slot, leaf)
    return {
      path: ["teamModels", slot, leaf],
      label: `Slot ${index + 1} ${label} (${SLOT_GROUPS[slot].en})`,
      zh: `槽位 ${index + 1} ${zh}（${SLOT_GROUPS[slot].zh}）`,
      kind: "select",
      options,
      semantics: sentence.en,
      semanticsZh: sentence.zh,
    }
  }))

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
    // The four team-model slots (twelve leaves, mirrors of the ONE knob declaration in
    // packages/mpd-config-plugin/src/settings-schema.ts). Every slot leaf is a `select`: the
    // options come from the live catalog at render time (see optionsFor) and fall back to the
    // declared lists below, so no slot value is ever typed. The DECLARED lists are the parity
    // surface with the TUI; the LIVE lists are a different source by construction. The labels and
    // the human sentences are built from SLOT_GROUPS below, so a slot's copy is stated once here
    // exactly as the shared declaration states it (a test compares the two element-wise).
    ...SLOT_FIELDS,
  ]

  // The per-row hint, HUMAN SENTENCE FIRST: the knob's own `semantics` (what it is and what
  // configuring it does) leads in the row's locale, then the real mpd.jsonc key with the bridge
  // disclosure and the not-lost clause — byte-identical to the hint the TUI section builds for the
  // same knob, so the two front doors state the same thing in the same order. A knob with no
  // human sentence keeps the disclosure-only hint it always had.
  /**
   * One row's hint: its own sentence plus the dotted mpd.jsonc key. The bridge disclosure is stated
   * ONCE at the top of the card, not once per row — measured in a real browser (docker/ui,
   * 2026-09-27, `05b-mpd-section.png`): with it inlined, all 25 rows read as the same four lines and
   * each knob's own sentence was pushed off screen, while the card already repeated the same text
   * again at the bottom.
   */
  const keyOf = (field) => `mpd.jsonc ${field.path.join(".")}`
  const hintOf = (field, lang = "en") => {
    const sentence = lang === "zh" ? field.semanticsZh : field.semantics
    const pointer = keyOf(field)
    return sentence === undefined || sentence.length === 0 ? pointer : `${sentence} (${pointer})`
  }
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
   * The session the catalog binds to, read from the client's OWN list snapshot.
   *
   * MEASURED in a real browser against the live host (`evidence/web-card-catalog/20260918T073000Z/`):
   * `sessions.list.getSnapshot()` is `{ ids, byId, current, phase, subagentsByParent, jobsBySession,
   * currentAddress }`, and `current` is the session ID **STRING** — never an object. The host's own
   * consumers prove it: `dsh-client-ui-session` hands it straight to `sessions.binding(current)`, and
   * `dsh-api-session-controller`'s `followCurrent()` indexes `snapshot.byId[current]`.
   *
   * THE DEFECT THIS REPLACES: `current.sessionId ?? current.id` on a STRING is always `undefined`, so
   * a card with a live current session rendered `no session is bound` — the exact sentence measured in
   * the user's browser. The earlier acceptance missed it because its fixture INJECTED
   * `{ current: { sessionId } }`, i.e. it asserted the ASSUMED shape instead of the real one.
   *
   * The object form is still accepted (last) so an existing caller that injects `{ sessionId }` keeps
   * working. Guarded: a missing sessions service, a missing list or an unbound session answer
   * undefined instead of throwing.
   */
  function currentSessionIdOf(sessions) {
    try {
      const snapshot = listSnapshotOf(sessions)
      if (snapshot === undefined || snapshot === null) return undefined
      const current = snapshot.current
      if (typeof current === "string") return current.length === 0 ? undefined : current
      if (current !== null && typeof current === "object") {
        const id = current.sessionId ?? current.id
        return typeof id === "string" && id.length > 0 ? id : undefined
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /** The client's session-list snapshot, or undefined when the service is absent or unreadable. */
  function listSnapshotOf(sessions) {
    const list = sessions ? sessions.list : undefined
    return list && typeof list.getSnapshot === "function" ? list.getSnapshot() : undefined
  }

  /**
   * Every session id the list snapshot carries, in the snapshot's own order. `ids` is the MEASURED
   * field; `items` and `byId` are read too, so a snapshot from another host build still yields
   * candidates.
   */
  function listedSessionIds(snapshot) {
    const ids = []
    const push = (id) => {
      if (typeof id === "string" && id.length > 0 && !ids.includes(id)) ids.push(id)
    }
    if (Array.isArray(snapshot.ids)) for (const id of snapshot.ids) push(id)
    if (Array.isArray(snapshot.items)) for (const item of snapshot.items) push(item === null || item === undefined ? undefined : (item.sessionId ?? item.id))
    if (snapshot.byId !== null && snapshot.byId !== undefined && typeof snapshot.byId === "object") for (const id of Object.keys(snapshot.byId)) push(id)
    return ids
  }

  /**
   * The session a model directory can actually be resolved FOR. The session the app is SHOWING wins
   * (`current`); when the app has no current session — measured: the settings dialog opens before any
   * conversation — every LISTED session is tried and the first for which BOTH `scope(id)` and
   * `binding(id)` resolve wins, because that pair is exactly the precondition the host's resolver
   * documents (`… resolved no scope` / `… resolved no binding`). A non-`blank` session is tried
   * first: a placeholder row is a poor thing to pin a catalog preview to.
   *
   * No `open()` is needed and none is performed: the host mints a listed session's scope lazily
   * (`eligible(id) = current === id || ids.includes(id)`, measured resolving for every listed id).
   */
  function boundSessionIdOf(sessions) {
    const current = currentSessionIdOf(sessions)
    if (current !== undefined) return current
    try {
      if (sessions === null || sessions === undefined) return undefined
      if (typeof sessions.scope !== "function" || typeof sessions.binding !== "function") return undefined
      const snapshot = listSnapshotOf(sessions)
      if (snapshot === undefined || snapshot === null) return undefined
      const ids = listedSessionIds(snapshot)
      const byId = snapshot.byId !== null && snapshot.byId !== undefined && typeof snapshot.byId === "object" ? snapshot.byId : {}
      const ordered = [...ids.filter((id) => byId[id]?.blank !== true), ...ids.filter((id) => byId[id]?.blank === true)]
      for (const id of ordered) {
        try {
          if (sessions.scope(id) !== undefined && sessions.binding(id) !== undefined) return id
        } catch {
          /* an unresolvable id is not a candidate */
        }
      }
    } catch {
      /* an unreadable list is not a candidate */
    }
    return undefined
  }

  /** Read one service from a context that has it IN SCOPE (never throws). */
  function readService(ctx, name) {
    try {
      return ctx && typeof ctx.get === "function" ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  /** The data attribute carrying the branch that produced the option lists (assertable, no browser). */
  const CATALOG_ATTR = "data-mpd-catalog-state"
  /** The sentence a fallback MUST say out loud — a silent fallback is what hid this defect. */
  const CATALOG_FALLBACK_NOTICE = "declared fallback — live catalog unavailable"
  const FALLBACK_CATALOG = { mode: "fallback", providers: 0, models: 0, notice: CATALOG_FALLBACK_NOTICE, reason: "the model catalog injection has not resolved yet" }

  /** The one sentence the card renders for one catalog state: LIVE (with counts) or fallback. */
  function catalogNotice(info) {
    const state = info ?? FALLBACK_CATALOG
    if (state.mode === "live") {
      const providers = Number(state.providers ?? 0)
      const models = Number(state.models ?? 0)
      return "live catalog — " + String(providers) + (providers === 1 ? " provider" : " providers") + " · " + String(models) + (models === 1 ? " model" : " models")
    }
    const reason = typeof state.reason === "string" && state.reason.length > 0 ? " (" + state.reason + ")" : ""
    return CATALOG_FALLBACK_NOTICE + reason
  }

  /**
   * The short trailing marker a SLOT row's hint carries while the catalog is in fallback: the third
   * surface of the same state, on the rows the user is actually looking at. Live renders nothing
   * here — the hint is not part of the front-door parity contract (the parity pin compares the
   * declaration), so the suffix is a render-time addition only.
   */
  function slotFallbackMarker(info) {
    const state = info ?? FALLBACK_CATALOG
    if (state.mode === "live") return ""
    const reason = typeof state.reason === "string" && state.reason.length > 0 ? state.reason : ""
    return reason === "" ? " — declared fallback" : " — declared fallback: " + reason
  }

  /** The provider/model counts of one group list. */
  function catalogCounts(groups) {
    let models = 0
    for (const group of groups) models += Array.isArray(group.models) ? group.models.length : 0
    return { providers: groups.length, models }
  }

  /**
   * The LIVE model catalog: the host client's own provider groups
   * (`{ id, name, models: [{ id, name, reasoning?: { efforts: [{ id, name }] } }] }`).
   *
   * THE DEFECT THIS REPLACES (measured): a BARE `ctx.get` probe for `modelDirectories` can never
   * see the service — `@deepseek-ai/dsh-client-ui-model-selection` provides it from ANOTHER
   * plugin's
   * fiber, and cordis resolves services through the fiber's own scope, so the probe answered
   * `undefined` forever and the card silently rendered its DECLARED option lists (one provider).
   * The measured rule lives in this package's `src/web-client.js` header; the answer is the
   * dynamic form `ctx.inject(["modelDirectories", "sessions", "remote.session"], …)`, which waits
   * for the providers
   * WITHOUT parking this boot entry. They must NEVER be added to the module's declared
   * `inject`/`REQUIRED_SERVICES` list: a declared-but-unregistered service is fatal to the whole
   * page (`assertEntriesActive` turns it into a `pending` entry).
   *
   * THE SECOND DEFECT (measured in a real browser, `evidence/web-card-catalog/`): the injection
   * alone is not enough, because cordis services are CALLER-scoped — the service's own `ctx`
   * resolves to the ACCESSING ctx. The host's model-directory resolver declares
   * `inject = ["sessions","remote","remote.session"]` and reads `this.ctx.remote.session` inside
   * `directoryFor()`, so a caller that injected only `["modelDirectories","sessions"]` is REJECTED
   * with `cannot get property "remote.session" without inject`, the card degrades, and the UI shows
   * the declared fallback while the browser's own catalog carries two providers. The caller must
   * therefore declare the same dotted chain it makes the service read: `remote.session` is
   * NECESSARY AND SUFFICIENT (measured: `["modelDirectories","sessions"]` throws,
   * `+ "remote"` throws, `+ "remote.session"` is ready with 2 providers / 31 models). `remote` is
   * NOT added: `this.ctx.remote` is a FIRST-LEVEL read, which a caller-scoped call re-roots at the
   * RESOLVER's own fiber (where its `static inject` satisfies it) — only DOTTED seams are re-rooted
   * at the CALLER's injection fiber, so `remote` would be one more activation precondition and
   * nothing else. The name stays in the DYNAMIC inject list only: a declared-but-unregistered
   * service on a loader ENTRY is page-fatal (`assertEntriesActive`), while a parked dynamic
   * injection merely never fires and the card keeps its declared fallback.
   *
   * LIVE, not a one-shot snapshot: once a directory exists for the bound session it is
   * SUBSCRIBED, `load()`ed (so the catalog is really fetched), and every store notification
   * re-projects the card's own store — a provider/model that appears while the page is open shows
   * up without a rebuild. `directoryFor` THROWS for a session the host does not know, so every
   * step is wrapped and degrades to the declared lists — with `info()` saying so out loud.
   */
  function createLiveCatalog(hostCtx) {
    let directory
    let boundSessionId
    let groups = []
    let info = FALLBACK_CATALOG
    let unsubscribeStore = null
    let unsubscribeSessions = null
    let fiber = null
    const listeners = new Set()

    function notify() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          /* a broken listener must not break the card */
        }
      }
    }

    /**
     * The CONSOLE SIGNAL: a degraded read used to be visible ONLY in the card's own paragraph at
     * the TOP of the section, which a user looking at the three slot pickers at the BOTTOM never
     * sees — and the fallback path was console-silent, which is how a dead catalog read survived a
     * whole verification wave. Exactly ONE warning when the state BECOMES a fallback (never
     * repeated while it stays one; re-armed when it returns to live and degrades again) and ONE
     * info when it becomes live. The sentence is `catalogNotice`'s — never a second wording.
     */
    /**
     * Announce a state change ONCE per transition. `pending` marks a fallback that is only the
     * sessions list still ENUMERATING: the card starts with the plugin (measured — the injected
     * callback fires during app BOOT, long before any conversation exists), so announcing that first
     * "no session is bound" put a `[mpd]` WARNING into every healthy boot while nothing was wrong.
     * The rendered state is unchanged (the visible fallback paragraph still says exactly this); only
     * the CONSOLE announce waits for the list to settle, so a warning means a degrade again.
     */
    let announcedMode
    function publish(nextGroups, nextInfo) {
      groups = nextGroups
      info = nextInfo
      const mode = info !== null && info !== undefined && info.mode === "live" ? "live" : "fallback"
      const pending = info !== null && info !== undefined && info.pending === true
      if (pending !== true && mode !== announcedMode) {
        announcedMode = mode
        const sentence = catalogNotice(info)
        if (mode === "live") console.info("[mpd] model catalog:", sentence)
        else console.warn("[mpd] model catalog:", sentence)
      }
      notify()
    }

    function fallback(reason, pending) {
      publish([], { mode: "fallback", providers: 0, models: 0, notice: CATALOG_FALLBACK_NOTICE, reason, pending: pending === true })
    }

    function releaseDirectory() {
      if (unsubscribeStore !== null) {
        try {
          unsubscribeStore()
        } catch {
          /* the store may already be gone */
        }
        unsubscribeStore = null
      }
      directory = undefined
    }

    /** Re-read the bound directory's store and republish (live: called on every notification). */
    function readStore() {
      try {
        const store = directory ? directory.store : undefined
        const snapshot = store && typeof store.getSnapshot === "function" ? store.getSnapshot() : undefined
        const raw = snapshot && Array.isArray(snapshot.groups) ? snapshot.groups : []
        const next = raw.filter((group) => group !== null && typeof group === "object" && typeof group.id === "string" && Array.isArray(group.models))
        if (next.length === 0) {
          fallback("the model directory for this session reports no provider")
          return
        }
        const counts = catalogCounts(next)
        publish(next, { mode: "live", providers: counts.providers, models: counts.models })
      } catch {
        fallback("the model directory could not be read")
      }
    }

    function bindDirectory(directories, sessions, force) {
      const sessionId = boundSessionIdOf(sessions)
      // A session-list notification is not a reason to re-fetch an unchanged directory: only a
      // real SWITCH (or a provider remount, which passes force) rebinds and reloads.
      if (force !== true && sessionId !== undefined && sessionId === boundSessionId && directory !== undefined) return
      boundSessionId = sessionId
      releaseDirectory()
      try {
        if (directories === null || directories === undefined || typeof directories.directoryFor !== "function") {
          fallback("no model directory service is registered")
          return
        }
        if (sessionId === undefined) {
          // "the list has not enumerated yet" is NOT the same state as "the list is ready and offers
          // no bindable session": only the second is a degrade worth a console warning.
          const snapshot = listSnapshotOf(sessions)
          const enumerating = snapshot !== undefined && snapshot !== null && snapshot.phase !== "ready"
          fallback("no session is bound", enumerating)
          return
        }
        const found = directories.directoryFor(sessionId)
        if (found === null || found === undefined) {
          fallback("the host resolved no model directory for this session")
          return
        }
        directory = found
        const store = found.store
        if (store && typeof store.subscribe === "function") unsubscribeStore = store.subscribe(() => readStore())
        readStore()
        if (typeof found.load === "function") {
          try {
            Promise.resolve(found.load()).then(() => readStore(), () => { /* a failed load keeps the last snapshot */ })
          } catch {
            /* a synchronous throw keeps the last snapshot */
          }
        }
      } catch (error) {
        // directoryFor THROWS for a session the host does not know — and for a CALLER whose inject
        // list does not satisfy the service's own reads (`cannot get property "remote.session"
        // without inject`, the measured defect). Degrade, never crash the card, and NAME the cause:
        // a mislabeled fallback is what kept this defect invisible in the UI for a whole lane.
        const detail = error !== null && error !== undefined && typeof error.message === "string" ? error.message : ""
        fallback("the host resolved no model directory for this session" + (detail === "" ? "" : ": " + detail.slice(0, 160)))
      }
    }

    function bind(scoped) {
      releaseDirectory()
      if (unsubscribeSessions !== null) {
        try {
          unsubscribeSessions()
        } catch {
          /* the list may be gone */
        }
        unsubscribeSessions = null
      }
      const directories = readService(scoped, "modelDirectories")
      const sessions = readService(scoped, "sessions")
      try {
        const list = sessions ? sessions.list : undefined
        // A session SWITCH re-binds the directory: the picker follows the session the page is on.
        if (list && typeof list.subscribe === "function") unsubscribeSessions = list.subscribe(() => bindDirectory(directories, sessions, false))
      } catch {
        unsubscribeSessions = null
      }
      // The injection itself is a (re)bind: a provider remount must never keep a stale directory.
      bindDirectory(directories, sessions, true)
    }

    return {
      /** Start the dynamic injection. The scoped ctx of the callback is what reads the services. */
      start() {
        if (typeof hostCtx?.inject !== "function") {
          fallback("the client runtime exposes no ctx.inject")
          return false
        }
        try {
          // The CALLER-SCOPED chain: `remote.session` is what the host's directory resolver reads on
          // ITS ctx, and cordis resolves a service's ctx to the ACCESSING ctx — so it must be
          // declared HERE (dynamically; never in the module's declared inject) or `directoryFor`
          // throws `cannot get property "remote.session" without inject`. Measured necessary AND
          // sufficient; see the class comment above.
          fiber = hostCtx.inject(["modelDirectories", "sessions", "remote.session"], (scoped) => bind(scoped))
        } catch (error) {
          console.warn("[mpd] settings section: the model catalog could not be injected: " + String(error))
          fallback("the model catalog injection failed")
          return false
        }
        return true
      },
      dispose() {
        releaseDirectory()
        if (unsubscribeSessions !== null) {
          try {
            unsubscribeSessions()
          } catch {
            /* the list may be gone */
          }
          unsubscribeSessions = null
        }
        if (fiber !== null && typeof fiber.dispose === "function") {
          try {
            fiber.dispose()
          } catch {
            /* the fiber may already be gone */
          }
        }
        fiber = null
        listeners.clear()
      },
      groups: () => groups,
      info: () => info,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
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
  function createMpdCardController(scope, fields = FIELDS, disclosure = { BRIDGE_DISCLOSURE, BRIDGE_RESTART_LIMIT, NO_WORKSPACE_NOTICE }, catalogInfo = () => FALLBACK_CATALOG) {
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
        // Which branch produced the slot option lists — LIVE (with counts) or the declared
        // fallback. It rides the card's OWN store, so a catalog change re-projects the card.
        catalog: catalogInfo() ?? FALLBACK_CATALOG,
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
      /** Re-project after an EXTERNAL change (the live catalog): the card's store is the channel. */
      refresh: () => {
        publish()
      },
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
      // The catalog branch this render used. Silent fallback is what hid the defect, so the state
      // is part of the rendered output (and of the data attributes) — never implicit.
      const catalog = state.catalog ?? FALLBACK_CATALOG
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
        // The twelve slot rows carry the fallback marker; the thirteen scalar rows are untouched.
        const hint = t(key + ".hint") + (field.path[0] === TEAM_MODEL_SLOT ? slotFallbackMarker(catalog) : "")
        // HUMAN SENTENCE FIRST, at full readability; the row's dotted KEY sits BENEATH it, dimmer.
        // The bridge DISCLOSURE is not here at all any more — it is stated once at the top of the
        // card. Repeating it per row is what buried every row's own sentence (measured in a real
        // browser: 2026-09-27, `05b-mpd-section.png`).
        const keyAt = hint.indexOf("mpd.jsonc " + key)
        // The key sits inside parentheses now, so drop the opening one the slice leaves behind.
        const human = keyAt > 0 ? hint.slice(0, keyAt).replace(/\(\s*$/, "").trim() : ""
        const pointer = keyAt < 0 ? hint : hint.slice(keyAt).replace(/\)\s*$/, "").trim()
        const hintNode = human.length === 0
          ? createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.7, marginBottom: 2 }, "data-mpd-row-key": key }, pointer)
          : createElement(
              "span",
              { style: { display: "block", marginBottom: 2 } },
              createElement("span", { style: { display: "block", fontSize: 12, opacity: 0.95 }, "data-mpd-row-human": key }, human),
              createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.6 }, "data-mpd-row-key": key }, pointer),
            )
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
          hintNode,
          input,
          createElement(
            "span",
            { style: { fontSize: 11, opacity: 0.7 } },
            (control.overridden ? "overridden · " : "") + (control.invalid ? "not a valid value · " : ""),
            createElement("button", { type: "button", disabled, onClick: () => props.resetField(key) }, t("reset")),
          ),
        )
      })
      // VISIBLE AT THE CONTROL: the four team-model pickers sit at the BOTTOM of the 25 rows,
      // where the section's top notice is off-screen — so the SAME sentence renders again
      // immediately above the first slot row (between the 13 scalar rows and the twelve slot rows),
      // in BOTH states. It carries its own `data-mpd-catalog-state`; the top notice keeps its own.
      const slotStart = fields.findIndex((field) => field.path[0] === TEAM_MODEL_SLOT)
      const scalarRows = slotStart < 0 ? rows : rows.slice(0, slotStart)
      const slotRows = slotStart < 0 ? [] : rows.slice(slotStart)
      const slotLine = createElement(
        "p",
        { style: { margin: "12px 0 4px", fontSize: 12, opacity: 0.75 }, [CATALOG_ATTR]: catalog.mode, "data-mpd-catalog-notice": "slots" },
        catalogNotice(catalog),
      )
      // Above each slot's THREE rows: the group heading and its one-line impact, so a reader sees
      // who the slot routes before reading a single hint. The rows stay DIRECT children of the card
      // (the heading/impact are siblings, not a wrapper), so every existing row lookup still holds.
      const slotChildren = []
      for (let index = 0; index < slotRows.length; index++) {
        const slot = String(fields[slotStart + index].path[1])
        const previous = index === 0 ? "" : String(fields[slotStart + index - 1].path[1])
        if (slot !== previous) {
          slotChildren.push(createElement(
            "div",
            { key: "group." + slot, style: { marginTop: 10, fontSize: 13, fontWeight: 700 }, "data-mpd-slot-group": slot },
            t("teamModels." + slot + ".heading"),
          ))
          slotChildren.push(createElement(
            "p",
            { key: "impact." + slot, style: { margin: "2px 0 0", fontSize: 11, opacity: 0.75 }, "data-mpd-slot-impact": slot },
            t("teamModels." + slot + ".impact"),
          ))
        }
        slotChildren.push(slotRows[index])
      }
      return createElement(
        "div",
        { style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: 12 } },
        createElement("h3", { style: { margin: "0 0 4px" } }, t("title")),
        createElement("p", { style: { margin: "0 0 8px", fontSize: 12, opacity: 0.75 } }, t("intro")),
        disabled
          ? createElement("p", { style: { margin: "0 0 8px", fontSize: 12, opacity: 0.75 } }, t("readOnly"))
          : null,
        createElement(
          "p",
          {
            style: { margin: "0 0 8px", fontSize: 12, opacity: 0.75 },
            [CATALOG_ATTR]: catalog.mode,
            "data-mpd-catalog-providers": String(catalog.providers ?? 0),
            "data-mpd-catalog-models": String(catalog.models ?? 0),
          },
          catalogNotice(catalog),
        ),
        // THE DISCLOSURE, ONCE. Every row used to carry it, which is what buried the rows.
        createElement("p", { style: { margin: "0 0 4px", fontSize: 12, opacity: 0.75 }, "data-mpd-disclosure": "bridge" },
          state.disclosure?.BRIDGE_DISCLOSURE ?? ""),
        createElement("p", { style: { margin: "0 0 4px", fontSize: 12, opacity: 0.75 }, "data-mpd-disclosure": "restart" },
          state.disclosure?.BRIDGE_RESTART_LIMIT ?? ""),
        // The not-lost clause belongs to the same statement; it used to ride every row's hint.
        createElement("p", { style: { margin: "0 0 4px", fontSize: 12, opacity: 0.75 }, "data-mpd-disclosure": "not-lost" },
          NOT_LOST),
        createElement("p", { style: { margin: "0 0 8px", fontSize: 12, opacity: 0.75 }, "data-mpd-disclosure": "workspace" },
          state.disclosure?.NO_WORKSPACE_NOTICE ?? ""),
        ...scalarRows,
        slotLine,
        ...slotChildren,
        createElement(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 10 } },
          createElement("button", { type: "button", disabled: disabled || !state.dirty || state.invalid, onClick: () => props.save() }, t("save")),
          createElement("button", { type: "button", disabled: !state.dirty, onClick: () => props.discard() }, t("discard")),
          createElement("span", { style: { fontSize: 12, opacity: 0.75 } }, state.saving ? t("saving") : state.failed ? state.error : state.dirty ? t("unsaved") : ""),
        ),
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
      en[key + ".hint"] = hintOf(field, "en")
      zh[key + ".hint"] = hintOf(field, "zh")
    }
    // The group heading and its one-line impact, per slot, in BOTH locales: the card renders them
    // above each slot's three rows, so a reader learns the group without parsing a hint sentence.
    for (const [index, slot] of SLOT_SLOTS.entries()) {
      const heading = slotHeading(slot, index + 1)
      en["teamModels." + slot + ".heading"] = heading.en
      zh["teamModels." + slot + ".heading"] = heading.zh
      en["teamModels." + slot + ".impact"] = impactOf(slot, "en")
      zh["teamModels." + slot + ".impact"] = impactOf(slot, "zh")
    }
    return { en, zh }
  }

  /**
   * Mount the section. The namespace's form comes from the harness's `configForms` service, so
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
          // THE FORM IS THE SCOPE. Until 2026-09-27 this block waited on
          // an injected `settingsScope` service, and that service exists NOWHERE in harness
          // 0.1.7-rc.2 (a grep over every @deepseek-ai/* client bundle returns nothing), so the
          // callback never fired: the Settings dialog rendered General / Models / Built-in
          // plugins / Agent presets with NO mpd section, and — because that path logged nothing
          // — the absence was silent. The harness's own sections reach their namespace through
          // `ctx.configForms.get(ns)`, whose controller carries the SAME shape this card already
          // used (`getSnapshot`, `subscribe`, `set`, `mutate`), so the card is unchanged and
          // only its host object moves.
          // Read it BOTH ways: a real client context exposes services as properties, while a
          // stub context (the offline harness) serves them through `get`. The card must not care
          // which one it is talking to.
          // STILL DEFERRED, and that is the point: `configForms` is provided by ANOTHER plugin's
          // fiber, so a one-shot probe at apply() races it. The DYNAMIC form waits for the
          // provider without parking this boot entry — a declared-but-absent service would turn
          // the whole page into `entry: pending` (the rule `web-client-adapt --self-test` pins).
          ctx.inject(["configForms"], (scoped) => {
            const forms = (typeof scoped.get === "function" ? scoped.get("configForms") : undefined) ?? scoped.configForms
            if (forms === undefined || forms === null || typeof forms.get !== "function") {
              console.warn("[mpd] settings section: this harness exposes no configForms service — the mpd section is not registered")
              return
            }
            const scope = forms.get(NS)
            // The LIVE catalog: injected (never probed), subscribed, and re-projected into the
            // card's own store on every change. Started BEFORE the registration so the first
            // render already carries the real list when the providers are up.
            const catalog = createLiveCatalog(ctx)
            const controller = createMpdCardController(scope, fields, undefined, () => catalog.info())
            const unsubscribeCatalog = catalog.subscribe(() => {
              controller.refresh()
            })
            catalog.start()
            // The slot leaves render their option lists from the LIVE catalog on every render.
            const Section = createCardComponent(require("react"), fields, () => catalog.groups())
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
              try {
                unsubscribeCatalog()
              } catch {
                /* already unsubscribed */
              }
              catalog.dispose()
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
    createLiveCatalog,
    catalogNotice,
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
    CATALOG_ATTR,
    CATALOG_FALLBACK_NOTICE,
  }
}
