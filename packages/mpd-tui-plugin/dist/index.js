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

// packages/mpd-agent-teams-plugin/_deps/cosmokit/lib/index.ts
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
  pick: () => pick2,
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
function pick2(source, keys, forced) {
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

// packages/mpd-agent-teams-plugin/_deps/schemastery/lib/index.cts
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

// packages/mpd-tui-plugin/src/index.ts
import { homedir as homedir5 } from "node:os";

// packages/mpd-tui-plugin/src/i18n.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var HOST_PREFS_DIR = ".dsh-tui";
var HOST_LANG_FILE = "lang.json";
var LANG_ENV = "DSH_TUI_LANG";
var LOCALE_ENV_VARS = ["LC_ALL", "LC_MESSAGES", "LANG"];
function isLang(value) {
  return value === "zh" || value === "en";
}
function detectLocaleLang(env) {
  let raw = "";
  for (const name of LOCALE_ENV_VARS) {
    const stated = env[name];
    if (typeof stated === "string" && stated.length > 0) {
      raw = stated;
      break;
    }
  }
  const locale = raw.split(".")[0]?.toLowerCase() ?? "";
  if (locale === "")
    return "zh";
  return locale.startsWith("zh") ? "zh" : "en";
}
function readLangPref(inputs = {}) {
  const read = inputs.readFile ?? ((path) => readFileSync(path, "utf8"));
  const dir = join(inputs.home ?? homedir(), HOST_PREFS_DIR);
  let text;
  try {
    text = read(join(dir, HOST_LANG_FILE));
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(text);
    const tag = typeof parsed === "object" && parsed !== null ? parsed.lang : undefined;
    return isLang(tag) ? tag : undefined;
  } catch {
    return;
  }
}
function resolveLang(inputs = {}) {
  const env = inputs.env ?? process.env;
  const pinned = env[LANG_ENV];
  if (isLang(pinned))
    return pinned;
  return readLangPref(inputs) ?? detectLocaleLang(env);
}
function pick(text, lang) {
  return lang === "en" ? text.en : text.zh;
}
var TUI_TEXT = {
  "scene.board": { zh: "MPD 面板", en: "MPD board" },
  "scene.team": { zh: "MPD 团队", en: "MPD team" },
  "scene.plan": { zh: "MPD 计划审批", en: "MPD plan approval" },
  "scene.subagents": { zh: "MPD 子代理 · 团队", en: "MPD subagents · team" },
  "command.boardMissing": { zh: "mpd: 该组合不提供面板场景", en: "mpd: the board scene is not available in this composition" },
  "command.teamMissing": { zh: "mpd: 该组合不提供团队工作流场景", en: "mpd: the team workflow scene is not available in this composition" },
  "command.subagentsMissing": { zh: "mpd: 该组合不提供子代理与团队合并面板", en: "mpd: the subagents + team panel is not available in this composition" },
  "command.planMissing": { zh: "mpd: 该组合不提供计划审批场景", en: "mpd: the plan approval scene is not available in this composition" },
  "command.unknownAction": { zh: "mpd: 未知动作“{action}” —— 用法：{usage}", en: 'mpd: unknown action "{action}" — usage: {usage}' },
  "command.workmatesNone": { zh: "mpd workmates：无", en: "mpd workmates: none" },
  "command.workmatesList": { zh: "mpd workmates（{count}）：{names}", en: "mpd workmates ({count}): {names}" },
  "panel.opened": { zh: "mpd 侧栏面板：已打开（{id}）", en: "mpd sidebar panel: opened ({id})" },
  "panel.fallback": { zh: "mpd 侧栏面板：宿主拒绝了打开请求（{id}），已改为全屏面板", en: "mpd sidebar panel: the host refused the open request ({id}); opened the full-screen panel instead" },
  "panel.unavailable": { zh: "mpd 侧栏面板：该宿主不提供面板接缝，使用全屏面板", en: "mpd sidebar panel: this host exposes no panel seam; using the full-screen panel" },
  "scene.planNeedsStaged": { zh: "计划审批需要一个待定计划", en: "plan approval needs a staged team" },
  "scene.planMissing": { zh: "该组合不提供计划审批界面", en: "the plan approval surface is not available in this composition" },
  "board.noTeam": { zh: "团队       （本工作区无）", en: "team       (none in this workspace)" },
  "board.noBoulder": { zh: "boulder    （无工作台账）", en: "boulder    (no work ledger)" },
  "status.teamRow": { zh: "团队 {name} {members}·{done}/{total}", en: "team {name} {members}·{done}/{total}" },
  "status.teamNone": { zh: "团队 -", en: "team -" },
  "status.failed": { zh: "失败 {n}", en: "failed {n}" },
  "status.boulder": { zh: "boulder {active}/{works}", en: "boulder {active}/{works}" },
  "status.plans": { zh: "计划 {n}", en: "plans {n}" },
  "status.workmates": { zh: "workmate {n}", en: "workmates {n}" },
  "status.notes": { zh: "提示 {n}", en: "notes {n}" },
  "watchdog.notice": { zh: "看门狗：{parts}", en: "watchdog: {parts}" },
  "watchdog.held": { zh: "已暂停 {teams}", en: "held {teams}" },
  "watchdog.unread": { zh: "{n} 条未读事件", en: "{n} unread incidents" },
  "watchdog.unreadOne": { zh: "{n} 条未读事件", en: "{n} unread incident" },
  "watchdog.holdDetail": { zh: "团队 {teams} 被团队看门狗暂停（有成员静默）。", en: "Team {teams} is held by the team watchdog (a member went silent)." },
  "watchdog.replayDetail": { zh: "团队看门狗在无人观看时记录了事件。", en: "The team watchdog recorded incidents while nobody was watching." },
  "watchdog.acknowledge": { zh: "确认", en: "Acknowledge" },
  "watchdog.acknowledgeHint": { zh: "把这些事件标记为已读，不再重复提示", en: "mark these incidents as read so they stop being replayed" },
  "watchdog.later": { zh: "稍后", en: "Later" },
  "watchdog.laterHint": { zh: "保持未读，下次启动再显示", en: "keep them unread; they will be shown again on the next start" }
};
var EFFORT_LABELS = {
  off: { zh: "关闭", en: "off" },
  low: { zh: "低", en: "low" },
  medium: { zh: "中", en: "medium" },
  high: { zh: "高", en: "high" },
  max: { zh: "最高", en: "max" }
};
function effortLabel(id, inputs = {}) {
  const known = EFFORT_LABELS[id];
  return known === undefined ? id : pick(known, resolveLang(inputs));
}
function t(key, params, inputs = {}) {
  return substitute(pick(TUI_TEXT[key], resolveLang(inputs)), params);
}
function substitute(text, params) {
  if (params === undefined)
    return text;
  let out = text;
  for (const [name, value] of Object.entries(params))
    out = out.split(`{${name}}`).join(String(value));
  return out;
}

// packages/mpd-tui-plugin/src/index.ts
var import_schemastery2 = __toESM(require_lib(), 1);

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve as resolve2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/shared.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2, resolve } from "node:path";
var LOG_SUBDIR = join2(".mpd", "logs");
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DEFAULT_MAX_LINE_BYTES = 8192;
var DEFAULT_RING_LINES = 64;
function truncationMarker(droppedBytes) {
  return ` … [mpd log sink: ${droppedBytes} more byte(s) truncated]`;
}
function resolveLogRoots(env = process.env, cwd) {
  let working = cwd;
  if (working === undefined) {
    try {
      working = process.cwd();
    } catch {
      working = undefined;
    }
  }
  const raw = [env.MPD_MCP_LOG_DIR, env.DSH_WORKSPACE_ROOT, working, tmpdir()];
  const roots = [];
  const seen = new Set;
  for (const candidate of raw) {
    if (typeof candidate !== "string" || candidate.trim().length === 0)
      continue;
    let absolute;
    try {
      absolute = resolve(candidate);
    } catch {
      continue;
    }
    if (seen.has(absolute))
      continue;
    seen.add(absolute);
    roots.push(absolute);
  }
  return roots;
}
function tryOpenRoot(root, name) {
  try {
    const dir = join2(root, LOG_SUBDIR);
    mkdirSync(dir, { recursive: true });
    const file = join2(dir, `${name}.log`);
    return { fd: openSync(file, "a"), file };
  } catch {
    return null;
  }
}
function owningRoot(roots, file) {
  for (const root of roots) {
    if (file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`))
      return root;
  }
  return null;
}
var captured = null;
function openLogSink(name, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const ringLines = options.ringLines ?? DEFAULT_RING_LINES;
  const timestamps = options.timestamps ?? true;
  const roots = options.roots ?? resolveLogRoots(options.env ?? process.env);
  let open = null;
  for (const root of roots) {
    const attempt = tryOpenRoot(root, name);
    if (attempt !== null) {
      open = attempt;
      break;
    }
  }
  let size = 0;
  if (open !== null) {
    try {
      size = statSync(open.file).size;
    } catch {
      size = 0;
    }
  }
  let accepted = 0;
  let droppedCount = 0;
  let rotations = 0;
  const ring = [];
  let undoCapture = null;
  let rebindOutcome = "skipped";
  let rebind = null;
  const remember = (record) => {
    if (ring.length >= ringLines) {
      ring.shift();
      droppedCount += 1;
    }
    ring.push(record);
  };
  const rotate = () => {
    if (open === null)
      return;
    try {
      closeSync(open.fd);
      rmSync(`${open.file}.1`, { force: true });
      renameSync(open.file, `${open.file}.1`);
      open = { fd: openSync(open.file, "a"), file: open.file };
      size = 0;
      rotations += 1;
      sink.rebindNow();
    } catch {
      try {
        open = { fd: openSync(open.file, "a"), file: open.file };
      } catch {
        open = null;
      }
    }
  };
  const append = (record) => {
    if (open === null) {
      remember(record);
      return;
    }
    const bytes = Buffer.byteLength(record, "utf8");
    if (size > 0 && size + bytes > maxBytes)
      rotate();
    if (open === null) {
      remember(record);
      return;
    }
    try {
      writeSync(open.fd, record);
      size += bytes;
    } catch {
      remember(record);
    }
  };
  const acceptedRoot = open === null ? null : owningRoot(roots, open.file);
  const sink = {
    name,
    file: open?.file ?? null,
    root: acceptedRoot,
    write(line) {
      try {
        const body = line.endsWith(`
`) ? line.slice(0, -1) : line;
        const capped = Buffer.byteLength(body, "utf8") > maxLineBytes ? capLine(body, maxLineBytes) : body;
        const record = `${timestamps ? `[${new Date().toISOString()}] ` : ""}${capped}
`;
        accepted += 1;
        append(record);
      } catch {}
    },
    fd() {
      return open?.fd ?? null;
    },
    written() {
      return accepted;
    },
    dropped() {
      return droppedCount;
    },
    rotations() {
      return rotations;
    },
    ring() {
      return [...ring];
    },
    stderrRebind() {
      return rebindOutcome;
    },
    restore() {
      if (undoCapture === null)
        return;
      undoCapture();
      undoCapture = null;
      if (captured === sink)
        captured = null;
    }
  };
  sink.attachCapture = (undo, onRebind) => {
    undoCapture = undo;
    rebind = onRebind;
  };
  sink.rebindNow = () => {
    if (rebind === null)
      return;
    rebindOutcome = rebind();
  };
  sink.setRebindOutcome = (outcome) => {
    rebindOutcome = outcome;
  };
  return sink;
}
function capLine(body, maxLineBytes) {
  const kept = Buffer.from(body, "utf8").subarray(0, maxLineBytes).toString("utf8");
  return kept + truncationMarker(Buffer.byteLength(body, "utf8") - Buffer.byteLength(kept, "utf8"));
}
// packages/mpd-dsh-adapter-plugin/src/index.ts
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
    return resolve2(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve2(override);
  return process.cwd();
}
var rowLogSinks = new Map;
function rowLogLine(name, line) {
  try {
    const root = workspaceRootOf(undefined);
    let entry = rowLogSinks.get(name);
    if (entry === undefined || entry.root !== root) {
      entry = { root, sink: openLogSink(name, { roots: [root] }) };
      rowLogSinks.set(name, entry);
    }
    entry.sink.write(line);
  } catch {}
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
        roots.add(resolve2(cwd));
    }
    return [...roots];
  } catch {
    return [];
  }
}
function noop2() {}
var GOAL_TOOL_NAMES = ["get_goal", "create_goal", "update_goal"];
function goalSnapshotOf(view) {
  if (view === null || view === undefined || typeof view !== "object")
    return;
  const raw = view;
  if (typeof raw.id !== "string" || raw.id === "")
    return;
  const snapshot = {
    id: raw.id,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    objective: typeof raw.objective === "string" ? raw.objective : "",
    phase: raw.phase === "paused" || raw.phase === "blocked" || raw.phase === "complete" ? raw.phase : "active",
    maxGoalRounds: typeof raw.maxGoalRounds === "number" ? raw.maxGoalRounds : 0
  };
  if (typeof raw.roundsStarted === "number")
    snapshot.roundsStarted = raw.roundsStarted;
  if (raw.activation === "armed" || raw.activation === "disarmed")
    snapshot.activation = raw.activation;
  const reason = raw.blockedReason;
  if (reason !== null && typeof reason === "object") {
    const code = reason.code;
    const message = reason.message;
    if (typeof code === "string" && code !== "" && typeof message === "string" && message !== "") {
      snapshot.blockedReason = { code, message };
    }
  }
  return snapshot;
}
function goalValueOf(value) {
  if (value === null || value === undefined || typeof value !== "object")
    return { goal: null };
  const raw = value;
  const activation = raw.activation === "armed" || raw.activation === "disarmed" ? raw.activation : undefined;
  const goal = goalSnapshotOf(raw.goal);
  if (goal === undefined)
    return activation === undefined ? { goal: null } : { goal: null, activation };
  if (activation !== undefined)
    goal.activation = activation;
  return activation === undefined ? { goal } : { goal, activation };
}
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
function scopeContextOf(agent) {
  try {
    return agent?.ctx;
  } catch {
    return;
  }
}
function preStepWrapper(listener) {
  return async (payload, next) => {
    const fallback = { kind: "enter", messages: payload?.messages ?? [] };
    const downstream = typeof next === "function" ? await next() ?? fallback : fallback;
    try {
      const decided = await listener(payload ?? {}, downstream);
      return decided ?? downstream;
    } catch {
      return downstream;
    }
  };
}
function agentSystemPromptOf(agent) {
  const context = scopeContextOf(agent);
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
  let scopedSettings;
  const settingsService = () => scopedSettings ?? service("settings");
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
  const rowLog = (name, line) => rowLogLine(name, line);
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
      rowLogLine("mpd-dsh-adapter", "mpd-dsh-adapter: llmCatalog degraded — " + detail);
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
      warnLlmCatalogOnce("listProviders() failed: " + errorMessage(error));
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
  const nativeMembers = new Map;
  const officialMembers = new Map;
  const neverAborted = () => new AbortController().signal;
  const sessionIdOfAgent = (agent) => {
    const session = agent?.session;
    return typeof session?.id === "string" ? session.id : "";
  };
  function nativeTeamExecutor(reason, ready) {
    const subagentsOf = () => service("subagents");
    return {
      kind: "native",
      reason,
      providers: () => {
        try {
          const list = subagentsOf()?.providers;
          if (typeof list !== "function")
            return [];
          const names = list.call(subagentsOf());
          return Array.isArray(names) ? names.filter((entry) => typeof entry === "string") : [];
        } catch {
          return [];
        }
      },
      async spawn(caller, request) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot raise team member "${request.name}"`);
        if (typeof subagents.startContinuable !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable() — cannot raise a team member");
        }
        const spec = {
          provider: typeof request.provider === "string" && request.provider !== "" ? request.provider : "spawn",
          label: `${request.name} · ${request.teamId}`,
          request: {
            prompt: textBlock(request.prompt),
            parent: caller,
            ...request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }
          },
          signal: request.signal ?? neverAborted()
        };
        const started = await subagents.startContinuable.call(subagents, spec);
        const handle = String(started?.childId ?? started?.id ?? "");
        if (handle === "")
          throw new Error(`mpd-dsh-adapter: the native backend raised "${request.name}" but reported no child id`);
        nativeMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name, description: request.description });
        return { handle, executor: "native" };
      },
      async send(caller, handle, content, signal) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot deliver a message to team member "${handle}"`);
        if (typeof subagents.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no sendMessage() — cannot deliver to a team member");
        }
        await subagents.sendMessage.call(subagents, caller, handle, textBlock(content), { signal: signal ?? neverAborted() });
      },
      async interrupt(caller, handle) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot interrupt team member "${handle}"`);
        if (typeof subagents.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt() — cannot interrupt a team member");
        }
        subagents.interrupt.call(subagents, handle, { kind: "ancestor", agent: caller });
      },
      membership(agent) {
        const id = sessionIdOfAgent(agent);
        if (id === "")
          return;
        const entry = nativeMembers.get(id);
        return entry === undefined ? undefined : { teamId: entry.teamId, role: "teammate", name: entry.name };
      },
      members: () => [...nativeMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name }))
    };
  }
  function officialTeamExecutor() {
    return {
      kind: "official",
      reason: "official: the native seams are unavailable, so the mounted Agent Teams service executes the team",
      providers: () => [],
      async spawn(caller, request) {
        const teams = requireService("agentTeams", `cannot raise team member "${request.name}"`);
        if (typeof teams.spawnTeammate !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no spawnTeammate() — cannot raise a team member");
        }
        const spawned = await teams.spawnTeammate.call(teams, caller, {
          name: request.name,
          description: request.description === "" ? request.name : request.description,
          prompt: request.prompt,
          ...request.signal === undefined ? {} : { signal: request.signal }
        });
        const handle = String(spawned?.id ?? spawned?.sessionId ?? spawned?.member?.id ?? "");
        if (handle === "")
          throw new Error(`mpd-dsh-adapter: the official backend raised "${request.name}" but reported no id`);
        officialMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name });
        return { handle, executor: "official" };
      },
      async send(caller, handle, content, signal) {
        const teams = requireService("agentTeams", `cannot deliver a message to team member "${handle}"`);
        if (typeof teams.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no sendMessage() — cannot deliver to a team member");
        }
        await teams.sendMessage.call(teams, caller, { target: handle, content: textBlock(content), ...signal === undefined ? {} : { signal } });
      },
      async interrupt(caller, handle) {
        const teams = requireService("agentTeams", `cannot interrupt team member "${handle}"`);
        if (typeof teams.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no interrupt() — cannot interrupt a team member");
        }
        const target = officialMembers.get(handle)?.name ?? handle;
        teams.interrupt.call(teams, caller, target);
      },
      membership: (agent) => {
        const teams = service("agentTeams");
        const tryMembership = teams?.tryMembership;
        if (typeof tryMembership !== "function")
          return;
        try {
          const membership = tryMembership.call(teams, agent);
          if (membership === undefined || membership === null)
            return;
          const role = membership.role;
          if (role !== "lead" && role !== "teammate")
            return;
          return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") };
        } catch {
          return;
        }
      },
      members: () => [...officialMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name }))
    };
  }
  function scopedToolRegistry(agent) {
    const scope = scopeOfAgentContext(agent);
    if (scope === undefined)
      return;
    try {
      const tools = scope.context?.tools;
      return typeof tools?.execute === "function" ? tools : undefined;
    } catch {
      return;
    }
  }
  function hostToolDefinition(name) {
    try {
      const hostView = service("tools");
      return typeof hostView?.get === "function" ? hostView.get(name) : undefined;
    } catch {
      return;
    }
  }
  function toolDefinitionFor(name, agent) {
    if (agent === undefined)
      return hostToolDefinition(name);
    const scoped = scopedToolRegistry(agent);
    if (scoped === undefined)
      return hostToolDefinition(name);
    try {
      return scoped.get(name, agent);
    } catch {
      return;
    }
  }
  function toolReachable(name) {
    if (hostToolDefinition(name) !== undefined)
      return true;
    return liveAgents().some((candidate) => toolDefinitionFor(name, candidate) !== undefined);
  }
  function projectToolResult(raw) {
    const record = raw;
    if (record?.isError === true) {
      const error = record.error;
      return { ok: false, isError: true, error: error?.message ?? error ?? "tool error", raw };
    }
    return { ok: true, isError: false, value: record?.value, raw };
  }
  async function executeToolForAgent(input) {
    const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10);
    const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs);
    const scoped = input.agent === undefined ? undefined : scopedToolRegistry(input.agent);
    if (scoped !== undefined) {
      try {
        const raw = await scoped.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...signal === undefined ? {} : { signal },
          ...input.agent === undefined ? {} : { agent: input.agent }
        });
        return { result: projectToolResult(raw), via: "agent-scope" };
      } catch (error) {
        return { result: { ok: false, isError: true, error: errorMessage(error) }, via: "agent-scope" };
      }
    }
    const result = await adapter.executeTool({
      name: input.name,
      arguments: input.arguments ?? {},
      callId,
      ...signal === undefined ? {} : { signal },
      ...input.agent === undefined ? {} : { agent: input.agent },
      ...input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }
    });
    return { result, via: "host-plane" };
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
      const goalService = service("goals");
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
        teamExecutorNative: typeof subagents?.startContinuable === "function",
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
        agentPreStepScope: liveAgents().some((candidate) => typeof scopeContextOf(candidate)?.on === "function"),
        team: typeof agentTeams?.tryMembership === "function" && typeof agentTeams?.listMembers === "function",
        teamTasks: TEAM_TASK_METHODS.every((method) => typeof agentTeams?.[method] === "function"),
        teamMessages: typeof agentTeams?.sendMessage === "function" && typeof agentTeams?.waitForChange === "function",
        subagentsProviderRegister: typeof subagents?.registerProvider === "function",
        goals: typeof goalService?.get === "function",
        goalTools: GOAL_TOOL_NAMES.every((goalToolName) => toolReachable(goalToolName))
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    rowLog,
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
    llmCatalog,
    goalState(agent) {
      const goals = service("goals");
      if (goals === undefined || typeof goals.get !== "function")
        return;
      try {
        const view = goals.get(agent);
        return goalSnapshotOf(view) ?? null;
      } catch {
        return;
      }
    },
    async goalControl(input) {
      if (input === null || typeof input !== "object" || typeof input.action !== "string") {
        return { ok: false, isError: true, error: "goalControl requires an action" };
      }
      if (input.agent === undefined)
        return { ok: false, isError: true, error: "goal tools require a calling agent" };
      let goalId = input.goalId;
      let revision = input.revision;
      const needsRef = input.action !== "create" && input.action !== "read";
      if (needsRef && (goalId === undefined || revision === undefined)) {
        const current = await executeToolForAgent({ name: "get_goal", agent: input.agent, callId: input.callId, signal: input.signal, timeoutMs: input.timeoutMs });
        if (!current.result.ok)
          return { ok: false, isError: true, error: current.result.error, via: current.via, raw: current.result.raw };
        const read = goalValueOf(current.result.value);
        if (read.goal === null)
          return { ok: false, isError: true, error: "no current goal", via: current.via, raw: current.result.raw };
        goalId = goalId ?? read.goal.id;
        revision = revision ?? read.goal.revision;
      }
      const toolName = input.action === "read" ? "get_goal" : input.action === "create" ? "create_goal" : "update_goal";
      const toolArguments = input.action === "read" ? {} : input.action === "create" ? { objective: input.objective, ...input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds } } : {
        goal_id: goalId,
        revision,
        action: input.action,
        ...input.objective === undefined ? {} : { objective: input.objective },
        ...input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds },
        ...input.blockedReason === undefined ? {} : { blocked_reason: input.blockedReason }
      };
      if (input.action === "create" && (typeof input.objective !== "string" || input.objective.trim() === "")) {
        return { ok: false, isError: true, error: "goalControl create requires a non-empty objective" };
      }
      if (needsRef && (goalId === undefined || revision === undefined)) {
        return { ok: false, isError: true, error: "goalControl " + input.action + " requires an exact goal id and revision" };
      }
      const call = await executeToolForAgent({
        name: toolName,
        arguments: toolArguments,
        agent: input.agent,
        callId: input.callId,
        signal: input.signal,
        timeoutMs: input.timeoutMs
      });
      if (!call.result.ok)
        return { ok: false, isError: call.result.isError, error: call.result.error, via: call.via, raw: call.result.raw };
      const value = goalValueOf(call.result.value);
      return {
        ok: true,
        isError: false,
        goal: value.goal,
        ...value.activation === undefined ? {} : { activation: value.activation },
        via: call.via,
        raw: call.result.raw
      };
    },
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
            submit: (message) => adapter.submitUserTurn(host.agent, message)
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
      return ctx.on("agent/pre-step", preStepWrapper(listener));
    },
    registerAgentPreStep(agent, listener) {
      const context = scopeContextOf(agent);
      if (typeof context?.on !== "function") {
        throw new Error("mpd-dsh-adapter: the agent's own scope exposes no on() — cannot register its agent/pre-step listener");
      }
      return context.on("agent/pre-step", preStepWrapper(listener));
    },
    webServerOf() {
      try {
        if (typeof ctx?.get !== "function")
          return;
        return ctx.get("webServer", false) ?? ctx.get("httpServer", false);
      } catch {
        return;
      }
    },
    onServiceBound(names, callback) {
      if (typeof ctx?.on !== "function")
        return () => {};
      const off = ctx.on("internal/service", (name) => {
        try {
          if (typeof name === "string" && names.includes(name))
            callback(name);
        } catch {}
      });
      return typeof off === "function" ? off : () => {};
    },
    hasTool(toolName, agent) {
      return toolDefinitionFor(toolName, agent) !== undefined;
    },
    toolRuntime() {
      return {
        get: (toolName, agent) => toolDefinitionFor(toolName, agent),
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
        return projectToolResult(raw);
      } catch (error) {
        return { ok: false, isError: true, error: errorMessage(error) };
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
    teamExecutor() {
      const override = (() => {
        try {
          const raw = typeof process !== "undefined" && process.env ? process.env.MPD_DSH_TEAM_EXECUTOR : undefined;
          return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : undefined;
        } catch {
          return;
        }
      })();
      const nativeReady = typeof service("subagents")?.startContinuable === "function";
      const officialReady = service("agentTeams") !== undefined;
      const chosen = override === "official" && officialReady ? "official" : override === "native" && nativeReady ? "native" : nativeReady ? "native" : officialReady ? "official" : "native";
      if (chosen === "official")
        return officialTeamExecutor();
      return nativeTeamExecutor(nativeReady ? override === undefined ? "native: the default backend — it needs nothing from the official plugin" : "native: chosen by MPD_DSH_TEAM_EXECUTOR=native" : "native UNAVAILABLE: the harness subagents service exposes no startContinuable(), and no team service is mounted either — every team call will refuse", nativeReady);
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
      const settings = settingsService();
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
        rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)");
        try {
          callback();
        } catch {}
        return;
      }
      try {
        ctx.inject(["settings"], (scoped) => {
          try {
            try {
              if (scopedSettings === undefined || scopedSettings === null)
                scopedSettings = scoped?.settings;
            } catch {}
            if (scopedSettings === undefined || scopedSettings === null) {
              try {
                scopedSettings = typeof scoped?.get === "function" ? scoped.get("settings") : undefined;
              } catch {}
            }
            if (scopedSettings === undefined || scopedSettings === null) {
              rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27");
            }
            callback();
          } catch {}
        });
      } catch {}
    },
    settingsRegister(namespace, schema, options) {
      const settings = settingsService();
      if (settings === undefined || settings === null) {
        return { ok: false, error: "settings service is unavailable" };
      }
      if (typeof settings.register !== "function") {
        return {
          ok: false,
          error: "the settings service is present but exposes no register() — harness 0.1.7-rc.2 replaced the namespace-registry model with the Cordis patch editor, where a plugin declares its editable fields in its own row Config with .volatile() (keys: " + Object.keys(settings).slice(0, 8).join(",") + ")"
        };
      }
      try {
        settings.register(namespace, schema, { ...options?.base === undefined ? {} : { base: options.base }, ...options?.applies === undefined ? {} : { applies: options.applies } });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    async settingsMutate(namespace, ops, expectedRevision) {
      const settings = settingsService();
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
    startAgentTurn(agent, message) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn");
      followup.call(agent, message);
    },
    cancelAgentTurn(agent, cause, options) {
      const cancel = agent?.cancel;
      if (typeof cancel !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn");
      cancel.call(agent, cause, options);
    },
    steerAgentTurn(agent, message) {
      const steer = agent?.steer;
      if (typeof steer !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn");
      steer.call(agent, message);
    },
    injectAgentMessage(agent, message) {
      const inject = agent?.inject;
      if (typeof inject !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it");
      inject.call(agent, message);
    },
    submitUserTurn(agent, message) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        return false;
      try {
        followup.call(agent, message);
        return true;
      } catch {
        return false;
      }
    }
  };
  return adapter;
}

// packages/mpd-tui-plugin/src/log.ts
function createLog(logger, prefix, env = process.env, sink) {
  let fallback;
  const emit = (level, message) => {
    const text = `[${prefix}] ${message}`;
    try {
      const hostSink = logger?.[level];
      if (typeof hostSink === "function") {
        hostSink.call(logger, text);
        return;
      }
    } catch {}
    if (level === "debug" && env.DSH_TUI_DEBUG === undefined)
      return;
    if (sink === undefined)
      return;
    try {
      fallback ??= sink();
      fallback.write(text);
    } catch {}
  };
  return {
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    debug: (message) => emit("debug", message)
  };
}

// packages/mpd-tui-adapter-plugin/src/index.ts
import { appendFileSync, mkdirSync as mkdirSync2, readdirSync, readFileSync as readFileSync2, statSync as statSync2, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join3 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var TUI_SEAMS = {
  scenes: "tuiScenes",
  status: "tuiStatus",
  renderers: "tuiRenderers",
  settingsSections: "tuiSettingsSections",
  shortcuts: "tuiShortcuts",
  dialogs: "tuiDialogs",
  commandTrees: "tuiCommandTrees",
  pluginHost: "tuiPluginHost",
  toast: "tuiToast",
  themes: "tuiThemes",
  pluginStorage: "tuiPluginStorage",
  messageObserver: "tuiMessageObserver",
  effectLedger: "tuiEffectLedger",
  workspaces: "tuiWorkspaces",
  panels: "tuiPanels",
  prompt: "tuiPrompt",
  commands: "commands",
  settings: "settings"
};
var TUI_SEAM_KEYS = [
  "scenes",
  "status",
  "renderers",
  "settingsSections",
  "shortcuts",
  "dialogs",
  "commandTrees",
  "pluginHost",
  "toast",
  "themes",
  "pluginStorage",
  "messageObserver",
  "effectLedger",
  "workspaces",
  "panels",
  "prompt",
  "commands",
  "settings"
];
function describeOutcome(outcome) {
  return outcome.detail === undefined ? `${outcome.id}(${outcome.state})` : `${outcome.id}(${outcome.state}: ${outcome.detail})`;
}
function reportOutcomes(sink, outcomes) {
  const attempted = outcomes.some((outcome) => outcome.state !== "absent");
  if (!attempted) {
    sink.warn("no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped");
    return "warned";
  }
  sink.info(`mpd TUI surfaces: ${outcomes.map((outcome) => describeOutcome(outcome)).join(" · ")}`);
  return "reported";
}
var DEFAULT_LOG_NAME = "mpd-tui.log";
var DEFAULT_LOG_CAP_BYTES = 1048576;
function defaultLogRoot() {
  const env = process.env.DSH_WORKSPACE_ROOT;
  if (typeof env === "string" && env.length > 0)
    return env;
  return process.cwd();
}
function createFileSink(options) {
  const fileName = typeof options.name === "string" && options.name.length > 0 ? options.name : DEFAULT_LOG_NAME;
  const cap = typeof options.capBytes === "number" && options.capBytes > 0 ? options.capBytes : DEFAULT_LOG_CAP_BYTES;
  const rootOf = () => {
    try {
      const resolved = typeof options.root === "function" ? options.root() : options.root;
      return typeof resolved === "string" && resolved.length > 0 ? resolved : defaultLogRoot();
    } catch {
      return defaultLogRoot();
    }
  };
  const pathOf = () => join3(rootOf(), ".mpd", "logs", fileName);
  return {
    path: pathOf,
    write(line) {
      try {
        const file = pathOf();
        mkdirSync2(dirname(file), { recursive: true });
        try {
          if (statSync2(file).size > cap) {
            const existing = readFileSync2(file, "utf8");
            writeFileSync(file, existing.slice(Math.floor(existing.length / 2)), "utf8");
          }
        } catch {}
        appendFileSync(file, `${line}
`, "utf8");
      } catch {}
    }
  };
}
var HOST_PACKAGE_PATH = ["node_modules", "@deepseek-harness-tui", "dsh-tui"];
var HOST_UI_MODULE = "lib/types/ui.js";
var HOST_ROOT_ENV = "MPD_DSH_TUI_HOST_ROOT";
var HOST_HOME_DIRS = [".dsh", ".dsh-tui"];
var HOST_ANCHOR_LEVELS = 8;
var HOST_LIVE_CONTEXT_MARKER = "internal_querier";
function readHostStdinValue(value) {
  try {
    if (typeof value !== "object" || value === null)
      return { detail: "the host stdin hook answered no context value" };
    const record = value;
    const marker = HOST_LIVE_CONTEXT_MARKER in record ? record[HOST_LIVE_CONTEXT_MARKER] : undefined;
    if (marker === undefined || marker === null) {
      return {
        detail: `the host hook resolved the StdinContext DEFAULT (no ${HOST_LIVE_CONTEXT_MARKER}) — the host module instance is not the one the TUI runs; the take-over stays absent`
      };
    }
    const emitter = record.internal_eventEmitter;
    if (emitter === undefined || emitter === null)
      return { detail: "the host stdin context carries no input emitter" };
    const bus = emitter;
    if (typeof bus.prependListener !== "function")
      return { detail: "the host input emitter has no prependListener" };
    if (typeof bus.removeListener !== "function")
      return { detail: "the host input emitter has no removeListener" };
    if (typeof bus.on !== "function")
      return { detail: "the host input emitter has no on" };
    return { emitter: bus };
  } catch (error) {
    return { detail: `the host stdin context could not be read: ${String(error?.message ?? error)}` };
  }
}
function hostRootCandidates(env = process.env, home = homedir2()) {
  const pinned = env[HOST_ROOT_ENV];
  if (typeof pinned === "string" && pinned.length > 0)
    return [pinned];
  const roots = [];
  const anchors = [];
  try {
    anchors.push(dirname(fileURLToPath(import.meta.url)));
  } catch {}
  const argv1 = process.argv[1];
  if (typeof argv1 === "string" && argv1.length > 0)
    anchors.push(dirname(argv1));
  for (const anchor of anchors) {
    let dir = anchor;
    for (let level = 0;level < HOST_ANCHOR_LEVELS; level += 1) {
      roots.push(join3(dir, ...HOST_PACKAGE_PATH));
      const parent = dirname(dir);
      if (parent === dir)
        break;
      dir = parent;
    }
  }
  const homes = [];
  if (typeof env.DSH_HOME === "string" && env.DSH_HOME.length > 0)
    homes.push(env.DSH_HOME);
  for (const name of HOST_HOME_DIRS)
    homes.push(join3(home, name));
  for (const root of homes) {
    let entries = [];
    try {
      entries = readdirSync(join3(root, "profiles"), { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.isDirectory())
        roots.push(join3(root, "profiles", entry.name, ...HOST_PACKAGE_PATH));
    }
  }
  return [...new Set(roots)];
}
async function probeHostInput(candidates) {
  let skew = "";
  if (candidates.length === 0)
    return { detail: `no candidate host root (no DSH profile carries ${HOST_PACKAGE_PATH.join("/")})` };
  for (const root of candidates) {
    const file = join3(root, HOST_UI_MODULE);
    try {
      if (!statSync2(file).isFile())
        continue;
    } catch {
      continue;
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      const hook = mod.useStdin;
      if (typeof hook !== "function") {
        skew = `${file} carries no useStdin export`;
        continue;
      }
      return { input: { useStdin: () => hook() }, root };
    } catch (error) {
      skew = `${file}: ${String(error?.message ?? error)}`;
    }
  }
  return { detail: skew.length > 0 ? skew : `no candidate carried a readable ${HOST_UI_MODULE} (${candidates.length} probed)` };
}
function defaultHostInputLog(line) {
  try {
    createFileSink({ root: defaultLogRoot }).write(line);
  } catch {}
}
function readableService(scoped, id) {
  if (scoped === undefined || scoped === null)
    return;
  if (typeof scoped.get === "function") {
    try {
      const found = scoped.get(id, false);
      if (found !== undefined && found !== null)
        return found;
    } catch {}
  }
  try {
    const property = scoped[id];
    if (property !== undefined && property !== null)
      return property;
  } catch {}
  return;
}
function serviceOf(ctx, id) {
  if (ctx === undefined || ctx === null || typeof ctx.get !== "function")
    return;
  try {
    const found = ctx.get(id, false);
    return found === undefined || found === null ? undefined : found;
  } catch {
    return;
  }
}
function newBindingStatus() {
  return { registered: false, bound: false, pending: [] };
}
function bindSeam(ctx, id, status, onBound) {
  if (ctx === undefined || ctx === null || typeof ctx.inject !== "function")
    return;
  try {
    ctx.inject([id], (scoped) => {
      if (status.bound)
        return;
      const service = readableService(scoped, id);
      if (service === undefined)
        return;
      status.service = service;
      status.scope = scoped;
      status.bound = true;
      const queued = status.pending.splice(0);
      for (const work of queued) {
        try {
          work(service, scoped);
        } catch {}
      }
      try {
        onBound?.();
      } catch {}
    });
    status.registered = true;
  } catch (error) {
    status.error = String(error?.message ?? error);
  }
}
function onService(ctx, id, setup, onActivated) {
  const status = newBindingStatus();
  status.pending.push((service, scope) => {
    setup(scope, service);
  });
  bindSeam(ctx, id, status, onActivated);
}
function effectOn(scoped, cleanup, label) {
  try {
    if (typeof scoped.effect === "function")
      scoped.effect(() => cleanup, label);
  } catch {}
}
function createTuiAdapter(ctx, options = {}) {
  const bindings = {};
  for (const key of TUI_SEAM_KEYS)
    bindings[key] = newBindingStatus();
  for (const key of TUI_SEAM_KEYS) {
    const id = TUI_SEAMS[key];
    const binding = bindings[key];
    bindSeam(ctx, id, binding);
    if (key !== "pluginHost")
      continue;
    if (binding.bound || !binding.registered)
      continue;
    const probed = serviceOf(ctx, id);
    if (probed === undefined)
      continue;
    binding.service = probed;
    binding.scope = ctx;
    binding.bound = true;
    const queued = binding.pending.splice(0);
    for (const work of queued) {
      try {
        work(probed, ctx);
      } catch {}
    }
  }
  const fallbackIdentity = ctx;
  let hostContact = options.hostInput;
  let hostState = options.hostInput !== undefined ? { state: "bound", kit: "probed", detail: "injected by the caller" } : options.probeHostContact === true ? { state: "pending" } : { state: "absent", detail: "this adapter did not probe for the host contact" };
  const hostWaiters = [];
  let rememberedHook;
  const currentHostInput = () => rememberedHook === undefined ? hostContact : { useStdin: () => rememberedHook?.() };
  const wakeHostWaiters = () => {
    const waiting = hostWaiters.splice(0);
    const input = currentHostInput();
    for (const listener of waiting) {
      try {
        listener(input);
      } catch {}
    }
  };
  const settleHostContact = (result) => {
    hostContact = result.input;
    hostState = result.input === undefined ? { state: "absent", ...result.root === undefined ? {} : { root: result.root }, detail: result.detail ?? "the installed DSH-TUI was not reachable" } : { state: "bound", kit: "probed", ...result.root === undefined ? {} : { root: result.root }, detail: "the host's own useStdin was loaded by file URL" };
    wakeHostWaiters();
    try {
      (options.hostInputLog ?? defaultHostInputLog)(result.input === undefined ? `[mpd-tui-adapter] host contact ABSENT: ${hostState.detail ?? ""} — the surfaces that need it stay inactive` : `[mpd-tui-adapter] host contact bound: ${hostState.root ?? "?"} (${HOST_UI_MODULE})`);
    } catch {}
  };
  if (options.hostInput === undefined && options.probeHostContact === true) {
    probeHostInput(hostRootCandidates()).then(settleHostContact, (error) => {
      settleHostContact({ detail: `host contact probe failed: ${String(error?.message ?? error)}` });
    });
  }
  const makeHandle = (key, initialDetail) => {
    const id = TUI_SEAMS[key];
    let outcome = { id, state: "absent", detail: initialDetail ?? `${id} was not injected` };
    return {
      outcome: () => outcome,
      bound: () => bindings[key].bound,
      record: (recorded) => {
        outcome = recorded.detail === undefined ? { id, state: recorded.state } : { id, state: recorded.state, detail: recorded.detail };
      }
    };
  };
  const whenBoundInternal = (key, work) => {
    const binding = bindings[key];
    if (binding.bound) {
      work(binding.service, binding.scope ?? ctx);
      return true;
    }
    binding.pending.push(work);
    return false;
  };
  const register = (key, handle, detail, call) => {
    whenBoundInternal(key, (service) => {
      try {
        call(service);
        handle.record({ state: "requested", detail });
      } catch (error) {
        handle.record({ state: "refused", detail: String(error?.message ?? error) });
      }
    });
  };
  const requestedDetail = (key, what) => `${what} requested for ${TUI_SEAMS[key]} (no host read-back)`;
  const adapter = {
    ctx,
    scenes: () => bindings.scenes.service,
    status: () => bindings.status.service,
    renderers: () => bindings.renderers.service,
    settingsSections: () => bindings.settingsSections.service,
    shortcuts: () => bindings.shortcuts.service,
    dialogs: () => bindings.dialogs.service,
    commandTrees: () => bindings.commandTrees.service,
    pluginHost: () => bindings.pluginHost.service,
    toast: () => bindings.toast.service,
    themes: () => bindings.themes.service,
    pluginStorage: () => bindings.pluginStorage.service,
    messageObserver: () => bindings.messageObserver.service,
    effectLedger: () => bindings.effectLedger.service,
    workspaces: () => bindings.workspaces.service,
    panels: () => bindings.panels.service,
    prompt: () => bindings.prompt.service,
    commands: () => bindings.commands.service,
    settings: () => bindings.settings.service,
    hostInput: () => currentHostInput(),
    rememberHostKit(kit) {
      const hook = typeof kit === "object" && kit !== null ? kit.useStdin : undefined;
      if (typeof hook !== "function")
        return false;
      const first = rememberedHook === undefined;
      rememberedHook = hook;
      hostState = { state: "bound", kit: "remembered", detail: "the host's own ui kit (handed to a scene render) carries useStdin" };
      Promise.resolve().then(wakeHostWaiters);
      if (!first)
        return true;
      try {
        (options.hostInputLog ?? defaultHostInputLog)(`[mpd-tui-adapter] host contact bound: remembered kit (a scene render handed us the host ui kit)`);
      } catch {}
      return true;
    },
    whenHostInput(listener) {
      if (hostState.state !== "pending") {
        try {
          listener(currentHostInput());
        } catch {}
        return () => {};
      }
      hostWaiters.push(listener);
      return () => {
        const at = hostWaiters.indexOf(listener);
        if (at >= 0)
          hostWaiters.splice(at, 1);
      };
    },
    registerStatusComponent(view) {
      const handle = makeHandle("status");
      whenBoundInternal("status", (service, scope) => {
        const status = service;
        if (typeof status?.registerView !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.registerView is missing on this host build` });
          return;
        }
        try {
          const disposer = status.registerView({
            key: view.key,
            component: view.component,
            ...view.maxRows === undefined ? {} : { maxRows: view.maxRows }
          }, scope);
          if (typeof disposer !== "function") {
            handle.record({ state: "refused", detail: `the host refused view ${view.key} (see its own warning for the reason)` });
            return;
          }
          effectOn(scope, disposer, view.label ?? `mpd-tui status view ${view.key}`);
          handle.record({ state: "requested", detail: `view ${view.key} requested (no host read-back)` });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerScene(descriptor, identity) {
      const handle = makeHandle("scenes");
      whenBoundInternal("scenes", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.scenes}.register is missing` });
          return;
        }
        try {
          const disposer = registry.register(descriptor, identity ?? fallbackIdentity);
          if (typeof disposer === "function")
            effectOn(bindings.scenes.scope ?? ctx, disposer, `mpd-tui scene ${descriptor.id}`);
          handle.record({ state: "requested", detail: `${descriptor.id} requested (no host read-back)` });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return {
        outcome: handle.outcome,
        bound: handle.bound,
        record: handle.record,
        openScene: (id) => adapter.openScene(id),
        closeScene: (id) => adapter.closeScene(id)
      };
    },
    openScene(id) {
      const registry = bindings.scenes.service;
      if (registry === undefined || typeof registry.open !== "function")
        return false;
      try {
        return registry.open(id) === true;
      } catch {
        return false;
      }
    },
    closeScene(id) {
      const registry = bindings.scenes.service;
      if (registry === undefined || typeof registry.close !== "function")
        return false;
      try {
        return registry.close(id) === true;
      } catch {
        return false;
      }
    },
    setStatus(key, text, identity) {
      const handle = makeHandle("status");
      whenBoundInternal("status", (service, scope) => {
        const status = service;
        if (typeof status?.set !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.set is missing` });
          return;
        }
        try {
          const disposer = status.set(key, text, scope);
          if (typeof disposer === "function")
            effectOn(bindings.status.scope ?? ctx, disposer, `mpd-tui status ${key}`);
          handle.record({
            state: "requested",
            detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated"
          });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerStatusView(view) {
      const handle = makeHandle("status");
      let refresh = () => {};
      whenBoundInternal("status", (service, scope) => {
        const status = service;
        if (typeof status?.set !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.set is missing` });
          return;
        }
        let disposer;
        let timer;
        let published;
        const publish = () => {
          try {
            const text = view.render();
            if (text === published)
              return;
            published = text;
            disposer = status.set(view.key, text, scope);
          } catch (error) {
            view.onError?.(error);
          }
        };
        publish();
        const intervalMs = typeof view.intervalMs === "number" ? view.intervalMs : 0;
        if (intervalMs > 0) {
          try {
            timer = setInterval(publish, intervalMs);
            timer.unref?.();
          } catch {
            timer = undefined;
          }
        }
        effectOn(scope, () => {
          if (timer !== undefined) {
            try {
              clearInterval(timer);
            } catch {}
            timer = undefined;
          }
          try {
            disposer?.();
          } catch {}
          try {
            status.set(view.key, undefined, scope);
          } catch {}
        }, view.label ?? `mpd-tui status ${view.key}`);
        refresh = publish;
        handle.record({
          state: "requested",
          detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated"
        });
      });
      return { outcome: handle.outcome, bound: handle.bound, record: handle.record, refresh: () => refresh() };
    },
    registerRenderer(type, renderer, identity) {
      const handle = makeHandle("renderers");
      whenBoundInternal("renderers", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.renderers}.register is missing` });
          return;
        }
        try {
          const disposer = registry.register(type, renderer, identity ?? fallbackIdentity);
          if (typeof disposer === "function")
            effectOn(bindings.renderers.scope ?? ctx, disposer, `mpd-tui renderer ${type}`);
          handle.record({
            state: "requested",
            detail: `${type} requested (no host read-back; a refusal also returns a disposer)`
          });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerSettingsSection(section, identity) {
      const handle = makeHandle("settingsSections");
      whenBoundInternal("settingsSections", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.settingsSections}.register is missing` });
          return;
        }
        const commit = (resolved) => {
          try {
            registry.register(resolved);
            handle.record({
              state: "requested",
              detail: `section ${resolved.ns} requested (no host read-back)`
            });
          } catch (error) {
            handle.record({ state: "refused", detail: String(error?.message ?? error) });
          }
        };
        if (typeof section !== "function") {
          commit(section);
          return;
        }
        handle.record({ state: "requested", detail: "section requested (awaiting the lazy section resolver)" });
        try {
          Promise.resolve(section()).then(commit, (error) => {
            handle.record({ state: "refused", detail: String(error?.message ?? error) });
          });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerShortcut(combo, options2, identity) {
      const handle = makeHandle("shortcuts");
      whenBoundInternal("shortcuts", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.shortcuts}.register is missing` });
          return;
        }
        try {
          const disposer = registry.register(combo, options2, identity ?? fallbackIdentity);
          if (typeof disposer === "function")
            effectOn(bindings.shortcuts.scope ?? ctx, disposer, `mpd-tui shortcut ${combo}`);
          handle.record({ state: "requested", detail: `${combo} requested` });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerCommandTree(provider) {
      const handle = makeHandle("commandTrees");
      register("commandTrees", handle, requestedDetail("commandTrees", `provider for /${provider.root}`), (service) => {
        if (typeof service?.register !== "function")
          throw new Error(`${TUI_SEAMS.commandTrees}.register is missing`);
        const disposer = service.register(provider);
        if (typeof disposer === "function")
          effectOn(bindings.commandTrees.scope ?? ctx, disposer, `mpd-tui command tree ${provider.root}`);
      });
      return handle;
    },
    registerPanel(descriptor) {
      const handle = makeHandle("panels");
      let finalId;
      let release;
      let disposed = false;
      const dispose = () => {
        if (disposed)
          return;
        disposed = true;
        const call = release;
        release = undefined;
        finalId = undefined;
        if (typeof call !== "function")
          return;
        try {
          call();
        } catch {}
      };
      whenBoundInternal("panels", (service, scope) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.panels}.register is missing` });
          return;
        }
        const before = new Set((typeof registry.list === "function" ? registry.list() ?? [] : []).map((row) => row.id));
        try {
          const disposer = registry.register(descriptor, scope);
          if (typeof disposer === "function") {
            release = disposer;
            effectOn(scope, dispose, `mpd-tui panel ${descriptor.id}`);
          }
          const readBack = typeof registry.list === "function" ? registry.list.bind(registry) : undefined;
          if (readBack !== undefined) {
            finalId = (readBack() ?? []).map((row) => row.id).find((id) => !before.has(id));
          }
          handle.record(finalId !== undefined ? { state: "confirmed", detail: `${finalId} registered` } : readBack !== undefined ? { state: "refused", detail: `${descriptor.id} refused (the host added no id to its own list() read-back)` } : { state: "requested", detail: `${descriptor.id} requested (the host exposes no panel read-back to prove it)` });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return { ...handle, id: () => finalId, dispose };
    },
    openPanel(id) {
      const handle = makeHandle("panels");
      let opened;
      whenBoundInternal("panels", (service) => {
        const registry = service;
        if (typeof registry?.open !== "function") {
          opened = false;
          handle.record({ state: "refused", detail: `${TUI_SEAMS.panels}.open is missing on this host build` });
          return;
        }
        try {
          opened = registry.open(id) === true;
          handle.record(opened ? { state: "confirmed", detail: `${id} handed to the side panel` } : { state: "refused", detail: `${id} refused (not this activation's panel, one open per 5000 ms, or no live panel consumer)` });
        } catch (error) {
          opened = false;
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return { ...handle, opened: () => opened };
    },
    panelSeamBound: () => bindings.panels.bound,
    requestDecisionEvent(event, listener, options2 = {}) {
      let supported = false;
      let granted;
      let disposerReturned = false;
      let error;
      let outcome = { id: TUI_SEAMS.pluginHost, state: "absent", detail: `${TUI_SEAMS.pluginHost} was not injected` };
      whenBoundInternal("pluginHost", (service, scope) => {
        const host = service;
        const identity = options2.identity ?? fallbackIdentity;
        if (typeof host?.subscribeDecision !== "function") {
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `${TUI_SEAMS.pluginHost}.subscribeDecision is missing` };
          return;
        }
        supported = true;
        try {
          const facade = host.grants;
          if (facade !== undefined && typeof facade.allows === "function")
            granted = facade.allows(identity, event, options2.scope ?? event) === true;
        } catch {
          granted = undefined;
        }
        try {
          const disposer = host.subscribeDecision(identity, event, listener, {
            ...options2.scope === undefined ? {} : { scope: options2.scope },
            ...options2.order === undefined ? {} : { order: options2.order }
          });
          disposerReturned = typeof disposer === "function";
          if (disposerReturned)
            effectOn(scope, disposer, `mpd-tui decision ${event}`);
        } catch (caught) {
          error = String(caught?.message ?? caught).replace(/\s+/gu, " ").trim().slice(0, 160);
          disposerReturned = false;
        }
        if (error !== undefined)
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: error };
        else if (!disposerReturned)
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: "subscribeDecision returned no disposer" };
        else if (granted === true)
          outcome = { id: TUI_SEAMS.pluginHost, state: "confirmed", detail: `${event} subscribed and authorised` };
        else if (granted === false)
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `no grant for ${event}` };
        else
          outcome = { id: TUI_SEAMS.pluginHost, state: "requested", detail: "grant state not queryable in this composition" };
      });
      return {
        supported: () => supported,
        granted: () => granted,
        disposerReturned: () => disposerReturned,
        error: () => error,
        outcome: () => outcome
      };
    },
    grantsAllows(permission, scope, identity) {
      const host = bindings.pluginHost.service;
      try {
        const facade = host?.grants;
        if (facade === undefined || typeof facade.allows !== "function")
          return;
        return facade.allows(identity ?? fallbackIdentity, permission, scope) === true;
      } catch {
        return;
      }
    },
    registerCommand(definition) {
      const handle = makeHandle("commands");
      register("commands", handle, `/${definition.name} requested (no host read-back at apply time)`, (service) => {
        if (typeof service?.register !== "function")
          throw new Error(`${TUI_SEAMS.commands}.register is missing`);
        const disposer = service.register(definition);
        if (typeof disposer === "function")
          effectOn(bindings.commands.scope ?? ctx, disposer, `mpd-tui command /${definition.name}`);
      });
      return handle;
    },
    registerSettingsNamespace(ns, schema, options2) {
      const handle = makeHandle("settings");
      register("settings", handle, `namespace ${ns} requested (no host read-back)`, (service) => {
        if (typeof service?.register !== "function")
          throw new Error(`${TUI_SEAMS.settings}.register is missing`);
        service.register(ns, schema, options2);
      });
      return handle;
    },
    whenBound(key, setup) {
      const handle = makeHandle(key);
      whenBoundInternal(key, (service, scope) => {
        handle.record({ state: "available", detail: "bound through the deferred inject form" });
        setup(service, scope, handle);
      });
      return handle;
    },
    skipped(key, detail) {
      const handle = makeHandle(key, detail);
      return handle;
    },
    capabilities() {
      const seams = {};
      let bound = 0;
      for (const key of TUI_SEAM_KEYS) {
        const live = bindings[key].bound;
        seams[key] = live;
        if (live)
          bound += 1;
      }
      return { seams, bound, total: TUI_SEAM_KEYS.length, hostInput: { ...hostState } };
    },
    seamOutcomes() {
      return TUI_SEAM_KEYS.map((key) => {
        const binding = bindings[key];
        const id = TUI_SEAMS[key];
        if (binding.bound)
          return { id, state: "available", detail: "bound through the deferred inject form" };
        if (binding.error !== undefined)
          return { id, state: "refused", detail: binding.error };
        return { id, state: "absent", detail: "not composed in this profile" };
      });
    },
    diagnosticSink(options2 = {}) {
      const root = options2.root ?? defaultLogRoot;
      return createFileSink({
        root,
        ...options2.name === undefined ? {} : { name: options2.name },
        ...options2.capBytes === undefined ? {} : { capBytes: options2.capBytes }
      });
    }
  };
  return adapter;
}
var SERVICE_NAME = "mpdTui";
function resolveTuiAdapter(ctx) {
  const get = ctx !== undefined && ctx !== null && typeof ctx.get === "function" ? ctx.get : undefined;
  if (get !== undefined) {
    try {
      const mounted = get.call(ctx, SERVICE_NAME);
      if (mounted !== undefined && mounted !== null)
        return mounted;
    } catch {}
  }
  return createTuiAdapter(ctx);
}

