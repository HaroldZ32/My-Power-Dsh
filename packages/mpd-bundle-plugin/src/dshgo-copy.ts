// THE WORDS THE TWO NATIVE PANELS SAY, IN THE LANGUAGE THE APP ON THE OTHER END SPEAKS.
//
// WHY A TABLE instead of literals: the panels are USER-facing surfaces, and every dsh-Go view function
// receives `caps.locale` as an argument. Today's v1 panel hard-coded English sentences; a bilingual app
// read them in Chinese. This module turns `caps.locale` into ONE record of strings, chosen once per
// build, so a view builder never branches on the locale itself.
//
// THE SELECTION IS DELIBERATELY CRUDE: a locale whose primary subtag is `zh` reads as Chinese and
// everything else as English. That is not a translation system — the two panels ship exactly two
// languages, matching the manifest's `{ en, zh }` titles — and an unknown tag therefore falls back to
// the app's own `[English]` spelling instead of inventing one.
import type { DshGoCaps } from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"

/** Every sentence a panel says, in one language; the builders read these fields and nothing else. */
export interface DshGoCopy {
  /** The `mpd` panel's hero title. */
  workbench: string
  /** The `mpd-team` panel's hero title. */
  board: string
  /** The `mpd` panel's four tab labels, in order. */
  tabsWorkbench: [string, string, string, string]
  /** The `mpd-team` panel's four tab labels, in order. */
  tabsBoard: [string, string, string, string]
  /** Metric labels: ready tasks, tasks in flight, finished tasks, members, tasks, blockers. */
  metricReady: string
  /** Metric label: tasks in flight. */
  metricActive: string
  /** Metric label: finished tasks. */
  metricDone: string
  /** Metric label: how many members the roster holds. */
  metricMembers: string
  /** Metric label: how many tasks the board holds. */
  metricTasks: string
  /** Metric label: how many rows are blocked. */
  metricBlocked: string
  /** The completion bar's label in the workbench hero. */
  completion: string
  /** A section header: the board's ready rows. */
  readyHeading: string
  /** The `refresh` button. */
  refresh: string
  /** The `approve` button (the one primary action). */
  approve: string
  /** The `dispatch` button. */
  dispatch: string
  /** Empty copy: no ready task. */
  emptyReady: [string, string]
  /** The questions tab's hero caption. */
  questionsCaption: string
  /** The custom-answer field's label and its submit button. */
  customAnswer: string
  /** The custom-answer form's submit label. */
  submit: string
  /** Empty copy: nothing is parked. */
  emptyQuestion: [string, string]
  /** The workmates tab's hero caption and empty copy. */
  workmatesCaption: string
  /** Empty copy: the library is empty. */
  emptyWorkmates: [string, string]
  /** The suffix that turns a use count into a sentence fragment. */
  uses: string
  /** The memory tab's hero caption and empty copy. */
  memoryCaption: string
  /** Empty copy: the store holds no entry yet. */
  emptyMemory: [string, string]
  /** The label of the reflection counter. */
  reflection: string
  /** The board tab's hero caption. */
  boardCaption: string
  /** The members tab's hero caption and empty copy. */
  membersCaption: string
  /** Empty copy: the team raised no member. */
  emptyMembers: [string, string]
  /** The detail tab's hero caption and empty copy. */
  detailCaption: string
  /** Empty copy: no task is selected. */
  emptyDetail: [string, string]
  /** Field labels: owner, dependencies, verdict, status, kind and the blocked-by count. */
  owner: string
  /** The detail tab's dependencies field. */
  dependencies: string
  /** The detail tab's verdict field. */
  verdict: string
  /** The detail tab's status field. */
  status: string
  /** The detail tab's kind field. */
  kind: string
  /** Field label: the blocked-by count. */
  blockedBy: string
  /** Why the detail tab carries no settle button, and where settling does happen. */
  settleHint: string
  /** The detail tab's three buttons. */
  complete: string
  /** The detail tab's fail button. */
  fail: string
  /** The detail tab's back button. */
  back: string
  /** The watchdog tab's hero caption. */
  watchdogCaption: string
  /** Watchdog field labels: the predicate in force and the recorded incidents. */
  predicate: string
  /** Watchdog field label: the incident list. */
  incidents: string
  /** The watchdog hold state words. */
  held: string
  /** The watchdog's not-held word. */
  notHeld: string
  /** Why the watchdog tab is read-only here. */
  watchdogReadOnly: string
  /** The watchdog tab's two buttons. */
  hold: string
  /** The watchdog tab's resume button. */
  resume: string
  /** Empty copy: no incident is recorded. */
  emptyIncidents: [string, string]
  /** Empty copy: this conversation has no team. */
  emptyTeam: [string, string]
  /** Empty copy: the board holds no task. */
  emptyBoard: [string, string]
  /** The note shown when a question offers more options than one button row can carry. */
  moreOptions: string
}

