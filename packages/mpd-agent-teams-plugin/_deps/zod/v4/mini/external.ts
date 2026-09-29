// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
export * as core from "../core/index.ts";
export * from "./parse.ts";
export * from "./schemas.ts";
export * from "./checks.ts";
export { globalRegistry, registry, config, $output, $input, $brand, clone, regexes, treeifyError, prettifyError, formatError, flattenError, TimePrecision, util, NEVER, } from "../core/index.ts";
export { toJSONSchema } from "../core/json-schema-processors.ts";
export * as locales from "../locales/index.ts";
/** A special constant with type `never` */
// export const NEVER = {} as never;
// iso
export * as iso from "./iso.ts";
export { ZodMiniISODateTime, ZodMiniISODate, ZodMiniISOTime, ZodMiniISODuration, } from "./iso.ts";
// coerce
export * as coerce from "./coerce.ts";