// packages/mpd-tui-plugin/src/state.ts
import { readFileSync as readFileSync3, readdirSync as readdirSync2 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join4 } from "node:path";

// packages/mpd-tui-plugin/src/sanitize.ts
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;
var WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;
function stripControl(value) {
  return value.replace(CONTROL, " ");
}
function collapse(value) {
  return value.replace(/\s+/gu, " ").trim();
}
function cellWidth(value) {
  let width = 0;
  for (const character of value)
    width += WIDE.test(character) ? 2 : 1;
  return width;
}
function clampCells(value, maxCells) {
  if (maxCells <= 0)
    return "";
  let out = "";
  let width = 0;
  for (const character of value) {
    const next = WIDE.test(character) ? 2 : 1;
    if (width + next > maxCells)
      break;
    out += character;
    width += next;
  }
  return out;
}
function scalarText(value, maxCells = 200) {
  const type = typeof value;
  if (type !== "string" && type !== "number" && type !== "boolean")
    return;
  if (type === "number" && !Number.isFinite(value))
    return;
  const raw = type === "string" ? value : String(value);
  return clampCells(collapse(stripControl(raw)), maxCells);
}
function scalarLines(value, maxLines = 100, maxCells = 400) {
  const items = Array.isArray(value) ? value : [value];
  const lines = [];
  for (const item of items) {
    if (lines.length >= maxLines)
      break;
    const text = scalarText(item, maxCells);
    if (text !== undefined && text !== "")
      lines.push(text);
  }
  return lines;
}
function field(payload, key, maxCells = 200) {
  if (payload === null || typeof payload !== "object")
    return;
  return scalarText(payload[key], maxCells);
}

