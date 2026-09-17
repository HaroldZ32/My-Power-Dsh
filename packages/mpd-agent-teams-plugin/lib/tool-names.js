/** Stable business API names; exposure changes never rename these operations. */
export const TEAM_TOOL_NAMES = [
    'agent_teams_create', 'agent_teams_approve', 'agent_teams_edit_plan',
    'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task',
    'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_update_task',
    'agent_teams_send_message', 'agent_teams_status', 'agent_teams_resume', 'agent_teams_delete',
    // The read-only contract surface is registered from a mpd-delta region in
    // tools.js, so it must be listed here explicitly: without it the captain prompt
    // and the deny computation under-count the frozen manual-entry set (14 names).
    'agent_teams_task_contract',
    // T-01/T-12 (wave 1, t20): this wave adds three operations, so the list grows here.
    // The frozen manual-entry set forbids RENAMING a name, never ADDING one
    // (`manualEntryNames.policy`), which is why no frozen artifact needs editing.
    // `move_path` and `rollover` also enforce captain-only authority at their own execute
    // boundary (`requireCaptainTeam`), so the derived deny list below is defence in depth
    // rather than the only gate.
    'agent_teams_path_owner', 'agent_teams_move_path', 'agent_teams_rollover',
    // t48 (P1d): the READ-ONLY pre-send check. It joins the captain surface here and the member
    // surface below, because every seat that can send must be able to check before sending.
    'agent_teams_mailbox_check',
];
export const MEMBER_TOOL_NAMES = [
    'agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_send_message', 'agent_teams_status',
    // T-49 (wave 1): the READ-ONLY contract surface is for every seat. A verification or
    // review seat must be able to read the contract it judges, and this name was omitted
    // here while being listed in TEAM_TOOL_NAMES above, so it landed in CAPTAIN_TOOL_NAMES
    // and BOTH deny computations — the spawn `toolFilter` in members.js and the runtime
    // `tools.restrict` in capabilities.js derive from this pair of lists — denied it to
    // every member. Measured 2026-09-17 across all 9 member sessions: two seats called it
    // and got `unknown tool "agent_teams_task_contract"`. Listing it here makes the tool
    // description's "available to the captain and to any member" true; it is read-only, so
    // exposing it costs no safety.
    'agent_teams_task_contract',
    // T-01 (wave 1, t20): the who-owns preflight is READ-ONLY and exists for the seat that
    // has to respect another task's inScope, so it joins the member surface by the same
    // reasoning as the contract tool above. `move_path` and `rollover` stay captain-only.
    'agent_teams_path_owner',
    // t48 (P1d): read-only, so exposing it to members costs no safety — and a member is exactly the
    // seat that needs a pre-send check (the load-bearing reason the contract tool is listed here too).
    'agent_teams_mailbox_check',
];
export const CAPTAIN_TOOL_NAMES = TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name));
