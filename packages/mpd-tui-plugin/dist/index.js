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

// packages/mpd-tui-plugin/src/index.ts
var import_schemastery2 = __toESM(require_lib(), 1);
import { homedir as homedir3 } from "node:os";

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
        toolsPreExecute: typeof ctx?.on === "function",
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

// packages/mpd-tui-plugin/src/log.ts
function createLog(logger, prefix, env = process.env) {
  const emit = (level, message2) => {
    const text = `[${prefix}] ${message2}`;
    try {
      const sink = logger?.[level];
      if (typeof sink === "function") {
        sink.call(logger, text);
        return;
      }
    } catch {}
    if (level === "debug" && env.DSH_TUI_DEBUG === undefined)
      return;
    try {
      process.stderr.write(`${text}
`);
    } catch {}
  };
  return {
    info: (message2) => emit("info", message2),
    warn: (message2) => emit("warn", message2),
    debug: (message2) => emit("debug", message2)
  };
}

// packages/mpd-tui-plugin/src/host.ts
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
function onService(ctx, id, setup, onActivated) {
  if (ctx === undefined || ctx === null || typeof ctx.inject !== "function")
    return;
  try {
    ctx.inject([id], (scoped) => {
      const service = readableService(scoped, id);
      if (service === undefined)
        return;
      try {
        setup(scoped, service);
        onActivated?.();
      } catch {}
    });
  } catch {}
}
function effectOn(scoped, cleanup, label) {
  try {
    if (typeof scoped.effect === "function")
      scoped.effect(() => cleanup, label);
  } catch {}
}
function describeOutcome(id, outcome) {
  return outcome.detail === undefined ? `${id}(${outcome.state})` : `${id}(${outcome.state}: ${outcome.detail})`;
}

