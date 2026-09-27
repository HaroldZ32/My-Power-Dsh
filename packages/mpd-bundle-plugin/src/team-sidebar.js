// mpd bundle web client — the bundle's TEAM tab in the HARNESS'S OWN right sidebar.
//
// WHY THIS FILE EXISTS. The bundle's GUI used to register into `dsh-better-sidebar`, a
// THIRD-PARTY sidebar host. Measured on a real checkout install (`docker/ui/`, 2026-09-27):
// the profile's node_modules holds only `@mpd-dsh`, so that host is unresolvable, the bundle's
// guard correctly disables its row, and the rendered navigation carries NONE of this bundle's
// tabs — the team surface was unreachable from the UI at all.
//
// The harness ALREADY owns a right sidebar with a tab registry
// (`@deepseek-ai/dsh-client-ui-sidebar-right`: `ctx.sidebarRightTabs` plus the
// `sidebar.right.pane.tab` seat), and its own Files / Terminal / Browser tabs are built on it.
// This module registers a PAGE type there, so the tab ships wherever the harness ships:
//
//   • the TYPE  — `ctx.sidebarRightTabs.register({ id, kind, title, guide })`
//   • the BODY  — `ctx.slots.register({ name: "sidebar.right.pane.tab", key: id }, Body)`
//   • opening   — `ctx.sidebarRight.openTab(kind)`, or the guide entry the kit draws
//
// DATA comes from the Lead Session's `agentTeam` projection in the shared Session store — the
// same source the official Team UI reads — so this tab performs no RPC and keeps no state of
// its own: it is a VIEW of what the harness already recorded.
//
// Plain JS, React.createElement only: there is no JSX transform in this bundle. The module id,
// factory shape and export names follow `src/team-page.js` so the combined client
// (`scripts/build-mpd-client.mjs`) composes it the same way.
(require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  let react = require("react");
  let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

  const h = react.createElement;
  const TEAM_TAB_ID = "@mpd-dsh/team-sidebar";
  const TEAM_TAB_KIND = "mpd-team";

  /** Status → the colour a reader must be able to tell apart at a glance. */
  const STATUS_COLOR = {
    running: "#22a06b",
    active: "#22a06b",
    completed: "#22a06b",
    provisioning: "#c98a12",
    in_progress: "#2f6fed",
    inactive: "#8a8f98",
    pending: "#8a8f98",
    failed: "#d64545",
    deleted: "#c9ccd1",
  };

  const dim = { color: "var(--dsh-color-text-secondary, #8a8f98)", fontSize: "11px" };
  const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
  const rowStyle = { display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", minWidth: 0 };
  const dot = (color) => ({ width: "7px", height: "7px", borderRadius: "50%", flex: "0 0 auto", background: color });
  const chip = (color) => ({
    display: "inline-block", padding: "0 6px", borderRadius: "9px", fontSize: "10px", lineHeight: "16px",
    border: "1px solid " + color, color, whiteSpace: "nowrap", flex: "0 0 auto",
  });

  /**
   * The tab body: roster + shared task board + a completion bar.
   *
   * @param props - seat props from `sidebar.right.pane.tab`; `sessionId` comes from the seat's
   *   own `inject`, and `useSessions`/`useSession` from the primitives package.
   */
  function TeamSidebarBody(props) {
    const sessionId = props.sessionId;
    const useSessions = props.useSessions || primitives.useSessions;
    const useSession = props.useSession || primitives.useSession;
    // A teammate's own panel addresses the LEAD's board: the same rule the official UI uses.
    const ambientLead = typeof useSession === "function"
      ? useSession((snapshot) => snapshot?.subagent?.address?.parentSessionId)
      : undefined;
    const leadId = ambientLead || sessionId;
    const team = typeof useSessions === "function"
      ? useSessions((state) => (leadId === undefined ? undefined : state.projectionsBySession?.[leadId]?.values?.agentTeam))
      : undefined;

    if (team === undefined) {
      return h("div", { style: { padding: "12px", fontSize: "12px", ...dim } },
        "No team in this session yet. Ask the Lead to spawn one with spawn_teammate.");
    }
    const members = Array.isArray(team.members) ? team.members : [];
    const tasks = Array.isArray(team.tasks) ? team.tasks : [];
    const done = tasks.filter((task) => task.status === "completed").length;
    const percent = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);

    return h("div", { style: { padding: "10px 12px 14px", overflowY: "auto" } },
      h("div", { style: { display: "flex", alignItems: "baseline", gap: "8px" } },
        h("strong", { style: { fontSize: "12px" } }, "Team progress"),
        h("span", { style: dim }, done + "/" + tasks.length + " done"),
      ),
      h("div", { style: { height: "6px", borderRadius: "3px", background: "var(--dsh-color-fill-secondary, #e6e8eb)", marginTop: "6px", overflow: "hidden" } },
        h("div", { style: { height: "100%", width: percent + "%", background: "#22a06b" } }),
      ),
      team.failure === undefined ? null
        : h("div", { style: { ...dim, color: "#d64545", marginTop: "6px" } }, String(team.failure)),

      h("div", { style: { ...dim, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "12px" } }, "Members (" + members.length + ")"),
      members.length === 0
        ? h("div", { style: { ...dim, padding: "4px 0" } }, "No member yet.")
        : members.map((member) => h("div", { key: String(member.id), style: rowStyle },
            h("span", { style: dot(STATUS_COLOR[member.phase] || "#8a8f98") }),
            h("span", { style: { ...ellipsis, fontSize: "12px" } }, String(member.name)),
            h("span", { style: chip(member.role === "lead" ? "#6b4fd8" : "#8a8f98") }, String(member.role)),
            member.error === undefined ? null : h("span", { style: { ...dim, color: "#d64545", ...ellipsis } }, String(member.error)),
          )),

      h("div", { style: { ...dim, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "12px" } }, "Tasks (" + tasks.length + ")"),
      tasks.length === 0
        ? h("div", { style: { ...dim, padding: "4px 0" } }, "No shared task yet.")
        : tasks.map((task) => h("div", { key: String(task.id), style: { ...rowStyle, alignItems: "flex-start" } },
            h("span", { style: chip(STATUS_COLOR[task.status] || "#8a8f98") }, String(task.status)),
            h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
              h("div", { style: { ...ellipsis, fontSize: "12px" } }, String(task.subject)),
              h("div", { style: { ...dim, ...ellipsis } },
                (task.ownerName === undefined ? "unowned" : String(task.ownerName)) +
                (Array.isArray(task.blockedBy) && task.blockedBy.length > 0 ? " · blocked by " + task.blockedBy.join(", ") : "") +
                (task.ready === false ? " · not ready" : "")),
            ))),
    );
  }

  /** Services the client context must carry before this module applies. */
  const inject = ["slots", "locale", "sidebarRight", "sidebarRightTabs"];
  const NS = "mpdTeamSidebar";

  /**
   * Register the Team page type and its body on a CLIENT context.
   *
   * The GUIDE ENTRY is not a callback: it names a `commandId`, and the command behind it is a
   * client SHORTCUT (§ "the guide" in `@deepseek-ai/dsh-client-ui-sidebar-right`). Copy is
   * locale-bound FUNCTIONS, not strings — both shapes are taken from the shipped
   * `@deepseek-ai/dsh-client-ui-sidebar-browser` definition, which is the working example of a
   * page type with a guide entry.
   *
   * @param ctx - client plugin context with the declared `inject` services available.
   */
  function apply(ctx) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, {
      en: {
        "type.label": "Team",
        "guide.title": "Team",
        "guide.description": "Roster and shared task progress for this session",
      },
      zh: {
        "type.label": "团队",
        "guide.title": "团队",
        "guide.description": "本会话的名册与共享任务进度",
      },
    }), "mpd-team-sidebar:copy");

    // The user-facing way in: a command the kit renders as a guide entry box.
    ctx.inject(["shortcuts"], (scope) => {
      scope.effect(() => scope.shortcuts.register({
        id: "mpd-team.new",
        label: () => t("guide.title"),
        aliases: ["team", "open team tab"],
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => ({ status: "handled", run: () => ctx.sidebarRight.openTab(TEAM_TAB_KIND) }),
      }), "mpd-team-sidebar:command");
    });

    ctx.effect(() => ctx.sidebarRightTabs.register({
      id: TEAM_TAB_ID,
      kind: TEAM_TAB_KIND,
      priority: "extension",
      title: () => t("type.label"),
      guide: [{
        id: "new",
        commandId: "mpd-team.new",
        order: 40,
        title: () => t("guide.title"),
        description: () => t("guide.description"),
      }],
    }), "mpd-team-sidebar:type");

    ctx.effect(() => ctx.slots.register({
      name: "sidebar.right.pane.tab",
      key: TEAM_TAB_ID,
      locale: NS,
      inject: (sessionId) => ({ sessionId }),
    }, TeamSidebarBody), "mpd-team-sidebar:body");
  }

  module.exports = { inject, apply, TeamSidebarBody, TEAM_TAB_ID, TEAM_TAB_KIND };
  return module.exports;
}
