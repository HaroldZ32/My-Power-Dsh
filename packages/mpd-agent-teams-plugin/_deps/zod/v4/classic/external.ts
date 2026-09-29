// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
export * as core from "../core/index.ts";
export * from "./schemas.ts";
export * from "./checks.ts";
export * from "./errors.ts";
export * from "./parse.ts";
export * from "./compat.ts";
// zod-specified
import { config } from "../core/index.ts";
import en from "../locales/en.ts";
config(en());
export { globalRegistry, registry, config, $output, $input, $brand, clone, regexes, treeifyError, prettifyError, formatError, flattenError, TimePrecision, util, NEVER, } from "../core/index.ts";
export { toJSONSchema } from "../core/json-schema-processors.ts";
export { fromJSONSchema } from "./from-json-schema.ts";
export * as locales from "../locales/index.ts";
// iso
// must be exported from top-level
// https://github.com/colinhacks/zod/issues/4491
export { ZodISODateTime, ZodISODate, ZodISOTime, ZodISODuration } from "./iso.ts";
export * as iso from "./iso.ts";
export * as coerce from "./coerce.ts";
