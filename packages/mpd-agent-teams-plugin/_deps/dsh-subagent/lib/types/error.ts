// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @deepseek-ai/dsh-subagent
 */
import { HarnessError } from '../../../dsh-llm/lib/index.ts';
/** Typed failure for the subagent seam. */
export class SubagentError extends HarnessError {
    constructor(message, code, options) {
        super(message, code, options);
        this.name = 'SubagentError';
    }
}
//# sourceMappingURL=error.js.map