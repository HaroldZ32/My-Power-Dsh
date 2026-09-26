var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// packages/mpd-agent-teams-plugin/_deps/cosmokit/lib/index.js
var exports_lib = {};
__export(exports_lib, {
  Binary: () => Binary,
  Time: () => Time,
  arrayBufferToBase64: () => arrayBufferToBase64,
  arrayBufferToHex: () => arrayBufferToHex,
  base64ToArrayBuffer: () => base64ToArrayBuffer,
  camelCase: () => camelCase,
  camelize: () => camelize,
  capitalize: () => capitalize,
  clone: () => clone,
  contain: () => contain,
  deduplicate: () => deduplicate,
  deepEqual: () => deepEqual,
  defineProperty: () => defineProperty,
  difference: () => difference,
  filterKeys: () => filterKeys,
  formatProperty: () => formatProperty,
  hexToArrayBuffer: () => hexToArrayBuffer,
  hyphenate: () => hyphenate,
  intersection: () => intersection,
  is: () => is,
  isNonNullable: () => isNonNullable,
  isNullable: () => isNullable,
  isPlainObject: () => isPlainObject,
  makeArray: () => makeArray,
  mapValues: () => mapValues,
  noop: () => noop,
  omit: () => omit,
  paramCase: () => paramCase,
  pick: () => pick,
  remove: () => remove,
  sanitize: () => sanitize,
  snakeCase: () => snakeCase,
  trimSlash: () => trimSlash,
  uncapitalize: () => uncapitalize,
  union: () => union,
  valueMap: () => mapValues
});
function noop() {}
function isNullable(value) {
  return value === null || value === undefined;
}
function isNonNullable(value) {
  return !isNullable(value);
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys)
    return { ...source };
  const result = {};
  for (const key of keys)
    if (forced || source[key] !== undefined)
      result[key] = source[key];
  return result;
}
function omit(source, keys) {
  if (!keys)
    return { ...source };
  const result = { ...source };
  for (const key of keys)
    Reflect.deleteProperty(result, key);
  return result;
}
function defineProperty(object, key, value) {
  return Object.defineProperty(object, key, {
    writable: true,
    value,
    enumerable: false
  });
}
function contain(array1, array2) {
  return array2.every((item) => array1.includes(item));
}
function intersection(array1, array2) {
  return array1.filter((item) => array2.includes(item));
}
function difference(array1, array2) {
  return array1.filter((item) => !array2.includes(item));
}
function union(array1, array2) {
  return Array.from(new Set([...array1, ...array2]));
}
function deduplicate(array) {
  return [...new Set(array)];
}
function remove(list, item) {
  const index = list?.indexOf(item);
  if (index >= 0) {
    list.splice(index, 1);
    return true;
  } else
    return false;
}
function makeArray(source) {
  return Array.isArray(source) ? source : isNullable(source) ? [] : [source];
}
function is(type, value) {
  if (arguments.length === 1)
    return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
function clone(source, refs = /* @__PURE__ */ new Map) {
  if (!source || typeof source !== "object")
    return source;
  if (is("Date", source))
    return new Date(source.valueOf());
  if (is("RegExp", source))
    return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source))
    return source.slice(0);
  if (ArrayBuffer.isView(source))
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached)
    return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor)
      descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b)
    return true;
  if (!strict && isNullable(a) && isNullable(b))
    return true;
  if (typeof a !== typeof b)
    return false;
  if (typeof a !== "object")
    return false;
  if (!a || !b)
    return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : undefined;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength)
      return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0;i < viewA.length; i++)
      if (viewA[i] !== viewB[i])
        return false;
    return true;
  }) ?? Object.keys({
    ...a,
    ...b
  }).every((key) => deepEqual(a[key], b[key], strict));
}
function capitalize(source) {
  return source.charAt(0).toUpperCase() + source.slice(1);
}
function uncapitalize(source) {
  return source.charAt(0).toLowerCase() + source.slice(1);
}
function camelCase(source) {
  return source.replace(/[_-][a-z]/g, (str) => str.slice(1).toUpperCase());
}
function tokenize(source, delimiters, delimiter) {
  const output = [];
  let state = 0;
  for (let i = 0;i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      if (state === 1) {
        const next = source.charCodeAt(i + 1);
        if (next >= 97 && next <= 122)
          output.push(delimiter);
        output.push(code + 32);
      } else {
        if (state !== 0)
          output.push(delimiter);
        output.push(code + 32);
      }
      state = 1;
    } else if (code >= 97 && code <= 122) {
      output.push(code);
      state = 2;
    } else if (delimiters.includes(code)) {
      if (state !== 0)
        output.push(delimiter);
      state = 0;
    } else
      output.push(code);
  }
  return String.fromCharCode(...output);
}
function paramCase(source) {
  return tokenize(source, [45, 95], 45);
}
function snakeCase(source) {
  return tokenize(source, [45, 95], 95);
}
function formatProperty(key) {
  if (typeof key !== "string")
    return `[${key.toString()}]`;
  return /^[a-z_$][\w$]*$/i.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
function trimSlash(source) {
  return source.replace(/\/$/, "");
}
function sanitize(source) {
  if (!source.startsWith("/"))
    source = "/" + source;
  return trimSlash(source);
}
var Binary, base64ToArrayBuffer, arrayBufferToBase64, hexToArrayBuffer, arrayBufferToHex, camelize, hyphenate, Time;
var init_lib = __esm(() => {
  (function(Binary2) {
    Binary2.is = isArrayBufferLike;
    Binary2.isSource = isArrayBufferSource;
    function fromSource(source) {
      if (ArrayBuffer.isView(source))
        return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      else
        return source;
    }
    Binary2.fromSource = fromSource;
    function toBase64(source) {
      source = fromSource(source);
      if (typeof Buffer !== "undefined")
        return Buffer.from(source).toString("base64");
      let binary = "";
      const bytes = new Uint8Array(source);
      for (let i = 0;i < bytes.byteLength; i++)
        binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    Binary2.toBase64 = toBase64;
    function fromBase64(source) {
      if (typeof Buffer !== "undefined")
        return fromSource(Buffer.from(source, "base64"));
      return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
    }
    Binary2.fromBase64 = fromBase64;
    function toHex(source) {
      source = fromSource(source);
      if (typeof Buffer !== "undefined")
        return Buffer.from(source).toString("hex");
      return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    Binary2.toHex = toHex;
    function fromHex(source) {
      if (typeof Buffer !== "undefined")
        return fromSource(Buffer.from(source, "hex"));
      const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
      const buffer = [];
      for (let i = 0;i < hex.length; i += 2)
        buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
      return Uint8Array.from(buffer).buffer;
    }
    Binary2.fromHex = fromHex;
  })(Binary || (Binary = {}));
  base64ToArrayBuffer = Binary.fromBase64;
  arrayBufferToBase64 = Binary.toBase64;
  hexToArrayBuffer = Binary.fromHex;
  arrayBufferToHex = Binary.toHex;
  camelize = camelCase;
  hyphenate = paramCase;
  (function(Time2) {
    Time2.millisecond = 1;
    Time2.second = 1000;
    Time2.minute = Time2.second * 60;
    Time2.hour = Time2.minute * 60;
    Time2.day = Time2.hour * 24;
    Time2.week = Time2.day * 7;
    let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
    function setTimezoneOffset(offset) {
      timezoneOffset = offset;
    }
    Time2.setTimezoneOffset = setTimezoneOffset;
    function getTimezoneOffset() {
      return timezoneOffset;
    }
    Time2.getTimezoneOffset = getTimezoneOffset;
    function getDateNumber(date = /* @__PURE__ */ new Date, offset) {
      if (typeof date === "number")
        date = new Date(date);
      if (offset === undefined)
        offset = timezoneOffset;
      return Math.floor((date.valueOf() / Time2.minute - offset) / 1440);
    }
    Time2.getDateNumber = getDateNumber;
    function fromDateNumber(value, offset) {
      const date = new Date(value * Time2.day);
      if (offset === undefined)
        offset = timezoneOffset;
      return new Date(+date + offset * Time2.minute);
    }
    Time2.fromDateNumber = fromDateNumber;
    const numeric = /\d+(?:\.\d+)?/.source;
    const timeRegExp = new RegExp(`^${[
      "w(?:eek(?:s)?)?",
      "d(?:ay(?:s)?)?",
      "h(?:our(?:s)?)?",
      "m(?:in(?:ute)?(?:s)?)?",
      "s(?:ec(?:ond)?(?:s)?)?"
    ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
    function parseTime(source) {
      const capture = timeRegExp.exec(source);
      if (!capture)
        return 0;
      return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
    }
    Time2.parseTime = parseTime;
    function parseDate(date) {
      const parsed = parseTime(date);
      if (parsed)
        date = Date.now() + parsed;
      else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date))
        date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
      else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date))
        date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
      return date ? new Date(date) : /* @__PURE__ */ new Date;
    }
    Time2.parseDate = parseDate;
    function format(ms) {
      const abs = Math.abs(ms);
      if (abs >= Time2.day - Time2.hour / 2)
        return Math.round(ms / Time2.day) + "d";
      else if (abs >= Time2.hour - Time2.minute / 2)
        return Math.round(ms / Time2.hour) + "h";
      else if (abs >= Time2.minute - Time2.second / 2)
        return Math.round(ms / Time2.minute) + "m";
      else if (abs >= Time2.second)
        return Math.round(ms / Time2.second) + "s";
      return ms + "ms";
    }
    Time2.format = format;
    function toDigits(source, length = 2) {
      return source.toString().padStart(length, "0");
    }
    Time2.toDigits = toDigits;
    function template(template2, time = /* @__PURE__ */ new Date) {
      return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
    }
    Time2.template = template;
  })(Time || (Time = {}));
});

// packages/mpd-agent-teams-plugin/_deps/schemastery/lib/index.cjs
var require_lib = __commonJS(function(exports, module) {
  var _deepseek_ai_cosmokit = (init_lib(), __toCommonJS(exports_lib));
  var kSchema = Symbol.for("schemastery");
  var kValidationError = Symbol.for("ValidationError");
  globalThis.__schemastery_index__ ??= 0;
  globalThis.__schemastery_refs__ = undefined;
  var ValidationError = class extends TypeError {
    options;
    name = "ValidationError";
    constructor(message, options) {
      let prefix = "$";
      for (const segment of options.path || [])
        if (typeof segment === "string")
          prefix += "." + segment;
        else if (typeof segment === "number")
          prefix += "[" + segment + "]";
        else if (typeof segment === "symbol")
          prefix += `[Symbol(${segment.toString()})]`;
      if (prefix.startsWith("."))
        prefix = prefix.slice(1);
      super((prefix === "$" ? "" : `${prefix} `) + message);
      this.options = options;
    }
    static is(error) {
      return !!error?.[kValidationError];
    }
  };
  Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
  var Schema = function(options) {
    const schema = function(data, options2 = {}) {
      return Schema.resolve(data, schema, options2)[0];
    };
    if (options.refs) {
      const refs = (0, _deepseek_ai_cosmokit.valueMap)(options.refs, (options2) => new Schema(options2));
      const getRef = (uid) => refs[uid];
      for (const key in refs) {
        const options2 = refs[key];
        options2.sKey = getRef(options2.sKey);
        options2.inner = getRef(options2.inner);
        options2.list = options2.list && options2.list.map(getRef);
        options2.dict = options2.dict && (0, _deepseek_ai_cosmokit.valueMap)(options2.dict, getRef);
      }
      return refs[options.uid];
    }
    Object.assign(schema, options);
    if (typeof schema.callback === "string")
      try {
        schema.callback = new Function("return " + schema.callback)();
      } catch {}
    Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
    Object.setPrototypeOf(schema, Schema.prototype);
    schema.meta ||= {};
    schema.toString = schema.toString.bind(schema);
    return schema;
  };
  Schema.prototype = Object.create(Function.prototype);
  Schema.prototype[kSchema] = true;
  Object.defineProperty(Schema.prototype, "~standard", { get() {
    return {
      version: 1,
      vendor: "schemastery",
      validate: (value) => {
        try {
          return { value: Schema.resolve(value, this, {})[0] };
        } catch (error) {
          if (ValidationError.is(error))
            return { issues: [{
              message: error.message,
              path: error.options.path
            }] };
          throw error;
        }
      }
    };
  } });
  Schema.ValidationError = ValidationError;
  Schema.prototype.toJSON = function toJSON() {
    if (globalThis.__schemastery_refs__) {
      globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
      return this.uid;
    }
    globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
    globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
    const result = {
      uid: this.uid,
      refs: globalThis.__schemastery_refs__
    };
    globalThis.__schemastery_refs__ = undefined;
    return result;
  };
  Schema.prototype.set = function set(key, value) {
    this.dict[key] = value;
    return this;
  };
  Schema.prototype.push = function push(value) {
    this.list.push(value);
    return this;
  };
  function mergeDesc(original, messages) {
    const result = typeof original === "string" ? { "": original } : { ...original };
    for (const locale in messages) {
      const value = messages[locale];
      if (value?.$description || value?.$desc)
        result[locale] = value.$description || value.$desc;
      else if (typeof value === "string")
        result[locale] = value;
    }
    return result;
  }
  function getInner(value) {
    return value?.$value ?? value?.$inner;
  }
  function extractKeys(data) {
    return (0, _deepseek_ai_cosmokit.filterKeys)(data ?? {}, (key) => !key.startsWith("$"));
  }
  Schema.prototype.i18n = function i18n(messages) {
    const schema = Schema(this);
    const desc = mergeDesc(schema.meta.description, messages);
    if (Object.keys(desc).length)
      schema.meta.description = desc;
    if (schema.dict)
      schema.dict = (0, _deepseek_ai_cosmokit.valueMap)(schema.dict, (inner, key) => {
        return inner.i18n((0, _deepseek_ai_cosmokit.valueMap)(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
      });
    if (schema.list)
      schema.list = schema.list.map((inner, index) => {
        return inner.i18n((0, _deepseek_ai_cosmokit.valueMap)(messages, (data = {}) => {
          if (Array.isArray(getInner(data)))
            return getInner(data)[index];
          if (Array.isArray(data))
            return data[index];
          return extractKeys(data);
        }));
      });
    if (schema.inner)
      schema.inner = schema.inner.i18n((0, _deepseek_ai_cosmokit.valueMap)(messages, (data) => {
        if (getInner(data))
          return getInner(data);
        return extractKeys(data);
      }));
    if (schema.sKey)
      schema.sKey = schema.sKey.i18n((0, _deepseek_ai_cosmokit.valueMap)(messages, (data) => data?.$key));
    return schema;
  };
  Schema.prototype.extra = function extra(key, value) {
    const schema = Schema(this);
    schema.meta = {
      ...schema.meta,
      [key]: value
    };
    return schema;
  };
  for (const key of [
    "required",
    "disabled",
    "collapse",
    "hidden",
    "loose"
  ])
    Object.assign(Schema.prototype, { [key](value = true) {
      const schema = Schema(this);
      schema.meta = {
        ...schema.meta,
        [key]: value
      };
      return schema;
    } });
  Schema.prototype.deprecated = function deprecated() {
    const schema = Schema(this);
    schema.meta.badges ||= [];
    schema.meta.badges.push({
      text: "deprecated",
      type: "danger"
    });
    return schema;
  };
  Schema.prototype.experimental = function experimental() {
    const schema = Schema(this);
    schema.meta.badges ||= [];
    schema.meta.badges.push({
      text: "experimental",
      type: "warning"
    });
    return schema;
  };
  Schema.prototype.pattern = function pattern(regexp) {
    const schema = Schema(this);
    const pattern2 = (0, _deepseek_ai_cosmokit.pick)(regexp, ["source", "flags"]);
    schema.meta = {
      ...schema.meta,
      pattern: pattern2
    };
    return schema;
  };
  Schema.prototype.simplify = function simplify(value) {
    if ((0, _deepseek_ai_cosmokit.deepEqual)(value, this.meta.default, this.type === "dict"))
      return null;
    if ((0, _deepseek_ai_cosmokit.isNullable)(value))
      return value;
    if (this.type === "object" || this.type === "dict") {
      const result = {};
      for (const key in value) {
        const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
        if (this.type === "dict" || !(0, _deepseek_ai_cosmokit.isNullable)(item))
          result[key] = item;
      }
      if ((0, _deepseek_ai_cosmokit.deepEqual)(result, this.meta.default, this.type === "dict"))
        return null;
      return result;
    } else if (this.type === "array" || this.type === "tuple") {
      const result = [];
      value.forEach((value2, index) => {
        const schema = this.type === "array" ? this.inner : this.list[index];
        const item = schema ? schema.simplify(value2) : value2;
        result.push(item);
      });
      return result;
    } else if (this.type === "intersect") {
      const result = {};
      for (const item of this.list)
        Object.assign(result, item.simplify(value));
      return result;
    } else if (this.type === "union")
      for (const schema of this.list)
        try {
          Schema.resolve(value, schema, {});
          return schema.simplify(value);
        } catch {}
    return value;
  };
  Schema.prototype.toString = function toString(inline) {
    return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
  };
  Schema.prototype.role = function role(role, extra) {
    const schema = Schema(this);
    schema.meta = {
      ...schema.meta,
      role,
      extra
    };
    return schema;
  };
  for (const key of [
    "default",
    "link",
    "comment",
    "description",
    "max",
    "min",
    "step"
  ])
    Object.assign(Schema.prototype, { [key](value) {
      const schema = Schema(this);
      schema.meta = {
        ...schema.meta,
        [key]: value
      };
      return schema;
    } });
  var resolvers = {};
  Schema.extend = function extend(type, resolve) {
    resolvers[type] = resolve;
  };
  Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
    if (!schema)
      return [data];
    if (options.ignore?.(data, schema))
      return [data];
    if ((0, _deepseek_ai_cosmokit.isNullable)(data) && schema.type !== "lazy") {
      if (schema.meta.required)
        throw new ValidationError(`missing required value`, options);
      let current = schema;
      let fallback = schema.meta.default;
      while (current?.type === "intersect" && (0, _deepseek_ai_cosmokit.isNullable)(fallback)) {
        current = current.list[0];
        fallback = current?.meta.default;
      }
      if ((0, _deepseek_ai_cosmokit.isNullable)(fallback))
        return [data];
      data = (0, _deepseek_ai_cosmokit.clone)(fallback);
    }
    const callback = resolvers[schema.type];
    if (!callback)
      throw new ValidationError(`unsupported type "${schema.type}"`, options);
    try {
      return callback(data, schema, options, strict);
    } catch (error) {
      if (!schema.meta.loose)
        throw error;
      return [schema.meta.default];
    }
  };
  Schema.from = function from(source) {
    if ((0, _deepseek_ai_cosmokit.isNullable)(source))
      return Schema.any();
    else if ([
      "string",
      "number",
      "boolean"
    ].includes(typeof source))
      return Schema.const(source).required();
    else if (source[kSchema])
      return source;
    else if (typeof source === "function")
      switch (source) {
        case String:
          return Schema.string().required();
        case Number:
          return Schema.number().required();
        case Boolean:
          return Schema.boolean().required();
        case Function:
          return Schema.function().required();
        default:
          return Schema.is(source).required();
      }
    else
      throw new TypeError(`cannot infer schema from ${source}`);
  };
  Schema.lazy = function lazy(builder) {
    const toJSON = () => {
      if (!schema.inner[kSchema]) {
        schema.inner = schema.builder();
        schema.inner.meta = {
          ...schema.meta,
          ...schema.inner.meta
        };
      }
      return schema.inner.toJSON();
    };
    const schema = new Schema({
      type: "lazy",
      builder,
      inner: { toJSON }
    });
    return schema;
  };
  Schema.natural = function natural() {
    return Schema.number().step(1).min(0);
  };
  Schema.percent = function percent() {
    return Schema.number().step(0.01).min(0).max(1).role("slider");
  };
  Schema.date = function date() {
    return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
      const date2 = new Date(value);
      if (isNaN(+date2))
        throw new ValidationError(`invalid date "${value}"`, options);
      return date2;
    }, true)]);
  };
  Schema.regExp = function regExp(flag = "") {
    return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
      try {
        return new RegExp(value, flag);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)]);
  };
  Schema.arrayBuffer = function arrayBuffer(encoding) {
    return Schema.union([
      Schema.is(ArrayBuffer),
      Schema.is(SharedArrayBuffer),
      Schema.transform(Schema.any(), (value, options) => {
        if (_deepseek_ai_cosmokit.Binary.isSource(value))
          return _deepseek_ai_cosmokit.Binary.fromSource(value);
        throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
      }, true),
      ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
        try {
          return encoding === "base64" ? _deepseek_ai_cosmokit.Binary.fromBase64(value) : _deepseek_ai_cosmokit.Binary.fromHex(value);
        } catch (e) {
          throw new ValidationError(e.message, options);
        }
      }, true)] : []
    ]);
  };
  Schema.extend("lazy", (data, schema, options, strict) => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return Schema.resolve(data, schema.inner, options, strict);
  });
  Schema.extend("any", (data) => {
    return [data];
  });
  Schema.extend("never", (data, _, options) => {
    throw new ValidationError(`expected nullable but got ${data}`, options);
  });
  Schema.extend("const", (data, { value }, options) => {
    if ((0, _deepseek_ai_cosmokit.deepEqual)(data, value))
      return [value];
    throw new ValidationError(`expected ${value} but got ${data}`, options);
  });
  function checkWithinRange(data, meta, description, options, skipMin = false) {
    const { max = Infinity, min = -Infinity } = meta;
    if (data > max)
      throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
    if (data < min && !skipMin)
      throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
  }
  Schema.extend("string", (data, { meta }, options) => {
    if (typeof data !== "string")
      throw new ValidationError(`expected string but got ${data}`, options);
    if (meta.pattern) {
      const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
      if (!regexp.test(data))
        throw new ValidationError(`expect string to match regexp ${regexp}`, options);
    }
    checkWithinRange(data.length, meta, "string length", options);
    return [data];
  });
  function decimalShift(data, digits) {
    const str = data.toString();
    if (str.includes("e"))
      return data * Math.pow(10, digits);
    const index = str.indexOf(".");
    if (index === -1)
      return data * Math.pow(10, digits);
    const frac = str.slice(index + 1);
    const integer = str.slice(0, index);
    if (frac.length <= digits)
      return +(integer + frac.padEnd(digits, "0"));
    return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
  }
  function isMultipleOf(data, min, step) {
    step = Math.abs(step);
    if (!/^\d+\.\d+$/.test(step.toString()))
      return (data - min) % step === 0;
    const index = step.toString().indexOf(".");
    const digits = step.toString().slice(index + 1).length;
    return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
  }
  Schema.extend("number", (data, { meta }, options) => {
    if (typeof data !== "number")
      throw new ValidationError(`expected number but got ${data}`, options);
    checkWithinRange(data, meta, "number", options);
    const { step } = meta;
    if (step && !isMultipleOf(data, meta.min ?? 0, step))
      throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
    return [data];
  });
  Schema.extend("boolean", (data, _, options) => {
    if (typeof data === "boolean")
      return [data];
    throw new ValidationError(`expected boolean but got ${data}`, options);
  });
  Schema.extend("bitset", (data, { bits, meta }, options) => {
    let value = 0, keys = [];
    if (typeof data === "number") {
      value = data;
      for (const key in bits)
        if (data & bits[key])
          keys.push(key);
    } else if (Array.isArray(data)) {
      keys = data;
      for (const key of keys) {
        if (typeof key !== "string")
          throw new ValidationError(`expected string but got ${key}`, options);
        if (key in bits)
          value |= bits[key];
      }
    } else
      throw new ValidationError(`expected number or array but got ${data}`, options);
    if (value === meta.default)
      return [value];
    return [value, keys];
  });
  Schema.extend("function", (data, _, options) => {
    if (typeof data === "function")
      return [data];
    throw new ValidationError(`expected function but got ${data}`, options);
  });
  Schema.extend("is", (data, { constructor }, options) => {
    if (typeof constructor === "function") {
      if (data instanceof constructor)
        return [data];
      throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
    } else {
      if ((0, _deepseek_ai_cosmokit.isNullable)(data))
        throw new ValidationError(`expected ${constructor} but got ${data}`, options);
      let prototype = Object.getPrototypeOf(data);
      while (prototype) {
        if (prototype.constructor?.name === constructor)
          return [data];
        prototype = Object.getPrototypeOf(prototype);
      }
      throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    }
  });
  function property(data, key, schema, options) {
    try {
      const [value, adapted] = Schema.resolve(data[key], schema, {
        ...options,
        path: [...options.path || [], key]
      });
      if (adapted !== undefined)
        data[key] = adapted;
      return value;
    } catch (e) {
      if (!options?.autofix)
        throw e;
      delete data[key];
      return schema.meta.default;
    }
  }
  Schema.extend("array", (data, { inner, meta }, options) => {
    if (!Array.isArray(data))
      throw new ValidationError(`expected array but got ${data}`, options);
    checkWithinRange(data.length, meta, "array length", options, !(0, _deepseek_ai_cosmokit.isNullable)(inner.meta.default));
    return [data.map((_, index) => property(data, index, inner, options))];
  });
  Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
    if (!(0, _deepseek_ai_cosmokit.isPlainObject)(data))
      throw new ValidationError(`expected object but got ${data}`, options);
    const result = {};
    for (const key in data) {
      let rKey;
      try {
        rKey = Schema.resolve(key, sKey, options)[0];
      } catch (error) {
        if (strict)
          continue;
        throw error;
      }
      result[rKey] = property(data, key, inner, options);
      data[rKey] = data[key];
      if (key !== rKey)
        delete data[key];
    }
    return [result];
  });
  Schema.extend("tuple", (data, { list }, options, strict) => {
    if (!Array.isArray(data))
      throw new ValidationError(`expected array but got ${data}`, options);
    const result = list.map((inner, index) => property(data, index, inner, options));
    if (strict)
      return [result];
    result.push(...data.slice(list.length));
    return [result];
  });
  function merge(result, data) {
    for (const key in data) {
      if (key in result)
        continue;
      result[key] = data[key];
    }
  }
  Schema.extend("object", (data, { dict }, options, strict) => {
    if (!(0, _deepseek_ai_cosmokit.isPlainObject)(data))
      throw new ValidationError(`expected object but got ${data}`, options);
    const result = {};
    for (const key in dict) {
      const value = property(data, key, dict[key], options);
      if (!(0, _deepseek_ai_cosmokit.isNullable)(value) || key in data)
        result[key] = value;
    }
    if (!strict)
      merge(result, data);
    return [result];
  });
  Schema.extend("union", (data, { list, toString }, options, strict) => {
    const messages = [];
    for (const inner of list)
      try {
        return Schema.resolve(data, inner, options, strict);
      } catch (error) {
        messages.push(error);
      }
    throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
  });
  Schema.extend("intersect", (data, { list, toString }, options, strict) => {
    if (!list.length)
      return [data];
    let result;
    for (const inner of list) {
      const value = Schema.resolve(data, inner, options, true)[0];
      if ((0, _deepseek_ai_cosmokit.isNullable)(value))
        continue;
      if ((0, _deepseek_ai_cosmokit.isNullable)(result))
        result = value;
      else if (typeof result !== typeof value)
        throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
      else if (typeof value === "object")
        merge(result ??= {}, value);
      else if (result !== value)
        throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
    }
    if (!strict && (0, _deepseek_ai_cosmokit.isPlainObject)(data))
      merge(result, data);
    return [result];
  });
  Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
    const [result, adapted = data] = Schema.resolve(data, inner, options, true);
    if (preserve)
      return [callback(result)];
    else
      return [callback(result), callback(adapted)];
  });
  var formatters = {};
  function defineMethod(name, keys, format) {
    formatters[name] = format;
    Object.assign(Schema, { [name](...args) {
      const schema = new Schema({ type: name });
      keys.forEach((key, index) => {
        switch (key) {
          case "sKey":
            schema.sKey = args[index] ?? Schema.string();
            break;
          case "inner":
            schema.inner = Schema.from(args[index]);
            break;
          case "list":
            schema.list = args[index].map(Schema.from);
            break;
          case "dict":
            schema.dict = (0, _deepseek_ai_cosmokit.valueMap)(args[index], Schema.from);
            break;
          case "bits":
            schema.bits = {};
            for (const key2 in args[index]) {
              if (typeof args[index][key2] !== "number")
                continue;
              schema.bits[key2] = args[index][key2];
            }
            break;
          case "callback": {
            const callback = schema.callback = args[index];
            callback["toJSON"] ||= () => callback.toString();
            break;
          }
          case "constructor": {
            const constructor = schema.constructor = args[index];
            if (typeof constructor === "function")
              constructor["toJSON"] ||= () => constructor["name"];
            break;
          }
          default:
            schema[key] = args[index];
        }
      });
      if (name === "object" || name === "dict")
        schema.meta.default = {};
      else if (name === "array" || name === "tuple")
        schema.meta.default = [];
      else if (name === "bitset")
        schema.meta.default = 0;
      return schema;
    } });
  }
  defineMethod("is", ["constructor"], ({ constructor }) => {
    if (typeof constructor === "function")
      return constructor.name;
    else
      return constructor;
  });
  defineMethod("any", [], () => "any");
  defineMethod("never", [], () => "never");
  defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
  defineMethod("string", [], () => "string");
  defineMethod("number", [], () => "number");
  defineMethod("boolean", [], () => "boolean");
  defineMethod("bitset", ["bits"], () => "bitset");
  defineMethod("function", [], () => "function");
  defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
  defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
  defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
  defineMethod("object", ["dict"], ({ dict }) => {
    if (Object.keys(dict).length === 0)
      return "{}";
    return `{ ${Object.entries(dict).map(([key, inner]) => {
      return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
    }).join(", ")} }`;
  });
  defineMethod("union", ["list"], ({ list }, inline) => {
    const result = list.map(({ toString: format }) => format()).join(" | ");
    return inline ? `(${result})` : result;
  });
  defineMethod("intersect", ["list"], ({ list }) => {
    return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
  });
  defineMethod("transform", [
    "inner",
    "callback",
    "preserve"
  ], ({ inner }, isInner) => inner.toString(isInner));
  module.exports = Schema;
});

// packages/mpd-team-watchdog-plugin/src/index.ts
var import_schemastery = __toESM(require_lib(), 1);

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
var OBJECT_SCHEMA = { type: "object", properties: {} };
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
var TEAM_TASK_METHODS = ["createTask", "getTask", "listTasks", "updateTask"];
function textBlock(content) {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }];
}
function userMessage(input) {
  const content = textBlock(input?.text);
  for (const block of content)
    Object.freeze(block);
  Object.freeze(content);
  const source = { kind: "user", ...input?.source ?? {} };
  Object.freeze(source);
  const message = { id: randomUUID(), role: "user", content, source };
  return Object.freeze(message);
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function sessionCwdOf(agent) {
  try {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
  } catch {
    return;
  }
}
function workspaceRootOf(exec) {
  const session = sessionCwdOf(exec?.agent);
  if (session !== undefined)
    return resolve(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve(override);
  return process.cwd();
}
function workspaceRootsOf(agents) {
  if (agents === undefined || agents === null || typeof agents.list !== "function")
    return [];
  try {
    const list = agents.list();
    if (!Array.isArray(list))
      return [];
    const roots = new Set;
    for (const agent of list) {
      const cwd = sessionCwdOf(agent);
      if (cwd !== undefined)
        roots.add(resolve(cwd));
    }
    return [...roots];
  } catch {
    return [];
  }
}
function noop2() {}
function scopeOfAgentContext(agent) {
  let context;
  try {
    context = agent?.ctx;
  } catch {
    return;
  }
  if (context === undefined || context === null)
    return;
  const kind = typeof context;
  if (kind !== "object" && kind !== "function")
    return;
  let on;
  let effect;
  let restrict;
  try {
    const scoped = context;
    on = scoped.on;
    effect = scoped.effect;
    restrict = scoped.tools?.restrict;
  } catch {
    return;
  }
  if (typeof on !== "function" || typeof effect !== "function" || typeof restrict !== "function")
    return;
  const tools = context.tools;
  return {
    context,
    tools: { restrict: (filter) => restrict.call(tools, filter) },
    on: (event, handler) => on.call(context, event, handler),
    effect: (fn, label) => effect.call(context, fn, label)
  };
}
function teamContextOf(raw) {
  return raw === "fresh" || raw === "fork" ? raw : undefined;
}
function teamStatusOf(raw) {
  return raw === "running" || raw === "provisioning" || raw === "failed" ? raw : "inactive";
}
function teamTaskStatusOf(raw) {
  return raw === "in_progress" || raw === "completed" || raw === "deleted" ? raw : "pending";
}
function teamStrings(raw) {
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === "string") : [];
}
function teamMemberView(raw) {
  const row = raw ?? {};
  const context = teamContextOf(row.context);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: row.role === "lead" ? "lead" : "teammate",
    status: teamStatusOf(row.status),
    ...typeof row.description === "string" ? { description: row.description } : {},
    ...typeof row.provider === "string" ? { provider: row.provider } : {},
    ...context === undefined ? {} : { context },
    ...typeof row.model === "string" ? { model: row.model } : {},
    diagnostics: teamStrings(row.diagnostics)
  };
}
function teamTaskView(raw) {
  const row = raw ?? {};
  return {
    id: String(row.id ?? ""),
    revision: typeof row.revision === "number" ? row.revision : 0,
    subject: String(row.subject ?? ""),
    description: String(row.description ?? ""),
    status: teamTaskStatusOf(row.status),
    blockedBy: teamStrings(row.blockedBy),
    writeScopes: teamStrings(row.writeScopes),
    ...typeof row.ownerName === "string" ? { ownerName: row.ownerName } : {},
    ready: row.ready === true,
    writeScopeWarnings: teamStrings(row.writeScopeWarnings)
  };
}
function teamRows(teams, method, agent, project) {
  const reader = teams?.[method];
  if (typeof reader !== "function")
    return [];
  try {
    const rows = reader.call(teams, agent);
    return Array.isArray(rows) ? rows.map(project) : [];
  } catch {
    return [];
  }
}
function agentSystemPromptOf(agent) {
  let context;
  try {
    context = agent?.ctx;
  } catch {
    return;
  }
  if (context === undefined || context === null)
    return;
  try {
    const systemPrompt = context.systemPrompt;
    return typeof systemPrompt?.section === "function" ? systemPrompt : undefined;
  } catch {
    return;
  }
}
function createDshAdapter(ctx, config = {}) {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const service = (serviceName) => {
    if (typeof ctx?.get === "function") {
      try {
        const viaGet = ctx.get(serviceName);
        if (viaGet !== undefined && viaGet !== null)
          return viaGet;
      } catch {}
    }
    try {
      return ctx?.[serviceName];
    } catch {
      return;
    }
  };
  function requireService(serviceName, needed) {
    const found = service(serviceName);
    if (found === undefined || found === null) {
      throw new Error(`mpd-dsh-adapter: harness service "${serviceName}" is unavailable — ${needed}`);
    }
    return found;
  }
  const workspaceRoot = (exec) => workspaceRootOf(exec);
  const workspaceRootsAll = () => workspaceRootsOf(service("agents"));
  function liveAgents() {
    const agents = service("agents");
    if (agents === undefined || typeof agents.list !== "function")
      return [];
    try {
      const list = agents.list();
      return Array.isArray(list) ? list.filter((entry) => entry !== undefined && entry !== null) : [];
    } catch {
      return [];
    }
  }
  function liveAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const agents = service("agents");
    if (agents !== undefined && typeof agents.get === "function") {
      try {
        const found = agents.get(id);
        if (found !== undefined && found !== null)
          return found;
      } catch {}
    }
    return liveAgents().find((candidate) => candidate.id === id);
  }
  const engineCache = new Map;
  function compactionEngineForAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const cached = engineCache.get(id);
    if (cached !== undefined)
      return cached;
    const agent = liveAgent(id);
    const scoped = agent?.ctx;
    if (scoped === undefined || scoped === null)
      return;
    let engine;
    try {
      engine = typeof scoped.get === "function" ? scoped.get("compaction") : undefined;
    } catch {
      return;
    }
    if (engine === undefined || engine === null)
      return;
    engineCache.set(id, engine);
    return engine;
  }
  function onEvent(event, handler) {
    if (typeof ctx?.on !== "function")
      return;
    try {
      const disposer = ctx.on(event, handler);
      return typeof disposer === "function" ? disposer : () => {};
    } catch {
      return;
    }
  }
  const LLM_CATALOG_METHODS = ["listProviders", "listModels", "resolveModelInfo"];
  let llmCatalogWarned = false;
  function warnLlmCatalogOnce(detail) {
    if (llmCatalogWarned)
      return;
    llmCatalogWarned = true;
    try {
      console.warn("mpd-dsh-adapter: llmCatalog degraded — " + detail);
    } catch {}
  }
  function catalogLabel(value, id) {
    return typeof value === "string" && value.length > 0 ? value : id;
  }
  async function llmCatalog() {
    const llm = service("llm");
    if (llm === undefined || llm === null) {
      warnLlmCatalogOnce("the harness llm service is unavailable");
      return { providers: [], degraded: true };
    }
    const missing = LLM_CATALOG_METHODS.filter((method) => typeof llm?.[method] !== "function");
    if (missing.length > 0) {
      warnLlmCatalogOnce("the harness llm service lacks " + missing.join(", "));
      return { providers: [], degraded: true };
    }
    let providers;
    try {
      providers = await llm.listProviders();
    } catch (error) {
      warnLlmCatalogOnce("listProviders() failed: " + message(error));
      return { providers: [], degraded: true };
    }
    if (!Array.isArray(providers)) {
      warnLlmCatalogOnce("listProviders() did not return an array");
      return { providers: [], degraded: true };
    }
    let degraded = false;
    const catalog = [];
    for (const rawProvider of providers) {
      const providerId = typeof rawProvider?.id === "string" ? rawProvider.id : undefined;
      if (providerId === undefined) {
        degraded = true;
        continue;
      }
      try {
        const models = await llm.listModels(providerId);
        if (!Array.isArray(models))
          throw new Error("listModels(" + providerId + ") did not return an array");
        const entries = [];
        for (const rawModel of models) {
          const modelId = typeof rawModel?.id === "string" ? rawModel.id : undefined;
          if (modelId === undefined) {
            degraded = true;
            continue;
          }
          let resolved;
          try {
            resolved = await llm.resolveModelInfo(providerId, modelId);
          } catch {
            degraded = true;
            continue;
          }
          const reasoning = resolved?.reasoning;
          const efforts = [];
          const rawEfforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : [];
          for (const rawEffort of rawEfforts) {
            const effortId = typeof rawEffort?.id === "string" ? rawEffort.id : undefined;
            if (effortId === undefined)
              continue;
            efforts.push({
              id: effortId,
              name: catalogLabel(rawEffort?.name, effortId),
              ...typeof rawEffort?.description === "string" ? { description: rawEffort.description } : {}
            });
          }
          const defaultEffort = typeof reasoning?.defaultEffort === "string" ? reasoning.defaultEffort : undefined;
          entries.push({
            id: modelId,
            name: catalogLabel(rawModel?.name, modelId),
            ...typeof rawModel?.description === "string" ? { description: rawModel.description } : {},
            efforts,
            ...defaultEffort === undefined ? {} : { defaultEffort }
          });
        }
        catalog.push({ id: providerId, name: catalogLabel(rawProvider?.name, providerId), models: entries });
      } catch {
        degraded = true;
        continue;
      }
    }
    return { providers: catalog, degraded };
  }
  function timeoutSignal(timeoutMs) {
    try {
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function")
        return AbortSignal.timeout(timeoutMs);
    } catch {}
    return;
  }
  const adapter = {
    capabilities() {
      const tools = service("tools");
      const subagents = service("subagents");
      const skills = service("skills");
      const presets = service("agentPresets");
      const commands = service("commands");
      const agents = service("agents");
      const compaction = service("compaction");
      const llmService = service("llm");
      const systemPrompt = service("systemPrompt");
      const agentTeams = service("agentTeams");
      const sample = liveAgents()[0];
      const sampleScoped = sample?.ctx;
      let scopedCompaction = false;
      try {
        scopedCompaction = sampleScoped !== undefined && typeof sampleScoped.get === "function" && sampleScoped.get("compaction") !== undefined;
      } catch {
        scopedCompaction = false;
      }
      return {
        tools: tools !== undefined,
        toolsRegister: typeof tools?.register === "function",
        toolsGuard: typeof tools?.guard === "function",
        toolsGet: typeof tools?.get === "function",
        toolsExecute: typeof tools?.execute === "function",
        toolsPreExecute: typeof ctx?.on === "function",
        toolsPostExecute: typeof ctx?.on === "function",
        subagents: subagents !== undefined,
        subagentsSpawn: typeof subagents?.start === "function",
        skills: skills !== undefined,
        skillsProvider: typeof skills?.registerProvider === "function",
        agentPresets: typeof presets?.resolve === "function",
        commands: commands !== undefined,
        commandsRegister: typeof commands?.register === "function",
        turnSubmit: liveAgents().some((candidate) => typeof candidate?.followup === "function"),
        agents: agents !== undefined && typeof agents?.list === "function",
        compaction: typeof compaction?.compactNow === "function",
        compactionForAgent: scopedCompaction,
        events: typeof ctx?.on === "function",
        llmCatalog: LLM_CATALOG_METHODS.every((method) => typeof service("llm")?.[method] === "function"),
        toolsRegisterHost: typeof tools?.register === "function",
        subagentsProvider: typeof subagents?.getProvider === "function" && typeof subagents?.list === "function",
        subagentsContinuable: typeof subagents?.startContinuable === "function",
        subagentsInterrupt: typeof subagents?.interrupt === "function",
        llmListModels: typeof llmService?.listModels === "function",
        llmResolveCallConfig: typeof llmService?.resolveCallConfig === "function",
        systemPromptSection: typeof systemPrompt?.section === "function",
        agentScope: liveAgents().some((candidate) => scopeOfAgentContext(candidate) !== undefined),
        agentTurnStart: liveAgents().some((candidate) => typeof candidate?.followup === "function"),
        agentTurnCancel: liveAgents().some((candidate) => typeof candidate?.cancel === "function"),
        agentTurnSteer: liveAgents().some((candidate) => typeof candidate?.steer === "function"),
        agentTurnInject: liveAgents().some((candidate) => typeof candidate?.inject === "function"),
        agentPromptSection: liveAgents().some((candidate) => agentSystemPromptOf(candidate) !== undefined),
        agentPreStep: typeof ctx?.on === "function",
        team: typeof agentTeams?.tryMembership === "function" && typeof agentTeams?.listMembers === "function",
        teamTasks: TEAM_TASK_METHODS.every((method) => typeof agentTeams?.[method] === "function"),
        teamMessages: typeof agentTeams?.sendMessage === "function" && typeof agentTeams?.waitForChange === "function",
        subagentsProviderRegister: typeof subagents?.registerProvider === "function"
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
    llmCatalog,
    llmListModels(provider) {
      const llm = requireService("llm", 'cannot list the models of provider "' + provider + '"');
      if (typeof llm.listModels !== "function")
        throw new Error("mpd-dsh-adapter: the harness llm service exposes no listModels()");
      return llm.listModels.call(llm, provider);
    },
    llmResolveCallConfig(config2, signal) {
      const llm = requireService("llm", "cannot resolve a call config");
      if (typeof llm.resolveCallConfig !== "function")
        throw new Error("mpd-dsh-adapter: the harness llm service exposes no resolveCallConfig()");
      return llm.resolveCallConfig.call(llm, config2, signal);
    },
    registerHostTool(definition) {
      const tools = requireService("tools", 'cannot register host tool "' + String(definition?.name) + '"');
      if (typeof tools.register !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()");
      const registered = tools.register(definition);
      return typeof registered === "function" ? registered : noop2;
    },
    registerTool(definition) {
      const tools = requireService("tools", 'cannot register tool "' + String(definition?.name) + '"');
      if (typeof tools.register !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()");
      const output = definition.output ?? {};
      const render = typeof output.render === "function" ? output.render : (_args, value) => textBlock(value);
      const schema = output.schema ?? OBJECT_SCHEMA;
      return tools.register({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters ?? OBJECT_SCHEMA,
        output: { ...output, schema, render },
        ...definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs },
        execute: async (args, exec) => definition.execute(args ?? {}, exec ?? {})
      });
    },
    registerTools(definitions) {
      const disposers = definitions.map((definition) => adapter.registerTool(definition));
      return () => {
        for (const dispose of disposers)
          dispose();
      };
    },
    registerCommand(definition) {
      const commands = service("commands");
      if (commands === undefined || commands === null || typeof commands.register !== "function")
        return noop2;
      const registered = commands.register({
        name: definition?.name,
        description: definition?.description,
        ...definition?.input === undefined ? {} : { input: definition.input },
        handler: (invocation) => {
          const host = invocation ?? { rawInput: "" };
          return definition.handler({
            ...host,
            submit: (message2) => adapter.submitUserTurn(host.agent, message2)
          });
        }
      });
      return typeof registered === "function" ? registered : noop2;
    },
    registerPromptSection(section) {
      const systemPrompt = requireService("systemPrompt", 'cannot register prompt section "' + String(section?.name) + '"');
      if (typeof systemPrompt.section !== "function")
        throw new Error("mpd-dsh-adapter: the harness systemPrompt service exposes no section()");
      const registered = systemPrompt.section(section);
      return typeof registered === "function" ? registered : noop2;
    },
    guardTool(guard) {
      const tools = requireService("tools", "cannot install a tool guard");
      if (typeof tools.guard !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()");
      return tools.guard((exec) => guard(exec ?? {}));
    },
    onPreToolExecute(listener) {
      if (typeof ctx?.on !== "function")
        return noop2;
      return ctx.on("tools/pre-execute", async (exec, next) => {
        const downstream = typeof next === "function" ? await next() : undefined;
        try {
          listener(Object.freeze({ ...exec ?? {} }), downstream);
        } catch {}
        return downstream;
      });
    },
    onPostToolExecute(listener) {
      if (typeof ctx?.on !== "function")
        return noop2;
      return ctx.on("tools/post-execute", async (exec, result, next) => {
        const downstream = typeof next === "function" ? await next() ?? { kind: "accept" } : { kind: "accept" };
        const decided = await listener(exec ?? {}, result ?? {}, downstream);
        return decided ?? downstream;
      });
    },
    onAgentPreStep(listener) {
      if (typeof ctx?.on !== "function")
        return noop2;
      return ctx.on("agent/pre-step", async (payload, next) => {
        const fallback = { kind: "enter", messages: payload?.messages ?? [] };
        const downstream = typeof next === "function" ? await next() ?? fallback : fallback;
        try {
          const decided = await listener(payload ?? {}, downstream);
          return decided ?? downstream;
        } catch {
          return downstream;
        }
      });
    },
    hasTool(toolName) {
      const tools = service("tools");
      if (typeof tools?.get !== "function")
        return false;
      try {
        return tools.get(toolName) !== undefined;
      } catch {
        return false;
      }
    },
    toolRuntime() {
      const tools = service("tools");
      return {
        get: (toolName) => typeof tools?.get === "function" ? tools.get(toolName) : undefined,
        execute: (input) => adapter.executeTool({ ...input, timeoutMs: defaultTimeoutMs }).then((result) => result.raw)
      };
    },
    async executeTool(input) {
      const tools = service("tools");
      if (tools === undefined || typeof tools.execute !== "function") {
        return { ok: false, isError: true, error: "the harness tool runtime has no execute()" };
      }
      const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10);
      const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs);
      try {
        const raw = await tools.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...signal === undefined ? {} : { signal },
          ...input.agent === undefined ? {} : { agent: input.agent }
        });
        const isError = raw?.isError === true;
        if (isError) {
          const error = raw?.error;
          return { ok: false, isError: true, error: error?.message ?? error ?? "tool error", raw };
        }
        return { ok: true, isError: false, value: raw?.value, raw };
      } catch (error) {
        return { ok: false, isError: true, error: message(error) };
      }
    },
    async spawnAgent(spec) {
      const subagents = requireService("subagents", 'cannot spawn subagent "' + String(spec?.label) + '"');
      if (typeof subagents.start !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagent service exposes no start()");
      const route = {
        ...spec.provider === undefined ? {} : { provider: spec.provider },
        ...spec.model === undefined ? {} : { model: spec.model },
        ...spec.agentOptions ?? {}
      };
      const run = await subagents.start(spec.mode ?? "spawn", {
        label: spec.label,
        prompt: typeof spec.prompt === "string" ? textBlock(spec.prompt) : spec.prompt,
        ...spec.parent === undefined ? {} : { parent: spec.parent },
        ...spec.signal === undefined ? {} : { signal: spec.signal },
        ...Object.keys(route).length === 0 ? {} : { agentOptions: route },
        ...spec.persona === undefined ? {} : { persona: spec.persona },
        ...spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema },
        ...spec.toolFilter === undefined ? {} : { toolFilter: spec.toolFilter },
        ...spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }
      });
      const result = await (run?.result ?? {});
      return {
        output: typeof result.output === "string" ? result.output : "",
        structured: result.structured,
        stopReason: result.stopReason ?? null
      };
    },
    subagentRuntime() {
      return service("subagents");
    },
    subagentProvider(name) {
      const subagents = service("subagents");
      const getProvider = subagents?.getProvider;
      if (typeof getProvider !== "function")
        return;
      return getProvider.call(subagents, name);
    },
    subagentProviders() {
      const subagents = service("subagents");
      const list = subagents?.list;
      if (typeof list !== "function")
        return [];
      const names = list.call(subagents);
      return Array.isArray(names) ? names.filter((entry) => typeof entry === "string") : [];
    },
    startContinuableAgent(spec) {
      const subagents = requireService("subagents", "cannot start a continuable agent");
      if (typeof subagents.startContinuable !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable()");
      return subagents.startContinuable.call(subagents, spec);
    },
    registerSubagentProvider(provider) {
      const subagents = requireService("subagents", "cannot register a subagent provider");
      if (typeof subagents.registerProvider !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no registerProvider()");
      const registered = subagents.registerProvider(provider);
      return typeof registered === "function" ? registered : noop2;
    },
    interruptAgent(targetSessionId, authority) {
      const subagents = requireService("subagents", 'cannot interrupt subagent session "' + String(targetSessionId) + '"');
      if (typeof subagents.interrupt !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt()");
      subagents.interrupt.call(subagents, targetSessionId, authority);
    },
    teamService() {
      const teams = service("agentTeams");
      return teams === undefined || teams === null ? undefined : teams;
    },
    teamMembership(agent) {
      const teams = service("agentTeams");
      const tryMembership = teams?.tryMembership;
      if (typeof tryMembership !== "function")
        return;
      let membership;
      try {
        membership = tryMembership.call(teams, agent);
      } catch {
        return;
      }
      if (membership === undefined || membership === null)
        return;
      const role = membership.role;
      if (role !== "lead" && role !== "teammate")
        return;
      return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") };
    },
    teamListMembers(agent) {
      const teams = requireService("agentTeams", "cannot list the team roster of an agent");
      if (typeof teams.listMembers !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listMembers()");
      const rows = teams.listMembers.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamMemberView) : [];
    },
    teamListTasks(agent) {
      const teams = requireService("agentTeams", "cannot list the shared task board of an agent");
      if (typeof teams.listTasks !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listTasks()");
      const rows = teams.listTasks.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamTaskView) : [];
    },
    async teamCreateTask(caller, request) {
      const teams = requireService("agentTeams", 'cannot create team task "' + String(request?.subject) + '"');
      if (typeof teams.createTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no createTask()");
      return teamTaskView(await teams.createTask.call(teams, caller, request));
    },
    teamGetTask(caller, id) {
      const teams = requireService("agentTeams", 'cannot read team task "' + String(id) + '"');
      if (typeof teams.getTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no getTask()");
      return teamTaskView(teams.getTask.call(teams, caller, id));
    },
    async teamUpdateTask(caller, request) {
      const teams = requireService("agentTeams", 'cannot update team task "' + String(request?.taskId) + '"');
      if (typeof teams.updateTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no updateTask()");
      return teamTaskView(await teams.updateTask.call(teams, caller, request));
    },
    async teamSendMessage(caller, request) {
      const teams = requireService("agentTeams", 'cannot send a team message to "' + String(request?.target) + '"');
      if (typeof teams.sendMessage !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no sendMessage()");
      const result = await teams.sendMessage.call(teams, caller, request);
      return {
        messageId: String(result?.messageId ?? ""),
        status: result?.status === "queued" ? "queued" : "accepted"
      };
    },
    async teamSpawnTeammate(caller, request) {
      const teams = requireService("agentTeams", 'cannot spawn team member "' + String(request?.name) + '"');
      if (typeof teams.spawnTeammate !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no spawnTeammate()");
      const result = await teams.spawnTeammate.call(teams, caller, request);
      return { member: teamMemberView(result?.member) };
    },
    teamInterrupt(caller, targetName) {
      const teams = requireService("agentTeams", 'cannot interrupt team member "' + String(targetName) + '"');
      if (typeof teams.interrupt !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no interrupt()");
      const result = teams.interrupt.call(teams, caller, targetName);
      return { previousStatus: result?.previousStatus === "running" ? "running" : "inactive" };
    },
    async teamWaitForChange(caller, timeoutMs, signal) {
      const teams = requireService("agentTeams", "cannot wait for team activity");
      if (typeof teams.waitForChange !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no waitForChange()");
      const result = await teams.waitForChange.call(teams, caller, timeoutMs, signal);
      return { timedOut: result?.timedOut === true };
    },
    teamLiveTeams() {
      const teams = service("agentTeams");
      if (teams === undefined || teams === null || typeof teams.tryMembership !== "function")
        return [];
      if (typeof service("agents")?.list !== "function")
        return [];
      const views = [];
      for (const agent of liveAgents()) {
        let membership;
        try {
          membership = teams.tryMembership.call(teams, agent);
        } catch {
          continue;
        }
        if (membership?.role !== "lead")
          continue;
        views.push({
          teamId: String(membership.id ?? ""),
          leadName: String(membership.name ?? ""),
          leadSessionId: String(agent?.id ?? ""),
          members: teamRows(teams, "listMembers", agent, teamMemberView),
          tasks: teamRows(teams, "listTasks", agent, teamTaskView)
        });
      }
      return views;
    },
    registerSkillProvider(provider) {
      const skills = requireService("skills", "cannot register a skill provider");
      if (typeof skills.registerProvider !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no registerProvider()");
      return skills.registerProvider(provider);
    },
    async listSkills(options = {}) {
      const skills = requireService("skills", "cannot list skills");
      if (typeof skills.list !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no list()");
      return await skills.list(options) ?? [];
    },
    async loadSkill(skillName, options = {}) {
      const skills = requireService("skills", 'cannot load skill "' + skillName + '"');
      if (typeof skills.get !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no get()");
      return skills.get(skillName, options);
    },
    async resolvePreset(presetId) {
      const presets = requireService("agentPresets", 'cannot resolve preset "' + presetId + '"');
      if (typeof presets.resolve !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentPresets service exposes no resolve()");
      const preset = await presets.resolve(presetId);
      return {
        id: String(preset?.id ?? presetId),
        ...preset?.path === undefined ? {} : { path: String(preset.path) },
        ...preset?.trust === undefined ? {} : { trust: String(preset.trust) },
        ...preset?.broken === undefined ? {} : { broken: String(preset.broken) }
      };
    },
    settingsReader(namespace) {
      const settings = service("settings");
      if (settings === undefined || settings === null)
        return;
      return {
        get() {
          try {
            return typeof settings.get === "function" ? settings.get(namespace) : undefined;
          } catch {
            return;
          }
        },
        describe() {
          try {
            if (typeof settings.describe !== "function")
              return;
            const list = settings.describe();
            if (!Array.isArray(list))
              return;
            const found = list.find((entry) => entry?.ns === namespace);
            if (found === undefined)
              return;
            return {
              value: found.value,
              revision: typeof found.revision === "number" ? found.revision : undefined,
              user: found.user,
              base: found.base,
              applies: typeof found.applies === "string" ? found.applies : undefined
            };
          } catch {
            return;
          }
        }
      };
    },
    onSettingsDocumentUpdated(namespace, listener) {
      let pendingRevision;
      let pendingSource;
      let hasPending = false;
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        if (!hasPending)
          return;
        const revision = pendingRevision;
        const source = pendingSource;
        pendingRevision = undefined;
        pendingSource = undefined;
        hasPending = false;
        try {
          listener(revision, source);
        } catch {}
      };
      const offUpdated = adapter.onEvent("settings/updated", (ns, _next, _prev, from) => {
        if (String(ns) !== namespace)
          return;
        pendingSource = from === undefined ? undefined : String(from);
        return;
      });
      const offDocument = adapter.onEvent("settings/document-updated", (ns, revision) => {
        if (String(ns) !== namespace)
          return;
        pendingRevision = typeof revision === "number" ? revision : undefined;
        hasPending = true;
        if (!scheduled) {
          scheduled = true;
          Promise.resolve().then(flush);
        }
        return;
      });
      return () => {
        try {
          offUpdated?.();
        } catch {}
        try {
          offDocument?.();
        } catch {}
      };
    },
    whenSettingsAvailable(callback) {
      if (typeof ctx?.inject !== "function") {
        try {
          callback();
        } catch {}
        return;
      }
      try {
        ctx.inject(["settings"], () => {
          try {
            callback();
          } catch {}
        });
      } catch {}
    },
    settingsRegister(namespace, schema, options) {
      const settings = service("settings");
      if (settings === undefined || settings === null || typeof settings.register !== "function") {
        return { ok: false, error: "settings service is unavailable" };
      }
      try {
        settings.register(namespace, schema, { ...options?.base === undefined ? {} : { base: options.base }, ...options?.applies === undefined ? {} : { applies: options.applies } });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    async settingsMutate(namespace, ops, expectedRevision) {
      const settings = service("settings");
      if (settings === undefined || settings === null || typeof settings.mutate !== "function") {
        return { ok: false, error: "settings service is unavailable" };
      }
      try {
        await settings.mutate(namespace, ops.map((op) => op.op === "unset" ? { op: "unset", path: [...op.path] } : { op: "set", path: [...op.path], value: op.value }), expectedRevision);
        return { ok: true };
      } catch (error) {
        const name = String(error?.name ?? "");
        const conflict = name === "SettingsConflictError" || /conflict/i.test(String(error?.message ?? ""));
        return { ok: false, error: String(error?.message ?? error), ...conflict ? { conflict: true } : {} };
      }
    },
    text: textBlock,
    userMessage,
    agentScope(agent) {
      return scopeOfAgentContext(agent);
    },
    agentPromptSection(agent, section) {
      const systemPrompt = agentSystemPromptOf(agent);
      if (systemPrompt === undefined) {
        throw new Error(`mpd-dsh-adapter: the agent's own scope exposes no systemPrompt.section() — cannot register prompt section "` + String(section?.name) + '" for it');
      }
      const registered = systemPrompt.section(section);
      return typeof registered === "function" ? registered : noop2;
    },
    startAgentTurn(agent, message2) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn");
      followup.call(agent, message2);
    },
    cancelAgentTurn(agent, cause, options) {
      const cancel = agent?.cancel;
      if (typeof cancel !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn");
      cancel.call(agent, cause, options);
    },
    steerAgentTurn(agent, message2) {
      const steer = agent?.steer;
      if (typeof steer !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn");
      steer.call(agent, message2);
    },
    injectAgentMessage(agent, message2) {
      const inject = agent?.inject;
      if (typeof inject !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it");
      inject.call(agent, message2);
    },
    submitUserTurn(agent, message2) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        return false;
      try {
        followup.call(agent, message2);
        return true;
      } catch {
        return false;
      }
    }
  };
  return adapter;
}

// packages/mpd-team-watchdog-plugin/src/actions.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { join as join3 } from "node:path";

// packages/mpd-team-watchdog-plugin/src/paths.ts
import { createHash } from "node:crypto";
import { join } from "node:path";
var DEFAULT_STATE_DIR = join(".mpd", "team");
var WATCHDOG_DIR = "watchdog";
var DEFAULT_KEEP_GENERATIONS = 3;
function safeSegment(value) {
  const text = String(value ?? "");
  const cleaned = text.normalize("NFC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  if (cleaned === "")
    return "k-" + digest(text);
  const points = [...cleaned];
  if (points.length > 48)
    return points.slice(0, 48).join("") + "-" + digest(text);
  return cleaned;
}
function digest(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}
function stateRoot(workspace, stateDir = DEFAULT_STATE_DIR) {
  return join(workspace, stateDir);
}
function watchdogRoot(workspace, stateDir = DEFAULT_STATE_DIR) {
  return join(stateRoot(workspace, stateDir), WATCHDOG_DIR);
}
function heartbeatDir(workspace, stateDir = DEFAULT_STATE_DIR) {
  return join(watchdogRoot(workspace, stateDir), "heartbeat");
}
function heartbeatPath(workspace, stateDir, memberKey) {
  return join(heartbeatDir(workspace, stateDir), safeSegment(memberKey) + ".jsonl");
}
function sceneDir(workspace, stateDir, teamId) {
  return join(watchdogRoot(workspace, stateDir), "scene", safeSegment(teamId));
}
function holdDir(workspace, stateDir = DEFAULT_STATE_DIR) {
  return join(watchdogRoot(workspace, stateDir), "hold");
}
function holdPath(workspace, stateDir, teamId) {
  return join(holdDir(workspace, stateDir), safeSegment(teamId) + ".json");
}
function incidentsPath(workspace, stateDir = DEFAULT_STATE_DIR) {
  return join(watchdogRoot(workspace, stateDir), "incidents.jsonl");
}
function watermarkPath(workspace, stateDir = DEFAULT_STATE_DIR) {
  return join(watchdogRoot(workspace, stateDir), "read-watermark.json");
}

// packages/mpd-team-watchdog-plugin/src/sidecars.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync } from "node:fs";
import { dirname as dirname2 } from "node:path";

// packages/mpd-team-watchdog-plugin/src/store.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join as join2 } from "node:path";
function appendHeartbeat(workspace, stateDir, memberKey, stamp) {
  const path = heartbeatPath(workspace, stateDir, memberKey);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(stamp) + `
`, "utf8");
    return { ok: true, path };
  } catch (error) {
    return { ok: false, path, error: message2(error) };
  }
}
function readHeartbeats(workspace, stateDir, memberKey) {
  const path = heartbeatPath(workspace, stateDir, memberKey);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const stamps = [];
  for (const line of text.split(`
`)) {
    const trimmed = line.trim();
    if (trimmed === "")
      continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && typeof parsed.at === "number")
        stamps.push(parsed);
    } catch {}
  }
  return stamps;
}
function listHeartbeatKeys(workspace, stateDir) {
  const dir = heartbeatDir(workspace, stateDir);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith(".jsonl")).map((name) => name.slice(0, -".jsonl".length)).sort();
}
function newestOverall(stamps) {
  let newest;
  for (const stamp of stamps) {
    if (newest === undefined || stamp.at >= newest.at)
      newest = stamp;
  }
  return newest;
}
function rotateHeartbeats(workspace, stateDir, memberKey, keep = DEFAULT_KEEP_GENERATIONS) {
  const path = heartbeatPath(workspace, stateDir, memberKey);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { rotated: false, before: 0, after: 0, path };
  }
  const lines = text.split(`
`).filter((line) => line.trim() !== "");
  const teamOfLine = (line) => {
    try {
      const parsed = JSON.parse(line);
      const team = parsed?.teamId;
      return team === undefined || team === null || team === "" ? "\x00no-team" : String(team);
    } catch {
      return "\x00unparseable";
    }
  };
  const groups = new Map;
  for (let index = 0;index < lines.length; index += 1) {
    const key = teamOfLine(lines[index]);
    const bucket = groups.get(key);
    if (bucket === undefined)
      groups.set(key, [index]);
    else
      bucket.push(index);
  }
  const dropped = new Set;
  for (const indices of groups.values()) {
    const starts = [];
    for (const index of indices) {
      try {
        const parsed = JSON.parse(lines[index]);
        if (parsed?.kind === "turn-start")
          starts.push(index);
      } catch {}
    }
    if (starts.length <= keep)
      continue;
    const cut = starts[starts.length - keep];
    for (const index of indices)
      if (index < cut)
        dropped.add(index);
  }
  if (dropped.size === 0)
    return { rotated: false, before: lines.length, after: lines.length, path };
  const kept = lines.filter((_line, index) => !dropped.has(index));
  try {
    writeFileSync(path, kept.join(`
`) + `
`, "utf8");
    return { rotated: true, before: lines.length, after: kept.length, path };
  } catch {
    return { rotated: false, before: lines.length, after: lines.length, path };
  }
}
function writeFileAtomic(path, text) {
  try {
    if (existsSync(path)) {
      let current;
      try {
        current = readFileSync(path, "utf8");
      } catch {
        current = undefined;
      }
      if (current === text)
        return { changed: false, path };
    }
    mkdirSync(dirname(path), { recursive: true });
    const temp = join2(dirname(path), "." + basename(path) + ".tmp-" + process.pid);
    writeFileSync(temp, text, "utf8");
    renameSync(temp, path);
    return { changed: true, path };
  } catch (error) {
    return { changed: false, path, error: message2(error) };
  }
}
function message2(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-team-watchdog-plugin/src/sidecars.ts
function readHold(workspace, stateDir, teamId) {
  let text;
  try {
    text = readFileSync2(holdPath(workspace, stateDir, teamId), "utf8");
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || typeof parsed.id !== "string")
      return;
    return { ...parsed, ttlMs: typeof parsed.ttlMs === "number" && Number.isFinite(parsed.ttlMs) ? parsed.ttlMs : 0 };
  } catch {
    return;
  }
}
function writeHold(workspace, stateDir, hold) {
  const path = holdPath(workspace, stateDir, hold.teamId);
  const written = writeFileAtomic(path, JSON.stringify(hold, null, 2) + `
`);
  if (written.error !== undefined)
    return { ok: false, changed: false, path, error: written.error };
  return { ok: true, changed: written.changed, path };
}
function clearHold(workspace, stateDir, teamId) {
  const path = holdPath(workspace, stateDir, teamId);
  let cleared = false;
  try {
    if (existsSync2(path)) {
      rmSync(path);
      cleared = true;
    }
  } catch {}
  return { cleared, path };
}
function appendIncident(workspace, stateDir, incident) {
  const path = incidentsPath(workspace, stateDir);
  try {
    mkdirSync2(dirname2(path), { recursive: true });
    appendFileSync2(path, JSON.stringify(incident) + `
`, "utf8");
    return { ok: true, path };
  } catch (error) {
    return { ok: false, path, error: message2(error) };
  }
}
function readIncidents(workspace, stateDir) {
  let text;
  try {
    text = readFileSync2(incidentsPath(workspace, stateDir), "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const raw of text.split(`
`)) {
    const line = raw.trim();
    if (line === "")
      continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && typeof parsed.id === "string")
        records.push(parsed);
    } catch {}
  }
  return records;
}
function readWatermarks(workspace, stateDir) {
  let text;
  try {
    text = readFileSync2(watermarkPath(workspace, stateDir), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object")
      return {};
    const out = {};
    for (const [reader, value] of Object.entries(parsed))
      if (typeof value === "number")
        out[reader] = value;
    return out;
  } catch {
    return {};
  }
}
function ackIncidents(workspace, stateDir, reader, upTo) {
  const current = readWatermarks(workspace, stateDir);
  const next = Math.max(current[reader] ?? 0, upTo);
  const path = watermarkPath(workspace, stateDir);
  const written = writeFileAtomic(path, JSON.stringify({ ...current, [reader]: next }, null, 2) + `
`);
  if (written.error !== undefined)
    return { ok: false, watermark: current[reader] ?? 0, path, error: written.error };
  return { ok: true, watermark: next, path };
}

// packages/mpd-team-watchdog-plugin/src/team.ts
var TERMINAL_STATUSES = ["completed", "deleted", "failed", "cancelled"];
var CAPTAIN_KEY = "captain";
var OFFICIAL_LEAD_NAME = "lead";
function agentIds(agent) {
  const candidate = agent ?? {};
  const id = typeof candidate.id === "string" ? candidate.id : "";
  const sessionId = typeof candidate.session?.id === "string" ? candidate.session.id : "";
  const cwd = typeof candidate.session?.header?.cwd === "string" ? candidate.session.header.cwd : undefined;
  return { agentId: id, sessionId, cwd };
}
function isWatchedTeam(view) {
  const members = Array.isArray(view.members) ? view.members : [];
  if (members.some((member) => member.role === "teammate"))
    return true;
  return Array.isArray(view.tasks) && view.tasks.length > 0;
}
function generationToken(task) {
  return typeof task.revision === "number" && Number.isFinite(task.revision) ? String(task.revision) : undefined;
}
function leadRow(members) {
  return members.find((member) => member.role === "lead");
}
function projectTeamView(view) {
  const rawMembers = (Array.isArray(view.members) ? view.members : []).filter((member) => member !== null && typeof member === "object");
  const lead = leadRow(rawMembers);
  const teammates = rawMembers.filter((member) => member.role !== "lead");
  const rawTasks = (Array.isArray(view.tasks) ? view.tasks : []).filter((task) => task !== null && typeof task === "object");
  const tasks = rawTasks.map((task) => {
    const owner = typeof task.ownerName === "string" && task.ownerName !== "" ? task.ownerName : undefined;
    const assignee = owner === OFFICIAL_LEAD_NAME ? CAPTAIN_KEY : owner;
    const token = generationToken(task);
    return {
      id: String(task.id ?? ""),
      status: String(task.status ?? ""),
      ...assignee === undefined ? {} : { assignee },
      ...typeof task.revision === "number" && Number.isFinite(task.revision) ? { attempt: task.revision } : {},
      ...token === undefined ? {} : { attemptId: token },
      ...owner === undefined ? {} : { dispatched: true },
      ...Array.isArray(task.blockedBy) ? { dependencies: task.blockedBy.filter((id) => typeof id === "string") } : {}
    };
  });
  const running = teammates.some((member) => member.status === "running" || member.status === "provisioning");
  return {
    id: String(view.teamId ?? ""),
    name: String(lead?.name ?? view.leadName ?? ""),
    phase: running ? "active" : "idle",
    ...typeof view.leadSessionId === "string" && view.leadSessionId !== "" ? { captainSessionId: view.leadSessionId } : {},
    members: teammates.map((member) => ({
      id: String(member.id ?? ""),
      name: String(member.name ?? ""),
      ...typeof member.status === "string" ? { status: member.status } : {}
    })),
    tasks,
    activityAt: null,
    createdAt: null,
    approvedAt: null,
    raw: view
  };
}
function readTeams(dsh) {
  let views;
  try {
    views = dsh.teamLiveTeams() ?? [];
  } catch {
    return [];
  }
  return views.filter(isWatchedTeam).map(projectTeamView);
}
function readTeam(dsh, teamId) {
  const wanted = String(teamId);
  return readTeams(dsh).find((team) => team.id === wanted);
}
function listTeamIds(dsh) {
  return readTeams(dsh).map((team) => team.id).sort();
}
function liveTasks(team) {
  return team.tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status));
}
function dependencyBlocked(team, assignee) {
  const owned = liveTasks(team).filter((task) => task.assignee === assignee);
  if (owned.length === 0)
    return { blocked: false, waiting: [] };
  const waiting = [];
  const blocked = owned.every((task) => {
    const deps = task.dependencies ?? [];
    const unfinished = deps.filter((id) => {
      const target = team.tasks.find((candidate) => candidate.id === id);
      return target === undefined || !TERMINAL_STATUSES.includes(target.status);
    });
    waiting.push(...unfinished);
    return unfinished.length > 0;
  });
  return { blocked, waiting: [...new Set(waiting)].sort() };
}
function currentTask(team, assignee) {
  const owned = liveTasks(team).filter((task) => task.assignee === assignee);
  if (owned.length === 0)
    return;
  for (const status of ["in_progress", "claimed", "pending"]) {
    const found = owned.filter((task) => task.status === status);
    if (found.length > 0)
      return found[found.length - 1];
  }
  return owned[owned.length - 1];
}
function resolveIdentity(team, agent) {
  const ids = agentIds(agent);
  if (team === undefined)
    return { member: null, isCaptain: false, ...ids };
  if (ids.sessionId !== "" && team.captainSessionId === ids.sessionId) {
    return { member: CAPTAIN_KEY, isCaptain: true, ...ids };
  }
  const byAgent = team.members.find((entry) => entry.id !== "" && entry.id === ids.agentId);
  if (byAgent !== undefined)
    return { member: byAgent.name, isCaptain: false, ...ids };
  return { member: null, isCaptain: false, ...ids };
}
function teamOf(teams, agent) {
  for (const team of teams) {
    const identity = resolveIdentity(team, agent);
    if (identity.member !== null)
      return team;
  }
  return;
}

// packages/mpd-team-watchdog-plugin/src/actions.ts
var HOLD_TOOL = "session-watchdog-hold";
var RESUME_TOOL = "session-watchdog-resume";
var STATUS_TOOL = "session-watchdog-status";
function applyHold(workspace, stateDir, args, registry, defaultTtlMs = 0) {
  const teamId = String(args.team_id ?? "").trim();
  if (teamId === "")
    return { applied: false, error: "team_id is required", path: holdPath(workspace, stateDir, "") };
  const existing = readHold(workspace, stateDir, teamId);
  const hold = {
    id: existing?.id ?? randomUUID2(),
    teamId,
    since: existing?.since ?? Date.now(),
    cause: args.cause ?? existing?.cause ?? "silence",
    taskId: args.task_id ?? existing?.taskId ?? null,
    attemptId: args.attempt_id ?? existing?.attemptId ?? null,
    sceneAt: args.scene_at ?? existing?.sceneAt ?? 0,
    ttlMs: typeof args.ttl_ms === "number" && Number.isFinite(args.ttl_ms) && args.ttl_ms >= 0 ? args.ttl_ms : existing?.ttlMs ?? defaultTtlMs
  };
  const written = writeHold(workspace, stateDir, hold);
  if (!written.ok)
    return { applied: false, error: written.error, path: written.path };
  registry?.record(workspace, hold);
  return { applied: true, hold, path: written.path, changed: written.changed };
}
function applyResume(workspace, stateDir, args, registry) {
  const teamId = String(args.team_id ?? "").trim();
  if (teamId === "")
    return { resumed: false, reason: "team_id is required", path: holdPath(workspace, stateDir, "") };
  const hold = readHold(workspace, stateDir, teamId);
  if (hold === undefined)
    return { resumed: false, reason: "not-held", path: holdPath(workspace, stateDir, teamId) };
  const cleared = clearHold(workspace, stateDir, teamId);
  const stillHeld = readHold(workspace, stateDir, teamId);
  if (stillHeld !== undefined) {
    return { resumed: false, reason: "hold could not be cleared", hold, path: cleared.path };
  }
  registry?.forget(workspace, teamId);
  return { resumed: true, hold, path: cleared.path };
}
function registerWatchdogActions(dsh, stateDir, registry, surfaces = {}) {
  const predicateSource = surfaces.predicate;
  dsh.registerTool({
    name: HOLD_TOOL,
    description: "Persist the team watchdog's PRESERVING hold for one team. It is the ONLY pause this bundle implements (the official Agent Teams service exposes no halt), and it stops NEW dispatch into that team without cancelling anything: every non-terminal task keeps its status, owner and revision. Returns applied:false (never a throw) when the hold could not be written, so a caller must not report a pause that did not land.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "The team to hold." },
        task_id: { type: "string", description: "The task whose silence caused the hold." },
        attempt_id: { type: "string", description: "That task's attempt id at escalation time." },
        cause: { type: "string", description: "Why the hold was raised (default: silence)." },
        scene_at: { type: "number", description: "Epoch ms of the scene written for this escalation." },
        ttl_ms: {
          type: "number",
          description: "T-17: auto-release bound in ms. Omitted, the resolved watchdog.holdTtlMs applies; 0 means no TTL (only the activity path can release it). Both paths append a hold-auto-released incident."
        }
      },
      required: ["team_id"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { applied: { type: "boolean" }, hold: { type: "object" }, error: { type: "string" } } },
      render: (_args, raw) => {
        const value = raw ?? {};
        return value.applied ? [{ type: "text", text: "watchdog hold applied for " + String(value.hold?.teamId) + " (since " + String(value.hold?.since) + ")" }] : [{ type: "text", text: "watchdog hold NOT applied: " + String(value.error ?? "unknown error") }];
      }
    },
    execute: (args, exec) => {
      const workspace = dsh.workspaceRoot(exec);
      let fallbackTtl = 0;
      try {
        fallbackTtl = surfaces.holdTtlMs?.() ?? 0;
      } catch {
        fallbackTtl = 0;
      }
      return applyHold(workspace, stateDir, args ?? {}, registry, fallbackTtl);
    }
  });
  dsh.registerTool({
    name: RESUME_TOOL,
    description: "Clear the team watchdog's preserving hold for one team. A team that is not held is a no-op (resumed:false, reason:'not-held'), never an error; a second resume is likewise a no-op. Clearing the hold is the watchdog-side release only — the dispatch gates that honour it are wired by w7.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "The team whose internal watchdog hold to clear." } },
      required: ["team_id"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { resumed: { type: "boolean" }, reason: { type: "string" }, hold: { type: "object" } } },
      render: (_args, raw) => {
        const value = raw ?? {};
        return value.resumed ? [{ type: "text", text: "watchdog hold cleared" }] : [{ type: "text", text: "watchdog hold not cleared: " + String(value.reason ?? "unknown") }];
      }
    },
    execute: (args, exec) => {
      const workspace = dsh.workspaceRoot(exec);
      return applyResume(workspace, stateDir, args ?? {}, registry);
    }
  });
  dsh.registerTool({
    name: STATUS_TOOL,
    description: "READ-ONLY: show the team watchdog's durable store for this workspace — the hold per team, the heartbeat tails, the incident log, the per-reader watermark, (contract §4) which PREDICATE is running (`channel` = the session/event four-state fold, `heartbeat` = the report-only degradation which can never hold or escalate), (§7.2) the per-knob LIVE vs FILE value with a restartRequired flag (T-18: a `.mpd/mpd.jsonc` edit is applied LIVE once this process has observed it), and the ONE pause state per team: the watchdog's preserving hold, which is the only pause mechanism this bundle has (the official Agent Teams service exposes no halt). Team rows come from the live OFFICIAL readout (`dsh.teamLiveTeams()`), so a team appears here exactly while one of its sessions is live. Use it to inspect what a lane or a restarting process would read from disk.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "Limit to one team." } },
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          paths: { type: "object" },
          predicate: { type: "object" },
          knobs: { type: "object" },
          teams: { type: "array", items: { type: "object" } }
        }
      },
      render: (_args, raw) => {
        const value = raw ?? {};
        const lines = [];
        const predicate = value.predicate;
        lines.push(predicate === undefined ? "predicate: channel (unknown to this renderer)" : "predicate: " + predicate.source + " — " + predicate.reason);
        const knobs = value.knobs;
        if (knobs !== undefined) {
          lines.push("knobs (live" + (knobs.fileFound ? " vs " + String(knobs.file) : ", no " + String(knobs.file)) + "): " + knobs.readings.map((reading) => reading.file === undefined || !reading.differs ? reading.knob + "=" + String(reading.live) : reading.knob + "=" + String(reading.live) + " (file " + String(reading.file) + ", restartRequired)").join(" | ") + (knobs.fileApplied ? "  ✔ the file layer is applied LIVE (T-18)" : "") + (knobs.restartRequired ? "  ⟵ a .mpd/mpd.jsonc edit is waiting for the next dsh boot" : ""));
        }
        for (const team of value.teams) {
          const pause = team.pause;
          if (pause?.paused === true) {
            lines.push(team.teamId + ": PAUSED — the watchdog's preserving hold (the only pause mechanism; the official team service exposes no halt)");
          } else
            lines.push(team.teamId + ": not paused");
        }
        return [{ type: "text", text: lines.join(`
`) }];
      }
    },
    execute: (args, exec) => {
      const workspace = dsh.workspaceRoot(exec);
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(dsh) : [args.team_id];
      return {
        workspace,
        predicate: predicateSource?.() ?? { source: "unknown", reason: "the engine did not publish a predicate source", enrichment: false, events: 0, sessions: 0, states: {}, announced: false },
        knobs: surfaces.knobs?.() ?? { readings: [], divergent: [], restartRequired: false, file: null, fileFound: false, fileApplied: false, liveLayer: "namespace" },
        paths: {
          heartbeat: heartbeatDir(workspace, stateDir),
          hold: join3(workspace, stateDir, "watchdog", "hold"),
          incidents: incidentsPath(workspace, stateDir),
          watermark: watermarkPath(workspace, stateDir)
        },
        teams: ids.map((teamId) => {
          const hold = readHold(workspace, stateDir, teamId);
          const team = readTeam(dsh, teamId);
          const held = hold !== undefined;
          const pause = {
            paused: held,
            mechanism: "watchdog-hold",
            implementation: held ? "watchdog-hold" : "none",
            halted: false,
            held
          };
          return {
            teamId,
            held: hold !== undefined,
            hold: hold ?? null,
            phase: team?.phase ?? null,
            halted: false,
            halt: { halted: false, haltedAt: null },
            pause,
            heartbeatKeys: listHeartbeatKeys(workspace, stateDir),
            heartbeatTails: Object.fromEntries(listHeartbeatKeys(workspace, stateDir).map((key) => {
              const stamps = readHeartbeats(workspace, stateDir, key);
              return [key, { count: stamps.length, newest: newestOverall(stamps) ?? null }];
            })),
            incidents: readIncidents(workspace, stateDir).filter((record) => record.teamId === teamId),
            watermarks: readWatermarks(workspace, stateDir),
            isHeld: registry?.isHeld(teamId, workspace) ?? null
          };
        })
      };
    }
  });
}

// packages/mpd-team-watchdog-plugin/src/channel.ts
function stepKey(turn, step) {
  return String(turn) + "/" + String(step);
}
function asRecord(value) {
  return value !== null && typeof value === "object" ? value : null;
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function eventTypeOf(event) {
  return asString(asRecord(event)?.type);
}
function dataOf(event) {
  return asRecord(asRecord(event)?.data) ?? {};
}
function eventTimeOf(event) {
  const record = asRecord(event);
  return asNumber(record?.time) ?? asNumber(dataOf(event).time);
}
function callIdOf(event) {
  const data = dataOf(event);
  const message3 = asRecord(data.message);
  const content = Array.isArray(message3?.content) ? message3?.content : [];
  const first = asRecord(content[0]);
  return asString(data.callId) ?? asString(data.toolCallId) ?? asString(first?.toolCallId) ?? asString(message3?.toolCallId) ?? asString(message3?.callId);
}
function toolNameOf(event) {
  const data = dataOf(event);
  return asString(data.name) ?? asString(asRecord(data.message)?.name);
}

class ChannelFold {
  folds = new Map;
  applied = 0;
  unattributed = 0;
  apply(sessionId, event) {
    const id = asString(sessionId);
    if (id === null) {
      this.unattributed += 1;
      return null;
    }
    const fold = this.foldOf(id);
    this.applied += 1;
    const type = eventTypeOf(event);
    const at = eventTimeOf(event);
    fold.events += 1;
    if (type !== null)
      fold.lastEventType = type;
    if (at !== null)
      fold.lastEventAt = at;
    if (type === null)
      return this.view(id);
    const data = dataOf(event);
    const turn = asNumber(data.turn);
    const step = asNumber(data.step);
    const time = at ?? 0;
    try {
      switch (type) {
        case "turn/start": {
          fold.openTurn = turn;
          fold.openStep = null;
          break;
        }
        case "turn/end": {
          if (fold.openTurn === null || turn === null || turn === fold.openTurn) {
            fold.openTurn = null;
            fold.openStep = null;
          }
          break;
        }
        case "step/start": {
          if (turn !== null && step !== null)
            fold.openStep = { turn, step, at: time };
          break;
        }
        case "step/end": {
          if (fold.openStep !== null && (turn === null || turn === fold.openStep.turn && step === fold.openStep.step)) {
            fold.openStep = null;
          }
          break;
        }
        case "assistant/message":
        case "assistant/attempt": {
          const key = turn !== null && step !== null ? stepKey(turn, step) : fold.openStep === null ? null : stepKey(fold.openStep.turn, fold.openStep.step);
          if (key !== null) {
            fold.answered.set(key, time);
            fold.streaming.delete(key);
          }
          break;
        }
        case "tool/call": {
          const callId = callIdOf(event);
          if (callId !== null)
            fold.openCalls.set(callId, { since: time, tool: toolNameOf(event) });
          break;
        }
        case "tool/result": {
          const callId = callIdOf(event);
          if (callId !== null)
            fold.openCalls.delete(callId);
          else
            this.completeOldest(fold);
          break;
        }
        default:
          break;
      }
    } catch {}
    return this.view(id);
  }
  noteStreamFrame(sessionId, frame) {
    const id = asString(sessionId);
    if (id === null) {
      this.unattributed += 1;
      return false;
    }
    const fold = this.folds.get(id);
    if (fold === undefined)
      return false;
    const record = asRecord(frame);
    const type = asString(record?.type);
    const turn = asNumber(record?.turn) ?? fold.openStep?.turn ?? null;
    const step = asNumber(record?.step) ?? fold.openStep?.step ?? null;
    if (turn === null || step === null)
      return false;
    const key = stepKey(turn, step);
    if (type === "start") {
      fold.streaming.set(key, asNumber(record?.time) ?? fold.lastEventAt ?? 0);
      return true;
    }
    if (type === "end" || type === "settled")
      fold.streaming.delete(key);
    return false;
  }
  has(sessionId) {
    const fold = this.folds.get(sessionId);
    return fold !== undefined && fold.events > 0;
  }
  view(sessionId) {
    const id = asString(sessionId);
    if (id === null)
      return null;
    const fold = this.folds.get(id);
    if (fold === undefined || fold.events === 0)
      return null;
    let state;
    let outstandingSince = null;
    let inFlightSince = null;
    let inFlightTool = null;
    if (fold.openTurn === null) {
      state = "PARKED";
    } else if (fold.openStep === null) {
      state = "ALIVE";
    } else {
      const key = stepKey(fold.openStep.turn, fold.openStep.step);
      const answered = fold.answered.has(key);
      const streaming = fold.streaming.has(key);
      if (!answered && !streaming) {
        state = "OUTSTANDING";
        outstandingSince = fold.openStep.at;
      } else if (fold.openCalls.size > 0) {
        state = "IN-FLIGHT";
        let oldest = null;
        for (const call of fold.openCalls.values())
          if (oldest === null || call.since < oldest.since)
            oldest = call;
        inFlightSince = oldest === null ? null : oldest.since;
        inFlightTool = oldest === null ? null : oldest.tool;
      } else {
        state = "ALIVE";
      }
    }
    return {
      state,
      outstandingSince,
      inFlightSince,
      inFlightTool,
      turn: fold.openStep?.turn ?? fold.openTurn,
      step: fold.openStep?.step ?? null,
      lastEventAt: fold.lastEventAt,
      lastEventType: fold.lastEventType,
      events: fold.events,
      firstToken: state === "OUTSTANDING" ? false : state === "ALIVE" || state === "IN-FLIGHT"
    };
  }
  sessions() {
    return [...this.folds.keys()].sort();
  }
  snapshot() {
    const states = {};
    for (const id of this.sessions()) {
      const view = this.view(id);
      if (view !== null)
        states[id] = view.state;
    }
    return { events: this.applied, unattributed: this.unattributed, sessions: this.folds.size, states };
  }
  forget(sessionId) {
    this.folds.delete(sessionId);
  }
  foldOf(sessionId) {
    let fold = this.folds.get(sessionId);
    if (fold === undefined) {
      fold = {
        openTurn: null,
        openStep: null,
        answered: new Map,
        streaming: new Map,
        openCalls: new Map,
        lastEventAt: null,
        lastEventType: null,
        events: 0
      };
      this.folds.set(sessionId, fold);
    }
    return fold;
  }
  completeOldest(fold) {
    if (fold.openCalls.size === 0)
      return;
    let oldestId = null;
    let oldestSince = Number.POSITIVE_INFINITY;
    for (const [callId, call] of fold.openCalls) {
      if (call.since < oldestSince) {
        oldestSince = call.since;
        oldestId = callId;
      }
    }
    if (oldestId !== null)
      fold.openCalls.delete(oldestId);
  }
}

// packages/mpd-team-watchdog-plugin/src/config-file.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join4 } from "node:path";
var PROJECT_CONFIG_FILE = join4(".mpd", "mpd.jsonc");
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let index = 0;index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      out += char;
      if (escaped)
        escaped = false;
      else if (char === "\\")
        escaped = true;
      else if (char === '"')
        inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== `
`)
        index += 1;
      out += `
`;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/"))
        index += 1;
      index += 1;
      continue;
    }
    out += char;
  }
  return out;
}
function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, "$1");
}
function readWatchdogSection(workspace) {
  const path = join4(workspace, PROJECT_CONFIG_FILE);
  let text;
  try {
    text = readFileSync3(path, "utf8");
  } catch {
    return { found: false, path, section: undefined };
  }
  try {
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(text)));
    const root = parsed !== null && typeof parsed === "object" ? parsed : {};
    const section = root.watchdog;
    return {
      found: true,
      path,
      section: section !== null && typeof section === "object" ? section : undefined
    };
  } catch {
    return { found: false, path, section: undefined };
  }
}

// packages/mpd-team-watchdog-plugin/src/holds.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, readdirSync as readdirSync2, statSync } from "node:fs";
import { join as join5, resolve as resolve2 } from "node:path";
var HOLD_SERVICE = "mpdWatchdog";
function readHoldFile(workspace, stateDir, teamId) {
  let text;
  try {
    text = readFileSync4(holdPath(workspace, stateDir, teamId), "utf8");
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || typeof parsed.id !== "string")
      return;
    return parsed;
  } catch {
    return;
  }
}

class HoldRegistry {
  stateDir;
  entries = new Map;
  hydrated = new Set;
  fallbackWorkspace = null;
  constructor(stateDir, fallbackWorkspace = null) {
    this.stateDir = stateDir;
    this.fallbackWorkspace = fallbackWorkspace === null ? null : resolve2(fallbackWorkspace);
  }
  key(workspace, teamId) {
    return resolve2(workspace) + "\x00" + teamId;
  }
  hydrate(roots) {
    let loaded = 0;
    for (const root of roots) {
      if (typeof root !== "string" || root === "")
        continue;
      const workspace = resolve2(root);
      if (this.fallbackWorkspace === null)
        this.fallbackWorkspace = workspace;
      if (this.hydrated.has(workspace))
        continue;
      this.hydrated.add(workspace);
      let files;
      try {
        files = readdirSync2(holdDir(workspace, this.stateDir));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".json"))
          continue;
        const teamId = file.slice(0, -".json".length);
        const hold = readHoldFile(workspace, this.stateDir, teamId);
        if (hold === undefined)
          continue;
        this.entries.set(this.key(workspace, teamId), hold);
        loaded += 1;
      }
    }
    return loaded;
  }
  record(workspace, hold) {
    this.entries.set(this.key(workspace, hold.teamId), hold);
    this.hydrated.add(resolve2(workspace));
  }
  forget(workspace, teamId) {
    this.entries.delete(this.key(workspace, teamId));
  }
  isHeld(teamId, workspace) {
    const id = String(teamId ?? "");
    const notHeld = (from, where2 = null) => ({
      held: false,
      holdId: null,
      at: null,
      reason: null,
      taskId: null,
      attemptId: null,
      workspace: where2,
      source: from
    });
    if (id === "")
      return notHeld("none");
    const where = workspace !== undefined && workspace !== "" ? workspace : this.fallbackWorkspace;
    if (where !== null) {
      const known = this.entries.get(this.key(where, id));
      if (known !== undefined)
        return this.holdView(known, where, "memory");
      try {
        const hold = readHoldFile(where, this.stateDir, id);
        if (hold !== undefined) {
          this.entries.set(this.key(where, id), hold);
          return this.holdView(hold, where, "file");
        }
      } catch {
        return notHeld("none");
      }
      return notHeld("none", resolve2(where));
    }
    for (const [key, hold] of this.entries) {
      const [root, team] = key.split("\x00");
      if (team === id)
        return this.holdView(hold, root, "memory");
    }
    return notHeld("none");
  }
  holds(teamId, workspace) {
    return this.isHeld(teamId, workspace).held;
  }
  list() {
    const out = [];
    for (const [key, hold] of this.entries) {
      const [workspace, teamId] = key.split("\x00");
      out.push({ workspace, teamId, holdId: hold.id, since: hold.since, cause: hold.cause, taskId: hold.taskId, attemptId: hold.attemptId });
    }
    return out.sort((a, b) => (a.workspace + a.teamId).localeCompare(b.workspace + b.teamId));
  }
  hydratedRoots() {
    return [...this.hydrated].sort();
  }
  heldTeams(workspace) {
    const where = this.workspaceOf(workspace);
    if (where === null)
      return [];
    let files;
    try {
      files = readdirSync2(holdDir(where, this.stateDir));
    } catch {
      return [];
    }
    const held = [];
    for (const file of files) {
      if (!file.endsWith(".json"))
        continue;
      try {
        if (readHoldFile(where, this.stateDir, file.slice(0, -".json".length)) !== undefined)
          held.push(file.slice(0, -".json".length));
      } catch {}
    }
    return held.sort();
  }
  unread(reader, workspace) {
    const where = this.workspaceOf(workspace);
    if (where === null)
      return [];
    try {
      const watermark = readWatermarks(where, this.stateDir)[String(reader)] ?? 0;
      return readIncidents(where, this.stateDir).filter((record) => record.at > watermark);
    } catch {
      return [];
    }
  }
  acknowledge(reader, upTo, workspace) {
    const where = this.workspaceOf(workspace);
    if (where === null)
      return { ok: false, watermark: 0, error: "no workspace resolved" };
    try {
      const result = ackIncidents(where, this.stateDir, String(reader), Number(upTo));
      return result.error === undefined ? { ok: result.ok, watermark: result.watermark } : { ok: result.ok, watermark: result.watermark, error: result.error };
    } catch (error) {
      return { ok: false, watermark: 0, error: String(error?.message ?? error) };
    }
  }
  view(reader, workspace) {
    const where = this.workspaceOf(workspace);
    if (where === null)
      return { workspace: null, holds: [], unread: [] };
    return { workspace: where, holds: this.heldTeams(where), unread: this.unread(reader, where) };
  }
  workspaceOf(workspace) {
    if (typeof workspace === "string" && workspace !== "")
      return resolve2(workspace);
    return this.fallbackWorkspace;
  }
  holdView(hold, workspace, source) {
    return {
      held: true,
      holdId: hold.id,
      at: typeof hold.since === "number" ? hold.since : null,
      reason: typeof hold.cause === "string" ? hold.cause : null,
      taskId: hold.taskId ?? null,
      attemptId: hold.attemptId ?? null,
      workspace,
      source
    };
  }
}
var HOLD_GATE_CALL = 'ctx.get("mpdWatchdog", false)?.isHeld(teamId, workspace)?.held === true';
function heldTeamIds(workspace, stateDir) {
  let files;
  try {
    files = readdirSync2(holdDir(workspace, stateDir));
  } catch {
    return [];
  }
  const held = [];
  for (const file of files) {
    if (!file.endsWith(".json"))
      continue;
    const teamId = file.slice(0, -".json".length);
    try {
      if (readHoldFile(workspace, stateDir, teamId) !== undefined)
        held.push(teamId);
    } catch {}
  }
  return held.sort();
}

// packages/mpd-team-watchdog-plugin/src/machine.ts
var WATCHDOG_DEFAULTS = {
  enabled: true,
  warnSilenceMs: 600000,
  tickIntervalMs: 15000,
  warnStreakToEscalate: 6,
  actionOnEscalate: "warn-only",
  toolInFlightMaxMs: 900000,
  holdTtlMs: 900000
};
function knobReadings(live, fileSection) {
  const file = fileSection !== null && typeof fileSection === "object" ? fileSection : {};
  const knobs = ["warnSilenceMs", "tickIntervalMs", "warnStreakToEscalate", "actionOnEscalate", "toolInFlightMaxMs", "holdTtlMs", "enabled"];
  return knobs.map((knob) => {
    const liveValue = live[knob];
    const raw = file[knob];
    const fileValue = typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string" ? raw : undefined;
    const differs = fileValue !== undefined && fileValue !== liveValue;
    return { knob: String(knob), live: liveValue, file: fileValue, differs, restartRequired: differs };
  });
}
function watchdogSectionOf(namespaceValue) {
  const root = namespaceValue !== null && typeof namespaceValue === "object" ? namespaceValue : {};
  const sectionRaw = root.watchdog;
  return sectionRaw !== null && typeof sectionRaw === "object" ? sectionRaw : {};
}
function sectionDigest(section) {
  if (section === null || typeof section !== "object")
    return null;
  const record = section;
  const keys = Object.keys(record).sort();
  if (keys.length === 0)
    return null;
  const ordered = {};
  for (const key of keys)
    ordered[key] = record[key];
  return JSON.stringify(ordered);
}
function overlayWatchdogSection(namespaceValue, fileSection) {
  const base = namespaceValue !== null && typeof namespaceValue === "object" ? { ...namespaceValue } : {};
  const file = fileSection !== null && typeof fileSection === "object" ? fileSection : {};
  return { ...base, watchdog: { ...watchdogSectionOf(namespaceValue), ...file } };
}
function readKnobs(namespaceValue, env = process.env, defaults = WATCHDOG_DEFAULTS) {
  const section = watchdogSectionOf(namespaceValue);
  const issues = [];
  const number = (key, min) => {
    const raw = section[key];
    if (raw === undefined)
      return defaults[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min) {
      issues.push({ path: "watchdog." + String(key), problem: "expected a finite number >= " + min, fallback: defaults[key] });
      return defaults[key];
    }
    return raw;
  };
  const warnSilenceMs = number("warnSilenceMs", 1);
  let tickIntervalMs = number("tickIntervalMs", 1);
  if (tickIntervalMs >= warnSilenceMs) {
    const clamped = Math.max(1, Math.floor(warnSilenceMs / 3));
    issues.push({
      path: "watchdog.tickIntervalMs",
      problem: "must be < watchdog.warnSilenceMs (" + warnSilenceMs + "); clamped",
      fallback: clamped
    });
    tickIntervalMs = clamped;
  }
  let warnStreakToEscalate = number("warnStreakToEscalate", 1);
  if (!Number.isInteger(warnStreakToEscalate)) {
    const clamped = Math.max(1, Math.round(warnStreakToEscalate));
    issues.push({ path: "watchdog.warnStreakToEscalate", problem: "expected an integer; rounded", fallback: clamped });
    warnStreakToEscalate = clamped;
  }
  let actionOnEscalate = defaults.actionOnEscalate;
  if (section.actionOnEscalate !== undefined) {
    if (section.actionOnEscalate === "pause" || section.actionOnEscalate === "warn-only") {
      actionOnEscalate = section.actionOnEscalate;
    } else {
      issues.push({ path: "watchdog.actionOnEscalate", problem: "expected 'pause' | 'warn-only'", fallback: defaults.actionOnEscalate });
    }
  }
  const toolInFlightMaxMs = number("toolInFlightMaxMs", 0);
  const holdTtlMs = number("holdTtlMs", 0);
  let enabled = defaults.enabled;
  if (section.enabled !== undefined) {
    if (typeof section.enabled === "boolean")
      enabled = section.enabled;
    else {
      issues.push({ path: "watchdog.enabled", problem: "expected a boolean", fallback: defaults.enabled });
    }
  }
  if (env.MPD_DSH_TEAM_WATCHDOG === "off" || env.MPD_DSH_TEAM_WATCHDOG === "0" || env.MPD_DSH_TEAM_WATCHDOG === "false") {
    enabled = false;
  }
  return { enabled, warnSilenceMs, tickIntervalMs, warnStreakToEscalate, actionOnEscalate, toolInFlightMaxMs, holdTtlMs, issues };
}
function streakKey(teamId, taskId, attemptId) {
  return teamId + "\x00" + taskId + "\x00" + attemptId;
}

class WatchdogMachine {
  streaks = new Map;
  escalated = new Set;
  neverStarted = new Set;
  toolExpired = new Set;
  reportedFallback = new Set;
  inFlightSuppressed = 0;
  observe(candidates, now, knobs) {
    if (!knobs.enabled)
      return [];
    const decisions = [];
    for (const candidate of candidates) {
      const key = streakKey(candidate.teamId, candidate.taskId, candidate.attemptId);
      if (this.escalated.has(key))
        continue;
      const channel = candidate.channelState;
      if (channel === "ALIVE" || channel === "PARKED") {
        this.streaks.delete(key);
        continue;
      }
      if (channel === "IN-FLIGHT") {
        this.observeInFlight(candidate, key, now, knobs, decisions);
        continue;
      }
      if (channel === "OUTSTANDING") {
        const since = typeof candidate.outstandingSince === "number" ? candidate.outstandingSince : candidate.lastSeen;
        if (since === null) {
          this.streaks.delete(key);
          continue;
        }
        this.observeSilence(candidate, key, now - since, now, knobs, "silence-channel", "OUTSTANDING", false, decisions);
        continue;
      }
      if (candidate.lastKind === "turn-end") {
        this.streaks.delete(key);
        continue;
      }
      if (candidate.lastSeen === null || !candidate.everStampedForTask) {
        if (!this.neverStarted.has(key)) {
          this.neverStarted.add(key);
          decisions.push({
            type: "never-started",
            teamId: candidate.teamId,
            taskId: candidate.taskId,
            attemptId: candidate.attemptId,
            assignee: candidate.assignee,
            memberKey: candidate.memberKey
          });
        }
        this.streaks.delete(key);
        continue;
      }
      if (typeof candidate.inFlightSince === "number" && knobs.toolInFlightMaxMs > 0) {
        this.observeInFlight(candidate, key, now, knobs, decisions);
        continue;
      }
      this.observeSilence(candidate, key, now - candidate.lastSeen, now, knobs, "silence-heartbeat", null, candidate.heartbeatFallback === true, decisions);
    }
    return decisions;
  }
  observeInFlight(candidate, key, now, knobs, decisions) {
    this.streaks.delete(key);
    const since = typeof candidate.inFlightSince === "number" ? candidate.inFlightSince : typeof candidate.channelInFlightSince === "number" ? candidate.channelInFlightSince : null;
    if (since === null || knobs.toolInFlightMaxMs <= 0) {
      this.inFlightSuppressed += 1;
      return;
    }
    const inFlightMs = now - since;
    if (inFlightMs <= knobs.toolInFlightMaxMs) {
      this.inFlightSuppressed += 1;
      return;
    }
    if (this.toolExpired.has(key))
      return;
    this.toolExpired.add(key);
    decisions.push({
      type: "tool-expired",
      teamId: candidate.teamId,
      taskId: candidate.taskId,
      attemptId: candidate.attemptId,
      assignee: candidate.assignee,
      memberKey: candidate.memberKey,
      inFlightMs,
      since,
      tool: candidate.inFlightTool ?? candidate.channelInFlightTool ?? null
    });
  }
  observeSilence(candidate, key, silenceMs, now, knobs, cause, state, reportOnly, decisions) {
    if (silenceMs <= knobs.warnSilenceMs) {
      this.streaks.delete(key);
      return;
    }
    const streak = (this.streaks.get(key) ?? 0) + 1;
    this.streaks.set(key, streak);
    const base = {
      teamId: candidate.teamId,
      taskId: candidate.taskId,
      attemptId: candidate.attemptId,
      assignee: candidate.assignee,
      memberKey: candidate.memberKey,
      silenceMs,
      lastSeen: candidate.lastSeen ?? candidate.outstandingSince ?? now,
      streak,
      cause,
      state
    };
    if (streak >= knobs.warnStreakToEscalate && !reportOnly) {
      this.escalated.add(key);
      this.streaks.delete(key);
      decisions.push({ type: "escalate", ...base });
      return;
    }
    if (reportOnly) {
      if (this.reportedFallback.has(key))
        return;
      this.reportedFallback.add(key);
    }
    decisions.push({ type: "warn", ...base });
  }
  clear(teamId, taskId, attemptId) {
    const key = streakKey(teamId, taskId, attemptId);
    this.streaks.delete(key);
    this.neverStarted.delete(key);
    this.toolExpired.delete(key);
    this.reportedFallback.delete(key);
  }
  hasEscalated(teamId, taskId, attemptId) {
    return this.escalated.has(streakKey(teamId, taskId, attemptId));
  }
  snapshot() {
    return {
      streaks: Object.fromEntries(this.streaks),
      escalated: [...this.escalated].sort(),
      toolExpired: [...this.toolExpired].sort(),
      inFlightSuppressed: this.inFlightSuppressed
    };
  }
}
function inFlightFor(stamps) {
  const completed = new Set;
  const starts = [];
  for (const stamp of stamps) {
    if (stamp.kind === "tool" && typeof stamp.callId === "string" && stamp.callId !== "")
      completed.add(stamp.callId);
    if (stamp.kind === "tool-start")
      starts.push(stamp);
  }
  const pairable = starts.some((stamp) => typeof stamp.callId === "string" && stamp.callId !== "");
  if (pairable) {
    let newestStart;
    for (const stamp of starts) {
      const callId = typeof stamp.callId === "string" && stamp.callId !== "" ? stamp.callId : null;
      if (callId !== null && completed.has(callId))
        continue;
      if (newestStart === undefined || stamp.at >= newestStart.at)
        newestStart = stamp;
    }
    return newestStart === undefined ? null : { since: newestStart.at, tool: newestStart.tool ?? null };
  }
  let newest;
  for (const stamp of stamps)
    if (newest === undefined || stamp.at >= newest.at)
      newest = stamp;
  if (newest === undefined || newest.kind !== "tool-start")
    return null;
  return { since: newest.at, tool: newest.tool ?? null };
}
function generationFloorOf(team) {
  const stamps = [team.createdAt, team.approvedAt].filter((value) => typeof value === "number" && Number.isFinite(value));
  return stamps.length === 0 ? null : Math.max(...stamps);
}
function candidateFor(team, stampSource, memberKeyOf) {
  const generationFloor = generationFloorOf(team);
  const candidates = [];
  for (const task of team.tasks) {
    if (task.assignee === undefined || TERMINAL_STATUSES.includes(task.status))
      continue;
    const memberKey = memberKeyOf(task.assignee);
    const attemptId = task.attemptId ?? "";
    const stamps = stampSource(memberKey);
    const taskAttempt = task.attemptId ?? "";
    const forTask = stamps.filter((stamp) => {
      if (stamp.taskId !== task.id)
        return false;
      if (generationFloor !== null && typeof stamp.at === "number" && stamp.at < generationFloor)
        return false;
      const stampTeam = stamp.teamId;
      if (stampTeam !== undefined && stampTeam !== null && stampTeam !== "" && stampTeam !== team.id)
        return false;
      const stampAttempt = stamp.attemptId;
      if (stampAttempt === undefined || stampAttempt === null || stampAttempt === "")
        return true;
      return stampAttempt === taskAttempt;
    });
    const dispatched = task.dispatched === true || taskAttempt !== "";
    const workedOn = stamps.some((stamp) => stamp.taskId === task.id && (stamp.teamId === undefined || stamp.teamId === null || stamp.teamId === "" || stamp.teamId === team.id));
    if (!dispatched && !workedOn)
      continue;
    const newest = forTask.reduce((best, stamp) => best === undefined || stamp.at >= best.at ? stamp : best, undefined);
    const inFlight = inFlightFor(forTask);
    candidates.push({
      teamId: team.id,
      taskId: task.id,
      attemptId,
      assignee: task.assignee,
      memberKey,
      lastSeen: newest === undefined ? null : newest.at,
      lastKind: newest === undefined ? null : newest.kind,
      everStampedForTask: forTask.length > 0,
      inFlightSince: inFlight === null ? null : inFlight.since,
      inFlightTool: inFlight === null ? null : inFlight.tool
    });
  }
  return candidates;
}

// packages/mpd-team-watchdog-plugin/src/scene.ts
import { existsSync as existsSync4, readFileSync as readFileSync5 } from "node:fs";
import { join as join6 } from "node:path";
var SCENE_SCHEMA_VERSION = 1;
function newestForTask(stamps, taskId, attemptId, teamId) {
  let newest = null;
  for (const stamp of stamps) {
    if (stamp.taskId !== taskId)
      continue;
    if (teamId !== undefined && stamp.teamId !== undefined && stamp.teamId !== null && stamp.teamId !== "" && stamp.teamId !== teamId)
      continue;
    if (attemptId !== null && stamp.attemptId !== null && stamp.attemptId !== attemptId)
      continue;
    if (newest === null || stamp.at >= newest)
      newest = stamp.at;
  }
  return newest;
}
function newestOverall2(stamps) {
  let newest = null;
  for (const stamp of stamps)
    if (newest === null || stamp.at >= newest)
      newest = stamp.at;
  return newest;
}
function buildScene(input) {
  const { team } = input;
  const tasks = team.tasks.map((task) => ({
    id: task.id,
    status: task.status,
    assignee: task.assignee ?? null,
    attempt: task.attempt ?? null,
    attemptId: task.attemptId ?? null,
    lastSeen: newestForTask(input.heartbeat(safeSegment(task.assignee ?? "")), task.id, task.attemptId ?? null, team.id),
    streak: input.streaks[team.id + "\x00" + task.id + "\x00" + (task.attemptId ?? "")] ?? 0
  }));
  const members = team.members.map((member) => {
    const key = safeSegment(member.name);
    const stamps = input.heartbeat(key);
    const owned = team.tasks.filter((task) => task.assignee === member.name && !TERMINAL_STATUSES.includes(task.status));
    return {
      id: member.id,
      name: member.name,
      status: member.status ?? null,
      unread: input.unread(key),
      currentTask: owned.length === 0 ? null : owned[owned.length - 1].id,
      lastSeen: newestOverall2(stamps)
    };
  });
  const parkedAttempts = {};
  for (const task of team.tasks) {
    if (TERMINAL_STATUSES.includes(task.status))
      continue;
    if (task.assignee === undefined || task.attemptId === undefined)
      continue;
    const member = team.members.find((entry) => entry.name === task.assignee);
    parkedAttempts[member?.id ?? task.assignee] = task.attemptId;
  }
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    at: input.at,
    reason: input.reason,
    cause: { kind: "silence", ms: input.silenceMs },
    team: {
      id: team.id,
      name: team.name,
      phase: team.phase ?? null,
      halted: team.halted ?? null,
      haltedAt: team.haltedAt ?? null,
      hold: input.hold === null ? null : {
        id: input.hold.id,
        since: input.hold.since,
        cause: input.hold.cause,
        taskId: input.hold.taskId,
        attemptId: input.hold.attemptId
      }
    },
    tasks,
    members,
    mailbox: input.mailbox,
    parkedAttempts,
    incidents: input.incidents
  };
}
function isoBasic(at) {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function writeScene(workspace, stateDir, teamId, scene, at) {
  const dir = sceneDir(workspace, stateDir, teamId);
  const base = isoBasic(at) + "-" + scene.reason;
  let path = join6(dir, base + ".json");
  let suffix = 1;
  try {
    while (existsSync4(path)) {
      suffix += 1;
      path = join6(dir, base + "-" + suffix + ".json");
      if (suffix > 1000)
        break;
    }
  } catch {}
  const text = JSON.stringify(scene, null, 2) + `
`;
  const written = writeFileAtomic(path, text);
  if (written.error !== undefined) {
    return { ok: false, path: null, latestPath: null, bytes: 0, error: written.error };
  }
  const latest = writeFileAtomic(join6(dir, "latest.json"), text);
  if (latest.error !== undefined) {
    return { ok: false, path, latestPath: null, bytes: Buffer.byteLength(text), error: latest.error };
  }
  return { ok: true, path, latestPath: latest.path, bytes: Buffer.byteLength(text) };
}
function mailboxUnreadObservable() {
  return null;
}

// packages/mpd-team-watchdog-plugin/src/engine.ts
function readNamespaceValue(dsh) {
  try {
    const reader = dsh.settingsReader("mpd");
    return { value: reader?.get(), error: null };
  } catch (error) {
    return { value: undefined, error: message2(error) };
  }
}
function namespaceReadIssue(error) {
  return { path: "watchdog", problem: "settings read failed: " + error, fallback: "defaults" };
}
function readNamespaceKnobs(dsh, env, defaults) {
  const { value, error } = readNamespaceValue(dsh);
  const base = readKnobs(value, env, defaults);
  if (error === null)
    return base;
  return { ...base, issues: [...base.issues, namespaceReadIssue(error)] };
}
function toolValue(raw) {
  if (raw === null || typeof raw !== "object")
    return;
  const candidate = raw.value;
  if (candidate !== null && typeof candidate === "object")
    return candidate;
  return raw;
}
function sessionIdOf(value) {
  if (value === null || typeof value !== "object")
    return null;
  const record = value;
  const direct = record.id;
  if (typeof direct === "string" && direct !== "")
    return direct;
  const session = record.session;
  if (session !== null && typeof session === "object") {
    const id = session.id;
    if (typeof id === "string" && id !== "")
      return id;
  }
  return null;
}
function report(text) {
  try {
    console.warn("[mpd-team-watchdog] " + text);
  } catch {}
}
function subscribe(ctx, event, handler) {
  try {
    const wrapped = (...args) => {
      try {
        return handler(...args);
      } catch (error) {
        report("[" + event + "] handler threw: " + message2(error));
        return;
      }
    };
    const disposer = ctx.on?.(event, wrapped);
    if (typeof disposer === "function")
      return disposer;
    if (disposer !== undefined && typeof disposer.dispose === "function") {
      const target = disposer;
      return () => target.dispose();
    }
    return () => {};
  } catch (error) {
    report("could not subscribe to " + event + ": " + message2(error));
    return () => {};
  }
}

class WatchdogEngine {
  dsh;
  ctx;
  config;
  machine = new WatchdogMachine;
  registry;
  roots = new Set;
  teamCache = new Map;
  knobs;
  ticking = false;
  stopped = false;
  turnSeq = 0;
  fold = new ChannelFold;
  enrichment = false;
  predicateSource = "heartbeat";
  predicateReason = "not installed yet";
  fallbackAnnounced = false;
  divergenceAnnounced = false;
  knobView = {
    readings: [],
    divergent: [],
    restartRequired: false,
    file: null,
    fileFound: false,
    fileApplied: false,
    liveLayer: "namespace"
  };
  layerDigests = { namespace: null, file: null };
  layersSeen = false;
  liveLayer = "namespace";
  liveFile = null;
  onKnobsChanged;
  stats = {
    ticks: 0,
    tickErrors: 0,
    tickSkips: 0,
    heartbeatWrites: 0,
    heartbeatFailures: 0,
    rotations: 0,
    scenes: 0,
    sceneFailures: 0,
    holdsApplied: 0,
    holdsFailed: 0,
    incidents: 0,
    incidentFailures: 0,
    neverStarted: 0,
    skippedTeams: 0,
    toolStarts: 0,
    toolExpired: 0,
    channelEvents: 0,
    channelFallbacks: 0,
    streamFrames: 0,
    channelDetached: 0,
    channelDependencyBlocked: 0,
    holdsAutoReleased: 0,
    holdsAutoReleaseFailures: 0,
    lastError: null
  };
  constructor(dsh, ctx, config, registry) {
    this.dsh = dsh;
    this.ctx = ctx;
    this.config = config;
    this.registry = registry;
    this.knobs = readNamespaceKnobs(dsh, process.env, this.knobDefaults());
    this.remember(this.workspaceOf(undefined));
  }
  getKnobs() {
    return this.knobs;
  }
  getStats() {
    return { ...this.stats };
  }
  getMachineState() {
    return this.machine.snapshot();
  }
  predicateStatus() {
    const snapshot = this.fold.snapshot();
    return {
      source: this.predicateSource,
      reason: this.predicateReason,
      enrichment: this.enrichment,
      events: snapshot.events,
      sessions: snapshot.sessions,
      states: snapshot.states,
      announced: this.fallbackAnnounced
    };
  }
  channelViewOf(sessionId) {
    return this.fold.view(sessionId);
  }
  knownRoots() {
    const roots = new Set(this.roots);
    try {
      for (const root of this.dsh.workspaceRootsAll() ?? [])
        roots.add(root);
    } catch {}
    try {
      roots.add(this.dsh.workspaceRoot());
    } catch {}
    return [...roots].sort();
  }
  refreshKnobs(env = process.env) {
    const { value: namespaceValue, error } = readNamespaceValue(this.dsh);
    const namespaceDigest = sectionDigest(watchdogSectionOf(namespaceValue));
    const file = readWatchdogSection(this.workspaceOf(undefined));
    const fileDigest = file.found ? sectionDigest(file.section) : null;
    if (this.layersSeen) {
      const namespaceChanged = namespaceDigest !== this.layerDigests.namespace;
      const fileChanged = fileDigest !== this.layerDigests.file;
      if (fileChanged && !namespaceChanged) {
        this.liveLayer = "file";
        this.liveFile = file.path;
      } else if (namespaceChanged) {
        this.liveLayer = "namespace";
        this.liveFile = null;
      }
    } else {
      this.layersSeen = true;
    }
    this.layerDigests.namespace = namespaceDigest;
    this.layerDigests.file = fileDigest;
    const base = this.liveLayer === "file" && fileDigest !== null ? overlayWatchdogSection(namespaceValue, file.section) : namespaceValue;
    const resolved = readKnobs(base, env, this.knobDefaults());
    this.knobs = error === null ? resolved : { ...resolved, issues: [...resolved.issues, namespaceReadIssue(error)] };
    return this.knobs;
  }
  knobDefaults() {
    return {
      enabled: this.config.enabled,
      warnSilenceMs: this.config.warnSilenceMs,
      tickIntervalMs: this.config.tickIntervalMs,
      warnStreakToEscalate: this.config.warnStreakToEscalate,
      actionOnEscalate: this.config.actionOnEscalate,
      toolInFlightMaxMs: this.config.toolInFlightMaxMs,
      holdTtlMs: this.config.holdTtlMs
    };
  }
  noteFallback(reason) {
    this.stats.channelFallbacks += 1;
    this.predicateSource = "heartbeat";
    this.predicateReason = reason;
    if (this.fallbackAnnounced)
      return;
    this.fallbackAnnounced = true;
    this.warn("PREDICATE FALLBACK (§4): " + reason + " — the engine now runs the heartbeat rule in REPORT-ONLY mode: it may WARN (cause `silence-heartbeat`) " + "and it can NEVER hold or escalate a team while this lasts. The `session/event` fold is the intended authority.");
  }
  liveIds() {
    const ids = new Set;
    let known = false;
    try {
      const capabilities = this.dsh.capabilities?.();
      known = capabilities?.agents === true;
      if (known) {
        for (const agent of this.dsh.liveAgents() ?? []) {
          const id = agent?.id;
          if (typeof id === "string" && id !== "")
            ids.add(id);
        }
      }
    } catch {
      return { known: false, ids: new Set };
    }
    return { known: known && ids.size > 0, ids };
  }
  invalidate() {
    this.teamCache.clear();
  }
  stop() {
    this.stopped = true;
  }
  isStopped() {
    return this.stopped;
  }
  remember(workspace) {
    if (typeof workspace === "string" && workspace !== "")
      this.roots.add(workspace);
  }
  teams(workspace, now = Date.now()) {
    const key = workspace + "\x00" + this.config.stateDir;
    const cached = this.teamCache.get(key);
    if (this.config.teamCacheMs > 0 && cached !== undefined && now - cached.at < this.config.teamCacheMs)
      return cached.teams;
    const teams = readTeams(this.dsh);
    this.teamCache.set(key, { at: now, teams });
    return teams;
  }
  workspaceOf(agent) {
    return this.dsh.workspaceRoot(agent === undefined ? undefined : { agent });
  }
  stamp(kind, agent, extra = {}) {
    const ids = agentIds(agent);
    const workspace = this.workspaceOf(ids.cwd !== undefined ? agent : undefined);
    this.remember(workspace);
    const team = teamOf(this.teams(workspace), agent);
    const identity = resolveIdentity(team, agent);
    if (kind === "turn-start")
      this.turnSeq += 1;
    const memberKey = identity.member ?? "session-" + (ids.sessionId.slice(0, 8) || ids.agentId.slice(0, 8) || "unknown");
    const task = team !== undefined && identity.member !== null ? currentTask(team, identity.member) : undefined;
    const at = Date.now();
    const stamp = {
      kind,
      at,
      member: identity.member,
      memberKey,
      teamId: team?.id ?? null,
      taskId: task?.id ?? null,
      attemptId: task?.attemptId ?? null,
      turnId: memberKey + "#" + String(this.turnSeq),
      ...extra.tool === undefined ? {} : { tool: extra.tool },
      ...extra.callId === undefined ? {} : { callId: extra.callId },
      ...extra.ok === undefined ? {} : { ok: extra.ok },
      workspace
    };
    const written = appendHeartbeat(workspace, this.config.stateDir, memberKey, stamp);
    if (written.ok) {
      this.stats.heartbeatWrites += 1;
      if (kind === "tool-start")
        this.stats.toolStarts += 1;
    } else {
      this.stats.heartbeatFailures += 1;
      this.stats.lastError = written.error ?? "heartbeat write failed";
      this.warn("heartbeat write failed at " + written.path + ": " + String(written.error));
    }
    return stamp;
  }
  install() {
    const disposers = [];
    const agentOf = (payload) => payload?.agent;
    if (typeof this.ctx.on === "function") {
      disposers.push(subscribe(this.ctx, "agent/pre-step", (payload, next) => {
        try {
          this.stamp("step", agentOf(payload));
        } catch (error) {
          this.warn("pre-step heartbeat failed (the step decision is unaffected): " + message2(error));
        }
        return typeof next === "function" ? next() : undefined;
      }));
      disposers.push(subscribe(this.ctx, "agent/session-start", (payload) => {
        this.stamp("turn-start", agentOf(payload) ?? payload);
      }));
      disposers.push(subscribe(this.ctx, "agent/turn-stopping", (payload) => {
        const stamp = this.stamp("turn-end", agentOf(payload) ?? payload);
        const rotated = rotateHeartbeats(stamp.workspace, this.config.stateDir, stamp.memberKey, this.config.keepGenerations);
        if (rotated.rotated)
          this.stats.rotations += 1;
      }));
    } else {
      this.warn("this context exposes no event seam — heartbeat writers not installed");
    }
    if (typeof this.dsh.onEvent === "function") {
      const offSession = this.dsh.onEvent("session/event", (session, event) => {
        try {
          const sessionId = sessionIdOf(session);
          if (sessionId === null)
            return;
          const view = this.fold.apply(sessionId, event);
          if (view === null)
            return;
          this.stats.channelEvents += 1;
        } catch (error) {
          this.warn("the session/event fold threw (the tick keeps its last state): " + message2(error));
        }
      });
      if (typeof offSession === "function") {
        disposers.push(offSession);
        this.predicateSource = "channel";
        this.predicateReason = "session/event firehose subscribed (§1 fold is the authority)";
      } else {
        this.noteFallback("the adapter's onEvent seam answered undefined for session/event");
      }
    } else {
      this.noteFallback("the adapter exposes no onEvent seam");
    }
    if (typeof this.dsh.onEvent === "function") {
      const offStream = this.dsh.onEvent("agent/assistant-stream", (payload) => {
        try {
          const record = payload !== null && typeof payload === "object" ? payload : {};
          const sessionId = sessionIdOf(record.agent);
          if (sessionId === null)
            return;
          if (this.fold.noteStreamFrame(sessionId, record.frame ?? payload))
            this.stats.streamFrames += 1;
        } catch (error) {
          this.warn("the assistant-stream enrichment threw: " + message2(error));
        }
      });
      if (typeof offStream === "function") {
        disposers.push(offStream);
        this.enrichment = true;
      } else {
        this.info("enrichment unavailable (no agent/assistant-stream): a long streaming answer stays OUTSTANDING until its assistant/message commits (§1 rule 3)");
      }
    }
    const post = this.dsh.onPostToolExecute((exec) => {
      const name = typeof exec?.name === "string" ? exec.name : undefined;
      const rawCallId = exec?.callId;
      this.stamp("tool", exec?.agent, {
        ...name === undefined ? {} : { tool: name },
        ...typeof rawCallId === "string" ? { callId: rawCallId } : {},
        ok: true
      });
      return;
    });
    if (typeof post === "function")
      disposers.push(post);
    if (typeof this.dsh.onPreToolExecute === "function") {
      const pre = this.dsh.onPreToolExecute((exec, decision) => {
        if (decision !== undefined && decision.kind === "deny")
          return;
        const name = typeof exec?.name === "string" ? exec.name : undefined;
        const rawCallId = exec?.callId;
        this.stamp("tool-start", exec?.agent, {
          ...name === undefined ? {} : { tool: name },
          ...typeof rawCallId === "string" ? { callId: rawCallId } : {}
        });
      });
      if (typeof pre === "function")
        disposers.push(pre);
    } else {
      this.warn("the adapter exposes no pre-tool hook — a long tool call stays indistinguishable from silence (r6 unavailable)");
    }
    if (typeof this.dsh.onSettingsDocumentUpdated === "function") {
      disposers.push(this.dsh.onSettingsDocumentUpdated("mpd", () => {
        try {
          const next = this.refreshKnobs();
          this.info("knobs re-read (enabled=" + next.enabled + ", warnSilenceMs=" + next.warnSilenceMs + ", tickIntervalMs=" + next.tickIntervalMs + ", warnStreakToEscalate=" + next.warnStreakToEscalate + ", actionOnEscalate=" + next.actionOnEscalate + ")");
          this.onKnobsChanged?.(next);
        } catch (error) {
          this.warn("knob re-read failed: " + message2(error));
        }
      }));
    } else {
      this.warn("the adapter exposes no settings/document-updated seam — live tuning unavailable");
    }
    return disposers;
  }
  async tickOnce(now = Date.now()) {
    if (this.ticking) {
      this.stats.tickSkips += 1;
      return { decisions: [], scenes: [], holds: [], skipped: "previous tick still running" };
    }
    this.ticking = true;
    this.stats.ticks += 1;
    const decisions = [];
    const scenes = [];
    const holds = [];
    try {
      try {
        const next = this.refreshKnobs();
        this.onKnobsChanged?.(next);
      } catch (error) {
        this.warn("knob re-read failed: " + message2(error));
      }
      if (!this.knobs.enabled)
        return { decisions, scenes, holds, skipped: "disabled" };
      try {
        this.noteKnobDivergence();
      } catch (error) {
        this.warn("knob divergence check failed: " + message2(error));
      }
      for (const workspace of this.knownRoots()) {
        try {
          await this.autoReleaseHolds(workspace, now);
        } catch (error) {
          this.warn("auto-release pass failed for " + workspace + ": " + message2(error));
        }
        for (const team of this.teams(workspace, now)) {
          const liveness = this.liveness(team, now);
          if (!liveness.tickable) {
            this.stats.skippedTeams += 1;
            this.skipNote(team, liveness.reason);
            continue;
          }
          for (const decision of this.machine.observe(this.candidates(workspace, team), now, this.knobs)) {
            if (decision.type === "never-started") {
              await this.recordNeverStarted(workspace, team, decision, now);
              continue;
            }
            if (decision.type === "tool-expired") {
              await this.recordToolExpired(workspace, team, decision, now);
              continue;
            }
            decisions.push(decision);
            const outcome = await this.act(workspace, team, decision, now);
            if (outcome.scene !== null)
              scenes.push(outcome.scene);
            if (outcome.held)
              holds.push(team.id);
          }
        }
      }
      return { decisions, scenes, holds };
    } catch (error) {
      this.stats.tickErrors += 1;
      this.stats.lastError = message2(error);
      this.warn("tick threw " + this.stats.tickErrors + " time(s): " + message2(error));
      return { decisions, scenes, holds, skipped: "tick error: " + message2(error) };
    } finally {
      this.ticking = false;
    }
  }
  liveness(team, now) {
    const desc = "team " + team.id + " (phase " + (team.phase ?? "?") + ", " + team.tasks.length + " task(s))";
    let agentsKnown = false;
    const live = new Set;
    try {
      const capabilities = this.dsh.capabilities?.();
      agentsKnown = capabilities?.agents === true;
      if (agentsKnown) {
        for (const agent of this.dsh.liveAgents() ?? []) {
          const id = agent?.id;
          if (typeof id === "string" && id !== "")
            live.add(id);
        }
      }
    } catch {
      agentsKnown = false;
    }
    if (agentsKnown && live.size > 0) {
      if (team.captainSessionId !== undefined && live.has(team.captainSessionId))
        return { tickable: true, reason: desc + " has a LIVE captain session" };
      const member = team.members.find((entry) => entry.id !== "" && live.has(entry.id));
      if (member !== undefined)
        return { tickable: true, reason: desc + " has the LIVE member " + member.name };
      return {
        tickable: false,
        reason: desc + " has NO live agent: neither the captain session nor any of its " + team.members.length + " member id(s) is in this process's live registry (" + live.size + " live agent(s))"
      };
    }
    const configured = this.config.deadTeamGraceMs;
    const grace = typeof configured === "number" && Number.isFinite(configured) ? configured : 0;
    if (grace <= 0 || team.activityAt === null) {
      return { tickable: true, reason: desc + " ticked: the live readout is the only source and the agent registry answered nothing (registry " + (agentsKnown ? "empty" : "absent") + ", bound " + grace + "ms)" };
    }
    const age = now - team.activityAt;
    if (age <= grace)
      return { tickable: true, reason: desc + " activity " + age + "ms ago is within the " + grace + "ms grace window" };
    return {
      tickable: false,
      reason: desc + " has no live agent and its newest activity is " + age + "ms old (> " + grace + "ms grace): a dead record, not a dispatch problem"
    };
  }
  async autoReleaseHolds(workspace, now) {
    let held = [];
    try {
      held = this.registry?.heldTeams(workspace) ?? [];
    } catch {
      held = [];
    }
    if (held.length === 0)
      held = heldTeamIds(workspace, this.config.stateDir);
    if (held.length === 0)
      return;
    let stampsByTeam = null;
    for (const teamId of held) {
      const hold = readHold(workspace, this.config.stateDir, teamId);
      if (hold === undefined)
        continue;
      const age = now - hold.since;
      let release = null;
      if (hold.ttlMs > 0 && age >= hold.ttlMs)
        release = "ttl";
      else {
        if (stampsByTeam === null)
          stampsByTeam = this.teamStamps(workspace);
        if (stampsByTeam.some((stamp) => stamp.teamId === teamId && Number.isFinite(stamp.at) && stamp.at > hold.since))
          release = "activity";
      }
      if (release === null)
        continue;
      const resumed = applyResume(workspace, this.config.stateDir, { team_id: teamId }, this.registry);
      if (!resumed.resumed) {
        this.stats.holdsAutoReleaseFailures += 1;
        this.warn("hold auto-release FAILED for " + teamId + " (" + String(resumed.reason) + "): the internal hold is still persisted, so new dispatch into the team stays stopped");
        continue;
      }
      this.stats.holdsAutoReleased += 1;
      const incident = {
        id: teamId + "#hold-auto-released#" + release + "#" + now,
        teamId,
        kind: "hold-auto-released",
        at: now,
        cause: { kind: "hold-auto-released", ms: age, release },
        taskId: hold.taskId,
        attemptId: hold.attemptId,
        scene: null,
        hold: "not-requested",
        acknowledgedBy: []
      };
      const logged = appendIncident(workspace, this.config.stateDir, incident);
      if (logged.ok)
        this.stats.incidents += 1;
      else {
        this.stats.incidentFailures += 1;
        this.warn("hold-auto-released incident append failed at " + logged.path + ": " + String(logged.error));
      }
      this.info("HOLD AUTO-RELEASED team=" + teamId + " cause=" + release + " age=" + age + "ms" + " ttl=" + (hold.ttlMs === 0 ? "none" : hold.ttlMs + "ms") + " since=" + hold.since + " — the internal hold lifted itself; every team byte is untouched (PRESERVING)" + (logged.ok ? " record=" + logged.path : " record=FAILED"));
    }
  }
  teamStamps(workspace) {
    const out = [];
    for (const key of listHeartbeatKeys(workspace, this.config.stateDir)) {
      for (const stamp of readHeartbeats(workspace, this.config.stateDir, key))
        out.push(stamp);
    }
    return out;
  }
  noteKnobDivergence() {
    const workspace = this.workspaceOf(undefined);
    const { found, path, section } = readWatchdogSection(workspace);
    const readings = knobReadings(this.knobs, section);
    const divergent = readings.filter((reading) => reading.differs).map((reading) => reading.knob);
    const fileApplied = this.liveLayer === "file" && this.liveFile === path;
    this.knobView = { readings, divergent, restartRequired: divergent.length > 0, file: path, fileFound: found, fileApplied, liveLayer: this.liveLayer };
    if (divergent.length === 0 || this.divergenceAnnounced)
      return;
    this.divergenceAnnounced = true;
    const detail = readings.filter((reading) => reading.differs).map((reading) => reading.knob + ": live=" + String(reading.live) + " file=" + String(reading.file)).join(", ");
    this.warn("KNOBS DIVERGE (§7.3): " + path + " states " + divergent.length + " value(s) the running process is NOT using (" + detail + ") — " + (fileApplied ? "the file layer was applied live for its other values; these could not be applied and wait for the next dsh boot" : "a .mpd/mpd.jsonc edit applies live once this process has observed the file, and at the NEXT dsh boot otherwise"));
  }
  knobDivergence() {
    return { ...this.knobView, readings: this.knobView.readings.map((reading) => ({ ...reading })) };
  }
  skipNote(team, reason) {
    try {
      const logger = this.ctx.logger;
      if (typeof logger?.debug === "function")
        logger.debug("[mpd-team-watchdog] skipping " + reason);
    } catch {}
    if (this.config.verboseSkips) {
      try {
        console.log("[" + this.config.logPrefix + "] skipped " + reason);
      } catch {}
    }
  }
  candidates(workspace, team) {
    const cache = new Map;
    const stampsOf = (memberKey) => {
      const cached = cache.get(memberKey);
      if (cached !== undefined)
        return cached;
      const stamps = readHeartbeats(workspace, this.config.stateDir, memberKey);
      cache.set(memberKey, stamps);
      return stamps;
    };
    const base = candidateFor({ id: team.id, tasks: team.tasks, createdAt: team.createdAt, approvedAt: team.approvedAt }, stampsOf, (assignee) => assignee);
    const live = this.liveIds();
    const blockedOf = new Map;
    const memberSessions = new Map;
    for (const member of team.members)
      if (member.id !== "" && member.name !== "")
        memberSessions.set(member.name, member.id);
    const registryKnowsTeam = live.known && team.members.some((member) => member.id !== "" && live.ids.has(member.id));
    return base.map((candidate) => {
      let blocked = blockedOf.get(candidate.assignee);
      if (blocked === undefined) {
        blocked = dependencyBlocked(team, candidate.assignee);
        blockedOf.set(candidate.assignee, blocked);
      }
      if (blocked.blocked) {
        this.stats.channelDependencyBlocked += 1;
        return {
          ...candidate,
          channelState: "PARKED",
          outstandingSince: null,
          channelInFlightSince: null,
          channelInFlightTool: null,
          heartbeatFallback: false
        };
      }
      const sessionId = candidate.assignee === CAPTAIN_KEY ? team.captainSessionId ?? null : memberSessions.get(candidate.assignee) ?? null;
      if (sessionId === null) {
        this.noteFallback("team " + team.id + " carries no session id for task owner " + candidate.assignee);
        return { ...candidate, channelState: null, heartbeatFallback: true };
      }
      const view = this.fold.view(sessionId);
      if (view === null) {
        this.noteFallback("no session/event fold data for member " + candidate.assignee + " (session " + sessionId + ")");
        return { ...candidate, channelState: null, heartbeatFallback: true };
      }
      const channelState = registryKnowsTeam && view.state !== "PARKED" && !live.ids.has(sessionId) ? "PARKED" : view.state;
      if (channelState !== view.state)
        this.stats.channelDetached += 1;
      return {
        ...candidate,
        channelState,
        outstandingSince: view.outstandingSince,
        channelInFlightSince: view.inFlightSince,
        channelInFlightTool: view.inFlightTool,
        heartbeatFallback: false
      };
    });
  }
  async act(workspace, team, decision, now) {
    const alreadyHeld = readHold(workspace, this.config.stateDir, team.id);
    let holdState = alreadyHeld === undefined ? "not-requested" : "applied";
    let held = alreadyHeld !== undefined;
    let holdForScene = alreadyHeld ?? null;
    if (decision.type === "escalate" && alreadyHeld === undefined && this.knobs.actionOnEscalate === "pause") {
      const applied = await this.performHold(workspace, team.id, decision, now);
      holdState = applied.applied ? "applied" : "not-applied";
      held = applied.applied;
      holdForScene = applied.applied ? readHold(workspace, this.config.stateDir, team.id) ?? null : null;
      if (applied.applied)
        this.stats.holdsApplied += 1;
      else {
        this.stats.holdsFailed += 1;
        this.warn("hold NOT applied for " + team.id + " (" + applied.via + "): " + String(applied.error));
      }
    }
    const incidents = readIncidents(workspace, this.config.stateDir).filter((record) => record.teamId === team.id).map((record) => ({ id: record.id, kind: record.kind, at: record.at, taskId: record.taskId, attemptId: record.attemptId, scene: record.scene }));
    const scene = buildScene({
      team,
      reason: decision.type,
      at: now,
      silenceMs: decision.silenceMs,
      hold: holdForScene,
      mailbox: readWatermarks(workspace, this.config.stateDir),
      incidents,
      streaks: this.machine.snapshot().streaks,
      heartbeat: (memberKey) => readHeartbeats(workspace, this.config.stateDir, memberKey),
      unread: () => mailboxUnreadObservable()
    });
    let scenePath = null;
    if (alreadyHeld === undefined) {
      const written = writeScene(workspace, this.config.stateDir, team.id, scene, now);
      if (written.ok) {
        this.stats.scenes += 1;
        scenePath = written.path;
      } else {
        this.stats.sceneFailures += 1;
        this.stats.lastError = written.error ?? "scene write failed";
        this.warn("scene write failed at " + sceneDir(workspace, this.config.stateDir, team.id) + ": " + String(written.error) + " — the hold was still attempted and the incident is still recorded");
      }
    }
    const incident = {
      id: decision.taskId + "@" + decision.attemptId + "#" + now,
      teamId: team.id,
      kind: decision.type,
      at: now,
      cause: { kind: decision.cause, ms: decision.silenceMs },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: scenePath,
      hold: holdState,
      acknowledgedBy: []
    };
    const logged = appendIncident(workspace, this.config.stateDir, incident);
    if (logged.ok)
      this.stats.incidents += 1;
    else {
      this.stats.incidentFailures += 1;
      this.warn("incident append failed at " + logged.path + ": " + String(logged.error));
    }
    this.info(decision.type.toUpperCase() + " " + team.id + " task=" + decision.taskId + " member=" + decision.assignee + " cause=" + decision.cause + " state=" + (decision.state ?? "heartbeat") + " silence=" + decision.silenceMs + "ms" + " streak=" + decision.streak + " hold=" + holdState + (scenePath === null ? " scene=none" : " scene=" + scenePath));
    return { scene: scenePath, held };
  }
  async recordNeverStarted(workspace, team, decision, now) {
    this.stats.neverStarted += 1;
    const incident = {
      id: decision.taskId + "@" + decision.attemptId + "#never-started#" + now,
      teamId: team.id,
      kind: "never-started",
      at: now,
      cause: { kind: "never-started", ms: 0 },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: null,
      hold: "not-requested",
      acknowledgedBy: []
    };
    const logged = appendIncident(workspace, this.config.stateDir, incident);
    if (logged.ok)
      this.stats.incidents += 1;
    else {
      this.stats.incidentFailures += 1;
      this.warn("never-started record append failed at " + logged.path + ": " + String(logged.error));
    }
    this.info("NEVER-STARTED " + team.id + " task=" + decision.taskId + " member=" + decision.assignee + " attempt=" + (decision.attemptId === "" ? "(none)" : decision.attemptId) + " — the owner never stamped this task: a dispatch problem, not a wedge; recorded for replay, NO hold, NO escalation" + (logged.ok ? " record=" + logged.path : " record=FAILED"));
  }
  async recordToolExpired(workspace, team, decision, now) {
    this.stats.toolExpired += 1;
    const incident = {
      id: decision.taskId + "@" + decision.attemptId + "#tool-expired#" + now,
      teamId: team.id,
      kind: "tool-expired",
      at: now,
      cause: {
        kind: "tool-expired",
        ms: decision.inFlightMs,
        ...decision.tool === null ? {} : { tool: decision.tool }
      },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: null,
      hold: "not-requested",
      acknowledgedBy: []
    };
    const logged = appendIncident(workspace, this.config.stateDir, incident);
    if (logged.ok)
      this.stats.incidents += 1;
    else {
      this.stats.incidentFailures += 1;
      this.warn("tool-expired record append failed at " + logged.path + ": " + String(logged.error));
    }
    this.info("TOOL-EXPIRED " + team.id + " task=" + decision.taskId + " member=" + decision.assignee + " tool=" + (decision.tool ?? "(unnamed)") + " inFlight=" + decision.inFlightMs + "ms (since " + decision.since + ", bound=" + this.knobs.toolInFlightMaxMs + "ms)" + " — the call outlived the in-flight bound; reported ONCE, NO hold, NO escalation, the team is left alone" + (logged.ok ? " record=" + logged.path : " record=FAILED"));
  }
  async performHold(workspace, teamId, decision, now) {
    const args = {
      team_id: teamId,
      task_id: decision.taskId,
      attempt_id: decision.attemptId,
      cause: "silence",
      scene_at: now,
      ttl_ms: this.knobs.holdTtlMs
    };
    try {
      const runtime = this.dsh.toolRuntime();
      if (runtime !== undefined && typeof runtime.execute === "function") {
        const value = toolValue(await runtime.execute({ name: HOLD_TOOL, arguments: args }));
        if (value !== undefined && value.applied === true)
          return { applied: true, via: "tool-seam" };
        if (value !== undefined && value.applied === false) {
          return { applied: false, via: "tool-seam", error: String(value.error ?? "hold action refused") };
        }
      }
    } catch (error) {
      this.warn("the hold action was unreachable through the tool seam (" + message2(error) + ") — falling back to a direct write");
    }
    const direct = applyHold(workspace, this.config.stateDir, args, this.registry);
    if (direct.applied)
      return { applied: true, via: "direct" };
    return { applied: false, via: "direct", error: direct.error };
  }
  warn(text) {
    this.emit("warn", text);
  }
  info(text) {
    this.emit("info", text);
  }
  emit(level, text) {
    const line = "[" + this.config.logPrefix + "] " + text;
    try {
      if (level === "warn" && typeof this.ctx.logger?.warn === "function")
        this.ctx.logger.warn(line);
      else if (level === "info" && typeof this.ctx.logger?.info === "function")
        this.ctx.logger.info(line);
    } catch {}
    try {
      if (level === "warn")
        console.warn(line);
      else
        console.log(line);
    } catch {}
  }
}

// packages/mpd-team-watchdog-plugin/src/index.ts
var name = "mpd-team-watchdog";
var inject = ["tools", "agents"];
var Config = import_schemastery.default.object({
  enabled: import_schemastery.default.boolean().default(true),
  warnSilenceMs: import_schemastery.default.number().default(WATCHDOG_DEFAULTS.warnSilenceMs),
  tickIntervalMs: import_schemastery.default.number().default(WATCHDOG_DEFAULTS.tickIntervalMs),
  warnStreakToEscalate: import_schemastery.default.number().default(WATCHDOG_DEFAULTS.warnStreakToEscalate),
  actionOnEscalate: import_schemastery.default.string().default(WATCHDOG_DEFAULTS.actionOnEscalate),
  stateDir: import_schemastery.default.string().default(DEFAULT_STATE_DIR),
  teamCacheMs: import_schemastery.default.number().default(2000),
  keepGenerations: import_schemastery.default.number().default(3),
  deadTeamGraceMs: import_schemastery.default.number().default(86400000),
  toolInFlightMaxMs: import_schemastery.default.number().default(WATCHDOG_DEFAULTS.toolInFlightMaxMs),
  holdTtlMs: import_schemastery.default.number().default(WATCHDOG_DEFAULTS.holdTtlMs),
  verboseSkips: import_schemastery.default.boolean().default(false),
  logPrefix: import_schemastery.default.string().default("mpd-team-watchdog")
});
function resolveConfig(config = {}) {
  const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
  const num = (value, fallback, min) => typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
  return {
    enabled: bool(config.enabled, WATCHDOG_DEFAULTS.enabled),
    warnSilenceMs: num(config.warnSilenceMs, WATCHDOG_DEFAULTS.warnSilenceMs, 1),
    tickIntervalMs: num(config.tickIntervalMs, WATCHDOG_DEFAULTS.tickIntervalMs, 1),
    warnStreakToEscalate: num(config.warnStreakToEscalate, WATCHDOG_DEFAULTS.warnStreakToEscalate, 1),
    actionOnEscalate: config.actionOnEscalate === "pause" ? "pause" : "warn-only",
    stateDir: typeof config.stateDir === "string" && config.stateDir !== "" ? config.stateDir : DEFAULT_STATE_DIR,
    teamCacheMs: num(config.teamCacheMs, 2000, 0),
    keepGenerations: num(config.keepGenerations, 3, 1),
    deadTeamGraceMs: num(config.deadTeamGraceMs, 86400000, 0),
    toolInFlightMaxMs: num(config.toolInFlightMaxMs, WATCHDOG_DEFAULTS.toolInFlightMaxMs, 0),
    holdTtlMs: num(config.holdTtlMs, WATCHDOG_DEFAULTS.holdTtlMs, 0),
    verboseSkips: bool(config.verboseSkips, false),
    logPrefix: typeof config.logPrefix === "string" && config.logPrefix !== "" ? config.logPrefix : "mpd-team-watchdog"
  };
}
function warn(prefix, text) {
  try {
    console.warn("[" + prefix + "] " + text);
  } catch {}
}
function apply(ctx, config = {}) {
  const context = ctx ?? {};
  const resolved = resolveConfig(config);
  let dsh;
  try {
    dsh = context.get?.("mpdDsh", false) ?? createDshAdapter(context);
  } catch (error) {
    warn(resolved.logPrefix, "no adapter available — the row is inert: " + message2(error));
    return { applied: false, engine: null, knobs: readKnobs(undefined), intervalMs: 0, disposers: 0, holdService: null, hydratedHolds: 0, error: message2(error) };
  }
  const registry = new HoldRegistry(resolved.stateDir);
  let hydratedHolds = 0;
  try {
    const roots = new Set;
    try {
      for (const root of dsh.workspaceRootsAll() ?? [])
        roots.add(root);
    } catch {}
    try {
      roots.add(dsh.workspaceRoot());
    } catch {}
    hydratedHolds = registry.hydrate([...roots]);
  } catch (error) {
    warn(resolved.logPrefix, "hold hydration at apply failed (the file fallback still answers): " + message2(error));
  }
  let engine;
  try {
    engine = new WatchdogEngine(dsh, context, resolved, registry);
  } catch (error) {
    warn(resolved.logPrefix, "engine construction failed — the row is inert: " + message2(error));
    return { applied: false, engine: null, knobs: readKnobs(undefined), intervalMs: 0, disposers: 0, holdService: null, hydratedHolds, error: message2(error) };
  }
  let holdService = null;
  try {
    const provide = context.provide;
    if (typeof provide === "function") {
      provide.call(context, HOLD_SERVICE, {
        isHeld: (teamId, workspace) => registry.isHeld(teamId, workspace),
        holds: (teamId, workspace) => registry.holds(teamId, workspace),
        list: () => registry.list(),
        hydratedRoots: () => registry.hydratedRoots(),
        hydrate: (roots) => registry.hydrate(roots ?? engine.knownRoots()),
        heldTeams: (workspace) => registry.heldTeams(workspace),
        unread: (reader, workspace) => registry.unread(reader, workspace),
        acknowledge: (reader, upTo, workspace) => registry.acknowledge(reader, upTo, workspace),
        view: (reader, workspace) => registry.view(reader, workspace),
        gateCall: HOLD_GATE_CALL
      });
      holdService = HOLD_SERVICE;
    } else {
      warn(resolved.logPrefix, "ctx.provide is unavailable — the hold reader is not published and the w7 gates stay fail-open");
    }
  } catch (error) {
    warn(resolved.logPrefix, "publishing the " + HOLD_SERVICE + " service failed: " + message2(error));
  }
  let disposers = [];
  try {
    registerWatchdogActions(dsh, resolved.stateDir, registry, {
      predicate: () => engine.predicateStatus(),
      knobs: () => engine.knobDivergence(),
      holdTtlMs: () => engine.getKnobs().holdTtlMs
    });
    disposers = engine.install();
  } catch (error) {
    warn(resolved.logPrefix, "registration degraded: " + message2(error));
  }
  let timer;
  let intervalMs = engine.getKnobs().tickIntervalMs;
  const stopTimer = () => {
    if (timer !== undefined) {
      try {
        clearInterval(timer);
      } catch {}
      timer = undefined;
    }
  };
  const startTimer = (next) => {
    stopTimer();
    intervalMs = next;
    try {
      timer = setInterval(() => {
        engine.tickOnce().catch((error) => warn(resolved.logPrefix, "tick rejected: " + message2(error)));
      }, next);
      timer.unref?.();
    } catch (error) {
      timer = undefined;
      warn(resolved.logPrefix, "could not start the tick timer: " + message2(error));
    }
  };
  engine.onKnobsChanged = (knobs) => {
    if (knobs.enabled && knobs.tickIntervalMs !== intervalMs)
      startTimer(knobs.tickIntervalMs);
  };
  if (engine.getKnobs().enabled)
    startTimer(intervalMs);
  else
    warn(resolved.logPrefix, "disabled by configuration — no heartbeat tick will run");
  const cleanup = () => {
    stopTimer();
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {}
    }
    engine.stop();
  };
  try {
    if (typeof context.effect === "function")
      context.effect(() => cleanup);
  } catch (error) {
    warn(resolved.logPrefix, "ctx.effect unavailable (" + message2(error) + ") — the tick will not be cleaned up on dispose");
  }
  const issues = engine.getKnobs().issues;
  for (const issue of issues)
    warn(resolved.logPrefix, "knob " + issue.path + ": " + issue.problem + " — using " + JSON.stringify(issue.fallback));
  try {
    console.log("[mpd-team-watchdog] applied: enabled=" + engine.getKnobs().enabled + " warnSilenceMs=" + engine.getKnobs().warnSilenceMs + " tickIntervalMs=" + intervalMs + " warnStreakToEscalate=" + engine.getKnobs().warnStreakToEscalate + " actionOnEscalate=" + engine.getKnobs().actionOnEscalate + " stateDir=" + resolved.stateDir + " disposers=" + disposers.length + " holdService=" + (holdService ?? "none") + " hydratedHolds=" + hydratedHolds + " deadTeamGraceMs=" + (resolved.deadTeamGraceMs === 0 ? "off" : resolved.deadTeamGraceMs) + " toolInFlightMaxMs=" + (resolved.toolInFlightMaxMs === 0 ? "off" : resolved.toolInFlightMaxMs) + " holdTtlMs=" + (resolved.holdTtlMs === 0 ? "off" : resolved.holdTtlMs) + " predicate=" + engine.predicateStatus().source + " enrichment=" + (engine.predicateStatus().enrichment ? "on" : "off"));
  } catch {}
  return { applied: true, engine, knobs: engine.getKnobs(), intervalMs, disposers: disposers.length, holdService, hydratedHolds };
}
export {
  Config,
  apply,
  inject,
  name,
  resolveConfig
};