// packages/mpd-tui-plugin/src/state.ts
var MAX_TEAMS = 20;
var MAX_WORKMATES = 200;
var MAX_TASKS = 5000;
var MAX_PROBLEMS = 5;
function readJson(path) {
  return JSON.parse(readFileSync3(path, "utf8"));
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function readTeam(views, problems) {
  let best;
  for (const view of views.slice(0, MAX_TEAMS)) {
    const tasks = Array.isArray(view.tasks) ? view.tasks.length : 0;
    if (best === undefined || tasks > (Array.isArray(best.tasks) ? best.tasks.length : 0))
      best = view;
  }
  if (best === undefined)
    return;
  const rows = Array.isArray(best.members) ? best.members : [];
  if (rows.length === 0 && (Array.isArray(best.tasks) ? best.tasks.length : 0) === 0)
    return;
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, failed: 0, claimed: 0, cancelled: 0, other: 0 };
  for (const task of (Array.isArray(best.tasks) ? best.tasks : []).slice(0, MAX_TASKS)) {
    if (!isRecord(task))
      continue;
    counts.total += 1;
    switch (String(task.status ?? "pending")) {
      case "completed":
        counts.completed += 1;
        break;
      case "in_progress":
        counts.inProgress += 1;
        break;
      case "pending":
        counts.pending += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "claimed":
        counts.claimed += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
      default:
        counts.other += 1;
    }
  }
  const teammates = rows.filter((member) => isRecord(member) && member.role !== "lead");
  const active = teammates.some((member) => member.status === "running" || member.status === "provisioning");
  if (views.length > MAX_TEAMS)
    problems.push(`team readout truncated to ${MAX_TEAMS} entries`);
  return {
    id: scalarText(best.teamId, 60) ?? "?",
    name: scalarText(best.leadName, 80) ?? "?",
    phase: active ? "active" : "idle",
    members: teammates.length,
    tasks: counts
  };
}
function readRecordTeam(record) {
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, failed: 0, claimed: 0, cancelled: 0, other: 0 };
  for (const task of record.tasks.slice(0, MAX_TASKS)) {
    counts.total += 1;
    switch (task.status) {
      case "completed":
        counts.completed += 1;
        break;
      case "in_progress":
        counts.inProgress += 1;
        break;
      case "pending":
        counts.pending += 1;
        break;
      case "claimed":
        counts.claimed += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
      default:
        counts.other += 1;
    }
  }
  return {
    id: scalarText(record.teamId, 60) ?? "?",
    name: scalarText(record.name, 80) ?? "?",
    phase: record.endedAt !== undefined ? "ended" : record.approvedAt === undefined ? "staged" : record.phase,
    description: scalarText(record.description, 200),
    members: record.members.length,
    tasks: counts
  };
}
function readBoulder(root, problems) {
  const path = join4(root, ".mpd", "boulder.json");
  let document;
  try {
    document = readJson(path);
  } catch (error) {
    const code = error?.code;
    if (code !== "ENOENT")
      problems.push(`boulder.json: ${code === undefined ? "unreadable" : "invalid JSON"}`);
    return;
  }
  if (!isRecord(document))
    return;
  const raw = isRecord(document.works) ? Object.values(document.works) : asArray(document.works);
  const summary = { works: 0, active: 0, completed: 0, paused: 0, abandoned: 0 };
  for (const work of raw) {
    if (!isRecord(work))
      continue;
    summary.works += 1;
    const status = String(work.status ?? "active");
    if (status === "active")
      summary.active += 1;
    else if (status === "completed")
      summary.completed += 1;
    else if (status === "paused")
      summary.paused += 1;
    else if (status === "abandoned")
      summary.abandoned += 1;
    const plan = scalarText(work.plan_name ?? work.active_plan, 120);
    if (plan !== undefined && (summary.newestPlan === undefined || plan > summary.newestPlan))
      summary.newestPlan = plan;
  }
  return summary;
}
function readPlans(root) {
  const dir = join4(root, ".mpd", "plans");
  try {
    const names = readdirSync2(dir).filter((name) => name.endsWith(".md")).sort();
    return { count: names.length, newest: scalarText(names[names.length - 1], 120) };
  } catch {
    return { count: 0 };
  }
}
function readWorkmates(home) {
  const dir = join4(home, ".mpd", "workmate");
  try {
    const names = readdirSync2(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).slice(0, MAX_WORKMATES);
    const present = [];
    for (const name of names) {
      try {
        const meta = readJson(join4(dir, name, "meta.json"));
        const label = isRecord(meta) ? scalarText(meta.name ?? name, 60) : undefined;
        present.push(label ?? scalarText(name, 60) ?? "?");
      } catch {}
    }
    present.sort();
    return { count: present.length, names: present };
  } catch {
    return { count: 0, names: [] };
  }
}
function readBoardState(workspace, home = homedir3(), views = [], records = []) {
  const problems = [];
  const state = {
    workspace,
    home,
    plans: readPlans(workspace),
    workmates: readWorkmates(home),
    problems
  };
  try {
    const principal = records.find((record) => record.endedAt === undefined) ?? records[0];
    state.team = principal === undefined ? readTeam(views, problems) : readRecordTeam(principal);
  } catch {
    problems.push("team state unreadable");
  }
  try {
    state.boulder = readBoulder(workspace, problems);
  } catch {
    problems.push("boulder state unreadable");
  }
  if (problems.length > MAX_PROBLEMS)
    problems.length = MAX_PROBLEMS;
  return state;
}
var NO_LIVE_SESSION_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)";
var AMBIGUOUS_MULTI_ROOT_NOTICE = "saved to settings — not written to any file: several live workspaces, so the target is ambiguous (see the log for the candidates)";
function statusLine(state, notice) {
  const parts = [];
  if (state.team !== undefined) {
    const done = state.team.tasks.completed;
    const total = state.team.tasks.total;
    parts.push(t("status.teamRow", { name: state.team.name, members: state.team.members, done: String(done), total: String(total) }));
    if (state.team.tasks.failed > 0)
      parts.push(t("status.failed", { n: String(state.team.tasks.failed) }));
  } else {
    parts.push(t("status.teamNone"));
  }
  if (state.boulder !== undefined && state.boulder.works > 0) {
    parts.push(t("status.boulder", { active: String(state.boulder.active), works: String(state.boulder.works) }));
  }
  parts.push(t("status.plans", { n: String(state.plans.count) }));
  parts.push(t("status.workmates", { n: String(state.workmates.count) }));
  if (state.problems.length > 0)
    parts.push(t("status.notes", { n: String(state.problems.length) }));
  if (notice !== undefined && notice.length > 0)
    parts.push(notice);
  return `mpd: ${parts.join(" · ")}`;
}
function boardLines(state, holds = []) {
  const lines = [];
  lines.push(`workspace  ${state.workspace}`);
  if (state.team !== undefined) {
    const tasks = state.team.tasks;
    lines.push("");
    lines.push(`team       ${state.team.name} (${state.team.id}) · phase ${state.team.phase}`);
    lines.push(`members    ${state.team.members}`);
    lines.push(`tasks      ${tasks.total} total · ${tasks.completed} completed · ${tasks.inProgress} in progress · ${tasks.pending} pending · ${tasks.claimed} claimed · ${tasks.failed} failed`);
    if (state.team.phase === "staged" && state.team.planReviewState !== undefined) {
      lines.push(`team-plan  ${state.team.planReviewState}`);
    }
  } else {
    lines.push("");
    lines.push(t("board.noTeam"));
  }
  if (holds.length > 0)
    lines.push(`team-hold  held (${holds.join(", ")})`);
  lines.push("");
  if (state.boulder !== undefined && state.boulder.works > 0) {
    lines.push(`boulder    ${state.boulder.works} work(s) · ${state.boulder.active} active · ${state.boulder.completed} completed${state.boulder.newestPlan === undefined ? "" : ` · newest ${state.boulder.newestPlan}`}`);
  } else {
    lines.push(t("board.noBoulder"));
  }
  lines.push(`plans      ${state.plans.count}${state.plans.newest === undefined ? "" : ` · newest ${state.plans.newest}`}`);
  lines.push(`workmates  ${state.workmates.count}${state.workmates.names.length === 0 ? "" : ` · ${state.workmates.names.slice(0, 6).join(", ")}`}`);
  if (state.problems.length > 0) {
    lines.push("");
    for (const problem of state.problems)
      lines.push(`note       ${problem}`);
  }
  return lines;
}

