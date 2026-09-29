// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
import * as core from "../core/index.ts";
import { $ZodError } from "../core/index.ts";
import * as util from "../core/util.ts";
const initializer = (inst, issues) => {
    $ZodError.init(inst, issues);
    inst.name = "ZodError";
    Object.defineProperties(inst, {
        format: {
            value: (mapper) => core.formatError(inst, mapper),
            // enumerable: false,
        },
        flatten: {
            value: (mapper) => core.flattenError(inst, mapper),
            // enumerable: false,
        },
        addIssue: {
            value: (issue) => {
                inst.issues.push(issue);
                inst.message = JSON.stringify(inst.issues, util.jsonStringifyReplacer, 2);
            },
            // enumerable: false,
        },
        addIssues: {
            value: (issues) => {
                inst.issues.push(...issues);
                inst.message = JSON.stringify(inst.issues, util.jsonStringifyReplacer, 2);
            },
            // enumerable: false,
        },
        isEmpty: {
            get() {
                return inst.issues.length === 0;
            },
            // enumerable: false,
        },
    });
    // Object.defineProperty(inst, "isEmpty", {
    //   get() {
    //     return inst.issues.length === 0;
    //   },
    // });
};
export const ZodError = /*@__PURE__*/ core.$constructor("ZodError", initializer);
export const ZodRealError = /*@__PURE__*/ core.$constructor("ZodError", initializer, {
    Parent: Error,
});
// /** @deprecated Use `z.core.$ZodErrorMapCtx` instead. */
// export type ErrorMapCtx = core.$ZodErrorMapCtx;
