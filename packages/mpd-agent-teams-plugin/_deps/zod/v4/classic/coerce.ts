// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
import * as core from "../core/index.ts";
import * as schemas from "./schemas.ts";
export function string(params) {
    return core._coercedString(schemas.ZodString, params);
}
export function number(params) {
    return core._coercedNumber(schemas.ZodNumber, params);
}
export function boolean(params) {
    return core._coercedBoolean(schemas.ZodBoolean, params);
}
export function bigint(params) {
    return core._coercedBigint(schemas.ZodBigInt, params);
}
export function date(params) {
    return core._coercedDate(schemas.ZodDate, params);
}