// packages/mpd-tui-plugin/src/status.ts
var STATUS_KEY = "mpd-tui";
function registerStatus(ctx, tui, log, workspaceRoot, home, intervalMs, bridgeNotice, teamViews, teamRecords) {
  const view = tui.registerStatusView({
    key: STATUS_KEY,
    intervalMs,
    identity: ctx,
    label: "mpd-tui status line",
    render: () => statusLine(readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? []), bridgeNotice?.()),
    onError: (error) => log.debug(`status refresh failed: ${String(error?.message ?? error)}`)
  });
  return { outcome: () => view.outcome(), refresh: () => view.refresh() };
}
// packages/mpd-tui-plugin/src/registration.ts
import { createRequire } from "node:module";
import { readdirSync as readdirSync3 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var BOARD_OPENED_EVENT = "mpd-tui/board-opened";
function candidateAnchors(env = process.env, home = homedir4()) {
  const anchors = [];
  try {
    anchors.push(fileURLToPath2(import.meta.url));
  } catch {}
  const argv1 = process.argv[1];
  if (typeof argv1 === "string" && argv1.length > 0)
    anchors.push(argv1);
  const homes = [];
  if (typeof env.DSH_HOME === "string" && env.DSH_HOME.length > 0)
    homes.push(env.DSH_HOME);
  homes.push(join5(home, ".dsh"), join5(home, ".dsh-tui"));
  for (const root of homes) {
    const profiles = join5(root, "profiles");
    try {
      for (const entry of readdirSync3(profiles, { withFileTypes: true })) {
        if (entry.isDirectory())
          anchors.push(join5(profiles, entry.name, "package.json"));
      }
    } catch {}
  }
  return [...new Set(anchors)];
}
function registerInto(moduleLike, type) {
  const set = moduleLike?.KNOWN_SESSION_EVENT_TYPES;
  if (!(set instanceof Set))
    return false;
  try {
    if (set.has(type))
      return true;
  } catch {
    return false;
  }
  try {
    set.add(type);
  } catch {}
  try {
    return set.has(type) === true;
  } catch {
    return false;
  }
}
function registerLogOnlyEventType(type, log) {
  let verified = false;
  let resolved = 0;
  for (const anchor of candidateAnchors()) {
    try {
      const required = createRequire(anchor)("@deepseek-ai/dsh-session");
      resolved += 1;
      if (registerInto(required, type))
        verified = true;
    } catch {}
  }
  log.debug(`session event type ${type}: ${verified ? "registered" : "NOT registered"} (${resolved} dsh-session copy/copies reached)`);
  return verified;
}

// packages/mpd-tui-plugin/src/renderers.ts
var TRANSCRIPT_TYPES = [
  "agent-teams/team-created",
  "agent-teams/member-added",
  "agent-teams/member-removed",
  "agent-teams/task-created",
  "agent-teams/task-updated",
  "agent-teams/team-halted",
  "agent-teams/team-resumed",
  "agent-teams/team-deleted",
  "agent-teams/plan-discarded",
  "agent-teams/message-sent",
  BOARD_OPENED_EVENT
];
function bullet(payload, keys) {
  const parts = [];
  for (const key of keys) {
    const value = field(payload, key, 120);
    if (value !== undefined && value !== "")
      parts.push(`${key}=${value}`);
  }
  return parts;
}
var TRANSCRIPT_RENDERERS = {
  "agent-teams/team-created": (payload) => ({
    title: "mpd team created",
    lines: [field(payload, "name", 80) ?? "?", `team ${field(payload, "teamId", 60) ?? "?"}`, ...bullet(payload, ["profile", "captainSessionId"])]
  }),
  "agent-teams/member-added": (payload) => ({
    title: "mpd team member added",
    lines: [field(payload, "name", 80) ?? "?", ...bullet(payload, ["role", "memberId"])]
  }),
  "agent-teams/member-removed": (payload) => ({
    title: "mpd team member removed",
    lines: [field(payload, "name", 80) ?? field(payload, "memberId", 60) ?? "?"]
  }),
  "agent-teams/task-created": (payload) => ({
    title: "mpd team task created",
    lines: [
      `${field(payload, "taskId", 40) ?? "?"} ${field(payload, "subject", 160) ?? ""}`.trim(),
      ...bullet(payload, ["assignee", "kind", "round"])
    ]
  }),
  "agent-teams/task-updated": (payload) => ({
    title: "mpd team task updated",
    lines: [
      `${field(payload, "taskId", 40) ?? "?"} -> ${field(payload, "status", 40) ?? "?"}`,
      ...bullet(payload, ["assignee", "attempt", "verdict"]),
      ...scalarLines(field(payload, "output", 400) ?? [], 6, 400)
    ]
  }),
  "agent-teams/team-halted": (payload) => ({
    title: "mpd team halted",
    lines: [`cancelled ${field(payload, "cancelledTasks", 20) ?? "?"} task(s)`]
  }),
  "agent-teams/team-resumed": (payload) => ({
    title: "mpd team resumed",
    lines: [field(payload, "reason", 200) ?? "(no reason recorded)"]
  }),
  "agent-teams/team-deleted": (payload) => ({
    title: "mpd team deleted",
    lines: [field(payload, "teamId", 60) ?? "?"]
  }),
  "agent-teams/plan-discarded": (payload) => ({
    title: "mpd staged plan discarded",
    lines: [field(payload, "teamId", 60) ?? "?"]
  }),
  "agent-teams/message-sent": (payload) => ({
    title: "mpd team message",
    lines: [
      `${field(payload, "from", 60) ?? "?"} -> ${field(payload, "to", 60) ?? "?"}`,
      ...scalarLines(field(payload, "content", 400) ?? [], 12, 400)
    ]
  }),
  [BOARD_OPENED_EVENT]: (payload) => {
    const view = field(payload, "view", 120) ?? "board";
    const via = field(payload, "via", 20) ?? "?";
    const stamp = payload?.at;
    const at = typeof stamp === "number" && Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined;
    return { title: "mpd board", lines: [`${view} opened via ${via}${at === undefined ? "" : ` at ${at}`}`] };
  }
};
function registerRenderers(ctx, tui, log) {
  const seam = tui.whenBound("renderers", (_service, _scope, handle) => {
    const registry = tui.renderers();
    if (typeof registry?.register !== "function") {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.renderers}.register is missing` });
      return;
    }
    let requested = 0;
    let threw = 0;
    for (const type of TRANSCRIPT_TYPES) {
      const render = TRANSCRIPT_RENDERERS[type];
      if (render === undefined)
        continue;
      const registration = tui.registerRenderer(type, (payload) => {
        try {
          const result = render(payload);
          if (result === undefined)
            return;
          const title = scalarText(result.title, 120);
          return { ...title === undefined ? {} : { title }, lines: scalarLines(result.lines, 100, 400) };
        } catch {
          return;
        }
      }, ctx);
      const measured = registration.outcome();
      if (measured.state === "requested")
        requested += 1;
      else if (measured.state === "refused") {
        threw += 1;
        log.debug(`transcript renderer ${type} refused: ${measured.detail ?? "unknown"}`);
      }
    }
    handle.record(requested === 0 ? { state: "refused", detail: `every renderer registration was refused (${threw} threw)` } : { state: "requested", detail: `${requested}/${TRANSCRIPT_TYPES.length} renderer(s) requested (no host read-back; a refusal also returns a disposer)` });
  });
  return { outcome: () => seam.outcome() };
}

// packages/mpd-config-plugin/src/settings-schema.ts
var import_schemastery = __toESM(require_lib(), 1);
var SETTINGS_NS = "mpd";
var TEAM_MODEL_SLOTS = ["slot1", "slot2", "slot3", "slot4"];
var TEAM_MODEL_SLOT_DEFAULTS = {
  slot1: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
  slot2: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  slot3: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  slot4: { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", reasoningEffort: "high" }
};
var TEAM_MODEL_FALLBACK_OPTIONS = {
  provider: ["deepseek-official"],
  model: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"],
  reasoningEffort: ["off", "low", "high", "max"]
};
function teamModelSlotSchema(slot) {
  return import_schemastery.default.object({
    provider: import_schemastery.default.string().default(slot.provider),
    model: import_schemastery.default.string().default(slot.model),
    reasoningEffort: import_schemastery.default.string().default(slot.reasoningEffort)
  });
}
var SettingsSchema = import_schemastery.default.object({
  hashline: import_schemastery.default.object({ maxDiffChars: import_schemastery.default.number().default(20000) }),
  commentChecker: import_schemastery.default.object({ autoCheck: import_schemastery.default.boolean().default(true) }),
  ulw: import_schemastery.default.object({ maxRounds: import_schemastery.default.number().default(6) }),
  memory: import_schemastery.default.object({ vcs: import_schemastery.default.union([import_schemastery.default.const("git"), import_schemastery.default.const("svn")]).default("git") }),
  team: import_schemastery.default.object({ stateDir: import_schemastery.default.string().default(".mpd/team") }),
  boulder: import_schemastery.default.object({ dir: import_schemastery.default.string().required(false) }),
  teamModels: import_schemastery.default.object({
    slot1: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot1),
    slot2: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot2),
    slot3: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot3),
    slot4: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot4)
  }),
  watchdog: import_schemastery.default.object({
    enabled: import_schemastery.default.boolean().default(true),
    warnSilenceMs: import_schemastery.default.number().default(600000),
    tickIntervalMs: import_schemastery.default.number().default(15000),
    warnStreakToEscalate: import_schemastery.default.number().default(6),
    actionOnEscalate: import_schemastery.default.union([import_schemastery.default.const("pause"), import_schemastery.default.const("warn-only")]).default("warn-only"),
    toolInFlightMaxMs: import_schemastery.default.number().default(900000),
    holdTtlMs: import_schemastery.default.number().default(900000)
  }),
  tui: import_schemastery.default.object({ dashboardKey: import_schemastery.default.boolean().default(true) })
});
var BRIDGE_DISCLOSURE = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount) — it applies at the next dsh boot, because the file-derived base is fixed for the running process's lifetime";
var BRIDGE_NOT_LOST = "the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session";
function knobHint(key, semantics) {
  const pointer = `mpd.jsonc ${key}`;
  return semantics === undefined || semantics.length === 0 ? pointer : `${semantics} (${pointer})`;
}
var BRIDGE_SECTION_NOTICE = `${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`;
var TEAM_MODEL_SLOT_GROUPS = {
  slot1: { zh: "重推理成员", en: "heavy members", members: ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"] },
  slot2: { zh: "分析型成员", en: "analysis members", members: ["Researcher", "Explorer", "Plan Reviewer"] },
  slot3: { zh: "执行型成员", en: "execution members", members: ["Deep Worker", "Junior Engineer"] },
  slot4: { zh: "视觉成员", en: "vision member", members: ["Vision Analyst"] }
};
var TEAM_MODEL_LEAF_TEMPLATES = {
  provider: {
    en: "The provider half of this slot. The slots are the default model route of team members: when a team is created, the {group} ({members}) start on this slot's provider + model + reasoning effort. What changing it does: those members take the new route at the next team creation, and an unusable value makes team creation FAIL loudly, naming the member and the slot — it never silently substitutes another model. Vision Analyst is the vision member: slot 4 drives it.",
    zh: "这一档的提供商。各槽位合起来是 team 成员的默认模型路由：建队时，{group}（{members}）会按本档的 提供商+模型+推理强度 启动。改它的影响：这些成员下次建队即走新路由；填成不可用会让建队直接失败并点名成员与槽位，不会静默换模型。Vision Analyst 是视觉成员：由槽位 4 驱动。"
  },
  model: {
    en: "This slot's model. Together with the provider above, it decides the model the {group} ({members}) start on. What changing it does: same as above — effective at the next team creation; a model the provider does not offer makes team creation fail with the member and slot named.",
    zh: "这一档的模型。与上面的提供商共同决定 {group}（{members}）建队时使用的模型。改它的影响：同上，下次建队生效；模型与提供商不匹配、或该提供商没有这个模型时，建队会点名失败。"
  },
  reasoningEffort: {
    en: "This slot's reasoning effort (off / low / high / max). It sets how much the {group} ({members}) think when a team is created: max is the strongest, high the usual balance, low cheaper, off disables reasoning. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot.",
    zh: "这一档的推理强度（off / low / high / max）。它决定 {group}（{members}）建队时的思考深度：max 最强、high 是常规平衡、low 更省、off 关闭思考。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。"
  }
};
var TEAM_MODEL_SLOT_LEAF_OVERRIDES = {
  slot4: {
    provider: {
      en: "The provider half of this slot. It drives Vision Analyst only (the one member that reads images, diagrams and screenshots). What changing it does: effective at the next team creation; an unusable value fails team creation loudly, naming the member and the slot. The model here must be a vision model that accepts image input (for example deepseek-v4-flash-vision-exp) — a text-only model breaks image analysis.",
      zh: "这一档的提供商。它只驱动 Vision Analyst（唯一负责看图/读图/分析截图的成员）。改它的影响：下次建队生效；填成不可用会让建队直接失败并点名成员与槽位。注意本档的模型必须是支持图像输入的视觉模型（例如 deepseek-v4-flash-vision-exp），换成纯文本模型会让看图任务失败。"
    },
    model: {
      en: "This slot's model. It MUST accept image input: Vision Analyst's whole value is reading images, and a text-only model makes its image tasks fail. What changing it does: effective at the next team creation.",
      zh: "这一档的模型。必须选支持图像输入的模型：Vision Analyst 的全部价值在于读图，纯文本模型会让它的读图任务直接失败。改它的影响：下次建队生效。"
    },
    reasoningEffort: {
      en: "This slot's reasoning effort (off / low / high / max). It sets how much Vision Analyst thinks while reading an image. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot.",
      zh: "这一档的推理强度（off / low / high / max）。决定 Vision Analyst 读图时的思考深度。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。"
    }
  }
};
function teamModelMembers(slot, lang) {
  return TEAM_MODEL_SLOT_GROUPS[slot].members.join(lang === "zh" ? "、" : ", ");
}
function teamModelLeafSentence(slot, leaf, lang) {
  const override = TEAM_MODEL_SLOT_LEAF_OVERRIDES[slot]?.[leaf];
  if (override !== undefined)
    return override[lang];
  return TEAM_MODEL_LEAF_TEMPLATES[leaf][lang].split("{group}").join(TEAM_MODEL_SLOT_GROUPS[slot][lang]).split("{members}").join(teamModelMembers(slot, lang));
}
var TEAM_MODEL_KNOBS = TEAM_MODEL_SLOTS.flatMap((slot) => {
  const index = TEAM_MODEL_SLOTS.indexOf(slot) + 1;
  const group = TEAM_MODEL_SLOT_GROUPS[slot];
  const leaves = [
    { leaf: "provider", label: "provider", zh: "提供商" },
    { leaf: "model", label: "model", zh: "模型" },
    { leaf: "reasoningEffort", label: "reasoning effort", zh: "推理强度" }
  ];
  return leaves.map(({ leaf, label, zh }) => ({
    path: ["teamModels", slot, leaf],
    label: `Slot ${index} ${label} (${group.en})`,
    zh: `槽位 ${index} ${zh}（${group.zh}）`,
    kind: "select",
    options: TEAM_MODEL_FALLBACK_OPTIONS[leaf],
    semantics: teamModelLeafSentence(slot, leaf, "en"),
    semanticsZh: teamModelLeafSentence(slot, leaf, "zh"),
    hint: knobHint(`teamModels.${slot}.${leaf}`, teamModelLeafSentence(slot, leaf, "en"))
  }));
});
var SETTINGS_KNOBS = [
  { path: ["hashline", "maxDiffChars"], label: "Inline diff limit", zh: "行内 diff 上限", kind: "number" },
  { path: ["commentChecker", "autoCheck"], label: "Comment checker", zh: "注释检查", kind: "boolean" },
  { path: ["ulw", "maxRounds"], label: "Ultrawork rounds", zh: "Ultrawork 轮数", kind: "number" },
  { path: ["memory", "vcs"], label: "Memory backend", zh: "记忆后端", kind: "select", options: ["git", "svn"] },
  { path: ["team", "stateDir"], label: "Team state directory", zh: "团队状态目录", kind: "text" },
  { path: ["boulder", "dir"], label: "Boulder directory", zh: "Boulder 目录", kind: "text" },
  { path: ["watchdog", "enabled"], label: "Watchdog enabled", zh: "看门狗启用", kind: "boolean" },
  { path: ["watchdog", "warnSilenceMs"], label: "Silence warning threshold (ms)", zh: "静默告警阈值（毫秒）", kind: "number" },
  { path: ["watchdog", "tickIntervalMs"], label: "Watchdog tick interval (ms)", zh: "看门狗轮询间隔（毫秒）", kind: "number" },
  { path: ["watchdog", "warnStreakToEscalate"], label: "Warn streak before escalation", zh: "升级前连续告警次数", kind: "number" },
  { path: ["watchdog", "actionOnEscalate"], label: "Action on escalation", zh: "升级时的动作", kind: "select", options: ["pause", "warn-only"] },
  { path: ["watchdog", "toolInFlightMaxMs"], label: "Tool-in-flight bound (ms, 0 = no bound)", zh: "工具在飞上限（毫秒，0 表示不设上限）", kind: "number", hint: "how long ONE tool call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a `tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables the bound" },
  { path: ["watchdog", "holdTtlMs"], label: "Hold TTL (ms, 0 = no expiry)", zh: "暂停持有有效期（毫秒，0 表示不设有效期）", kind: "number", hint: "how long a watchdog hold may stay latched before it auto-releases: past this bound the hold releases itself and changes ZERO team bytes, and activity newer than the hold releases it sooner — `0` disables the expiry" },
  ...TEAM_MODEL_KNOBS,
  { path: ["tui", "dashboardKey"], label: "Ctrl+A dependency view (old dsh-tui builds)", zh: "Ctrl+A 依赖视图（旧版 dsh-tui）", kind: "boolean", hint: "applies to hosts WITHOUT the sidebar panel seam (dsh-tui before 0.13.0) only: while MPD's team projection has a team with at least one task, Ctrl+A opens MPD's merged dependency view instead of the host's subagent dashboard, and with no team Ctrl+A keeps opening the host dashboard — on a host that offers the panel seam, Ctrl+A always keeps its host dashboard meaning and the merged view opens through alt+a and /mpd panel" }
];

// packages/mpd-tui-plugin/src/settings.ts
var SETTINGS_ENTRY = "mpd-config";
function knobHint2(key, semantics) {
  const pointer = `mpd.jsonc ${key}`;
  return semantics === undefined || semantics.length === 0 ? pointer : `${semantics} (${pointer})`;
}
function knobHintPair(knob) {
  const key = knob.path.join(".");
  return { zh: knobHint2(key, knob.semanticsZh), en: knobHint2(key, knob.semantics) };
}
var TEAM_MODEL_LEAVES = ["provider", "model", "reasoningEffort"];
function dedupeOptions(pairs) {
  const seen = new Set;
  const out = [];
  for (const pair of pairs) {
    if (pair.value.length === 0 || seen.has(pair.value))
      continue;
    seen.add(pair.value);
    out.push(pair);
  }
  return out;
}
function declaredOptions(leaf) {
  return TEAM_MODEL_FALLBACK_OPTIONS[leaf].map((value) => ({ value, label: value }));
}
function optionLabel(name, id) {
  return typeof name === "string" && name.length > 0 ? name : id;
}
function teamModelOptionLists(catalog) {
  const providers = [];
  const models = [];
  const efforts = [];
  if (catalog !== undefined && catalog.degraded !== true) {
    const rawProviders = Array.isArray(catalog.providers) ? catalog.providers : [];
    for (const provider of rawProviders) {
      if (typeof provider?.id !== "string" || provider.id.length === 0)
        continue;
      providers.push({ value: provider.id, label: optionLabel(provider.name, provider.id) });
      const rawModels = Array.isArray(provider.models) ? provider.models : [];
      for (const model of rawModels) {
        if (typeof model?.id !== "string" || model.id.length === 0)
          continue;
        models.push({ value: model.id, label: optionLabel(model.name, model.id) });
        const rawEfforts = Array.isArray(model.efforts) ? model.efforts : [];
        for (const effort of rawEfforts) {
          if (typeof effort?.id !== "string" || effort.id.length === 0)
            continue;
          efforts.push({ value: effort.id, label: optionLabel(effort.name, effort.id) });
        }
      }
    }
  }
  const live = { provider: dedupeOptions(providers), model: dedupeOptions(models), reasoningEffort: dedupeOptions(efforts) };
  const pick3 = (leaf) => live[leaf].length > 0 ? live[leaf] : declaredOptions(leaf);
  return {
    provider: pick3("provider"),
    model: pick3("model"),
    reasoningEffort: pick3("reasoningEffort"),
    source: {
      provider: live.provider.length > 0 ? "live" : "declared",
      model: live.model.length > 0 ? "live" : "declared",
      reasoningEffort: live.reasoningEffort.length > 0 ? "live" : "declared"
    }
  };
}
function slotLeafOf(path) {
  if (path[0] !== "teamModels")
    return;
  const leaf = path[2];
  return TEAM_MODEL_LEAVES.find((candidate) => candidate === leaf);
}
function isServed(provider) {
  try {
    if (typeof provider.describe === "function") {
      const described = provider.describe();
      if (Array.isArray(described) && described.some((entry) => String(entry?.ns ?? "") === SETTINGS_NS))
        return true;
    }
  } catch {}
  try {
    return typeof provider.get === "function" && provider.get(SETTINGS_NS) !== undefined;
  } catch {
    return false;
  }
}
function configPluginPresent(ctx) {
  try {
    return typeof ctx.get === "function" && ctx.get("mpdConfig") !== undefined;
  } catch {
    return false;
  }
}
function declaredField(knob) {
  const hints = knobHintPair(knob);
  return {
    path: [...knob.path],
    label: knob.label,
    descriptions: { zh: knob.zh },
    hint: hints.en,
    ...hints.zh === hints.en ? {} : { hintDescriptions: { zh: hints.zh } },
    kind: knob.kind,
    ...knob.options === undefined ? {} : { options: knob.options.map((value) => ({ value, label: value })) }
  };
}
var DASHBOARD_TAKEOVER_KNOB = "tui.dashboardKey";
var SETTINGS_FIELDS = SETTINGS_KNOBS.map(declaredField);
function settingsFields(lists) {
  return SETTINGS_KNOBS.map((knob) => {
    const leaf = slotLeafOf(knob.path);
    const field2 = declaredField(knob);
    return leaf === undefined ? field2 : { ...field2, options: lists[leaf] };
  });
}
var SECTION_NOTICE = `${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`;
var SETTINGS_SECTION = {
  ns: SETTINGS_ENTRY,
  title: "MPD bundle",
  descriptions: { zh: `MPD 插件包 · ${SECTION_NOTICE}`, en: `MPD bundle · ${SECTION_NOTICE}` },
  fields: SETTINGS_FIELDS
};
function resolveCatalogReader(ctx) {
  try {
    const mounted = serviceOf(ctx, "mpdDsh");
    if (mounted !== undefined)
      return mounted;
  } catch {}
  return createDshAdapter(ctx);
}
function registerSettingsSection(ctx, tui, log, adapterOverride) {
  let namespace = { state: "absent", detail: "settings was not injected" };
  let section;
  const catalogReader = adapterOverride ?? resolveCatalogReader(ctx);
  tui.whenBound("settings", (service, _scope, handle) => {
    const provider = service;
    if (typeof provider?.register !== "function") {
      namespace = { state: "refused", detail: "settings.register is missing" };
      handle.record(namespace);
      return;
    }
    if (configPluginPresent(ctx)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is owned by mpd-config in this composition — the fallback registration was skipped` };
      log.info(`settings namespace ${SETTINGS_NS}: mpd-config owns the registration — fallback skipped (design §10.1)`);
      handle.record(namespace);
      return;
    }
    if (isServed(provider)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is already served by mpd-config — the fallback registration was skipped` };
      log.info(`settings namespace ${SETTINGS_NS} is already served — fallback registration skipped (design §10.1)`);
      handle.record(namespace);
      return;
    }
    const registered = tui.registerSettingsNamespace(SETTINGS_NS, SettingsSchema, { applies: "restart" });
    const measured = registered.outcome();
    namespace = measured.state === "requested" ? { state: "requested", detail: `namespace ${SETTINGS_NS} requested by the fallback (no other registrant) (no host read-back)` } : { state: measured.state, detail: measured.detail };
    handle.record(namespace);
    if (namespace.state === "refused")
      log.warn(`settings namespace ${SETTINGS_NS} not registered: ${namespace.detail ?? ""}`);
  });
  const sectionHandle = tui.registerSettingsSection(async () => {
    let catalog;
    try {
      catalog = await catalogReader.llmCatalog?.();
    } catch {
      catalog = undefined;
    }
    const lists = teamModelOptionLists(catalog);
    log.info(`settings section ${SETTINGS_NS} slot options: provider=${lists.source.provider}(${lists.provider.length})` + ` model=${lists.source.model}(${lists.model.length})` + ` reasoningEffort=${lists.source.reasoningEffort}(${lists.reasoningEffort.length})` + ` catalog=${catalog === undefined ? "unavailable" : catalog.degraded === true ? "degraded" : "live"}`);
    section = { state: "requested", detail: `section ${SETTINGS_NS} requested (no host read-back; slot options ${lists.source.provider}/${lists.source.model}/${lists.source.reasoningEffort})` };
    return { ...SETTINGS_SECTION, fields: settingsFields(lists) };
  }, ctx);
  return {
    outcome: () => {
      const measured = sectionHandle.outcome();
      const chosen = measured.state === "refused" ? { state: "refused", detail: measured.detail } : section ?? { state: measured.state, detail: measured.detail };
      return {
        id: measured.id,
        state: chosen.state,
        detail: `${chosen.detail ?? ""} · namespace ${SETTINGS_NS}: ${namespace.state}${namespace.detail === undefined ? "" : ` (${namespace.detail})`}`
      };
    }
  };
}

// packages/mpd-tui-plugin/src/graph.ts
var GRAPH_THEME = Object.freeze({
  completed: "success",
  running: "activity",
  failed: "error",
  blocked: "warning",
  cancelled: "inactive",
  open: "subtle",
  focus: "accentShimmer",
  dim: "inactive",
  edge: "promptBorder",
  chain: "accent",
  blank: "text"
});
var GLYPH = Object.freeze({
  completed: "✓",
  running: "◐",
  failed: "✗",
  blocked: "○",
  cancelled: "⊘",
  open: "○"
});
var KIND_ABBREV = Object.freeze({
  requirement: "REQ",
  work: "WRK",
  review: "REV",
  repair: "FIX",
  integration: "INT"
});
var ARROW_DOWN = "▼";
var ARROW_RIGHT = "▸";
var FOCUS_MARKER = "▶";
var LEGEND_ENTRY = Object.freeze([
  `${ARROW_DOWN}/${ARROW_RIGHT} blocker above → dependent below · ${FOCUS_MARKER} focus lights its chain`,
  `${ARROW_DOWN}/${ARROW_RIGHT} blocker → dependent · ${FOCUS_MARKER} focus`,
  `${ARROW_DOWN}/${ARROW_RIGHT} arrow · ${FOCUS_MARKER} focus`,
  `${ARROW_DOWN}/${ARROW_RIGHT} arrow`
]);
var LEGEND_STATES = Object.freeze(["completed", "running", "open", "failed", "cancelled"]);
var LEGEND_SHORT = Object.freeze({
  completed: "done",
  running: "run",
  open: "open",
  failed: "fail",
  cancelled: "cancel"
});
var LEGEND_KEY = Object.freeze([
  LEGEND_STATES.map((state) => `${GLYPH[state] ?? "?"} ${state}`).join(" · "),
  LEGEND_STATES.map((state) => `${GLYPH[state] ?? "?"} ${LEGEND_SHORT[state] ?? state}`).join(" · ")
]);
var LEGEND_LINES = Object.freeze([LEGEND_ENTRY, LEGEND_KEY]);
var MIN_LEGEND_COLS = 8;
function legendLines(cols) {
  const width = Number.isFinite(cols) ? Math.floor(cols) : 0;
  if (width < MIN_LEGEND_COLS)
    return [];
  const lines = [];
  for (const variants of LEGEND_LINES) {
    const wording = variants.find((variant) => cellWidth(variant) <= width);
    if (wording !== undefined)
      lines.push(clampCells(wording, width));
  }
  return lines;
}
var MIN_NODE_WIDTH = 16;
var NODE_GAP = 3;
var MAX_NODE_WIDTH = 34;
var MAX_BOX_RANKS = 12;
var UP = 1;
var DOWN = 2;
var LEFT = 4;
var RIGHT = 8;
var JUNCTION = Object.freeze({
  0: " ",
  [UP]: "│",
  [DOWN]: "│",
  [UP | DOWN]: "│",
  [LEFT]: "─",
  [RIGHT]: "─",
  [LEFT | RIGHT]: "─",
  [DOWN | RIGHT]: "┌",
  [DOWN | LEFT]: "┐",
  [UP | RIGHT]: "└",
  [UP | LEFT]: "┘",
  [UP | DOWN | RIGHT]: "├",
  [UP | DOWN | LEFT]: "┤",
  [UP | LEFT | RIGHT]: "┴",
  [DOWN | LEFT | RIGHT]: "┬",
  [UP | DOWN | LEFT | RIGHT]: "┼"
});
function clampSpans(spans, cols) {
  const kept = [];
  let used = 0;
  for (const span of spans) {
    if (used >= cols)
      break;
    const room = cols - used;
    if (cellWidth(span.text) <= room) {
      kept.push(span);
      used += cellWidth(span.text);
      continue;
    }
    kept.push({ text: clampCells(span.text, room), tone: span.tone });
    used = cols;
  }
  return kept;
}
function labelOf(task, focus) {
  const marker = task.id === focus ? FOCUS_MARKER : GLYPH[task.visual] ?? "?";
  const kind = KIND_ABBREV[task.kind ?? ""] ?? "";
  return (kind === "" ? [marker, task.id, task.subject] : [marker, task.id, kind, task.subject]).join(" ");
}
function toneOf(task, focus, chain) {
  if (task.id === focus)
    return "focus";
  if (chain === undefined) {
    const visual = task.visual;
    return visual === "completed" || visual === "running" || visual === "failed" || visual === "blocked" || visual === "cancelled" ? visual : "open";
  }
  return chain.has(task.id) ? toneOf(task, undefined, undefined) : "dim";
}
function dependencyChain(tasks, id) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set;
  const stack = [...byId.get(id)?.dependencies ?? []];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current) || !byId.has(current))
      continue;
    seen.add(current);
    for (const next of byId.get(current)?.dependencies ?? [])
      if (!seen.has(next))
        stack.push(next);
  }
  return seen;
}
function ranksOf(tasks) {
  const deepest = tasks.reduce((max, task) => Math.max(max, Number.isFinite(task.depth) ? task.depth : 0), 0);
  const ranks = Array.from({ length: deepest + 1 }, () => []);
  for (const task of tasks) {
    const rank = Number.isFinite(task.depth) && task.depth >= 0 ? Math.min(task.depth, deepest) : 0;
    ranks[rank].push(task);
  }
  return ranks;
}
function cycleIds(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set;
  const stack = [];
  const onStack = new Set;
  const cyclic = new Set;
  const visit = (id) => {
    if (done.has(id))
      return;
    if (onStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id)))
        cyclic.add(entry);
      return;
    }
    const task = byId.get(id);
    if (task === undefined)
      return;
    onStack.add(id);
    stack.push(id);
    for (const dependency of task.dependencies)
      if (byId.has(dependency))
        visit(dependency);
    stack.pop();
    onStack.delete(id);
    done.add(id);
  };
  for (const task of tasks)
    visit(task.id);
  return [...cyclic].sort();
}
function layoutBoxes(tasks, cols, focus) {
  if (tasks.length === 0) {
    const empty = { lines: [], hits: [], width: 0, mode: "boxes", cycles: [], chain: [] };
    if (focus !== undefined)
      empty.focus = focus;
    return empty;
  }
  const ranks = ranksOf(tasks);
  if (ranks.length > MAX_BOX_RANKS)
    return;
  const widest = ranks.reduce((max, rank) => Math.max(max, rank.length), 1);
  const nodeWidth = Math.min(MAX_NODE_WIDTH, Math.floor((cols - NODE_GAP * (widest - 1)) / widest));
  if (nodeWidth < MIN_NODE_WIDTH)
    return;
  const chain = focus === undefined ? undefined : dependencyChain(tasks, focus);
  const width = widest * (nodeWidth + NODE_GAP) - NODE_GAP;
  const column = new Map;
  for (const rank of ranks) {
    const ordered = rank.map((task, index) => {
      const parents = task.dependencies.filter((id) => column.has(id)).map((id) => column.get(id));
      return { task, index, key: parents.length === 0 ? Number.MAX_SAFE_INTEGER : parents.reduce((sum, at) => sum + at, 0) / parents.length };
    }).sort((left, right) => left.key - right.key || left.index - right.index);
    ordered.forEach((entry, index) => column.set(entry.task.id, index * (nodeWidth + NODE_GAP)));
  }
  const mask = [];
  const text = [];
  const tone = [];
  const order = ["blank", "dim", "edge", "open", "cancelled", "blocked", "chain", "running", "completed", "failed", "focus"];
  const toneAt = (row, col) => tone[row]?.[col] ?? undefined;
  const grow = (row) => {
    while (mask.length <= row) {
      mask.push(new Array(width).fill(0));
      text.push(new Array(width).fill(null));
      tone.push(new Array(width).fill(null));
    }
  };
  const link = (row, col, dir, at) => {
    if (col < 0 || col >= width || row < 0)
      return;
    grow(row);
    mask[row][col] |= dir;
    const current = toneAt(row, col);
    if (current === undefined || order.indexOf(at) > order.indexOf(current))
      tone[row][col] = at;
  };
  const label = (row, col, char, at) => {
    if (col < 0 || col >= width)
      return;
    grow(row);
    text[row][col] = char;
    tone[row][col] = at;
  };
  const centreOf = (id) => (column.get(id) ?? 0) + Math.floor(nodeWidth / 2);
  const RANK_STRIDE = 6;
  const hits = [];
  for (let rank = 0;rank < ranks.length; rank++) {
    const top = rank * RANK_STRIDE;
    for (const task of ranks[rank]) {
      const left = column.get(task.id) ?? 0;
      const right = left + nodeWidth - 1;
      const at = toneOf(task, focus, chain);
      for (let col = left + 1;col < right; col++)
        link(top, col, LEFT | RIGHT, at);
      link(top, left, RIGHT | DOWN, at);
      link(top, right, LEFT | DOWN, at);
      link(top + 1, left, UP | DOWN, at);
      link(top + 1, right, UP | DOWN, at);
      const body = labelOf(task, focus);
      let cursor = left + 1;
      for (const char of clampCells(stripControl(" " + body), nodeWidth - 2)) {
        label(top + 1, cursor, char, at);
        cursor += cellWidth(char);
      }
      for (let col = left + 1;col < right; col++)
        link(top + 2, col, LEFT | RIGHT, at);
      link(top + 2, left, RIGHT | UP, at);
      link(top + 2, right, LEFT | UP, at);
      if (ranks[rank + 1]?.some((child) => child.dependencies.includes(task.id)) === true)
        link(top + 2, centreOf(task.id), DOWN, at);
      hits.push({ taskId: task.id, row: top, rowEnd: top + 2, col: left, colEnd: right });
    }
    if (rank + 1 >= ranks.length)
      break;
    const stubTop = top + 3, bus = top + 4, stubBottom = top + 5;
    for (const child of ranks[rank + 1]) {
      const parents = child.dependencies.filter((id) => ranks[rank].some((parent) => parent.id === id));
      if (parents.length === 0)
        continue;
      const centre = centreOf(child.id);
      const entryTone = toneOf(child, focus, chain);
      link(top + 6, centre, UP, entryTone);
      label(stubBottom, centre, ARROW_DOWN, entryTone);
      for (const id of parents) {
        const from = centreOf(id);
        const edgeTone = focus === undefined ? "edge" : (id === focus || chain?.has(id) === true) && (child.id === focus || chain?.has(child.id) === true) ? "chain" : "dim";
        link(stubTop, from, UP | DOWN, edgeTone);
        if (from === centre) {
          link(bus, from, UP | DOWN, edgeTone);
          continue;
        }
        link(bus, from, UP, edgeTone);
        link(bus, centre, DOWN, edgeTone);
        for (let col = Math.min(from, centre) + 1;col < Math.max(from, centre); col++)
          link(bus, col, LEFT | RIGHT, edgeTone);
        link(bus, Math.min(from, centre), RIGHT, edgeTone);
        link(bus, Math.max(from, centre), LEFT, edgeTone);
      }
    }
  }
  const lines = [];
  for (let row = 0;row < mask.length; row++) {
    const cells = [];
    let run = null;
    for (let col = 0;col < width; col++) {
      const char = text[row][col] ?? JUNCTION[mask[row][col]] ?? " ";
      const at = toneAt(row, col) ?? "blank";
      if (run !== null && run.tone === at)
        run.text += char;
      else {
        run = { text: char, tone: at };
        cells.push(run);
      }
    }
    while (cells.length > 0 && (cells[cells.length - 1].text ?? "").trim() === "")
      cells.pop();
    lines.push(clampSpans(cells, width));
  }
  while (lines.length > 0 && lines[lines.length - 1].every((span) => span.text.trim() === ""))
    lines.pop();
  const chainList = chain === undefined ? [] : [...chain].sort();
  const view = { lines, hits, width, mode: "boxes", cycles: cycleIds(tasks), chain: chainList };
  if (focus !== undefined)
    view.focus = focus;
  return view;
}
function layoutRail(tasks, cols, focus) {
  const chain = focus === undefined ? undefined : dependencyChain(tasks, focus);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map;
  for (const task of tasks) {
    const parent = task.dependencies.filter((id) => byId.has(id)).sort((left, right) => (byId.get(right)?.depth ?? 0) - (byId.get(left)?.depth ?? 0))[0];
    if (parent === undefined)
      continue;
    if (!children.has(parent))
      children.set(parent, []);
    children.get(parent).push(task);
  }
  const drawn = [];
  const seen = new Set;
  const walk = (task, prefix, leaf, depth) => {
    if (seen.has(task.id))
      return;
    seen.add(task.id);
    drawn.push({ task, prefix, leaf, depth });
    const kids = children.get(task.id) ?? [];
    kids.forEach((child, index) => walk(child, depth === 0 ? "" : prefix + (leaf ? "   " : "│  "), index === kids.length - 1, depth + 1));
  };
  for (const root of tasks.filter((task) => task.dependencies.filter((id) => byId.has(id)).length === 0))
    walk(root, "", true, 0);
  for (const task of tasks)
    walk(task, "", true, 0);
  const lines = [];
  const hits = [];
  drawn.forEach((entry, index) => {
    const at = toneOf(entry.task, focus, chain);
    const extra = entry.task.dependencies.length > 1 ? `  ⇠ ${entry.task.dependencies.join("+")}` : "";
    const tail = `${at === "dim" ? "" : entry.task.assignee ?? ""}${entry.task.attempt === undefined ? "" : ` a${entry.task.attempt}`}${extra}`;
    const elbow = entry.leaf ? "└─" : "├─";
    const connector = entry.depth === 0 ? "" : `${entry.prefix}${elbow}${ARROW_RIGHT} `;
    const label = labelOf(entry.task, focus);
    const tailWidth = tail === "" ? 0 : cellWidth(tail) + 2;
    const useTail = tailWidth > 0 && cols - cellWidth(connector) - tailWidth >= 10;
    const labelRoom = Math.max(0, cols - cellWidth(connector) - (useTail ? tailWidth : 0));
    const shown = clampCells(stripControl(label), labelRoom).trimEnd();
    const gap = useTail ? " ".repeat(Math.max(0, labelRoom - cellWidth(shown))) : "";
    lines.push(clampSpans([
      { text: connector, tone: at },
      { text: shown + gap, tone: at },
      ...useTail ? [{ text: "  " + tail, tone: at }] : []
    ], cols));
    hits.push({ taskId: entry.task.id, row: index, rowEnd: index, col: 0, colEnd: Math.max(0, cols - 1) });
  });
  const chainList = chain === undefined ? [] : [...chain].sort();
  const view = { lines, hits, width: cols, mode: "rail", cycles: cycleIds(tasks), chain: chainList };
  if (focus !== undefined)
    view.focus = focus;
  return view;
}
function layoutGraph(tasks, cols, focus) {
  const width = Math.max(8, Math.floor(cols));
  return layoutBoxes(tasks, width, focus) ?? layoutRail(tasks, width, focus);
}
function hitTest(view, row, col) {
  for (const hit of view.hits) {
    if (row >= hit.row && row <= hit.rowEnd && col >= hit.col && col <= hit.colEnd)
      return hit.taskId;
  }
  return;
}

