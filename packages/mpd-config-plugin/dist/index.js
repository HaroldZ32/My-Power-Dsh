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
  noop: () => noop2,
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
function noop2() {}
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
  Schema.extend = function extend(type, resolve3) {
    resolvers[type] = resolve3;
  };
  Schema.resolve = function resolve3(data, schema, options = {}, strict = false) {
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

// packages/mpd-config-plugin/src/index.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname as dirname2, join as join3, resolve as resolve3 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve as resolve2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/shared.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
var LOG_SUBDIR = join(".mpd", "logs");
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
    const dir = join(root, LOG_SUBDIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.log`);
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
var DSH_SEAM_TOOLS = "tools";
function dshSeamInject(...names) {
  return [...names];
}
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
function noop() {}
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
  function toolReachable(name) {
    try {
      const hostView = service("tools");
      if (typeof hostView?.get === "function" && hostView.get(name) !== undefined)
        return true;
    } catch {}
    return liveAgents().some((candidate) => {
      const scoped = scopedToolRegistry(candidate);
      if (scoped === undefined)
        return false;
      try {
        return scoped.get(name) !== undefined;
      } catch {
        return false;
      }
    });
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
      return typeof registered === "function" ? registered : noop;
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
        return noop;
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
      return typeof registered === "function" ? registered : noop;
    },
    registerPromptSection(section) {
      const systemPrompt = requireService("systemPrompt", 'cannot register prompt section "' + String(section?.name) + '"');
      if (typeof systemPrompt.section !== "function")
        throw new Error("mpd-dsh-adapter: the harness systemPrompt service exposes no section()");
      const registered = systemPrompt.section(section);
      return typeof registered === "function" ? registered : noop;
    },
    guardTool(guard) {
      const tools = requireService("tools", "cannot install a tool guard");
      if (typeof tools.guard !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()");
      return tools.guard((exec) => guard(exec ?? {}));
    },
    onPreToolExecute(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
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
        return noop;
      return ctx.on("tools/post-execute", async (exec, result, next) => {
        const downstream = typeof next === "function" ? await next() ?? { kind: "accept" } : { kind: "accept" };
        const decided = await listener(exec ?? {}, result ?? {}, downstream);
        return decided ?? downstream;
      });
    },
    onAgentPreStep(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
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
      return typeof registered === "function" ? registered : noop;
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
      return typeof registered === "function" ? registered : noop;
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
var SERVICE_NAME = "mpdDsh";
function resolveDshAdapter(ctx) {
  const get = typeof ctx?.get === "function" ? ctx.get : undefined;
  const mounted = get === undefined ? undefined : get.call(ctx, SERVICE_NAME);
  return mounted ?? createDshAdapter(ctx);
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
  boulder: import_schemastery.default.object({ dir: import_schemastery.default.string().default(".mpd") }),
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
  })
});
var BRIDGE_DISCLOSURE = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount) — it applies at the next dsh boot, because the file-derived base is fixed for the running process's lifetime";
var BRIDGE_NOT_LOST = "the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session";
function markVolatile(schema) {
  const node = schema;
  const kind = typeof node;
  if (node === null || kind !== "object" && kind !== "function")
    return schema;
  try {
    node.meta = { ...node.meta ?? {}, volatile: true };
  } catch {}
  if (node.dict !== undefined && typeof node.dict === "object")
    for (const child of Object.values(node.dict))
      markVolatile(child);
  if (node.inner !== undefined)
    markVolatile(node.inner);
  if (Array.isArray(node.list))
    for (const child of node.list)
      markVolatile(child);
  return schema;
}
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
  ...TEAM_MODEL_KNOBS
];

// packages/mpd-config-plugin/src/index.ts
var import_schemastery2 = __toESM(require_lib(), 1);

// packages/mpd-config-plugin/src/bridge.ts
import { existsSync, mkdirSync as mkdirSync2, readFileSync, renameSync as renameSync2, statSync as statSync2, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join as join2 } from "node:path";

// packages/mpd-config-plugin/src/jsonc-edit.ts
var DELETE = Symbol.for("mpd.jsonc.delete");
function isWs(ch) {
  return ch === " " || ch === "\t" || ch === `
` || ch === "\r";
}
function skipTrivia(src, pos) {
  let i = pos;
  for (;; ) {
    while (i < src.length && isWs(src[i]))
      i++;
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== `
`)
        i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i = Math.min(src.length, i + 2);
      continue;
    }
    return i;
  }
}
function scanString(src, pos) {
  let i = pos + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"')
      return i + 1;
    i++;
  }
  return src.length;
}
function scanValue(src, pos) {
  const start = pos;
  const ch = src[pos];
  if (ch === '"') {
    const end = scanString(src, pos);
    return { start, end };
  }
  let i = pos;
  while (i < src.length && !/[\s,}\]]/.test(src[i]))
    i++;
  return { start, end: i };
}
function parseContainer(src, open) {
  const kind = src[open] === "{" ? "object" : "array";
  const closeCh = kind === "object" ? "}" : "]";
  const entries = [];
  let i = skipTrivia(src, open + 1);
  let trailingComma = false;
  for (;; ) {
    if (i >= src.length)
      return;
    if (src[i] === closeCh) {
      return { kind, open, close: i, entries };
    }
    if (kind === "array") {
      let end2;
      if (src[i] === "{" || src[i] === "[") {
        const nested = parseContainer(src, i);
        if (nested === undefined)
          return;
        end2 = nested.close + 1;
      } else {
        end2 = scanValue(src, i).end;
      }
      entries.push({ valueStart: i, valueEnd: end2 });
      i = skipTrivia(src, end2);
      if (src[i] === ",") {
        i = skipTrivia(src, i + 1);
        trailingComma = src[i] === closeCh;
        continue;
      }
      if (src[i] === closeCh)
        continue;
      return;
    }
    if (src[i] !== '"')
      return;
    const keyStart = i;
    const keyEnd = scanString(src, i);
    const keyRaw = src.slice(keyStart, keyEnd);
    let key;
    try {
      key = JSON.parse(keyRaw);
    } catch {
      return;
    }
    i = skipTrivia(src, keyEnd);
    if (src[i] !== ":")
      return;
    i = skipTrivia(src, i + 1);
    if (i >= src.length)
      return;
    let end;
    if (src[i] === "{" || src[i] === "[") {
      const nested = parseContainer(src, i);
      if (nested === undefined)
        return;
      end = nested.close + 1;
    } else if (src[i] === '"') {
      end = scanString(src, i);
    } else {
      end = scanValue(src, i).end;
    }
    entries.push({ keyRaw, key, keyStart, keyEnd, valueStart: i, valueEnd: end });
    i = skipTrivia(src, end);
    if (src[i] === ",") {
      i = skipTrivia(src, i + 1);
      if (src[i] === closeCh)
        trailingComma = true;
      continue;
    }
    if (src[i] === closeCh)
      continue;
    return;
  }
}
function detectStyle(raw) {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;
  const indentMatch = raw.match(/\n([ \t]+)(?=")/);
  return {
    eol: crlf > lf ? `\r
` : `
`,
    trailingComma: /,\s*[}\]]/.test(raw.replace(/"(?:[^"\\]|\\.)*"/g, '""')),
    indent: indentMatch === null ? "  " : indentMatch[1]
  };
}
function stripJsoncText(src) {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"')
        inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== `
`)
        i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (ch === ",") {
      const j = skipTrivia(src, i + 1);
      if (src[j] === "}" || src[j] === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
function indentFor(src, open, style) {
  let depth = 0;
  let inString = false;
  for (let i = 0;i < open; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === "\\")
        i++;
      else if (ch === '"')
        inString = false;
      continue;
    }
    if (ch === '"')
      inString = true;
    else if (ch === "{" || ch === "[")
      depth++;
    else if (ch === "}" || ch === "]")
      depth--;
  }
  return style.indent.repeat(Math.max(depth, 0));
}
function lineAt(src, offset) {
  let line = 1;
  for (let i = 0;i < offset && i < src.length; i++)
    if (src[i] === `
`)
      line++;
  return line;
}
function locate(src, root, path, allowMaterialise, parentOnly = false) {
  let container = root;
  for (let index = 0;index < path.length; index++) {
    const segment = path[index];
    const last = index === path.length - 1;
    if (container.kind === "array") {
      const at = Number(segment);
      if (!Number.isInteger(at) || at < 0 || at >= container.entries.length) {
        if (last)
          return { container, ok: true };
        if (allowMaterialise)
          return { container, missingFrom: index, ok: true };
        return { ok: false, reason: "span-not-proven", detail: `array index ${segment} out of range` };
      }
      const entry2 = container.entries[at];
      if (last)
        return { container, ...parentOnly ? {} : { entry: entry2 }, ok: true };
      const nested2 = parseContainer(src, entry2.valueStart);
      if (nested2 === undefined)
        return { ok: false, reason: "unsupported-shape", detail: "array element is not a container" };
      container = nested2;
      continue;
    }
    const matches = container.entries.filter((e) => e.key === segment);
    if (matches.length === 0) {
      if (last)
        return { container, ok: true };
      if (allowMaterialise)
        return { container, missingFrom: index, ok: true };
      return { ok: false, reason: "span-not-proven", detail: `missing intermediate "${segment}"` };
    }
    if (matches.length > 1) {
      const lines = matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)).join(", ");
      if (!last) {
        return { ok: false, reason: "ambiguous-intermediate", detail: `key "${segment}" appears ${matches.length} times (lines ${lines})` };
      }
      const chosen = matches[matches.length - 1];
      const duplicate = { lines: matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)) };
      return { container, entry: chosen, ok: true, ...duplicate };
    }
    const entry = matches[0];
    if (last)
      return { container, ...parentOnly ? {} : { entry }, ok: true };
    const nested = parseContainer(src, entry.valueStart);
    if (nested === undefined) {
      return { ok: false, reason: "unsupported-shape", detail: `"${segment}" is not an object` };
    }
    container = nested;
  }
  return { container, ok: true };
}
function surgicalEdit(raw, path, value, options = {}) {
  if (value === DELETE)
    return surgicalDelete(raw, path);
  const style = detectStyle(raw);
  let parsed;
  try {
    parsed = JSON.parse(stripJsoncText(raw));
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String(error?.message ?? error) };
  }
  let serialised;
  try {
    serialised = JSON.stringify(value, null, 2);
  } catch {
    return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" };
  }
  if (serialised === undefined)
    return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" };
  const open = skipTrivia(raw, 0);
  const root = parseContainer(raw, open);
  if (root === undefined)
    return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" };
  const found = locate(raw, root, path, options.insert === true);
  if (found.ok !== true)
    return found;
  if (found.entry !== undefined) {
    const existing = raw.slice(found.entry.valueStart, found.entry.valueEnd);
    if (existing === serialised)
      return { ok: true, text: raw, style, changed: false };
    const note = duplicateNote(found.lines, path, "updated");
    return {
      ok: true,
      text: raw.slice(0, found.entry.valueStart) + serialised + raw.slice(found.entry.valueEnd),
      style,
      changed: true,
      ...note === undefined ? {} : { notes: [note] }
    };
  }
  if (options.insert !== true)
    return { ok: false, reason: "span-not-proven", detail: path.join(".") };
  const eol = style.eol;
  const missingFrom = found.missingFrom ?? path.length - 1;
  const leafKey = path[missingFrom];
  const rest = path.slice(missingFrom + 1);
  let subtree = value;
  for (let i = rest.length - 1;i >= 0; i--) {
    const segment = rest[i];
    subtree = /^\d+$/.test(segment) ? [subtree] : { [segment]: subtree };
  }
  const serialisedSubtree = JSON.stringify(subtree, null, 2);
  const container = found.container;
  if (container.kind === "object") {
    const indent2 = indentFor(raw, container.open, style);
    const inner2 = indent2 + style.indent;
    const memberText = `${JSON.stringify(leafKey)}: ${serialisedSubtree.split(`
`).join(eol + inner2)}`;
    const entries2 = container.entries;
    if (entries2.length === 0) {
      const text = raw.slice(0, container.open + 1) + eol + inner2 + memberText + eol + indent2 + raw.slice(container.close);
      return { ok: true, text, style, changed: true };
    }
    const lastEntry2 = entries2[entries2.length - 1];
    const afterLast2 = skipTrivia(raw, lastEntry2.valueEnd);
    if (raw[afterLast2] === ",") {
      const insertAt = afterLast2 + 1;
      const tail = style.trailingComma ? "," : "";
      return { ok: true, text: raw.slice(0, insertAt) + eol + inner2 + memberText + tail + raw.slice(insertAt), style, changed: true };
    }
    return { ok: true, text: raw.slice(0, lastEntry2.valueEnd) + "," + eol + inner2 + memberText + raw.slice(lastEntry2.valueEnd), style, changed: true };
  }
  const indent = indentFor(raw, container.open, style);
  const inner = indent + style.indent;
  const entries = container.entries;
  const item = serialisedSubtree.split(`
`).join(eol + inner);
  if (entries.length === 0) {
    const text = raw.slice(0, container.open + 1) + eol + inner + item + eol + indent + raw.slice(container.close);
    return { ok: true, text, style, changed: true };
  }
  const lastEntry = entries[entries.length - 1];
  const afterLast = skipTrivia(raw, lastEntry.valueEnd);
  if (raw[afterLast] === ",") {
    const insertAt = afterLast + 1;
    const tail = style.trailingComma ? "," : "";
    return { ok: true, text: raw.slice(0, insertAt) + eol + inner + item + tail + raw.slice(insertAt), style, changed: true };
  }
  return { ok: true, text: raw.slice(0, lastEntry.valueEnd) + "," + eol + inner + item + raw.slice(lastEntry.valueEnd), style, changed: true };
}
function surgicalDelete(raw, path) {
  const style = detectStyle(raw);
  try {
    JSON.parse(stripJsoncText(raw));
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String(error?.message ?? error) };
  }
  const open = skipTrivia(raw, 0);
  const root = parseContainer(raw, open);
  if (root === undefined)
    return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" };
  const all = locateAllLeaves(raw, root, path);
  if (all.ok !== true)
    return all;
  const spans = all.entries.map((entry) => {
    const start = entry.keyStart ?? entry.valueStart;
    const end = entry.valueEnd;
    let from = start;
    let to = end;
    const tail = raw.slice(end);
    const commaAfter = /^\s*,/.exec(tail);
    if (commaAfter !== null) {
      to = end + commaAfter[0].length;
    } else {
      const head = raw.slice(0, start);
      const commaBefore = /,\s*$/.exec(head);
      if (commaBefore !== null)
        from = start - commaBefore[0].length;
    }
    return { from, to };
  }).sort((a, b) => b.from - a.from);
  let text = raw;
  for (const span of spans)
    text = text.slice(0, span.from) + text.slice(span.to);
  const note = duplicateNote(all.lines, path, "removed");
  let reparsed;
  try {
    reparsed = JSON.parse(stripJsoncText(text));
  } catch (error) {
    return { ok: false, reason: "unsupported-shape", detail: `deletion would leave invalid JSONC: ${String(error?.message ?? error)}` };
  }
  return { ok: true, text, style, changed: true, ...note === undefined ? {} : { notes: [note] } };
}
function duplicateNote(lines, path, action) {
  if (lines === undefined || lines.length < 2)
    return;
  return {
    reason: "duplicate-key",
    lines: [...lines],
    detail: `key "${path.join(".")}" appears ${lines.length} times at lines ${lines.join(", ")}; ${action === "updated" ? "the last occurrence is the effective value and was updated" : "every occurrence was removed, so the key is unset at runtime too"}`
  };
}
function locateAllLeaves(src, root, path) {
  if (path.length === 0)
    return { ok: false, reason: "span-not-proven", detail: "the document root has no leaf span" };
  const parent = locate(src, root, path, false, true);
  if (parent.ok !== true)
    return parent;
  const last = path[path.length - 1];
  const entries = parent.container.kind === "array" ? parent.container.entries.filter((_entry, index) => String(index) === last) : parent.container.entries.filter((entry) => entry.key === last);
  if (entries.length === 0)
    return { ok: false, reason: "span-not-proven", detail: path.join(".") };
  const allProven = entries.every((entry) => entry.valueStart <= entry.valueEnd);
  if (!allProven)
    return { ok: false, reason: "span-not-proven", detail: path.join(".") };
  return { ok: true, entries, lines: entries.map((entry) => lineAt(src, entry.keyStart ?? entry.valueStart)) };
}
function readJsonc(raw) {
  try {
    return { ok: true, value: JSON.parse(stripJsoncText(raw)) };
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String(error?.message ?? error) };
  }
}

// packages/mpd-config-plugin/src/bridge.ts
var DEFAULT_BRIDGE_OPTIONS = { writeBack: true, retries: 3 };
function createdFileHeader(now = new Date) {
  return `// mpd.jsonc — written by the mpd settings bridge (${now.toISOString()})
// Comments and key order are preserved: the bridge rewrites only the values it is asked to change.
`;
}
function resolveTargets(roots, projectFile) {
  const distinct = [...new Set(roots.filter((root) => typeof root === "string" && root.length > 0))];
  if (distinct.length === 0)
    return { kind: "refuse", reason: "no-live-session", candidates: [] };
  if (distinct.length > 1)
    return { kind: "refuse", reason: "ambiguous-multi-root", candidates: distinct };
  return { kind: "write", targets: targetFiles(distinct, projectFile) };
}
function sectionLeaves(section, prefix = []) {
  if (section === null || typeof section !== "object" || Array.isArray(section)) {
    return prefix.length === 0 ? [] : [{ path: prefix, value: section }];
  }
  const out = [];
  for (const [key, value] of Object.entries(section)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value))
      out.push(...sectionLeaves(value, [...prefix, key]));
    else
      out.push({ path: [...prefix, key], value });
  }
  return out;
}
function changedLeaves(prev, next) {
  const key = (leaf) => leaf.path.join("\x00");
  const before = new Map(sectionLeaves(prev).map((leaf) => [key(leaf), leaf.value]));
  const after = sectionLeaves(next);
  const written = [];
  for (const leaf of after) {
    if (!before.has(key(leaf)) || JSON.stringify(before.get(key(leaf))) !== JSON.stringify(leaf.value))
      written.push(leaf);
  }
  const afterKeys = new Set(after.map(key));
  const removed = sectionLeaves(prev).filter((leaf) => !afterKeys.has(key(leaf)));
  return { written, removed };
}
function targetFiles(roots, projectFile) {
  const seen = new Set;
  const out = [];
  for (const root of roots) {
    const file = projectFile !== undefined && roots.length === 1 ? projectFile : join2(root, ".mpd", "mpd.jsonc");
    if (seen.has(file))
      continue;
    seen.add(file);
    out.push({ root, file });
  }
  return out;
}
function errnoOf(error) {
  const code = error?.code;
  return typeof code === "string" ? code : undefined;
}
function isWritableFile(file) {
  try {
    const info = statSync2(file);
    const mode = info.mode;
    if ((mode & 146) === 0)
      return { ok: false, reason: "EACCES", detail: "the target file has no write bit set" };
    return { ok: true };
  } catch (error) {
    if (existsSync(file))
      return { ok: false, reason: errnoOf(error) ?? "EACCES", detail: String(error?.message ?? error) };
    const dir = dirname(file);
    try {
      if (!existsSync(dir))
        mkdirSync2(dir, { recursive: true });
      return { ok: true };
    } catch (error2) {
      return { ok: false, reason: errnoOf(error2) ?? "EACCES", detail: `cannot create ${dir}: ${String(error2?.message ?? error2)}` };
    }
  }
}
function writeBackLeaves(targets, leaves, options = DEFAULT_BRIDGE_OPTIONS) {
  if (!options.writeBack)
    return { writtenTo: [], results: [], skipped: "disabled", applies: "restart" };
  if (leaves.length === 0)
    return { writtenTo: [], results: [], skipped: "no-changes", applies: "restart" };
  if (targets.length === 0)
    return { writtenTo: [], results: [], skipped: "no-live-session", applies: "restart" };
  const results = [];
  const writtenTo = [];
  for (const target of targets) {
    let attempt = 0;
    let settled = false;
    while (!settled && attempt <= options.retries) {
      attempt += 1;
      const existed = existsSync(target.file);
      let raw;
      if (existed) {
        const writable = isWritableFile(target.file);
        if (!writable.ok) {
          results.push({ root: target.root, file: target.file, outcome: "denied", reason: writable.reason === "EACCES" || writable.reason === "EPERM" ? "read-only" : writable.reason, detail: writable.detail });
          settled = true;
          break;
        }
        try {
          raw = readFileSync(target.file, "utf8");
        } catch (error) {
          results.push({ root: target.root, file: target.file, outcome: "denied", reason: errnoOf(error) ?? "EACCES", detail: String(error?.message ?? error) });
          settled = true;
          break;
        }
        const parsed = readJsonc(raw);
        if (parsed.ok !== true) {
          results.push({ root: target.root, file: target.file, outcome: "unparsable", reason: "unparsable", detail: parsed.detail ?? "the file is not valid JSONC" });
          settled = true;
          break;
        }
      } else {
        raw = createdFileHeader() + `{
}
`;
      }
      let text = raw;
      let refused;
      const notes = [];
      for (const leaf of leaves) {
        const edited = surgicalEdit(text, leaf.path, leaf.value, { insert: true });
        if (edited.ok !== true) {
          refused = { reason: edited.reason, detail: edited.detail };
          break;
        }
        if (edited.notes !== undefined)
          notes.push(...edited.notes.map((note) => ({ reason: note.reason, detail: note.detail, lines: note.lines })));
        text = edited.text;
      }
      if (refused !== undefined) {
        results.push({ root: target.root, file: target.file, outcome: "refused", reason: refused.reason, detail: refused.detail });
        settled = true;
        break;
      }
      if (text === raw) {
        results.push({ root: target.root, file: target.file, outcome: "unchanged" });
        settled = true;
        break;
      }
      try {
        options.hooks?.beforeCas?.(target.file);
      } catch {}
      if (existed) {
        let current;
        try {
          current = readFileSync(target.file, "utf8");
        } catch {
          current = undefined;
        }
        if (current !== raw) {
          if (attempt > options.retries) {
            results.push({ root: target.root, file: target.file, outcome: "conflict", reason: "conflict", detail: `the file changed under the bridge ${attempt} times; left untouched` });
            settled = true;
          }
          continue;
        }
      }
      const temp = `${target.file}.mpd-bridge-${process.pid}-${attempt}.tmp`;
      try {
        writeFileSync(temp, text, "utf8");
        renameSync2(temp, target.file);
      } catch (error) {
        try {
          if (existsSync(temp))
            unlinkSync(temp);
        } catch {}
        const code = errnoOf(error);
        results.push({
          root: target.root,
          file: target.file,
          outcome: code === "EACCES" || code === "EPERM" ? "denied" : "refused",
          reason: code ?? "unwritable",
          detail: String(error?.message ?? error)
        });
        settled = true;
        break;
      }
      results.push({ root: target.root, file: target.file, outcome: existed ? "written" : "created", ...notes.length === 0 ? {} : { notes } });
      writtenTo.push(target.file);
      settled = true;
    }
  }
  return { writtenTo, results, applies: "restart" };
}

// packages/mpd-config-plugin/src/index.ts
var name = "mpd-config";
var inject = dshSeamInject(DSH_SEAM_TOOLS);
var MARKER_PATH = ["bridge", "migratedRevision"];
function stripJsonc(src) {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"')
        inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== `
`)
        i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      for (;; ) {
        while (j < src.length && /\s/.test(src[j]))
          j++;
        if (src[j] === "/" && src[j + 1] === "/") {
          while (j < src.length && src[j] !== `
`)
            j++;
          continue;
        }
        if (src[j] === "/" && src[j + 1] === "*") {
          j += 2;
          while (j < src.length && !(src[j] === "*" && src[j + 1] === "/"))
            j++;
          j += 2;
          continue;
        }
        break;
      }
      if (src[j] === "}" || src[j] === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
function parseJsonc(src) {
  return JSON.parse(stripJsonc(src));
}
function isPlainObject2(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
var RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function deepMerge(base, over) {
  const out = {};
  const bkeys = isPlainObject2(base) ? Object.keys(base) : [];
  const okeys = isPlainObject2(over) ? Object.keys(over) : [];
  for (const key of new Set([...bkeys, ...okeys])) {
    if (RESERVED_KEYS.has(key))
      continue;
    const bv = isPlainObject2(base) ? base[key] : undefined;
    const ov = isPlainObject2(over) ? over[key] : undefined;
    if (isPlainObject2(bv) && isPlainObject2(ov))
      out[key] = deepMerge(bv, ov);
    else if (isPlainObject2(bv) && ov === undefined)
      out[key] = deepMerge(bv, {});
    else
      out[key] = ov !== undefined ? ov : bv;
  }
  return out;
}
function withoutMarker(section) {
  if (!isPlainObject2(section) || !isPlainObject2(section.bridge))
    return section;
  const rest = { ...section };
  const bridge = { ...section.bridge };
  delete bridge.migratedRevision;
  if (Object.keys(bridge).length === 0)
    delete rest.bridge;
  else
    rest.bridge = bridge;
  return rest;
}
var ROUTING_KEYS = ["projectFile", "userFile", "writeBack", "settingsBridge"];
function rowKnobLayer(config) {
  const source = config;
  const layer = {};
  for (const [key, value] of Object.entries(source)) {
    if (ROUTING_KEYS.includes(key))
      continue;
    if (value === undefined)
      continue;
    layer[key] = value;
  }
  return layer;
}
function loadConfig(config, root, settingsSection) {
  const dshHome = process.env.DSH_HOME ?? join3(homedir(), ".dsh");
  const userFile = config.userFile ? resolve3(config.userFile) : join3(dshHome, "mpd.jsonc");
  const projectFile = config.projectFile ? resolve3(config.projectFile) : join3(root, ".mpd", "mpd.jsonc");
  const files = [userFile, projectFile];
  let merged = {};
  const errors = [];
  for (const f of files) {
    if (!existsSync2(f))
      continue;
    try {
      merged = deepMerge(merged, parseJsonc(readFileSync2(f, "utf8")));
    } catch (e) {
      errors.push(f + ": " + String(e?.message ?? e));
    }
  }
  const section = withoutMarker(settingsSection);
  const settingsApplied = isPlainObject2(section) && Object.keys(section).length > 0;
  if (settingsApplied)
    merged = deepMerge(merged, section);
  const rowKnobs = rowKnobLayer(config);
  if (Object.keys(rowKnobs).length > 0)
    merged = deepMerge(merged, rowKnobs);
  return { config: merged, files: files.filter((f) => existsSync2(f)), errors, settingsApplied };
}
function withTeamModelsDefaults(config) {
  const raw = isPlainObject2(config) ? config : {};
  const declared = isPlainObject2(raw.teamModels) ? raw.teamModels : {};
  const teamModels = {};
  for (const slot of TEAM_MODEL_SLOTS) {
    teamModels[slot] = { ...TEAM_MODEL_SLOT_DEFAULTS[slot], ...isPlainObject2(declared[slot]) ? declared[slot] : {} };
  }
  return { ...raw, teamModels };
}
var knobDict = SettingsSchema.dict ?? {};
var Config = markVolatile(import_schemastery2.default.object({
  projectFile: import_schemastery2.default.string(),
  userFile: import_schemastery2.default.string(),
  writeBack: import_schemastery2.default.boolean().default(true),
  settingsBridge: import_schemastery2.default.object({ writeBack: import_schemastery2.default.boolean().default(true) }),
  ...knobDict
}));
apply.Config = Config;
function apply(ctx, config = {}) {
  markVolatile(Config);
  const dsh = resolveDshAdapter(ctx);
  const warn = (message) => {
    try {
      rowLogLine("mpd-config", message);
      if (ctx.logger && typeof ctx.logger.warn === "function")
        ctx.logger.warn(message);
    } catch {}
  };
  const bridge = {
    section: undefined,
    serviceReady: false,
    served: false,
    revision: undefined,
    report: undefined,
    migration: "not-attempted",
    degraded: undefined,
    namespaceRegistration: undefined,
    baseReason: undefined,
    baseCandidates: undefined,
    cleared: [],
    recorded: new Map
  };
  const pathKey = (path) => path.join("\x00");
  const isMarker = (path) => path[0] === MARKER_PATH[0];
  const bridgeOptions = () => ({
    writeBack: config.writeBack !== false && config.settingsBridge?.writeBack !== false && process.env.MPD_DSH_TUI_SETTINGS_BRIDGE !== "off",
    retries: DEFAULT_BRIDGE_OPTIONS.retries
  });
  const projectFileFor = (root) => config.projectFile ? resolve3(config.projectFile) : join3(root, ".mpd", "mpd.jsonc");
  const readRoot = () => {
    const roots = dsh.workspaceRootsAll();
    return roots.length === 1 ? roots[0] : dsh.workspaceRoot();
  };
  const readSection = () => {
    if (typeof dsh.settingsReader !== "function") {
      bridge.serviceReady = false;
      bridge.served = false;
      bridge.section = undefined;
      bridge.degraded = "adapter has no settingsReader seam (rebuild packages/mpd-dsh-adapter-plugin/dist)";
      return;
    }
    const reader = dsh.settingsReader(SETTINGS_NS);
    if (reader === undefined) {
      bridge.serviceReady = false;
      bridge.served = false;
      bridge.section = undefined;
      return;
    }
    bridge.serviceReady = true;
    const described = reader.describe();
    if (described === undefined) {
      bridge.served = false;
      bridge.section = undefined;
      return;
    }
    bridge.served = true;
    bridge.revision = described.revision;
    bridge.section = described.user;
    return described.user;
  };
  let state = loadConfig(config, dsh.workspaceRoot(), readSection());
  const reloadAt = (root) => {
    state = loadConfig(config, root, readSection());
    reconcile(root);
    return state.config;
  };
  function reload(exec) {
    return reloadAt(dsh.workspaceRoot(exec));
  }
  const reportLine = (report, note) => `[mpd-config] settings bridge${note ? " " + note : ""}: ` + JSON.stringify({ writtenTo: report.writtenTo, skipped: report.skipped ?? null, candidates: report.candidates ?? [], results: report.results, applies: report.applies, source: report.source ?? null, revision: report.revision ?? null });
  const warnRefusal = (reason, candidates) => {
    if (reason === "no-live-session") {
      warn(`[mpd-config] settings bridge: saved to settings — not yet written to any .mpd/mpd.jsonc (no live session). Start a session in the intended workspace to persist it.`);
      return;
    }
    if (reason === "ambiguous-multi-root") {
      warn(`[mpd-config] settings bridge: saved to settings — NOT written to any file: ${candidates.length} live workspaces, so the target is ambiguous. Candidates: ${candidates.join(", ")}. Keep one session live, or edit that workspace's .mpd/mpd.jsonc directly.`);
      return;
    }
    if (reason === "disabled") {
      warn(`[mpd-config] settings bridge: write-back is DISABLED by config (settingsBridge.writeBack=false or MPD_DSH_TUI_SETTINGS_BRIDGE=off) — the settings value took effect, no file was written.`);
      return;
    }
    warn(`[mpd-config] settings bridge: no file written (${reason}).`);
  };
  const reconcile = (root) => {
    if (bridge.recorded.size === 0)
      return;
    const file = projectFileFor(root);
    if (!existsSync2(file))
      return;
    let leaves;
    try {
      leaves = sectionLeaves(parseJsonc(readFileSync2(file, "utf8")));
    } catch {
      return;
    }
    const onDisk = new Map(leaves.filter((leaf) => !isMarker(leaf.path)).map((leaf) => [pathKey(leaf.path), leaf.value]));
    const section = bridge.section;
    const sectionKeys = new Set(sectionLeaves(section).map((leaf) => pathKey(leaf.path)));
    const unsetPaths = [];
    for (const [key, recorded] of [...bridge.recorded]) {
      const current = onDisk.get(key);
      if (JSON.stringify(current) === JSON.stringify(recorded))
        continue;
      bridge.recorded.set(key, current);
      if (current === undefined)
        continue;
      if (!sectionKeys.has(key))
        continue;
      unsetPaths.push(key.split("\x00"));
    }
    if (unsetPaths.length === 0)
      return;
    if (settingsModelRetired)
      return;
    dsh.settingsMutate(SETTINGS_NS, unsetPaths.map((path) => ({ op: "unset", path })), bridge.revision).then((result) => {
      if (result.ok) {
        bridge.cleared.push(...unsetPaths.map((path) => path.join(".")));
        warn(`[mpd-config] settings bridge: a file edit won — cleared the overlapping settings override(s) ${unsetPaths.map((p) => p.join(".")).join(", ")} so the file's new value applies.`);
      } else {
        warn(`[mpd-config] settings bridge: could not clear the overlapping override(s) ${unsetPaths.map((p) => p.join(".")).join(", ")}: ${result.error}`);
      }
    });
  };
  const rememberFileValues = (file) => {
    try {
      for (const leaf of sectionLeaves(parseJsonc(readFileSync2(file, "utf8")))) {
        if (isMarker(leaf.path))
          continue;
        bridge.recorded.set(pathKey(leaf.path), leaf.value);
      }
    } catch {}
  };
  const writeBack = (leaves, source, revision) => {
    if (leaves.length === 0)
      return;
    const options = bridgeOptions();
    if (!options.writeBack) {
      const disabled = { writtenTo: [], results: [], skipped: "disabled", applies: "restart", source, revision, at: new Date().toISOString() };
      bridge.report = disabled;
      warnRefusal("disabled", []);
      warn(reportLine(disabled, "DISABLED"));
      return;
    }
    const decision = resolveTargets(dsh.workspaceRootsAll());
    if (decision.kind === "refuse") {
      const refused = { writtenTo: [], results: [], skipped: decision.reason, candidates: decision.candidates, applies: "restart", source, revision, at: new Date().toISOString() };
      bridge.report = refused;
      warnRefusal(decision.reason, decision.candidates);
      warn(reportLine(refused, decision.reason));
      return;
    }
    const report = writeBackLeaves(decision.targets, leaves, options);
    bridge.report = { ...report, source, revision, at: new Date().toISOString() };
    for (const target of decision.targets)
      if (report.writtenTo.includes(target.file))
        rememberFileValues(target.file);
    for (const result of report.results) {
      for (const note of result.notes ?? []) {
        warn(`[mpd-config] settings bridge: ${note.detail}${note.lines === undefined ? "" : " (occurrence lines: " + note.lines.join(", ") + ")"} [${result.file}]`);
      }
      if (result.outcome === "written" || result.outcome === "created" || result.outcome === "unchanged")
        continue;
      warn(`[mpd-config] settings bridge: ${result.outcome} for ${result.file}${result.reason ? " (" + result.reason + ")" : ""}${result.detail ? " — " + result.detail : ""} — the file is byte-untouched and the settings value still applies; the mpd plugins need a restart to act on it.`);
    }
    warn(reportLine(bridge.report, report.writtenTo.length > 0 ? "WROTE" : "OK"));
    watchRoot(decision.targets[0].root);
  };
  const watchers = new Map;
  function watchRoot(root) {
    const file = projectFileFor(root);
    if (watchers.has(file))
      return;
    try {
      const dir = dirname2(file);
      if (!existsSync2(dir))
        return;
      const name2 = basename(file);
      let timer;
      const listener = (_event, changed) => {
        if (changed !== null && changed !== undefined && String(changed) !== name2)
          return;
        if (timer !== undefined)
          clearTimeout(timer);
        timer = setTimeout(() => {
          reloadAt(root);
        }, 150);
        if (typeof timer.unref === "function")
          timer.unref();
      };
      const watcher = watch(dir, listener);
      watchers.set(file, () => {
        if (timer !== undefined)
          clearTimeout(timer);
        try {
          watcher.close();
        } catch {}
      });
    } catch {}
  }
  const migrate = () => {
    if (typeof dsh.settingsReader !== "function") {
      bridge.migration = "not-attempted-adapter-seam-absent";
      return;
    }
    const reader = dsh.settingsReader(SETTINGS_NS);
    const described = reader?.describe();
    if (described === undefined) {
      bridge.migration = "not-served";
      return;
    }
    const leaves = changedLeaves({}, withoutMarker(described.user)).written.filter((leaf) => !isMarker(leaf.path));
    if (leaves.length === 0) {
      bridge.migration = "nothing-to-migrate";
      return;
    }
    const migratedRevision = described.user?.bridge?.migratedRevision;
    if (described.revision !== undefined && migratedRevision === described.revision) {
      bridge.migration = "already-migrated";
      return;
    }
    const decision = resolveTargets(dsh.workspaceRootsAll());
    if (decision.kind === "refuse") {
      bridge.migration = decision.reason === "no-live-session" ? "deferred-no-workspace" : `deferred-${decision.reason}`;
      if (decision.reason === "no-live-session")
        warn("[mpd-config] settings bridge: migration deferred — no live session workspace to migrate into (nothing was written to process.cwd()).");
      else
        warnRefusal(decision.reason, decision.candidates);
      return;
    }
    const report = writeBackLeaves(decision.targets, leaves, bridgeOptions());
    if (report.skipped !== undefined) {
      bridge.migration = `deferred-${report.skipped}`;
      return;
    }
    const bad = report.results.find((result) => result.outcome !== "written" && result.outcome !== "created" && result.outcome !== "unchanged");
    if (bad !== undefined) {
      bridge.migration = "writeback-failed";
      warn(`[mpd-config] settings bridge: migration did NOT complete (${bad.outcome}${bad.reason ? " " + bad.reason : ""} for ${bad.file}); the settings document is left untouched so nothing is lost.`);
      return;
    }
    for (const target of decision.targets)
      rememberFileValues(target.file);
    if (described.revision === undefined) {
      bridge.migration = "migrated-no-marker";
      return;
    }
    const revision = described.revision;
    const markerValue = revision + 1;
    dsh.settingsMutate(SETTINGS_NS, [{ op: "set", path: [...MARKER_PATH], value: markerValue }], revision).then((result) => {
      if (result.ok) {
        bridge.migration = "migrated";
        warn(`[mpd-config] settings bridge: migrated ${leaves.length} saved settings value(s) into ${decision.targets[0].file} (marker bridge.migratedRevision=${markerValue}).`);
      } else {
        bridge.migration = "marker-unavailable";
        warn(`[mpd-config] settings bridge: migrated the values but could not record the idempotence marker: ${result.error} — a later boot re-runs an idempotent no-op write.`);
      }
    });
  };
  if (typeof dsh.onSettingsDocumentUpdated !== "function") {
    bridge.degraded = bridge.degraded ?? "adapter has no onSettingsDocumentUpdated seam";
  } else
    dsh.onSettingsDocumentUpdated(SETTINGS_NS, (revision, source) => {
      const previous = bridge.section;
      const next = readSection();
      state = loadConfig(config, readRoot(), next);
      if (source === "provider")
        return;
      const delta = changedLeaves(previous, next);
      writeBack(delta.written.filter((leaf) => !isMarker(leaf.path)), source, revision);
    });
  if (typeof dsh.settingsMutate !== "function" && bridge.degraded === undefined)
    bridge.degraded = "adapter has no settingsMutate seam (the §1.2 override clearing is unavailable)";
  const baseForNamespace = () => {
    const roots = dsh.workspaceRootsAll();
    if (roots.length === 1)
      return { base: loadConfig(config, roots[0]).config, reason: "one-live-root" };
    if (roots.length === 0)
      return { base: loadConfig(config, readRoot()).config, reason: "mount-time-root" };
    warn(`[mpd-config] settings bridge: ${roots.length} live workspaces (${roots.join(", ")}) — the namespace base is NOT derived from a file, because the file is per-workspace and the namespace is host-global; both front doors will show the schema defaults until exactly one workspace is live.`);
    return { base: undefined, reason: "ambiguous-multi-root", candidates: roots };
  };
  let settingsModelRetired = false;
  const registerNamespace = (base) => {
    if (typeof dsh.settingsRegister !== "function") {
      bridge.degraded = "adapter has no settingsRegister seam (rebuild packages/mpd-dsh-adapter-plugin/dist)";
      return;
    }
    const result = dsh.settingsRegister(SETTINGS_NS, SettingsSchema, { base, applies: "restart" });
    if (result.ok !== true) {
      bridge.namespaceRegistration = result.error;
      settingsModelRetired = true;
      bridge.degraded = `the namespace-registry model is retired in this harness (${result.error}); the knobs are served as this row's config under the entry "mpd-config"`;
      warn(`[mpd-config] settings bridge: the namespace-registry model is RETIRED in this harness — the mpd knobs are served as this row's config (entry "mpd-config") and edited through the harness's own form. The legacy file write-back and override clearing are dormant.`);
      return;
    }
    bridge.namespaceRegistration = "registered";
    warn(`[mpd-config] settings bridge: registered the "${SETTINGS_NS}" namespace with the file-derived base (applies:'restart', design §10.1)`);
  };
  const registerWithFileBase = () => {
    const decision = baseForNamespace();
    bridge.baseReason = decision.reason;
    if (decision.candidates !== undefined)
      bridge.baseCandidates = decision.candidates;
    registerNamespace(decision.base);
  };
  if (typeof dsh.whenSettingsAvailable === "function")
    dsh.whenSettingsAvailable(registerWithFileBase);
  else
    registerWithFileBase();
  migrate();
  if (bridge.degraded !== undefined)
    warn("[mpd-config] settings bridge: degraded — " + bridge.degraded);
  ctx.provide("mpdConfig", {
    get: (key) => {
      if (key === undefined)
        return state.config;
      return key.split(".").reduce((acc, part) => acc == null ? undefined : acc[part], withTeamModelsDefaults(state.config));
    },
    reload,
    states: () => ({
      files: state.files,
      errors: state.errors,
      settings: { namespace: SETTINGS_NS, serviceReady: bridge.serviceReady, served: bridge.served, revision: bridge.revision ?? null, applied: state.settingsApplied, degraded: bridge.degraded ?? null, writeBackEnabled: bridgeOptions().writeBack, registration: bridge.namespaceRegistration ?? null, baseFromFiles: bridge.baseReason === "one-live-root" || bridge.baseReason === "mount-time-root", baseReason: bridge.baseReason ?? null, baseCandidates: bridge.baseCandidates ?? [] },
      writeback: bridge.report ?? null,
      migration: bridge.migration,
      cleared: bridge.cleared,
      applies: "restart"
    })
  });
  dsh.registerTool({
    name: "mpd_config_get",
    description: "Read the resolved mpd.jsonc runtime config (project .mpd/mpd.jsonc merged over user $DSH_HOME/mpd.jsonc). Consumed keys: memory.vcs/memory.dir/memory.agentSlug/memory.reflectionEvery, team.stateDir, hashline.guardEditTools/hashline.maxDiffChars/hashline.registryFile, commentChecker.autoCheck/commentChecker.bin/commentChecker.timeoutMs/commentChecker.maxMessageChars, modelchain.<chainKey>, boulder.dir, ulw.maxRounds/ulw.planDir/ulw.stateDir/ulw.provider/ulw.model/ulw.reviewerModel/ulw.maxReReviews, goal.enabled/goal.autoAnchor/goal.autoRounds, teamModels.slot1|slot2|slot3|slot4.provider/model/reasoningEffort.",
    parameters: { type: "object", properties: { key: { type: "string", description: "Optional dot-path to a single key, e.g. memory.vcs" } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { config: { type: "object" }, key: { type: "string" }, value: {} }, required: ["config"] }, render: (_a, v) => textBlock(v.key ? "mpd config " + v.key + ": " + JSON.stringify(v.value, null, 1) : "mpd config: " + JSON.stringify(v.config, null, 1)) },
    execute: async (args, exec) => {
      reload(exec);
      const resolved = withTeamModelsDefaults(state.config);
      const key = args?.key ? String(args.key) : undefined;
      const value = key ? key.split(".").reduce((acc, part) => acc == null ? undefined : acc[part], resolved) ?? null : null;
      return key === undefined ? { config: resolved } : { config: resolved, key, value };
    }
  });
  dsh.registerTool({
    name: "mpd_config_reload",
    description: "Re-read the mpd.jsonc layers and refresh the resolved config (returns files found and any parse errors).",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, errors: { type: "array", items: { type: "string" } } }, required: ["files", "errors"] }, render: (_a, v) => textBlock("mpd config reloaded: " + v.files.join(", ") + (v.errors.length ? " ERRORS: " + v.errors.join("; ") : "")) },
    execute: async (_args, exec) => {
      const cfg = reload(exec);
      return { files: state.files, errors: state.errors, config: cfg };
    }
  });
}
export {
  Config,
  SETTINGS_NS,
  apply,
  deepMerge,
  inject,
  loadConfig,
  name,
  parseJsonc,
  stripJsonc,
  withTeamModelsDefaults
};
