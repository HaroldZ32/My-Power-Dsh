// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JSONSchema = exports.JSONSchemaGenerator = exports.toJSONSchema = exports.locales = exports.regexes = exports.util = void 0;
__exportStar(require("./core.cts"), exports);
__exportStar(require("./parse.cts"), exports);
__exportStar(require("./errors.cts"), exports);
__exportStar(require("./schemas.cts"), exports);
__exportStar(require("./checks.cts"), exports);
__exportStar(require("./versions.cts"), exports);
exports.util = __importStar(require("./util.cts"));
exports.regexes = __importStar(require("./regexes.cts"));
exports.locales = __importStar(require("../locales/index.cts"));
__exportStar(require("./registries.cts"), exports);
__exportStar(require("./doc.cts"), exports);
__exportStar(require("./api.cts"), exports);
__exportStar(require("./to-json-schema.cts"), exports);
var json_schema_processors_js_1 = require("./json-schema-processors.cts");
Object.defineProperty(exports, "toJSONSchema", { enumerable: true, get: function () { return json_schema_processors_js_1.toJSONSchema; } });
var json_schema_generator_js_1 = require("./json-schema-generator.cts");
Object.defineProperty(exports, "JSONSchemaGenerator", { enumerable: true, get: function () { return json_schema_generator_js_1.JSONSchemaGenerator; } });
exports.JSONSchema = __importStar(require("./json-schema.cts"));