// packages/mpd-tui-plugin/src/team-state.ts
var MAX_TEAMS2 = 20;
var MAX_TASKS2 = 5000;
var MAX_PROBLEMS2 = 5;
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function asText(value, maxCells) {
  return scalarText(value, maxCells);
}
function optional(key, value) {
  return value === undefined ? {} : { [key]: value };
}
function blockingDependencies(tasks, dependencies) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const blocking = [];
  const failed = [];
  for (const id of dependencies) {
    const status = byId.get(id)?.status;
    if (status === "completed" || status === "cancelled")
      continue;
    if (status === "failed")
      failed.push(id);
    else
      blocking.push(id);
  }
  return { blocking, failed };
}
function taskVisualState(status, tasks, dependencies) {
  if (status === "completed")
    return "completed";
  if (status === "failed")
    return "failed";
  if (status === "cancelled")
    return "cancelled";
  if (status === "in_progress")
    return "running";
  return blockingDependencies(tasks, dependencies).blocking.length > 0 ? "blocked" : "open";
}
function taskDepths(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depths = new Map;
  const visiting = new Set;
  const depthOf = (taskId) => {
    const cached = depths.get(taskId);
    if (cached !== undefined)
      return cached;
    if (visiting.has(taskId))
      return 0;
    const task = byId.get(taskId);
    if (task === undefined)
      return 0;
    visiting.add(taskId);
    const dependencies = [...task.dependencies].filter((id) => byId.has(id)).sort();
    const depth = dependencies.length === 0 ? 0 : 1 + Math.max(...dependencies.map(depthOf));
    visiting.delete(taskId);
    depths.set(taskId, depth);
    return depth;
  };
  for (const task of tasks)
    depthOf(task.id);
  return depths;
}
function cycleIds2(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set;
  const stack = [];
  const inStack = new Set;
  const cyclic = new Set;
  const visit = (id) => {
    if (done.has(id))
      return;
    if (inStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id)))
        cyclic.add(entry);
      return;
    }
    const task = byId.get(id);
    if (task === undefined)
      return;
    inStack.add(id);
    stack.push(id);
    for (const dependency of task.dependencies)
      if (byId.has(dependency))
        visit(dependency);
    stack.pop();
    inStack.delete(id);
    done.add(id);
  };
  for (const task of tasks)
    visit(task.id);
  return [...cyclic].sort();
}
function currentTaskOf(memberName, tasks) {
  for (const task of tasks) {
    if (task.status === "in_progress" && task.assignee === memberName)
      return task.id;
  }
  return;
}
function emptyWorkflow(workspace, problems, holds) {
  return {
    workspace,
    members: [],
    tasks: [],
    counts: { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds,
    problems
  };
}
function liveTeamViews(dsh, workspace) {
  let views;
  try {
    views = dsh.teamLiveTeams() ?? [];
  } catch {
    return [];
  }
  let agents = [];
  try {
    agents = dsh.liveAgents() ?? [];
  } catch {
    agents = [];
  }
  if (agents.length === 0 || workspace === "")
    return views.slice(0, MAX_TEAMS2);
  const cwdOf = new Map;
  for (const entry of agents) {
    const agent = entry;
    const id = typeof agent?.id === "string" ? agent.id : "";
    const cwd = agent?.session?.header?.cwd;
    if (id !== "" && typeof cwd === "string")
      cwdOf.set(id, cwd);
  }
  const own = views.filter((view) => cwdOf.get(String(view.leadSessionId ?? "")) === workspace);
  return (own.length > 0 ? own : views).slice(0, MAX_TEAMS2);
}
function memberStatus(view, index) {
  const rows = Array.isArray(view.members) ? view.members : [];
  const row = rows[index];
  return typeof row?.status === "string" ? row.status : "unknown";
}
function teamActive(view) {
  const rows = Array.isArray(view.members) ? view.members : [];
  return rows.some((member) => member.role === "teammate" && (member.status === "running" || member.status === "provisioning"));
}
function principalView(views) {
  let best;
  for (const view of views) {
    const tasks = Array.isArray(view.tasks) ? view.tasks.length : 0;
    if (best === undefined || tasks > (Array.isArray(best.tasks) ? best.tasks.length : 0))
      best = view;
  }
  return best;
}
function readTeamWorkflow(workspace, holds = [], views = []) {
  const problems = [];
  const view = principalView(views.slice(0, MAX_TEAMS2));
  if (view === undefined)
    return emptyWorkflow(workspace, problems, holds);
  const rawTasks = Array.isArray(view.tasks) ? view.tasks.slice(0, MAX_TASKS2) : [];
  const tasks = [];
  for (const raw of rawTasks) {
    if (raw === null || typeof raw !== "object")
      continue;
    const id = asText(raw.id, 40);
    if (id === undefined)
      continue;
    const dependencies = (Array.isArray(raw.blockedBy) ? raw.blockedBy : []).map((entry) => asText(entry, 40)).filter((entry) => entry !== undefined);
    tasks.push({
      id,
      subject: asText(raw.subject, 160) ?? "",
      status: asText(raw.status, 40) ?? "pending",
      visual: "open",
      ...optional("assignee", asText(raw.ownerName, 80)),
      dependencies,
      failedDependencies: [],
      depth: 0
    });
  }
  const depths = taskDepths(tasks);
  for (const task of tasks) {
    task.depth = depths.get(task.id) ?? 0;
    task.failedDependencies = blockingDependencies(tasks, task.dependencies).failed;
    task.visual = taskVisualState(task.status, tasks, task.dependencies);
  }
  const creationIndex = new Map(tasks.map((task, index) => [task.id, index]));
  tasks.sort((left, right) => left.depth - right.depth || (creationIndex.get(left.id) ?? 0) - (creationIndex.get(right.id) ?? 0));
  const cycle = cycleIds2(tasks);
  if (cycle.length > 0)
    problems.push(`cycle ${cycle.join(",")}`);
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 };
  for (const task of tasks) {
    counts.total += 1;
    switch (task.status) {
      case "completed":
        counts.completed += 1;
        break;
      case "in_progress":
        counts.inProgress += 1;
        break;
      case "pending":
        counts.pending += 1;
        break;
      case "claimed":
        counts.claimed += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
      default:
        counts.other += 1;
    }
  }
  const memberRows = Array.isArray(view.members) ? view.members : [];
  const members = [];
  memberRows.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object")
      return;
    if (raw.role === "lead")
      return;
    if (raw.status === "removed")
      return;
    const name = asText(raw.name, 80) ?? "?";
    const status = memberStatus(view, index);
    const provider = asString(raw.provider)?.trim() ?? "";
    const model = asString(raw.model)?.trim() ?? "";
    const route = provider !== "" && model !== "" ? `${provider}/${model}` : model !== "" ? model : undefined;
    const owned = tasks.filter((task) => task.assignee === name);
    const done = owned.filter((task) => task.status === "completed").length;
    members.push({
      name,
      ...optional("role", asText(raw.description, 120)),
      ...optional("route", route),
      status,
      done,
      total: owned.length,
      progress: owned.length === 0 ? 0 : Math.round(done / owned.length * 100),
      ...optional("currentTask", currentTaskOf(name, tasks)),
      unread: null
    });
  });
  const phase = teamActive(view) ? "active" : "idle";
  const links = tasks.reduce((sum, task) => sum + task.dependencies.length, 0);
  const runnable = members.length > 0 && tasks.length > 0;
  return {
    workspace,
    team: {
      id: asText(view.teamId, 60) ?? "?",
      name: asText(view.leadName, 80) ?? "?",
      phase,
      ...optional("captainSessionId", asText(view.leadSessionId, 80)),
      staged: false,
      runnable,
      links
    },
    members,
    tasks,
    counts,
    mail: { unread: null, captainInbox: [] },
    holds,
    problems: problems.slice(0, MAX_PROBLEMS2)
  };
}
function approvalPhrase(teamId) {
  return `approve ${teamId}`;
}
function readPlanView(teams, workspace, sessionId) {
  if (teams === undefined || typeof teams.planFor !== "function" || sessionId === undefined || sessionId === "")
    return;
  try {
    return teams.planFor(workspace, sessionId)?.plan ?? undefined;
  } catch {
    return;
  }
}
function principalRecord(records) {
  return records.find((record) => record.endedAt === undefined) ?? records[0];
}
function mpdTeamRecords(teams, workspace) {
  try {
    const list = teams?.list;
    if (typeof list !== "function" || workspace === "")
      return [];
    return list(workspace) ?? [];
  } catch {
    return [];
  }
}
function readRecordWorkflow(workspace, holds, record) {
  const problems = [];
  const board = record.tasks.slice(0, MAX_TASKS2);
  const tasks = board.map((task) => ({
    id: scalarText(task.id, 40) ?? "",
    subject: scalarText(task.subject, 160) ?? "",
    kind: scalarText(task.kind, 24),
    status: scalarText(task.status, 40) ?? "pending",
    visual: "open",
    assignee: scalarText(task.owner, 80),
    attempt: typeof task.attempt === "number" ? task.attempt : undefined,
    round: typeof task.round === "number" ? task.round : undefined,
    verdict: scalarText(task.verdict, 40),
    dependencies: task.blockedBy.map((id) => scalarText(id, 40)).filter((id) => id !== undefined),
    failedDependencies: [],
    depth: 0
  }));
  const depths = taskDepths(tasks);
  for (const task of tasks) {
    task.depth = depths.get(task.id) ?? 0;
    task.failedDependencies = blockingDependencies(tasks, task.dependencies).failed;
    task.visual = taskVisualState(task.status, tasks, task.dependencies);
  }
  const order = new Map(tasks.map((task, index) => [task.id, index]));
  tasks.sort((left, right) => left.depth - right.depth || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  const cycle = cycleIds2(tasks);
  if (cycle.length > 0)
    problems.push(`cycle ${cycle.join(",")}`);
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 };
  for (const task of tasks) {
    counts.total += 1;
    switch (task.status) {
      case "completed":
        counts.completed += 1;
        break;
      case "in_progress":
        counts.inProgress += 1;
        break;
      case "pending":
        counts.pending += 1;
        break;
      case "claimed":
        counts.claimed += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
      default:
        counts.other += 1;
    }
  }
  const members = record.members.map((member) => {
    const name = scalarText(member.name, 80) ?? "?";
    const owned = tasks.filter((task) => task.assignee === name);
    const done = owned.filter((task) => task.status === "completed").length;
    const current = owned.find((task) => task.status === "in_progress" || task.status === "claimed");
    return {
      name,
      role: scalarText(member.role ?? member.description, 120),
      route: scalarText(member.route, 80),
      status: scalarText(member.status, 40) ?? "unknown",
      done,
      total: owned.length,
      progress: owned.length === 0 ? 0 : Math.round(done / owned.length * 100),
      currentTask: current?.id,
      unread: null
    };
  });
  const active = record.members.some((member) => member.status === "running" || member.status === "provisioning") || record.tasks.some((task) => task.status === "in_progress" || task.status === "claimed");
  const links = tasks.reduce((sum, task) => sum + task.dependencies.length, 0);
  return {
    workspace,
    team: {
      id: scalarText(record.teamId, 60) ?? "?",
      name: scalarText(record.name, 80) ?? "?",
      phase: record.endedAt !== undefined ? "ended" : record.approvedAt === undefined ? "staged" : active ? "active" : "idle",
      description: scalarText(record.description, 200),
      captainSessionId: scalarText(record.leadSessionId, 80),
      stagedAt: scalarText(record.approvedAt ?? record.createdAt, 40),
      staged: record.approvedAt === undefined,
      runnable: members.length > 0 && tasks.length > 0,
      links
    },
    members,
    tasks,
    counts,
    mail: { unread: null, captainInbox: [] },
    holds,
    problems: problems.slice(0, MAX_PROBLEMS2)
  };
}
function teamWorkflowLines(workflow) {
  if (workflow.team === undefined)
    return ["team       (none in this workspace)"];
  const team = workflow.team;
  const lines = [];
  lines.push(`team       ${team.name} (${team.id})`);
  lines.push(`phase      ${team.phase}`);
  if (team.staged && team.planReviewState !== undefined)
    lines.push(`plan       ${team.planReviewState}`);
  if (team.captainSessionId !== undefined)
    lines.push(`captain    ${team.captainSessionId}`);
  if (team.staged && team.stagedAt !== undefined)
    lines.push(`staged     ${team.stagedAt}`);
  if (workflow.holds.includes(team.id))
    lines.push(`watchdog   HELD (${workflow.holds.join(", ")})`);
  lines.push("");
  lines.push("roster");
  if (workflow.members.length === 0)
    lines.push("  (no members)");
  for (const member of workflow.members) {
    const parts = [member.name];
    if (member.role !== undefined)
      parts.push(member.role);
    if (member.route !== undefined)
      parts.push(member.route);
    parts.push(member.status);
    let row = `  ${parts.join(" · ")}`;
    row += ` · ${member.done}/${member.total}`;
    if (member.currentTask !== undefined)
      row += ` · ${member.currentTask}`;
    if (member.unread !== null && member.unread > 0)
      row += ` · ${member.unread} unread`;
    lines.push(row);
  }
  lines.push("");
  lines.push("tasks");
  if (workflow.tasks.length === 0)
    lines.push("  (no tasks)");
  for (const task of workflow.tasks) {
    const indent = "  ".repeat(Math.min(task.depth, 12));
    let row = `${indent}${task.id} [${task.kind ?? "-"}] ${task.subject} · ${task.status}`;
    if (task.assignee !== undefined)
      row += ` @${task.assignee}`;
    if (task.attempt !== undefined)
      row += ` attempt ${task.attempt}`;
    if (task.round !== undefined)
      row += ` r${task.round}`;
    if (task.verdict !== undefined)
      row += ` verdict ${task.verdict}`;
    if (task.dependencies.length > 0)
      row += ` deps=${task.dependencies.join(",")}`;
    for (const failed of task.failedDependencies)
      row += ` failed-dep=${failed}`;
    if (task.visual === "blocked")
      row += " BLOCKED";
    lines.push(row);
  }
  lines.push("");
  const tasks = workflow.counts;
  lines.push(`tasks      ${tasks.total} total · ${tasks.completed} completed · ${tasks.inProgress} in progress · ${tasks.pending} pending · ${tasks.claimed} claimed · ${tasks.failed} failed`);
  lines.push(workflow.mail.unread === null ? "mail       (not observable on the official team plane)" : `mail       ${workflow.mail.unread} unread`);
  for (const message of workflow.mail.captainInbox)
    lines.push(`  ${message.from}: ${message.content}`);
  if (workflow.problems.length > 0) {
    lines.push("");
    for (const problem of workflow.problems)
      lines.push(`note       ${problem}`);
  }
  return lines;
}
function planProjectionLines(workflow) {
  if (workflow.team === undefined)
    return ["no staged plan for team (none)"];
  const team = workflow.team;
  const lines = [];
  lines.push(`team       ${team.name} (${team.id}) · phase ${team.phase} · review ${team.planReviewState ?? "-"}`);
  lines.push(`members    ${workflow.members.length} · tasks ${workflow.tasks.length} · links ${team.links}`);
  lines.push(`runnable   ${team.runnable ? "yes" : "no"}`);
  lines.push("edits      none (the TUI has no inline plan editors)");
  lines.push("");
  lines.push("roster");
  if (workflow.members.length === 0)
    lines.push("  (no members)");
  for (const member of workflow.members) {
    const parts = [member.name];
    if (member.role !== undefined)
      parts.push(member.role);
    if (member.route !== undefined)
      parts.push(member.route);
    parts.push(member.status);
    lines.push(`  ${parts.join(" · ")} · ${member.done}/${member.total}`);
  }
  lines.push("");
  lines.push("tasks");
  if (workflow.tasks.length === 0)
    lines.push("  (no tasks)");
  for (const task of workflow.tasks) {
    const indent = "  ".repeat(Math.min(task.depth, 12));
    let row = `${indent}${task.id} [${task.kind ?? "-"}] ${task.subject} · ${task.status}`;
    if (task.assignee !== undefined)
      row += ` @${task.assignee}`;
    if (task.dependencies.length > 0)
      row += ` deps=${task.dependencies.join(",")}`;
    if (task.visual === "blocked")
      row += " BLOCKED";
    lines.push(row);
  }
  return lines;
}

// packages/mpd-tui-plugin/src/subagent-scene.ts
var SUBAGENT_SCENE_ID = "mpd-tui-subagents";
var MERGED_ROW_MAX_CELLS = 4000;
var FALLBACK_COLS = 100;
var REFRESH_MS = 2000;
var DETAIL_TAIL_LINES = 12;
var DETAIL_LABEL_WIDTH = 12;
var DETAIL_TOOL_NAMES = 8;
var KNOWN_STATUSES = ["starting", "running", "completed", "failed", "cancelled", "unknown"];
var KNOWN_MODES = ["one-shot", "continuable", "unknown"];
var SUBAGENT_GLYPHS = {
  live: "\uD83D\uDFE1",
  unknown: "⚪",
  failed: "\uD83D\uDD34",
  completed: "\uD83D\uDFE2"
};
function noopSubscribe() {
  return () => {};
}
function safeRow(value) {
  const type = typeof value;
  if (type !== "string" && type !== "number" && type !== "boolean")
    return "";
  if (type === "number" && !Number.isFinite(value))
    return "";
  const raw = type === "string" ? value : String(value);
  return clampCells(stripControl(raw), MERGED_ROW_MAX_CELLS);
}
function isoInstant(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return;
  if (Math.abs(value) > 8640000000000000)
    return;
  return new Date(value).toISOString();
}
function hostKit(React, ui) {
  if (React === null || React === undefined || ui === null || ui === undefined)
    return;
  if (typeof React.createElement !== "function")
    return;
  const kit = ui;
  if (typeof kit.Box !== "function" || typeof kit.Text !== "function")
    return;
  return { React, ui };
}
function measureTerminal(ui) {
  if (typeof ui.useTerminalSize !== "function")
    return { size: "", cols: FALLBACK_COLS };
  let columns = "?";
  let rows = "?";
  const measured = ui.useTerminalSize();
  if (measured !== null && measured !== undefined) {
    columns = measured.columns ?? "?";
    rows = measured.rows ?? "?";
  }
  const cols = Number(columns);
  return {
    size: `${String(columns)}x${String(rows)}`,
    cols: Number.isFinite(cols) && cols > 20 ? cols : FALLBACK_COLS
  };
}
function isReturn(input, key) {
  if (key?.isPasted === true)
    return false;
  const modified = key?.ctrl === true || key?.meta === true || key?.shift === true || key?.super === true;
  if (modified)
    return false;
  return key?.return === true || /^[\r\n]+$/u.test(input);
}
function subagentRowView(entry) {
  if (entry === null || typeof entry !== "object")
    return;
  const row = entry;
  const status = typeof row.status === "string" && KNOWN_STATUSES.includes(row.status) ? row.status : "unknown";
  const mode = typeof row.mode === "string" && KNOWN_MODES.includes(row.mode) ? row.mode : "unknown";
  const agentId = typeof row.agentId === "string" && row.agentId !== "" ? row.agentId : undefined;
  const startedAt = isoInstant(row.startedAt);
  const endedAt = isoInstant(row.endedAt ?? row.completedAt);
  return {
    ...agentId === undefined ? {} : { agentId },
    description: safeRow(row.description) || "(no description)",
    mode,
    status,
    ...startedAt === undefined ? {} : { startedAt },
    ...endedAt === undefined ? {} : { endedAt },
    live: status === "running" || status === "starting",
    failed: status === "failed" || status === "cancelled"
  };
}
function subagentRowEntries(channel) {
  try {
    const raw = channel?.subagents;
    if (!Array.isArray(raw))
      return [];
    const pairs = [];
    for (const entry of raw) {
      const view = subagentRowView(entry);
      if (view !== undefined)
        pairs.push({ view, entry });
    }
    return pairs;
  } catch {
    return [];
  }
}
function subagentRows(channel) {
  return subagentRowEntries(channel).map((pair) => pair.view);
}
function glyphOf(row) {
  if (row.live)
    return SUBAGENT_GLYPHS.live;
  if (row.failed)
    return SUBAGENT_GLYPHS.failed;
  if (row.status === "unknown")
    return SUBAGENT_GLYPHS.unknown;
  return SUBAGENT_GLYPHS.completed;
}
function subagentRowLine(row) {
  const parts = [row.description, row.mode, row.status];
  if (row.startedAt !== undefined)
    parts.push(`started ${row.startedAt}`);
  if (row.endedAt !== undefined)
    parts.push(`ended ${row.endedAt}`);
  return safeRow(`${glyphOf(row)} ${parts.join(" · ")}`);
}
function counterOf(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return;
  return Math.floor(value);
}
function subagentDetailFacts(entry) {
  const row = subagentRowView(entry);
  if (row === undefined)
    return;
  const raw = entry;
  const provider = safeRow(raw.provider);
  const model = safeRow(raw.model);
  const usage = raw.tokens !== null && typeof raw.tokens === "object" ? raw.tokens : undefined;
  const inputTokens = counterOf(usage?.input);
  const outputTokens = counterOf(usage?.output);
  const totalTokens = counterOf(usage?.total);
  const calls = Array.isArray(raw.toolCalls) ? raw.toolCalls : undefined;
  const output = Array.isArray(raw.outputEvents) ? raw.outputEvents : Array.isArray(raw.output) ? raw.output : undefined;
  const toolNames = [];
  if (calls !== undefined) {
    for (const call of calls) {
      if (call === null || typeof call !== "object")
        continue;
      const name = safeRow(call.name);
      if (name !== "")
        toolNames.push(name);
    }
  }
  let outputLines;
  if (output !== undefined) {
    outputLines = [];
    for (const line of output) {
      const text = line !== null && typeof line === "object" ? safeRow(line.text) : safeRow(line);
      if (text !== "")
        outputLines.push(text);
    }
  }
  return {
    row,
    ...provider === "" ? {} : { provider },
    ...model === "" ? {} : { model },
    tokens: {
      ...inputTokens === undefined ? {} : { input: inputTokens },
      ...outputTokens === undefined ? {} : { output: outputTokens },
      ...totalTokens === undefined ? {} : { total: totalTokens }
    },
    ...calls === undefined ? {} : { toolCallCount: calls.length },
    toolNames,
    ...outputLines === undefined ? {} : { outputLines }
  };
}
function subagentDetailRows(facts, scroll) {
  const rows = [{ text: facts.row.description, title: true }];
  const pair = (label, value) => ({ text: safeRow(`${label.padEnd(DETAIL_LABEL_WIDTH)}${value}`) });
  rows.push(pair("status", facts.row.status));
  rows.push(pair("mode", facts.row.mode));
  if (facts.model !== undefined)
    rows.push(pair("model", facts.model));
  if (facts.provider !== undefined)
    rows.push(pair("provider", facts.provider));
  if (facts.row.startedAt !== undefined)
    rows.push(pair("started", facts.row.startedAt));
  if (facts.row.endedAt !== undefined)
    rows.push(pair("ended", facts.row.endedAt));
  const tokenParts = [];
  if (facts.tokens.input !== undefined)
    tokenParts.push(`in ${facts.tokens.input}`);
  if (facts.tokens.output !== undefined)
    tokenParts.push(`out ${facts.tokens.output}`);
  if (facts.tokens.total !== undefined)
    tokenParts.push(`total ${facts.tokens.total}`);
  if (tokenParts.length > 0)
    rows.push(pair("tokens", tokenParts.join(" · ")));
  if (facts.toolCallCount !== undefined) {
    const shown = facts.toolNames.slice(0, DETAIL_TOOL_NAMES);
    const hidden = facts.toolNames.length - shown.length;
    rows.push(pair("tool calls", `${facts.toolCallCount}${shown.length === 0 ? "" : ` · ${shown.join(", ")}${hidden > 0 ? `, +${hidden} more` : ""}`}`));
  }
  if (facts.outputLines !== undefined) {
    const lines = facts.outputLines;
    rows.push(pair("output", `${lines.length} line(s)`));
    const wanted = Number.isFinite(scroll) ? Math.floor(scroll) : 0;
    const at = Math.max(0, Math.min(wanted, Math.max(0, lines.length - DETAIL_TAIL_LINES)));
    const end = lines.length - at;
    const start = Math.max(0, end - DETAIL_TAIL_LINES);
    if (lines.length > DETAIL_TAIL_LINES) {
      rows.push({ text: safeRow(`showing ${start + 1}-${end} of ${lines.length} · ↑↓ scroll`), dim: true });
    }
    for (let index = start;index < end; index += 1)
      rows.push({ text: safeRow(`  ${lines[index]}`) });
  }
  return rows;
}
function subagentSectionRows(channel) {
  const rows = subagentRows(channel);
  let live = 0;
  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.live)
      live += 1;
    if (row.status === "completed")
      completed += 1;
    if (row.failed)
      failed += 1;
  }
  const section = [
    { text: `subagents  ${rows.length} total · ${live} running · ${completed} completed · ${failed} failed`, header: true }
  ];
  if (rows.length === 0) {
    section.push({ text: `${SUBAGENT_GLYPHS.unknown} No subagents in the current session`, dim: true });
    section.push({ text: "  Subagents appear here once the main agent starts Task delegations", dim: true });
    return section;
  }
  section.push({
    text: `${SUBAGENT_GLYPHS.live} ${live} running · ${SUBAGENT_GLYPHS.completed} ${completed} completed · ${SUBAGENT_GLYPHS.failed} ${failed} failed`,
    dim: true
  });
  for (let index = 0;index < rows.length; index += 1)
    section.push({ text: subagentRowLine(rows[index]), rowIndex: index });
  return section;
}
function graphTasksOf(workflow) {
  return workflow.tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    ...task.kind === undefined ? {} : { kind: task.kind },
    visual: task.visual,
    ...task.assignee === undefined ? {} : { assignee: task.assignee },
    dependencies: task.dependencies,
    depth: task.depth,
    ...task.attempt === undefined ? {} : { attempt: task.attempt }
  }));
}
function teamGraphView(workflow, cols) {
  if (workflow === undefined || workflow.tasks.length === 0)
    return;
  try {
    return layoutGraph(graphTasksOf(workflow), cols);
  } catch {
    return;
  }
}
function interruptSubagent(channel, agentId) {
  try {
    const control = channel?.subagentControl;
    if (control === null || control === undefined || typeof control.interrupt !== "function")
      return false;
    return control.interrupt(agentId) === true;
  } catch {
    return false;
  }
}
function createSubagentSceneComponent(readWorkflow, onHostKit) {
  return function MpdTuiSubagents(props) {
    const kit = hostKit(props?.React, props?.ui);
    if (kit === undefined) {
      return null;
    }
    onHostKit?.(props?.ui);
    const React = kit.React;
    const ui = kit.ui;
    const close = typeof props.close === "function" ? props.close : () => {};
    const channel = props?.channel;
    const workflowState = React.useState(undefined);
    const workflow = workflowState[0];
    const setWorkflow = workflowState[1];
    const focusState = React.useState(0);
    const focus = focusState[0];
    const setFocus = focusState[1];
    const noticeState = React.useState("");
    const notice = noticeState[0];
    const setNotice = noticeState[1];
    const detailState = React.useState(undefined);
    const detailAgentId = detailState[0];
    const setDetailAgentId = detailState[1];
    const detailScrollState = React.useState(0);
    const detailScroll = detailScrollState[0];
    const setDetailScroll = detailScrollState[1];
    const refresh = () => {
      let next;
      try {
        next = readWorkflow();
      } catch {
        next = undefined;
      }
      setWorkflow(next);
    };
    React.useEffect(() => {
      refresh();
      let timer;
      try {
        timer = setInterval(() => refresh(), REFRESH_MS);
      } catch {
        timer = undefined;
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer);
          } catch {}
        }
      };
    }, []);
    const subscribe = typeof channel?.subscribe === "function" ? (listener) => channel.subscribe(listener) : noopSubscribe;
    const getSnapshot = typeof channel?.version === "number" ? () => channel.version : () => 0;
    if (typeof React.useSyncExternalStore === "function") {
      try {
        React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      } catch {}
    }
    const measured = measureTerminal(ui);
    const pairs = subagentRowEntries(channel);
    const rows = pairs.map((pair) => pair.view);
    const selectedIndex = rows.length === 0 ? -1 : Math.min(Math.max(focus, 0), rows.length - 1);
    const selected = selectedIndex === -1 ? undefined : rows[selectedIndex];
    const detailAt = detailAgentId === undefined ? -1 : pairs.findIndex((pair) => pair.view.agentId === detailAgentId);
    const detailOpen = detailAt >= 0;
    const detailRow = detailOpen ? rows[detailAt] : undefined;
    const detailFacts = detailOpen ? subagentDetailFacts(pairs[detailAt].entry) : undefined;
    const detailLines = detailFacts?.outputLines?.length ?? 0;
    const detailMaxScroll = Math.max(0, detailLines - DETAIL_TAIL_LINES);
    const detailGone = detailAgentId !== undefined && !detailOpen;
    const noticeLine = detailGone ? "details: that subagent is no longer in the channel" : notice;
    const interrupt = (row) => {
      if (row === undefined || row.agentId === undefined) {
        setNotice("interrupt: no subagent row is selected");
        return;
      }
      if (!row.live) {
        setNotice(`interrupt: ${row.description} is ${row.status}, not running`);
        return;
      }
      setNotice(interruptSubagent(channel, row.agentId) ? `interrupt requested for ${row.description}` : "interrupt: this composition exposes no subagent control");
    };
    const openDetail = () => {
      if (selected === undefined) {
        setNotice("details: no subagent row is selected");
        return;
      }
      if (selected.agentId === undefined) {
        setNotice("details: this row carries no agent id to re-read");
        return;
      }
      setNotice("");
      setDetailScroll(0);
      setDetailAgentId(selected.agentId);
    };
    if (typeof ui.useInput === "function") {
      ui.useInput((input, key) => {
        if (detailOpen) {
          if (key?.escape === true || key?.backspace === true || input === "q") {
            setDetailAgentId(undefined);
            setDetailScroll(0);
            setNotice("");
            return;
          }
          if (key?.upArrow === true) {
            setDetailScroll(Math.min(detailMaxScroll, detailScroll + 1));
            return;
          }
          if (key?.downArrow === true) {
            setDetailScroll(Math.max(0, detailScroll - 1));
            return;
          }
          if (input === "r" && key?.ctrl !== true) {
            refresh();
            return;
          }
          if (input === "i" && key?.ctrl !== true)
            interrupt(detailRow);
          return;
        }
        if (key?.escape === true || input === "q") {
          close();
          return;
        }
        if (key?.upArrow === true) {
          setFocus(Math.max(0, selectedIndex - 1));
          return;
        }
        if (key?.downArrow === true) {
          setFocus(Math.max(0, Math.min(selectedIndex, rows.length - 1) + 1));
          return;
        }
        if (isReturn(input, key)) {
          openDetail();
          return;
        }
        if (input === "r" && key?.ctrl !== true) {
          refresh();
          return;
        }
        if (input === "i" && key?.ctrl !== true)
          interrupt(selected);
      });
    }
    const children = [];
    children.push(React.createElement(ui.Text, { key: "title", bold: true }, safeRow(`${t("scene.subagents")}${measured.size === "" ? "" : ` · ${measured.size}`}`)));
    if (detailOpen) {
      const detailRows = detailFacts === undefined ? [{ text: "details: this entry is unreadable", dim: true }] : subagentDetailRows(detailFacts, detailScroll);
      for (let index = 0;index < detailRows.length; index += 1) {
        const row = detailRows[index];
        children.push(React.createElement(ui.Text, {
          key: `detail-${index}`,
          ...row.title === true ? { bold: true } : {},
          ...row.dim === true ? { dimColor: true } : {}
        }, safeRow(row.text)));
      }
    } else {
      const section = subagentSectionRows(channel);
      for (let index = 0;index < section.length; index += 1) {
        const row = section[index];
        const emphasis = {
          ...row.header === true ? { bold: true } : {},
          ...row.dim === true ? { dimColor: true } : {},
          ...row.rowIndex !== undefined && row.rowIndex === selectedIndex ? { bold: true } : {}
        };
        if (row.rowIndex === undefined) {
          children.push(React.createElement(ui.Text, { key: `sub-${index}`, ...emphasis }, safeRow(row.text)));
          continue;
        }
        const clicked = row.rowIndex;
        children.push(React.createElement(ui.Box, { key: `sub-${index}`, onClick: () => setFocus(clicked) }, React.createElement(ui.Text, { key: "row", ...emphasis }, safeRow(row.text))));
      }
      children.push(React.createElement(ui.Text, { key: "sep" }, safeRow("")));
      let teamLines;
      try {
        teamLines = workflow === undefined ? ["team state unreadable"] : teamWorkflowLines(workflow);
      } catch {
        teamLines = ["team state unreadable"];
      }
      for (let index = 0;index < teamLines.length; index += 1) {
        children.push(React.createElement(ui.Text, { key: `team-${index}` }, safeRow(teamLines[index])));
      }
      const view = teamGraphView(workflow, measured.cols);
      if (view !== undefined) {
        children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeRow(`task dependency graph${view.mode === "rail" ? " (rail)" : ""}`)));
        for (let index = 0;index < view.lines.length; index += 1) {
          const spans = view.lines[index].map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: GRAPH_THEME[span.tone] }, span.text));
          children.push(React.createElement(ui.Text, { key: `graph-${index}` }, ...spans));
        }
        let legend = [];
        try {
          legend = legendLines(measured.cols);
        } catch {
          legend = [];
        }
        for (let index = 0;index < legend.length; index += 1) {
          children.push(React.createElement(ui.Text, { key: `legend-${index}`, dimColor: true }, safeRow(legend[index])));
        }
      }
    }
    if (noticeLine !== "")
      children.push(React.createElement(ui.Text, { key: "notice", color: "yellow" }, safeRow(noticeLine)));
    children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, safeRow(detailOpen ? "esc/backspace/q back to the list · ↑↓ scroll the output · i interrupt the selected run · r refresh" : "esc/q close · ↑↓ select · enter detail · i interrupt the selected run · r refresh · alt+a this panel · alt+t team · alt+m board")));
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children);
  };
}

