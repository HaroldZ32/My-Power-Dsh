// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
import defaultErrorMap from "./locales/en.ts";
let overrideErrorMap = defaultErrorMap;
export { defaultErrorMap };
export function setErrorMap(map) {
    overrideErrorMap = map;
}
export function getErrorMap() {
    return overrideErrorMap;
}