// packages/mpd-tui-plugin/src/state.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// packages/mpd-tui-plugin/src/sanitize.ts
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;
var WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;
function stripControl(value) {
  return value.replace(CONTROL, " ");
}
function collapse(value) {
  return value.replace(/\s+/gu, " ").trim();
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
  return JSON.parse(readFileSync(path, "utf8"));
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function readTeam(root, problems) {
  const teamsDir = join(root, ".mpd", "team");
  let entries;
  try {
    entries = readdirSync(teamsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).slice(0, MAX_TEAMS);
  } catch {
    return;
  }
  let best;
  for (const name of entries) {
    const path = join(teamsDir, name, "team.json");
    let size;
    try {
      size = statSync(path).size;
    } catch {
      problems.push(`team ${name}: unreadable`);
      continue;
    }
    let record2;
    try {
      record2 = readJson(path);
    } catch {
      problems.push(`team ${name}: invalid JSON`);
      continue;
    }
    if (!isRecord(record2))
      continue;
    const stamp = String(record2.approvedAt ?? record2.createdAt ?? "");
    const sortKey = `${stamp}\x00${String(size).padStart(12, "0")}`;
    if (best === undefined || sortKey > best.sortKey)
      best = { record: record2, sortKey };
  }
  if (best === undefined)
    return;
  const record = best.record;
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, failed: 0, claimed: 0, cancelled: 0, other: 0 };
  for (const task of asArray(record.tasks).slice(0, MAX_TASKS)) {
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
  const phase = scalarText(record.phase, 40) ?? "unknown";
  const planReviewState = scalarText(record.planReviewState, 40) ?? (phase === "staged" ? "awaiting_review" : undefined);
  return {
    id: scalarText(record.id, 60) ?? "?",
    name: scalarText(record.name, 80) ?? "?",
    phase,
    description: scalarText(record.description, 160),
    ...planReviewState === undefined ? {} : { planReviewState },
    members: asArray(record.members).length,
    tasks: counts
  };
}
function readBoulder(root, problems) {
  const path = join(root, ".mpd", "boulder.json");
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
  const dir = join(root, ".mpd", "plans");
  try {
    const names = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
    return { count: names.length, newest: scalarText(names[names.length - 1], 120) };
  } catch {
    return { count: 0 };
  }
}
function readWorkmates(home) {
  const dir = join(home, ".mpd", "workmate");
  try {
    const names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).slice(0, MAX_WORKMATES);
    const present = [];
    for (const name of names) {
      try {
        const meta = readJson(join(dir, name, "meta.json"));
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
function readBoardState(workspace, home = homedir()) {
  const problems = [];
  const state = {
    workspace,
    home,
    plans: readPlans(workspace),
    workmates: readWorkmates(home),
    problems
  };
  try {
    state.team = readTeam(workspace, problems);
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
    parts.push(`team ${state.team.name} ${state.team.members}·${done}/${total}`);
    if (state.team.tasks.failed > 0)
      parts.push(`failed ${state.team.tasks.failed}`);
  } else {
    parts.push("team -");
  }
  if (state.boulder !== undefined && state.boulder.works > 0)
    parts.push(`boulder ${state.boulder.active}/${state.boulder.works}`);
  parts.push(`plans ${state.plans.count}`);
  parts.push(`workmates ${state.workmates.count}`);
  if (state.problems.length > 0)
    parts.push(`notes ${state.problems.length}`);
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
    lines.push("team       (none in this workspace)");
  }
  if (holds.length > 0)
    lines.push(`team-hold  held (${holds.join(", ")})`);
  lines.push("");
  if (state.boulder !== undefined && state.boulder.works > 0) {
    lines.push(`boulder    ${state.boulder.works} work(s) · ${state.boulder.active} active · ${state.boulder.completed} completed${state.boulder.newestPlan === undefined ? "" : ` · newest ${state.boulder.newestPlan}`}`);
  } else {
    lines.push("boulder    (no work ledger)");
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
function registerStatus(ctx, log, workspaceRoot, home, intervalMs, bridgeNotice) {
  let outcome = { state: "absent", detail: "tuiStatus was not injected" };
  let refresh = () => {};
  onService(ctx, "tuiStatus", (scoped, service) => {
    const status = service;
    if (typeof status?.set !== "function") {
      outcome = { state: "refused", detail: "tuiStatus.set is missing" };
      return;
    }
    let disposer;
    let timer;
    let published;
    const publish = () => {
      try {
        const text = statusLine(readBoardState(workspaceRoot(), home()), bridgeNotice?.());
        if (text === published)
          return;
        published = text;
        disposer = status.set(STATUS_KEY, text, scoped);
      } catch (error) {
        log.debug(`status refresh failed: ${String(error?.message ?? error)}`);
      }
    };
    publish();
    if (intervalMs > 0) {
      try {
        timer = setInterval(publish, intervalMs);
        timer.unref?.();
      } catch {
        timer = undefined;
      }
    }
    effectOn(scoped, () => {
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
        status.set(STATUS_KEY, undefined, scoped);
      } catch {}
    }, "mpd-tui status line");
    refresh = publish;
    outcome = { state: "requested", detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated" };
  });
  return { outcome: () => outcome, refresh: () => refresh() };
}

// packages/mpd-tui-plugin/src/registration.ts
import { createRequire } from "node:module";
import { readdirSync as readdirSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var BOARD_OPENED_EVENT = "mpd-tui/board-opened";
function candidateAnchors(env = process.env, home = homedir2()) {
  const anchors = [];
  try {
    anchors.push(fileURLToPath(import.meta.url));
  } catch {}
  const argv1 = process.argv[1];
  if (typeof argv1 === "string" && argv1.length > 0)
    anchors.push(argv1);
  const homes = [];
  if (typeof env.DSH_HOME === "string" && env.DSH_HOME.length > 0)
    homes.push(env.DSH_HOME);
  homes.push(join2(home, ".dsh"), join2(home, ".dsh-tui"));
  for (const root of homes) {
    const profiles = join2(root, "profiles");
    try {
      for (const entry of readdirSync2(profiles, { withFileTypes: true })) {
        if (entry.isDirectory())
          anchors.push(join2(profiles, entry.name, "package.json"));
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
function registerRenderers(ctx, log) {
  let outcome = { state: "absent", detail: "tuiRenderers was not injected" };
  onService(ctx, "tuiRenderers", (scoped, service) => {
    const renderers = service;
    if (typeof renderers?.register !== "function") {
      outcome = { state: "refused", detail: "tuiRenderers.register is missing" };
      return;
    }
    let requested = 0;
    let threw = 0;
    for (const type of TRANSCRIPT_TYPES) {
      const render = TRANSCRIPT_RENDERERS[type];
      if (render === undefined)
        continue;
      try {
        const disposer = renderers.register(type, (payload) => {
          try {
            const result = render(payload);
            if (result === undefined)
              return;
            const title = scalarText(result.title, 120);
            return { ...title === undefined ? {} : { title }, lines: scalarLines(result.lines, 100, 400) };
          } catch {
            return;
          }
        }, scoped);
        if (typeof disposer === "function") {
          requested += 1;
          const release = disposer;
          effectOn(scoped, () => release(), `mpd-tui renderer ${type}`);
        }
      } catch (error) {
        threw += 1;
        log.debug(`transcript renderer ${type} refused: ${String(error?.message ?? error)}`);
      }
    }
    outcome = requested === 0 ? { state: "refused", detail: `every renderer registration was refused (${threw} threw)` } : { state: "requested", detail: `${requested}/${TRANSCRIPT_TYPES.length} renderer(s) requested (no host read-back; a refusal also returns a disposer)` };
  });
  return { outcome: () => outcome };
}

// packages/mpd-config-plugin/src/settings-schema.ts
var import_schemastery = __toESM(require_lib(), 1);
var SETTINGS_NS = "mpd";
var SettingsSchema = import_schemastery.default.object({
  hashline: import_schemastery.default.object({ maxDiffChars: import_schemastery.default.number().default(20000) }),
  commentChecker: import_schemastery.default.object({ autoCheck: import_schemastery.default.boolean().default(true) }),
  ulw: import_schemastery.default.object({ maxRounds: import_schemastery.default.number().default(6) }),
  memory: import_schemastery.default.object({ vcs: import_schemastery.default.union([import_schemastery.default.const("git"), import_schemastery.default.const("svn")]).default("git") }),
  team: import_schemastery.default.object({ stateDir: import_schemastery.default.string().default(".mpd/team") }),
  boulder: import_schemastery.default.object({ dir: import_schemastery.default.string().default(".mpd") }),
  watchdog: import_schemastery.default.object({
    enabled: import_schemastery.default.boolean().default(true),
    warnSilenceMs: import_schemastery.default.number().default(90000),
    tickIntervalMs: import_schemastery.default.number().default(15000),
    warnStreakToEscalate: import_schemastery.default.number().default(3),
    actionOnEscalate: import_schemastery.default.union([import_schemastery.default.const("pause"), import_schemastery.default.const("warn-only")]).default("pause"),
    toolInFlightMaxMs: import_schemastery.default.number().default(900000)
  })
});
var BRIDGE_DISCLOSURE = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount)";
var BRIDGE_NOT_LOST = "the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session";
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
  { path: ["watchdog", "toolInFlightMaxMs"], label: "Tool-in-flight bound (ms, 0 = no bound)", zh: "工具在飞上限（毫秒，0 表示不设上限）", kind: "number", hint: "how long ONE tool call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a `tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables the bound" }
];

// packages/mpd-tui-plugin/src/settings.ts
function knobHint(key) {
  return `mpd.jsonc ${key} — ${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`;
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
var SETTINGS_FIELDS = SETTINGS_KNOBS.map((knob) => ({
  path: [...knob.path],
  label: knob.label,
  descriptions: { zh: knob.zh },
  hint: knobHint(knob.path.join(".")),
  kind: knob.kind,
  ...knob.options === undefined ? {} : { options: knob.options.map((value) => ({ value, label: value })) }
}));
var SETTINGS_SECTION = {
  ns: SETTINGS_NS,
  title: "MPD bundle",
  descriptions: { zh: "MPD 插件包" },
  fields: SETTINGS_FIELDS
};
function registerSettingsSection(ctx, log) {
  let namespace = { state: "absent", detail: "settings was not injected" };
  let section = { state: "absent", detail: "tuiSettingsSections was not injected" };
  onService(ctx, "settings", (_scoped, service) => {
    const provider = service;
    if (typeof provider?.register !== "function") {
      namespace = { state: "refused", detail: "settings.register is missing" };
      return;
    }
    if (configPluginPresent(ctx)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is owned by mpd-config in this composition — the fallback registration was skipped` };
      log.info(`settings namespace ${SETTINGS_NS}: mpd-config owns the registration — fallback skipped (design §10.1)`);
      return;
    }
    if (isServed(provider)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is already served by mpd-config — the fallback registration was skipped` };
      log.info(`settings namespace ${SETTINGS_NS} is already served — fallback registration skipped (design §10.1)`);
      return;
    }
    try {
      provider.register(SETTINGS_NS, SettingsSchema, { applies: "restart" });
      namespace = { state: "requested", detail: `namespace ${SETTINGS_NS} requested by the fallback (no other registrant) (no host read-back)` };
    } catch (error) {
      namespace = { state: "refused", detail: String(error?.message ?? error) };
      log.warn(`settings namespace ${SETTINGS_NS} not registered: ${namespace.detail ?? ""}`);
    }
  });
  onService(ctx, "tuiSettingsSections", (_scoped, service) => {
    const sections = service;
    if (typeof sections?.register !== "function") {
      section = { state: "refused", detail: "tuiSettingsSections.register is missing" };
      return;
    }
    try {
      sections.register(SETTINGS_SECTION);
      section = { state: "requested", detail: `section ${SETTINGS_NS} requested (no host read-back)` };
    } catch (error) {
      section = { state: "refused", detail: String(error?.message ?? error) };
      log.warn(`/settings section refused: ${section.detail ?? ""}`);
    }
  });
  return {
    outcome: () => ({
      state: section.state,
      detail: `${section.detail ?? ""} · namespace ${SETTINGS_NS}: ${namespace.state}${namespace.detail === undefined ? "" : ` (${namespace.detail})`}`
    })
  };
}

// packages/mpd-tui-plugin/src/team-state.ts
import { readFileSync as readFileSync2, readdirSync as readdirSync3, statSync as statSync2 } from "node:fs";
import { join as join3 } from "node:path";
var MAX_TEAMS2 = 20;
var MAX_TASKS2 = 5000;
var MAX_PROBLEMS2 = 5;
var MAX_INBOX_TAIL = 5;
var MAILBOX_LEASE_MS = 60000;
var CAPTAIN_KEY = "captain";
var MAILBOX_KEY_MAX = 48;
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asArray2(value) {
  return Array.isArray(value) ? value : [];
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function asText(value, maxCells) {
  return scalarText(value, maxCells);
}
function optional(key, value) {
  return value === undefined ? {} : { [key]: value };
}
function mailboxKey(name) {
  const cleaned = name.normalize("NFC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (cleaned === "")
    return "";
  const points = [...cleaned];
  return points.length > MAILBOX_KEY_MAX ? points.slice(0, MAILBOX_KEY_MAX).join("") : cleaned;
}
function unreadCount(file) {
  let raw;
  try {
    raw = readFileSync2(file, "utf8");
  } catch {
    return 0;
  }
  const now = Date.now();
  let unread = 0;
  for (const rawLine of raw.split(`
`)) {
    const line = rawLine.replace(/^\uFEFF/u, "");
    if (line.trim() === "")
      continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord2(value))
      continue;
    if (value.tombstone === true)
      continue;
    if (value.readAt !== undefined)
      continue;
    const claimed = asNumber(value.deliveryClaimedAt);
    if (claimed !== undefined && now - claimed < MAILBOX_LEASE_MS)
      continue;
    unread += 1;
  }
  return unread;
}
function captainInboxTail(file) {
  let raw;
  try {
    raw = readFileSync2(file, "utf8");
  } catch {
    return [];
  }
  const tail = [];
  for (const rawLine of raw.split(`
`)) {
    const line = rawLine.replace(/^\uFEFF/u, "");
    if (line.trim() === "")
      continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord2(value) || value.tombstone === true)
      continue;
    const from = scalarText(value.from, 40) ?? "?";
    const content = scalarText(value.content, 200) ?? "";
    if (content === "")
      continue;
    tail.push({ from, content });
  }
  return tail.slice(-MAX_INBOX_TAIL);
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
function cycleIds(tasks) {
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
function newestRecordPath(teamsDir, problems) {
  let entries;
  try {
    entries = readdirSync3(teamsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).slice(0, MAX_TEAMS2);
  } catch {
    return;
  }
  let best;
  for (const name of entries) {
    const path = join3(teamsDir, name, "team.json");
    let size;
    try {
      size = statSync2(path).size;
    } catch {
      problems.push(`team ${name}: unreadable`);
      continue;
    }
    let record;
    try {
      record = JSON.parse(readFileSync2(path, "utf8"));
    } catch {
      problems.push(`team ${name}: invalid JSON`);
      continue;
    }
    if (!isRecord2(record)) {
      problems.push(`team ${name}: not an object`);
      continue;
    }
    const stamp = String(record.approvedAt ?? record.createdAt ?? "");
    const sortKey = `${stamp}\x00${String(size).padStart(12, "0")}`;
    if (best === undefined || sortKey > best.sortKey)
      best = { path, record, sortKey };
  }
  return best?.path;
}
function emptyWorkflow(workspace, problems, holds) {
  return {
    workspace,
    members: [],
    tasks: [],
    counts: { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: 0, captainInbox: [] },
    holds,
    problems
  };
}
function readTeamWorkflow(workspace, holds = []) {
  const problems = [];
  const teamsDir = join3(workspace, ".mpd", "team");
  let path;
  try {
    path = newestRecordPath(teamsDir, problems);
  } catch {
    problems.push("team state unreadable");
  }
  if (path === undefined) {
    if (problems.length === 0)
      return emptyWorkflow(workspace, problems, holds);
    return emptyWorkflow(workspace, problems.slice(0, MAX_PROBLEMS2), holds);
  }
  let record;
  try {
    const parsed = JSON.parse(readFileSync2(path, "utf8"));
    if (!isRecord2(parsed))
      throw new Error("not an object");
    record = parsed;
  } catch {
    problems.push("team record unreadable");
    return emptyWorkflow(workspace, problems.slice(0, MAX_PROBLEMS2), holds);
  }
  const tasks = [];
  for (const raw of asArray2(record.tasks).slice(0, MAX_TASKS2)) {
    if (!isRecord2(raw))
      continue;
    const id = asText(raw.id, 40);
    if (id === undefined)
      continue;
    const dependencies = asArray2(raw.dependencies).map((entry) => asText(entry, 40)).filter((entry) => entry !== undefined);
    tasks.push({
      id,
      subject: asText(raw.subject, 160) ?? "",
      ...optional("kind", asText(raw.kind, 40)),
      status: asText(raw.status, 40) ?? "pending",
      visual: "open",
      ...optional("assignee", asText(raw.assignee, 80)),
      ...asNumber(raw.attempt) === undefined ? {} : { attempt: asNumber(raw.attempt) },
      ...asNumber(raw.round) === undefined ? {} : { round: asNumber(raw.round) },
      ...optional("verdict", asText(raw.verdict, 40)),
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
  const cycle = cycleIds(tasks);
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
  const teamId = asText(record.id, 60) ?? "?";
  const inboxDir = join3(workspace, ".mpd", "team", asString(record.id) ?? "", "inbox");
  const members = [];
  let unreadTotal = 0;
  for (const raw of asArray2(record.members)) {
    if (!isRecord2(raw))
      continue;
    const status = asText(raw.status, 40) ?? "unknown";
    if (status === "removed")
      continue;
    const name = asText(raw.name, 80) ?? "?";
    const provider = asString(raw.provider)?.trim() ?? "";
    const model = asString(raw.model)?.trim() ?? "";
    const route = provider !== "" && model !== "" ? `${provider}/${model}` : model !== "" ? model : undefined;
    const owned = tasks.filter((task) => task.assignee === name);
    const done = owned.filter((task) => task.status === "completed").length;
    const key = mailboxKey(name);
    const unread = key === "" ? 0 : unreadCount(join3(inboxDir, `${key}.jsonl`));
    unreadTotal += unread;
    const currentTask = currentTaskOf(name, tasks);
    members.push({
      name,
      ...optional("role", asText(raw.role, 120)),
      ...optional("route", route),
      status,
      done,
      total: owned.length,
      progress: owned.length === 0 ? 0 : Math.round(done / owned.length * 100),
      ...optional("currentTask", currentTask),
      unread
    });
  }
  const captainKey = mailboxKey(CAPTAIN_KEY);
  const captainFile = join3(inboxDir, `${captainKey}.jsonl`);
  const captainUnread = unreadCount(captainFile);
  const inboxTail = captainInboxTail(captainFile);
  const phase = asText(record.phase, 40) ?? "running";
  const staged = phase === "staged";
  const planReviewState = asText(record.planReviewState, 40) ?? (staged ? "awaiting_review" : undefined);
  const stagedAt = asText(record.approvedAt ?? record.createdAt, 40);
  const links = tasks.reduce((sum, task) => sum + task.dependencies.length, 0);
  return {
    workspace,
    team: {
      id: teamId,
      name: asText(record.name, 80) ?? "?",
      phase,
      ...optional("description", asText(record.description, 160)),
      ...optional("captainSessionId", asText(record.captainSessionId, 80)),
      ...optional("planReviewState", planReviewState),
      ...optional("stagedAt", stagedAt),
      staged,
      runnable: members.length > 0 && tasks.length > 0,
      links
    },
    members,
    tasks,
    counts,
    mail: { unread: unreadTotal + captainUnread, captainInbox: inboxTail },
    holds,
    problems: problems.slice(0, MAX_PROBLEMS2)
  };
}
function approvalPhrase(teamId) {
  return `approve ${teamId}`;
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
    if (member.unread > 0)
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
  lines.push(`mail       ${workflow.mail.unread} unread`);
  for (const message2 of workflow.mail.captainInbox)
    lines.push(`  ${message2.from}: ${message2.content}`);
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

// packages/mpd-tui-plugin/src/scenes.ts
var BOARD_SCENE_ID = "mpd-tui-board";
var TEAM_SCENE_ID = "mpd-tui-team";
var PLAN_SCENE_ID = "mpd-tui-plan";
var BOARD_REFRESH_MS = 2000;
var DISCARD_WINDOW_MS = 1e4;
var SCENE_ROW_MAX_CELLS = 4000;
var APPROVE_TOOL = "agent_teams_approve";
var DISCARD_TOOL = "agent_teams_delete";
var UNAVAILABLE_PLAN_ACTIONS = {
  available: () => false,
  approve: async () => ({ ok: false, error: `${APPROVE_TOOL} is not reachable in this composition` }),
  discard: async () => ({ ok: false, error: `${DISCARD_TOOL} is not reachable in this composition` })
};
function noopSubscribe() {
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
function readWorkflow(workspaceRoot, holds) {
  try {
    let holdIds = [];
    try {
      holdIds = holds() ?? [];
    } catch {
      holdIds = [];
    }
    return readTeamWorkflow(workspaceRoot(), holdIds);
  } catch {
    return;
  }
}
function measureTerminal(ui) {
  if (typeof ui?.useTerminalSize !== "function")
    return { size: "", window: 20 };
  let columns = "?";
  let rows = "?";
  const measured = ui.useTerminalSize();
  if (measured !== undefined && measured !== null) {
    columns = measured.columns ?? "?";
    rows = measured.rows ?? "?";
  }
  const terminalRows = Number(rows);
  const size = `${String(columns)}x${String(rows)}`;
  return { size, window: Number.isFinite(terminalRows) && terminalRows > 8 ? terminalRows - 6 : 20 };
}
function createBoardComponent(workspaceRoot, home, holds, nav, openScene) {
  return function MpdTuiBoard(props) {
    const React = props?.React;
    const ui = props?.ui;
    const close = typeof props?.close === "function" ? props.close : () => {};
    if (!usableKit(React, ui)) {
      return null;
    }
    const read = () => {
      try {
        return boardLines(readBoardState(workspaceRoot(), home()), holds());
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
    const subscribe = typeof channel?.subscribe === "function" ? (listener) => channel.subscribe(listener) : noopSubscribe;
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
    const measured = measureTerminal(ui);
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
function createTeamComponent(workspaceRoot, holds, nav, openScene) {
  return function MpdTuiTeam(props) {
    const React = props?.React;
    const ui = props?.ui;
    const close = typeof props?.close === "function" ? props.close : () => {};
    if (!usableKit(React, ui))
      return null;
    const read = () => {
      let workflow;
      let root = "";
      try {
        root = workspaceRoot();
      } catch {
        root = "?";
      }
      try {
        workflow = readWorkflow(workspaceRoot, holds);
      } catch {
        workflow = undefined;
      }
      if (workflow === undefined)
        return { rows: [`team state unreadable — ${root}/.mpd/team`], subject: "MPD team — (unreadable)", staged: false };
      const subject2 = workflow.team === undefined ? "MPD team — (none)" : `MPD team — ${workflow.team.name}`;
      return {
        rows: teamWorkflowLines(workflow),
        subject: subject2,
        staged: workflow.team?.staged === true,
        ...workflow.team?.id === undefined ? {} : { teamId: workflow.team.id }
      };
    };
    const rowsState = React.useState([]);
    const rows = rowsState[0];
    const setRows = rowsState[1];
    const subjectState = React.useState("MPD team");
    const subject = subjectState[0];
    const setSubject = subjectState[1];
    const noticeState = React.useState("");
    const notice = noticeState[0];
    const setNotice = noticeState[1];
    const scrollState = React.useState(0);
    const scroll = scrollState[0];
    const setScroll = scrollState[1];
    const latestRef = React.useRef?.(undefined);
    const refresh = () => {
      const snapshot = read();
      setRows(snapshot.rows);
      setSubject(snapshot.subject);
      if (latestRef !== undefined && latestRef !== null)
        latestRef.current = { staged: snapshot.staged, teamId: snapshot.teamId };
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
    if (typeof ui.useInput === "function") {
      ui.useInput((input, key) => {
        if (key?.escape === true || input === "q")
          close();
        else if (input === "r") {
          setScroll(0);
          refresh();
        } else if (key?.upArrow === true || input === "k")
          setScroll(scroll > 0 ? scroll - 1 : 0);
        else if (key?.downArrow === true || input === "j")
          setScroll(scroll + 1);
        else if (input === "p") {
          nav.planFromTeam = false;
          openScene(BOARD_SCENE_ID);
        } else if (input === "a") {
          const staged = latestRef?.current?.staged === true;
          if (!staged) {
            setNotice("plan approval needs a staged team");
            return;
          }
          setNotice("");
          nav.planFromTeam = true;
          nav.planTeamId = latestRef?.current?.teamId;
          if (!openScene(PLAN_SCENE_ID))
            setNotice("the plan approval surface is not available in this composition");
        }
      });
    }
    const measured = measureTerminal(ui);
    const visible = rows.slice(scroll, scroll + measured.window);
    const size = measured.size;
    const children = [
      React.createElement(ui.Text, { key: "title", bold: true }, safeLine(`${subject}${size === "" ? "" : ` · ${size}`}`)),
      React.createElement(ui.Text, { key: "meta", dimColor: true }, safeLine(`${rows.length} line(s) · scroll ${scroll}`))
    ];
    for (let index = 0;index < visible.length; index += 1) {
      children.push(React.createElement(ui.Text, { key: `line-${index}` }, safeLine(visible[index])));
    }
    if (notice !== "")
      children.push(React.createElement(ui.Text, { key: "notice", color: "yellow" }, safeLine(notice)));
    children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, safeLine("esc/q close · r refresh · ↑/k ↓/j scroll · a plan approval · p board")));
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children);
  };
}
function planActionLines(workflow, echo, armed, message2) {
  const team = workflow?.team;
  const phrase = team === undefined ? "" : approvalPhrase(team.id);
  const rows = [];
  rows.push("");
  rows.push(`approval needs the exact team id typed below, then Ctrl+X`);
  rows.push(`confirm    ${echo}`);
  rows.push(`required   ${phrase === "" ? "(no team record)" : phrase}`);
  rows.push(`runnable   ${team?.runnable === true ? "yes" : "no"}`);
  if (armed)
    rows.push("DISCARD ARMED — press Ctrl+D again within 10s to archive this staged plan");
  if (message2 !== "")
    rows.push(message2);
  rows.push("");
  rows.push("to change this plan: press Esc and tell the captain what to change in the chat");
  rows.push("Ctrl+X approve · Ctrl+D discard ×2 · Ctrl+R re-read · esc back");
  return rows;
}
function createPlanComponent(workspaceRoot, holds, nav, openScene, actions) {
  return function MpdTuiPlan(props) {
    const React = props?.React;
    const ui = props?.ui;
    const close = typeof props?.close === "function" ? props.close : () => {};
    if (!usableKit(React, ui))
      return null;
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
    const message2 = messageState[0];
    const setMessage = messageState[1];
    const armedState = React.useState(0);
    const armedAt = armedState[0];
    const setArmedAt = armedState[1];
    const scrollState = React.useState(0);
    const scroll = scrollState[0];
    const setScroll = scrollState[1];
    const refresh = () => {
      setView(readWorkflow(workspaceRoot, holds));
      setEcho("");
      setArmedAt(0);
      setScroll(0);
    };
    React.useEffect(() => {
      refresh();
      let timer;
      try {
        timer = setInterval(() => {
          setView(readWorkflow(workspaceRoot, holds));
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
    const phrase = team === undefined ? "" : approvalPhrase(team.id);
    const usable = view !== undefined && team !== undefined && team.staged;
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
        setMessage(`approve failed: ${APPROVE_TOOL} is not registered in this composition`);
        return;
      }
      setBusy(true);
      setMessage("working…");
      try {
        const result = await actions.approve({
          teamId: team.id,
          confirmation: echo,
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
        setView(readWorkflow(workspaceRoot, holds));
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
        setMessage(`discard failed: ${DISCARD_TOOL} is not registered in this composition`);
        return;
      }
      setBusy(true);
      setMessage("working…");
      try {
        const result = await actions.discard(team?.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId });
        setMessage(result.ok ? "discarded: team archived" : `discard failed: ${result.error ?? "the tool refused the call"}`);
        if (result.ok)
          setEcho("");
      } catch (error) {
        setMessage(`discard failed: ${String(error?.message ?? error)}`);
      } finally {
        setBusy(false);
        setView(readWorkflow(workspaceRoot, holds));
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
      for (const row of planActionLines(view, echo, armedAt !== 0, message2))
        body.push(row);
    const measured = measureTerminal(ui);
    const visible = body.slice(scroll, scroll + measured.window);
    const size = measured.size;
    const settled = message2 !== "";
    const verdict = !usable && settled;
    const title = !usable ? verdict ? `MPD plan approval — ${team?.name ?? "(none)"}` : `MPD plan approval — ${team === undefined ? "(none)" : `no staged plan for team ${team.id} (phase ${team.phase})`}` : `MPD plan approval — ${team.name}${busy ? " · working…" : ""}`;
    const children = [React.createElement(ui.Text, { key: "title", bold: true }, safeLine(`${title}${size === "" ? "" : ` · ${size}`}`))];
    if (!usable) {
      if (verdict) {
        children.push(React.createElement(ui.Text, { key: "verdict", bold: true }, safeLine(message2)));
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
function registerScene(ctx, log, workspaceRoot, home, holds = () => [], planActions = UNAVAILABLE_PLAN_ACTIONS) {
  let outcome = { state: "absent", detail: "tuiScenes was not injected" };
  let scenes;
  const nav = { planFromTeam: false };
  const openScene = (id) => {
    if (scenes === undefined) {
      log.debug(`scene open(${id}) skipped: tuiScenes was not injected`);
      return false;
    }
    try {
      const opened = scenes.open(id);
      if (opened !== true)
        log.debug(`scene open(${id}) returned ${String(opened)}`);
      return opened === true;
    } catch (error) {
      log.debug(`scene open(${id}) failed: ${String(error?.message ?? error)}`);
      return false;
    }
  };
  onService(ctx, "tuiScenes", (scoped, service) => {
    const runtime = service;
    if (typeof runtime?.register !== "function") {
      outcome = { state: "refused", detail: "tuiScenes.register is missing" };
      return;
    }
    scenes = runtime;
    try {
      runtime.register({ id: BOARD_SCENE_ID, title: "MPD board", component: createBoardComponent(workspaceRoot, home, holds, nav, openScene) }, scoped);
      runtime.register({ id: TEAM_SCENE_ID, title: "MPD team", component: createTeamComponent(workspaceRoot, holds, nav, openScene) }, scoped);
      runtime.register({ id: PLAN_SCENE_ID, title: "MPD plan approval", component: createPlanComponent(workspaceRoot, holds, nav, openScene, planActions) }, scoped);
      outcome = { state: "requested", detail: `${BOARD_SCENE_ID}, ${TEAM_SCENE_ID}, ${PLAN_SCENE_ID} requested (no host read-back)` };
    } catch (error) {
      outcome = { state: "refused", detail: String(error?.message ?? error) };
      log.debug(`scene registration refused: ${outcome.detail ?? ""}`);
    }
  });
  const open = () => openScene(BOARD_SCENE_ID);
  return {
    outcome: () => outcome,
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
    }
  };
}
function boardSummary(workspaceRoot, home) {
  try {
    return statusLine(readBoardState(workspaceRoot(), home()));
  } catch {
    return "mpd: state unreadable";
  }
}

// packages/mpd-tui-plugin/src/command-trees.ts
var COMMAND_ROOT = "mpd";
var COMMAND_ACTIONS = ["board", "team", "plan", "workmates", "status"];
var COMMAND_CHILDREN = [
  { name: "board", description: "Open the mpd board scene", descriptions: { zh: "打开 MPD 面板" } },
  { name: "team", description: "Open the team workflow scene", descriptions: { zh: "打开团队工作流面板" } },
  { name: "plan", description: "Review and approve a staged plan", descriptions: { zh: "审阅并批准待定计划" } },
  { name: "workmates", description: "List the durable workmate library", descriptions: { zh: "列出 workmate 库" } },
  { name: "status", description: "Print the mpd status line", descriptions: { zh: "输出 MPD 状态行" } }
];
function registerCommandTrees(ctx, log) {
  let outcome = { state: "absent", detail: "tuiCommandTrees was not injected" };
  onService(ctx, "tuiCommandTrees", (_scoped, service) => {
    const trees = service;
    if (typeof trees?.register !== "function") {
      outcome = { state: "refused", detail: "tuiCommandTrees.register is missing" };
      return;
    }
    try {
      trees.register({
        root: COMMAND_ROOT,
        descriptions: { zh: "MPD 面板与状态" },
        children: (canonicalPath) => canonicalPath.length <= 1 ? COMMAND_CHILDREN : []
      });
      outcome = { state: "requested", detail: `provider for /${COMMAND_ROOT} requested (no host read-back)` };
    } catch (error) {
      outcome = { state: "refused", detail: String(error?.message ?? error) };
      log.debug(`tuiCommandTrees registration refused: ${outcome.detail ?? ""}`);
    }
  });
  return { outcome: () => outcome };
}

// packages/mpd-tui-plugin/src/shortcuts.ts
var SHORTCUT_BINDINGS = [
  { combo: "alt+m", description: "mpd: open the board", action: "openBoard" },
  { combo: "alt+t", description: "mpd: open the team workflow", action: "openTeam" },
  { combo: "alt+w", description: "mpd: pick a workmate", action: "pickWorkmate" },
  { combo: "alt+r", description: "mpd: refresh the status line", action: "refreshStatus" }
];
function registerShortcuts(ctx, log, actions) {
  let outcome = { state: "absent", detail: "tuiShortcuts was not injected" };
  onService(ctx, "tuiShortcuts", (scoped, service) => {
    const shortcuts = service;
    if (typeof shortcuts?.register !== "function") {
      outcome = { state: "refused", detail: "tuiShortcuts.register is missing" };
      return;
    }
    const disposers = [];
    for (const binding of SHORTCUT_BINDINGS) {
      try {
        const disposer = shortcuts.register(binding.combo, {
          description: binding.description,
          handler: () => {
            try {
              if (binding.action === "openBoard")
                actions.openBoard("shortcut");
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
        }, scoped);
        if (typeof disposer === "function") {
          const release = disposer;
          disposers.push(release);
          effectOn(scoped, () => release(), `mpd-tui shortcut ${binding.combo}`);
        }
      } catch (error) {
        log.debug(`shortcut ${binding.combo} refused: ${String(error?.message ?? error)}`);
      }
    }
    let listed;
    if (typeof shortcuts.list === "function") {
      try {
        listed = shortcuts.list() ?? [];
      } catch {
        listed = undefined;
      }
    }
    if (listed === undefined) {
      outcome = { state: "requested", detail: `${disposers.length} binding(s) requested; the host exposes no list() read-back` };
      return;
    }
    const confirmed = SHORTCUT_BINDINGS.filter((binding) => listed?.some((entry) => entry.description === binding.description)).map((binding) => binding.combo);
    outcome = confirmed.length === 0 ? { state: "refused", detail: `list() shows none of our bindings — every combo was refused (reserved or duplicate): ${disposers.length} no-op disposer(s)` } : confirmed.length === SHORTCUT_BINDINGS.length ? { state: "confirmed", detail: `${confirmed.join(", ")} confirmed via tuiShortcuts.list()` } : { state: "requested", detail: `${confirmed.join(", ")} confirmed; ${SHORTCUT_BINDINGS.length - confirmed.length} not visible in list()` };
  });
  return { outcome: () => outcome };
}

// packages/mpd-tui-plugin/src/dialogs.ts
function createDialogs(ctx, log, defaultTimeoutMs = 30000) {
  let dialogs;
  let outcome = { state: "absent", detail: "tuiDialogs was not injected" };
  onService(ctx, "tuiDialogs", (_scoped, service) => {
    const runtime = service;
    const usable = runtime !== undefined && runtime !== null && typeof runtime.select === "function" && typeof runtime.confirm === "function" && typeof runtime.input === "function";
    if (!usable) {
      outcome = { state: "refused", detail: "tuiDialogs is missing select/confirm/input" };
      return;
    }
    dialogs = runtime;
    outcome = { state: "available", detail: "request-based seam; nothing to register" };
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
  const confirm = async (title, message2, timeoutMs = defaultTimeoutMs) => {
    if (dialogs === undefined)
      return;
    try {
      return await dialogs.confirm({ title, message: message2, timeoutMs });
    } catch (error) {
      log.debug(`dialog confirm failed: ${String(error?.message ?? error)}`);
      return;
    }
  };
  return { available, outcome: () => outcome, select, confirm };
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
    parts.push(`held ${view.holds.join(", ")}`);
  if (view.unread.length > 0)
    parts.push(`${view.unread.length} unread incident${view.unread.length === 1 ? "" : "s"}`);
  return parts.length === 0 ? undefined : `${WATCHDOG_NOTICE_PREFIX}: ${parts.join(" · ")}`;
}
function composeNotices(...notices) {
  const parts = notices.filter((notice) => typeof notice === "string" && notice.length > 0);
  return parts.length === 0 ? undefined : parts.join(" · ");
}
function watchdogDialog(view) {
  const detail = view.holds.length > 0 ? `Team ${view.holds.join(", ")} is held by the team watchdog (a member went silent).` : "The team watchdog recorded incidents while nobody was watching.";
  return {
    title: `${watchdogNotice(view) ?? WATCHDOG_NOTICE_PREFIX} — ${detail}`,
    options: [
      { id: ACKNOWLEDGE_OPTION, label: "Acknowledge", description: "mark these incidents as read so they stop being replayed" },
      { id: "later", label: "Later", description: "keep them unread; they will be shown again on the next start" }
    ]
  };
}
function attachWatchdogFrontDoor(ctx, log, options) {
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
    onService(ctx, "tuiDialogs", () => {
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
function attemptDecisionEvents(ctx, log) {
  const attempts = [];
  let outcome = { state: "absent", detail: "tuiPluginHost was not injected" };
  onService(ctx, "tuiPluginHost", (scoped, service) => {
    const host = service;
    if (typeof host?.subscribeDecision !== "function") {
      outcome = { state: "refused", detail: "tuiPluginHost.subscribeDecision is missing" };
      return;
    }
    const disposers = [];
    for (const { event, permission } of DECISION_EVENTS) {
      let granted;
      const facade = host.grants;
      if (facade !== undefined && typeof facade.allows === "function") {
        try {
          granted = facade.allows(scoped, permission, event) === true;
        } catch {
          granted = undefined;
        }
      }
      try {
        const disposer = host.subscribeDecision(scoped, event, () => {
          return;
        }, { scope: event, order: DECISION_ORDER });
        if (typeof disposer !== "function") {
          attempts.push({ event, state: "refused", reason: "subscribeDecision returned no disposer" });
          continue;
        }
        if (granted === true) {
          const release = disposer;
          disposers.push(release);
          effectOn(scoped, () => release(), `mpd-tui decision ${event}`);
          attempts.push({ event, state: "confirmed", reason: `${permission} granted` });
        } else if (granted === false) {
          const release = disposer;
          effectOn(scoped, () => release(), `mpd-tui decision ${event} (refused)`);
          attempts.push({ event, state: "refused", reason: `no grant for ${permission}@${event}` });
        } else {
          const release = disposer;
          effectOn(scoped, () => release(), `mpd-tui decision ${event} (unconfirmed)`);
          attempts.push({ event, state: "requested", reason: "grant state not queryable in this composition" });
        }
      } catch (error) {
        attempts.push({ event, state: "refused", reason: shortReason(error) });
      }
    }
    const confirmed = attempts.filter((attempt) => attempt.state === "confirmed");
    const refused = attempts.filter((attempt) => attempt.state === "refused");
    const first = refused[0] ?? attempts[0];
    outcome = confirmed.length > 0 ? { state: "confirmed", detail: `${confirmed.length}/${attempts.length} intercept point(s) registered` } : refused.length === attempts.length ? { state: "refused", detail: `${refused.length}/${attempts.length} refused — ${first?.reason ?? "unknown"}` } : { state: "requested", detail: `unconfirmed — ${first?.reason ?? "unknown"}` };
    if (confirmed.length > 0) {
      log.info(`decision-event seam ACTIVE for ${confirmed.length} intercept point(s); handlers express no opinion`);
    } else {
      log.warn("decision-event seam is ready but NOT activated: tui.dsh/v1alpha1#DecisionEvents registration was refused " + `(first refusal: ${first?.reason ?? "unknown"}). No input/rewind/session-switch/compact interception is claimed.`);
    }
  });
  return { outcome: () => outcome, attempts: () => attempts };
}
function shortReason(error) {
  const message2 = error instanceof Error ? error.message : String(error);
  return message2.replace(/\s+/gu, " ").trim().slice(0, 160);
}

// packages/mpd-tui-plugin/src/commands.ts
var USAGE = `/${COMMAND_ROOT} [${COMMAND_ACTIONS.join("|")}]`;
function registerCommands(ctx, log, actions) {
  let outcome = { state: "absent", detail: "commands was not injected" };
  onService(ctx, "commands", (_scoped, service) => {
    const commands = service;
    if (typeof commands?.register !== "function") {
      outcome = { state: "refused", detail: "commands.register is missing" };
      return;
    }
    try {
      commands.register({
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
      outcome = { state: "requested", detail: `/${COMMAND_ROOT} requested (no host read-back at apply time)` };
    } catch (error) {
      outcome = { state: "refused", detail: String(error?.message ?? error) };
      log.debug(`/${COMMAND_ROOT} registration refused: ${outcome.detail ?? ""}`);
    }
  });
  return { outcome: () => outcome };
}
function runAction(action, actions, session) {
  if (action === "board") {
    actions.recordBoardOpened("command", session);
    const opened = actions.openBoard("command");
    return opened ? { kind: "success" } : { kind: "error", text: "mpd: the board scene is not available in this composition" };
  }
  if (action === "workmates")
    return { kind: "success", text: clamp(actions.workmatesText()) };
  if (action === "status")
    return { kind: "success", text: clamp(actions.statusText()) };
  if (action === "team") {
    return actions.openTeam() ? { kind: "success" } : { kind: "error", text: "mpd: the team workflow scene is not available in this composition" };
  }
  if (action === "plan") {
    return actions.openPlan() ? { kind: "success" } : { kind: "error", text: "mpd: the plan approval scene is not available in this composition" };
  }
  return { kind: "error", text: `mpd: unknown action "${clamp(action, 40)}" — usage: ${USAGE}` };
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
  const registered = (toolName) => {
    try {
      return adapter.hasTool(toolName) === true;
    } catch {
      return false;
    }
  };
  const agentFor = (captainSessionId) => {
    try {
      if (typeof captainSessionId === "string" && captainSessionId.length > 0)
        return adapter.liveAgent(captainSessionId);
      return adapter.liveAgents()[0];
    } catch {
      return;
    }
  };
  const errorText = (error) => {
    if (typeof error === "string")
      return error;
    const message2 = error?.message;
    return typeof message2 === "string" && message2.length > 0 ? message2 : "the tool call failed";
  };
  const run = async (toolName, args, captainSessionId) => {
    if (!registered(toolName))
      return { ok: false, error: `${toolName} is not registered in this composition` };
    const agent = agentFor(captainSessionId);
    if (agent === undefined || agent === null) {
      const id = typeof captainSessionId === "string" ? captainSessionId : "";
      return {
        ok: false,
        error: id === "" ? `no live session is attached in this process, so ${toolName} cannot be called` : `the captain session ${id} is not attached in this process`
      };
    }
    try {
      const result = await adapter.executeTool({ name: toolName, arguments: args, agent });
      if (result.ok !== true)
        return { ok: false, error: errorText(result.error) };
      return { ok: true, value: result.value };
    } catch (error) {
      log.debug(`${toolName} call failed: ${String(error?.message ?? error)}`);
      return { ok: false, error: errorText(error) };
    }
  };
  return {
    available: () => registered(APPROVE_TOOL) && registered(DISCARD_TOOL),
    approve: (input) => run(APPROVE_TOOL, { confirmation: input.confirmation }, input.captainSessionId),
    discard: (input) => run(DISCARD_TOOL, {}, input.captainSessionId)
  };
}
function homeDir() {
  const env = process.env.HOME;
  if (typeof env === "string" && env.length > 0)
    return env;
  try {
    return homedir3();
  } catch {
    return "";
  }
}
function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  const log = createLog(ctx?.logger, resolved.logPrefix);
  const adapter = resolveAdapter(ctx);
  const workspaceRoot = workspaceResolver(ctx, adapter);
  const home = () => homeDir();
  const sessionEventTypeKnown = resolved.sessionEvents ? registerLogOnlyEventType(BOARD_OPENED_EVENT, log) : false;
  const outcomes = [];
  const record = (id, outcome) => {
    outcomes.push({ id, outcome });
  };
  let configHandle;
  const bridgeRead = () => {
    try {
      const skipped = configHandle?.states?.()?.writeback?.skipped;
      if (skipped === "no-live-session")
        return NO_LIVE_SESSION_NOTICE;
      if (skipped === "ambiguous-multi-root")
        return AMBIGUOUS_MULTI_ROOT_NOTICE;
      return;
    } catch {
      return;
    }
  };
  onService(ctx, "mpdConfig", (_scoped, service) => {
    configHandle = service;
  });
  const dialogs = createDialogs(ctx, log);
  let status = {
    outcome: () => ({ state: "absent", detail: "not wired yet" }),
    refresh: () => {}
  };
  const watchdogFrontDoor = attachWatchdogFrontDoor(ctx, log, {
    workspaceRoot,
    dialogs,
    onAcknowledged: () => status.refresh()
  });
  const noticeRead = () => composeNotices(bridgeRead(), watchdogFrontDoor.notice());
  status = resolved.statusLine ? registerStatus(ctx, log, workspaceRoot, home, resolved.statusIntervalMs, noticeRead) : { outcome: () => ({ state: "absent", detail: "disabled by config" }), refresh: () => {} };
  const scene = resolved.scene ? registerScene(ctx, log, workspaceRoot, home, () => watchdogFrontDoor.view().holds, createPlanActions(adapter, log)) : {
    outcome: () => ({ state: "absent", detail: "disabled by config" }),
    open: () => false,
    openScene: () => false,
    openTeam: () => false,
    openPlan: () => false
  };
  const renderers = resolved.renderers ? registerRenderers(ctx, log) : { outcome: () => ({ state: "absent", detail: "disabled by config" }) };
  const settings = resolved.settingsSection ? registerSettingsSection(ctx, log) : { outcome: () => ({ state: "absent", detail: "disabled by config" }) };
  const trees = resolved.commandTrees ? registerCommandTrees(ctx, log) : { outcome: () => ({ state: "absent", detail: "disabled by config" }) };
  const shortcuts = resolved.shortcuts ? registerShortcuts(ctx, log, {
    openBoard: () => scene.open(),
    openTeam: () => scene.openTeam(),
    refreshStatus: () => status.refresh(),
    pickWorkmate: () => {
      pickWorkmate(log, dialogs, workspaceRoot, home, scene);
    }
  }) : { outcome: () => ({ state: "absent", detail: "disabled by config" }) };
  const commands = resolved.commands ? registerCommands(ctx, log, {
    openBoard: () => scene.open(),
    openTeam: () => scene.openTeam(),
    openPlan: () => scene.openPlan(),
    statusText: () => boardSummary(workspaceRoot, home),
    workmatesText: () => {
      const state = readBoardState(workspaceRoot(), home());
      return state.workmates.count === 0 ? "mpd workmates: none" : `mpd workmates (${state.workmates.count}): ${state.workmates.names.join(", ")}`;
    },
    pickAction: () => pickAction(log, dialogs),
    recordBoardOpened: (via, session) => {
      if (!resolved.sessionEvents)
        return;
      appendBoardOpened(session, sessionEventTypeKnown, via, "board", log);
    }
  }) : { outcome: () => ({ state: "absent", detail: "disabled by config" }) };
  const decisions = resolved.decisionEvents ? attemptDecisionEvents(ctx, log) : { outcome: () => ({ state: "absent", detail: "disabled by config" }), attempts: () => [] };
  record("tuiStatus", status.outcome());
  record("tuiRenderers", renderers.outcome());
  record("tuiSettingsSections", settings.outcome());
  record("tuiScenes", scene.outcome());
  record("tuiCommandTrees", trees.outcome());
  record("tuiShortcuts", shortcuts.outcome());
  record("tuiDialogs", dialogs.outcome());
  record("commands", commands.outcome());
  record("decisionEvents", decisions.outcome());
  const attempted = outcomes.filter((entry) => entry.outcome.state !== "absent");
  if (attempted.length === 0) {
    log.warn("no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped");
  } else {
    log.info(`mpd TUI surfaces: ${outcomes.map((entry) => describeOutcome(entry.id, entry.outcome)).join(" · ")}`);
  }
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
    { id: "workmates", label: "Workmates", description: "list the durable workmate library" },
    { id: "status", label: "Status", description: "print the mpd status line" }
  ]);
  if (choice !== undefined)
    log.debug(`/mpd picker chose ${scalarText(choice, 40) ?? "?"}`);
  return choice;
}
async function pickWorkmate(log, dialogs, workspaceRoot, home, scene) {
  const names = readBoardState(workspaceRoot(), home()).workmates.names;
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
  workspaceResolver,
  resolveConfig,
  name,
  createPlanActions,
  apply,
  Config
};