// packages/mpd-tui-plugin/src/dashboard-key.ts
var DASHBOARD_KEY_VIEW = "mpd-tui-keyhook";
var DASHBOARD_KEY_MAX_ROWS = 1;
function reactHooksOf(value) {
  if (value === undefined || value === null)
    return;
  const candidate = value;
  if (typeof candidate.useState !== "function")
    return;
  if (typeof candidate.useEffect !== "function")
    return;
  if (typeof candidate.createElement !== "function")
    return;
  return candidate;
}
function readHostInputBus(tui) {
  try {
    return readHostStdinValue(tui.hostInput()?.useStdin());
  } catch (error) {
    return { detail: `the host stdin hook threw: ${String(error?.message ?? error)}` };
  }
}
function interceptDashboardKey(event, deps) {
  const candidate = event;
  if (candidate === undefined || candidate === null)
    return false;
  if (candidate.input !== "a")
    return false;
  const key = candidate.key;
  if (key === undefined || key === null)
    return false;
  if (key.ctrl !== true || key.meta === true)
    return false;
  if (!deps.enabled())
    return false;
  if (!deps.mergedSceneAvailable())
    return false;
  const workflow = deps.readWorkflow();
  if (workflow === undefined || workflow.team === undefined || workflow.tasks.length === 0)
    return false;
  const stop = candidate.stopImmediatePropagation;
  if (typeof stop !== "function")
    return false;
  stop.call(event);
  const opened = deps.openMergedScene();
  deps.log.debug(`Ctrl+A takeover: ${opened ? "opened" : "FAILED to open"} ${SUBAGENT_SCENE_ID} (${workflow.tasks.length} task(s))`);
  return true;
}
function readDashboardWorkflow(workspaceRoot, holds, teamViews, teamRecords) {
  try {
    let holdIds = [];
    try {
      holdIds = holds() ?? [];
    } catch {
      holdIds = [];
    }
    let records = [];
    try {
      records = teamRecords?.() ?? [];
    } catch {
      records = [];
    }
    const principal = principalRecord(records);
    if (principal !== undefined)
      return readRecordWorkflow(workspaceRoot(), holdIds, principal);
    let views = [];
    try {
      views = teamViews?.() ?? [];
    } catch {
      views = [];
    }
    return readTeamWorkflow(workspaceRoot(), holdIds, views);
  } catch {
    return;
  }
}
function createDashboardKeyComponent(tui, deps) {
  return function MpdTuiDashboardKey(props) {
    const React = reactHooksOf(props?.React);
    if (React === undefined) {
      return null;
    }
    const ui = props?.ui;
    const armed = React.useState(0);
    const setArmed = armed[1];
    React.useEffect(() => tui.whenHostInput(() => setArmed((previous) => previous + 1)), []);
    const bus = readHostInputBus(tui);
    const emitter = bus.emitter;
    const unavailable = bus.detail;
    React.useEffect(() => {
      if (emitter === undefined) {
        if (unavailable !== undefined)
          deps.log.debug(`Ctrl+A takeover: ${unavailable}`);
        return;
      }
      const listener = (event) => {
        try {
          interceptDashboardKey(event, deps);
        } catch (error) {
          deps.log.debug(`Ctrl+A takeover handler failed: ${String(error?.message ?? error)}`);
        }
      };
      try {
        emitter.prependListener("input", listener);
      } catch {
        return;
      }
      return () => {
        try {
          emitter.removeListener("input", listener);
        } catch {}
      };
    }, [emitter, unavailable]);
    if (typeof ui?.Box !== "function")
      return null;
    return React.createElement(ui.Box, {}, null);
  };
}
function registerDashboardKey(ctx, tui, deps) {
  const view = tui.registerStatusComponent({
    key: DASHBOARD_KEY_VIEW,
    component: createDashboardKeyComponent(tui, deps),
    maxRows: DASHBOARD_KEY_MAX_ROWS,
    identity: ctx,
    label: "mpd-tui Ctrl+A keyhook"
  });
  return { outcome: () => view.outcome() };
}

// packages/mpd-tui-plugin/src/panel.ts
var PANEL_SLUG = "team";
var PANEL_TITLE = "MPD";
var PANEL_MIN_COLUMNS = 32;
var PANEL_ORDER = 10;
var FALLBACK_COLS2 = PANEL_MIN_COLUMNS;
var ROW_MAX_CELLS = 4000;
var PANEL_DESCRIPTOR_FROZEN = {
  apiVersion: 1,
  id: PANEL_SLUG,
  title: PANEL_TITLE,
  minColumns: PANEL_MIN_COLUMNS,
  order: PANEL_ORDER
};
function takeoverArmed(seamBound, savedKnob, floor) {
  if (seamBound)
    return false;
  return typeof savedKnob === "boolean" ? savedKnob : floor;
}
function panelKit(React, ui) {
  if (React === null || React === undefined || ui === null || ui === undefined)
    return;
  if (typeof React.createElement !== "function")
    return;
  const kit = ui;
  if (typeof kit.Box !== "function" || typeof kit.Text !== "function")
    return;
  return { React, ui: kit };
}
function measurePanel(ui) {
  if (typeof ui.useTerminalSize !== "function")
    return { cols: FALLBACK_COLS2 };
  try {
    const size = ui.useTerminalSize();
    const columns = size?.columns;
    if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0)
      return { cols: FALLBACK_COLS2 };
    return { cols: Math.floor(columns) };
  } catch {
    return { cols: FALLBACK_COLS2 };
  }
}
function safeRow2(value) {
  try {
    return clampCells(stripControl(value), ROW_MAX_CELLS);
  } catch {
    return "";
  }
}
function readSnapshot(host) {
  if (host === null || host === undefined)
    return;
  const api = host;
  if (typeof api.snapshot !== "function")
    return;
  try {
    return api.snapshot();
  } catch {
    return;
  }
}
function createPanelComponent(readWorkflow) {
  return function MpdTuiPanel(props) {
    const kit = panelKit(props?.React, props?.ui);
    if (kit === undefined) {
      return null;
    }
    const React = kit.React;
    const ui = kit.ui;
    const measured = measurePanel(ui);
    const snapshot = readSnapshot(props?.host);
    let workflow;
    try {
      workflow = readWorkflow();
    } catch {
      workflow = undefined;
    }
    const children = [];
    const section = subagentSectionRows(snapshot);
    for (let index = 0;index < section.length; index += 1) {
      const row = section[index];
      children.push(React.createElement(ui.Text, {
        key: `sub-${index}`,
        ...row.header === true ? { bold: true } : {},
        ...row.dim === true ? { dimColor: true } : {}
      }, safeRow2(row.text)));
    }
    if (typeof ui.Divider === "function")
      children.push(React.createElement(ui.Divider, { key: "sep" }));
    else
      children.push(React.createElement(ui.Text, { key: "sep", dimColor: true }, safeRow2("─")));
    const view = teamGraphView(workflow, measured.cols);
    if (view === undefined) {
      children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeRow2("task dependency graph: no team in this workspace")));
    } else {
      children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeRow2(`task dependency graph${view.mode === "rail" ? " (rail)" : ""}`)));
      for (let index = 0;index < view.lines.length; index += 1) {
        const spans = view.lines[index].map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: GRAPH_THEME[span.tone] }, span.text));
        children.push(React.createElement(ui.Text, { key: `graph-${index}` }, ...spans));
      }
      let legend = [];
      try {
        legend = legendLines(measured.cols);
      } catch {
        legend = [];
      }
      for (let index = 0;index < legend.length; index += 1) {
        children.push(React.createElement(ui.Text, { key: `legend-${index}`, dimColor: true }, safeRow2(legend[index])));
      }
    }
    const body = typeof ui.ScrollBox === "function" ? React.createElement(ui.ScrollBox, { key: "body" }, children) : children;
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", height: "100%", paddingX: 1 }, body);
  };
}
function registerPanelSurface(tui, deps) {
  const panel = deps.enabled ? tui.registerPanel({
    ...PANEL_DESCRIPTOR_FROZEN,
    component: createPanelComponent(deps.readWorkflow)
  }) : undefined;
  return {
    panel,
    registered: () => panel !== undefined && panel.id() !== undefined,
    id: () => panel?.id(),
    outcome: () => {
      if (panel !== undefined)
        return panel.outcome();
      return tui.skipped("panels", "the sidebar panel is disabled by the mpd-tui row config (panel: false)").outcome();
    },
    openOrScene: () => {
      const id = panel?.id();
      if (!tui.panelSeamBound() || id === undefined) {
        return { outcome: "unavailable", sceneOpened: deps.openMergedScene() };
      }
      if (typeof tui.panels()?.open !== "function") {
        deps.log.debug(`the bound panel seam exposes no open() member; using the full-screen merged scene`);
        return { outcome: "unavailable", sceneOpened: deps.openMergedScene() };
      }
      const result = tui.openPanel(id);
      if (result.opened() === true)
        return { outcome: "opened", sceneOpened: false };
      deps.log.debug(`panel open(${id}) refused; falling back to the full-screen merged scene`);
      return { outcome: "fallback", sceneOpened: deps.openMergedScene() };
    }
  };
}
function panelStatusLine(outcome, id) {
  if (outcome === "opened")
    return t("panel.opened", { id: id ?? "?" });
  if (outcome === "fallback")
    return t("panel.fallback", { id: id ?? "?" });
  return t("panel.unavailable");
}

