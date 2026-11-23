import { textBlock, type DshAdapter, type DshToolDef, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { authorizeCopy } from "./copy-authority.ts"
import { disposeCopy, mergeCopy, submitCopy } from "./copy-integration.ts"
import { allocateCopy, changeCopy, decideCopy, listCopies, requestCopy, type CopyRequest } from "./copy-lifecycle.ts"
import { copyDirectory, copyPath, objectOf, type CopyRecord } from "./copy-store.ts"
import { WorktreeError } from "./ops.ts"

/** Public tool name used in the runtime registration and the mount log. */
export const COPY_TOOL_NAME = "mpd_worktree_copy"

/** The one copy tool surface keeps the current worktree tools and service intact. */
const ACTIONS = ["request", "list", "approve", "decline", "create", "submit", "integrate", "dispose"] as const

/** Required text, bounded before it can become ledger metadata or a Git argument. */
function text(args: Record<string, unknown>, key: string): string {
  /** The schema protects normal calls, with this boundary also covering older tool dispatchers. */
  const value = args[key]
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.includes("\0")) {
    throw new WorktreeError("copy-arguments", `provide a valid ${key}`)
  }
  return value.trim()
}

/** Parse a request and constrain literal paths and glob scopes to the project tree. */
function parseRequest(args: Record<string, unknown>): CopyRequest {
  /** Scopes retain the board's exact spelling to avoid expanding authority by normalization. */
  const scope = args.scope
  /** The total covers Git data, checkout, scratch packs and known setup/build work. */
  const estimatedBytes = args.estimatedBytes
  if (typeof estimatedBytes !== "number" || !Number.isSafeInteger(estimatedBytes) || estimatedBytes <= 0 ||
      !Array.isArray(scope) || !scope.length || scope.length > 64 || !scope.every((path): path is string =>
        typeof path === "string" && path.length > 0 && path.length <= 1024 && !/^[\/\\]|[\0\\]/.test(path) &&
        !path.split("/").includes("..") && !path.startsWith(".mpd/"))) {
    throw new WorktreeError("copy-arguments", "provide a positive estimatedBytes value and project-relative scope entries")
  }
  return { taskId: text(args, "taskId"), source: text(args, "source"), base: text(args, "base"), destination: text(args, "destination"),
    reason: text(args, "reason"), setup: text(args, "setup"), scope, estimatedBytes }
}

/** Present the approved canonical path so the member can use it as an explicit workdir. */
function viewCopy(record: CopyRecord): CopyRecord & { path: string } {
  return { ...record, path: copyPath(copyDirectory(record.source), record.destination) }
}

/** Build the project copy tool; native capabilities are probed at execution time. */
export function copyTool(ctx: unknown, dsh: Pick<DshAdapter, "workspaceRoot">, protectedBranches: readonly string[]): DshToolDef {
  return {
    name: COPY_TOOL_NAME,
    description: "Request and manage one independent local Git copy for an assigned task. The project captain approves or declines the durable request. Its owner creates and submits, then the captain integrates an independently verified exact commit and disposes of a clean, fully integrated copy. A linked worktree is the default.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: [...ACTIONS] },
        id: { type: "string", description: "Request ID for approve, decline, create, submit, integrate or dispose; optional on list to show only that request." },
        taskId: { type: "string", description: "request: the writer's active board task ID." },
        source: { type: "string", description: "request: canonical project checkout or '.' relative to that checkout." },
        base: { type: "string", description: "request: full object ID of the committed source base." },
        destination: { type: "string", description: "request: a unique lowercase name under project .mpd/copies/checkouts." },
        scope: { type: "array", items: { type: "string" }, description: "request: a subset of the exact write scopes on the active task." },
        reason: { type: "string", description: "request: why a linked worktree is unsuitable. Decline/approve: optional decision note." },
        setup: { type: "string", description: "request: known build and setup needs in the estimate. Identify any needed dirty or untracked inputs for separate authorization." },
        estimatedBytes: { type: "integer", minimum: 1, description: "request: estimated peak bytes for objects, checkout, temporary packs and known setup/build data." },
        commit: { type: "string", description: "submit: full commit object ID in the registered copy." },
        verification: { type: "string", description: "integrate: independent mpd_verify_record PASS id for this request and submitted SHA." },
        into: { type: "string", description: "integrate: currently checked-out unprotected integration branch in the project." },
      },
      required: ["action"],
    },
    output: {
      /** Render the validated object as readable text while retaining the structured tool value. */
      render: (_args: unknown, value: unknown) => textBlock(JSON.stringify(value, null, 2)),
    },
    execute: (raw: unknown, exec: DshToolExec) => {
      /** An immutable call cannot claim a different checkout, captain, member or project. */
      const authority = authorizeCopy(ctx, dsh.workspaceRoot(exec), exec)
      /** Tool arguments choose the requested operation, never its authority. */
      const args = objectOf(raw)
      /** These operations have no prior request ID. */
      const action = args.action
      if (action === "list") {
        /** Apply the optional lookup only to requests visible to this authenticated caller. */
        const id = args.id === undefined ? undefined : text(args, "id")
        return { copies: listCopies(authority).filter((record) => id === undefined || record.id === id).map(viewCopy) }
      }
      if (action === "request") return viewCopy(requestCopy(authority, parseRequest(args)))
      return changeCopy(authority, text(args, "id"), (copy) => {
        switch (action) {
          case "approve":
          case "decline": return viewCopy(decideCopy(copy, action === "approve", args.reason === undefined ? undefined : text(args, "reason")))
          case "create": return viewCopy(allocateCopy(copy))
          case "submit": return viewCopy(submitCopy(copy, text(args, "commit")))
          case "integrate": {
            /** Report a Git conflict as data after the native abort has run. */
            const result = mergeCopy(copy, text(args, "into"), text(args, "verification"), protectedBranches)
            return { ...result, record: viewCopy(result.record) }
          }
          case "dispose": return viewCopy(disposeCopy(copy))
          default: throw new WorktreeError("copy-arguments", "choose a supported copy action")
        }
      })
    },
  }
}
