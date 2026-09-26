window.__ModuleLoader__.load({
	id: "@nanmicoder/dsh-agent-teams",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		/** Compact `provider/model` route, or just the model when the provider is absent. */
		function memberRouteLabel(member) {
			if (member === void 0) return "";
			const provider = member.provider?.trim() ?? "";
			const model = member.model?.trim() ?? "";
			if (provider !== "" && model !== "") return `${provider}/${model}`;
			return model;
		}
		/**
		* Compact route shown on a running task. Prefer the task's own snapshot
		* field; fall back to the assignee member when older hosts omit it.
		*/
		function taskModelLabel(task, members) {
			const direct = task.model?.trim() ?? "";
			if (direct !== "") return direct;
			return memberRouteLabel(members.find((candidate) => candidate.name === task.assignee));
		}
		/** Short model id for tight DAG/chip surfaces (`openai/gpt-5.6-sol` → `gpt-5.6-sol`). */
		function compactModelLabel(route) {
			const trimmed = route.trim();
			if (trimmed === "") return "";
			const slash = trimmed.lastIndexOf("/");
			return slash === -1 ? trimmed : trimmed.slice(slash + 1);
		}
		/** Whether the captain chat should keep showing the in-progress banner. */
		function teamIsActive(team) {
			if (team.halted === true || team.phase === "staged") return false;
			if (team.members.some((member) => member.activity === "working" || member.status === "working")) return true;
			if (team.tasks.some((task) => task.status === "pending" || task.status === "claimed" || task.status === "in_progress")) return true;
			return team.members.length > 0 && team.tasks.length === 0;
		}
		/** Use a fill-width grid when the task graph has no real dependency edges. */
		function usesParallelTaskGrid(tasks) {
			if (tasks.length === 0) return false;
			const taskIds = new Set(tasks.map((task) => task.id));
			return tasks.every((task) => task.dependencies.every((dependency) => !taskIds.has(dependency)));
		}
		/**
		* Whether an expanded activity panel still belongs to the current session.
		*
		* The panel is mounted in the root-scoped shell overlay, so React does not
		* remount it when the conversation route changes. Ownership keeps an expanded
		* panel from leaking onto the new-session screen (or another conversation)
		* while its local open state is being reset.
		*/
		function activityPanelExpandedForSession(open, owner, current) {
			return open && owner !== void 0 && owner === current;
		}
		/**
		* Auto-expand only for live teams that appear after the current session's
		* initial restore pass. Replayed cards, archived teams, and live teams restored
		* while reopening a conversation must remain behind the collapsed badge.
		*/
		function activityPanelShouldAutoExpand({ alreadyAutoOpened, pageSettled, restoreComplete, previousLiveTeamIds, currentLiveTeamIds }) {
			return !alreadyAutoOpened && pageSettled && restoreComplete && currentLiveTeamIds.some((teamId) => !previousLiveTeamIds.has(teamId));
		}
		/**
		* Resolve the task whose dependency chain should be highlighted.
		*
		* A pinned task is an explicit user choice. Keyboard focus takes precedence
		* over delayed pointer intent so an older hover timer cannot steal the active
		* chain from someone navigating the task map with the keyboard.
		*/
		function dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId) {
			return pinnedTaskId ?? keyboardTaskId ?? hoverTaskId;
		}
		/** Group tasks by their precomputed dependency depth. */
		function taskStages(tasks) {
			const byDepth = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0;
				const stage = byDepth.get(depth) ?? [];
				stage.push(task);
				byDepth.set(depth, stage);
			}
			return [...byDepth.entries()].sort(([left], [right]) => left - right).map(([depth, stageTasks]) => ({
				depth,
				tasks: stageTasks.slice().sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }))
			}));
		}
		/**
		* Lay tasks out as the reference panel's compact left-to-right DAG.
		*
		* Columns are dependency-depth stages. Rows are stable task-id order within
		* each stage. Edges use cubic curves so fan-in remains readable without
		* turning every task into a large card.
		*/
		function compactDagLayout(tasks) {
			const stages = taskStages(tasks);
			const positions = /* @__PURE__ */ new Map();
			const nodes = [];
			for (const [column, stage] of stages.entries()) for (const [row, task] of stage.tasks.entries()) {
				const x = column * 118;
				const y = row * 38;
				positions.set(task.id, {
					x,
					y
				});
				nodes.push({
					task,
					x,
					y
				});
			}
			const edges = [];
			for (const task of tasks) {
				const target = positions.get(task.id);
				if (target === void 0) continue;
				for (const dependency of task.dependencies) {
					const source = positions.get(dependency);
					if (source === void 0) continue;
					const x1 = source.x + 92;
					const y1 = source.y + 30 / 2;
					const x2 = target.x;
					const y2 = target.y + 30 / 2;
					edges.push({
						from: dependency,
						to: task.id,
						path: `M${x1} ${y1}C${x1 + 14} ${y1},${x2 - 14} ${y2},${x2} ${y2}`
					});
				}
			}
			const rows = Math.max(1, ...stages.map((stage) => stage.tasks.length));
			return {
				width: stages.length === 0 ? 0 : stages.length * 92 + (stages.length - 1) * 26,
				height: stages.length === 0 ? 0 : rows * 30 + (rows - 1) * 8,
				nodes,
				edges
			};
		}
		/**
		* Return the complete upstream/downstream chain around one task.
		*
		* Traversal uses both dependency directions and remains cycle-safe, so the UI
		* can highlight every handoff related to the focused task even if malformed
		* durable data contains a cycle.
		*/
		function relatedTaskIds(taskId, tasks) {
			const byId = new Map(tasks.map((task) => [task.id, task]));
			if (!byId.has(taskId)) return /* @__PURE__ */ new Set();
			const dependents = /* @__PURE__ */ new Map();
			for (const task of tasks) for (const dependency of task.dependencies) {
				const targets = dependents.get(dependency) ?? [];
				targets.push(task.id);
				dependents.set(dependency, targets);
			}
			const related = /* @__PURE__ */ new Set();
			const upstreamSeen = /* @__PURE__ */ new Set();
			const downstreamSeen = /* @__PURE__ */ new Set();
			const visitUpstream = (id) => {
				if (upstreamSeen.has(id)) return;
				upstreamSeen.add(id);
				related.add(id);
				for (const dependency of byId.get(id)?.dependencies ?? []) visitUpstream(dependency);
			};
			const visitDownstream = (id) => {
				if (downstreamSeen.has(id)) return;
				downstreamSeen.add(id);
				related.add(id);
				for (const dependent of dependents.get(id) ?? []) visitDownstream(dependent);
			};
			visitUpstream(taskId);
			visitDownstream(taskId);
			return related;
		}
		//#endregion
		//#region lib/client/activity-monitor.js
		/** Shared, demand-driven state for the AgentTeams browser monitor. */
		const targets = /* @__PURE__ */ new Map();
		const targetListeners = /* @__PURE__ */ new Set();
		const snapshotListeners = /* @__PURE__ */ new Set();
		let targetSnapshot = [];
		let activitySnapshots = {
			teams: [],
			archivedTeams: []
		};
		function targetKey(sessionId, teamId) {
			return `${sessionId}\u0000${teamId}`;
		}
		function publishTargets() {
			targetSnapshot = [...targets.values()].filter((target) => target.active).map(({ key, sessionId, teamId }) => ({
				key,
				sessionId,
				teamId
			}));
			for (const listener of targetListeners) listener();
		}
		/** Subscribe to the active monitor-target list (React external-store shape). */
		function subscribeActivityMonitorTargets(listener) {
			targetListeners.add(listener);
			return () => {
				targetListeners.delete(listener);
			};
		}
		/** Read the stable active-target snapshot. */
		function getActivityMonitorTargetsSnapshot() {
			return targetSnapshot;
		}
		/**
		* Register one successful AgentTeams card as a monitoring demand.
		*
		* The returned cleanup is reference-counted so multiple cards and React
		* StrictMode remounts cannot stop another card's monitor.
		*/
		function monitorAgentTeam(sessionId, teamId) {
			const owner = sessionId.trim();
			const id = teamId.trim();
			if (owner === "" || id === "") return () => {};
			const key = targetKey(owner, id);
			const existing = targets.get(key);
			if (existing === void 0) {
				targets.set(key, {
					key,
					sessionId: owner,
					teamId: id,
					refs: 1,
					active: true
				});
				publishTargets();
			} else {
				existing.refs += 1;
				if (!existing.active) {
					existing.active = true;
					publishTargets();
				}
			}
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const current = targets.get(key);
				if (current === void 0) return;
				current.refs -= 1;
				if (current.refs <= 0) {
					targets.delete(key);
					if (current.active) publishTargets();
				}
			};
		}
		/** Stop polling targets whose final archived snapshot has been captured. */
		function settleActivityMonitorTargets(keys) {
			let changed = false;
			for (const key of keys) {
				const target = targets.get(key);
				if (target?.active !== true) continue;
				target.active = false;
				changed = true;
			}
			if (changed) publishTargets();
		}
		/** Subscribe to the shared live/archive snapshot. */
		function subscribeActivitySnapshots(listener) {
			snapshotListeners.add(listener);
			return () => {
				snapshotListeners.delete(listener);
			};
		}
		/** Read the stable shared live/archive snapshot. */
		function getActivitySnapshotsSnapshot() {
			return activitySnapshots;
		}
		/** Publish one or both successful state-route responses. */
		function updateActivitySnapshots(update) {
			const next = {
				teams: update.teams ?? activitySnapshots.teams,
				archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams
			};
			if (next.teams === activitySnapshots.teams && next.archivedTeams === activitySnapshots.archivedTeams) return;
			activitySnapshots = next;
			for (const listener of snapshotListeners) listener();
		}
		/** Poll cadence for the live host snapshot route. */
		const ACTIVITY_POLL_MS = 1e3;
		/**
		* Low-frequency probe cadence while a cardless discovery session still owns
		* no team. The probe keeps the panel able to pick up a team created later in
		* that session (e.g. a run_code-wrapped agent_teams_create) without turning
		* every ordinary session into a one-second filesystem scan.
		*/
		const ACTIVITY_PROBE_MS = 5e3;
		/** Host route serving live and archived team snapshots. */
		const ACTIVITY_STATE_URL = "/plugins/dsh-agent-teams/state";
		const ACTIVITY_HALT_URL = "/plugins/dsh-agent-teams/halt";
		/**
		* Start the single polling loop for the current session's requested targets.
		*
		* With neither targets nor a discovery session this is deliberately inert.
		* Explicit card targets poll at the live cadence from the start. A discovery
		* session performs an immediate live+archive restore pass, then — while it
		* still owns no team — probes on a low-frequency cadence, so a team created
		* later in that session (e.g. a run_code-wrapped agent_teams_create) is
		* discovered without a manual reload, without turning every ordinary session
		* into a one-second filesystem scan. The moment a team for the discovery
		* session appears, the controller upgrades to the live one-second cadence for
		* the rest of its lifetime. The caller — the session view, which stops the
		* controller when the session is no longer current — bounds the lifetime, and
		* archive state is refreshed when a target or a previously discovered live
		* team disappears.
		*/
		function startActivityPolling(monitorTargets, runtime = {}) {
			const discoverySessionId = runtime.discoverySessionId?.trim();
			if (monitorTargets.length === 0 && (discoverySessionId === void 0 || discoverySessionId === "")) return {
				firstTick: Promise.resolve(),
				stop: () => {}
			};
			const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init));
			const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
			const cancel = runtime.cancel ?? ((timer) => {
				clearInterval(timer);
			});
			const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots;
			const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets;
			let cancelled = false;
			let inFlight = false;
			let hot = monitorTargets.length > 0;
			let discoveryComplete = false;
			let discoveredLiveKeys = /* @__PURE__ */ new Set();
			let controller;
			let timer;
			const intervalMs = () => hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS;
			const reschedule = () => {
				cancel(timer);
				timer = schedule(() => {
					tick();
				}, intervalMs());
			};
			const tick = async () => {
				if (inFlight || cancelled) return;
				inFlight = true;
				controller = new AbortController();
				try {
					const liveResponse = await fetchState(ACTIVITY_STATE_URL, {
						cache: "no-store",
						signal: controller.signal
					});
					if (!liveResponse.ok) return;
					const body = await liveResponse.json();
					if (cancelled || !Array.isArray(body.teams)) return;
					const liveTeams = body.teams;
					publishSnapshots({ teams: liveTeams });
					const previousDiscoveredKeys = discoveredLiveKeys;
					discoveredLiveKeys = new Set(discoverySessionId === void 0 || discoverySessionId === "" ? [] : liveTeams.filter((team) => team.captainSessionId === discoverySessionId).map((team) => team.teamId));
					if (!hot && discoveredLiveKeys.size > 0) {
						hot = true;
						reschedule();
					}
					const discoveredTeamArchived = [...previousDiscoveredKeys].some((teamId) => !discoveredLiveKeys.has(teamId));
					const missing = monitorTargets.filter((target) => !liveTeams.some((team) => team.captainSessionId === target.sessionId && team.teamId === target.teamId));
					const needsDiscoveryArchive = discoverySessionId !== void 0 && discoverySessionId !== "" && !discoveryComplete;
					if (missing.length === 0 && !needsDiscoveryArchive && !discoveredTeamArchived) return;
					const archivedResponse = await fetchState(`${ACTIVITY_STATE_URL}?archived=1`, {
						cache: "no-store",
						signal: controller.signal
					});
					if (!archivedResponse.ok) return;
					const archivedBody = await archivedResponse.json();
					if (cancelled || !Array.isArray(archivedBody.teams)) return;
					publishSnapshots({ archivedTeams: archivedBody.teams });
					discoveryComplete = true;
					settleTargets(new Set(missing.map((target) => target.key)));
				} catch (error) {
					if (error?.name === "AbortError") return;
				} finally {
					inFlight = false;
				}
			};
			const firstTick = tick();
			if (timer === void 0) timer = schedule(() => {
				tick();
			}, intervalMs());
			return {
				firstTick,
				stop: () => {
					if (cancelled) return;
					cancelled = true;
					controller?.abort();
					cancel(timer);
				}
			};
		}
		//#endregion
		//#region lib/client/artwork.js
		/**
		* Shared whale artwork lookup for the activity panel and the conversation
		* card: role keywords map to the packaged role images; the captain always
		* uses the lead whale.
		* @module dsh-agent-teams/client/artwork
		*/
		/** Artwork route prefix served by the plugin host half. */
		const ART_BASE = "/plugins/dsh-agent-teams/assets/";
		/** V2 whale role artwork per role keyword. */
		const ROLE_ART = [
			[/data|analys|metric|performance|数据|分析|指标|性能/, "member-data-v2.png"],
			[/resear|investig|explor|study|研究|调查|探索|调研/, "member-researcher-v2.png"],
			[/\bqa\b|test|verif|quality|测试|质量|验证/, "member-qa-v2.png"],
			[/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程/, "member-engineer-v2.png"],
			[/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍/, "member-designer-v2.png"],
			[/secur|audit|risk|threat|review|安全|审计|审查|风险/, "member-security-v2.png"],
			[/docs|writer|product|spec|撰写|文案|写作|文档|规范/, "member-docs-v2.png"],
			[/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调/, "member-operator-v2.png"]
		];
		/** Captain artwork (always the lead whale). */
		const LEAD_ART = `${ART_BASE}team-lead-v2.png`;
		/** Status action artwork per member activity. */
		const ACTION_ART = {
			working: `${ART_BASE}action-working-v2.png`,
			idle: `${ART_BASE}action-sleeping-v2.png`,
			unknown: `${ART_BASE}action-thinking-v2.png`
		};
		/**
		* Member artwork URL, or null when no role matches (initial-letter fallback).
		* @param name - the member's display name.
		* @param role - the member's role text.
		* @returns the artwork URL, or null when unmatched.
		*/
		function memberArtUrl(name, role) {
			const identity = `${name} ${role}`.toLowerCase();
			for (const [pattern, art] of ROLE_ART) if (pattern.test(identity)) return `${ART_BASE}${art}`;
			return null;
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/dsh-agent-teams/dsh-agent-teams/src/client/AgentTeamsCard.module.css.mjs
		const css$1 = ".kPAopq_root{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module-platform);border-radius:10px;flex-direction:column;gap:8px;width:100%;min-width:0;padding:10px 12px;display:flex}.kPAopq_head{align-items:center;gap:8px;min-width:0;display:flex}.kPAopq_leadAvatar{object-fit:contain;filter:drop-shadow(0 1px 1px #122d4833);background:0 0;border:0;border-radius:0;flex:none;width:30px;height:30px}.kPAopq_teamName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:0 auto;font-size:13px;font-weight:600;line-height:20px;overflow:hidden}.kPAopq_memberCount{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;margin-left:auto;font-size:11px;line-height:16px}.kPAopq_panelButton{border:1px solid var(--dsw-alias-line-strong);background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;flex:none;padding:2px 8px;font-size:10.5px;font-weight:600;line-height:16px;transition:border-color .12s,color .12s}.kPAopq_panelButton:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.kPAopq_panelButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.kPAopq_members{flex-wrap:wrap;gap:6px;min-width:0;display:flex}.kPAopq_member{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);max-width:160px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:5px;padding:3px 8px 3px 3px;font-size:11px;font-weight:500;line-height:16px;transition:border-color .12s,background-color .12s;display:inline-flex}.kPAopq_member:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-fill-neutral)}.kPAopq_member:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.kPAopq_memberArt{object-fit:contain;filter:drop-shadow(0 1px 1px #122d482e);background:0 0;border:0;border-radius:0;width:24px;height:24px}.kPAopq_memberInitial{background:var(--dsw-alias-bg-fill-business);width:20px;height:20px;color:var(--dsw-alias-label-on-fill);border-radius:50%;justify-content:center;align-items:center;font-size:10px;font-weight:600;line-height:20px;display:inline-flex}.kPAopq_memberName{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}";
		const tagId$1 = "@nanmicoder/dsh-agent-teams/AgentTeamsCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var AgentTeamsCard_module_css_default = {
			"head": "kPAopq_head",
			"leadAvatar": "kPAopq_leadAvatar",
			"member": "kPAopq_member",
			"memberArt": "kPAopq_memberArt",
			"memberCount": "kPAopq_memberCount",
			"memberInitial": "kPAopq_memberInitial",
			"memberName": "kPAopq_memberName",
			"members": "kPAopq_members",
			"panelButton": "kPAopq_panelButton",
			"root": "kPAopq_root",
			"teamName": "kPAopq_teamName"
		};
		//#endregion
		//#region lib/client/AgentTeamsCard.js
		/**
		* AgentTeams conversation card: the lightweight in-conversation summary for
		* one team — the captain's whale avatar and name, the member roster as
		* clickable whale avatars (opening the member's subagent transcript), and
		* an "activity panel" button that re-activates the top-right floater.
		*
		* The floater and this card share the `agent-teams:open-panel` window event
		* so the card can summon the panel even after it was closed (or when an old
		* session is re-opened for review).
		* @module dsh-agent-teams/client/card
		*/
		/** Window event name the floater listens for to open itself. */
		const OPEN_PANEL_EVENT = "agent-teams:open-panel";
		/** Re-activate the top-right activity panel, carrying this team's summary
		* so the panel can show it even when the team no longer exists on disk
		* (historical session review). */
		function openActivityPanel(data) {
			window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: {
				teamId: data.teamId,
				captainSessionId: data.captainSessionId,
				teamName: data.teamName,
				members: data.members
			} }));
		}
		/** Render one durable team as a compact conversation card. */
		function AgentTeamsCard({ node, openMember, sessionId, t }) {
			const data = node.data;
			const owner = data.captainSessionId || sessionId;
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			(0, react.useEffect)(() => {
				return monitorAgentTeam(owner, data.teamId);
			}, [data.teamId, owner]);
			const snapshot = teams.find((team) => team.teamId === data.teamId && (owner === "" || team.captainSessionId === owner)) ?? archivedTeams.find((team) => team.teamId === data.teamId && (owner === "" || team.captainSessionId === owner));
			const resolved = (0, react.useMemo)(() => ({
				...data,
				captainSessionId: snapshot?.captainSessionId ?? owner,
				teamName: snapshot?.name ?? data.teamName,
				members: snapshot?.members.map((member) => ({
					id: member.id,
					name: member.name,
					role: member.role
				})) ?? data.members
			}), [
				data,
				owner,
				snapshot
			]);
			return (0, react_jsx_runtime.jsxs)("section", {
				className: AgentTeamsCard_module_css_default.root,
				"data-agent-teams-card": true,
				"data-team-id": resolved.teamId,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: AgentTeamsCard_module_css_default.head,
					children: [
						(0, react_jsx_runtime.jsx)("img", {
							className: AgentTeamsCard_module_css_default.leadAvatar,
							src: LEAD_ART,
							alt: "",
							"aria-hidden": true
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.teamName,
							title: resolved.teamName,
							children: resolved.teamName
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberCount,
							children: t("card.memberCount", { count: resolved.members.length })
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: AgentTeamsCard_module_css_default.panelButton,
							onClick: () => {
								openActivityPanel(resolved);
							},
							"aria-label": t("action.openActivityPanel"),
							title: t("action.openActivityPanel"),
							children: t("activity.panelButton")
						})
					]
				}), resolved.members.length > 0 && (0, react_jsx_runtime.jsx)("div", {
					className: AgentTeamsCard_module_css_default.members,
					children: resolved.members.map((member) => (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: AgentTeamsCard_module_css_default.member,
						onClick: () => {
							if (member.id !== "") openMember(owner, member.id);
						},
						title: member.role === "" ? member.name : `${member.name} · ${member.role}`,
						children: [memberArtUrl(member.name, member.role) !== null ? (0, react_jsx_runtime.jsx)("img", {
							className: AgentTeamsCard_module_css_default.memberArt,
							src: memberArtUrl(member.name, member.role) ?? "",
							alt: "",
							"aria-hidden": true
						}) : (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberInitial,
							children: member.name.trim().slice(0, 1).toUpperCase() || "?"
						}), (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberName,
							children: member.name
						})]
					}, member.id))
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/dsh-agent-teams/dsh-agent-teams/src/client/ActivityPanel.module.css.mjs
		const css = "html{--agent-teams-panel-shift:420px}html[data-agent-teams-panel-open] [data-phase=active]{box-sizing:border-box;padding-right:var(--agent-teams-panel-shift)}.aYQbCq_badge,.aYQbCq_panel{--dsw-alias-line-normal:var(--dsw-static-neutral-bluish-150,#e7e9ee);--dsw-alias-line-strong:color-mix(in srgb, var(--dsw-static-neutral-bluish-200,#e1e5ee) 50%, var(--dsw-static-neutral-bluish-300,#cfd3d6));--dsw-alias-bg-module:var(--dsw-alias-bg-layer-1,#fff);--dsw-alias-bg-fill-neutral:var(--dsw-static-neutral-bluish-100,#eef0f4);--dsw-alias-bg-fill-business:var(--dsw-alias-state-business-primary,#4d6bfe);--dsw-alias-bg-fill-success:var(--dsw-alias-state-success-primary,#12a150);--dsw-alias-bg-fill-warning:var(--dsw-alias-state-warn-primary,#e08700);--dsw-alias-bg-fill-danger:var(--dsw-alias-state-error-primary,#e5484d);--dsw-alias-state-success:var(--dsw-alias-state-success-primary,#12a150);--dsw-alias-state-warning:var(--dsw-alias-state-warn-primary,#e08700);--dsw-alias-state-danger:var(--dsw-alias-state-error-primary,#e5484d);--dsw-alias-label-on-fill:var(--dsw-alias-label-primary-inverted,#fff)}.aYQbCq_badge{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 92%, transparent);backdrop-filter:blur(16px);height:34px;box-shadow:0 8px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:7px;padding:0 12px;font-size:12px;font-weight:600;line-height:20px;transition:border-color .15s,transform .12s;display:inline-flex;position:absolute;top:64px;right:18px}.aYQbCq_badge:hover{border-color:var(--dsw-alias-line-strong);transform:translateY(-1px)}.aYQbCq_badge:active{transform:translateY(0)scale(.98)}.aYQbCq_badge:focus-visible,.aYQbCq_iconButton:focus-visible,.aYQbCq_memberRow:focus-visible,.aYQbCq_membersToggle:focus-visible,.aYQbCq_sectionToggleTitle:focus-visible,.aYQbCq_dagNode:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.aYQbCq_badgeDot,.aYQbCq_panelDot{background:var(--dsw-alias-label-tertiary);border-radius:50%;width:7px;height:7px}.aYQbCq_badgeDot[data-busy=true],.aYQbCq_panelDot[data-busy=true]{background:var(--dsw-alias-state-business-primary);animation:1.25s ease-in-out infinite aYQbCq_agentTeamsPulse}.aYQbCq_badgeCount,.aYQbCq_memberCount,.aYQbCq_teamStats,.aYQbCq_stageLabel,.aYQbCq_taskId{font-variant-numeric:tabular-nums}.aYQbCq_panel{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-line-strong) 58%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-module) 95%, transparent);backdrop-filter:blur(20px)saturate(1.08);box-shadow:0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent), 0 32px 72px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);will-change:transform;border-radius:16px;flex-direction:column;animation:.16s ease-out aYQbCq_agentTeamsPanelIn;display:flex;position:absolute;top:0;left:0;overflow:hidden}.aYQbCq_panel[data-dragging],.aYQbCq_panel[data-resizing]{user-select:none;box-shadow:0 16px 38px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent), 0 36px 78px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent)}@keyframes aYQbCq_agentTeamsPanelIn{0%{opacity:0}to{opacity:1}}@keyframes aYQbCq_agentTeamsPulse{0%,to{opacity:.42}50%{opacity:1}}.aYQbCq_panelHead{border-bottom:1px solid var(--dsw-alias-line-normal);cursor:grab;touch-action:none;flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:0 14px 0 16px;display:flex}.aYQbCq_panelHead:active,.aYQbCq_panel[data-dragging] .aYQbCq_panelHead{cursor:grabbing}.aYQbCq_panel[data-compact] .aYQbCq_panelHead{cursor:default;touch-action:auto}.aYQbCq_panelTitle{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:20px;display:inline-flex}.aYQbCq_panelControls{flex:none;align-items:center;gap:2px;display:inline-flex}.aYQbCq_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:7px;justify-content:center;align-items:center;padding:0;transition:background-color .12s,color .12s,transform .12s;display:inline-flex}.aYQbCq_iconButton:hover{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-primary)}.aYQbCq_iconButton:active{transform:scale(.94)}.aYQbCq_iconButton[data-control=dock][data-mode=docked] svg{transform:scaleX(-1)}.aYQbCq_resizeHandle{z-index:1;touch-action:none;position:absolute}.aYQbCq_resizeHandle[data-resize-edge=left]{cursor:ew-resize;width:8px;top:44px;bottom:8px;left:0}.aYQbCq_resizeHandle[data-resize-edge=bottom]{cursor:ns-resize;height:8px;bottom:0;left:12px;right:12px}.aYQbCq_resizeHandle[data-resize-edge=corner]{cursor:nwse-resize;width:18px;height:18px;bottom:0;right:0}.aYQbCq_resizeHandle[data-resize-edge=corner]:after{border-right:1px solid var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-label-tertiary);content:\"\";opacity:.52;width:7px;height:7px;position:absolute;bottom:4px;right:4px}.aYQbCq_teams{overscroll-behavior:contain;scrollbar-color:color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent) transparent;scrollbar-width:thin;flex-direction:column;min-height:0;display:flex;overflow-y:auto}.aYQbCq_teams::-webkit-scrollbar{width:6px}.aYQbCq_teams::-webkit-scrollbar-track{background:0 0}.aYQbCq_teams::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent);background-clip:padding-box;border:2px solid #0000;border-radius:999px}.aYQbCq_teams:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 44%, transparent);background-clip:padding-box}.aYQbCq_team{border-bottom:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:12px;padding:12px 14px 16px;display:flex;container:aYQbCq_agent-team/inline-size}.aYQbCq_team:last-child{border-bottom:0}.aYQbCq_teamHead{align-items:center;gap:10px;min-width:0;display:flex}.aYQbCq_teamName{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;font-weight:600;line-height:18px;overflow:hidden}.aYQbCq_teamStats{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;gap:8px;font-size:10.5px;line-height:16px;display:inline-flex}.aYQbCq_teamStopButton{border:1px solid var(--dsw-alias-line-normal);width:26px;height:26px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border-radius:7px;flex:none;place-items:center;padding:0;transition:border-color .15s,background .15s,color .15s;display:grid}.aYQbCq_teamStopButton:hover{border-color:color-mix(in srgb, var(--dsw-alias-state-danger) 42%, var(--dsw-alias-line-normal));background:color-mix(in srgb, var(--dsw-alias-state-danger) 7%, transparent);color:var(--dsw-alias-state-danger)}.aYQbCq_teamStopButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.aYQbCq_stopModalActions{justify-content:flex-end;gap:8px;display:flex}.aYQbCq_stopModalActions button{border:1px solid var(--dsw-alias-line-normal,#e7e9ee);background:var(--dsw-alias-bg-fill-neutral,#eef0f4);min-height:34px;color:var(--dsw-alias-label-primary,#1c1c1e);cursor:pointer;font:inherit;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:6px 13px;font-size:12px;font-weight:600;display:inline-flex}.aYQbCq_stopModalActions button[data-danger]{border-color:var(--dsw-alias-state-danger,#e5484d);background:var(--dsw-alias-state-danger,#e5484d);color:var(--dsw-alias-label-on-fill,#fff)}.aYQbCq_stopModalActions button:disabled{cursor:wait;opacity:.58}.aYQbCq_stopModalError{background:color-mix(in srgb, var(--dsw-alias-state-danger,#e5484d) 8%, transparent);color:var(--dsw-alias-state-danger,#e5484d);border-radius:8px;align-items:flex-start;gap:7px;margin:0;padding:9px 10px;font-size:12px;line-height:18px;display:flex}.aYQbCq_stopModalError svg{flex:none;margin-top:1px}.aYQbCq_sectionHead{justify-content:space-between;align-items:center;gap:8px;min-width:0;display:flex}.aYQbCq_sectionTitle{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:11px;font-weight:600;line-height:16px;display:inline-flex}.aYQbCq_sectionHint{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.aYQbCq_delegationSection{min-width:0}.aYQbCq_captainNode{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 32%, var(--dsw-alias-line-normal));background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-module));border-radius:10px;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:56px;padding:6px 10px;display:grid}.aYQbCq_captainAvatar,.aYQbCq_memberAvatar{flex:none;justify-content:center;align-items:center;display:inline-flex;position:relative}.aYQbCq_captainAvatar{width:46px;height:46px}.aYQbCq_leadAvatar,.aYQbCq_memberArt{object-fit:contain;filter:drop-shadow(0 1px 1px #122d4833);background:0 0;border:0;border-radius:0}.aYQbCq_leadAvatar{width:44px;height:44px}.aYQbCq_memberArt{width:40px;height:40px}.aYQbCq_captainInfo,.aYQbCq_memberInfo{flex-direction:column;min-width:0;display:flex}.aYQbCq_captainInfo{gap:2px}.aYQbCq_captainLine,.aYQbCq_memberLine{align-items:center;gap:6px;min-width:0;display:flex}.aYQbCq_captainName,.aYQbCq_memberName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;line-height:18px;overflow:hidden}.aYQbCq_captainRole,.aYQbCq_memberRole{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.aYQbCq_captainSummary,.aYQbCq_memberStatusLine{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:15px;overflow:hidden}.aYQbCq_memberModel,.aYQbCq_taskDetailModel{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;line-height:14px;overflow:hidden}.aYQbCq_captainState,.aYQbCq_memberState{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;align-items:center;gap:5px;font-size:10px;font-weight:500;line-height:15px;display:inline-flex}.aYQbCq_captainState[data-busy=true],.aYQbCq_memberState[data-activity=working]{color:var(--dsw-alias-state-business-primary)}.aYQbCq_workGlyph rect{opacity:.5}.aYQbCq_workGlyph[data-active=true] rect{animation:1.1s ease-in-out infinite aYQbCq_agentTeamsDot}@keyframes aYQbCq_agentTeamsDot{0%,to{opacity:.25}50%{opacity:1}}.aYQbCq_progressOverview{flex-direction:column;gap:7px;display:flex}.aYQbCq_progressTitle{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:16px}.aYQbCq_progressSegments{gap:3px;display:flex}.aYQbCq_progressSegments>span,.aYQbCq_progressEmpty{background:var(--dsw-alias-line-strong);border-radius:2px;flex:1;height:5px}.aYQbCq_progressEmpty{width:100%;display:block}.aYQbCq_progressSegments>span[data-state=running]{background:var(--dsw-alias-state-business-primary)}.aYQbCq_progressSegments>span[data-state=blocked]{background:var(--dsw-alias-state-warning)}.aYQbCq_progressSegments>span[data-state=completed]{background:var(--dsw-alias-state-success)}.aYQbCq_progressSegments>span[data-state=failed]{background:var(--dsw-alias-state-danger)}.aYQbCq_progressSegments>span[data-state=cancelled]{opacity:.55}.aYQbCq_progressLegend{color:var(--dsw-alias-label-tertiary);gap:10px;font-size:9.5px;line-height:14px;display:flex}.aYQbCq_progressLegend>span[data-state=running]{color:var(--dsw-alias-state-business-primary)}.aYQbCq_progressLegend>span[data-state=blocked]{color:var(--dsw-alias-state-warning)}.aYQbCq_progressLegend>span[data-state=completed]{color:var(--dsw-alias-state-success)}.aYQbCq_progressSummary{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-module));min-width:0;color:var(--dsw-alias-label-secondary);border-radius:8px;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;line-height:15px;display:flex}.aYQbCq_progressSummary[data-state=warning]{background:color-mix(in srgb, var(--dsw-alias-state-warning) 8%, var(--dsw-alias-bg-module))}.aYQbCq_progressSummary[data-state=completed]{background:color-mix(in srgb, var(--dsw-alias-state-success) 8%, var(--dsw-alias-bg-module))}.aYQbCq_progressSummary[data-state=discarded]{background:var(--dsw-alias-bg-fill-neutral)}.aYQbCq_progressSummary>span:last-child{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.aYQbCq_progressSummaryDot{background:var(--dsw-alias-state-business-primary);border-radius:50%;flex:none;width:5px;height:5px}.aYQbCq_progressSummary[data-state=warning] .aYQbCq_progressSummaryDot{background:var(--dsw-alias-state-warning)}.aYQbCq_progressSummary[data-state=completed] .aYQbCq_progressSummaryDot{background:var(--dsw-alias-state-success)}.aYQbCq_progressSummary[data-state=discarded] .aYQbCq_progressSummaryDot{background:var(--dsw-alias-label-tertiary)}.aYQbCq_membersToggle{background:var(--dsw-alias-bg-module-platform);width:100%;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:0;border-radius:8px;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;font-size:10.5px;font-weight:600;line-height:15px;display:flex}.aYQbCq_membersToggle:hover{background:var(--dsw-alias-bg-fill-neutral)}.aYQbCq_membersToggle>span{align-items:center;gap:5px;display:inline-flex}.aYQbCq_membersToggle>span:last-child{color:var(--dsw-alias-state-business-primary)}.aYQbCq_chevron{flex:none;transition:transform .14s}.aYQbCq_chevron[data-open=true]{transform:rotate(90deg)}.aYQbCq_delegationTree{flex-direction:column;gap:2px;margin-left:18px;padding:9px 0 0 20px;display:flex;position:relative}.aYQbCq_delegationTree:before{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-line-normal));content:\"\";width:1px;position:absolute;top:0;bottom:22px;left:0}.aYQbCq_memberBlock{flex-direction:column;min-width:0;padding:3px 0 7px;display:flex;position:relative}.aYQbCq_memberBranch{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-line-normal));width:20px;height:1px;display:block;position:absolute;top:27px;right:100%}.aYQbCq_memberBranch:before{background:var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;width:5px;height:5px;position:absolute;top:-2px;right:-1px}.aYQbCq_memberRow{box-sizing:border-box;width:100%;min-width:0;min-height:48px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;grid-template-columns:46px minmax(0,1fr) auto;align-items:center;gap:8px;padding:4px 6px;transition:background-color .12s,transform .12s;display:grid}.aYQbCq_memberRow:hover,.aYQbCq_memberRow[data-activity=working]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-module))}.aYQbCq_memberRow:active{transform:scale(.995)}.aYQbCq_memberAvatar{width:42px;height:42px}.aYQbCq_memberAvatar[data-unread=true]:after{box-sizing:border-box;border:1px solid var(--dsw-alias-bg-module);background:var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;width:6px;height:6px;animation:1.8s ease-in-out infinite aYQbCq_agentTeamsUnreadPulse;position:absolute;top:0;right:-1px}@keyframes aYQbCq_agentTeamsUnreadPulse{0%,to{opacity:.78;transform:scale(.92)}50%{opacity:1;transform:scale(1.16)}}.aYQbCq_memberInitial{background:var(--dsw-alias-bg-fill-business);width:34px;height:34px;color:var(--dsw-alias-label-on-fill);border-radius:50%;justify-content:center;align-items:center;font-size:14px;font-weight:600;line-height:20px;display:inline-flex}.aYQbCq_stateArt{box-sizing:border-box;object-fit:contain;width:22px;height:22px;filter:drop-shadow(0 0 1px var(--dsw-alias-bg-module)) drop-shadow(0 1px 1px #122d483d);background:0 0;border:0;border-radius:0;position:absolute;bottom:-3px;right:-5px}.aYQbCq_stateArt[data-activity=working]{animation:2.4s ease-in-out infinite aYQbCq_agentTeamsFloat}.aYQbCq_stateArt[data-activity=idle]{animation:4.2s ease-in-out infinite aYQbCq_agentTeamsBreathe}.aYQbCq_stateArt[data-activity=unknown]{animation:2.8s ease-in-out infinite aYQbCq_agentTeamsThink}@keyframes aYQbCq_agentTeamsFloat{0%,to{transform:translateY(0)rotate(-4deg)}50%{transform:translateY(-2px)rotate(4deg)}}@keyframes aYQbCq_agentTeamsBreathe{0%,to{opacity:.82;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}@keyframes aYQbCq_agentTeamsThink{0%,to{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}.aYQbCq_memberState{margin-left:auto}.aYQbCq_memberCount{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px}.aYQbCq_assignmentLine{align-items:center;gap:7px;min-width:0;padding:0 6px 0 60px;display:flex}.aYQbCq_assignmentLabel{color:var(--dsw-alias-label-tertiary);flex:none;font-size:9.5px;line-height:14px}.aYQbCq_assignmentTasks{flex-wrap:wrap;flex:1;gap:4px;min-width:0;display:flex}.aYQbCq_assignmentChip{background:var(--dsw-alias-bg-fill-neutral);max-width:100%;min-height:16px;color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;border-radius:4px;align-items:center;padding:0 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:600;line-height:14px;display:inline-flex;overflow:hidden}.aYQbCq_assignmentChip[data-state=running]{background:var(--dsw-alias-bg-fill-business);color:var(--dsw-alias-label-on-fill)}.aYQbCq_assignmentChip[data-state=completed]{background:var(--dsw-alias-bg-fill-success);color:var(--dsw-alias-label-on-fill)}.aYQbCq_assignmentChip[data-state=blocked]{background:var(--dsw-alias-bg-fill-warning);color:var(--dsw-alias-label-on-fill)}.aYQbCq_assignmentChip[data-state=failed]{background:var(--dsw-alias-bg-fill-danger);color:var(--dsw-alias-label-on-fill)}.aYQbCq_assignmentChip[data-state=cancelled]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}.aYQbCq_unreadPill{color:var(--dsw-alias-state-business-primary);white-space:nowrap;flex:none;font-size:9.5px;font-weight:600;line-height:14px}.aYQbCq_taskEmpty{color:var(--dsw-alias-label-tertiary);font-size:9.5px;line-height:14px}.aYQbCq_dependencySection{border-top:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:7px;min-width:0;padding-top:10px;display:flex}.aYQbCq_sectionToggleTitle{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0;font-size:11px;font-weight:600;line-height:16px;display:inline-flex}.aYQbCq_dagViewport{scrollbar-width:thin;min-width:0;padding:2px 0 4px;overflow-x:auto}.aYQbCq_dagCanvas{min-width:100%;position:relative}.aYQbCq_dagCanvas[data-layout=parallel]{flex-wrap:wrap;gap:8px;display:flex}.aYQbCq_dagCanvas[data-layout=parallel] .aYQbCq_dagNode{flex:92px;min-width:92px;position:relative}.aYQbCq_dagEdges{pointer-events:none;position:absolute;inset:0;overflow:visible}.aYQbCq_dagEdges path{fill:none;stroke:var(--dsw-alias-line-strong);stroke-width:1px;transition:opacity .14s,stroke .14s,stroke-width .14s}.aYQbCq_dagEdges path[data-active=true]{stroke:var(--dsw-alias-state-business-primary);stroke-width:1.6px}.aYQbCq_dagEdges path[data-dimmed=true]{opacity:.24}.aYQbCq_dagNode{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;border-radius:6px;flex-direction:column;justify-content:center;gap:1px;padding:0 6px;transition:border-color .14s,background-color .14s,opacity .14s;display:flex;position:absolute}.aYQbCq_dagNode:hover,.aYQbCq_dagNode[data-focused=true]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-module))}.aYQbCq_dagNode[data-dimmed=true]{opacity:.3}.aYQbCq_dagNode[data-state=running][data-dimmed=true]{opacity:.58}.aYQbCq_dagNode[data-state=completed]{border-color:color-mix(in srgb, var(--dsw-alias-state-success) 48%, var(--dsw-alias-line-normal))}.aYQbCq_dagNode[data-state=blocked]{border-color:color-mix(in srgb, var(--dsw-alias-state-warning) 52%, var(--dsw-alias-line-normal))}.aYQbCq_dagNode[data-state=failed]{border-color:color-mix(in srgb, var(--dsw-alias-state-danger) 56%, var(--dsw-alias-line-normal))}.aYQbCq_dagNodeHead{color:var(--dsw-alias-label-primary);align-items:center;gap:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;font-weight:700;display:flex}.aYQbCq_dagNodeDot{background:var(--dsw-alias-line-strong);border-radius:1.5px;flex:none;width:5px;height:5px}.aYQbCq_dagNode[data-state=running] .aYQbCq_dagNodeDot{background:var(--dsw-alias-state-business-primary)}.aYQbCq_dagNode[data-state=running] .aYQbCq_dagNodeHead{padding-right:12px}.aYQbCq_dagRunningState{width:9px;height:9px;color:var(--dsw-alias-state-business-primary);pointer-events:none;justify-content:center;align-items:center;display:inline-flex;position:absolute;top:4px;right:5px}.aYQbCq_dagRunningState .aYQbCq_workGlyph{width:9px;height:9px}.aYQbCq_dagNode[data-state=blocked] .aYQbCq_dagNodeDot{background:var(--dsw-alias-state-warning)}.aYQbCq_dagNode[data-state=completed] .aYQbCq_dagNodeDot{background:var(--dsw-alias-state-success)}.aYQbCq_dagNode[data-state=failed] .aYQbCq_dagNodeDot{background:var(--dsw-alias-state-danger)}.aYQbCq_dagNodeLabel{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:11px;overflow:hidden}.aYQbCq_taskDetail{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module-platform);border-radius:9px;flex-direction:column;gap:3px;min-width:0;padding:7px 9px;display:flex}.aYQbCq_taskDetailHead{align-items:center;gap:6px;min-width:0;display:flex}.aYQbCq_taskDetailId{color:var(--dsw-alias-state-business-primary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700}.aYQbCq_taskDetailSubject{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;line-height:16px;overflow:hidden}.aYQbCq_taskDetailBadge{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:0 5px;font-size:8.5px;font-weight:600;line-height:14px}.aYQbCq_taskDetailBadge[data-state=running]{background:var(--dsw-alias-bg-fill-business);color:var(--dsw-alias-label-on-fill)}.aYQbCq_taskDetailBadge[data-state=blocked]{background:var(--dsw-alias-bg-fill-warning);color:var(--dsw-alias-label-on-fill)}.aYQbCq_taskDetailBadge[data-state=completed]{background:var(--dsw-alias-bg-fill-success);color:var(--dsw-alias-label-on-fill)}.aYQbCq_taskDetailBadge[data-state=failed]{background:var(--dsw-alias-bg-fill-danger);color:var(--dsw-alias-label-on-fill)}.aYQbCq_taskDetailLine,.aYQbCq_taskDetailMeta{color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:14px}.aYQbCq_taskDetailMeta{color:var(--dsw-alias-label-tertiary)}.aYQbCq_emptyHint{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:11px;line-height:16px}.aYQbCq_planEditor{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, var(--dsw-alias-line-normal));background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 94%, var(--dsw-alias-state-business-primary));box-shadow:inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);border-radius:10px;flex-direction:column;gap:12px;margin:0 10px 12px;padding:12px;display:flex}.aYQbCq_planHeader>span{justify-content:space-between;align-items:center;gap:8px;display:flex}.aYQbCq_planHeader>span>span{flex-direction:column;gap:2px;min-width:0;display:flex}.aYQbCq_planHeader strong{color:var(--dsw-alias-label-primary);font-size:12px}.aYQbCq_planHeader small{color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:500;line-height:13px}.aYQbCq_planHeader em{background:var(--dsw-alias-bg-fill-business);color:var(--dsw-alias-label-on-fill);border-radius:999px;flex:none;padding:1px 7px;font-size:9px;font-style:normal;line-height:16px}.aYQbCq_planHeader p{color:var(--dsw-alias-label-secondary);margin:5px 0 0;font-size:10px;line-height:15px}.aYQbCq_planFlow{grid-template-columns:repeat(3,minmax(0,1fr));margin:0;padding:0;list-style:none;display:grid}.aYQbCq_planFlow li{min-width:0;color:var(--dsw-alias-label-tertiary);align-items:center;gap:5px;font-size:9px;font-weight:600;line-height:14px;display:flex;position:relative}.aYQbCq_planFlow li:not(:last-child):after{background:var(--dsw-alias-line-normal);content:\"\";flex:1;min-width:8px;height:1px;margin-right:5px}.aYQbCq_planFlow li>span{border:1px solid var(--dsw-alias-line-normal);border-radius:50%;flex:none;place-items:center;width:18px;height:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;display:grid}.aYQbCq_planFlow li[data-active]{color:var(--dsw-alias-state-business-primary)}.aYQbCq_planFlow li[data-active]>span{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)}.aYQbCq_planSection{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module-platform);border-radius:8px;overflow:hidden}.aYQbCq_planSectionToggle,.aYQbCq_planCardHeader{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:0}.aYQbCq_planSectionToggle{justify-content:space-between;align-items:center;gap:8px;min-height:42px;padding:7px 9px;display:flex}.aYQbCq_planSectionToggle:hover,.aYQbCq_planCardHeader:hover{background:color-mix(in srgb, var(--dsw-alias-bg-fill-neutral) 46%, transparent)}.aYQbCq_planSectionToggle>span{align-items:baseline;gap:7px;min-width:0;display:flex}.aYQbCq_planSectionToggle strong{font-size:10.5px}.aYQbCq_planSectionToggle small{color:var(--dsw-alias-label-tertiary);font-size:9px}.aYQbCq_planList{border-top:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:0;display:flex}.aYQbCq_planEmpty{color:var(--dsw-alias-label-tertiary);text-align:center;margin:0;padding:12px;font-size:10px}.aYQbCq_planCard{background:0 0;border:0;border-radius:0;min-width:0;margin:0;padding:0;display:block;position:relative}.aYQbCq_planCard+.aYQbCq_planCard{border-top:1px solid var(--dsw-alias-line-normal)}.aYQbCq_planCard[data-open=true]{background:color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent)}.aYQbCq_planCardHeader{grid-template-columns:minmax(80px,.9fr) minmax(72px,1.15fr) auto 12px;align-items:center;gap:7px;min-height:40px;padding:6px 9px;display:grid}.aYQbCq_planCardIdentity{flex-direction:column;gap:1px;min-width:0;display:flex}.aYQbCq_planCardIdentity strong,.aYQbCq_planTaskSummary{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:650;line-height:14px;overflow:hidden}.aYQbCq_planCardIdentity>span,.aYQbCq_planCardMeta{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:12px;overflow:hidden}.aYQbCq_planTaskId{background:var(--dsw-alias-bg-fill-neutral);width:max-content;color:var(--dsw-alias-label-secondary);border-radius:4px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8.5px;font-weight:700;line-height:14px}.aYQbCq_planDirty{background:color-mix(in srgb, var(--dsw-alias-state-warning) 13%, transparent);color:var(--dsw-alias-state-warning);border-radius:999px;justify-self:end;padding:1px 5px;font-size:8px;font-style:normal;font-weight:650;line-height:14px}.aYQbCq_planChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .18s cubic-bezier(.2,.7,.2,1)}.aYQbCq_planChevron[data-open=true]{transform:rotate(90deg)}.aYQbCq_planCardBody{flex-direction:column;gap:8px;padding:0 9px 9px;display:flex}.aYQbCq_planCardBody fieldset{border:0;flex-direction:column;gap:7px;min-width:0;margin:0;padding:0;display:flex}.aYQbCq_planCardBody label,.aYQbCq_planNewTask label{min-width:0;color:var(--dsw-alias-label-tertiary);flex-direction:column;flex:1;gap:4px;font-size:9px;display:flex}.aYQbCq_planCardBody label small{color:var(--dsw-alias-label-tertiary);font-size:8px;line-height:11px}.aYQbCq_planCard input,.aYQbCq_planCard textarea,.aYQbCq_planCard select,.aYQbCq_planNewTask input{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-base);width:100%;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:6px;outline:none;font-size:10.5px;line-height:16px;transition:border-color .16s,box-shadow .16s}.aYQbCq_planCard input,.aYQbCq_planCard select,.aYQbCq_planNewTask input{min-height:32px;padding:6px 8px}.aYQbCq_planCard textarea{resize:vertical;min-height:58px;padding:7px 8px}.aYQbCq_planCard input:focus-visible,.aYQbCq_planCard textarea:focus-visible,.aYQbCq_planCard select:focus-visible,.aYQbCq_planNewTask input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent)}.aYQbCq_planGrid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;display:grid}.aYQbCq_planModelPicker{grid-template-columns:minmax(0,1fr);gap:5px;display:grid}.aYQbCq_planModelMenu{width:100%;display:flex}.aYQbCq_planModelTrigger{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:100%;min-height:38px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;border-radius:7px;justify-content:space-between;align-items:center;gap:8px;padding:7px 9px;transition:border-color .16s,background-color .16s,transform .12s;display:flex}.aYQbCq_planModelTrigger:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.aYQbCq_planModelTrigger:active:not(:disabled){transform:translateY(1px)}.aYQbCq_planModelTrigger:focus-visible{border-color:var(--dsw-alias-state-business-primary);outline:2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);outline-offset:1px}.aYQbCq_planModelTrigger:disabled{cursor:wait;opacity:.64}.aYQbCq_planModelTriggerCopy{align-items:baseline;gap:6px;min-width:0;display:flex}.aYQbCq_planModelTriggerCopy strong,.aYQbCq_planModelTriggerCopy span{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.aYQbCq_planModelTriggerCopy strong{color:var(--dsw-alias-label-primary);font-size:10px;font-weight:650;line-height:15px}.aYQbCq_planModelTriggerCopy span{color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:14px}.aYQbCq_planModelMenuRow{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;min-width:0;display:grid}.aYQbCq_planModelMenuRow>span:first-child{color:var(--dsw-alias-label-primary)}.aYQbCq_planModelMenuRow strong{color:var(--dsw-alias-label-tertiary);text-align:right;text-overflow:ellipsis;white-space:nowrap;font-weight:450;overflow:hidden}.aYQbCq_planModelMenuBack{align-items:center;gap:7px;display:inline-flex}.aYQbCq_planModelMenuBack svg{transform:rotate(180deg)}.aYQbCq_planModelEffortRow{flex-direction:column;align-items:flex-start;min-width:0;display:flex}.aYQbCq_planModelEffortRow small{width:100%;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.aYQbCq_planModelHint{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:12px;overflow:hidden}.aYQbCq_planModelNotice{background:color-mix(in srgb, var(--dsw-alias-state-warning) 9%, transparent);color:var(--dsw-alias-label-secondary);border-radius:6px;grid-column:1/-1;justify-content:space-between;align-items:center;gap:8px;padding:6px 7px;font-size:8.5px;line-height:12px;display:flex}.aYQbCq_planModelNotice button{color:var(--dsw-alias-state-business-primary);cursor:pointer;font:inherit;background:0 0;border:0;flex:none;padding:2px 6px;font-weight:650}.aYQbCq_planActions,.aYQbCq_planApproveRow,.aYQbCq_planNewTask,.aYQbCq_planConfirm,.aYQbCq_planApproveActions,.aYQbCq_planSecondaryActions{align-items:center;gap:7px;display:flex}.aYQbCq_planReviewActions{grid-template-columns:minmax(0,1fr);gap:6px;width:100%;display:grid}.aYQbCq_planSecondaryActions{grid-template-columns:minmax(0,1fr) auto;display:grid}.aYQbCq_planActions{justify-content:flex-end}.aYQbCq_planActions button,.aYQbCq_planNewTask button,.aYQbCq_planApproveRow button,.aYQbCq_planConfirm button{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-fill-neutral);min-height:30px;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;flex:none;padding:5px 10px;font-size:9.5px;font-weight:600;transition:background .16s,border-color .16s,transform .16s}.aYQbCq_planActions button:hover:not(:disabled),.aYQbCq_planNewTask button:hover:not(:disabled),.aYQbCq_planApproveRow button:hover:not(:disabled),.aYQbCq_planConfirm button:hover:not(:disabled){border-color:var(--dsw-alias-label-tertiary)}.aYQbCq_planActions button:active:not(:disabled),.aYQbCq_planNewTask button:active:not(:disabled),.aYQbCq_planApproveRow button:active:not(:disabled),.aYQbCq_planConfirm button:active:not(:disabled){transform:scale(.98)}.aYQbCq_planActions button[data-danger],.aYQbCq_planConfirm button[data-danger]{color:var(--dsw-alias-state-danger)}.aYQbCq_planFeedback{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;align-items:center;gap:5px;font-size:9px;line-height:13px;animation:.18s ease-out aYQbCq_plan-feedback-in;display:inline-flex}.aYQbCq_planFeedback[data-tone=success]{color:var(--dsw-alias-state-success)}.aYQbCq_planFeedback[data-tone=error]{color:var(--dsw-alias-state-danger)}.aYQbCq_planFeedback>span{border:1px solid;border-radius:50%;flex:none;place-items:center;width:15px;height:15px;display:grid}.aYQbCq_planFeedback svg{width:11px;height:11px}@keyframes aYQbCq_plan-feedback-in{0%{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}.aYQbCq_planConfirm{border:1px solid color-mix(in srgb, var(--dsw-alias-state-danger) 30%, var(--dsw-alias-line-normal));background:color-mix(in srgb, var(--dsw-alias-state-danger) 7%, transparent);border-radius:7px;flex-wrap:wrap;justify-content:flex-end;padding:7px}.aYQbCq_planConfirm>span{min-width:140px;color:var(--dsw-alias-label-secondary);flex:1;font-size:9px;line-height:13px}.aYQbCq_planNewTask{align-items:flex-end}.aYQbCq_planNewTask label{gap:4px}.aYQbCq_planNewTask label>span{line-height:13px}.aYQbCq_planApproveRow{z-index:1;border:1px solid var(--dsw-alias-line-normal);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 94%, transparent);min-height:50px;box-shadow:0 -5px 16px color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent);backdrop-filter:blur(8px);border-radius:8px;flex-direction:column;justify-content:flex-end;align-items:stretch;margin:0 -4px -4px;padding:8px;position:sticky;bottom:0}.aYQbCq_planApproveRow[data-armed=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-line-normal))}.aYQbCq_planApproveRow[data-discard=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-danger) 45%, var(--dsw-alias-line-normal))}.aYQbCq_planApproveCopy{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.aYQbCq_planApproveCopy strong{color:var(--dsw-alias-label-primary);font-size:9.5px;line-height:13px}.aYQbCq_planApproveCopy small{color:var(--dsw-alias-label-tertiary);font-size:8.5px;line-height:12px}.aYQbCq_planApproveRow button{background:var(--dsw-alias-state-business-primary);min-height:32px;color:var(--dsw-alias-label-on-fill);padding-inline:13px}.aYQbCq_planReviewActions>button[data-plan-approve]{width:100%}.aYQbCq_planApproveActions>button:first-child{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-primary)}.aYQbCq_planSecondaryActions>button,.aYQbCq_planApproveActions>button[data-danger]{border-color:var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-primary)}.aYQbCq_planSecondaryActions>button[data-danger],.aYQbCq_planApproveActions>button[data-danger]{color:var(--dsw-alias-state-danger)}.aYQbCq_planSectionToggle:focus-visible,.aYQbCq_planCardHeader:focus-visible,.aYQbCq_planActions button:focus-visible,.aYQbCq_planNewTask button:focus-visible,.aYQbCq_planApproveRow button:focus-visible,.aYQbCq_planConfirm button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.aYQbCq_planActions button:disabled,.aYQbCq_planNewTask button:disabled,.aYQbCq_planApproveRow button:disabled{cursor:default;opacity:.55}.aYQbCq_historicPill{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;margin-left:auto;padding:1px 7px;font-size:9.5px;font-weight:600;line-height:15px}.aYQbCq_members{flex-direction:column;gap:3px;display:flex}.aYQbCq_archiveLabel{color:var(--dsw-alias-label-tertiary);padding:5px 14px 0;font-size:9.5px;font-weight:600;line-height:14px;display:block}@media (prefers-reduced-motion:reduce){.aYQbCq_panel,.aYQbCq_badge,.aYQbCq_badgeDot,.aYQbCq_panelDot,.aYQbCq_workGlyph rect,.aYQbCq_stateArt,.aYQbCq_memberAvatar[data-unread=true]:after,.aYQbCq_planChevron,.aYQbCq_planFeedback,.aYQbCq_planActions button,.aYQbCq_planNewTask button,.aYQbCq_planApproveRow button,.aYQbCq_planConfirm button,.aYQbCq_planCard input,.aYQbCq_planCard textarea,.aYQbCq_planCard select,.aYQbCq_planNewTask input{transition:none;animation:none}}@media (width<=960px){html[data-agent-teams-panel-open] [data-phase=active]{padding-right:0}}@media (width<=640px){.aYQbCq_badge{top:56px;right:10px}.aYQbCq_teamStats span[data-stat=messages]{display:none}.aYQbCq_captainNode{grid-template-columns:48px minmax(0,1fr)}.aYQbCq_captainState{display:none}.aYQbCq_delegationTree{margin-left:12px;padding-left:15px}.aYQbCq_memberBranch{width:15px}.aYQbCq_assignmentLine{padding-left:53px}.aYQbCq_planFlow li{gap:4px;font-size:8px}.aYQbCq_planFlow li:not(:last-child):after{margin-right:3px}.aYQbCq_planCardHeader{grid-template-columns:auto minmax(0,1fr) auto}.aYQbCq_planCardHeader .aYQbCq_planCardMeta{display:none}.aYQbCq_planGrid,.aYQbCq_planModelPicker{grid-template-columns:minmax(0,1fr)}.aYQbCq_planNewTask,.aYQbCq_planApproveRow{flex-direction:column;align-items:stretch}.aYQbCq_planNewTask button,.aYQbCq_planApproveRow>button,.aYQbCq_planApproveActions,.aYQbCq_planReviewActions{width:100%}.aYQbCq_planApproveActions button,.aYQbCq_planReviewActions button,.aYQbCq_planSecondaryActions button{flex:1}}@container aYQbCq_agent-team (width<=360px){.aYQbCq_planEditor{margin-inline:0;padding-inline:10px}.aYQbCq_planHeader>span{align-items:flex-start}.aYQbCq_planFlow li{gap:3px;font-size:7.5px}.aYQbCq_planFlow li:not(:last-child):after{min-width:4px;margin-right:2px}.aYQbCq_planSecondaryActions,.aYQbCq_planApproveActions{grid-template-columns:minmax(0,1fr);width:100%;display:grid}.aYQbCq_planSecondaryActions button,.aYQbCq_planApproveActions button{width:100%}}";
		const tagId = "@nanmicoder/dsh-agent-teams/ActivityPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ActivityPanel_module_css_default = {
			"agent-team": "aYQbCq_agent-team",
			"agentTeamsBreathe": "aYQbCq_agentTeamsBreathe",
			"agentTeamsDot": "aYQbCq_agentTeamsDot",
			"agentTeamsFloat": "aYQbCq_agentTeamsFloat",
			"agentTeamsPanelIn": "aYQbCq_agentTeamsPanelIn",
			"agentTeamsPulse": "aYQbCq_agentTeamsPulse",
			"agentTeamsThink": "aYQbCq_agentTeamsThink",
			"agentTeamsUnreadPulse": "aYQbCq_agentTeamsUnreadPulse",
			"archiveLabel": "aYQbCq_archiveLabel",
			"assignmentChip": "aYQbCq_assignmentChip",
			"assignmentLabel": "aYQbCq_assignmentLabel",
			"assignmentLine": "aYQbCq_assignmentLine",
			"assignmentTasks": "aYQbCq_assignmentTasks",
			"badge": "aYQbCq_badge",
			"badgeCount": "aYQbCq_badgeCount",
			"badgeDot": "aYQbCq_badgeDot",
			"captainAvatar": "aYQbCq_captainAvatar",
			"captainInfo": "aYQbCq_captainInfo",
			"captainLine": "aYQbCq_captainLine",
			"captainName": "aYQbCq_captainName",
			"captainNode": "aYQbCq_captainNode",
			"captainRole": "aYQbCq_captainRole",
			"captainState": "aYQbCq_captainState",
			"captainSummary": "aYQbCq_captainSummary",
			"chevron": "aYQbCq_chevron",
			"dagCanvas": "aYQbCq_dagCanvas",
			"dagEdges": "aYQbCq_dagEdges",
			"dagNode": "aYQbCq_dagNode",
			"dagNodeDot": "aYQbCq_dagNodeDot",
			"dagNodeHead": "aYQbCq_dagNodeHead",
			"dagNodeLabel": "aYQbCq_dagNodeLabel",
			"dagRunningState": "aYQbCq_dagRunningState",
			"dagViewport": "aYQbCq_dagViewport",
			"delegationSection": "aYQbCq_delegationSection",
			"delegationTree": "aYQbCq_delegationTree",
			"dependencySection": "aYQbCq_dependencySection",
			"emptyHint": "aYQbCq_emptyHint",
			"historicPill": "aYQbCq_historicPill",
			"iconButton": "aYQbCq_iconButton",
			"leadAvatar": "aYQbCq_leadAvatar",
			"memberArt": "aYQbCq_memberArt",
			"memberAvatar": "aYQbCq_memberAvatar",
			"memberBlock": "aYQbCq_memberBlock",
			"memberBranch": "aYQbCq_memberBranch",
			"memberCount": "aYQbCq_memberCount",
			"memberInfo": "aYQbCq_memberInfo",
			"memberInitial": "aYQbCq_memberInitial",
			"memberLine": "aYQbCq_memberLine",
			"memberModel": "aYQbCq_memberModel",
			"memberName": "aYQbCq_memberName",
			"memberRole": "aYQbCq_memberRole",
			"memberRow": "aYQbCq_memberRow",
			"memberState": "aYQbCq_memberState",
			"memberStatusLine": "aYQbCq_memberStatusLine",
			"members": "aYQbCq_members",
			"membersToggle": "aYQbCq_membersToggle",
			"panel": "aYQbCq_panel",
			"panelControls": "aYQbCq_panelControls",
			"panelDot": "aYQbCq_panelDot",
			"panelHead": "aYQbCq_panelHead",
			"panelTitle": "aYQbCq_panelTitle",
			"plan-feedback-in": "aYQbCq_plan-feedback-in",
			"planActions": "aYQbCq_planActions",
			"planApproveActions": "aYQbCq_planApproveActions",
			"planApproveCopy": "aYQbCq_planApproveCopy",
			"planApproveRow": "aYQbCq_planApproveRow",
			"planCard": "aYQbCq_planCard",
			"planCardBody": "aYQbCq_planCardBody",
			"planCardHeader": "aYQbCq_planCardHeader",
			"planCardIdentity": "aYQbCq_planCardIdentity",
			"planCardMeta": "aYQbCq_planCardMeta",
			"planChevron": "aYQbCq_planChevron",
			"planConfirm": "aYQbCq_planConfirm",
			"planDirty": "aYQbCq_planDirty",
			"planEditor": "aYQbCq_planEditor",
			"planEmpty": "aYQbCq_planEmpty",
			"planFeedback": "aYQbCq_planFeedback",
			"planFlow": "aYQbCq_planFlow",
			"planGrid": "aYQbCq_planGrid",
			"planHeader": "aYQbCq_planHeader",
			"planList": "aYQbCq_planList",
			"planModelEffortRow": "aYQbCq_planModelEffortRow",
			"planModelHint": "aYQbCq_planModelHint",
			"planModelMenu": "aYQbCq_planModelMenu",
			"planModelMenuBack": "aYQbCq_planModelMenuBack",
			"planModelMenuRow": "aYQbCq_planModelMenuRow",
			"planModelNotice": "aYQbCq_planModelNotice",
			"planModelPicker": "aYQbCq_planModelPicker",
			"planModelTrigger": "aYQbCq_planModelTrigger",
			"planModelTriggerCopy": "aYQbCq_planModelTriggerCopy",
			"planNewTask": "aYQbCq_planNewTask",
			"planReviewActions": "aYQbCq_planReviewActions",
			"planSecondaryActions": "aYQbCq_planSecondaryActions",
			"planSection": "aYQbCq_planSection",
			"planSectionToggle": "aYQbCq_planSectionToggle",
			"planTaskId": "aYQbCq_planTaskId",
			"planTaskSummary": "aYQbCq_planTaskSummary",
			"progressEmpty": "aYQbCq_progressEmpty",
			"progressLegend": "aYQbCq_progressLegend",
			"progressOverview": "aYQbCq_progressOverview",
			"progressSegments": "aYQbCq_progressSegments",
			"progressSummary": "aYQbCq_progressSummary",
			"progressSummaryDot": "aYQbCq_progressSummaryDot",
			"progressTitle": "aYQbCq_progressTitle",
			"resizeHandle": "aYQbCq_resizeHandle",
			"sectionHead": "aYQbCq_sectionHead",
			"sectionHint": "aYQbCq_sectionHint",
			"sectionTitle": "aYQbCq_sectionTitle",
			"sectionToggleTitle": "aYQbCq_sectionToggleTitle",
			"stageLabel": "aYQbCq_stageLabel",
			"stateArt": "aYQbCq_stateArt",
			"stopModalActions": "aYQbCq_stopModalActions",
			"stopModalError": "aYQbCq_stopModalError",
			"taskDetail": "aYQbCq_taskDetail",
			"taskDetailBadge": "aYQbCq_taskDetailBadge",
			"taskDetailHead": "aYQbCq_taskDetailHead",
			"taskDetailId": "aYQbCq_taskDetailId",
			"taskDetailLine": "aYQbCq_taskDetailLine",
			"taskDetailMeta": "aYQbCq_taskDetailMeta",
			"taskDetailModel": "aYQbCq_taskDetailModel",
			"taskDetailSubject": "aYQbCq_taskDetailSubject",
			"taskEmpty": "aYQbCq_taskEmpty",
			"taskId": "aYQbCq_taskId",
			"team": "aYQbCq_team",
			"teamHead": "aYQbCq_teamHead",
			"teamName": "aYQbCq_teamName",
			"teamStats": "aYQbCq_teamStats",
			"teamStopButton": "aYQbCq_teamStopButton",
			"teams": "aYQbCq_teams",
			"unreadPill": "aYQbCq_unreadPill",
			"workGlyph": "aYQbCq_workGlyph"
		};
		//#endregion
		//#region lib/client/StagingPlanEditor.js
		/**
		* Editable pre-run roster and DAG review for staged AgentTeams plans.
		*
		* This leaf owns only transient form/disclosure state. Durable truth remains
		* on the host and returns through the ordinary activity polling snapshot.
		* @module dsh-agent-teams/client/staging-plan
		*/
		const PLAN_URL = "/plugins/dsh-agent-teams/plan";
		function useDismissSuccess(feedback, setFeedback) {
			(0, react.useEffect)(() => {
				if (feedback?.tone !== "success") return;
				const timeout = window.setTimeout(() => {
					setFeedback(void 0);
				}, 3500);
				return () => {
					window.clearTimeout(timeout);
				};
			}, [feedback, setFeedback]);
		}
		async function mutatePlan(payload) {
			const response = await fetch(PLAN_URL, {
				method: "POST",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			if (response.ok) return;
			let message = `HTTP ${response.status}`;
			try {
				const body = await response.json();
				if (typeof body.error === "string" && body.error.trim() !== "") message = body.error;
			} catch {}
			throw new Error(message);
		}
		function errorMessage(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function DisclosureChevron({ open }) {
			return (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.planChevron,
				"data-open": open,
				width: "12",
				height: "12",
				viewBox: "0 0 12 12",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				"aria-hidden": true,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M4 2.5 7.5 6 4 9.5" })
			});
		}
		function Feedback({ value }) {
			if (value === void 0) return null;
			return (0, react_jsx_runtime.jsxs)("span", {
				className: ActivityPanel_module_css_default.planFeedback,
				"data-tone": value.tone,
				role: value.tone === "error" ? "alert" : "status",
				"aria-live": value.tone === "error" ? "assertive" : "polite",
				children: [(0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": true,
					children: value.tone === "success" ? (0, react_jsx_runtime.jsx)("svg", {
						viewBox: "0 0 12 12",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.8",
						children: (0, react_jsx_runtime.jsx)("path", { d: "m2.5 6.2 2.2 2.2 4.8-5" })
					}) : (0, react_jsx_runtime.jsx)("svg", {
						viewBox: "0 0 12 12",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.8",
						children: (0, react_jsx_runtime.jsx)("path", { d: "M6 2.3v4.1M6 8.8v.1" })
					})
				}), value.message]
			});
		}
		function routeKey(provider, model) {
			return JSON.stringify([provider, model]);
		}
		const MODEL_MENU_OPEN_MODELS = "open:models";
		const MODEL_MENU_OPEN_EFFORT = "open:effort";
		const MODEL_MENU_BACK = "navigate:back";
		const MODEL_MENU_RETRY = "action:retry";
		const MODEL_MENU_DEFAULT_EFFORT = "effort:default";
		function modelMenuId(provider, model) {
			return `model:${routeKey(provider, model)}`;
		}
		function effortMenuId(effort) {
			return `effort:${effort}`;
		}
		/**
		* Thin staged-plan adapter over the official model directory. It deliberately
		* reads only catalog metadata: choosing a member route must not change the
		* captain session's composer model.
		*/
		function StagedModelPicker({ directory, provider, model, reasoningEffort, busy, onChange, t }) {
			const state = (0, react.useSyncExternalStore)(directory.store.subscribe, directory.store.getSnapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const [pane, setPane] = (0, react.useState)("root");
			const catalogRoutes = state.groups.flatMap((group) => group.models.map((candidate) => ({
				key: routeKey(group.id, candidate.id),
				provider: group.id,
				providerName: group.name,
				model: candidate
			})));
			const selectedKey = routeKey(provider, model);
			const selected = catalogRoutes.find((candidate) => candidate.key === selectedKey);
			const efforts = selected?.model.reasoning?.efforts ?? [];
			const currentMissing = provider !== "" && model !== "" && selected === void 0;
			const defaultEffort = selected?.model.reasoning?.defaultEffort;
			const effectiveEffort = reasoningEffort === "" || reasoningEffort === "default" ? defaultEffort : reasoningEffort;
			const selectedEffort = efforts.find((effort) => effort.id === effectiveEffort);
			const modelLabel = selected?.model.name ?? (model === "" ? t("plan.model.choose") : model);
			const effortLabel = selectedEffort?.name ?? (effectiveEffort === void 0 ? t("plan.model.providerDefault") : effectiveEffort);
			const unavailable = state.status === "error" || state.failures.length > 0;
			const close = () => {
				setOpen(false);
				setPane("root");
			};
			const rootItems = [{
				id: MODEL_MENU_OPEN_MODELS,
				label: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.planModelMenuRow,
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: t("plan.member.model") }),
						(0, react_jsx_runtime.jsx)("strong", { children: modelLabel }),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false })
					]
				}),
				disabled: state.status === "loading" && catalogRoutes.length === 0
			}, {
				id: MODEL_MENU_OPEN_EFFORT,
				label: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.planModelMenuRow,
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: t("plan.member.reasoning") }),
						(0, react_jsx_runtime.jsx)("strong", { children: effortLabel }),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false })
					]
				}),
				disabled: selected?.model.reasoning === void 0
			}];
			const modelItems = [{
				id: MODEL_MENU_BACK,
				label: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.planModelMenuBack,
					children: [(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false }), t("plan.model.back")]
				})
			}, {
				type: "separator",
				id: "models:separator"
			}];
			if (catalogRoutes.length === 0) modelItems.push({
				id: "models:empty",
				label: state.status === "loading" ? t("plan.model.loading") : t("plan.model.empty"),
				disabled: true
			});
			else for (const group of state.groups) {
				modelItems.push({
					type: "label",
					id: `provider:${group.id}`,
					text: group.name
				});
				for (const candidate of group.models) modelItems.push({
					id: modelMenuId(group.id, candidate.id),
					label: candidate.name
				});
			}
			const effortItems = [
				{
					id: MODEL_MENU_BACK,
					label: (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planModelMenuBack,
						children: [(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false }), t("plan.model.back")]
					})
				},
				{
					type: "separator",
					id: "effort:separator"
				},
				{
					id: MODEL_MENU_DEFAULT_EFFORT,
					label: defaultEffort === void 0 ? t("plan.model.providerDefault") : t("plan.model.modelDefault", { effort: efforts.find((effort) => effort.id === defaultEffort)?.name ?? defaultEffort })
				},
				...efforts.map((effort) => ({
					id: effortMenuId(effort.id),
					label: (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planModelEffortRow,
						children: [(0, react_jsx_runtime.jsx)("span", { children: effort.name }), effort.description !== void 0 && (0, react_jsx_runtime.jsx)("small", { children: effort.description })]
					})
				}))
			];
			const items = pane === "models" ? modelItems : pane === "effort" ? effortItems : rootItems;
			const selectedId = pane === "models" ? modelMenuId(provider, model) : pane === "effort" ? reasoningEffort === "" || reasoningEffort === "default" ? MODEL_MENU_DEFAULT_EFFORT : effortMenuId(reasoningEffort) : void 0;
			const choose = (id) => {
				if (id === MODEL_MENU_OPEN_MODELS) {
					setPane("models");
					return;
				}
				if (id === MODEL_MENU_OPEN_EFFORT) {
					setPane("effort");
					return;
				}
				if (id === MODEL_MENU_BACK) {
					setPane("root");
					return;
				}
				if (id === MODEL_MENU_RETRY) {
					directory.load().catch(() => void 0);
					return;
				}
				const nextModel = catalogRoutes.find((candidate) => modelMenuId(candidate.provider, candidate.model.id) === id);
				if (nextModel !== void 0) {
					close();
					if (nextModel.provider === provider && nextModel.model.id === model) return;
					onChange({
						provider: nextModel.provider,
						model: nextModel.model.id,
						reasoningEffort: "default"
					});
					return;
				}
				if (id === MODEL_MENU_DEFAULT_EFFORT) {
					close();
					if (effectiveEffort === defaultEffort) return;
					onChange({
						provider,
						model,
						reasoningEffort: "default"
					});
					return;
				}
				const nextEffort = efforts.find((effort) => effortMenuId(effort.id) === id);
				if (nextEffort === void 0) return;
				close();
				if (nextEffort.id === reasoningEffort) return;
				onChange({
					provider,
					model,
					reasoningEffort: nextEffort.id
				});
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ActivityPanel_module_css_default.planModelPicker,
				"data-model-directory-status": state.status,
				children: [
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
						open,
						portal: true,
						align: "end",
						compact: true,
						className: ActivityPanel_module_css_default.planModelMenu,
						items,
						footer: unavailable ? [{
							id: MODEL_MENU_RETRY,
							label: t("plan.model.retry")
						}] : void 0,
						selectedId,
						onSelect: choose,
						onClose: close,
						anchor: (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ActivityPanel_module_css_default.planModelTrigger,
							"data-plan-model-trigger": true,
							"aria-label": t("plan.model.triggerAria", {
								model: modelLabel,
								effort: effortLabel
							}),
							"aria-haspopup": "menu",
							"aria-expanded": open,
							disabled: busy,
							onClick: () => {
								if (open) close();
								else {
									setPane("root");
									setOpen(true);
									directory.load().catch(() => void 0);
								}
							},
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planModelTriggerCopy,
								children: [(0, react_jsx_runtime.jsx)("strong", { children: state.status === "loading" && catalogRoutes.length === 0 ? t("plan.model.loading") : modelLabel }), (0, react_jsx_runtime.jsx)("span", { children: effortLabel })]
							}), (0, react_jsx_runtime.jsx)(DisclosureChevron, { open })]
						})
					}),
					(0, react_jsx_runtime.jsx)("small", {
						className: ActivityPanel_module_css_default.planModelHint,
						children: currentMissing ? t("plan.model.currentUnavailable", {
							provider,
							model
						}) : selected?.model.description ?? t("plan.model.route", {
							provider,
							model
						})
					}),
					unavailable && (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planModelNotice,
						role: state.status === "error" ? "alert" : "status",
						children: [(0, react_jsx_runtime.jsx)("span", { children: state.error ?? t("plan.model.partialFailure", { count: state.failures.length }) }), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy || state.status === "loading",
							onClick: () => {
								directory.load().catch(() => void 0);
							},
							children: t("plan.model.retry")
						})]
					})
				]
			});
		}
		function StagedMemberEditor({ team, member, modelDirectory, onPendingChange, t }) {
			const bodyId = (0, react.useId)();
			const [open, setOpen] = (0, react.useState)(false);
			const [role, setRole] = (0, react.useState)(member.role);
			const [provider, setProvider] = (0, react.useState)(member.provider ?? "");
			const [model, setModel] = (0, react.useState)(member.model ?? "");
			const [reasoningEffort, setReasoningEffort] = (0, react.useState)(member.reasoningEffort ?? "");
			const [executionPrompt, setExecutionPrompt] = (0, react.useState)(member.executionPrompt ?? "");
			const remoteSignature = JSON.stringify([
				member.role,
				member.provider ?? "",
				member.model ?? "",
				member.reasoningEffort ?? "",
				member.executionPrompt ?? ""
			]);
			const [savedSignature, setSavedSignature] = (0, react.useState)(remoteSignature);
			const [busy, setBusy] = (0, react.useState)(false);
			const [feedback, setFeedback] = (0, react.useState)();
			useDismissSuccess(feedback, setFeedback);
			const dirty = JSON.stringify([
				role,
				provider,
				model,
				reasoningEffort,
				executionPrompt
			]) !== savedSignature;
			(0, react.useEffect)(() => {
				onPendingChange(`member:${member.name}`, dirty || busy);
				return () => {
					onPendingChange(`member:${member.name}`, false);
				};
			}, [
				busy,
				dirty,
				member.name,
				onPendingChange
			]);
			(0, react.useEffect)(() => {
				setRole(member.role);
				setProvider(member.provider ?? "");
				setModel(member.model ?? "");
				setReasoningEffort(member.reasoningEffort ?? "");
				setExecutionPrompt(member.executionPrompt ?? "");
				setSavedSignature(remoteSignature);
			}, [
				member.role,
				member.provider,
				member.model,
				member.reasoningEffort,
				member.executionPrompt,
				remoteSignature
			]);
			const markEdited = () => {
				setFeedback(void 0);
			};
			const persist = async (selection = {
				provider,
				model,
				reasoningEffort
			}) => {
				const nextSignature = JSON.stringify([
					role,
					selection.provider,
					selection.model,
					selection.reasoningEffort,
					executionPrompt
				]);
				setProvider(selection.provider);
				setModel(selection.model);
				setReasoningEffort(selection.reasoningEffort);
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "update_member",
						memberName: member.name,
						role,
						provider: selection.provider,
						model: selection.model,
						reasoningEffort: selection.reasoningEffort,
						executionPrompt
					});
					setSavedSignature(nextSignature);
					setFeedback({
						tone: "success",
						message: t("plan.saved")
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
				} finally {
					setBusy(false);
				}
			};
			const save = async (event) => {
				event.preventDefault();
				await persist();
			};
			const route = `${provider}/${model}`.replace(/^\//u, "");
			return (0, react_jsx_runtime.jsxs)("article", {
				className: ActivityPanel_module_css_default.planCard,
				"data-plan-member": member.name,
				"data-open": open,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ActivityPanel_module_css_default.planCardHeader,
					"aria-expanded": open,
					"aria-controls": bodyId,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planCardIdentity,
							children: [(0, react_jsx_runtime.jsx)("strong", { children: member.name }), (0, react_jsx_runtime.jsx)("span", { children: role || t("plan.member.roleFallback") })]
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.planCardMeta,
							title: route,
							children: route
						}),
						dirty && (0, react_jsx_runtime.jsx)("em", {
							className: ActivityPanel_module_css_default.planDirty,
							children: t("plan.unsaved")
						}),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open })
					]
				}), open && (0, react_jsx_runtime.jsxs)("form", {
					id: bodyId,
					className: ActivityPanel_module_css_default.planCardBody,
					onSubmit: (event) => {
						save(event);
					},
					children: [(0, react_jsx_runtime.jsxs)("fieldset", {
						disabled: busy,
						children: [
							(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.member.role"), (0, react_jsx_runtime.jsx)("input", {
								name: "role",
								value: role,
								onChange: (event) => {
									setRole(event.currentTarget.value);
									markEdited();
								}
							})] }),
							(0, react_jsx_runtime.jsx)(StagedModelPicker, {
								directory: modelDirectory,
								provider,
								model,
								reasoningEffort,
								busy,
								onChange: (selection) => {
									persist(selection);
								},
								t
							}),
							(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.member.prompt"), (0, react_jsx_runtime.jsx)("textarea", {
								name: "executionPrompt",
								value: executionPrompt,
								onChange: (event) => {
									setExecutionPrompt(event.currentTarget.value);
									markEdited();
								},
								rows: 3
							})] })
						]
					}), (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planActions,
						children: [(0, react_jsx_runtime.jsx)(Feedback, { value: feedback }), (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: busy || !dirty || provider.trim() === "" || model.trim() === "",
							children: busy ? t("plan.saving") : t("plan.save")
						})]
					})]
				})]
			});
		}
		function StagedTaskEditor({ team, task, onPendingChange, t }) {
			const bodyId = (0, react.useId)();
			const taskDependencies = task.dependencies.join(", ");
			const [open, setOpen] = (0, react.useState)(false);
			const [subject, setSubject] = (0, react.useState)(task.subject);
			const [description, setDescription] = (0, react.useState)(task.description ?? "");
			const [assignee, setAssignee] = (0, react.useState)(task.assignee);
			const [dependencies, setDependencies] = (0, react.useState)(taskDependencies);
			const remoteSignature = JSON.stringify([
				task.subject,
				task.description ?? "",
				task.assignee,
				taskDependencies
			]);
			const [savedSignature, setSavedSignature] = (0, react.useState)(remoteSignature);
			const [busy, setBusy] = (0, react.useState)(false);
			const [confirmingRemove, setConfirmingRemove] = (0, react.useState)(false);
			const [feedback, setFeedback] = (0, react.useState)();
			useDismissSuccess(feedback, setFeedback);
			const signature = JSON.stringify([
				subject,
				description,
				assignee,
				dependencies
			]);
			const dirty = signature !== savedSignature;
			(0, react.useEffect)(() => {
				onPendingChange(`task:${task.id}`, dirty || busy);
				return () => {
					onPendingChange(`task:${task.id}`, false);
				};
			}, [
				busy,
				dirty,
				onPendingChange,
				task.id
			]);
			(0, react.useEffect)(() => {
				setSubject(task.subject);
				setDescription(task.description ?? "");
				setAssignee(task.assignee);
				setDependencies(taskDependencies);
				setSavedSignature(remoteSignature);
			}, [
				task.subject,
				task.description,
				task.assignee,
				taskDependencies,
				remoteSignature
			]);
			const markEdited = () => {
				setFeedback(void 0);
				setConfirmingRemove(false);
			};
			const save = async (event) => {
				event.preventDefault();
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "update_task",
						taskId: task.id,
						subject,
						description,
						assignee,
						dependencies: dependencies.split(",").map((item) => item.trim()).filter(Boolean)
					});
					setSavedSignature(signature);
					setFeedback({
						tone: "success",
						message: t("plan.saved")
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
				} finally {
					setBusy(false);
				}
			};
			const remove = async () => {
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "remove_task",
						taskId: task.id
					});
					setFeedback({
						tone: "success",
						message: t("plan.removed")
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
				}
			};
			const dependencySummary = task.dependencies.length === 0 ? t("plan.dependencies.none") : t("plan.dependencies.count", { count: task.dependencies.length });
			return (0, react_jsx_runtime.jsxs)("article", {
				className: ActivityPanel_module_css_default.planCard,
				"data-plan-task": task.id,
				"data-open": open,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ActivityPanel_module_css_default.planCardHeader,
					"aria-expanded": open,
					"aria-controls": bodyId,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.planTaskId,
							children: task.id
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.planTaskSummary,
							title: subject,
							children: subject
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planCardMeta,
							children: [
								assignee || t("plan.task.unassigned"),
								" · ",
								dependencySummary
							]
						}),
						dirty && (0, react_jsx_runtime.jsx)("em", {
							className: ActivityPanel_module_css_default.planDirty,
							children: t("plan.unsaved")
						}),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open })
					]
				}), open && (0, react_jsx_runtime.jsxs)("form", {
					id: bodyId,
					className: ActivityPanel_module_css_default.planCardBody,
					onSubmit: (event) => {
						save(event);
					},
					children: [
						(0, react_jsx_runtime.jsxs)("fieldset", {
							disabled: busy,
							children: [
								(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.task.subject"), (0, react_jsx_runtime.jsx)("input", {
									name: "subject",
									required: true,
									value: subject,
									onChange: (event) => {
										setSubject(event.currentTarget.value);
										markEdited();
									}
								})] }),
								(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.task.description"), (0, react_jsx_runtime.jsx)("textarea", {
									name: "description",
									value: description,
									onChange: (event) => {
										setDescription(event.currentTarget.value);
										markEdited();
									},
									rows: 3
								})] }),
								(0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.planGrid,
									children: [(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.task.assignee"), (0, react_jsx_runtime.jsxs)("select", {
										name: "assignee",
										value: assignee,
										onChange: (event) => {
											setAssignee(event.currentTarget.value);
											markEdited();
										},
										children: [(0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: t("plan.task.unassigned")
										}), team.members.map((member) => (0, react_jsx_runtime.jsx)("option", {
											value: member.name,
											children: member.name
										}, member.name))]
									})] }), (0, react_jsx_runtime.jsxs)("label", { children: [
										t("plan.task.dependencies"),
										(0, react_jsx_runtime.jsx)("input", {
											name: "dependencies",
											value: dependencies,
											onChange: (event) => {
												setDependencies(event.currentTarget.value);
												markEdited();
											}
										}),
										(0, react_jsx_runtime.jsx)("small", { children: t("plan.task.dependenciesHint") })
									] })]
								})
							]
						}),
						confirmingRemove && (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planConfirm,
							role: "alert",
							children: [
								(0, react_jsx_runtime.jsx)("span", { children: t("plan.removeWarning", { task: task.id }) }),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setConfirmingRemove(false);
									},
									children: t("plan.cancel")
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-danger": true,
									"data-confirming": true,
									onClick: () => {
										remove();
									},
									children: t("plan.removeConfirm")
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planActions,
							children: [
								(0, react_jsx_runtime.jsx)(Feedback, { value: feedback }),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-danger": true,
									onClick: () => {
										setConfirmingRemove(true);
										setFeedback(void 0);
									},
									disabled: busy || confirmingRemove,
									children: t("plan.remove")
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									disabled: busy || !dirty || subject.trim() === "",
									children: busy ? t("plan.saving") : t("plan.save")
								})
							]
						})
					]
				})]
			});
		}
		function StagingPlanEditor({ team, modelDirectory, onContinuePlanning, onDiscarded, t }) {
			const membersId = (0, react.useId)();
			const tasksId = (0, react.useId)();
			const [membersOpen, setMembersOpen] = (0, react.useState)(true);
			const [tasksOpen, setTasksOpen] = (0, react.useState)(true);
			const [newTask, setNewTask] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [discardArmed, setDiscardArmed] = (0, react.useState)(false);
			const [pendingEditors, setPendingEditors] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [feedback, setFeedback] = (0, react.useState)();
			useDismissSuccess(feedback, setFeedback);
			const dependencyLinks = team.tasks.reduce((total, task) => total + task.dependencies.length, 0);
			const runnable = team.members.length > 0 && team.tasks.length > 0;
			const hasPendingEdits = pendingEditors.size > 0 || newTask.trim() !== "";
			const waitingForFeedback = team.planReviewState === "awaiting_feedback";
			(0, react.useEffect)(() => {
				modelDirectory.load().catch(() => void 0);
			}, [modelDirectory]);
			const onPendingChange = (0, react.useCallback)((key, pending) => {
				setPendingEditors((current) => {
					if (pending === current.has(key)) return current;
					const next = new Set(current);
					if (pending) next.add(key);
					else next.delete(key);
					return next;
				});
			}, []);
			const addTask = async (event) => {
				event.preventDefault();
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "add_task",
						subject: newTask,
						dependencies: []
					});
					setNewTask("");
					setFeedback({
						tone: "success",
						message: t("plan.taskAdded")
					});
					setTasksOpen(true);
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
				} finally {
					setBusy(false);
				}
			};
			const approve = async () => {
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "approve"
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
				}
			};
			const continueInChat = async () => {
				if (waitingForFeedback) {
					onContinuePlanning();
					return;
				}
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "continue"
					});
					onContinuePlanning();
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
				}
			};
			const discard = async () => {
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "discard"
					});
					onDiscarded();
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
					setDiscardArmed(false);
				}
			};
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.planEditor,
				"data-staging-editor": true,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.planHeader,
						children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: t("plan.title") }), (0, react_jsx_runtime.jsx)("small", { children: t("plan.readySummary", {
							members: team.members.length,
							tasks: team.tasks.length,
							links: dependencyLinks
						}) })] }), (0, react_jsx_runtime.jsx)("em", { children: t("plan.badge") })] }), (0, react_jsx_runtime.jsx)("p", { children: t("plan.description") })]
					}),
					(0, react_jsx_runtime.jsxs)("ol", {
						className: ActivityPanel_module_css_default.planFlow,
						"aria-label": t("plan.flow.aria"),
						children: [
							(0, react_jsx_runtime.jsxs)("li", {
								"data-active": true,
								children: [(0, react_jsx_runtime.jsx)("span", { children: "1" }), t("plan.flow.review")]
							}),
							(0, react_jsx_runtime.jsxs)("li", { children: [(0, react_jsx_runtime.jsx)("span", { children: "2" }), t("plan.flow.spawn")] }),
							(0, react_jsx_runtime.jsxs)("li", { children: [(0, react_jsx_runtime.jsx)("span", { children: "3" }), t("plan.flow.run")] })
						]
					}),
					(0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.planSection,
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ActivityPanel_module_css_default.planSectionToggle,
							"aria-expanded": membersOpen,
							"aria-controls": membersId,
							onClick: () => {
								setMembersOpen((current) => !current);
							},
							children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: t("plan.members.title") }), (0, react_jsx_runtime.jsx)("small", { children: t("plan.members.count", { count: team.members.length }) })] }), (0, react_jsx_runtime.jsx)(DisclosureChevron, { open: membersOpen })]
						}), membersOpen && (0, react_jsx_runtime.jsx)("div", {
							id: membersId,
							className: ActivityPanel_module_css_default.planList,
							children: team.members.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: ActivityPanel_module_css_default.planEmpty,
								children: t("plan.members.empty")
							}) : team.members.map((member) => (0, react_jsx_runtime.jsx)(StagedMemberEditor, {
								team,
								member,
								modelDirectory,
								onPendingChange,
								t
							}, member.name))
						})]
					}),
					(0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.planSection,
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ActivityPanel_module_css_default.planSectionToggle,
							"aria-expanded": tasksOpen,
							"aria-controls": tasksId,
							onClick: () => {
								setTasksOpen((current) => !current);
							},
							children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: t("plan.tasks.title") }), (0, react_jsx_runtime.jsx)("small", { children: t("plan.tasks.count", {
								count: team.tasks.length,
								links: dependencyLinks
							}) })] }), (0, react_jsx_runtime.jsx)(DisclosureChevron, { open: tasksOpen })]
						}), tasksOpen && (0, react_jsx_runtime.jsx)("div", {
							id: tasksId,
							className: ActivityPanel_module_css_default.planList,
							children: team.tasks.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: ActivityPanel_module_css_default.planEmpty,
								children: t("plan.tasks.empty")
							}) : team.tasks.map((task) => (0, react_jsx_runtime.jsx)(StagedTaskEditor, {
								team,
								task,
								onPendingChange,
								t
							}, task.id))
						})]
					}),
					(0, react_jsx_runtime.jsxs)("form", {
						className: ActivityPanel_module_css_default.planNewTask,
						onSubmit: (event) => {
							addTask(event);
						},
						children: [(0, react_jsx_runtime.jsxs)("label", { children: [(0, react_jsx_runtime.jsx)("span", { children: t("plan.newTaskLabel") }), (0, react_jsx_runtime.jsx)("input", {
							name: "newTask",
							value: newTask,
							onChange: (event) => {
								setNewTask(event.currentTarget.value);
								setFeedback(void 0);
							},
							placeholder: t("plan.newTask"),
							disabled: busy
						})] }), (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: busy || newTask.trim() === "",
							children: busy ? t("plan.adding") : t("plan.addTask")
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.planApproveRow,
						"data-armed": discardArmed || void 0,
						"data-discard": discardArmed || void 0,
						"data-review-state": waitingForFeedback ? "awaiting-feedback" : "awaiting-review",
						children: [
							(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planApproveCopy,
								children: [(0, react_jsx_runtime.jsx)("strong", { children: discardArmed ? t("plan.discardConfirmTitle") : waitingForFeedback ? t("plan.feedbackTitle") : t("plan.approveTitle") }), (0, react_jsx_runtime.jsx)("small", { children: discardArmed ? t("plan.discardWarning") : waitingForFeedback ? t("plan.feedbackHint") : hasPendingEdits ? t("plan.pendingEdits") : t("plan.approveHint", {
									members: team.members.length,
									tasks: team.tasks.length
								}) })]
							}),
							(0, react_jsx_runtime.jsx)(Feedback, { value: feedback }),
							discardArmed ? (0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planApproveActions,
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy,
									onClick: () => {
										setDiscardArmed(false);
									},
									children: t("plan.cancel")
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-plan-discard": true,
									"data-danger": true,
									"data-confirming": true,
									disabled: busy,
									onClick: () => {
										discard();
									},
									children: busy ? t("plan.discarding") : t("plan.discardConfirm")
								})]
							}) : (0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planReviewActions,
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-plan-approve": true,
									disabled: busy || !runnable || hasPendingEdits,
									onClick: () => {
										approve();
									},
									children: t("plan.approve")
								}), (0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.planSecondaryActions,
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"data-plan-continue": true,
										disabled: busy,
										onClick: () => {
											continueInChat();
										},
										children: t(waitingForFeedback ? "plan.returnToChat" : "plan.continue")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"data-plan-discard": true,
										"data-danger": true,
										disabled: busy,
										onClick: () => {
											setDiscardArmed(true);
											setFeedback(void 0);
										},
										children: t("plan.discard")
									})]
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region lib/client/panel-geometry.js
		/** Pure persisted geometry rules for the AgentTeams shell-overlay panel. */
		const PANEL_LAYOUT_STORAGE_KEY = "dsh-agent-teams:activity-panel:v1";
		const DEFAULT_PANEL_LAYOUT = Object.freeze({
			mode: "docked",
			x: 0,
			y: 64,
			width: 388,
			height: 640,
			heightMode: "auto"
		});
		function clamp(value, minimum, maximum) {
			return Math.min(Math.max(value, minimum), maximum);
		}
		function finite(value) {
			return typeof value === "number" && Number.isFinite(value);
		}
		/** Decode one versioned localStorage value, rejecting partial/corrupt state. */
		function parsePanelLayout(value) {
			if (value === null) return DEFAULT_PANEL_LAYOUT;
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_LAYOUT;
				const record = parsed;
				if (record.mode !== "docked" && record.mode !== "floating" || !finite(record.x) || !finite(record.y) || !finite(record.width) || !finite(record.height)) return DEFAULT_PANEL_LAYOUT;
				return {
					mode: record.mode,
					x: record.x,
					y: record.y,
					width: record.width,
					height: record.height,
					heightMode: record.mode === "floating" && record.heightMode === "manual" ? "manual" : "auto"
				};
			} catch {
				return DEFAULT_PANEL_LAYOUT;
			}
		}
		/** Whether the panel should become a simple inset overlay with no gestures. */
		function compactPanelForBounds(bounds) {
			return bounds.width <= 960;
		}
		/** Docked and compact panels always fit content; floating panels may be user-sized. */
		function panelUsesAutoHeight(layout, bounds) {
			return compactPanelForBounds(bounds) || layout.mode === "docked" || layout.heightMode === "auto";
		}
		/** CSS max-height ceiling that keeps an auto-height panel inside its shell. */
		function panelMaximumHeight(layout, bounds) {
			const bottomInset = compactPanelForBounds(bounds) || layout.mode === "floating" ? 12 : 48;
			return Math.max(1, bounds.height - layout.y - bottomInset);
		}
		/** Resolve persisted state into a visible rectangle inside the current shell. */
		function resolvePanelGeometry(layout, bounds) {
			const boundsWidth = Math.max(1, bounds.width);
			const boundsHeight = Math.max(1, bounds.height);
			if (compactPanelForBounds(bounds)) return {
				...layout,
				x: 12,
				y: 12,
				width: Math.max(1, boundsWidth - 24),
				height: Math.max(1, boundsHeight - 24)
			};
			const maximumWidth = Math.max(1, Math.min(640, boundsWidth - 24));
			const minimumWidth = Math.min(320, maximumWidth);
			const width = clamp(layout.width, minimumWidth, maximumWidth);
			const maximumHeight = Math.max(1, boundsHeight - 24);
			const minimumHeight = Math.min(360, maximumHeight);
			if (layout.mode === "docked") {
				const y = clamp(64, 12, Math.max(12, boundsHeight - minimumHeight - 12));
				const availableHeight = Math.max(1, boundsHeight - y - 48);
				const height = clamp(availableHeight, Math.min(minimumHeight, availableHeight), maximumHeight);
				const anchorRight = clamp(bounds.anchorRight, 0, boundsWidth);
				const maximumX = Math.max(12, boundsWidth - width - 12);
				return {
					mode: "docked",
					x: clamp(anchorRight - 18 - width, 12, maximumX),
					y,
					width,
					height,
					heightMode: layout.heightMode
				};
			}
			const height = clamp(layout.height, minimumHeight, maximumHeight);
			return {
				mode: "floating",
				x: clamp(layout.x, 12, Math.max(12, boundsWidth - width - 12)),
				y: clamp(layout.y, 12, Math.max(12, boundsHeight - height - 12)),
				width,
				height,
				heightMode: layout.heightMode
			};
		}
		/** Undock without a visual jump by adopting the panel's resolved rectangle. */
		function floatPanelLayout(geometry, bounds) {
			return resolvePanelGeometry({
				...geometry,
				mode: "floating"
			}, bounds);
		}
		/** Return to the right dock, preserving width and restoring content-fit height. */
		function dockPanelLayout(layout, bounds) {
			return resolvePanelGeometry({
				...layout,
				mode: "docked",
				heightMode: "auto"
			}, bounds);
		}
		/** Translate a floating panel and clamp it back into the visible shell. */
		function movePanelLayout(start, dx, dy, bounds) {
			return resolvePanelGeometry({
				...start,
				mode: "floating",
				x: start.x + dx,
				y: start.y + dy
			}, bounds);
		}
		/** Resize while keeping the edge opposite the active handle stationary. */
		function resizePanelLayout(start, edge, dx, dy, bounds) {
			if (start.mode === "docked") {
				if (edge !== "left") return resolvePanelGeometry(start, bounds);
				return resolvePanelGeometry({
					...start,
					width: start.width - dx
				}, bounds);
			}
			const resolved = resolvePanelGeometry(start, bounds);
			const minimumWidth = Math.min(320, resolved.x + resolved.width - 12);
			const minimumHeight = Math.min(360, bounds.height - resolved.y - 12);
			if (edge === "left") {
				const right = resolved.x + resolved.width;
				const maximumWidth = Math.max(1, Math.min(640, right - 12));
				const width = clamp(resolved.width - dx, Math.min(minimumWidth, maximumWidth), maximumWidth);
				return {
					...resolved,
					x: right - width,
					width
				};
			}
			const maximumHeight = Math.max(1, bounds.height - resolved.y - 12);
			const height = clamp(resolved.height + dy, Math.min(minimumHeight, maximumHeight), maximumHeight);
			if (edge === "bottom") return {
				...resolved,
				height,
				heightMode: "manual"
			};
			const maximumWidth = Math.max(1, Math.min(640, bounds.width - resolved.x - 12));
			const width = clamp(resolved.width + dx, Math.min(minimumWidth, maximumWidth), maximumWidth);
			return {
				...resolved,
				width,
				height,
				heightMode: "manual"
			};
		}
		//#endregion
		//#region lib/client/ActivityPanel.js
		/**
		* AgentTeams activity panel: the top-right floater monitoring every team.
		*
		* Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
		* panel that docks at the conversation's top-right edge by default, can be
		* dragged into a floating window, resized, and folded into an activity badge.
		* On wide viewports the docked panel makes the conversation column yield
		* space; narrow viewports keep a simple inset overlay. It
		* polls the host `/plugins/dsh-agent-teams/state` route for
		* server-side snapshots (durable files + live subagent activity), with a
		* collapsed badge that auto-expands once when activity appears. Archived
		* teams stay available for the owning conversation after live work ends.
		*
		* The floater mounts in ui-layout's additive `shell.overlay`; it is not a
		* conversation node — the in-conversation panel was removed in favor of this
		* always-available monitor.
		* @module dsh-agent-teams/client/activity
		*/
		/** Grace before the panel collapses once no team remains. */
		const AUTOCLOSE_GRACE_MS = 2e3;
		/**
		* Page-settle window after mount: activity restored on page load only shows
		* the collapsed badge, so the panel never yanks the conversation column
		* right after load. New activity after this window auto-expands as usual.
		*/
		const AUTO_OPEN_SETTLE_MS = 4e3;
		/** Root marker shared with the panel CSS while the shell overlay is expanded. */
		const PANEL_OPEN_ATTRIBUTE = "data-agent-teams-panel-open";
		/** Shared width concession consumed by the conversation root CSS. */
		const PANEL_SHIFT_PROPERTY = "--agent-teams-panel-shift";
		const PANEL_CONVERSATION_GAP = 14;
		const MOVE_THRESHOLD = 4;
		const CAPTAIN_ASSIGNEE = "captain";
		function initialPanelLayout() {
			if (typeof window === "undefined") return DEFAULT_PANEL_LAYOUT;
			return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY));
		}
		function initialPanelBounds() {
			if (typeof window === "undefined") return {
				width: 1440,
				height: 900,
				anchorRight: 1440
			};
			return {
				width: window.innerWidth,
				height: window.innerHeight,
				anchorRight: window.innerWidth
			};
		}
		/** Initial-letter fallback for unmatched roles. */
		function memberInitial(name) {
			return name.trim().slice(0, 1).toUpperCase() || "?";
		}
		function stableHash(value) {
			let hash = 0;
			for (let index = 0; index < value.length; index += 1) hash = (hash << 5) - hash + value.charCodeAt(index) | 0;
			return Math.abs(hash);
		}
		const ACCENTS = [
			"var(--dsw-alias-state-business-primary)",
			"var(--dsw-alias-state-success)",
			"var(--dsw-alias-state-danger)",
			"var(--dsw-alias-state-warning)",
			"var(--dsw-alias-label-tertiary)"
		];
		function accentOf(id) {
			return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0];
		}
		/** Badge text follows the raw task status (finer than the 4 visual states):
		* claimed/pending/failed/cancelled keep their own labels and colors. */
		const TASK_STATUS_LABEL = {
			pending: "task.status.pending",
			claimed: "task.status.claimed",
			in_progress: "task.status.inProgress",
			completed: "task.status.completed",
			failed: "task.status.failed",
			cancelled: "task.status.cancelled"
		};
		function taskStatusLabel(status, t) {
			const key = TASK_STATUS_LABEL[status];
			return key === void 0 ? status : t(key);
		}
		function formatTaskIds(ids, t) {
			return ids.join(t("format.listSeparator"));
		}
		function taskTitle(task, model) {
			const extras = [
				task.kind,
				task.round === void 0 ? void 0 : `r${task.round}`,
				task.verdict,
				model === "" ? void 0 : model
			].filter((item) => item !== void 0);
			return extras.length === 0 ? `${task.id} · ${task.subject}` : `${task.id} · ${task.subject} · ${extras.join(" · ")}`;
		}
		/** Badge/bar coloring key: visual state, widened for terminal statuses. */
		function taskTone(state, status) {
			if (status === "failed") return "failed";
			if (status === "cancelled") return "cancelled";
			return state;
		}
		function Chevron({ open }) {
			return (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.chevron,
				"data-open": open,
				width: "9",
				height: "9",
				viewBox: "0 0 10 10",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				"aria-hidden": true,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M3.5 2l3 3-3 3" })
			});
		}
		function WorkGlyph({ active }) {
			return (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.workGlyph,
				"data-active": active,
				width: "11",
				height: "11",
				viewBox: "0 0 11 11",
				fill: "currentColor",
				"aria-hidden": true,
				children: [
					[0, 0],
					[4.2, 0],
					[8.4, 0],
					[0, 4.2],
					[4.2, 4.2],
					[8.4, 4.2]
				].map(([x, y], index) => (0, react_jsx_runtime.jsx)("rect", {
					x,
					y,
					width: "2.6",
					height: "2.6",
					rx: ".6",
					style: { animationDelay: `${index * .15}s` }
				}, `${x}:${y}`))
			});
		}
		/** Collapsed badge: an always-visible corner pill while any team exists. */
		function CollapsedBadge({ count, busy, onClick, t }) {
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ActivityPanel_module_css_default.badge,
				"data-agent-teams-collapsed": true,
				"data-busy": busy,
				onClick,
				"aria-label": t("activity.badgeAria", { count }),
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeDot,
					"data-busy": busy,
					"aria-hidden": true
				}), (0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeCount,
					children: count
				})]
			});
		}
		function memberStateLabel(member, tasks, historic, t) {
			const owned = tasks.filter((task) => task.assignee === member.name);
			if (member.activity === "working") return t("member.state.working");
			if (owned.some((task) => task.status === "failed")) return t("member.state.failed");
			if (owned.some((task) => task.state === "blocked")) return t("member.state.waiting");
			if (owned.length > 0 && owned.every((task) => task.status === "completed")) return t("member.state.delivered");
			if (member.status === "removed") return t(historic ? "member.state.left" : "member.state.removed");
			if (owned.length > 0) return t("member.state.pending");
			return t("member.state.unassigned");
		}
		function memberStatusText(member, tasks, t) {
			const owned = tasks.filter((task) => task.assignee === member.name);
			const current = owned.find((task) => task.id === member.currentTask);
			const blocked = owned.find((task) => task.state === "blocked");
			if (member.activity === "working" && current !== void 0) {
				const model = taskModelLabel(current, [member]);
				return model === "" ? t("member.status.executing", { taskId: current.id }) : t("member.status.executingModel", {
					taskId: current.id,
					model
				});
			}
			if (member.activity === "working") return t("member.status.working");
			if (blocked !== void 0) {
				const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== "completed");
				if (dependency !== void 0) return t("member.status.waitingOn", {
					taskId: dependency.id,
					assignee: dependency.assignee || t("task.assignee.unclaimed")
				});
				return t("member.status.waitingPrerequisite");
			}
			if (member.total === 0) return t("member.status.waitingAssignment");
			if (member.done === member.total) return t("member.status.delivered");
			return t(member.activity === "idle" ? "member.status.idle" : "member.status.unknown");
		}
		function compactTaskLabel(subject) {
			const withoutVerb = subject.replace(/^开发\s*/u, "").replace(/^\d+[-_.、\s]*/u, "");
			const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb;
			return head.length > 18 ? `${head.slice(0, 17)}…` : head;
		}
		function taskSummary(team, t, discarded = false) {
			const completed = team.tasks.filter((task) => task.status === "completed");
			const cancelled = team.tasks.filter((task) => task.status === "cancelled");
			const running = team.tasks.filter((task) => task.state === "running");
			const blocked = team.tasks.filter((task) => task.state === "blocked");
			const ready = team.tasks.filter((task) => task.state === "open" && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled");
			const failed = team.tasks.filter((task) => task.status === "failed");
			if (discarded) return t("task.summary.discarded", { count: team.tasks.length });
			if (team.tasks.length === 0) return t("task.summary.waitingBreakdown");
			if (team.phase === "staged") return t("task.summary.staged", { count: team.tasks.length });
			if (completed.length === team.tasks.length) return t("task.summary.allDelivered", { count: completed.length });
			if (completed.length + cancelled.length + failed.length === team.tasks.length) return t("task.summary.ended", {
				completed: completed.length,
				cancelled: cancelled.length,
				failed: failed.length
			});
			if (failed.length > 0 && running.length === 0 && ready.length === 0 && blocked.length === 0) return t("task.summary.failedSettled", { count: failed.length });
			if (blocked.length > 0 && running.length > 0) return t("task.summary.blockedAndRunning", {
				tasks: formatTaskIds(blocked.slice(0, 3).map((task) => task.id), t),
				more: blocked.length > 3 ? t("task.summary.more", { count: blocked.length - 3 }) : ""
			});
			if (running.length > 0) return t("task.summary.running", { tasks: formatTaskIds(running.map((task) => task.id), t) });
			if (ready.length > 0) return t("task.summary.ready", { tasks: formatTaskIds(ready.map((task) => task.id), t) });
			if (blocked.length > 0) return t("task.summary.blocked", { tasks: formatTaskIds(blocked.map((task) => task.id), t) });
			return t("task.summary.waitingSchedule");
		}
		function ProgressOverview({ team, t, discarded = false }) {
			const running = discarded ? 0 : team.tasks.filter((task) => task.state === "running").length;
			const blocked = discarded ? 0 : team.tasks.filter((task) => task.state === "blocked").length;
			const completed = discarded ? 0 : team.tasks.filter((task) => task.status === "completed").length;
			const settled = !discarded && team.tasks.length > 0 && team.tasks.every((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled");
			const summaryTone = discarded ? "discarded" : blocked > 0 ? "warning" : settled ? "completed" : "running";
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.progressOverview,
				"aria-label": t("progress.aria"),
				"data-progress-summary": true,
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.progressTitle,
						children: t("progress.title")
					}),
					team.tasks.length > 0 ? (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.progressSegments,
						"aria-hidden": true,
						children: team.tasks.map((task) => (0, react_jsx_runtime.jsx)("span", { "data-state": discarded ? "cancelled" : taskTone(task.state, task.status) }, task.id))
					}) : (0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.progressEmpty }),
					(0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.progressLegend,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								"data-state": "running",
								children: t("progress.running", { count: running })
							}),
							(0, react_jsx_runtime.jsx)("span", {
								"data-state": "blocked",
								children: t("progress.blocked", { count: blocked })
							}),
							(0, react_jsx_runtime.jsx)("span", {
								"data-state": "completed",
								children: t("progress.delivered", { count: completed })
							})
						]
					}),
					(0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.progressSummary,
						"data-state": summaryTone,
						children: [(0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.progressSummaryDot }), (0, react_jsx_runtime.jsx)("span", { children: taskSummary(team, t, discarded) })]
					})
				]
			});
		}
		function DependencyMap({ tasks, members, t, discarded = false }) {
			const [open, setOpen] = (0, react.useState)(true);
			const [hoverTaskId, setHoverTaskId] = (0, react.useState)(null);
			const [keyboardTaskId, setKeyboardTaskId] = (0, react.useState)(null);
			const [pinnedTaskId, setPinnedTaskId] = (0, react.useState)(null);
			const hoverTimer = (0, react.useRef)(null);
			const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId);
			const layout = (0, react.useMemo)(() => compactDagLayout(tasks), [tasks]);
			const parallel = (0, react.useMemo)(() => usesParallelTaskGrid(tasks), [tasks]);
			const related = (0, react.useMemo)(() => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks), [focusedTaskId, tasks]);
			const scheduleHover = (id) => {
				if (hoverTimer.current !== null) {
					clearTimeout(hoverTimer.current);
					hoverTimer.current = null;
				}
				if (id === null) {
					setHoverTaskId(null);
					return;
				}
				hoverTimer.current = setTimeout(() => {
					hoverTimer.current = null;
					setHoverTaskId(id);
				}, 180);
			};
			(0, react.useEffect)(() => () => {
				if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
			}, []);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") setPinnedTaskId(null);
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, []);
			if (tasks.length === 0) return null;
			const fallbackTask = tasks.find((task) => task.state === "blocked") ?? tasks.find((task) => task.state === "running") ?? tasks[0];
			const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask;
			const detailModel = taskModelLabel(detailTask, members);
			const waitingOn = detailTask.dependencies.filter((dependency) => tasks.find((task) => task.id === dependency)?.status !== "completed");
			const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id));
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.dependencySection,
				"aria-label": t("dependency.aria"),
				"data-dependency-map": true,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: ActivityPanel_module_css_default.sectionHead,
					children: [(0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ActivityPanel_module_css_default.sectionToggleTitle,
						onClick: () => {
							setOpen((current) => !current);
						},
						"aria-expanded": open,
						children: [
							(0, react_jsx_runtime.jsx)(Chevron, { open }),
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}),
							" ",
							t(parallel ? "dependency.parallel" : "dependency.title")
						]
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.sectionHint,
						children: pinnedTaskId === null ? t(parallel ? "dependency.hint.parallel" : "dependency.hint.chain") : t("dependency.hint.pinned", { taskId: pinnedTaskId })
					})]
				}), open && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("div", {
					className: ActivityPanel_module_css_default.dagViewport,
					children: (0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.dagCanvas,
						"data-layout": parallel ? "parallel" : "dependency",
						style: parallel ? void 0 : {
							width: layout.width,
							height: layout.height
						},
						children: [!parallel && (0, react_jsx_runtime.jsx)("svg", {
							className: ActivityPanel_module_css_default.dagEdges,
							width: layout.width,
							height: layout.height,
							"aria-hidden": true,
							children: layout.edges.map((edge) => {
								const active = related !== null && related.has(edge.from) && related.has(edge.to);
								return (0, react_jsx_runtime.jsx)("path", {
									d: edge.path,
									"data-active": active,
									"data-dimmed": related !== null && !active
								}, `${edge.from}:${edge.to}`);
							})
						}), layout.nodes.map(({ task, x, y }) => {
							const model = taskModelLabel(task, members);
							const shortModel = compactModelLabel(model);
							return (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.dagNode,
								style: parallel ? { height: 30 } : {
									left: x,
									top: y,
									width: 92,
									height: 30
								},
								"data-task-id": task.id,
								"data-state": discarded ? "cancelled" : taskTone(task.state, task.status),
								"data-task-model": model || void 0,
								"data-focused": related?.has(task.id) ?? false,
								"data-dimmed": related !== null && !related.has(task.id),
								"aria-pressed": pinnedTaskId === task.id,
								title: taskTitle(task, model),
								onClick: () => {
									setPinnedTaskId((current) => current === task.id ? null : task.id);
								},
								onMouseEnter: () => {
									scheduleHover(task.id);
								},
								onMouseLeave: () => {
									scheduleHover(null);
								},
								onFocus: () => {
									setKeyboardTaskId(task.id);
								},
								onBlur: () => {
									setKeyboardTaskId(null);
								},
								children: [
									(0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.dagNodeHead,
										children: [(0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.dagNodeDot }), task.id]
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.dagNodeLabel,
										children: task.state === "running" && shortModel !== "" ? shortModel : compactTaskLabel(task.subject)
									}),
									task.state === "running" && (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.dagRunningState,
										"aria-label": t("task.runningAria"),
										children: (0, react_jsx_runtime.jsx)(WorkGlyph, { active: true })
									})
								]
							}, task.id);
						})]
					})
				}), (0, react_jsx_runtime.jsxs)("section", {
					className: ActivityPanel_module_css_default.taskDetail,
					"data-task-detail": detailTask.id,
					children: [
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.taskDetailHead,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailId,
									children: detailTask.id
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailSubject,
									title: detailTask.subject,
									children: detailTask.subject.replace(/^开发\s*/u, "")
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailBadge,
									"data-state": discarded ? "cancelled" : taskTone(detailTask.state, detailTask.status),
									children: discarded ? t("task.status.notRun") : taskStatusLabel(detailTask.status, t)
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.taskDetailLine,
							children: [
								detailTask.assignee || t("task.assignee.unclaimed"),
								" · ",
								discarded ? t("task.detail.notRun") : detailTask.status === "completed" ? t("task.detail.completed") : detailTask.dependencies.length === 0 ? t("task.detail.noPrerequisite") : waitingOn.length === 0 ? t("task.detail.ready") : t("task.detail.waitingOn", { tasks: formatTaskIds(waitingOn, t) })
							]
						}),
						detailModel !== "" && (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailModel,
							"data-task-model": detailModel,
							children: t("task.model", { model: detailModel })
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailMeta,
							children: dependents.length === 0 ? t("task.detail.noDownstream") : t("task.detail.unlocks", { tasks: formatTaskIds(dependents.map((task) => task.id), t) })
						})
					]
				})] })]
			});
		}
		function TeamSection({ team, modelDirectory, onContinuePlanning, onDiscarded, onNavigate, t, historic = false }) {
			const [membersOpen, setMembersOpen] = (0, react.useState)(true);
			const [stopOpen, setStopOpen] = (0, react.useState)(false);
			const [stopping, setStopping] = (0, react.useState)(false);
			const [stopError, setStopError] = (0, react.useState)("");
			const discarded = historic && team.phase === "staged";
			const stopped = !historic && team.halted === true;
			const busyCount = team.members.filter((member) => member.activity === "working").length;
			const assignedCount = team.tasks.filter((task) => task.assignee !== "" && task.assignee !== CAPTAIN_ASSIGNEE).length;
			const captainOwned = team.tasks.filter((task) => task.assignee === CAPTAIN_ASSIGNEE && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled");
			const captainBusy = captainOwned.length > 0;
			const captainTaskIds = formatTaskIds(captainOwned.map((task) => task.id), t);
			const completedCount = team.tasks.filter((task) => task.status === "completed").length;
			const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length;
			const allSettled = team.tasks.length > 0 && team.tasks.every((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled");
			const unfinishedCount = team.tasks.filter((task) => task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled").length;
			const canStop = !historic && team.phase === "running" && team.halted !== true && teamIsActive(team);
			const stopTeam = async () => {
				if (stopping) return;
				setStopping(true);
				setStopError("");
				try {
					const response = await fetch(ACTIVITY_HALT_URL, {
						method: "POST",
						cache: "no-store",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sessionId: team.captainSessionId,
							teamId: team.teamId
						})
					});
					if (!response.ok) {
						let message = t("team.stopRequestFailed");
						try {
							const body = await response.json();
							if (typeof body.error === "string" && body.error.trim() !== "") message = body.error;
						} catch {}
						throw new Error(message);
					}
					setStopOpen(false);
				} catch (error) {
					setStopError(t("team.stopFailed", { message: error instanceof Error ? error.message : String(error) }));
				} finally {
					setStopping(false);
				}
			};
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.team,
				"data-team-id": team.teamId,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.teamHead,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.teamName,
								title: team.name,
								children: team.name
							}),
							historic && (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.historicPill,
								children: t(discarded ? "team.discarded" : "team.ended")
							}),
							stopped && (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.historicPill,
								children: t("team.stopped")
							}),
							(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.teamStats,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										"data-stat": "members",
										children: t("team.stats.members", { count: team.members.length })
									}),
									(0, react_jsx_runtime.jsx)("span", {
										"data-stat": "tasks",
										children: t("team.stats.completed", {
											completed: completedCount,
											total: team.tasks.length
										})
									}),
									(0, react_jsx_runtime.jsx)("span", {
										"data-stat": "messages",
										children: t("team.stats.messages", { count: team.messageCount })
									})
								]
							}),
							canStop && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.teamStopButton,
								"aria-label": t("team.stop"),
								title: t("team.stop"),
								onClick: () => {
									setStopError("");
									setStopOpen(true);
								},
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconStopFill16, {})
							})
						]
					}),
					team.phase === "staged" && !historic && modelDirectory !== void 0 && onContinuePlanning !== void 0 && onDiscarded !== void 0 && (0, react_jsx_runtime.jsx)(StagingPlanEditor, {
						team,
						modelDirectory,
						onContinuePlanning,
						onDiscarded,
						t
					}),
					(0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.delegationSection,
						"aria-label": t("delegation.aria"),
						"data-delegation-map": true,
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.captainNode,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.captainAvatar,
										children: (0, react_jsx_runtime.jsx)("img", {
											className: ActivityPanel_module_css_default.leadAvatar,
											src: LEAD_ART,
											alt: "",
											"aria-hidden": true
										})
									}),
									(0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.captainInfo,
										children: [(0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.captainLine,
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.captainName,
												children: t("captain.name")
											}), (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.captainRole,
												children: t("captain.role")
											})]
										}), (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.captainSummary,
											children: discarded ? t("captain.summary.discarded", {
												tasks: team.tasks.length,
												members: team.members.length
											}) : captainBusy ? t("captain.summary.withTakeover", {
												tasks: assignedCount,
												captainTasks: captainTaskIds
											}) : team.phase === "staged" ? t(team.planReviewState === "awaiting_feedback" ? "captain.summary.awaitingFeedback" : "captain.summary.staged", {
												tasks: team.tasks.length,
												members: team.members.length
											}) : t("captain.summary", {
												tasks: assignedCount,
												members: team.members.length
											})
										})]
									}),
									(0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.captainState,
										"data-busy": captainBusy || busyCount > 0,
										children: [(0, react_jsx_runtime.jsx)(WorkGlyph, { active: captainBusy || busyCount > 0 }), discarded ? t("captain.state.discarded") : captainBusy ? t("captain.state.takeover", { tasks: captainTaskIds }) : team.phase === "staged" ? t(team.planReviewState === "awaiting_feedback" ? "captain.state.awaitingFeedback" : "captain.state.staged") : busyCount > 0 ? t("captain.state.working", { count: busyCount }) : t(allCompleted ? "captain.state.collected" : allSettled ? "captain.state.settled" : "captain.state.waiting")]
									})
								]
							}),
							(0, react_jsx_runtime.jsx)(ProgressOverview, {
								team,
								t,
								discarded
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.membersToggle,
								onClick: () => {
									setMembersOpen((current) => !current);
								},
								"aria-expanded": membersOpen,
								"data-members-toggle": true,
								children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)(Chevron, { open: membersOpen }), t("members.toggle", { count: team.members.length })] }), (0, react_jsx_runtime.jsx)("span", { children: t(membersOpen ? "members.collapse" : "members.expand") })]
							}),
							membersOpen && (0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.delegationTree,
								children: [team.members.length === 0 && (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.emptyHint,
									children: t("members.empty")
								}), team.members.map((member) => {
									const owned = team.tasks.filter((task) => task.assignee === member.name);
									const memberModel = memberRouteLabel(member);
									return (0, react_jsx_runtime.jsxs)("div", {
										className: ActivityPanel_module_css_default.memberBlock,
										"data-activity": member.activity,
										children: [
											(0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberBranch,
												"aria-hidden": true,
												children: (0, react_jsx_runtime.jsx)("span", {})
											}),
											(0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: ActivityPanel_module_css_default.memberRow,
												"data-activity": member.activity,
												onClick: () => {
													if (member.id !== "") onNavigate(team.captainSessionId, member.id);
												},
												children: [
													(0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.memberAvatar,
														"data-unread": member.unread > 0,
														children: [memberArtUrl(member.name, member.role) !== null ? (0, react_jsx_runtime.jsx)("img", {
															className: ActivityPanel_module_css_default.memberArt,
															src: memberArtUrl(member.name, member.role) ?? "",
															alt: "",
															"aria-hidden": true
														}) : (0, react_jsx_runtime.jsx)("span", {
															className: ActivityPanel_module_css_default.memberInitial,
															style: { background: accentOf(member.id) },
															children: memberInitial(member.name)
														}), (0, react_jsx_runtime.jsx)("img", {
															className: ActivityPanel_module_css_default.stateArt,
															"data-activity": member.activity,
															src: ACTION_ART[member.activity],
															alt: "",
															"aria-hidden": true
														})]
													}),
													(0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.memberInfo,
														children: [
															(0, react_jsx_runtime.jsxs)("span", {
																className: ActivityPanel_module_css_default.memberLine,
																children: [
																	(0, react_jsx_runtime.jsx)("span", {
																		className: ActivityPanel_module_css_default.memberName,
																		children: member.name
																	}),
																	member.role !== "" && (0, react_jsx_runtime.jsx)("span", {
																		className: ActivityPanel_module_css_default.memberRole,
																		children: member.role
																	}),
																	(0, react_jsx_runtime.jsxs)("span", {
																		className: ActivityPanel_module_css_default.memberState,
																		"data-activity": member.activity,
																		children: [(0, react_jsx_runtime.jsx)(WorkGlyph, { active: member.activity === "working" }), discarded ? t("member.state.notCreated") : stopped ? t("member.state.stopped") : team.phase === "staged" ? t("member.state.staged") : memberStateLabel(member, team.tasks, historic, t)]
																	})
																]
															}),
															(0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.memberStatusLine,
																children: discarded ? t("member.status.discarded") : stopped ? t("member.status.stopped") : team.phase === "staged" ? t("member.status.staged") : historic && owned.length > 0 && owned.every((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled") ? t("member.status.settled") : memberStatusText(member, team.tasks, t)
															}),
															memberModel !== "" && (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.memberModel,
																"data-member-model": memberModel,
																children: t("member.model", { model: memberModel })
															})
														]
													}),
													(0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.memberCount,
														children: [
															member.done,
															"/",
															member.total
														]
													})
												]
											}),
											(0, react_jsx_runtime.jsxs)("div", {
												className: ActivityPanel_module_css_default.assignmentLine,
												children: [(0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.assignmentLabel,
													children: t(discarded ? "assignment.discarded" : team.phase === "staged" ? "assignment.staged" : "assignment.label")
												}), (0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.assignmentTasks,
													children: owned.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
														className: ActivityPanel_module_css_default.taskEmpty,
														children: t("assignment.empty")
													}) : owned.map((task) => {
														const model = taskModelLabel(task, team.members);
														const shortModel = compactModelLabel(model);
														return (0, react_jsx_runtime.jsx)("span", {
															className: ActivityPanel_module_css_default.assignmentChip,
															"data-state": discarded ? "cancelled" : taskTone(task.state, task.status),
															"data-task-model": model || void 0,
															title: taskTitle(task, model),
															children: task.state === "running" && shortModel !== "" ? `${task.id} · ${shortModel}` : task.id
														}, task.id);
													})
												})]
											})
										]
									}, member.id || member.name);
								})]
							})
						]
					}),
					(0, react_jsx_runtime.jsx)(DependencyMap, {
						tasks: team.tasks,
						members: team.members,
						t,
						discarded
					})
				]
			}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: stopOpen,
				onClose: () => {
					if (!stopping) setStopOpen(false);
				},
				title: t("team.stopTitle", { team: team.name }),
				closeLabel: t("plan.cancel"),
				description: t("team.stopDescription", {
					tasks: unfinishedCount,
					members: busyCount
				}),
				footer: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.stopModalActions,
					children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: stopping,
						onClick: () => {
							setStopOpen(false);
						},
						children: t("team.stopCancel")
					}), (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"data-danger": true,
						disabled: stopping,
						onClick: () => {
							stopTeam();
						},
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconStopFill16, {}), stopping ? t("team.stopping") : t("team.stopConfirm")]
					})]
				}),
				children: stopError !== "" && (0, react_jsx_runtime.jsxs)("p", {
					className: ActivityPanel_module_css_default.stopModalError,
					role: "alert",
					children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, {}), stopError]
				})
			})] });
		}
		/** Legacy conversation cards may outlive their host archive. Project their
		* durable roster through the same rebuilt panel instead of a second UI. */
		function historicCardTeam(data, owner) {
			return {
				workspace: "",
				teamId: data.teamId,
				name: data.teamName,
				captainSessionId: data.captainSessionId || owner,
				phase: "running",
				members: data.members.map((member) => ({
					...member,
					status: "removed",
					activity: "idle",
					progress: 0,
					done: 0,
					total: 0,
					currentTask: "",
					unread: 0
				})),
				tasks: [],
				messageCount: 0,
				captainInbox: []
			};
		}
		function ActivityPanel({ sessionsList, modelDirectories, openMember, t }) {
			const navigateToSession = (parentId, childId) => {
				setOpen(false);
				setWasActive(false);
				openMember(parentId, childId);
			};
			const [open, setOpen] = (0, react.useState)(false);
			const [openOwner, setOpenOwner] = (0, react.useState)();
			const [autoOpened, setAutoOpened] = (0, react.useState)(false);
			const [wasActive, setWasActive] = (0, react.useState)(false);
			const [historic, setHistoric] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [layout, setLayout] = (0, react.useState)(initialPanelLayout);
			const [bounds, setBounds] = (0, react.useState)(initialPanelBounds);
			const [interaction, setInteraction] = (0, react.useState)(null);
			const panelRef = (0, react.useRef)(null);
			const boundsRef = (0, react.useRef)(bounds);
			const gestureRef = (0, react.useRef)(null);
			const frameRef = (0, react.useRef)(null);
			const pendingLayoutRef = (0, react.useRef)(null);
			const current = (0, react.useSyncExternalStore)(sessionsList.subscribe, sessionsList.getSnapshot).current;
			const autoOpenTrackerRef = (0, react.useRef)({
				sessionId: current,
				restoreComplete: false,
				liveTeamIds: /* @__PURE__ */ new Set()
			});
			const monitorTargets = (0, react.useSyncExternalStore)(subscribeActivityMonitorTargets, getActivityMonitorTargetsSnapshot);
			const returnToComposer = () => {
				setOpen(false);
				setOpenOwner(void 0);
				window.requestAnimationFrame(() => {
					document.querySelector("[data-composer-card] textarea")?.focus();
				});
			};
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			const currentTargets = (0, react.useMemo)(() => current === void 0 ? [] : monitorTargets.filter((target) => target.sessionId === current), [current, monitorTargets]);
			const currentRef = (0, react.useRef)(current);
			(0, react.useEffect)(() => {
				currentRef.current = current;
			}, [current]);
			const mountedAtRef = (0, react.useRef)(performance.now());
			const expanded = activityPanelExpandedForSession(open, openOwner, current);
			const geometry = (0, react.useMemo)(() => resolvePanelGeometry(layout, bounds), [layout, bounds]);
			const compact = compactPanelForBounds(bounds);
			const commitLayout = (0, react.useCallback)((next) => {
				setLayout(next);
			}, []);
			(0, react.useEffect)(() => {
				window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
			}, [layout]);
			(0, react.useLayoutEffect)(() => {
				const overlay = document.querySelector("[data-shell-overlay]");
				if (overlay === null) return;
				const conversation = document.querySelector("[data-phase='active']");
				let frame = null;
				const measure = () => {
					frame = null;
					const overlayRect = overlay.getBoundingClientRect();
					const conversationRect = conversation?.getBoundingClientRect();
					const next = {
						width: overlayRect.width,
						height: overlayRect.height,
						anchorRight: conversationRect === void 0 ? overlayRect.width : Math.min(Math.max(conversationRect.right - overlayRect.left, 0), overlayRect.width)
					};
					const previous = boundsRef.current;
					if (previous.width === next.width && previous.height === next.height && previous.anchorRight === next.anchorRight) return;
					boundsRef.current = next;
					setBounds(next);
				};
				const scheduleMeasure = () => {
					frame ??= requestAnimationFrame(measure);
				};
				measure();
				const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
				observer?.observe(overlay);
				if (conversation !== null) observer?.observe(conversation);
				window.addEventListener("resize", scheduleMeasure);
				return () => {
					if (frame !== null) cancelAnimationFrame(frame);
					observer?.disconnect();
					window.removeEventListener("resize", scheduleMeasure);
				};
			}, [current]);
			(0, react.useLayoutEffect)(() => {
				const tracker = autoOpenTrackerRef.current;
				if (tracker.sessionId !== current) {
					tracker.sessionId = current;
					tracker.restoreComplete = false;
					tracker.liveTeamIds = /* @__PURE__ */ new Set();
					setWasActive(false);
					setAutoOpened(false);
				}
				if (openOwner === void 0 || openOwner === current) return;
				setOpen(false);
				setOpenOwner(void 0);
			}, [current, openOwner]);
			(0, react.useLayoutEffect)(() => {
				const root = document.documentElement;
				if (expanded && geometry.mode === "docked" && !compact) {
					root.setAttribute(PANEL_OPEN_ATTRIBUTE, "");
					root.style.setProperty(PANEL_SHIFT_PROPERTY, `${geometry.width + PANEL_CONVERSATION_GAP + 18}px`);
				} else {
					root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
					root.style.removeProperty(PANEL_SHIFT_PROPERTY);
				}
				return () => {
					root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
					root.style.removeProperty(PANEL_SHIFT_PROPERTY);
				};
			}, [
				compact,
				expanded,
				geometry.mode,
				geometry.width
			]);
			(0, react.useEffect)(() => {
				if (current === void 0) return;
				const controller = startActivityPolling(currentTargets, { discoverySessionId: current });
				let active = true;
				const tracker = autoOpenTrackerRef.current;
				if (tracker.sessionId === current && !tracker.restoreComplete) controller.firstTick.then(() => {
					const latest = autoOpenTrackerRef.current;
					if (!active || latest.sessionId !== current || latest.restoreComplete) return;
					latest.liveTeamIds = new Set(getActivitySnapshotsSnapshot().teams.filter((team) => team.captainSessionId === current).map((team) => team.teamId));
					latest.restoreComplete = true;
				});
				return () => {
					active = false;
					controller.stop();
				};
			}, [current, currentTargets]);
			(0, react.useEffect)(() => {
				const onOpenPanel = (event) => {
					const activeSession = currentRef.current;
					if (activeSession === void 0) return;
					setOpenOwner(activeSession);
					setOpen(true);
					const detail = event.detail;
					if (detail?.teamId !== void 0) {
						const owner = detail.captainSessionId !== "" ? detail.captainSessionId : currentRef.current ?? "";
						const teamKey = `${owner}:${detail.teamId}`;
						setHistoric((previous) => {
							const next = new Map(previous);
							next.set(teamKey, {
								data: detail,
								owner
							});
							return next;
						});
					}
				};
				window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				return () => {
					window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				};
			}, []);
			const visibleTeams = (0, react.useMemo)(() => current === void 0 ? [] : teams.filter((team) => team.captainSessionId === current), [teams, current]);
			const visibleHistoric = (0, react.useMemo)(() => current === void 0 ? [] : [...historic.values()].filter(({ data, owner }) => owner === current && !teams.some((live) => live.captainSessionId === current && live.teamId === data.teamId) && !archivedTeams.some((archived) => archived.captainSessionId === current && archived.teamId === data.teamId)), [
				historic,
				current,
				teams,
				archivedTeams
			]);
			const visibleArchived = (0, react.useMemo)(() => current === void 0 ? [] : archivedTeams.filter((team) => team.captainSessionId === current && !teams.some((live) => live.captainSessionId === current && live.teamId === team.teamId)), [
				archivedTeams,
				current,
				teams
			]);
			const visibleCount = visibleTeams.length + visibleArchived.length + visibleHistoric.length;
			const visibleLiveTeamIds = (0, react.useMemo)(() => visibleTeams.map((team) => team.teamId).sort(), [visibleTeams]);
			(0, react.useEffect)(() => {
				const tracker = autoOpenTrackerRef.current;
				const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS;
				const shouldAutoExpand = tracker.sessionId === current && activityPanelShouldAutoExpand({
					alreadyAutoOpened: autoOpened,
					pageSettled: settled,
					restoreComplete: tracker.restoreComplete,
					previousLiveTeamIds: tracker.liveTeamIds,
					currentLiveTeamIds: visibleLiveTeamIds
				});
				if (tracker.sessionId === current && tracker.restoreComplete) tracker.liveTeamIds = new Set(visibleLiveTeamIds);
				if (visibleCount > 0) {
					setWasActive(true);
					if (shouldAutoExpand) {
						setOpenOwner(current);
						setOpen(true);
						setAutoOpened(true);
					}
					return;
				}
				if (!wasActive) return;
				const timer = setTimeout(() => {
					setOpen(false);
					setOpenOwner(void 0);
					setWasActive(false);
					setAutoOpened(false);
				}, AUTOCLOSE_GRACE_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [
				visibleCount,
				visibleLiveTeamIds.join("\0"),
				autoOpened,
				wasActive,
				current
			]);
			const busy = (0, react.useMemo)(() => visibleTeams.some((team) => team.members.some((member) => member.activity === "working")), [visibleTeams]);
			const hasTeams = visibleCount > 0;
			const panelGeometryForGesture = (0, react.useCallback)(() => {
				const measuredHeight = panelRef.current?.getBoundingClientRect().height;
				if (measuredHeight === void 0 || measuredHeight <= 0) return geometry;
				return {
					...geometry,
					height: measuredHeight
				};
			}, [geometry]);
			const flushScheduledLayout = (0, react.useCallback)(() => {
				if (frameRef.current !== null) {
					cancelAnimationFrame(frameRef.current);
					frameRef.current = null;
				}
				const pending = pendingLayoutRef.current;
				pendingLayoutRef.current = null;
				if (pending !== null) commitLayout(pending);
			}, [commitLayout]);
			const scheduleLayout = (0, react.useCallback)((next) => {
				pendingLayoutRef.current = next;
				frameRef.current ??= requestAnimationFrame(() => {
					frameRef.current = null;
					const pending = pendingLayoutRef.current;
					pendingLayoutRef.current = null;
					if (pending !== null) commitLayout(pending);
				});
			}, [commitLayout]);
			(0, react.useEffect)(() => () => {
				if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			}, []);
			const beginMove = (0, react.useCallback)((event) => {
				if (compact || event.button !== 0 || event.target.closest("button") !== null) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				gestureRef.current = {
					kind: "move",
					pointerId: event.pointerId,
					originX: event.clientX,
					originY: event.clientY,
					start: panelGeometryForGesture(),
					activated: false
				};
			}, [compact, panelGeometryForGesture]);
			const beginResize = (0, react.useCallback)((edge, event) => {
				if (compact || event.button !== 0 || geometry.mode === "docked" && edge !== "left") return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				gestureRef.current = {
					kind: "resize",
					edge,
					pointerId: event.pointerId,
					originX: event.clientX,
					originY: event.clientY,
					start: panelGeometryForGesture(),
					activated: true
				};
				setInteraction("resizing");
			}, [
				compact,
				geometry.mode,
				panelGeometryForGesture
			]);
			const updateGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
				const dx = event.clientX - gesture.originX;
				const dy = event.clientY - gesture.originY;
				const activeBounds = boundsRef.current;
				if (gesture.kind === "move") {
					if (!gesture.activated && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
					if (!gesture.activated) {
						gesture.activated = true;
						setInteraction("dragging");
					}
					scheduleLayout(movePanelLayout(floatPanelLayout(gesture.start, activeBounds), dx, dy, activeBounds));
					return;
				}
				scheduleLayout(resizePanelLayout(gesture.start, gesture.edge ?? "left", dx, dy, activeBounds));
			}, [scheduleLayout]);
			const endGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId) return;
				updateGesture(event);
				flushScheduledLayout();
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
				gestureRef.current = null;
				setInteraction(null);
			}, [flushScheduledLayout, updateGesture]);
			const cancelGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId) return;
				flushScheduledLayout();
				gestureRef.current = null;
				setInteraction(null);
			}, [flushScheduledLayout]);
			const toggleDock = (0, react.useCallback)(() => {
				const liveGeometry = panelGeometryForGesture();
				commitLayout(liveGeometry.mode === "docked" ? floatPanelLayout(liveGeometry, boundsRef.current) : dockPanelLayout(liveGeometry, boundsRef.current));
			}, [commitLayout, panelGeometryForGesture]);
			const autoHeight = panelUsesAutoHeight(geometry, bounds);
			const panelStyle = {
				width: geometry.width,
				height: autoHeight ? "auto" : geometry.height,
				maxHeight: panelMaximumHeight(geometry, bounds),
				transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`
			};
			if (!hasTeams && !expanded) return null;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [!expanded && (0, react_jsx_runtime.jsx)(CollapsedBadge, {
				count: visibleCount,
				busy,
				t,
				onClick: () => {
					if (current === void 0) return;
					setOpenOwner(current);
					setOpen(true);
				}
			}), expanded && (0, react_jsx_runtime.jsxs)("aside", {
				ref: panelRef,
				className: ActivityPanel_module_css_default.panel,
				style: panelStyle,
				"data-agent-teams-activity": true,
				"data-panel-mode": geometry.mode,
				"data-height-mode": autoHeight ? "auto" : "manual",
				"data-compact": compact || void 0,
				"data-dragging": interaction === "dragging" || void 0,
				"data-resizing": interaction === "resizing" || void 0,
				"aria-label": t("activity.panelAria"),
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.panelHead,
						onPointerDown: beginMove,
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"data-drag-handle": !compact || void 0,
						children: [(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.panelTitle,
							children: [t("activity.title"), (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.panelDot,
								"data-busy": busy,
								"aria-hidden": true
							})]
						}), (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.panelControls,
							children: [!compact && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.iconButton,
								"data-control": "dock",
								"data-mode": geometry.mode,
								onClick: toggleDock,
								"aria-label": t(geometry.mode === "docked" ? "activity.float" : "activity.dockRight"),
								title: t(geometry.mode === "docked" ? "activity.float" : "activity.dockRight"),
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutline16, {})
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.iconButton,
								"data-control": "collapse",
								onClick: () => {
									setOpen(false);
									setOpenOwner(void 0);
								},
								"aria-label": t("activity.collapse"),
								title: t("activity.collapse"),
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
							})]
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.teams,
						children: visibleCount === 0 ? (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.emptyHint,
							children: t("activity.empty")
						}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							visibleTeams.map((team) => (0, react_jsx_runtime.jsx)(TeamSection, {
								team,
								modelDirectory: team.phase === "staged" ? modelDirectories.directoryFor(team.captainSessionId) : void 0,
								onContinuePlanning: returnToComposer,
								onDiscarded: returnToComposer,
								onNavigate: navigateToSession,
								t
							}, team.teamId)),
							visibleArchived.map((team) => (0, react_jsx_runtime.jsxs)("div", {
								"data-team-id": team.teamId,
								"data-historic": true,
								className: ActivityPanel_module_css_default.archivedWrap,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.archiveLabel,
									children: t(team.phase === "staged" ? "archive.discardedLabel" : "archive.label")
								}), (0, react_jsx_runtime.jsx)(TeamSection, {
									team,
									onNavigate: navigateToSession,
									t,
									historic: true
								})]
							}, `${team.captainSessionId}:${team.teamId}`)),
							visibleHistoric.map(({ data: team, owner }) => {
								const teamKey = `${owner}:${team.teamId}`;
								return (0, react_jsx_runtime.jsx)(TeamSection, {
									team: historicCardTeam(team, owner),
									onNavigate: navigateToSession,
									t,
									historic: true
								}, teamKey);
							})
						] })
					}),
					!compact && (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "left",
						onPointerDown: (event) => {
							beginResize("left", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					}),
					!compact && geometry.mode === "floating" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "bottom",
						onPointerDown: (event) => {
							beginResize("bottom", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					}), (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "corner",
						onPointerDown: (event) => {
							beginResize("corner", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					})] })
				]
			})] });
		}
		//#endregion
		//#region lib/client/agent-teams-card-definition.js
		/**
		* AgentTeams conversation card: a lightweight in-conversation summary shown
		* when a team is created — the captain's name, the member roster with whale
		* avatars, and an entry point that re-activates the top-right activity
		* panel (useful after the floater was closed, or when re-opening an old
		* session for review).
		*
		* The fold anchors to the Harness's durable `tool/call` + `tool/result`
		* records for `agent_teams_create`. Those are first-party session events, so
		* the card survives restarts without writing an out-of-repo event type.
		* @module dsh-agent-teams/client/card
		*/
		/** Parse the only create-call fields the historic card owns. */
		function parseAgentTeamsCreateArgs(value) {
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed !== "object" || parsed === null || !("name" in parsed) || typeof parsed.name !== "string") return;
				const name = parsed.name.trim();
				if (name === "") return void 0;
				const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
				return {
					teamId: cleaned === "" ? "team" : cleaned,
					name
				};
			} catch {
				return;
			}
		}
		/** Durable first-party tool events folded into one keyed Chat node. */
		const agentTeamsCardDefinition = {
			kind: "agent-teams",
			target: "chat",
			match: (event) => {
				if (event.type === "tool/call" && event.data.name === "agent_teams_create") return parseAgentTeamsCreateArgs(event.data.arguments) === void 0 ? null : {
					id: String(event.data.callId),
					role: "start"
				};
				if (event.type === "tool/result" && event.data.message.source.kind === "tool") return {
					id: String(event.data.message.source.callId),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "tool/call") throw new Error("agent-teams card start requires agent_teams_create tool/call");
				const parsed = parseAgentTeamsCreateArgs(match.event.data.arguments);
				if (parsed === void 0) throw new Error("agent-teams card start requires valid create arguments");
				return {
					...parsed,
					accepted: false
				};
			},
			update: (context, match) => {
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.error !== void 0 || match.event.data.message.content.some((block) => block.type === "tool-result" && block.isError === true)) return context.state;
				return {
					...context.state,
					accepted: true
				};
			},
			buildViewNode: (context) => {
				if (context.start === void 0) return null;
				const state = context.state;
				if (!state.accepted) return null;
				return {
					key: context.key,
					kind: "agent-teams",
					id: context.id,
					target: "chat",
					anchorSeq: context.start.event.seq,
					location: context.start.location,
					visibility: "visible",
					data: {
						teamId: state.teamId,
						captainSessionId: "",
						teamName: state.name,
						members: []
					}
				};
			}
		};
		//#endregion
		//#region lib/client/locales.js
		/** `agentTeams` namespace dictionaries for every plugin-owned Web surface. */
		/** Dictionary namespace owned by the AgentTeams client plugin. */
		const AGENT_TEAMS_LOCALE_NAMESPACE = "agentTeams";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"card.memberCount": "{count} 名成员",
			"action.openActivityPanel": "打开活动面板",
			"activity.panelButton": "活动面板",
			"activity.badgeAria": "AgentTeams 活动与历史，{count} 条团队记录",
			"activity.panelAria": "AgentTeams 活动面板",
			"activity.title": "AgentTeams 活动",
			"activity.float": "切换为浮动面板",
			"activity.dockRight": "停靠到右侧",
			"activity.collapse": "收起活动面板",
			"activity.empty": "暂无团队活动",
			"team.stop": "停止团队",
			"team.stopped": "已停止",
			"team.stopTitle": "确认停止“{team}”？",
			"team.stopDescription": "将取消 {tasks} 项未完成任务，并停止 {members} 名正在工作的成员。已完成的结果会保留。",
			"team.stopCancel": "继续运行",
			"team.stopConfirm": "确认停止",
			"team.stopping": "正在停止…",
			"team.stopFailed": "停止失败：{message}",
			"team.stopRequestFailed": "服务器未能停止团队，请重试",
			"team.discarded": "已放弃",
			"format.listSeparator": "、",
			"task.status.pending": "待领取",
			"task.status.claimed": "已认领",
			"task.status.inProgress": "进行中",
			"task.status.completed": "已完成",
			"task.status.failed": "失败",
			"task.status.cancelled": "已取消",
			"task.status.notRun": "未执行",
			"member.state.working": "工作中",
			"member.state.failed": "有失败",
			"member.state.waiting": "等待",
			"member.state.delivered": "已交付",
			"member.state.left": "已离队",
			"member.state.removed": "已移除",
			"member.state.pending": "待执行",
			"member.state.unassigned": "待派工",
			"member.state.staged": "待创建",
			"member.state.notCreated": "未创建",
			"member.state.stopped": "已停止",
			"member.status.executing": "正在执行 {taskId}",
			"member.status.executingModel": "正在执行 {taskId} · {model}",
			"member.status.working": "正在处理已派任务",
			"member.status.waitingOn": "等待 {taskId} · {assignee}",
			"member.status.waitingPrerequisite": "等待前置任务",
			"member.status.waitingAssignment": "等待队长派工",
			"member.status.delivered": "任务已交付",
			"member.status.idle": "待继续执行",
			"member.status.unknown": "状态未知",
			"member.status.staged": "确认后创建并启动",
			"member.status.settled": "任务均已终结",
			"member.status.discarded": "计划已放弃，未创建",
			"member.status.stopped": "团队已停止，需显式恢复",
			"task.assignee.unclaimed": "待认领",
			"task.summary.waitingBreakdown": "等待队长拆解任务",
			"task.summary.staged": "{count} 项计划等待确认",
			"task.summary.discarded": "{count} 项计划已放弃，均未执行",
			"task.summary.allDelivered": "全部 {count} 项任务已交付",
			"task.summary.ended": "终态：{completed} 已交付 · {cancelled} 已取消 · {failed} 失败",
			"task.summary.blockedAndRunning": "{tasks}{more} 等待前置，其余已开工",
			"task.summary.more": " 等 {count} 项",
			"task.summary.running": "{tasks} 正在执行",
			"task.summary.ready": "{tasks} 已就绪待开工",
			"task.summary.blocked": "{tasks} 等待前置",
			"task.summary.failedSettled": "{count} 项已失败，自动循环已停止",
			"task.summary.waitingSchedule": "等待下一轮调度",
			"progress.aria": "团队总进度",
			"progress.title": "总进度",
			"progress.running": "■ 进行中 {count}",
			"progress.blocked": "■ 等待依赖 {count}",
			"progress.delivered": "■ 已交付 {count}",
			"dependency.aria": "任务依赖链",
			"dependency.parallel": "并行任务",
			"dependency.title": "任务依赖",
			"dependency.hint.parallel": "无前后依赖 · 点击查看详情",
			"dependency.hint.chain": "悬停高亮依赖链 · 点击固定",
			"dependency.hint.pinned": "{taskId} 已固定 · Esc 取消",
			"task.runningAria": "运行中",
			"task.model": "{model}",
			"member.model": "{model}",
			"task.detail.completed": "已完成并交付",
			"task.detail.noPrerequisite": "无前置，可立即开工",
			"task.detail.ready": "前置已就绪，可开工",
			"task.detail.waitingOn": "等待 {tasks}",
			"task.detail.notRun": "计划已放弃，任务未执行",
			"task.detail.noDownstream": "无下游任务",
			"task.detail.unlocks": "完成后解锁 {tasks}",
			"team.ended": "已结束",
			"plan.badge": "待确认",
			"plan.title": "执行前计划审查",
			"plan.description": "成员尚未创建、任务尚未调度。可直接调整计划，也可返回对话告诉队长哪里需要修改。",
			"plan.member.role": "角色",
			"plan.member.provider": "Provider",
			"plan.member.model": "模型",
			"plan.member.reasoning": "推理等级",
			"plan.member.reasoningHint": "留空使用默认值；可用 low、medium、high、xhigh 等",
			"plan.model.choose": "选择模型",
			"plan.model.currentUnavailable": "{provider}/{model}（当前目录不可用）",
			"plan.model.route": "路由：{provider}/{model}",
			"plan.model.defaultReasoning": "默认推理等级",
			"plan.model.providerDefault": "Provider 默认值",
			"plan.model.modelDefault": "模型默认值（{effort}）",
			"plan.model.triggerAria": "选择成员模型，当前 {model}，推理等级 {effort}",
			"plan.model.back": "返回",
			"plan.model.loading": "正在加载模型…",
			"plan.model.empty": "暂无可用模型",
			"plan.model.partialFailure": "{count} 个 Provider 的模型目录加载失败",
			"plan.model.retry": "重试",
			"plan.member.prompt": "角色提示词",
			"plan.member.roleFallback": "未设置角色",
			"plan.task.subject": "任务名称",
			"plan.task.description": "任务说明",
			"plan.task.assignee": "负责人",
			"plan.task.dependencies": "依赖任务 ID（逗号分隔）",
			"plan.task.dependenciesHint": "例如 task-1, task-2；不得形成循环依赖",
			"plan.task.unassigned": "共享任务池",
			"plan.unsaved": "未保存",
			"plan.save": "保存",
			"plan.saving": "保存中…",
			"plan.remove": "删除",
			"plan.removed": "任务已删除",
			"plan.removeConfirm": "确认删除",
			"plan.removeWarning": "删除 {task} 后将重新计算依赖关系。",
			"plan.cancel": "取消",
			"plan.addTask": "添加任务",
			"plan.adding": "添加中…",
			"plan.taskAdded": "任务已添加",
			"plan.newTask": "新任务名称",
			"plan.newTaskLabel": "新增计划任务",
			"plan.readySummary": "{members} 名成员 · {tasks} 项任务 · {links} 条依赖",
			"plan.flow.aria": "团队启动流程",
			"plan.flow.review": "审查计划",
			"plan.flow.spawn": "创建成员",
			"plan.flow.run": "开始执行",
			"plan.members.title": "成员与模型路由",
			"plan.members.count": "{count} 名成员",
			"plan.members.empty": "尚未规划成员",
			"plan.tasks.title": "任务与依赖",
			"plan.tasks.count": "{count} 项任务 · {links} 条依赖",
			"plan.tasks.empty": "尚未规划任务",
			"plan.dependencies.none": "无依赖",
			"plan.dependencies.count": "{count} 条依赖",
			"plan.approve": "确认并启动团队",
			"plan.approving": "正在创建成员…",
			"plan.approveTitle": "计划检查完毕？",
			"plan.approveHint": "确认后将创建 {members} 名成员并调度 {tasks} 项任务。",
			"plan.approveConfirmTitle": "确认启动此团队",
			"plan.approveWarning": "启动后不能再在此处编辑成员和依赖。",
			"plan.approveConfirm": "确认启动",
			"plan.continue": "返回对话修改",
			"plan.returnToChat": "回到对话",
			"plan.feedbackTitle": "正在等你说明修改方向",
			"plan.feedbackHint": "队长会在对话中追问；收到你的回复后，只修改这份草案并再次等待确认。",
			"plan.discard": "放弃本次计划",
			"plan.discardConfirmTitle": "放弃本次计划？",
			"plan.discardWarning": "该计划会结束并归档；尚未创建任何成员，也不会执行任务。",
			"plan.discardConfirm": "确认放弃",
			"plan.discarding": "正在放弃…",
			"plan.pendingEdits": "请先保存当前修改，再启动团队。",
			"plan.saved": "计划已保存",
			"plan.failed": "操作失败：{message}",
			"team.stats.members": "{count} 名成员",
			"team.stats.completed": "{completed}/{total} 完成",
			"team.stats.messages": "{count} 条消息",
			"delegation.aria": "队长派工关系",
			"captain.name": "队长",
			"captain.role": "拆解 · 派发 · 汇总",
			"captain.summary": "已派发 {tasks} 项任务给 {members} 名成员",
			"captain.summary.staged": "已规划 {tasks} 项任务与 {members} 名成员，等待确认",
			"captain.summary.awaitingFeedback": "草案已保留，等待你在对话中说明修改方向",
			"captain.summary.discarded": "计划已放弃：{members} 名成员未创建，{tasks} 项任务未执行",
			"captain.summary.withTakeover": "已派发 {tasks} 项给成员 · 队长接管 {captainTasks}",
			"captain.state.working": "{count} 人执行中",
			"captain.state.takeover": "正在执行 {tasks}",
			"captain.state.collected": "已收齐",
			"captain.state.waiting": "等待回报",
			"captain.state.staged": "待确认",
			"captain.state.awaitingFeedback": "待反馈",
			"captain.state.discarded": "已放弃",
			"captain.state.settled": "已终结",
			"members.toggle": "{count} 名成员",
			"members.collapse": "收起",
			"members.expand": "展开",
			"members.empty": "暂无成员，等待队长组建团队",
			"assignment.label": "队长派发",
			"assignment.staged": "计划任务",
			"assignment.discarded": "未执行的计划",
			"assignment.empty": "暂无任务",
			"archive.label": "已结束 · 历史归档",
			"archive.discardedLabel": "计划已放弃 · 历史归档"
		};
		/** English dictionary, checked complete against the Chinese source key set. */
		const en = {
			"card.memberCount": "{count} members",
			"action.openActivityPanel": "Open activity panel",
			"activity.panelButton": "Activity panel",
			"activity.badgeAria": "AgentTeams activity and history, {count} team records",
			"activity.panelAria": "AgentTeams activity panel",
			"activity.title": "AgentTeams activity",
			"activity.float": "Switch to floating panel",
			"activity.dockRight": "Dock to the right",
			"activity.collapse": "Collapse activity panel",
			"activity.empty": "No team activity",
			"team.stop": "Stop team",
			"team.stopped": "Stopped",
			"team.stopTitle": "Stop “{team}”?",
			"team.stopDescription": "This cancels {tasks} unfinished tasks and stops {members} working members. Completed results are kept.",
			"team.stopCancel": "Keep running",
			"team.stopConfirm": "Stop team",
			"team.stopping": "Stopping…",
			"team.stopFailed": "Could not stop team: {message}",
			"team.stopRequestFailed": "The server could not stop this team. Try again.",
			"team.discarded": "Discarded",
			"format.listSeparator": ", ",
			"task.status.pending": "Unclaimed",
			"task.status.claimed": "Claimed",
			"task.status.inProgress": "In progress",
			"task.status.completed": "Completed",
			"task.status.failed": "Failed",
			"task.status.cancelled": "Cancelled",
			"task.status.notRun": "Not run",
			"member.state.working": "Working",
			"member.state.failed": "Has failures",
			"member.state.waiting": "Waiting",
			"member.state.delivered": "Delivered",
			"member.state.left": "Left team",
			"member.state.removed": "Removed",
			"member.state.pending": "Pending",
			"member.state.unassigned": "Awaiting assignment",
			"member.state.staged": "Not spawned",
			"member.state.notCreated": "Not created",
			"member.state.stopped": "Stopped",
			"member.status.executing": "Working on {taskId}",
			"member.status.executingModel": "Working on {taskId} · {model}",
			"member.status.working": "Working on assigned tasks",
			"member.status.waitingOn": "Waiting for {taskId} · {assignee}",
			"member.status.waitingPrerequisite": "Waiting for prerequisites",
			"member.status.waitingAssignment": "Waiting for the captain to assign work",
			"member.status.delivered": "Tasks delivered",
			"member.status.idle": "Ready to continue",
			"member.status.unknown": "Status unknown",
			"member.status.staged": "Will be spawned after approval",
			"member.status.settled": "All assigned work is settled",
			"member.status.discarded": "Plan discarded; member was not created",
			"member.status.stopped": "Team stopped; explicit resume required",
			"task.assignee.unclaimed": "Unclaimed",
			"task.summary.waitingBreakdown": "Waiting for the captain to break down the work",
			"task.summary.staged": "{count} planned tasks awaiting approval",
			"task.summary.discarded": "{count} planned tasks discarded; none ran",
			"task.summary.allDelivered": "All {count} tasks delivered",
			"task.summary.ended": "Final: {completed} delivered · {cancelled} cancelled · {failed} failed",
			"task.summary.blockedAndRunning": "{tasks}{more} waiting on prerequisites; other work has started",
			"task.summary.more": " and {count} more",
			"task.summary.running": "{tasks} in progress",
			"task.summary.ready": "{tasks} ready to start",
			"task.summary.blocked": "{tasks} waiting on prerequisites",
			"task.summary.failedSettled": "{count} failed; the automatic loop has stopped",
			"task.summary.waitingSchedule": "Waiting for the next scheduling round",
			"progress.aria": "Overall team progress",
			"progress.title": "Overall progress",
			"progress.running": "■ In progress {count}",
			"progress.blocked": "■ Waiting {count}",
			"progress.delivered": "■ Delivered {count}",
			"dependency.aria": "Task dependency chain",
			"dependency.parallel": "Parallel tasks",
			"dependency.title": "Task dependencies",
			"dependency.hint.parallel": "No dependencies · Click for details",
			"dependency.hint.chain": "Hover to highlight dependencies · Click to pin",
			"dependency.hint.pinned": "{taskId} pinned · Esc to clear",
			"task.runningAria": "Running",
			"task.model": "{model}",
			"member.model": "{model}",
			"task.detail.completed": "Completed and delivered",
			"task.detail.noPrerequisite": "No prerequisites; ready to start",
			"task.detail.ready": "Prerequisites ready; can start",
			"task.detail.waitingOn": "Waiting for {tasks}",
			"task.detail.notRun": "Plan discarded; task was not run",
			"task.detail.noDownstream": "No downstream tasks",
			"task.detail.unlocks": "Unlocks {tasks} when complete",
			"team.ended": "Ended",
			"plan.badge": "Awaiting approval",
			"plan.title": "Pre-run plan review",
			"plan.description": "Members have not been spawned and tasks have not been scheduled. Edit the draft here, or return to chat and tell the Captain what should change.",
			"plan.member.role": "Role",
			"plan.member.provider": "Provider",
			"plan.member.model": "Model",
			"plan.member.reasoning": "Reasoning effort",
			"plan.member.reasoningHint": "Leave blank for default; accepts low, medium, high, xhigh, and more",
			"plan.model.choose": "Choose a model",
			"plan.model.currentUnavailable": "{provider}/{model} (not in the current catalog)",
			"plan.model.route": "Route: {provider}/{model}",
			"plan.model.defaultReasoning": "Default reasoning effort",
			"plan.model.providerDefault": "Provider default",
			"plan.model.modelDefault": "Model default ({effort})",
			"plan.model.triggerAria": "Choose member model, currently {model}, reasoning effort {effort}",
			"plan.model.back": "Back",
			"plan.model.loading": "Loading models…",
			"plan.model.empty": "No models available",
			"plan.model.partialFailure": "{count} provider catalogs could not be loaded",
			"plan.model.retry": "Retry",
			"plan.member.prompt": "Role prompt",
			"plan.member.roleFallback": "Role not set",
			"plan.task.subject": "Task subject",
			"plan.task.description": "Task description",
			"plan.task.assignee": "Assignee",
			"plan.task.dependencies": "Dependency task IDs (comma-separated)",
			"plan.task.dependenciesHint": "For example task-1, task-2; cycles are rejected",
			"plan.task.unassigned": "Shared task pool",
			"plan.unsaved": "Unsaved",
			"plan.save": "Save",
			"plan.saving": "Saving…",
			"plan.remove": "Remove",
			"plan.removed": "Task removed",
			"plan.removeConfirm": "Confirm remove",
			"plan.removeWarning": "Removing {task} will recalculate downstream dependencies.",
			"plan.cancel": "Cancel",
			"plan.addTask": "Add task",
			"plan.adding": "Adding…",
			"plan.taskAdded": "Task added",
			"plan.newTask": "New task subject",
			"plan.newTaskLabel": "Add a planned task",
			"plan.readySummary": "{members} members · {tasks} tasks · {links} dependencies",
			"plan.flow.aria": "Team launch flow",
			"plan.flow.review": "Review plan",
			"plan.flow.spawn": "Create members",
			"plan.flow.run": "Start work",
			"plan.members.title": "Members & model routes",
			"plan.members.count": "{count} members",
			"plan.members.empty": "No members planned yet",
			"plan.tasks.title": "Tasks & dependencies",
			"plan.tasks.count": "{count} tasks · {links} dependencies",
			"plan.tasks.empty": "No tasks planned yet",
			"plan.dependencies.none": "No dependencies",
			"plan.dependencies.count": "{count} dependencies",
			"plan.approve": "Approve & Run",
			"plan.approving": "Creating members…",
			"plan.approveTitle": "Plan ready?",
			"plan.approveHint": "Approval creates {members} members and schedules {tasks} tasks.",
			"plan.approveConfirmTitle": "Confirm team launch",
			"plan.approveWarning": "Member routes and dependencies cannot be edited here after launch.",
			"plan.approveConfirm": "Confirm launch",
			"plan.continue": "Return to chat & revise",
			"plan.returnToChat": "Return to chat",
			"plan.feedbackTitle": "Waiting for your revision direction",
			"plan.feedbackHint": "The Captain will ask in chat. After your reply, it will revise this draft and wait for approval again.",
			"plan.discard": "Discard this plan",
			"plan.discardConfirmTitle": "Discard this plan?",
			"plan.discardWarning": "The plan will end and be archived. No members have been spawned and no tasks will run.",
			"plan.discardConfirm": "Discard plan",
			"plan.discarding": "Discarding…",
			"plan.pendingEdits": "Save the current edits before launching the team.",
			"plan.saved": "Plan saved",
			"plan.failed": "Operation failed: {message}",
			"team.stats.members": "{count} members",
			"team.stats.completed": "{completed}/{total} completed",
			"team.stats.messages": "{count} messages",
			"delegation.aria": "Captain delegation map",
			"captain.name": "Captain",
			"captain.role": "Break down · Delegate · Synthesize",
			"captain.summary": "Assigned {tasks} tasks to {members} members",
			"captain.summary.staged": "Planned {tasks} tasks and {members} members; awaiting approval",
			"captain.summary.awaitingFeedback": "Draft preserved; waiting for your revision direction in chat",
			"captain.summary.discarded": "Plan discarded: {members} members were not created and {tasks} tasks did not run",
			"captain.summary.withTakeover": "Assigned {tasks} to members · Captain owns {captainTasks}",
			"captain.state.working": "{count} active",
			"captain.state.takeover": "Working on {tasks}",
			"captain.state.collected": "All reports received",
			"captain.state.waiting": "Waiting for reports",
			"captain.state.staged": "Awaiting approval",
			"captain.state.awaitingFeedback": "Awaiting feedback",
			"captain.state.discarded": "Discarded",
			"captain.state.settled": "Settled",
			"members.toggle": "Members {count}",
			"members.collapse": "Collapse",
			"members.expand": "Expand",
			"members.empty": "No members yet; waiting for the captain to assemble the team",
			"assignment.label": "Captain assigned",
			"assignment.staged": "Planned task",
			"assignment.discarded": "Plan not run",
			"assignment.empty": "No tasks",
			"archive.label": "Ended · Archived history",
			"archive.discardedLabel": "Plan discarded · Archived history"
		};
		//#endregion
		//#region lib/client/session-navigation.js
		/** Version-tolerant navigation into durable AgentTeams member transcripts. */
		/**
		* Open one member's persisted transcript.
		*
		* Harness rc.8 intentionally removed cold subagents from the ordinary session
		* list. They must first be rediscovered in their parent's catalog, then opened
		* with the exact parent/child/mode address. Older runtimes have only `open()`;
		* the fallback preserves the plugin's rc.6 peer range.
		*/
		async function openAgentTeamMember(sessions, parentSessionId, childSessionId) {
			if (sessions.openSubagent === void 0 || sessions.refreshSubagents === void 0) {
				sessions.open(childSessionId);
				return "session";
			}
			await sessions.refreshSubagents(parentSessionId);
			const retained = sessions.subagentAddress?.(childSessionId);
			sessions.openSubagent(retained?.parentSessionId === parentSessionId ? retained : {
				parentSessionId,
				childSessionId,
				mode: "continuable"
			});
			return "subagent";
		}
		//#endregion
		//#region lib/client/index.js
		/** Required services: conversation nodes, slots, sessions navigation, and locale. */
		const inject = [
			"conversationEvents",
			"slots",
			"sessions",
			"locale",
			"modelDirectories"
		];
		/** The replayed user message is the canonical transcript entry. */
		function HiddenAgentTeamsCommand() {
			return null;
		}
		/**
		* Register the activity monitor in the shell's additive overlay and the
		* in-conversation team card. The card's activity button re-opens a folded
		* monitor via a window event — the recovery path for an old session.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, {
				zh,
				en
			}), "agent-teams: dictionaries");
			const openMember = (parentId, childId) => {
				openAgentTeamMember(ctx.sessions, parentId, childId).catch((error) => {
					console.warn(`agent-teams: failed to open member transcript ${childId}: ${String(error)}`);
				});
			};
			const Panel = ({ t }) => (0, react_jsx_runtime.jsx)(ActivityPanel, {
				sessionsList: ctx.sessions.list,
				modelDirectories: ctx.modelDirectories,
				openMember,
				t
			});
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "agent-teams-activity",
				order: 80,
				label: "AgentTeams activity",
				locale: AGENT_TEAMS_LOCALE_NAMESPACE
			}, Panel));
			ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
				name: "conversation.chat.commandview",
				key: "agent-teams"
			}, HiddenAgentTeamsCommand));
			ctx.conversationEvents.register(agentTeamsCardDefinition);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "agent-teams",
				locale: AGENT_TEAMS_LOCALE_NAMESPACE,
				inject: () => ({ openMember })
			}, AgentTeamsCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		//#region mpd-export-bridge (mpd-owned; re-applied by scripts/vendor-agent-teams.mjs)
		// Additive re-exports only: mpd-owned client code composes the adopted views,
		// the monitor store, the locale dictionaries and the panel CSS-module classes.
		// Adopted behaviour is untouched (apply/inject and every registration stay as-is).
		exports.TeamSection = TeamSection;
		exports.historicCardTeam = historicCardTeam;
		exports.memberArtUrl = memberArtUrl;
		exports.LEAD_ART = LEAD_ART;
		exports.ACTIVITY_PANEL_CSS = ActivityPanel_module_css_default;
		exports.AGENT_TEAMS_LOCALE_NAMESPACE = AGENT_TEAMS_LOCALE_NAMESPACE;
		exports.zh = zh;
		exports.en = en;
		exports.teamIsActive = teamIsActive;
		exports.startActivityPolling = startActivityPolling;
		exports.subscribeActivitySnapshots = subscribeActivitySnapshots;
		exports.getActivitySnapshotsSnapshot = getActivitySnapshotsSnapshot;
		exports.updateActivitySnapshots = updateActivitySnapshots;
		exports.ACTIVITY_POLL_MS = ACTIVITY_POLL_MS;
		exports.ACTIVITY_PROBE_MS = ACTIVITY_PROBE_MS;
		exports.ACTIVITY_STATE_URL = ACTIVITY_STATE_URL;
		exports.ACTIVITY_HALT_URL = ACTIVITY_HALT_URL;
		//#endregion mpd-export-bridge
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map

// ==== @mpd-dsh/team-page: AgentTeams rendered inside a DSH-better-sidebar tab ====
window.__ModuleLoader__.load({ id: "@mpd-dsh/team-page", factory: // mpd bundle web client — the bundle's OWN team surface: the TEAM WATCHDOG view.
//
// 0.1.7 REBASE (why this file is small now). Until 0.1.7 this page composed the RETIRED
// vendored `agent-teams` client's views (roster, task DAG, staged-plan cards, floater markup)
// into a DSH-better-sidebar tab, requiring `@nanmicoder/dsh-agent-teams` for its store,
// views, locales and CSS. Harness 0.1.7 ships an OFFICIAL Agent Teams client
// (`@deepseek-ai/dsh-experimental-client-ui-agent-team`, mounted by this bundle's
// `mpd-ui-agent-team` row) that owns the roster and task-board UI, so this page must NOT
// duplicate it. What remains OURS — and what no official client renders — is the team
// WATCHDOG: the hold per team, the newest WARN/ESCALATE banner and the unread incident
// replay, served by this bundle's own routes (`src/watchdog-web.ts`).
//
// The page therefore renders EXACTLY that: it polls `/plugins/mpd-team-watchdog/state`,
// shows the banner/hold/activity rows and acknowledges one incident through
// `/plugins/mpd-team-watchdog/ack`. It reads no team record, requires no adopted client and
// never registers an overlay, a chat node or a footer toggle (sidebar-only, as before).
//
// The module id, the factory shape and the exported names are UNCHANGED so the combined
// client (`scripts/build-mpd-client.mjs`) composes the same way; only the page's contents
// changed. The tab id is kept because the sidebar's `registerTab` throws on a duplicate and
// the host keys restored tabs on it.
//
// Plain JS, React.createElement only: there is no JSX transform in this bundle.
(require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  let react = require("react");

  const TEAM_TAB_ID = "mpd-agent-teams";
  const TEAM_TAB_ORDER = 85;
  const TEAM_LOCALE_NAMESPACE = "mpdAgentTeams";

  // The watchdog's own routes, served by this bundle's main plugin (`src/watchdog-web.ts`).
  const WATCHDOG_STATE_URL = "/plugins/mpd-team-watchdog/state";
  const WATCHDOG_ACK_URL = "/plugins/mpd-team-watchdog/ack";
  const WATCHDOG_WEB_READER = "web-panel";
  const WATCHDOG_POLL_MS = 15000;

  const zh = {
    "tab.title": "团队看门狗",
    "panel.subtitle": "只看门狗视图 —— 花名册与任务板由官方 Agent Teams 客户端提供。",
    "panel.loading": "加载中…",
    "panel.empty": "没有卡住的团队：没有 hold，也没有未读事件。",
    "panel.stuck": "有团队被暂停",
    "panel.hold": "hold",
    "panel.since": "自",
    "panel.activity": "未读事件",
    "panel.ack": "标记已读",
    "panel.reader": "读者",
    "panel.error": "看门狗状态不可读",
    "panel.replay": "（重放：这些事件尚未被确认）"
  };
  const en = {
    "tab.title": "Team watchdog",
    "panel.subtitle": "Watchdog view only — the roster and task board belong to the official Agent Teams client.",
    "panel.loading": "Loading…",
    "panel.empty": "No stuck team: no hold and no unread incident.",
    "panel.stuck": "A team is paused",
    "panel.hold": "hold",
    "panel.since": "since",
    "panel.activity": "Unread incidents",
    "panel.ack": "Acknowledge",
    "panel.reader": "reader",
    "panel.error": "the watchdog state is unreadable",
    "panel.replay": "(replay: these incidents have not been acknowledged yet)"
  };

  /** The locale the browser is in, resolved through the host's own locale service. */
  function activeLocale(ctx) {
    try {
      const locale = ctx !== undefined && ctx !== null ? (typeof ctx.get === "function" ? ctx.get("locale") : undefined) : undefined;
      const value = locale !== undefined && locale !== null && typeof locale.get === "function" ? locale.get() : undefined;
      if (typeof value === "string" && value !== "") return value;
    } catch {
      // fall through to the default
    }
    return "en";
  }

  /** A translator bound to this context's locale (a missing key falls back to the key). */
  function translatorFor(ctx) {
    const dict = activeLocale(ctx).toLowerCase().startsWith("zh") ? zh : en;
    return (key) => (dict[key] !== undefined ? dict[key] : key);
  }

  // ── the store the page renders (ONE payload, refreshed by ONE poller) ────────
  let store = { payload: null, error: undefined };
  const listeners = new Set();
  let pollTimer = null;
  let pollInFlight = false;
  let watchdogInFlight = false;

  function publish(patch) {
    store = Object.assign({}, store, patch);
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // one bad subscriber must not stop the others
      }
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return store;
  }

  async function fetchJson(url, init) {
    const response = await fetch(url, init);
    if (response === undefined || response === null || response.ok !== true) {
      throw new Error("HTTP " + String(response === undefined || response === null ? "?" : response.status));
    }
    return await response.json();
  }

  /** One poll of the watchdog state route. Never throws into a render. */
  async function refreshWatchdog() {
    if (watchdogInFlight) return store.payload;
    watchdogInFlight = true;
    try {
      const payload = await fetchJson(WATCHDOG_STATE_URL);
      if (payload !== null && typeof payload === "object" && payload.ok === true) {
        publish({ payload, error: undefined });
        return payload;
      }
      publish({ payload: null, error: new Error("the watchdog route answered a non-ok payload") });
    } catch (error) {
      publish({ payload: null, error });
    } finally {
      watchdogInFlight = false;
    }
    return store.payload;
  }

  /** Acknowledge the replay up to ONE incident timestamp through the ack route. */
  async function acknowledgeIncident(incidentTs) {
    try {
      const response = await fetch(WATCHDOG_ACK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reader: WATCHDOG_WEB_READER, upTo: incidentTs })
      });
      if (response === undefined || response === null || response.ok !== true) {
        throw new Error("HTTP " + String(response === undefined || response === null ? "?" : response.status));
      }
      await refreshWatchdog();
      return true;
    } catch (error) {
      publish({ error });
      return false;
    }
  }

  function startPolling() {
    if (pollTimer !== null) return;
    void refreshWatchdog();
    try {
      pollTimer = setInterval(() => {
        if (pollInFlight) return;
        pollInFlight = true;
        void refreshWatchdog().finally(() => {
          pollInFlight = false;
        });
      }, WATCHDOG_POLL_MS);
    } catch {
      pollTimer = null;
    }
  }

  function stopPolling() {
    if (pollTimer === null) return;
    try {
      clearInterval(pollTimer);
    } catch {
      // already cleared
    }
    pollTimer = null;
  }

  // ── rendering ────────────────────────────────────────────────────────────────
  const PANEL_STYLE = { display: "flex", flexDirection: "column", gap: "6px", padding: "8px", fontFamily: "inherit" };
  const BANNER_STYLE = { padding: "6px 8px", borderRadius: "4px", border: "1px solid currentColor" };
  const MUTED_STYLE = { opacity: 0.7, fontSize: "0.9em" };
  const ROW_STYLE = { display: "flex", flexDirection: "column", gap: "2px", padding: "4px 0" };

  function formatTime(at) {
    try {
      return new Date(at).toISOString();
    } catch {
      return String(at);
    }
  }

  /**
   * The store subscription, in the form every React of this vintage supports.
   *
   * A host WITHOUT `useSyncExternalStore` still renders: the component then reads the store
   * on each render and re-renders through the subscription.
   */
  function useStoreSnapshot() {
    const React = react;
    if (typeof React.useSyncExternalStore === "function") {
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }
    if (typeof React.useState === "function") {
      const state = React.useState(store);
      const setState = state[1];
      React.useEffect(() => subscribe(() => setState(getSnapshot())), []);
      return state[0];
    }
    return store;
  }

  /** The panel body. Pure over `state`; every failure has an on-screen answer. */
  function TeamPageView(props) {
    const t = props !== undefined && typeof props.t === "function" ? props.t : (key) => key;
    const state = useStoreSnapshot();
    const payload = state.payload;
    const rows = [];
    rows.push(react.createElement("div", { key: "subtitle", style: MUTED_STYLE }, t("panel.subtitle")));
    if (state.error !== undefined && payload === null) {
      rows.push(react.createElement("div", { key: "error", "data-watchdog-error": true },
        t("panel.error") + ": " + String((state.error !== null && state.error !== undefined && state.error.message !== undefined) ? state.error.message : state.error)));
    } else if (payload === null) {
      rows.push(react.createElement("div", { key: "loading", style: MUTED_STYLE }, t("panel.loading")));
    } else {
      const banner = payload.banner !== null && payload.banner !== undefined ? payload.banner : null;
      rows.push(react.createElement("div", {
        key: "banner",
        style: BANNER_STYLE,
        "data-watchdog-banner": banner === null ? "none" : String(banner.kind)
      }, banner === null
        ? t("panel.empty")
        : t("panel.stuck") + " · " + String(banner.teamId) + " · " + String(banner.cause) + " · " + t("panel.since") + " " + formatTime(banner.since)));
      const holds = Array.isArray(payload.held) ? payload.held : [];
      if (holds.length > 0) {
        rows.push(react.createElement("div", { key: "holds-title", style: MUTED_STYLE }, t("panel.hold")));
        for (const hold of holds) {
          rows.push(react.createElement("div", { key: "hold-" + String(hold.teamId), "data-watchdog-hold": String(hold.teamId) },
            String(hold.teamId) + " · " + String(hold.cause) + " · " + t("panel.since") + " " + formatTime(hold.since)));
        }
      }
      const activity = Array.isArray(payload.activity) ? payload.activity : [];
      if (activity.length > 0) {
        rows.push(react.createElement("div", { key: "activity-title", style: MUTED_STYLE }, t("panel.activity") + " (" + activity.length + ")"));
        if (payload.replay === true) rows.push(react.createElement("div", { key: "replay", style: MUTED_STYLE }, t("panel.replay")));
        for (const record of activity) {
          rows.push(react.createElement("div", { key: "activity-" + String(record.id), style: ROW_STYLE, "data-watchdog-activity": String(record.id) },
            react.createElement("span", null, String(record.label !== undefined ? record.label : record.kind) + " · " + String(record.teamId) + " · " + formatTime(record.at)),
            react.createElement("span", { style: MUTED_STYLE }, String(record.cause) + (record.ms === null || record.ms === undefined ? "" : " " + String(record.ms) + "ms")),
            react.createElement("button", {
              key: "ack",
              type: "button",
              "data-watchdog-ack": String(record.id),
              onClick: () => { void acknowledgeIncident(record.at); }
            }, t("panel.ack"))));
        }
      }
      rows.push(react.createElement("div", { key: "reader", style: MUTED_STYLE }, t("panel.reader") + ": " + String(payload.reader)));
    }
    return react.createElement("div", { style: PANEL_STYLE, "data-mpd-team-watchdog-page": true }, rows);
  }

  /**
   * Register the watchdog sidebar tab once DSH-better-sidebar is available.
   * @param ctx - the better-sidebar-scoped context.
   * @param service - the `betterSidebar` service.
   * @returns true when the tab is registered (or already present).
   */
  function registerTeamSidebarTab(ctx, service) {
    if (service === undefined || service === null || typeof service.registerTab !== "function") {
      console.warn("[mpd] better-sidebar exposes no registerTab — the team watchdog page has no host");
      return false;
    }
    // IDEMPOTENT by descriptor presence: `ctx.inject` re-fires on a provider remount and the
    // sidebar's `registerTab` THROWS on a duplicate id.
    try {
      if (typeof service.getTab === "function" && service.getTab(TEAM_TAB_ID) !== undefined) return true;
    } catch {
      // a throwing getTab means "cannot tell": fall through and register as before
    }
    try {
      const t = translatorFor(ctx);
      ctx.effect(() => ctx.locale.register(TEAM_LOCALE_NAMESPACE, { zh, en }), "mpd-agent-teams: dictionaries");
      ctx.effect(() => service.registerTab({
        id: TEAM_TAB_ID,
        title: () => t("tab.title"),
        icon: (size) => react.createElement("span", { "aria-hidden": true, style: { fontSize: size, lineHeight: 1 } }, "\u{1F6A8}"),
        order: TEAM_TAB_ORDER,
        single: true,
        createTab: () => ({ tab: { id: TEAM_TAB_ID, type: TEAM_TAB_ID, title: t("tab.title") } }),
        // The badge is the UNREAD count of the last poll: no fetch, never a throw.
        badge: () => {
          try {
            const payload = store.payload;
            if (payload === null || payload === undefined) return undefined;
            const unread = Array.isArray(payload.unread) ? payload.unread.length : 0;
            return unread > 0 ? unread : undefined;
          } catch {
            return undefined;
          }
        },
        component: (props) => react.createElement(TeamPageView, Object.assign({ t }, props))
      }), "mpd-agent-teams: sidebar tab");
      ctx.effect(() => {
        startPolling();
        return () => { stopPolling(); };
      }, "mpd-agent-teams: watchdog polling");
      return true;
    } catch (error) {
      console.warn("[mpd] team watchdog sidebar tab registration failed: " + String(error));
      return false;
    }
  }

  exports.registerTeamSidebarTab = registerTeamSidebarTab;
  exports.TeamPageView = TeamPageView;
  exports.SIDEBAR_TAB_ID = TEAM_TAB_ID;
  exports.SIDEBAR_TAB_ORDER = TEAM_TAB_ORDER;
  // Test seams: the offline driver polls and acknowledges through these instead of reaching
  // into module internals.
  exports.__watchdogState = () => store;
  exports.__watchdogPoll = () => refreshWatchdog();
  exports.__watchdogAck = (incidentTs) => acknowledgeIncident(incidentTs);
  exports.__resetTeamPageForTests = () => {
    stopPolling();
    pollInFlight = false;
    watchdogInFlight = false;
    store = { payload: null, error: undefined };
    listeners.clear();
  };
  exports.WATCHDOG_STATE_URL = WATCHDOG_STATE_URL;
  exports.WATCHDOG_ACK_URL = WATCHDOG_ACK_URL;
  exports.WATCHDOG_WEB_READER = WATCHDOG_WEB_READER;
  return module.exports;
} });

// ==== @mpd-dsh/settings-card: the mpd settings card (t35, additive + isolated) ====
window.__ModuleLoader__.load({ id: "@mpd-dsh/settings-card", factory: // mpd settings section — the browser half of the `mpd` settings namespace (t35; moved to its own
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
  const disclosureOf = (field) => `mpd.jsonc ${field.path.join(".")} — ${BRIDGE_DISCLOSURE} ${NOT_LOST}`
  const hintOf = (field, lang = "en") => {
    const sentence = lang === "zh" ? field.semanticsZh : field.semantics
    const disclosure = disclosureOf(field)
    return sentence === undefined || sentence.length === 0 ? disclosure : `${sentence} ${disclosure}`
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
        // HUMAN SENTENCE FIRST, at full readability; the mandatory key+disclosure line sits BENEATH
        // it, dimmer. A knob with no human sentence renders the single dim disclosure line it always
        // had, so the thirteen scalar rows are byte-unchanged.
        const disclosureAt = hint.indexOf("mpd.jsonc " + key)
        const human = disclosureAt > 0 ? hint.slice(0, disclosureAt).trim() : ""
        const disclosure = disclosureAt < 0 ? hint : hint.slice(disclosureAt)
        const hintNode = human.length === 0
          ? createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.7, marginBottom: 2 } }, disclosure)
          : createElement(
              "span",
              { style: { display: "block", marginBottom: 2 } },
              createElement("span", { style: { display: "block", fontSize: 12, opacity: 0.95 }, "data-mpd-row-human": key }, human),
              createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.6 }, "data-mpd-row-disclosure": key }, disclosure),
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
} });

// ==== @mpd-dsh/mpd bundled client: team page + workmate library ====
window.__ModuleLoader__.load({ id: "@mpd-dsh/mpd", factory: // mpd bundle web client (factory body, inlined into the combined client.js by
// scripts/build-mpd-client.mjs). Loaded as the client half of the @mpd-dsh/mpd bundle
// entry. It contributes the AgentTeams GUI as ONE DSH-better-sidebar tab (the page lives
// in src/team-page.js, module id @mpd-dsh/team-page, composing the adopted views through
// the export bridge) plus the null slash-command admission row, and the WORKMATE LIBRARY
// as its own sidebar tab. Both features are sidebar-only: this file registers NO
// overlay, NO chat node and no footer toggle. The adopted agent-teams client is required
// for its views/store/locales/CSS, but its apply() is never called: that is what used to
// register the removed in-conversation card and the removed overlay activity floater.
// Plain JS, React.createElement only.
(require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  let react = require("react");
  // 0.1.7 REBASE: `require("@nanmicoder/dsh-agent-teams")` used to sit here. The retired
  // vendored client is NO LONGER required by any mpd client source: the official
  // `@deepseek-ai/dsh-experimental-client-ui-agent-team` client owns the roster/task-board UI,
  // and this bundle's own team surface is the WATCHDOG view (src/team-page.js), which reads
  // only this bundle's own routes through `fetch`. Nothing in this factory touches the
  // harness's client modules.

  // ── Version-tolerant client seams ──────────────────────────────────────────
  // The web boot hard-fails the WHOLE page when one entry stays `pending`:
  // `assertEntriesActive` reports `entry: pending (waiting for service: X)` and
  // throws "Failed to load plugins". A service this profile does not mount must
  // therefore never sit in `inject` — it would take the GUI down even though the
  // surface it feeds is optional.
  //
  // The other half of the rule is easy to get wrong and cost us the entire sidebar GUI:
  // cordis resolves services through the fiber's own scope, so a plugin-provided service
  // is INVISIBLE to a plain `ctx.get` probe — and because `notify()` only re-evaluates
  // fibers that DECLARE a dependency, a one-shot probe can never recover either. Services
  // owned by another plugin are reached with `ctx.inject` (mountSidebarPages), which waits
  // for the provider without parking this entry.
  //
  // Observed drift (dsh 0.1.2-rc.1): the frontend exposes `slots`, `locale`,
  // `sessions`, `layout`, `theme`, `timer`, `uiWorkspace`, `workspaces`,
  // `modelDirectories`; it does NOT expose `conversationEvents` (the adopted panel's
  // rc.9 seam, where the harness now speaks `conversationViews`). That missing seam is
  // why the adopted client half is no longer applied at all — its only use of
  // `conversationEvents` was the removed in-conversation card, and the sidebar team
  // page covers the same ground without it.
  const REQUIRED_SERVICES = ["slots", "locale"];

  /**
  * Declared hard dependencies only. The web boot's `assertEntriesActive` turns any
  * declared-but-unregistered service into a fatal `pending` entry, so a seam this profile
  * may not mount must NOT be declared here.
  *
  * That restriction does NOT extend to services provided by another PLUGIN, which must be
  * reached through `ctx.inject` (see mountSidebarPages) — a one-shot `ctx.get` probe cannot
  * see them.
  */
  const inject = REQUIRED_SERVICES.slice();

  /**
  * Mount the AgentTeams GUI's non-sidebar surface: the null `conversation.chat.commandview`
  * row that hides the `/agent-teams` command result (the slash command's own result row would
  * duplicate the replayed user message; the adopted client hid it the same way). The team
  * PANEL is not mounted here — see mountSidebarPages.
  */
  function mountAgentTeams(ctx) {
    // Contained like every other optional surface: a broken registration must degrade to one
    // warning, never throw out of the client entry (that would fail the whole web page).
    try {
      ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
        name: "conversation.chat.commandview",
        key: "agent-teams",
      }, () => null));
    } catch (error) {
      console.warn("[mpd] AgentTeams command view failed to mount: " + String(error));
    }
  }

  /**
  * Register both sidebar pages once DSH-better-sidebar is actually available.
  *
  * `betterSidebar` is provided by the better-sidebar plugin, whose fiber activates
  * independently of ours. A one-shot probe at apply() time therefore RACES it and loses:
  * measured on the live GUI, `ctx.get('betterSidebar')` answered `false` during apply and
  * `true` eight seconds later, so both pages silently registered nothing and the sidebar's
  * "+" menu offered no AgentTeams/Workmates row at all.
  *
  * `ctx.inject` is the runtime's own answer (better-sidebar uses exactly this for its
  * asynchronously-mounted `remote.session`): the callback runs when the service appears and
  * again after a provider remount, and it does NOT park this boot entry — a profile without
  * the sidebar simply never fires it, instead of becoming a fatal `pending` row.
  */
  function mountSidebarPages(ctx, teamPage) {
    let fiber;
    try {
      fiber = ctx.inject(["betterSidebar"], (sidebarCtx) => {
        const service = readService(sidebarCtx, "betterSidebar");
        if (service === undefined || typeof service.registerTab !== "function") {
          console.warn("[mpd] better-sidebar exposes no registerTab — no mpd page is registered");
          return;
        }
        try {
          teamPage.registerTeamSidebarTab(sidebarCtx, service);
        } catch (error) {
          console.warn("[mpd] AgentTeams sidebar file failed to mount: " + String(error));
        }
        try {
          registerWorkmateSidebarTab(sidebarCtx, service);
        } catch (error) {
          console.warn("[mpd] workmate sidebar tab registration failed: " + String(error));
        }
      });
    } catch (error) {
      console.warn("[mpd] sidebar pages could not be wired: " + String(error));
      return;
    }
    if (fiber !== undefined && typeof fiber.dispose === "function") {
      ctx.effect(() => () => { fiber.dispose(); }, "mpd: sidebar page injection");
    }
  }

  /** Read one service from a context that has it in scope (never throws). */
  function readService(ctx, name) {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  }

  /**
   * Whether a sidebar service already holds a descriptor for `id`.
   *
   * A service WITHOUT `getTab` answers `false` (register as before), so this guard can only
   * ever remove a duplicate registration — never suppress the first one.
   */
  function sidebarAlreadyHasTab(service, id) {
    try {
      return typeof service.getTab === "function" && service.getTab(id) !== undefined;
    } catch {
      return false;
    }
  }

  const LIST_URL = "/plugins/mpd-workmate/list";
  const INIT_URL = "/plugins/mpd-workmate/init";
  const ROSTER_URL = "/plugins/mpd-workmate/roster";
  const GET_URL = "/plugins/mpd-workmate/get";
  // Contract §D: mutations are POST-only and answer with a machine-readable `reason`,
  // which is what the page branches on (see failureReason).
  const RENAME_URL = "/plugins/mpd-workmate/rename";
  const DELETE_URL = "/plugins/mpd-workmate/delete";
  const WORKMATE_LOCALE_NAMESPACE = "mpdWorkmate";
  // The DSH-better-sidebar tab type this bundle registers. It is the ONLY GUI
  // surface for the workmate library: the sidebar owns layout/opening, we only
  // contribute the page.
  const SIDEBAR_TAB_ID = "mpd-workmate";
  // Tab-strip label. The sidebar renders outside our React tree, so the title is a
  // plain string resolved at registration time; the sidebar's own i18n already names
  // every tab in the same place.
  const SIDEBAR_TAB_TITLE = "Workmates";

  // Dictionary namespace for the workmate page. zh is the key-set source of truth;
  // en is checked complete against it.
  const zh = {
    "tab.title": "Workmates",
    "panel.title": "Workmate 库（~/.mpd/workmate）",
    "panel.refresh": "刷新",
    "panel.loading": "加载中…",
    "panel.empty": "暂无 workmate — 请在下方初始化一个。",
    "panel.baseLabel": "Base（专家模板）",
    "panel.basePlaceholder": "base（例如 Deep Worker）",
    "panel.nameLabel": "名称（可选）",
    "panel.namePlaceholder": "名称（可选）",
    "panel.noteLabel": "备注（可选）",
    "panel.notePlaceholder": "备注（可选）",
    "panel.init": "初始化",
    "panel.initBusy": "…",
    "panel.readonly": "只读",
    "panel.uses": "uses={count}",
    "panel.filter": "筛选（名称 / 备注）",
    "panel.detail": "详情",
    "panel.back": "返回列表",
    "panel.persona": "Persona",
    "panel.memory": "Memory",
    "panel.note": "Note",
    "panel.lastTask": "最近任务",
    "panel.created": "创建",
    "panel.updated": "更新",
    "panel.model": "模型",
    "panel.rosterUnavailable": "roster 不可用，请手填 base 名称",
    "mutate.renameTitle": "重命名",
    "mutate.renameLabel": "新名称（仅限 [a-z0-9_-]）",
    "mutate.renamePlaceholder": "新名称",
    "mutate.rename": "重命名",
    "mutate.renameBusy": "重命名中…",
    "mutate.renameHint": "目录名即标识，重命名会同步更新 meta、note 与索引。",
    "mutate.deleteTitle": "删除",
    "mutate.delete": "删除",
    "mutate.archiveHint": "默认先归档：实例移入 ~/.mpd/workmate/.archive/，之后仍可恢复。",
    "mutate.archive": "归档",
    "mutate.archiveBusy": "归档中…",
    "mutate.purgeHint": "彻底删除会永久移除该实例，无法恢复。",
    "mutate.purge": "彻底删除",
    "mutate.purgeConfirmLabel": "输入名称以确认彻底删除",
    "mutate.purgeConfirm": "确认彻底删除",
    "mutate.purgeBusy": "彻底删除中…",
    "mutate.cancel": "取消",
    "mutate.renamed": "已重命名 {from} → {to}",
    "mutate.archived": "已归档 {name}",
    "mutate.purged": "已彻底删除 {name}",
    "mutate.reason.invalidName": "名称无效：只能使用小写字母、数字、下划线和连字符（[a-z0-9_-]）",
    "mutate.reason.sameKey": "新名称与当前名称相同",
    "mutate.reason.confirmRequired": "彻底删除需要输入完整名称以确认",
    "mutate.reason.unknown": "找不到该 workmate：它可能已被删除或归档，请刷新列表。",
    "mutate.reason.collision": "该名称已被占用，请换一个名称。",
    "mutate.reason.inUse": "该 workmate 正在被使用，已拒绝操作；请先结束或归档这些团队：{blocking}",
    "mutate.reason.failed": "操作失败"
  };
  const en = {
    "tab.title": "Workmates",
    "panel.title": "Workmate library (~/.mpd/workmate)",
    "panel.refresh": "Refresh",
    "panel.loading": "Loading…",
    "panel.empty": "No workmates yet — initialize one below.",
    "panel.baseLabel": "Base (roster template)",
    "panel.basePlaceholder": "base (e.g. Deep Worker)",
    "panel.nameLabel": "Name (optional)",
    "panel.namePlaceholder": "name (optional)",
    "panel.noteLabel": "Note (optional)",
    "panel.notePlaceholder": "note (optional)",
    "panel.init": "Init",
    "panel.initBusy": "…",
    "panel.readonly": "readonly",
    "panel.uses": "uses={count}",
    "panel.filter": "Filter (name / note)",
    "panel.detail": "Detail",
    "panel.back": "Back to list",
    "panel.persona": "Persona",
    "panel.memory": "Memory",
    "panel.note": "Note",
    "panel.lastTask": "Last task",
    "panel.created": "Created",
    "panel.updated": "Updated",
    "panel.model": "Model",
    "panel.rosterUnavailable": "roster unavailable — type the base name",
    "mutate.renameTitle": "Rename",
    "mutate.renameLabel": "New name ([a-z0-9_-] only)",
    "mutate.renamePlaceholder": "new name",
    "mutate.rename": "Rename",
    "mutate.renameBusy": "Renaming…",
    "mutate.renameHint": "The directory name is the key: a rename also updates meta, note and index.",
    "mutate.deleteTitle": "Delete",
    "mutate.delete": "Delete",
    "mutate.archiveHint": "Archive-first by default: the instance moves to ~/.mpd/workmate/.archive/ and stays restorable.",
    "mutate.archive": "Archive",
    "mutate.archiveBusy": "Archiving…",
    "mutate.purgeHint": "Purge removes the instance permanently and cannot be undone.",
    "mutate.purge": "Purge",
    "mutate.purgeConfirmLabel": "Type the name to confirm the purge",
    "mutate.purgeConfirm": "Confirm purge",
    "mutate.purgeBusy": "Purging…",
    "mutate.cancel": "Cancel",
    "mutate.renamed": "Renamed {from} → {to}",
    "mutate.archived": "Archived {name}",
    "mutate.purged": "Purged {name}",
    "mutate.reason.invalidName": "Invalid name: use lower-case letters, digits, underscores or hyphens ([a-z0-9_-])",
    "mutate.reason.sameKey": "The new name equals the current name",
    "mutate.reason.confirmRequired": "A purge must be confirmed with the exact name",
    "mutate.reason.unknown": "No such workmate: it may already be deleted or archived — refresh the list.",
    "mutate.reason.collision": "That name is already taken — pick another one.",
    "mutate.reason.inUse": "Refused: the workmate is in use. Finish or archive these teams first: {blocking}",
    "mutate.reason.failed": "The operation failed"
  };

  function interpolate(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (_m, key) =>
      params && params[key] !== undefined ? String(params[key]) : "{" + key + "}");
  }
  function translateFor(props) {
    if (props && typeof props.t === "function") return props.t;
    return (key, params) => interpolate(en[key] ?? key, params);
  }

  function request(url, options) {
    return fetch(url, options).then(async (res) => {
      if (!res.ok) {
        let body = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        // The wire protocol (contract §D) carries a machine-readable `reason` — and, for an
        // in-use refusal, the blocking team/member list. Collapsing the body into a bare
        // message here is what made the page unable to branch or to name the blocker, so the
        // whole body plus the status ride on the error.
        throw requestError(res.status, body);
      }
      return res.json();
    });
  }

  /** One failed response as an error carrying status + reason + the rest of the body. */
  function requestError(status, body) {
    const payload = body !== null && typeof body === "object" ? body : {};
    const described = typeof payload.error === "string" && payload.error.trim() !== "";
    const error = new Error(described ? payload.error : "HTTP " + String(status));
    error.status = status;
    error.body = payload;
    if (typeof payload.reason === "string") error.reason = payload.reason;
    if (Array.isArray(payload.blocking)) error.blocking = payload.blocking;
    return error;
  }

  /** The §D reason code of a failure (undefined for anything else). */
  function failureReason(error) {
    if (error === null || error === undefined) return undefined;
    if (typeof error.reason === "string" && error.reason !== "") return error.reason;
    const body = error.body;
    if (body !== null && typeof body === "object" && typeof body.reason === "string" && body.reason !== "") return body.reason;
    return undefined;
  }

  /** The §E blocking team/member list of an in-use refusal, as plain `team/member` pairs. */
  function blockingEntries(error) {
    const raw = error !== null && error !== undefined && Array.isArray(error.blocking)
      ? error.blocking
      : (error?.body !== null && typeof error?.body === "object" && Array.isArray(error.body.blocking) ? error.body.blocking : []);
    return raw
      .map((entry) => {
        const teamId = entry !== null && typeof entry === "object" && entry.teamId !== undefined ? String(entry.teamId) : "";
        const member = entry !== null && typeof entry === "object" && entry.member !== undefined ? String(entry.member) : "";
        if (teamId !== "" && member !== "") return teamId + "/" + member;
        return teamId !== "" ? teamId : member;
      })
      .filter((pair) => pair !== "");
  }

  /**
   * Turn one failed mutation into a readable, REASON-SPECIFIC message. The five wire
   * failures are 400 invalid-name (which includes the same-key rename), 400
   * confirm-required, 404 unknown, 409 collision and 409 in-use — the last one names the
   * blocking teams, because a refusal nobody can act on is not a refusal (§E).
   */
  function describeFailure(error, t) {
    const reason = failureReason(error);
    // `""` is not text: the page must fall back to its own dictionary instead of rendering
    // an empty alert.
    const server = typeof error?.message === "string" && error.message !== "" ? error.message : "";
    const blocking = blockingEntries(error);
    switch (reason) {
      case "invalid-name":
        // The server also uses this reason for a same-key rename; its own text says which.
        return server !== "" && server !== "HTTP " + String(error?.status) ? server : t("mutate.reason.invalidName");
      case "confirm-required":
        return t("mutate.reason.confirmRequired");
      case "unknown":
        return t("mutate.reason.unknown");
      case "collision":
        return t("mutate.reason.collision");
      case "in-use":
        return blocking.length > 0
          ? t("mutate.reason.inUse", { blocking: blocking.join(", ") })
          : t("mutate.reason.inUse", { blocking: t("mutate.reason.failed") });
      default:
        return server !== "" ? server : t("mutate.reason.failed");
    }
  }

  // ── Workmate library ───────────────────────────────────────────────────────
  // The library is contributed as a DSH-better-sidebar tab — the ONLY host, exactly
  // like the AgentTeams page: the sidebar owns layout, opening and enable/disable, and
  // this bundle contributes nothing else (no overlay floater, no footer toggle). A
  // profile without DSH-better-sidebar simply has no workmate GUI.
  const SURFACE_STYLE = {
    display: "flex", flexDirection: "column", gap: 8, minHeight: 0, height: "100%",
    padding: 10, fontSize: 13, color: "inherit", fontFamily: "system-ui, sans-serif", boxSizing: "border-box",
  };
  const MUTED = { color: "rgba(128,128,128,0.95)" };
  const BUTTON_STYLE = { cursor: "pointer", border: "1px solid rgba(128,128,128,0.35)", borderRadius: 6, background: "transparent", color: "inherit", padding: "3px 8px", fontSize: 12 };
  const INPUT_STYLE = { padding: "4px 6px", borderRadius: 6, border: "1px solid rgba(128,128,128,0.35)", background: "transparent", color: "inherit", fontSize: 12, width: "100%", boxSizing: "border-box" };

  /** The library page: list + detail + initialize form. Host-agnostic. */
  function WorkmateLibraryView(props) {
    const t = translateFor(props);
    const [workmates, setWorkmates] = react.useState(null);
    const [bases, setBases] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [filter, setFilter] = react.useState("");
    const [base, setBase] = react.useState("");
    const [name, setName] = react.useState("");
    const [note, setNote] = react.useState("");
    const [busy, setBusy] = react.useState(false);
    const [selected, setSelected] = react.useState(null);
    const [detail, setDetail] = react.useState(null);
    // Mutation surface: rename input, the explicit delete confirmation step (D1) and the
    // two message lanes. A mutation message outlives a refresh — only the next mutation
    // clears it — so it cannot share the load-error state.
    const [renameTo, setRenameTo] = react.useState("");
    const [confirming, setConfirming] = react.useState(null);
    const [purgeText, setPurgeText] = react.useState("");
    const [mutating, setMutating] = react.useState(false);
    const [mutationError, setMutationError] = react.useState(null);
    const [notice, setNotice] = react.useState(null);

    const refresh = react.useCallback(() => {
      request(LIST_URL)
        .then((data) => { setWorkmates(data.workmates ?? []); setError(null); })
        .catch((e) => { setError(String(e?.message ?? e)); setWorkmates([]); });
      request(ROSTER_URL)
        .then((data) => { setBases(data.bases ?? []); setBase((prev) => prev || String((data.bases ?? [])[0]?.name ?? "")); })
        .catch(() => setBases([]));
    }, []);
    react.useEffect(() => { refresh(); }, [refresh]);

    const openDetail = (workmateName) => {
      setSelected(workmateName);
      setDetail(null);
      // A fresh load clears the previous failure: the pane renders its error state whenever
      // `detail` is null, so a stale error must not outlive the retry that fixes it (t8 L4).
      setError(null);
      // The rename field starts AT the current key: the directory name IS the key, so the
      // useful thing to show is the name being changed, not an empty box.
      setRenameTo(workmateName);
      setConfirming(null);
      request(GET_URL + "?name=" + encodeURIComponent(workmateName))
        .then((data) => setDetail(data))
        .catch((e) => {
          setError(String(e?.message ?? e));
          // A key that no longer resolves must not stay selected (contract §H: no stale
          // selection) — the rename/delete response is authoritative and lands here when
          // the instance is gone.
          if (failureReason(e) === "unknown") closeDetail();
        });
    };
    const submit = (ev) => {
      ev.preventDefault();
      const chosen = base.trim();
      if (busy || chosen === "") return;
      setBusy(true);
      const body = JSON.stringify({ base: chosen, name: name.trim() || undefined, note: note.trim() || undefined });
      request(INIT_URL, { method: "POST", headers: { "content-type": "application/json" }, body })
        .then(() => { setBusy(false); setName(""); setNote(""); refresh(); })
        .catch((e) => { setBusy(false); setError(String(e?.message ?? e)); });
    };

    /** Leave the detail pane and reset the mutation surface (per-workmate state). */
    const closeDetail = () => {
      setSelected(null);
      setDetail(null);
      setRenameTo("");
      setConfirming(null);
      setPurgeText("");
      setMutationError(null);
    };

    /**
     * Run one library mutation. The detail pane must never keep pointing at a key that no
     * longer exists (contract §H): a rename follows the new key, a delete leaves detail.
     */
    const runMutation = (url, body, onSuccess) => {
      if (mutating) return;
      setMutating(true);
      setMutationError(null);
      setNotice(null);
      request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then((data) => {
          setMutating(false);
          setConfirming(null);
          setPurgeText("");
          setRenameTo("");
          onSuccess(data ?? {});
          refresh();
        })
        .catch((e) => {
          setMutating(false);
          setMutationError(describeFailure(e, t));
        });
    };

    const submitRename = (ev) => {
      ev.preventDefault();
      if (selected === null) return;
      const next = renameTo.trim();
      if (next === "") return;
      // The same-key rename is refused HERE, which is what makes `mutate.reason.sameKey`
      // reachable: the server answers 400 invalid-name for this case, so without a local
      // check its dictionary entry could never be shown (t8 L1). A name that merely
      // SANITIZES to the current key (e.g. `GUI-alice`) still goes to the server, whose own
      // text is authoritative there (§M2).
      if (next === selected) {
        setNotice(null);
        setMutationError(t("mutate.reason.sameKey"));
        return;
      }
      const from = selected;
      runMutation(RENAME_URL, { name: from, new_name: next }, (data) => {
        const to = typeof data.name === "string" && data.name !== "" ? data.name : next;
        setNotice(t("mutate.renamed", { from, to }));
        openDetail(to);
      });
    };

    const submitDelete = (purge) => {
      if (selected === null) return;
      const from = selected;
      runMutation(DELETE_URL, purge ? { name: from, purge: true, confirm: purgeText.trim() } : { name: from }, () => {
        setNotice(purge ? t("mutate.purged", { name: from }) : t("mutate.archived", { name: from }));
        closeDetail();
      });
    };

    const needle = filter.trim().toLowerCase();
    const rows = (workmates ?? []).filter((w) => needle === ""
      || String(w.name).toLowerCase().includes(needle)
      || String(w.note ?? "").toLowerCase().includes(needle)
      || String(w.baseName ?? "").toLowerCase().includes(needle));

    if (selected !== null) {
      const d = detail;
      const section = (title, body) => body === undefined || body === null || String(body).trim() === "" ? null
        : react.createElement("div", { style: { marginTop: 8 } },
            react.createElement("div", { style: { fontWeight: 600, marginBottom: 2 } }, title),
            react.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "inherit", ...MUTED } }, String(body)),
          );
      return react.createElement("div", { style: SURFACE_STYLE },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          react.createElement("button", { type: "button", onClick: closeDetail, style: BUTTON_STYLE }, "← " + t("panel.back")),
          react.createElement("span", { style: { fontWeight: 700 } }, selected),
        ),
        error ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)) : null,
        notice !== null ? react.createElement("div", { role: "status", style: { ...MUTED, fontSize: 12 } }, String(notice)) : null,
        // ── Library administration (contract §D/§F/§M1) ──────────────────────
        // Rename and delete target THIS instance. A readonly workmate is a valid target:
        // the readonly discipline governs its own spawn, not the library it lives in.
        react.createElement("form", { onSubmit: submitRename, style: { display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 8 } },
          react.createElement("div", { style: { fontWeight: 600, fontSize: 12 } }, t("mutate.renameTitle")),
          react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("mutate.renameHint")),
          react.createElement("input", {
            value: renameTo, onChange: (e) => setRenameTo(e.target.value),
            placeholder: t("mutate.renamePlaceholder"), "aria-label": t("mutate.renameLabel"), style: INPUT_STYLE,
          }),
          react.createElement("button", {
            type: "submit", disabled: mutating || renameTo.trim() === "",
            style: { ...BUTTON_STYLE, opacity: mutating || renameTo.trim() === "" ? 0.5 : 1 },
          }, mutating ? t("mutate.renameBusy") : t("mutate.rename")),
        ),
        react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 8 } },
          react.createElement("div", { style: { fontWeight: 600, fontSize: 12 } }, t("mutate.deleteTitle")),
          // D1: nothing is removed on the FIRST click — the confirmation step is explicit
          // and says which of the two outcomes the button performs.
          confirming === null
            ? react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
                react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming("archive"); setPurgeText(""); setMutationError(null); }, style: BUTTON_STYLE }, t("mutate.delete")),
              )
            : confirming === "archive"
              ? react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
                  react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("mutate.archiveHint")),
                  react.createElement("div", { style: { display: "flex", gap: 6 } },
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => submitDelete(false), style: BUTTON_STYLE },
                      mutating ? t("mutate.archiveBusy") : t("mutate.archive")),
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming(null); setPurgeText(""); }, style: BUTTON_STYLE }, t("mutate.cancel")),
                  ),
                )
              : react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
                  react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("mutate.purgeHint")),
                  react.createElement("input", {
                    value: purgeText, onChange: (e) => setPurgeText(e.target.value),
                    placeholder: t("mutate.purgeConfirmLabel"), "aria-label": t("mutate.purgeConfirmLabel"), style: INPUT_STYLE,
                  }),
                  react.createElement("div", { style: { display: "flex", gap: 6 } },
                    react.createElement("button", {
                      type: "button", disabled: mutating || purgeText.trim() !== selected,
                      "aria-disabled": mutating || purgeText.trim() !== selected,
                      onClick: () => submitDelete(true),
                      style: { ...BUTTON_STYLE, opacity: mutating || purgeText.trim() !== selected ? 0.5 : 1 },
                    }, mutating ? t("mutate.purgeBusy") : t("mutate.purgeConfirm")),
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming("archive"); setPurgeText(""); }, style: BUTTON_STYLE }, t("mutate.archive")),
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming(null); setPurgeText(""); }, style: BUTTON_STYLE }, t("mutate.cancel")),
                  ),
                ),
          react.createElement("button", {
            type: "button",
            onClick: () => { setConfirming("purge"); setPurgeText(""); setMutationError(null); },
            style: { ...BUTTON_STYLE, borderColor: "rgba(200,60,60,0.5)" },
          }, t("mutate.purge")),
        ),
        mutationError !== null ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(mutationError)) : null,
        // t8 L4: a detail load that FAILED must say so. Rendering the loading text whenever
        // `detail` is null left the pane spinning forever beside the error banner for every
        // failure reason other than `unknown` — that one alone closes the pane (no stale
        // selection, contract §H), so every other reason needed its own visible outcome.
        d === null
          ? (error === null
            ? react.createElement("div", { style: MUTED }, t("panel.loading"))
            : react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)))
          : react.createElement("div", { style: { overflowY: "auto" } },
          react.createElement("div", { style: MUTED },
            String(d.baseName ?? ""),
            d.readonly ? " · " + t("panel.readonly") : "",
            d.uses !== undefined ? " · " + t("panel.uses", { count: d.uses }) : "",
          ),
          react.createElement("div", { style: { ...MUTED, fontSize: 12, marginTop: 2 } },
            t("panel.model") + ": " + String(d.provider ?? "") + " / " + String(d.model ?? ""),
            d.updatedAt ? " · " + t("panel.updated") + " " + String(d.updatedAt).slice(0, 10) : "",
          ),
          d.lastTask ? section(t("panel.lastTask"), d.lastTask) : null,
          section(t("panel.note"), d.note),
          section(t("panel.persona"), d.persona),
          section(t("panel.memory"), d.memory),
        ),
      );
    }

    return react.createElement("div", { style: SURFACE_STYLE },
      react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
        react.createElement("span", { style: { fontWeight: 700, flex: 1 } }, t("panel.title")),
        react.createElement("button", { type: "button", onClick: refresh, style: BUTTON_STYLE, title: t("panel.refresh") }, t("panel.refresh")),
      ),
      error ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)) : null,
      notice !== null ? react.createElement("div", { role: "status", style: { ...MUTED, fontSize: 12 } }, String(notice)) : null,
      react.createElement("input", {
        value: filter, onChange: (e) => setFilter(e.target.value), placeholder: t("panel.filter"),
        "aria-label": t("panel.filter"), style: INPUT_STYLE,
      }),
      react.createElement("div", { style: { flex: 1, minHeight: 80, overflowY: "auto" } },
        error ? null
          : workmates === null ? react.createElement("div", { style: MUTED }, t("panel.loading"))
          : rows.length === 0 ? react.createElement("div", { style: MUTED }, t("panel.empty"))
          : rows.map((w) => react.createElement("div", {
              key: w.name,
              style: { padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.2)", cursor: "pointer" },
              onClick: () => openDetail(w.name),
              title: t("panel.detail"),
            },
              react.createElement("div", { style: { fontWeight: 600 } },
                w.name,
                react.createElement("span", { style: { ...MUTED, fontWeight: 400, marginLeft: 8 } },
                  String(w.baseName ?? ""), w.readonly ? " · " + t("panel.readonly") : "", " · " + t("panel.uses", { count: w.uses })),
              ),
              react.createElement("div", { style: { ...MUTED, fontSize: 12, whiteSpace: "pre-wrap" } }, String(w.note ?? "")),
            )),
      ),
      react.createElement("form", { onSubmit: submit, style: { display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 8 } },
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.baseLabel")),
          (bases ?? []).length > 0
            ? react.createElement("select", { value: base, onChange: (e) => setBase(e.target.value), style: INPUT_STYLE, "aria-label": t("panel.baseLabel") },
                (bases ?? []).map((b) => react.createElement("option", { key: b.name, value: b.name }, b.name + (b.readonly ? " · " + t("panel.readonly") : ""))))
            : react.createElement("input", { placeholder: t("panel.basePlaceholder"), value: base, onChange: (e) => setBase(e.target.value), style: INPUT_STYLE }),
        ),
        bases !== null && (bases ?? []).length === 0 ? react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("panel.rosterUnavailable")) : null,
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.nameLabel")),
          react.createElement("input", { placeholder: t("panel.namePlaceholder"), value: name, onChange: (e) => setName(e.target.value), style: INPUT_STYLE }),
        ),
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.noteLabel")),
          react.createElement("input", { placeholder: t("panel.notePlaceholder"), value: note, onChange: (e) => setNote(e.target.value), style: INPUT_STYLE }),
        ),
        react.createElement("button", { type: "submit", disabled: busy || base.trim() === "", style: { ...BUTTON_STYLE, opacity: busy || base.trim() === "" ? 0.5 : 1 } }, busy ? t("panel.initBusy") : t("panel.init")),
      ),
    );
  }

  /**
  * Register the library as a DSH-better-sidebar tab. The sidebar service is passed in
  * because it must be RESOLVED through `ctx.inject` (see mountSidebarPages) — a probe at
  * apply() time races the provider and always loses. The descriptor owns the tab type, its
  * + menu entry and its page component; there is no floating fallback by decision,
  * mirroring the AgentTeams page.
  */
  function registerWorkmateSidebarTab(ctx, sidebar) {
    if (typeof sidebar.registerTab !== "function") return false;
    // IDEMPOTENT by descriptor presence: `ctx.inject` re-fires when the provider remounts,
    // and the sidebar's own `registerTab` THROWS on a duplicate id. Re-checking through the
    // service's own registry both absorbs a re-fire and RESTORES the tab after a remount
    // that lost it, instead of reporting a failure the user sees as "the tab is gone".
    if (sidebarAlreadyHasTab(sidebar, SIDEBAR_TAB_ID)) return true;
    try {
      ctx.effect(() => sidebar.registerTab({
        id: SIDEBAR_TAB_ID,
        title: () => SIDEBAR_TAB_TITLE,
        icon: (size) => react.createElement("span", { "aria-hidden": true, style: { fontSize: size, lineHeight: 1 } }, "\u{1F916}"),
        order: 90,
        single: true,
        component: (props) => react.createElement(WorkmateLibraryView, { t: translateFor({ t: props && props.t }) }),
      }), "mpd-workmate: sidebar tab");
      return true;
    } catch (error) {
      console.warn("[mpd] workmate sidebar tab registration failed: " + String(error));
      return false;
    }
  }

  /**
  * Load the AgentTeams page module defensively: a missing or broken module must cost the
  * team page ONLY — never the workmate page beside it, and never the client entry.
  */
  function loadTeamPage() {
    try {
      const teamPage = require("@mpd-dsh/team-page");
      if (teamPage !== undefined && teamPage !== null && typeof teamPage.registerTeamSidebarTab === "function") {
        return teamPage;
      }
      console.warn("[mpd] AgentTeams sidebar file exposes no registerTeamSidebarTab — the team page is unavailable");
    } catch (error) {
      console.warn("[mpd] AgentTeams sidebar file failed to load: " + String(error));
    }
    return { registerTeamSidebarTab: () => false };
  }

  /**
  * Load the mpd settings card module defensively. It is an ADDITIVE feature: a missing or broken
  * card must cost the card ONLY — never the sidebar pages and never the client entry (a throwing
  * client entry fails the whole page as `entry: pending`).
  */
  function loadSettingsCard() {
    try {
      const card = require("@mpd-dsh/settings-card");
      if (card !== undefined && card !== null && typeof card.mountSettingsCard === "function") return card;
      console.warn("[mpd] settings card module exposes no mountSettingsCard — the mpd card is unavailable");
    } catch (error) {
      console.warn("[mpd] settings card module failed to load: " + String(error));
    }
    return { mountSettingsCard: () => false };
  }

  function apply(ctx) {
    // The slash-command admission row (not a GUI panel) goes in immediately: `slots` is a
    // declared dependency, so it is present.
    mountAgentTeams(ctx);
    // Register both page locale dictionaries (zh/en).
    ctx.effect(() => ctx.locale.register(WORKMATE_LOCALE_NAMESPACE, { zh, en }), "mpd-workmate: dictionaries");
    // The AgentTeams page and the workmate library are BOTH DSH-better-sidebar tabs, and
    // that sidebar arrives later than this entry — so both are registered from the
    // ctx.inject callback, never from a probe here (that race is what left the sidebar's
    // "+" menu with no mpd row at all). A profile without the sidebar fires nothing.
    mountSidebarPages(ctx, loadTeamPage());
    // The settings section: the Web HALF of the same `mpd` namespace the TUI /settings section
    // edits, mounted as its OWN top-level `MPD` section of the settings dialog (w14) — it no longer
    // rides the Plugins tab. Its mount is deferred (the settings scope is a plugin-provided
    // service, so it is awaited with ctx.inject, never declared here).
    try {
      loadSettingsCard().mountSettingsCard(ctx);
    } catch (error) {
      console.warn("[mpd] settings card mount failed: " + String(error));
    }
  }

  // zh is the key-set source of truth; en must stay key-complete against it. Exported so
  // the offline harness can assert that without a browser (contract §L A7).
  const dictionaries = { zh: Object.freeze({ ...zh }), en: Object.freeze({ ...en }) };

  // `inject`/`apply` are the client-module contract; the view plus the two pure helpers
  // (dictionaries and the §D failure mapper) are exported so the offline harness
  // (packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs) can pin them without a browser.
  module.exports = { inject, apply, WorkmateLibraryView, SIDEBAR_TAB_ID, describeFailure, failureReason, dictionaries, loadSettingsCard };
  return module.exports;
} });