// packages/mpd-tui-plugin/src/scenes.ts
var BOARD_SCENE_ID = "mpd-tui-board";
var TEAM_SCENE_ID = "mpd-tui-team";
var PLAN_SCENE_ID = "mpd-tui-plan";
var FALLBACK_COLS3 = 100;
var BOARD_REFRESH_MS = 2000;
var DISCARD_WINDOW_MS = 1e4;
var SCENE_ROW_MAX_CELLS = 4000;
var PLAN_MUTATION_UNAVAILABLE = "no plan approval exists on the official Agent Teams plane (0.1.7): a team is its Lead session and its board is live";
var UNAVAILABLE_PLAN_ACTIONS = {
  available: () => false,
  approve: async () => ({ ok: false, error: PLAN_MUTATION_UNAVAILABLE }),
  discard: async () => ({ ok: false, error: PLAN_MUTATION_UNAVAILABLE })
};
function noopSubscribe2() {
  return () => {};
}
function safeLine(value) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  return clampCells(stripControl(raw), SCENE_ROW_MAX_CELLS);
}
function usableKit(React, ui) {
  if (React === undefined || React === null)
    return false;
  if (ui === undefined || ui === null)
    return false;
  return typeof ui.Box === "function" && typeof ui.Text === "function";
}
function readWorkflow(workspaceRoot, holds, teamViews, teamRecords) {
  try {
    let holdIds = [];
    try {
      holdIds = holds() ?? [];
    } catch {
      holdIds = [];
    }
    let views = [];
    try {
      views = teamViews?.() ?? [];
    } catch {
      views = [];
    }
    let records = [];
    try {
      records = teamRecords?.() ?? [];
    } catch {
      records = [];
    }
    const principal = records.find((record) => record.endedAt === undefined) ?? records[0];
    if (principal !== undefined)
      return readRecordWorkflow(workspaceRoot(), holdIds, principal);
    return readTeamWorkflow(workspaceRoot(), holdIds, views);
  } catch {
    return;
  }
}
function wrapCells(value, cols) {
  const out = [];
  let line = "";
  for (const word of value.split(" ")) {
    const next = line === "" ? word : `${line} ${word}`;
    if (cellWidth(next) > cols && line !== "") {
      out.push(line);
      line = word;
    } else
      line = next;
  }
  if (line !== "")
    out.push(line);
  return out;
}
function measureTerminal2(ui) {
  if (typeof ui?.useTerminalSize !== "function")
    return { size: "", cols: FALLBACK_COLS3, window: 20 };
  let columns = "?";
  let rows = "?";
  const measured = ui.useTerminalSize();
  if (measured !== undefined && measured !== null) {
    columns = measured.columns ?? "?";
    rows = measured.rows ?? "?";
  }
  const terminalRows = Number(rows);
  const size = `${String(columns)}x${String(rows)}`;
  const terminalCols = Number(columns);
  return {
    size,
    cols: Number.isFinite(terminalCols) && terminalCols > 20 ? terminalCols : FALLBACK_COLS3,
    window: Number.isFinite(terminalRows) && terminalRows > 8 ? terminalRows - 6 : 20
  };
}
function createBoardComponent(workspaceRoot, home, holds, nav, openScene, teamViews, teamRecords, onHostKit) {
  return function MpdTuiBoard(props) {
    const React = props?.React;
    const ui = props?.ui;
    const close = typeof props?.close === "function" ? props.close : () => {};
    if (!usableKit(React, ui)) {
      return null;
    }
    onHostKit?.(ui);
    const read = () => {
      try {
        return boardLines(readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? []), holds());
      } catch {
        return ["board state unreadable"];
      }
    };
    const state = React.useState([]);
    const rows = state[0];
    const setRows = state[1];
    React.useEffect(() => {
      setRows(read());
      let timer;
      try {
        timer = setInterval(() => setRows(read()), BOARD_REFRESH_MS);
      } catch {
        timer = undefined;
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer);
          } catch {}
        }
      };
    }, []);
    if (typeof ui.useInput === "function") {
      ui.useInput((input, key) => {
        if (key?.escape === true || input === "q")
          close();
        else if (input === "r")
          setRows(read());
        else if (input === "a") {
          nav.planFromTeam = false;
          openScene(TEAM_SCENE_ID);
        }
      });
    }
    const channel = props?.channel;
    const subscribe = typeof channel?.subscribe === "function" ? (listener) => channel.subscribe(listener) : noopSubscribe2;
    const getSnapshot = typeof channel?.version === "number" ? () => channel.version : () => 0;
    let sessionRows = 0;
    if (typeof React.useSyncExternalStore === "function") {
      try {
        React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
        sessionRows = Array.isArray(channel?.rows) ? channel.rows.length : 0;
      } catch {
        sessionRows = 0;
      }
    }
    const measured = measureTerminal2(ui);
    const size = measured.size;
    const header = `MPD board — ${rows.length} line(s)${size === "" ? "" : ` · ${size}`}`;
    const children = [
      React.createElement(ui.Text, { key: "title", bold: true }, safeLine(header)),
      React.createElement(ui.Text, { key: "meta", dimColor: true }, safeLine(`${sessionRows} transcript row(s)`))
    ];
    for (let index = 0;index < rows.length; index += 1) {
      children.push(React.createElement(ui.Text, { key: `line-${index}` }, safeLine(rows[index])));
    }
    children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, safeLine("esc/q close · r refresh · a team workflow")));
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children);
  };
}
function createTeamComponent(workspaceRoot, holds, nav, openScene, teamViews, teamRecords, onHostKit) {
  return function MpdTuiTeam(props) {
    const React = props?.React;
    const ui = props?.ui;
    const close = typeof props?.close === "function" ? props.close : () => {};
    if (!usableKit(React, ui))
      return null;
    onHostKit?.(ui);
    const workflowState = React.useState(undefined);
    const workflow = workflowState[0];
    const setWorkflow = workflowState[1];
    const noticeState = React.useState("");
    const notice = noticeState[0];
    const setNotice = noticeState[1];
    const pinnedState = React.useState(undefined);
    const pinned = pinnedState[0];
    const setPinned = pinnedState[1];
    const hoverState = React.useState(undefined);
    const hover = hoverState[0];
    const setHover = hoverState[1];
    const scrollState = React.useState(0);
    const scroll = scrollState[0];
    const setScroll = scrollState[1];
    const latestRef = React.useRef?.(undefined);
    const viewRef = React.useRef?.(undefined);
    const refresh = () => {
      let next;
      try {
        next = readWorkflow(workspaceRoot, holds, teamViews, teamRecords);
      } catch {
        next = undefined;
      }
      setWorkflow(next);
      if (latestRef !== undefined && latestRef !== null) {
        latestRef.current = { staged: next?.team?.staged === true, ...next?.team?.id === undefined ? {} : { teamId: next.team.id } };
      }
    };
    React.useEffect(() => {
      refresh();
      let timer;
      try {
        timer = setInterval(() => refresh(), BOARD_REFRESH_MS);
      } catch {
        timer = undefined;
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer);
          } catch {}
        }
      };
    }, []);
    const graphTasks = (workflow?.tasks ?? []).map((task) => ({
      id: task.id,
      subject: task.subject,
      ...task.kind === undefined ? {} : { kind: task.kind },
      visual: task.visual,
      ...task.assignee === undefined ? {} : { assignee: task.assignee },
      dependencies: task.dependencies,
      depth: task.depth,
      ...task.attempt === undefined ? {} : { attempt: task.attempt }
    }));
    const focus = hover ?? pinned;
    const measured = measureTerminal2(ui);
    const graphWidth = Math.max(20, measured.cols - 4);
    const view = layoutGraph(graphTasks, graphWidth, focus);
    if (viewRef !== undefined && viewRef !== null)
      viewRef.current = view;
    const ordered = view.hits.map((hit) => hit.taskId);
    const moveFocus = (delta) => {
      if (ordered.length === 0)
        return;
      const at = focus === undefined ? -1 : ordered.indexOf(focus);
      const next = at < 0 ? delta > 0 ? 0 : ordered.length - 1 : (at + delta + ordered.length) % ordered.length;
      setHover(undefined);
      setPinned(ordered[next]);
    };
    if (typeof ui.useInput === "function") {
      ui.useInput((input, key) => {
        if (key?.escape === true && pinned !== undefined) {
          setPinned(undefined);
          setHover(undefined);
          return;
        }
        if (key?.escape === true || input === "q")
          close();
        else if (input === "r") {
          setScroll(0);
          refresh();
        } else if (key?.upArrow === true || input === "k")
          key?.shift === true ? setScroll(Math.max(0, scroll - 1)) : moveFocus(-1);
        else if (key?.downArrow === true || input === "j")
          key?.shift === true ? setScroll(scroll + 1) : moveFocus(1);
        else if (input === "g") {
          setScroll(0);
        } else if (input === "p") {
          nav.planFromTeam = false;
          openScene(BOARD_SCENE_ID);
        } else if (input === "a") {
          const staged = latestRef?.current?.staged === true;
          if (!staged) {
            setNotice(t("scene.planNeedsStaged"));
            return;
          }
          setNotice("");
          nav.planFromTeam = true;
          nav.planTeamId = latestRef?.current?.teamId;
          if (!openScene(PLAN_SCENE_ID))
            setNotice(t("scene.planMissing"));
        }
      });
    }
    const children = [];
    const head = workflow?.team;
    children.push(React.createElement(ui.Text, { key: "title", bold: true }, safeLine(`MPD team${head === undefined ? " — (none)" : ` — ${head.name} (${head.id})`}${measured.size === "" ? "" : ` · ${measured.size}`}`)));
    if (workflow === undefined) {
      children.push(React.createElement(ui.Text, { key: "unreadable" }, safeLine("team state unreadable")));
    } else if (head === undefined) {
      children.push(React.createElement(ui.Text, { key: "none", dimColor: true }, safeLine("no team in this workspace — stage one with agent_teams_plan, then approve it")));
    } else {
      const counts = workflow.counts;
      children.push(React.createElement(ui.Text, { key: "phase" }, safeLine(`${head.phase} · ${counts.total} task(s) · ${counts.completed} done · ${counts.inProgress} running · ${counts.pending} pending · ${counts.failed} failed · ${head.links} link(s)`)));
      const roster = workflow.members.length === 0 ? "roster  (no members)" : "roster  " + workflow.members.map((member) => `${member.status === "running" ? "◐" : "○"}${member.name} ${member.done}/${member.total}`).join(" · ");
      for (const chunk of wrapCells(roster, graphWidth))
        children.push(React.createElement(ui.Text, { key: `roster-${chunk}`, dimColor: true }, safeLine(chunk)));
      if (workflow.holds.includes(head.id))
        children.push(React.createElement(ui.Text, { key: "hold", color: "warning" }, safeLine(`watchdog   HELD (${workflow.holds.join(", ")})`)));
      const focusLabel = focus === undefined ? "" : ` · focus ${focus}${view.chain.length === 0 ? "" : ` ⇠ ${view.chain.join(",")}`}`;
      children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeLine(`task dependency graph${view.mode === "rail" ? " (rail)" : ""}${focusLabel}`)));
      const graphWindow = Math.max(3, measured.window - 4);
      const graphRows = [];
      for (let index = scroll;index < Math.min(view.lines.length, scroll + graphWindow); index += 1) {
        const spans = view.lines[index].map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: GRAPH_THEME[span.tone] }, span.text));
        graphRows.push(React.createElement(ui.Text, { key: `g${index}` }, ...spans));
      }
      children.push(React.createElement(ui.Box, {
        key: "graph",
        flexDirection: "column",
        onMouseEnter: (event) => {
          const drawn = viewRef?.current;
          if (drawn === undefined)
            return;
          const under = hitTest(drawn, Number(event?.localRow ?? -1) + scroll, Number(event?.localCol ?? -1));
          setHover(under);
        },
        onMouseLeave: () => setHover(undefined),
        onClick: (event) => {
          const drawn = viewRef?.current;
          if (drawn === undefined)
            return;
          const under = hitTest(drawn, Number(event?.localRow ?? -1) + scroll, Number(event?.localCol ?? -1));
          setPinned(under === undefined || under === pinned ? undefined : under);
          setHover(under);
        },
        onWheel: (event) => {
          const delta = Number(event?.deltaY ?? 0);
          if (delta !== 0)
            setScroll(Math.max(0, scroll + (delta > 0 ? 1 : -1)));
        }
      }, graphRows));
      let legend = [];
      try {
        legend = legendLines(graphWidth);
      } catch {
        legend = [];
      }
      for (let index = 0;index < legend.length; index += 1) {
        children.push(React.createElement(ui.Text, { key: `legend-${index}`, dimColor: true }, safeLine(legend[index])));
      }
      const detail = focus === undefined ? undefined : workflow.tasks.find((task) => task.id === focus);
      if (detail !== undefined) {
        children.push(React.createElement(ui.Text, { key: "detail", bold: true }, safeLine(`${detail.id} · ${detail.kind ?? "?"} · ${detail.subject}`)));
        children.push(React.createElement(ui.Text, { key: "detail-meta", dimColor: true }, safeLine(`${detail.visual}${detail.attempt === undefined ? "" : ` · attempt ${detail.attempt}`}${detail.round === undefined ? "" : ` · round ${detail.round}`}${detail.verdict === undefined ? "" : ` · ${detail.verdict}`}${detail.assignee === undefined ? "" : ` · @${detail.assignee}`}${detail.dependencies.length === 0 ? "" : ` · ⇠ ${detail.dependencies.join(",")}`}`)));
      }
      for (const problem of workflow.problems)
        children.push(React.createElement(ui.Text, { key: `problem-${problem}`, color: "warning" }, safeLine(`note       ${problem}`)));
    }
    if (notice !== "")
      children.push(React.createElement(ui.Text, { key: "notice", color: "yellow" }, safeLine(notice)));
    children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, safeLine("esc/q close · ↑↓ focus · click pins · hover previews · ⇧↑↓ scroll · r refresh · a plan · p board")));
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children);
  };
}
function planActionLines(workflow, echo, armed, message, servedPhrase = "") {
  const team = workflow?.team;
  const phrase = servedPhrase !== "" ? servedPhrase : team === undefined ? "" : approvalPhrase(team.id);
  const rows = [];
  rows.push("");
  rows.push(servedPhrase !== "" ? "approval needs the exact phrase typed below, then Ctrl+X" : "approval needs the exact team id typed below, then Ctrl+X");
  rows.push(`confirm    ${echo}`);
  rows.push(`required   ${phrase === "" ? "(no staged plan)" : phrase}`);
  rows.push(`runnable   ${team?.runnable === true ? "yes" : "no"}`);
  if (armed)
    rows.push("DISCARD ARMED — press Ctrl+D again within 10s to archive this staged plan");
  if (message !== "")
    rows.push(message);
  rows.push("");
  rows.push("to change this plan: press Esc and tell the captain what to change in the chat");
  rows.push("Ctrl+X approve · Ctrl+D discard ×2 · Ctrl+R re-read · esc back");
  return rows;
}
function createPlanComponent(workspaceRoot, holds, nav, openScene, actions, planFor, teamViews, teamRecords, onHostKit) {
  return function MpdTuiPlan(props) {
    const React = props?.React;
    const ui = props?.ui;
    const close = typeof props?.close === "function" ? props.close : () => {};
    if (!usableKit(React, ui))
      return null;
    onHostKit?.(ui);
    const channelSession = () => {
      const live = props?.channel;
      const id = typeof live?.sessionId === "string" ? live.sessionId : undefined;
      return id === undefined || id === "" ? undefined : id;
    };
    const targetState = React.useState(() => ({ teamId: nav.planTeamId, fromTeam: nav.planFromTeam }));
    const target = targetState[0];
    const viewState = React.useState(undefined);
    const view = viewState[0];
    const setView = viewState[1];
    const echoState = React.useState("");
    const echo = echoState[0];
    const setEcho = echoState[1];
    const busyState = React.useState(false);
    const busy = busyState[0];
    const setBusy = busyState[1];
    const messageState = React.useState("");
    const message = messageState[0];
    const setMessage = messageState[1];
    const armedState = React.useState(0);
    const armedAt = armedState[0];
    const setArmedAt = armedState[1];
    const scrollState = React.useState(0);
    const scroll = scrollState[0];
    const setScroll = scrollState[1];
    const refresh = () => {
      setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords));
      setEcho("");
      setArmedAt(0);
      setScroll(0);
    };
    React.useEffect(() => {
      refresh();
      let timer;
      try {
        timer = setInterval(() => {
          setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords));
        }, BOARD_REFRESH_MS);
      } catch {
        timer = undefined;
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer);
          } catch {}
        }
      };
    }, []);
    React.useEffect(() => {
      if (armedAt === 0)
        return;
      let timer;
      try {
        timer = setTimeout(() => setArmedAt(0), DISCARD_WINDOW_MS);
      } catch {
        timer = undefined;
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearTimeout(timer);
          } catch {}
        }
      };
    }, [armedAt]);
    const team = view?.team;
    const rawPlan = planFor === undefined ? undefined : planFor(channelSession() ?? "");
    const stagedPlan = rawPlan ?? undefined;
    const phrase = stagedPlan === undefined ? team === undefined ? "" : approvalPhrase(team.id) : stagedPlan.phrase;
    const usable = view !== undefined && team !== undefined && team.staged || stagedPlan !== undefined && stagedPlan !== null && stagedPlan.approved !== true;
    const leave = () => {
      setEcho("");
      setScroll(0);
      if (target.fromTeam) {
        if (!openScene(TEAM_SCENE_ID))
          close();
      } else {
        close();
      }
    };
    const runApprove = async () => {
      if (team === undefined)
        return;
      if (phrase === "" || echo !== phrase) {
        setMessage("confirmation does not match this team");
        return;
      }
      if (!actions.available()) {
        setMessage(`approve failed: ${PLAN_MUTATION_UNAVAILABLE}`);
        return;
      }
      setBusy(true);
      setMessage("working…");
      try {
        const result = await actions.approve({
          teamId: stagedPlan?.planId ?? team.id,
          confirmation: echo,
          ...channelSession() === undefined ? {} : { sessionId: channelSession() },
          ...team.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId }
        });
        if (result.ok) {
          const value = result.value;
          const id = typeof value?.team_id === "string" ? value.team_id : team.id;
          const status = typeof value?.status === "string" ? value.status : "running";
          const memberCount = typeof value?.members === "number" ? value.members : view?.members.length ?? 0;
          const taskCount = typeof value?.tasks === "number" ? value.tasks : view?.tasks.length ?? 0;
          setMessage(`approved: ${id} ${status} · members ${memberCount} · tasks ${taskCount}`);
          setEcho("");
        } else {
          setMessage(`approve failed: ${result.error ?? "the tool refused the call"}`);
        }
      } catch (error) {
        setMessage(`approve failed: ${String(error?.message ?? error)}`);
      } finally {
        setBusy(false);
        setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords));
      }
    };
    const runDiscard = async () => {
      const now = Date.now();
      if (armedAt === 0 || now - armedAt > DISCARD_WINDOW_MS) {
        setArmedAt(now);
        setMessage("");
        return;
      }
      setArmedAt(0);
      if (!actions.available()) {
        setMessage(`discard failed: ${PLAN_MUTATION_UNAVAILABLE}`);
        return;
      }
      setBusy(true);
      setMessage("working…");
      try {
        const result = await actions.discard({
          ...team?.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId },
          ...channelSession() === undefined ? {} : { sessionId: channelSession() }
        });
        setMessage(result.ok ? "discarded: team archived" : `discard failed: ${result.error ?? "the tool refused the call"}`);
        if (result.ok)
          setEcho("");
      } catch (error) {
        setMessage(`discard failed: ${String(error?.message ?? error)}`);
      } finally {
        setBusy(false);
        setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords));
      }
    };
    if (typeof ui.useInput === "function") {
      ui.useInput((input, key) => {
        if (busy)
          return;
        if (!usable) {
          if (key?.escape === true)
            leave();
          return;
        }
        if (key?.ctrl === true && input === "x") {
          runApprove();
          return;
        }
        if (key?.ctrl === true && input === "d") {
          runDiscard();
          return;
        }
        if (armedAt !== 0)
          setArmedAt(0);
        if (key?.escape === true) {
          leave();
          return;
        }
        if (key?.ctrl === true && input === "r") {
          refresh();
          return;
        }
        if (input === "r" && echo === "") {
          refresh();
          return;
        }
        if (key?.backspace === true) {
          setEcho(echo === "" ? "" : [...echo].slice(0, -1).join(""));
          return;
        }
        if (key?.upArrow === true || input === "k") {
          setScroll(scroll > 0 ? scroll - 1 : 0);
          return;
        }
        if (key?.downArrow === true || input === "j") {
          setScroll(scroll + 1);
          return;
        }
        if (key?.return === true || key?.tab === true || key?.meta === true)
          return;
        if (typeof input === "string" && input.length >= 1 && input >= " " && key?.ctrl !== true)
          setEcho(echo + input);
      });
    }
    const body = view === undefined ? ["reading the team record…"] : planProjectionLines(view);
    if (usable && target.teamId !== undefined && team !== undefined && target.teamId !== team.id) {
      body.push(`note       team ${target.teamId} is not the newest record — showing ${team.id}`);
    }
    if (usable)
      for (const row of planActionLines(view, echo, armedAt !== 0, message, stagedPlan?.phrase ?? ""))
        body.push(row);
    const measured = measureTerminal2(ui);
    const visible = body.slice(scroll, scroll + measured.window);
    const size = measured.size;
    const settled = message !== "";
    const verdict = !usable && settled;
    const title = !usable ? verdict ? `MPD plan approval — ${team?.name ?? "(none)"}` : `MPD plan approval — ${team === undefined ? "(none)" : `no staged plan for team ${team.id} (phase ${team.phase})`}` : `MPD plan approval — ${team?.name ?? stagedPlan?.name ?? "(none)"}${busy ? " · working…" : ""}`;
    const children = [React.createElement(ui.Text, { key: "title", bold: true }, safeLine(`${title}${size === "" ? "" : ` · ${size}`}`))];
    if (!usable) {
      if (verdict) {
        children.push(React.createElement(ui.Text, { key: "verdict", bold: true }, safeLine(message)));
        children.push(React.createElement(ui.Text, { key: "context", dimColor: true }, safeLine(team === undefined ? "the staged plan is no longer current" : `team ${team.id} · phase ${team.phase}`)));
      } else {
        const detail = team === undefined ? "no staged plan for team (none)" : `no staged plan for team ${team.id} (phase ${team.phase})`;
        children.push(React.createElement(ui.Text, { key: "empty" }, safeLine(detail)));
      }
      children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, safeLine("esc back")));
      return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children);
    }
    for (let index = 0;index < visible.length; index += 1) {
      children.push(React.createElement(ui.Text, { key: `line-${index}` }, safeLine(visible[index])));
    }
    if (busy)
      children.push(React.createElement(ui.Text, { key: "busy", dimColor: true }, safeLine("working…")));
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children);
  };
}
function registerScene(ctx, tui, log, workspaceRoot, home, holds = () => [], planActions = UNAVAILABLE_PLAN_ACTIONS, planReader, teamViews, teamRecords, onHostKit) {
  const nav = { planFromTeam: false };
  const openScene = (id) => {
    if (!tui.openScene(id)) {
      log.debug(`scene open(${id}) skipped: this composition does not serve the scene seam or the id`);
      return false;
    }
    return true;
  };
  const seam = tui.whenBound("scenes", (_service, _scope, handle) => {
    const runtime = tui.scenes();
    if (typeof runtime?.register !== "function") {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.scenes}.register is missing` });
      return;
    }
    try {
      tui.registerScene({ id: BOARD_SCENE_ID, title: t("scene.board"), component: createBoardComponent(workspaceRoot, home, holds, nav, openScene, teamViews, teamRecords, onHostKit) }, ctx);
      tui.registerScene({ id: TEAM_SCENE_ID, title: t("scene.team"), component: createTeamComponent(workspaceRoot, holds, nav, openScene, teamViews, teamRecords, onHostKit) }, ctx);
      tui.registerScene({ id: PLAN_SCENE_ID, title: t("scene.plan"), component: createPlanComponent(workspaceRoot, holds, nav, openScene, planActions, planReader, teamViews, teamRecords, onHostKit) }, ctx);
      tui.registerScene({
        id: SUBAGENT_SCENE_ID,
        title: t("scene.subagents"),
        component: createSubagentSceneComponent(() => readWorkflow(workspaceRoot, holds, teamViews, teamRecords), onHostKit)
      }, ctx);
      handle.record({ state: "requested", detail: `${BOARD_SCENE_ID}, ${TEAM_SCENE_ID}, ${PLAN_SCENE_ID}, ${SUBAGENT_SCENE_ID} requested (no host read-back)` });
    } catch (error) {
      const detail = String(error?.message ?? error);
      handle.record({ state: "refused", detail });
      log.debug(`scene registration refused: ${detail}`);
    }
  });
  const open = () => openScene(BOARD_SCENE_ID);
  return {
    outcome: () => seam.outcome(),
    open,
    openScene,
    openTeam: () => {
      nav.planFromTeam = false;
      nav.planTeamId = undefined;
      return openScene(TEAM_SCENE_ID);
    },
    openPlan: (options) => {
      nav.planFromTeam = options?.returnToTeam === true;
      nav.planTeamId = options?.teamId;
      return openScene(PLAN_SCENE_ID);
    },
    openSubagents: () => openScene(SUBAGENT_SCENE_ID)
  };
}
function boardSummary(workspaceRoot, home, teamViews, teamRecords) {
  try {
    return statusLine(readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? []));
  } catch {
    return "mpd: state unreadable";
  }
}

// packages/mpd-tui-plugin/src/command-trees.ts
var COMMAND_ROOT = "mpd";
var MODEL_COMMAND = "mpd-model";
var COMMAND_ACTIONS = ["board", "team", "plan", "subagents", "panel", "workmates", "status"];
var COMMAND_CHILDREN = [
  { name: "board", description: "Open the mpd board scene", descriptions: { zh: "打开 MPD 面板", en: "Open the mpd board scene" } },
  { name: "team", description: "Open the team workflow scene", descriptions: { zh: "打开团队工作流面板", en: "Open the team workflow scene" } },
  { name: "plan", description: "Review and approve a staged plan", descriptions: { zh: "审阅并批准待定计划", en: "Review and approve a staged plan" } },
  { name: "subagents", description: "Open the subagents + team panel", descriptions: { zh: "打开子代理与团队合并面板", en: "Open the subagents + team panel" } },
  { name: "panel", description: "Open the sidebar panel, or the full-screen merged panel where the host has no panel seam", descriptions: { zh: "打开侧栏面板；宿主无面板接缝时使用全屏合并面板", en: "Open the sidebar panel, or the full-screen merged panel where the host has no panel seam" } },
  { name: "workmates", description: "List the durable workmate library", descriptions: { zh: "列出 workmate 库", en: "List the durable workmate library" } },
  { name: "status", description: "Print the mpd status line", descriptions: { zh: "输出 MPD 状态行", en: "Print the mpd status line" } }
];
var COMMAND_ROOT_DESCRIPTIONS = {
  zh: "MPD 面板与状态",
  en: "MPD surfaces: the board, the team workflow and the status line"
};
var MODEL_COMMAND_DESCRIPTIONS = {
  zh: "选择式模型设置：槽位 → 提供商 → 模型 → 推理强度",
  en: "Pick-list model settings: slot → provider → model → reasoning effort"
};
var MODEL_COMMAND_DESCRIPTION = MODEL_COMMAND_DESCRIPTIONS.en;
function registerCommandTrees(tui) {
  const handle = tui.registerCommandTree({
    root: COMMAND_ROOT,
    descriptions: COMMAND_ROOT_DESCRIPTIONS,
    children: (canonicalPath) => canonicalPath.length <= 1 ? COMMAND_CHILDREN : []
  });
  tui.registerCommandTree({
    root: MODEL_COMMAND,
    descriptions: MODEL_COMMAND_DESCRIPTIONS,
    children: () => []
  });
  return { outcome: () => handle.outcome() };
}

// packages/mpd-tui-plugin/src/shortcuts.ts
var SHORTCUT_BINDINGS = [
  { combo: "alt+m", description: "mpd: open the board", action: "openBoard" },
  { combo: "alt+a", description: "mpd: open the subagents + team panel", action: "openSubagents" },
  { combo: "alt+t", description: "mpd: open the team workflow", action: "openTeam" },
  { combo: "alt+w", description: "mpd: pick a workmate", action: "pickWorkmate" },
  { combo: "alt+r", description: "mpd: refresh the status line", action: "refreshStatus" }
];
function registerShortcuts(ctx, tui, log, actions) {
  const seam = tui.whenBound("shortcuts", (_service, _scope, handle) => {
    const registry = tui.shortcuts();
    if (typeof registry?.register !== "function") {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.shortcuts}.register is missing` });
      return;
    }
    let requested = 0;
    for (const binding of SHORTCUT_BINDINGS) {
      const registration = tui.registerShortcut(binding.combo, {
        description: binding.description,
        handler: () => {
          try {
            if (binding.action === "openBoard")
              actions.openBoard("shortcut");
            else if (binding.action === "openSubagents")
              actions.openSubagents();
            else if (binding.action === "openTeam")
              actions.openTeam();
            else if (binding.action === "refreshStatus")
              actions.refreshStatus();
            else
              actions.pickWorkmate();
          } catch (error) {
            log.debug(`shortcut ${binding.combo} handler failed: ${String(error?.message ?? error)}`);
          }
        }
      }, ctx);
      const measured = registration.outcome();
      if (measured.state === "requested")
        requested += 1;
      else if (measured.state === "refused")
        log.debug(`shortcut ${binding.combo} refused: ${measured.detail ?? "unknown"}`);
    }
    let listed;
    if (typeof registry.list === "function") {
      try {
        listed = registry.list() ?? [];
      } catch {
        listed = undefined;
      }
    }
    if (listed === undefined) {
      handle.record({ state: "requested", detail: `${requested} binding(s) requested; the host exposes no list() read-back` });
      return;
    }
    const confirmed = SHORTCUT_BINDINGS.filter((binding) => listed?.some((entry) => entry.description === binding.description)).map((binding) => binding.combo);
    handle.record(confirmed.length === 0 ? { state: "refused", detail: `list() shows none of our bindings — every combo was refused (reserved or duplicate): ${requested} no-op disposer(s)` } : confirmed.length === SHORTCUT_BINDINGS.length ? { state: "confirmed", detail: `${confirmed.join(", ")} confirmed via ${TUI_SEAMS.shortcuts}.list()` } : { state: "requested", detail: `${confirmed.join(", ")} confirmed; ${SHORTCUT_BINDINGS.length - confirmed.length} not visible in list()` });
  });
  return { outcome: () => seam.outcome() };
}