/** The English record; the app's own fallback language for an unknown tag. */
const EN: DshGoCopy = {
  workbench: "MPD Workbench",
  board: "Team Board",
  tabsWorkbench: ["Overview", "Questions", "Workmates", "Memory"],
  tabsBoard: ["Board", "Members", "Detail", "Watchdog"],
  metricReady: "Ready",
  metricActive: "Active",
  metricDone: "Done",
  metricMembers: "Members",
  metricTasks: "Tasks",
  metricBlocked: "Blocked",
  completion: "Completion",
  readyHeading: "Ready to dispatch",
  refresh: "Refresh",
  approve: "Approve plan",
  dispatch: "Dispatch",
  emptyReady: ["Nothing is ready", "Rows become ready when their blockers close; this list fills itself."],
  questionsCaption: "Answer what a teammate parked",
  customAnswer: "Custom answer",
  submit: "Send",
  emptyQuestion: ["No question is waiting", "When a member needs your answer, the question and its options appear here."],
  workmatesCaption: "Durable instances from the workmate library",
  emptyWorkmates: ["The library is empty", "A workmate appears here once one is initialized from a roster base."],
  uses: "uses",
  memoryCaption: "This agent's entries in this workspace, newest by write time",
  emptyMemory: ["No memory entry yet", "Notes, facts and reflections written by this agent show up here."],
  reflection: "Reflection",
  boardCaption: "The active team's board",
  membersCaption: "Who is on this team",
  emptyMembers: ["No member raised", "Approving a staged plan raises its members; they are listed here."],
  detailCaption: "The selected row",
  emptyDetail: ["No task selected", "Tap a row on the Board tab to read its contract here."],
  owner: "Owner",
  dependencies: "Dependencies",
  verdict: "Verdict",
  status: "Status",
  kind: "Kind",
  blockedBy: "Blocked by",
  settleHint: "Settling a row is the owning member's call; run it from that agent.",
  complete: "Complete",
  fail: "Fail",
  back: "Back",
  watchdogCaption: "The preserving hold and the recorded incidents",
  predicate: "Predicate",
  incidents: "Incidents",
  held: "Held",
  notHeld: "Running",
  watchdogReadOnly: "Pause and resume run from the captain's console, not from a tap.",
  hold: "Hold",
  resume: "Resume",
  emptyIncidents: ["No incident recorded", "A silence, a fence or a hold is recorded here when it happens."],
  emptyTeam: ["No team in this conversation", "Ask for a team, approve its plan, and its board appears here."],
  emptyBoard: ["The board is empty", "Tasks appear here as soon as a plan is approved."],
  moreOptions: "Only the first four options are shown; answer the rest from another client.",
}

/** The Chinese record: the manifest declares `zh`, so the panel speaks it when the app asks for it. */
const ZH: DshGoCopy = {
  workbench: "MPD 工作台",
  board: "团队看板",
  tabsWorkbench: ["总览", "问题", "工作伙伴", "记忆"],
  tabsBoard: ["看板", "成员", "详情", "看门狗"],
  metricReady: "就绪",
  metricActive: "进行",
  metricDone: "完成",
  metricMembers: "成员",
  metricTasks: "任务",
  metricBlocked: "阻塞",
  completion: "完成度",
  readyHeading: "可以派出的任务",
  refresh: "刷新",
  approve: "审批计划",
  dispatch: "派活",
  emptyReady: ["暂无就绪任务", "前置任务关闭后，这一行会自动出现。"],
  questionsCaption: "回答成员留给你的问题",
  customAnswer: "自定义回答",
  submit: "提交",
  emptyQuestion: ["还没有停下来的问题", "当有成员需要你回答时，问题和它的选项会出现在这里。"],
  workmatesCaption: "工作伙伴库里的持久实例",
  emptyWorkmates: ["工作伙伴库是空的", "从一个基础角色初始化后，实例会出现在这里。"],
  uses: "次使用",
  memoryCaption: "本工作区中这个 agent 的条目，按写入时间排序",
  emptyMemory: ["还没有记忆条目", "这个 agent 写下的笔记、事实和反思会出现在这里。"],
  reflection: "反思",
  boardCaption: "当前团队的看板",
  membersCaption: "团队里的成员",
  emptyMembers: ["还没有成员", "审批一份计划会拉起它的成员，名单出现在这里。"],
  detailCaption: "选中的任务",
  emptyDetail: ["还没有选中任务", "在「看板」里点一行，它的合同会出现在这里。"],
  owner: "负责人",
  dependencies: "依赖",
  verdict: "结论",
  status: "状态",
  kind: "类型",
  blockedBy: "被阻塞于",
  settleHint: "结算是持有该行的成员的决定；请从那个 agent 执行。",
  complete: "完成",
  fail: "失败",
  back: "返回",
  watchdogCaption: "保活暂停与已记录的事件",
  predicate: "判据",
  incidents: "事件",
  held: "已暂停",
  notHeld: "运行中",
  watchdogReadOnly: "暂停与继续要从队长的控制台执行，不能靠点击。",
  hold: "暂停",
  resume: "继续",
  emptyIncidents: ["暂无事件", "静默、围栏或暂停发生时，会记录在这里。"],
  emptyTeam: ["这个会话还没有团队", "申请一个团队并审批计划后，看板会出现在这里。"],
  emptyBoard: ["看板是空的", "计划审批通过后，任务会出现在这里。"],
  moreOptions: "只显示前四个选项；其余的请在另一个客户端回答。",
}

/**
 * Pick the copy record for the app on the other end.
 *
 * A NULL `caps` (the bridge told us nothing) reads as English: the panel must render words either way,
 * and the manifest's English title is the one the app shows when the locale is unknown.
 * @param caps - the capabilities the bridge handed the view function, or null/undefined when absent.
 * @returns the complete copy record for the selected language.
 */
export function copyFor(caps: DshGoCaps | null | undefined): DshGoCopy {
  /** The locale tag the app reported, lower-cased for the subtag test below. */
  const tag = typeof caps?.locale === "string" ? caps.locale.toLowerCase() : ""
  return tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_") ? ZH : EN
}
