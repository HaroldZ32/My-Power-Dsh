// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorUtil = void 0;
var errorUtil;
(function (errorUtil) {
    errorUtil.errToObj = (message) => typeof message === "string" ? { message } : message || {};
    // biome-ignore lint:
    errorUtil.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (exports.errorUtil = errorUtil = {}));