// packages/mpd-tui-plugin/src/dialogs.ts
function createDialogs(tui, log, defaultTimeoutMs = 30000) {
  let dialogs;
  const seam = tui.whenBound("dialogs", (service, _scope, handle) => {
    const runtime = service;
    const usable = runtime !== undefined && runtime !== null && typeof runtime.select === "function" && typeof runtime.confirm === "function" && typeof runtime.input === "function";
    if (!usable) {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.dialogs} is missing select/confirm/input` });
      return;
    }
    dialogs = runtime;
    handle.record({ state: "available", detail: "request-based seam; nothing to register" });
  });
  const available = () => dialogs !== undefined;
  const select = async (title, options, timeoutMs = defaultTimeoutMs) => {
    if (dialogs === undefined)
      return;
    try {
      return await dialogs.select({ title, options, timeoutMs });
    } catch (error) {
      log.debug(`dialog select failed: ${String(error?.message ?? error)}`);
      return;
    }
  };
  const confirm = async (title, message, timeoutMs = defaultTimeoutMs) => {
    if (dialogs === undefined)
      return;
    try {
      return await dialogs.confirm({ title, message, timeoutMs });
    } catch (error) {
      log.debug(`dialog confirm failed: ${String(error?.message ?? error)}`);
      return;
    }
  };
  return { available, outcome: () => seam.outcome(), select, confirm };
}

// packages/mpd-tui-plugin/src/watchdog.ts
var WATCHDOG_SERVICE = "mpdWatchdog";
var WATCHDOG_READER = "mpd-tui";
var WATCHDOG_NOTICE_PREFIX = "watchdog";
var ACKNOWLEDGE_OPTION = "acknowledge";
var EMPTY_WATCHDOG_VIEW = { holds: [], unread: [] };
function readWatchdogView(service, reader, workspace) {
  if (service === undefined || service === null)
    return EMPTY_WATCHDOG_VIEW;
  try {
    if (typeof service.view === "function") {
      const view = service.view(reader, workspace);
      if (view !== undefined && view !== null)
        return { holds: [...view.holds ?? []], unread: [...view.unread ?? []] };
    }
    const holds = typeof service.heldTeams === "function" ? service.heldTeams(workspace) ?? [] : [];
    const unread = typeof service.unread === "function" ? service.unread(reader, workspace) ?? [] : [];
    return { holds: [...holds], unread: [...unread] };
  } catch {
    return EMPTY_WATCHDOG_VIEW;
  }
}
function watchdogNotice(view) {
  const parts = [];
  if (view.holds.length > 0)
    parts.push(t("watchdog.held", { teams: view.holds.join(", ") }));
  if (view.unread.length > 0) {
    const n = String(view.unread.length);
    parts.push(t(view.unread.length === 1 ? "watchdog.unreadOne" : "watchdog.unread", { n }));
  }
  return parts.length === 0 ? undefined : t("watchdog.notice", { parts: parts.join(" · ") });
}
function composeNotices(...notices) {
  const parts = notices.filter((notice) => typeof notice === "string" && notice.length > 0);
  return parts.length === 0 ? undefined : parts.join(" · ");
}
function watchdogDialog(view) {
  const detail = view.holds.length > 0 ? t("watchdog.holdDetail", { teams: view.holds.join(", ") }) : t("watchdog.replayDetail");
  return {
    title: `${watchdogNotice(view) ?? WATCHDOG_NOTICE_PREFIX} — ${detail}`,
    options: [
      { id: ACKNOWLEDGE_OPTION, label: t("watchdog.acknowledge"), description: t("watchdog.acknowledgeHint") },
      { id: "later", label: t("watchdog.later"), description: t("watchdog.laterHint") }
    ]
  };
}
function attachWatchdogFrontDoor(ctx, tui, log, options) {
  let service;
  let dialogsReady = false;
  let warnedAbsent = false;
  let replayed = false;
  const available = () => service !== undefined && service !== null;
  const read = () => {
    try {
      return readWatchdogView(service, WATCHDOG_READER, options.workspaceRoot());
    } catch (error) {
      log.debug(`watchdog read failed: ${String(error?.message ?? error)}`);
      return EMPTY_WATCHDOG_VIEW;
    }
  };
  const acknowledge = (upTo) => {
    if (!available() || typeof service?.acknowledge !== "function") {
      return { ok: false, watermark: 0, error: `the ${WATCHDOG_SERVICE} service is not mounted — the watchdog store was not written` };
    }
    try {
      const result = service.acknowledge(WATCHDOG_READER, upTo, options.workspaceRoot());
      if (result !== undefined && result !== null && result.ok === true)
        options.onAcknowledged?.();
      return result ?? { ok: false, watermark: 0, error: "the acknowledge returned nothing" };
    } catch (error) {
      return { ok: false, watermark: 0, error: String(error?.message ?? error) };
    }
  };
  const offer = async () => {
    if (!available()) {
      if (!warnedAbsent) {
        warnedAbsent = true;
        log.warn(`the ${WATCHDOG_SERVICE} service is not mounted: the watchdog notice and its acknowledge are unavailable (no held team or unread incident can be shown)`);
      }
      return;
    }
    const view = read();
    if (view.unread.length === 0)
      return;
    if (!options.dialogs.available())
      return;
    const request = watchdogDialog(view);
    const choice = await options.dialogs.select(request.title, request.options);
    if (choice === ACKNOWLEDGE_OPTION) {
      const upTo = view.unread.reduce((max, record) => Math.max(max, record.at), 0);
      acknowledge(upTo);
    }
    return choice;
  };
  const maybeReplay = () => {
    if (replayed || !dialogsReady || !available())
      return;
    replayed = true;
    offer().catch((error) => {
      log.debug(`watchdog replay failed: ${String(error?.message ?? error)}`);
    });
  };
  onService(ctx, WATCHDOG_SERVICE, (_scoped, resolved) => {
    service = resolved;
    if (options.replayOnAttach !== false)
      maybeReplay();
  });
  if (options.replayOnAttach !== false) {
    tui.whenBound("dialogs", () => {
      dialogsReady = true;
      maybeReplay();
    });
  }
  return { available, notice: () => watchdogNotice(read()), view: read, offer, acknowledge };
}

// packages/mpd-tui-plugin/src/decisions.ts
var DECISION_EVENTS = [
  { event: "tui/input", permission: "session.input.intercept" },
  { event: "tui/rewind-prompt", permission: "session.rewind.intercept" },
  { event: "tui/session-switch", permission: "session.switch.intercept" },
  { event: "tui/compact", permission: "session.compact.intercept" }
];
var DECISION_ORDER = "mpd-tui";
function attemptDecisionEvents(ctx, tui, log) {
  const subs = DECISION_EVENTS.map(({ event, permission }) => ({
    event,
    permission,
    sub: tui.requestDecisionEvent(event, () => {
      return;
    }, { scope: event, order: DECISION_ORDER, identity: ctx })
  }));
  const unsupported = () => subs.find(({ sub }) => sub.outcome().state !== "absent" && !sub.supported());
  const unbound = () => subs.every(({ sub }) => sub.outcome().state === "absent");
  const attempts = () => {
    if (unsupported() !== undefined || unbound())
      return [];
    return subs.map(({ event, permission, sub }) => {
      const thrown = sub.error();
      if (thrown !== undefined)
        return { event, state: "refused", reason: thrown };
      if (!sub.disposerReturned())
        return { event, state: "refused", reason: "subscribeDecision returned no disposer" };
      const granted = sub.granted();
      if (granted === true)
        return { event, state: "confirmed", reason: `${permission} granted` };
      if (granted === false)
        return { event, state: "refused", reason: `no grant for ${permission}@${event}` };
      return { event, state: "requested", reason: "grant state not queryable in this composition" };
    });
  };
  const outcome = () => {
    const missing = unsupported();
    if (missing !== undefined)
      return { id: missing.sub.outcome().id, state: "refused", detail: `${missing.sub.outcome().detail ?? "subscribeDecision is missing"}` };
    if (unbound())
      return { id: subs[0]?.sub.outcome().id ?? "", state: "absent", detail: "the mediated plugin host was not injected" };
    const measured = attempts();
    const confirmed = measured.filter((attempt) => attempt.state === "confirmed");
    const refused = measured.filter((attempt) => attempt.state === "refused");
    const first = refused[0] ?? measured[0];
    const id = subs[0]?.sub.outcome().id ?? "";
    if (confirmed.length > 0)
      return { id, state: "confirmed", detail: `${confirmed.length}/${measured.length} intercept point(s) registered` };
    if (refused.length === measured.length)
      return { id, state: "refused", detail: `${refused.length}/${measured.length} refused — ${first?.reason ?? "unknown"}` };
    return { id, state: "requested", detail: `unconfirmed — ${first?.reason ?? "unknown"}` };
  };
  const disclose = () => {
    const measured = attempts();
    if (measured.length === 0)
      return;
    const confirmed = measured.filter((attempt) => attempt.state === "confirmed");
    if (confirmed.length > 0) {
      log.info(`decision-event seam ACTIVE for ${confirmed.length} intercept point(s); handlers express no opinion`);
      return;
    }
    const first = measured.find((attempt) => attempt.state === "refused") ?? measured[0];
    log.warn("decision-event seam is ready but NOT activated: tui.dsh/v1alpha1#DecisionEvents registration was refused " + `(first refusal: ${first?.reason ?? "unknown"}). No input/rewind/session-switch/compact interception is claimed.`);
    return first?.reason;
  };
  tui.whenBound("pluginHost", () => {
    disclose();
  });
  return { outcome, attempts };
}

// packages/mpd-tui-plugin/src/commands.ts
var USAGE = `/${COMMAND_ROOT} [${COMMAND_ACTIONS.join("|")}]`;
function registerCommands(tui, actions) {
  const handle = tui.registerCommand({
    name: COMMAND_ROOT,
    description: "MPD: open the board or the team surfaces, list the workmate library, or print the status line",
    handler: async (invocation) => {
      const raw = typeof invocation?.rawInput === "string" ? invocation.rawInput.trim().toLowerCase() : "";
      const session = invocation?.agent?.session;
      if (raw === "") {
        const picked = await actions.pickAction();
        return runAction(picked ?? "board", actions, session);
      }
      const head = raw.split(/\s+/u)[0] ?? "";
      return runAction(head, actions, session);
    }
  });
  tui.registerCommand({
    name: MODEL_COMMAND,
    description: MODEL_COMMAND_DESCRIPTION,
    handler: async () => actions.openModelMenu()
  });
  return { outcome: () => handle.outcome() };
}
function runAction(action, actions, session) {
  if (action === "board") {
    actions.recordBoardOpened("command", session);
    const opened = actions.openBoard("command");
    return opened ? { kind: "success" } : { kind: "error", text: t("command.boardMissing") };
  }
  if (action === "workmates")
    return { kind: "success", text: clamp(actions.workmatesText()) };
  if (action === "status")
    return { kind: "success", text: clamp(actions.statusText()) };
  if (action === "team") {
    return actions.openTeam() ? { kind: "success" } : { kind: "error", text: t("command.teamMissing") };
  }
  if (action === "subagents") {
    return actions.openSubagents() ? { kind: "success" } : { kind: "error", text: t("command.subagentsMissing") };
  }
  if (action === "panel") {
    const route = actions.openPanel();
    return { kind: "success", text: clamp(panelStatusLine(route.outcome, route.id)) };
  }
  if (action === "plan") {
    return actions.openPlan() ? { kind: "success" } : { kind: "error", text: t("command.planMissing") };
  }
  return { kind: "error", text: t("command.unknownAction", { action: clamp(action, 40), usage: USAGE }) };
}
function appendBoardOpened(session, typeKnown, via, view, log) {
  if (session === undefined || typeof session.append !== "function")
    return false;
  if (!typeKnown) {
    log.debug("board-opened record skipped: the event type is not known to the live dsh-session copy");
    return false;
  }
  try {
    session.append(BOARD_OPENED_EVENT, { view, via, at: Date.now() });
    return true;
  } catch (error) {
    log.debug(`board-opened record failed: ${String(error?.message ?? error)}`);
    return false;
  }
}
function clamp(value, maxCells = 800) {
  return scalarText(value, maxCells) ?? "";
}

// packages/mpd-tui-plugin/src/model-menu.ts
var MODEL_NAMESPACE = "mpd";
var TEAM_MODELS_PREFIX = "teamModels";
var PANEL_TIMEOUT_MS = 120000;
var MENU_TEXT = {
  titleSlot: { zh: "MPD 模型槽位", en: "MPD model slot" },
  titleProvider: { zh: "MPD 提供商", en: "MPD provider" },
  titleModel: { zh: "MPD 模型", en: "MPD model" },
  titleEffort: { zh: "MPD 推理强度", en: "MPD reasoning effort" },
  slotHint: { zh: "该槽位驱动的成员组：{group}", en: "the member group this slot drives: {group}" },
  providerHint: { zh: "该槽位的提供商；模型列表来自它", en: "this slot's provider; the model list comes from it" },
  modelHint: { zh: "该槽位的模型", en: "this slot's model" },
  effortHint: { zh: "该槽位的推理强度", en: "this slot's reasoning effort" },
  sealedByDialogs: {
    zh: "mpd-model: 该组合没有对话框接缝（无界面嵌入），未打开菜单，也未写入任何设置",
    en: "mpd-model: this composition has no dialogs seam (a headless embedder) — no menu was opened and nothing was written"
  },
  sealedByCancelSlot: { zh: "mpd-model: 已取消槽位选择，未写入任何设置", en: "mpd-model: the slot panel was cancelled — nothing was written" },
  sealedByCancelProvider: { zh: "mpd-model: 已取消提供商选择，未写入任何设置", en: "mpd-model: the provider panel was cancelled — nothing was written" },
  sealedByCancelModel: { zh: "mpd-model: 已取消模型选择，未写入任何设置", en: "mpd-model: the model panel was cancelled — nothing was written" },
  sealedByCancelEffort: { zh: "mpd-model: 已取消推理强度选择，未写入任何设置", en: "mpd-model: the reasoning-effort panel was cancelled — nothing was written" },
  sealedByNoNamespace: {
    zh: "mpd-model: 该组合没有可写的设置接缝，未写入任何设置",
    en: "mpd-model: this composition exposes no settings write seam — nothing was written"
  },
  sealedByRefused: { zh: "mpd-model: 设置写入被拒绝（{error}）", en: "mpd-model: the settings write was refused ({error})" },
  sealedByNoSlot: { zh: "mpd-model: 未知槽位“{slot}”，未写入任何设置", en: 'mpd-model: unknown slot "{slot}" — nothing was written' },
  catalogFallback: {
    zh: "实时模型目录不可用（{why}）——面板列出的是内置回退清单，不是实时目录",
    en: "the live model catalog is unavailable ({why}) — the panels list the declared fallback, not the live catalog"
  },
  catalogDegraded: { zh: "模型目录读取不完整", en: "the catalog read was incomplete" },
  catalogAbsent: { zh: "该组合没有 llmCatalog 接缝", en: "this composition exposes no llmCatalog seam" },
  catalogThrew: { zh: "读取抛错：{error}", en: "the read threw: {error}" },
  wrote: {
    zh: "mpd-model: 槽位 {slot} 已设置 提供商 {provider} · 模型 {model} · 推理强度 {effort}；{disclosure}。{notLost}",
    en: "mpd-model: slot {slot} set to provider {provider} · model {model} · reasoning effort {effort}; {disclosure}. {notLost}"
  }
};
function fill(text, params) {
  let out = text;
  for (const [name, value] of Object.entries(params))
    out = out.split(`{${name}}`).join(value);
  return out;
}
function say(key, lang, params = {}) {
  return fill(pick(MENU_TEXT[key], lang), params);
}
function short(value) {
  return scalarText(value, 60) ?? value;
}
function slotPanelOptions(lang) {
  return TEAM_MODEL_SLOTS.map((slot, index) => {
    const group = TEAM_MODEL_SLOT_GROUPS[slot];
    return {
      id: slot,
      label: `${index + 1}. ${lang === "en" ? group.en : group.zh}`,
      description: say("slotHint", lang, { group: lang === "en" ? group.en : group.zh })
    };
  });
}
function panelOptions(lists, provider, model, catalog) {
  const providers = isRecord2(catalog) && Array.isArray(catalog.providers) ? catalog.providers : [];
  const providerRow = provider === undefined ? undefined : providers.find((entry) => isRecord2(entry) && entry.id === provider);
  const keyedModels = [];
  if (isRecord2(providerRow) && Array.isArray(providerRow.models)) {
    for (const entry of providerRow.models) {
      if (isRecord2(entry) && typeof entry.id === "string" && entry.id.length > 0) {
        keyedModels.push({ value: entry.id, label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id });
      }
    }
  }
  const modelRow = model === undefined ? undefined : findModel(providers, model);
  const keyedEfforts = [];
  if (isRecord2(modelRow) && Array.isArray(modelRow.efforts)) {
    for (const entry of modelRow.efforts) {
      if (isRecord2(entry) && typeof entry.id === "string" && entry.id.length > 0) {
        keyedEfforts.push({ value: entry.id, label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : effortLabel(entry.id) });
      }
    }
  }
  return {
    provider: lists.provider,
    model: keyedModels.length > 0 ? keyedModels : lists.model,
    reasoningEffort: keyedEfforts.length > 0 ? keyedEfforts : lists.reasoningEffort
  };
}
function findModel(providers, model) {
  for (const provider of providers) {
    if (!isRecord2(provider) || !Array.isArray(provider.models))
      continue;
    for (const entry of provider.models) {
      if (isRecord2(entry) && entry.id === model)
        return entry;
    }
  }
  return;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function storedSlot(value, slot) {
  if (!isRecord2(value))
    return {};
  const block = slotBlock(value, slot);
  const out = {};
  if (!isRecord2(block))
    return out;
  for (const leaf of ["provider", "model", "reasoningEffort"]) {
    const found = block[leaf];
    if (typeof found === "string" && found.length > 0)
      out[leaf] = found;
  }
  return out;
}
function slotBlock(value, slot) {
  for (const candidate of [value, value.user, value.value]) {
    if (!isRecord2(candidate))
      continue;
    const teamModels = candidate[TEAM_MODELS_PREFIX];
    if (isRecord2(teamModels) && teamModels[slot] !== undefined)
      return teamModels[slot];
  }
  return;
}
function locateNamespace(adapter, slot) {
  let revision;
  for (const namespace of [SETTINGS_ENTRY, MODEL_NAMESPACE]) {
    const reader = adapter.settingsReader?.(namespace);
    if (reader === undefined)
      continue;
    try {
      revision = reader.describe()?.revision;
    } catch {}
    const hasSlot = Object.keys(storedSlot(reader.get(), slot)).length > 0;
    if (hasSlot)
      return { namespace, revision };
  }
  return { namespace: SETTINGS_ENTRY, revision };
}
async function openModelMenu(tui, log, options = {}) {
  const lang = resolveLang(options.langInputs);
  const dialogs = options.dialogs ?? createDialogs(tui, log);
  if (!dialogs.available())
    return { kind: "error", text: say("sealedByDialogs", lang) };
  const adapter = options.adapter ?? resolveCatalogReader(options.ctx);
  let catalog;
  let catalogWhy;
  if (typeof adapter.llmCatalog !== "function") {
    catalogWhy = say("catalogAbsent", lang);
  } else {
    try {
      catalog = await adapter.llmCatalog();
      if (catalog === undefined || catalog === null)
        catalogWhy = say("catalogAbsent", lang);
      else if (catalog.degraded === true)
        catalogWhy = say("catalogDegraded", lang);
    } catch (error) {
      catalogWhy = say("catalogThrew", lang, { error: String(error?.message ?? error) });
    }
  }
  const lists = teamModelOptionLists(catalog);
  log.info(`/${MODEL_COMMAND} catalog=${catalogWhy === undefined ? "live" : "fallback"}` + ` provider=${lists.source.provider}(${lists.provider.length}) model=${lists.source.model}(${lists.model.length})` + ` reasoningEffort=${lists.source.reasoningEffort}(${lists.reasoningEffort.length})`);
  const slot = await dialogs.select(say("titleSlot", lang), slotPanelOptions(lang), PANEL_TIMEOUT_MS);
  if (slot === undefined)
    return { kind: "error", text: say("sealedByCancelSlot", lang) };
  if (!TEAM_MODEL_SLOTS.includes(slot))
    return { kind: "error", text: say("sealedByNoSlot", lang, { slot: short(slot) }) };
  const provider = await dialogs.select(say("titleProvider", lang), lists.provider.map((option) => ({ id: option.value, label: option.label, description: say("providerHint", lang) })), PANEL_TIMEOUT_MS);
  if (provider === undefined)
    return { kind: "error", text: say("sealedByCancelProvider", lang) };
  const models = panelOptions(lists, provider, undefined, catalog).model;
  const model = await dialogs.select(say("titleModel", lang), models.map((option) => ({ id: option.value, label: option.label, description: say("modelHint", lang) })), PANEL_TIMEOUT_MS);
  if (model === undefined)
    return { kind: "error", text: say("sealedByCancelModel", lang) };
  const efforts = panelOptions(lists, provider, model, catalog).reasoningEffort;
  const effort = await dialogs.select(say("titleEffort", lang), efforts.map((option) => ({ id: option.value, label: option.label, description: say("effortHint", lang) })), PANEL_TIMEOUT_MS);
  if (effort === undefined)
    return { kind: "error", text: say("sealedByCancelEffort", lang) };
  const target = locateNamespace(adapter, slot);
  if (typeof adapter.settingsMutate !== "function")
    return { kind: "error", text: say("sealedByNoNamespace", lang) };
  const ops = ["provider", "model", "reasoningEffort"].map((leaf) => ({
    op: "set",
    path: [TEAM_MODELS_PREFIX, slot, leaf],
    value: leaf === "provider" ? provider : leaf === "model" ? model : effort
  }));
  const written = await adapter.settingsMutate(target.namespace, ops, target.revision);
  if (!written.ok)
    return { kind: "error", text: say("sealedByRefused", lang, { error: short(written.error) }) };
  log.info(`/${MODEL_COMMAND} wrote ${target.namespace}.${TEAM_MODELS_PREFIX}.${slot} = ${provider}/${model}/${effort}`);
  const fallback = catalogWhy === undefined ? "" : ` · ${say("catalogFallback", lang, { why: catalogWhy })}`;
  return {
    kind: "success",
    text: `${say("wrote", lang, {
      slot,
      provider: short(provider),
      model: short(model),
      effort: short(effort),
      disclosure: BRIDGE_DISCLOSURE,
      notLost: BRIDGE_NOT_LOST
    })}${fallback}`
  };
}

// packages/mpd-tui-plugin/src/index.ts
var name = "mpd-tui";
var Config = import_schemastery2.default.object({
  statusLine: import_schemastery2.default.boolean().default(true),
  statusIntervalMs: import_schemastery2.default.number().default(3000),
  renderers: import_schemastery2.default.boolean().default(true),
  settingsSection: import_schemastery2.default.boolean().default(true),
  scene: import_schemastery2.default.boolean().default(true),
  commandTrees: import_schemastery2.default.boolean().default(true),
  commands: import_schemastery2.default.boolean().default(true),
  shortcuts: import_schemastery2.default.boolean().default(true),
  dialogs: import_schemastery2.default.boolean().default(true),
  panel: import_schemastery2.default.boolean().default(true),
  dashboardKey: import_schemastery2.default.boolean().default(true),
  sessionEvents: import_schemastery2.default.boolean().default(true),
  decisionEvents: import_schemastery2.default.boolean().default(true),
  logPrefix: import_schemastery2.default.string().default("mpd-tui")
});
function resolveConfig(config = {}) {
  const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
  const valid = typeof config.statusIntervalMs === "number" && Number.isFinite(config.statusIntervalMs) && config.statusIntervalMs >= 0;
  return {
    statusLine: bool(config.statusLine, true),
    statusIntervalMs: valid ? config.statusIntervalMs : 3000,
    renderers: bool(config.renderers, true),
    settingsSection: bool(config.settingsSection, true),
    scene: bool(config.scene, true),
    commandTrees: bool(config.commandTrees, true),
    commands: bool(config.commands, true),
    shortcuts: bool(config.shortcuts, true),
    dialogs: bool(config.dialogs, true),
    panel: bool(config.panel, true),
    dashboardKey: bool(config.dashboardKey, true),
    sessionEvents: bool(config.sessionEvents, true),
    decisionEvents: bool(config.decisionEvents, true),
    logPrefix: typeof config.logPrefix === "string" && config.logPrefix.length > 0 ? config.logPrefix : "mpd-tui"
  };
}
function resolveAdapter(ctx) {
  try {
    const mounted = serviceOf(ctx, "mpdDsh");
    if (mounted !== undefined)
      return mounted;
  } catch {}
  return createDshAdapter(ctx);
}
function workspaceResolver(ctx, adapter) {
  let resolved = adapter;
  if (resolved === undefined) {
    try {
      resolved = resolveAdapter(ctx);
    } catch {
      resolved = undefined;
    }
  }
  return () => {
    try {
      const roots = resolved?.workspaceRootsAll() ?? [];
      if (roots.length > 0)
        return roots[0];
    } catch {}
    try {
      return resolved?.workspaceRoot() ?? process.cwd();
    } catch {
      return process.cwd();
    }
  };
}
function createPlanActions(adapter, log) {
  const PLAN_TOOL = "agent_teams_plan";
  const sessionIdOfAgent = (agent) => {
    const session = agent?.session;
    return typeof session?.id === "string" ? session.id : undefined;
  };
  const liveAgentFor = (sessionId) => {
    if (typeof adapter.liveAgent !== "function" || typeof adapter.liveAgents !== "function")
      return;
    const wanted = typeof sessionId === "string" ? sessionId : "";
    try {
      if (wanted !== "") {
        const byId = adapter.liveAgent(wanted);
        if (byId !== undefined)
          return byId;
        return adapter.liveAgents().find((candidate) => sessionIdOfAgent(candidate) === wanted);
      }
      const live = adapter.liveAgents();
      return live.length === 1 ? live[0] : undefined;
    } catch {
      return;
    }
  };
  const call = async (args, sessionId) => {
    const agent = liveAgentFor(sessionId);
    if (agent === undefined) {
      const error = typeof sessionId === "string" && sessionId !== "" ? `session "${scalarText(sessionId, 80) ?? sessionId}" is not live in this process — no live agent to speak as, so nothing was called` : "no live agent to speak as and no session id on this surface — nothing was called";
      log.warn(`plan ${String(args.action)} refused: ${scalarText(error, 200) ?? error}`);
      return { ok: false, error };
    }
    try {
      const result = await adapter.executeTool({ name: PLAN_TOOL, arguments: args, agent });
      if (result.ok && !result.isError)
        return { ok: true, ...result.value === undefined ? {} : { value: result.value } };
      return { ok: false, error: typeof result.error === "string" ? result.error : JSON.stringify(result.error ?? result.raw ?? "the call failed") };
    } catch (error) {
      log.warn(`plan ${String(args.action)} failed: ${String(error?.message ?? error)}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
  return {
    available: () => {
      try {
        return adapter.hasTool(PLAN_TOOL);
      } catch {
        return false;
      }
    },
    approve: async (input) => call({ action: "approve", confirmation: input.confirmation }, input.sessionId ?? input.captainSessionId),
    discard: async (input) => call({ action: "delete" }, input.sessionId ?? input.captainSessionId)
  };
}
function homeDir() {
  const env = process.env.HOME;
  if (typeof env === "string" && env.length > 0)
    return env;
  try {
    return homedir5();
  } catch {
    return "";
  }
}
function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  const adapter = resolveAdapter(ctx);
  const tui = resolveTuiAdapter(ctx);
  const workspaceRoot = workspaceResolver(ctx, adapter);
  const log = createLog(ctx?.logger, resolved.logPrefix, process.env, () => tui.diagnosticSink({ root: workspaceRoot }));
  const home = () => homeDir();
  const teamViews = () => liveTeamViews(adapter, workspaceRoot());
  let teamsService;
  onService(ctx, "mpdTeams", (_scoped, service) => {
    teamsService = service;
  });
  const teamRecords = () => mpdTeamRecords(teamsService, workspaceRoot());
  const planReader = (sessionId) => readPlanView(teamsService, workspaceRoot(), sessionId);
  const sessionEventTypeKnown = resolved.sessionEvents ? registerLogOnlyEventType(BOARD_OPENED_EVENT, log) : false;
  const outcomes = [];
  const record = (handle) => {
    const measured = handle.outcome();
    outcomes.push({ id: measured.id, outcome: measured });
  };
  const skipped = (key, detail) => tui.skipped(key, detail);
  let configHandle;
  const bridgeRead = () => {
    try {
      const skipped2 = configHandle?.states?.()?.writeback?.skipped;
      if (skipped2 === "no-live-session")
        return NO_LIVE_SESSION_NOTICE;
      if (skipped2 === "ambiguous-multi-root")
        return AMBIGUOUS_MULTI_ROOT_NOTICE;
      return;
    } catch {
      return;
    }
  };
  onService(ctx, "mpdConfig", (_scoped, service) => {
    configHandle = service;
  });
  const dialogs = createDialogs(tui, log);
  let status = {
    ...tui.skipped("status", "not wired yet"),
    refresh: () => {}
  };
  const watchdogFrontDoor = attachWatchdogFrontDoor(ctx, tui, log, {
    workspaceRoot,
    dialogs,
    onAcknowledged: () => status.refresh()
  });
  const noticeRead = () => composeNotices(bridgeRead(), watchdogFrontDoor.notice());
  status = resolved.statusLine ? registerStatus(ctx, tui, log, workspaceRoot, home, resolved.statusIntervalMs, noticeRead, teamViews, teamRecords) : { ...skipped("status", "disabled by config"), refresh: () => {} };
  const scene = resolved.scene ? registerScene(ctx, tui, log, workspaceRoot, home, () => watchdogFrontDoor.view().holds, createPlanActions(adapter, log), planReader, teamViews, teamRecords, (ui) => tui.rememberHostKit(ui)) : {
    ...skipped("scenes", "disabled by config"),
    open: () => false,
    openScene: () => false,
    openTeam: () => false,
    openPlan: () => false,
    openSubagents: () => false
  };
  const panel = registerPanelSurface(tui, {
    enabled: resolved.panel,
    readWorkflow: () => readDashboardWorkflow(workspaceRoot, () => watchdogFrontDoor.view().holds, teamViews, teamRecords),
    openMergedScene: () => scene.openSubagents(),
    log
  });
  const dashboardKeyEnabled = () => {
    let saved;
    try {
      const live = configHandle?.get?.(DASHBOARD_TAKEOVER_KNOB);
      if (typeof live === "boolean")
        saved = live;
    } catch {}
    return takeoverArmed(tui.panelSeamBound(), saved, resolved.dashboardKey);
  };
  const dashboardKey = !tui.panelSeamBound() ? resolved.dashboardKey ? registerDashboardKey(ctx, tui, {
    enabled: dashboardKeyEnabled,
    mergedSceneAvailable: () => resolved.scene && tui.scenes() !== undefined,
    readWorkflow: () => readDashboardWorkflow(workspaceRoot, () => watchdogFrontDoor.view().holds, teamViews, teamRecords),
    openMergedScene: () => scene.openSubagents(),
    log
  }) : tui.skipped("status", "the Ctrl+A takeover is disabled by the mpd-tui row config (dashboardKey: false)") : tui.skipped("status", "the host exposes the sidebar panel seam (dsh-tui 0.13.0+), so the legacy Ctrl+A host-input contact stays inert: Ctrl+A keeps its host dashboard meaning and the merged view opens through alt+a and /mpd panel");
  const renderers = resolved.renderers ? registerRenderers(ctx, tui, log) : skipped("renderers", "disabled by config");
  const settings = resolved.settingsSection ? registerSettingsSection(ctx, tui, log) : skipped("settingsSections", "disabled by config");
  const trees = resolved.commandTrees ? registerCommandTrees(tui) : skipped("commandTrees", "disabled by config");
  const openMergedPanel = () => {
    const routed = panel.openOrScene();
    return { ...routed, id: panel.id() };
  };
  const shortcuts = resolved.shortcuts ? registerShortcuts(ctx, tui, log, {
    openBoard: () => scene.open(),
    openTeam: () => scene.openTeam(),
    openSubagents: () => {
      const route = openMergedPanel();
      return route.outcome === "opened" || route.sceneOpened;
    },
    refreshStatus: () => status.refresh(),
    pickWorkmate: () => {
      pickWorkmate(log, dialogs, workspaceRoot, home, scene, teamViews, teamRecords);
    }
  }) : skipped("shortcuts", "disabled by config");
  const commands = resolved.commands ? registerCommands(tui, {
    openBoard: () => scene.open(),
    openTeam: () => scene.openTeam(),
    openPlan: () => scene.openPlan(),
    openSubagents: () => {
      const route = openMergedPanel();
      return route.outcome === "opened" || route.sceneOpened;
    },
    openPanel: () => {
      const route = openMergedPanel();
      return { outcome: route.outcome, id: route.id };
    },
    statusText: () => boardSummary(workspaceRoot, home, teamViews, teamRecords),
    workmatesText: () => {
      const state = readBoardState(workspaceRoot(), home(), teamViews(), teamRecords());
      return state.workmates.count === 0 ? t("command.workmatesNone") : t("command.workmatesList", { count: String(state.workmates.count), names: state.workmates.names.join(", ") });
    },
    pickAction: () => pickAction(log, dialogs),
    openModelMenu: () => openModelMenu(tui, log, { dialogs, ctx }),
    recordBoardOpened: (via, session) => {
      if (!resolved.sessionEvents)
        return;
      appendBoardOpened(session, sessionEventTypeKnown, via, "board", log);
    }
  }) : skipped("commands", "disabled by config");
  const decisions = resolved.decisionEvents ? attemptDecisionEvents(ctx, tui, log) : { ...skipped("pluginHost", "disabled by config"), attempts: () => [] };
  record(status);
  record(renderers);
  record(settings);
  record(scene);
  outcomes.push({ id: "panel", outcome: panel.outcome() });
  log.debug(`sidebar panel id: ${panel.id() ?? "(not discovered)"}`);
  outcomes.push({ id: "dashboardKey", outcome: dashboardKey.outcome() });
  record(trees);
  record(shortcuts);
  record(dialogs);
  record(commands);
  outcomes.push({ id: "decisionEvents", outcome: decisions.outcome() });
  reportOutcomes(log, outcomes.map((entry) => entry.outcome));
  log.debug(`session event type ${BOARD_OPENED_EVENT}: ${sessionEventTypeKnown ? "verified known" : "NOT verified (records will be skipped)"}`);
  return { outcomes, sessionEventTypeKnown };
}
async function pickAction(log, dialogs) {
  if (!dialogs.available())
    return;
  const choice = await dialogs.select("mpd", [
    { id: "board", label: "Board", description: "team, tasks, boulder, plans, workmates" },
    { id: "team", label: "Team", description: "team workflow: phase, roster, task DAG" },
    { id: "plan", label: "Plan", description: "review and approve a staged plan" },
    { id: "subagents", label: "Subagents", description: "the host's subagent rows above the team panel" },
    { id: "panel", label: "Panel", description: "the sidebar panel (dsh-tui 0.13.0), or the full-screen fallback" },
    { id: "workmates", label: "Workmates", description: "list the durable workmate library" },
    { id: "status", label: "Status", description: "print the mpd status line" }
  ]);
  if (choice !== undefined)
    log.debug(`/mpd picker chose ${scalarText(choice, 40) ?? "?"}`);
  return choice;
}
async function pickWorkmate(log, dialogs, workspaceRoot, home, scene, teamViews, teamRecords = () => []) {
  const names = readBoardState(workspaceRoot(), home(), teamViews(), teamRecords()).workmates.names;
  if (!dialogs.available() || names.length === 0) {
    scene.open();
    return;
  }
  const id = await dialogs.select("mpd workmates", names.slice(0, 50).map((entry) => ({ id: entry, label: entry })));
  if (id !== undefined)
    log.debug(`workmate picked: ${scalarText(id, 60) ?? "?"}`);
  scene.open();
}
export {
  Config,
  apply,
  createPlanActions,
  name,
  resolveConfig,
  workspaceResolver
};
