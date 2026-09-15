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
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
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
  valueMap: () => mapValues,
  union: () => union,
  uncapitalize: () => uncapitalize,
  trimSlash: () => trimSlash,
  snakeCase: () => snakeCase,
  sanitize: () => sanitize,
  remove: () => remove,
  pick: () => pick,
  paramCase: () => paramCase,
  omit: () => omit,
  noop: () => noop,
  mapValues: () => mapValues,
  makeArray: () => makeArray,
  isPlainObject: () => isPlainObject,
  isNullable: () => isNullable,
  isNonNullable: () => isNonNullable,
  is: () => is,
  intersection: () => intersection,
  hyphenate: () => hyphenate,
  hexToArrayBuffer: () => hexToArrayBuffer,
  formatProperty: () => formatProperty,
  filterKeys: () => filterKeys,
  difference: () => difference,
  defineProperty: () => defineProperty,
  deepEqual: () => deepEqual,
  deduplicate: () => deduplicate,
  contain: () => contain,
  clone: () => clone,
  capitalize: () => capitalize,
  camelize: () => camelize,
  camelCase: () => camelCase,
  base64ToArrayBuffer: () => base64ToArrayBuffer,
  arrayBufferToHex: () => arrayBufferToHex,
  arrayBufferToBase64: () => arrayBufferToBase64,
  Time: () => Time,
  Binary: () => Binary
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
var require_lib = __commonJS((exports, module) => {
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
import { resolve } from "node:path";
var OBJECT_SCHEMA = { type: "object", properties: {} };
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
function textBlock(content) {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }];
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
      const agents = service("agents");
      const compaction = service("compaction");
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
        toolsPostExecute: typeof ctx?.on === "function",
        subagents: subagents !== undefined,
        subagentsSpawn: typeof subagents?.start === "function",
        skills: skills !== undefined,
        skillsProvider: typeof skills?.registerProvider === "function",
        agentPresets: typeof presets?.resolve === "function",
        agents: agents !== undefined && typeof agents?.list === "function",
        compaction: typeof compaction?.compactNow === "function",
        compactionForAgent: scopedCompaction,
        events: typeof ctx?.on === "function"
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
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
    guardTool(guard) {
      const tools = requireService("tools", "cannot install a tool guard");
      if (typeof tools.guard !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()");
      return tools.guard((exec) => guard(exec ?? {}));
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
          ...signal === undefined ? {} : { signal }
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
        throw new Error("mpd-dsh-adapter: the harness agent-presets service exposes no resolve()");
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
    text: textBlock
  };
  return adapter;
}

// packages/mpd-team-watchdog-plugin/src/actions.ts
import { randomUUID } from "node:crypto";
import { join as join4 } from "node:path";

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
function teamPath(workspace, stateDir, teamId) {
  return join(stateRoot(workspace, stateDir), String(teamId), "team.json");
}
function teamDir(workspace, stateDir, teamId) {
  return join(stateRoot(workspace, stateDir), String(teamId));
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
  const starts = [];
  for (let index = 0;index < lines.length; index += 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed?.kind === "turn-start")
        starts.push(index);
    } catch {}
  }
  if (starts.length <= keep)
    return { rotated: false, before: lines.length, after: lines.length, path };
  const cut = starts[starts.length - keep];
  const kept = lines.slice(cut);
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
    return parsed;
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
import { readFileSync as readFileSync3, readdirSync as readdirSync2, statSync } from "node:fs";
import { join as join3 } from "node:path";
var TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
var CAPTAIN_KEY = "captain";
function agentIds(agent) {
  const candidate = agent ?? {};
  const id = typeof candidate.id === "string" ? candidate.id : "";
  const sessionId = typeof candidate.session?.id === "string" ? candidate.session.id : "";
  const cwd = typeof candidate.session?.header?.cwd === "string" ? candidate.session.header.cwd : undefined;
  return { agentId: id, sessionId, cwd };
}
function readTeam(workspace, stateDir, teamId) {
  let text;
  try {
    text = readFileSync3(teamPath(workspace, stateDir, teamId), "utf8");
  } catch {
    return;
  }
  try {
    const raw = JSON.parse(text);
    if (raw === null || typeof raw !== "object")
      return;
    const members = Array.isArray(raw.members) ? raw.members : [];
    const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    return {
      id: String(raw.id ?? teamId),
      name: String(raw.name ?? raw.id ?? teamId),
      ...typeof raw.phase === "string" ? { phase: raw.phase } : {},
      ...typeof raw.halted === "boolean" ? { halted: raw.halted } : {},
      ...typeof raw.haltedAt === "number" ? { haltedAt: raw.haltedAt } : {},
      ...typeof raw.captainSessionId === "string" ? { captainSessionId: raw.captainSessionId } : {},
      members: members.filter((member) => member !== null && typeof member === "object").map((member) => ({
        id: String(member.id ?? ""),
        name: String(member.name ?? ""),
        ...typeof member.status === "string" ? { status: member.status } : {}
      })),
      tasks: tasks.filter((task) => task !== null && typeof task === "object").map((task) => ({
        id: String(task.id ?? ""),
        status: String(task.status ?? ""),
        ...typeof task.assignee === "string" ? { assignee: task.assignee } : {},
        ...typeof task.attempt === "number" ? { attempt: task.attempt } : {},
        ...typeof task.attemptId === "string" ? { attemptId: task.attemptId } : {},
        ...typeof task.updatedAt === "number" ? { updatedAt: task.updatedAt } : {}
      })),
      raw
    };
  } catch {
    return;
  }
}
function listTeamIds(workspace, stateDir) {
  let entries;
  try {
    entries = readdirSync2(join3(workspace, stateDir));
  } catch {
    return [];
  }
  const ids = [];
  for (const entry of entries) {
    if (entry === "watchdog" || entry === "archive" || entry.startsWith("."))
      continue;
    const dir = join3(workspace, stateDir, entry);
    try {
      if (!statSync(dir).isDirectory())
        continue;
    } catch {
      continue;
    }
    try {
      statSync(join3(dir, "team.json"));
    } catch {
      continue;
    }
    ids.push(entry);
  }
  return ids.sort();
}
function readTeams(workspace, stateDir) {
  const teams = [];
  for (const id of listTeamIds(workspace, stateDir)) {
    const team = readTeam(workspace, stateDir, id);
    if (team !== undefined)
      teams.push(team);
  }
  return teams;
}
function liveTasks(team) {
  return team.tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status));
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
function applyHold(workspace, stateDir, args, registry) {
  const teamId = String(args.team_id ?? "").trim();
  if (teamId === "")
    return { applied: false, error: "team_id is required", path: holdPath(workspace, stateDir, "") };
  const existing = readHold(workspace, stateDir, teamId);
  const hold = {
    id: existing?.id ?? randomUUID(),
    teamId,
    since: existing?.since ?? Date.now(),
    cause: args.cause ?? existing?.cause ?? "silence",
    taskId: args.task_id ?? existing?.taskId ?? null,
    attemptId: args.attempt_id ?? existing?.attemptId ?? null,
    sceneAt: args.scene_at ?? existing?.sceneAt ?? 0
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
function registerWatchdogActions(dsh, stateDir, registry) {
  dsh.registerTool({
    name: HOLD_TOOL,
    description: "Persist the team watchdog's PRESERVING hold for one team. It stops NEW dispatch into that team without cancelling anything: every non-terminal task keeps its status, assignee and attemptId. Returns applied:false (never a throw) when the hold could not be written, so a caller must not report a pause that did not land. This is the watchdog's own hold, NOT agent_teams_halt.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "The team to hold." },
        task_id: { type: "string", description: "The task whose silence caused the hold." },
        attempt_id: { type: "string", description: "That task's attempt id at escalation time." },
        cause: { type: "string", description: "Why the hold was raised (default: silence)." },
        scene_at: { type: "number", description: "Epoch ms of the scene written for this escalation." }
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
      return applyHold(workspace, stateDir, args ?? {}, registry);
    }
  });
  dsh.registerTool({
    name: RESUME_TOOL,
    description: "Clear the team watchdog's hold for one team. A team that is not held is a no-op (resumed:false, reason:'not-held'), never an error; a second resume is likewise a no-op. Clearing the hold is the watchdog-side release only — the adopted dispatch gates that honour it are wired by w7.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "The team to release." } },
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
    description: "READ-ONLY: show the team watchdog's durable store for this workspace — the hold per team, the heartbeat tails, the incident log and the per-reader watermark. Use it to inspect what a lane or a restarting process would read from disk.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "Limit to one team." } },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { workspace: { type: "string" }, paths: { type: "object" }, teams: { type: "array", items: { type: "object" } } } },
      render: (_args, raw) => {
        const value = raw ?? {};
        const lines = value.teams.map((team) => team.teamId + ": " + (team.held ? "HELD" : "not held"));
        return [{ type: "text", text: lines.join(`
`) || "no teams" }];
      }
    },
    execute: (args, exec) => {
      const workspace = dsh.workspaceRoot(exec);
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(workspace, stateDir) : [args.team_id];
      return {
        workspace,
        paths: {
          heartbeat: heartbeatDir(workspace, stateDir),
          hold: join4(workspace, stateDir, "watchdog", "hold"),
          incidents: incidentsPath(workspace, stateDir),
          watermark: watermarkPath(workspace, stateDir)
        },
        teams: ids.map((teamId) => {
          const hold = readHold(workspace, stateDir, teamId);
          const team = readTeam(workspace, stateDir, teamId);
          return {
            teamId,
            held: hold !== undefined,
            hold: hold ?? null,
            phase: team?.phase ?? null,
            halted: team?.halted ?? null,
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

// packages/mpd-team-watchdog-plugin/src/machine.ts
var WATCHDOG_DEFAULTS = {
  enabled: true,
  warnSilenceMs: 90000,
  tickIntervalMs: 15000,
  warnStreakToEscalate: 3,
  actionOnEscalate: "pause"
};
function readKnobs(namespaceValue, env = process.env, defaults = WATCHDOG_DEFAULTS) {
  const issues = [];
  const root = namespaceValue !== null && typeof namespaceValue === "object" ? namespaceValue : {};
  const sectionRaw = root.watchdog;
  const section = sectionRaw !== null && typeof sectionRaw === "object" ? sectionRaw : {};
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
  return { enabled, warnSilenceMs, tickIntervalMs, warnStreakToEscalate, actionOnEscalate, issues };
}
function streakKey(taskId, attemptId) {
  return taskId + "\x00" + attemptId;
}

class WatchdogMachine {
  streaks = new Map;
  escalated = new Set;
  neverStarted = new Set;
  observe(candidates, now, knobs) {
    if (!knobs.enabled)
      return [];
    const decisions = [];
    for (const candidate of candidates) {
      const key = streakKey(candidate.taskId, candidate.attemptId);
      if (this.escalated.has(key))
        continue;
      if (candidate.lastSeen === null || !candidate.stampedThisGeneration) {
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
      const silenceMs = now - candidate.lastSeen;
      if (silenceMs <= knobs.warnSilenceMs) {
        this.streaks.delete(key);
        continue;
      }
      const streak = (this.streaks.get(key) ?? 0) + 1;
      const base = {
        teamId: candidate.teamId,
        taskId: candidate.taskId,
        attemptId: candidate.attemptId,
        assignee: candidate.assignee,
        memberKey: candidate.memberKey,
        silenceMs,
        lastSeen: candidate.lastSeen,
        streak
      };
      if (streak >= knobs.warnStreakToEscalate) {
        this.escalated.add(key);
        this.streaks.delete(key);
        decisions.push({ type: "escalate", ...base });
      } else {
        this.streaks.set(key, streak);
        decisions.push({ type: "warn", ...base });
      }
    }
    return decisions;
  }
  clear(taskId, attemptId) {
    const key = streakKey(taskId, attemptId);
    this.streaks.delete(key);
    this.neverStarted.delete(key);
  }
  hasEscalated(taskId, attemptId) {
    return this.escalated.has(streakKey(taskId, attemptId));
  }
  snapshot() {
    return { streaks: Object.fromEntries(this.streaks), escalated: [...this.escalated].sort() };
  }
}
function candidateFor(team, stampSource, memberKeyOf) {
  const candidates = [];
  for (const task of team.tasks) {
    if (task.assignee === undefined || TERMINAL_STATUSES.includes(task.status))
      continue;
    const memberKey = memberKeyOf(task.assignee);
    const attemptId = task.attemptId ?? "";
    const stamps = stampSource(memberKey);
    const forTask = stamps.filter((stamp) => stamp.taskId === task.id);
    const newest = forTask.reduce((best, stamp) => best === undefined || stamp.at >= best.at ? stamp : best, undefined);
    candidates.push({
      teamId: team.id,
      taskId: task.id,
      attemptId,
      assignee: task.assignee,
      memberKey,
      lastSeen: newest === undefined ? null : newest.at,
      stampedThisGeneration: forTask.length > 0
    });
  }
  return candidates;
}

// packages/mpd-team-watchdog-plugin/src/scene.ts
import { existsSync as existsSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join5 } from "node:path";
var MAILBOX_DELIVERY_LEASE_MS = 60000;
var SCENE_SCHEMA_VERSION = 1;
function newestForTask(stamps, taskId, attemptId) {
  let newest = null;
  for (const stamp of stamps) {
    if (stamp.taskId !== taskId)
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
    lastSeen: newestForTask(input.heartbeat(safeSegment(task.assignee ?? "")), task.id, task.attemptId ?? null),
    streak: input.streaks[task.id + "\x00" + (task.attemptId ?? "")] ?? 0
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
  let path = join5(dir, base + ".json");
  let suffix = 1;
  try {
    while (existsSync3(path)) {
      suffix += 1;
      path = join5(dir, base + "-" + suffix + ".json");
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
  const latest = writeFileAtomic(join5(dir, "latest.json"), text);
  if (latest.error !== undefined) {
    return { ok: false, path, latestPath: null, bytes: Buffer.byteLength(text), error: latest.error };
  }
  return { ok: true, path, latestPath: latest.path, bytes: Buffer.byteLength(text) };
}
function mailboxUnread(workspace, stateDir, teamId, agentKey, now, leaseMs = MAILBOX_DELIVERY_LEASE_MS) {
  const file = join5(teamDir(workspace, stateDir, teamId), "inbox", safeSegment(agentKey) + ".jsonl");
  let text;
  try {
    text = readFileSync4(file, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const raw of text.split(`
`)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (line === "")
      continue;
    try {
      const value = JSON.parse(line);
      if (value === null || typeof value !== "object")
        continue;
      if (value.tombstone === true)
        continue;
      if (value.readAt !== undefined)
        continue;
      const claimed = value.deliveryClaimedAt;
      if (typeof claimed === "number" && now - claimed < leaseMs)
        continue;
      count += 1;
    } catch {}
  }
  return count;
}

// packages/mpd-team-watchdog-plugin/src/engine.ts
function readNamespaceKnobs(dsh, env, defaults) {
  try {
    const reader = dsh.settingsReader("mpd");
    return readKnobs(reader?.get(), env, defaults);
  } catch (error) {
    const base = readKnobs(undefined, env, defaults);
    return { ...base, issues: [...base.issues, { path: "watchdog", problem: "settings read failed: " + message2(error), fallback: "defaults" }] };
  }
}
function toolValue(raw) {
  if (raw === null || typeof raw !== "object")
    return;
  const candidate = raw.value;
  if (candidate !== null && typeof candidate === "object")
    return candidate;
  return raw;
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
    this.knobs = readNamespaceKnobs(this.dsh, env, this.knobDefaults());
    return this.knobs;
  }
  knobDefaults() {
    return {
      enabled: this.config.enabled,
      warnSilenceMs: this.config.warnSilenceMs,
      tickIntervalMs: this.config.tickIntervalMs,
      warnStreakToEscalate: this.config.warnStreakToEscalate,
      actionOnEscalate: this.config.actionOnEscalate
    };
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
    const teams = readTeams(workspace, this.config.stateDir);
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
    if (written.ok)
      this.stats.heartbeatWrites += 1;
    else {
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
      disposers.push(subscribe(this.ctx, "agent/pre-step", (payload) => this.stamp("step", agentOf(payload))));
      disposers.push(subscribe(this.ctx, "agent/session-start", (payload) => this.stamp("turn-start", agentOf(payload) ?? payload)));
      disposers.push(subscribe(this.ctx, "agent/turn-stopping", (payload) => {
        const stamp = this.stamp("turn-end", agentOf(payload) ?? payload);
        const rotated = rotateHeartbeats(stamp.workspace, this.config.stateDir, stamp.memberKey, this.config.keepGenerations);
        if (rotated.rotated)
          this.stats.rotations += 1;
      }));
    } else {
      this.warn("this context exposes no event seam — heartbeat writers not installed");
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
        this.onKnobsChanged?.(this.refreshKnobs());
      } catch (error) {
        this.warn("knob re-read failed: " + message2(error));
      }
      if (!this.knobs.enabled)
        return { decisions, scenes, holds, skipped: "disabled" };
      for (const workspace of this.knownRoots()) {
        for (const team of this.teams(workspace, now)) {
          for (const decision of this.machine.observe(this.candidates(workspace, team), now, this.knobs)) {
            if (decision.type === "never-started") {
              this.stats.neverStarted += 1;
              this.info("task " + decision.taskId + " (member " + decision.assignee + ") never started — a dispatch problem, not an escalation");
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
    return candidateFor({ id: team.id, tasks: team.tasks }, stampsOf, (assignee) => assignee);
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
      unread: (memberKey) => mailboxUnread(workspace, this.config.stateDir, team.id, memberKey, now)
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
      cause: { kind: "silence", ms: decision.silenceMs },
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
    this.info(decision.type.toUpperCase() + " " + team.id + " task=" + decision.taskId + " member=" + decision.assignee + " silence=" + decision.silenceMs + "ms" + " streak=" + decision.streak + " hold=" + holdState + (scenePath === null ? " scene=none" : " scene=" + scenePath));
    return { scene: scenePath, held };
  }
  async performHold(workspace, teamId, decision, now) {
    const args = {
      team_id: teamId,
      task_id: decision.taskId,
      attempt_id: decision.attemptId,
      cause: "silence",
      scene_at: now
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

// packages/mpd-team-watchdog-plugin/src/holds.ts
import { existsSync as existsSync4, readFileSync as readFileSync5, readdirSync as readdirSync3, statSync as statSync2 } from "node:fs";
import { join as join6, resolve as resolve2 } from "node:path";
var HOLD_SERVICE = "mpdWatchdog";
function readHoldFile(workspace, stateDir, teamId) {
  let text;
  try {
    text = readFileSync5(holdPath(workspace, stateDir, teamId), "utf8");
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
        files = readdirSync3(holdDir(workspace, this.stateDir));
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
      files = readdirSync3(holdDir(where, this.stateDir));
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
    actionOnEscalate: config.actionOnEscalate === "warn-only" ? "warn-only" : WATCHDOG_DEFAULTS.actionOnEscalate,
    stateDir: typeof config.stateDir === "string" && config.stateDir !== "" ? config.stateDir : DEFAULT_STATE_DIR,
    teamCacheMs: num(config.teamCacheMs, 2000, 0),
    keepGenerations: num(config.keepGenerations, 3, 1),
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
    registerWatchdogActions(dsh, resolved.stateDir, registry);
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
    console.log("[mpd-team-watchdog] applied: enabled=" + engine.getKnobs().enabled + " warnSilenceMs=" + engine.getKnobs().warnSilenceMs + " tickIntervalMs=" + intervalMs + " warnStreakToEscalate=" + engine.getKnobs().warnStreakToEscalate + " actionOnEscalate=" + engine.getKnobs().actionOnEscalate + " stateDir=" + resolved.stateDir + " disposers=" + disposers.length + " holdService=" + (holdService ?? "none") + " hydratedHolds=" + hydratedHolds);
  } catch {}
  return { applied: true, engine, knobs: engine.getKnobs(), intervalMs, disposers: disposers.length, holdService, hydratedHolds };
}
export {
  resolveConfig,
  name,
  inject,
  apply,
  Config
};
