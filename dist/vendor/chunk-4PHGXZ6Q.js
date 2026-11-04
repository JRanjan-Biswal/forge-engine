import { createRequire as __forgeRequire } from "node:module"; const require = __forgeRequire(import.meta.url);
import {
  Doc,
  isValidBase64,
  isValidBase64URL,
  isValidCIDRv6,
  isValidCreditCard,
  isValidIBAN,
  isValidIPv6,
  isValidJWT,
  mergeValues,
  number,
  stripTabAndNewline,
  urlHostnameOk,
  urlProtocolOk,
  validateURL
} from "./chunk-IDMUECPH.js";
import {
  $ZodAsyncError,
  CONSTANT_CATCH,
  clone,
  codePointLength,
  esc,
  floatSafeRemainder,
  isPlainObject,
  rawShape,
  shallowClone,
  sizeCaps
} from "./chunk-XPSHCX6E.js";

// node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
  constructor() {
    super("Cannot parse a reference cycle that closes through a transform");
    this.name = "ZodCyclicError";
  }
};
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap();
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached = recursive.get(inst);
  if (cached !== void 0)
    return cached ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
      merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      kind;
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function isRecursiveSchema(inst) {
  return isRecursive(inst, /* @__PURE__ */ new Set(), true) !== NONE;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = void 0;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError();
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = void 0;
        const entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}

// node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/core/compile.js
var INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var FALLBACK_FLAG = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var ZodCompileAsyncError = class extends Error {
  constructor(message = "z.compile does not support async refinements, transforms, or checks") {
    super(message);
    this.name = "ZodCompileAsyncError";
  }
};
var ZodCompileUnsupportedError = class extends Error {
  constructor(feature, islandable = true) {
    super("z.compile does not support ".concat(feature, "; this schema must use the runtime parser"));
    this.name = "ZodCompileUnsupportedError";
    this.islandable = islandable;
  }
};
function compileValidator(schema, parser) {
  try {
    return compileFn(schema, { assertOnly: true });
  } catch {
    return parser;
  }
}
function compile(schema, options) {
  try {
    const parser = compileFn(schema);
    const clone2 = withParser(schema, parser);
    clone2._zod.bag.validator = compileValidator(schema, parser);
    return clone2;
  } catch (err) {
    if (options?.strict)
      throw err;
    return schema;
  }
}
function withParser(schema, parser) {
  if (isRecursiveSchema(schema)) {
    throw new ZodCompileUnsupportedError("a schema whose subtree contains a reference cycle");
  }
  const clone2 = clone(schema);
  const liveRun = schema._zod.run;
  const originalRun = liveRun.__originalRun ?? liveRun;
  const wrapped = (payload, ctx) => {
    if (ctx?.async || ctx?.direction === "backward" || ctx?.skipChecks || ctx?.[FALLBACK_FLAG]) {
      return originalRun(payload, ctx);
    }
    if (ctx && isBackEdge(ctx, payload.value)) {
      return originalRun(payload, ctx);
    }
    const out = parser(payload.value);
    if (out !== INVALID) {
      payload.value = out;
      return payload;
    }
    if (ctx)
      ctx[FALLBACK_FLAG] = true;
    return originalRun(payload, ctx);
  };
  wrapped.__originalRun = originalRun;
  clone2._zod.bag.fallbackRun = originalRun;
  clone2._zod.bag.validator = parser;
  clone2._zod.run = wrapped;
  if (!liveRun.__originalRun)
    installCompiledUserMethods(clone2, schema, parser);
  return clone2;
}
function installCompiledUserMethods(target, source, parser) {
  const targetAny = target;
  const sourceAny = source;
  if (typeof sourceAny.safeParse === "function") {
    const originalSafeParse = sourceAny.safeParse;
    targetAny.safeParse = (data, params) => {
      const out = parser(data);
      if (out !== INVALID) {
        return { success: true, data: out };
      }
      return originalSafeParse(data, params);
    };
  }
  if (typeof sourceAny.parse === "function") {
    const originalParse = sourceAny.parse;
    targetAny.parse = (data, params) => {
      const out = parser(data);
      if (out !== INVALID) {
        return out;
      }
      return originalParse(data, params);
    };
  }
}
function compileFn(schema, options) {
  let recursive2 = true;
  try {
    recursive2 = isRecursiveSchema(schema);
  } catch {
  }
  if (recursive2) {
    throw new ZodCompileUnsupportedError("a schema whose subtree contains a reference cycle");
  }
  const ctx = {
    constants: /* @__PURE__ */ new Map(),
    constantCounter: 0,
    varCounter: 0,
    definite: true
  };
  const doc = new Doc(["input"]);
  const outputAccessor = generateCheck(doc, ctx, schema, "input", !options?.assertOnly);
  doc.write(outputAccessor === null ? "return true;" : "return ".concat(outputAccessor, ";"));
  const constantNames = ["INVALID", ...ctx.constants.keys()];
  const constantValues = [INVALID, ...ctx.constants.values()];
  const code = doc.content.join("\n");
  const fullCode = options?.debug ? constantNames.length > 0 ? "// Constants: ".concat(constantNames.join(", "), "\n").concat(code) : code : "";
  const F = Function;
  const factoryCode = "return (input) => {\n".concat(code, "\n}");
  let fn;
  try {
    const factory = new F(...constantNames, factoryCode);
    fn = factory(...constantValues);
  } catch (err) {
    throw new ZodCompileUnsupportedError("this schema (generated code failed to evaluate: ".concat(err.message, ")"));
  }
  if (options?.debug) {
    fn.code = fullCode;
  }
  fn.definite = ctx.definite;
  return fn;
}
function addConstant(ctx, value) {
  for (const [name2, v] of ctx.constants) {
    if (v === value)
      return name2;
  }
  const name = "c".concat(ctx.constantCounter++);
  ctx.constants.set(name, value);
  return name;
}
function addUserConstant(ctx, fn) {
  ctx.definite = false;
  return addConstant(ctx, fn);
}
function newVar(ctx) {
  return "v".concat(ctx.varCounter++);
}
function runtimeRun(schema, value) {
  const result = schema._zod.run({ value, issues: [] }, {});
  if (result && typeof result.then === "function")
    return INVALID;
  const r = result;
  return r.issues.length === 0 ? r.value : INVALID;
}
function compileChild(doc, ctx, schema, accessor, needsValue = true) {
  const contentLen = doc.content.length;
  const constantCount = ctx.constants.size;
  const constantCounter = ctx.constantCounter;
  const varCounter = ctx.varCounter;
  try {
    return generateCheck(doc, ctx, schema, accessor, needsValue);
  } catch (err) {
    if (!(err instanceof ZodCompileUnsupportedError) || !err.islandable)
      throw err;
    doc.content.length = contentLen;
    if (ctx.constants.size > constantCount) {
      const trailing = Array.from(ctx.constants.keys()).slice(constantCount);
      for (const k of trailing)
        ctx.constants.delete(k);
    }
    ctx.constantCounter = constantCounter;
    ctx.varCounter = varCounter;
    return emitRuntimeIsland(doc, ctx, schema, accessor);
  }
}
function emitRuntimeIsland(doc, ctx, schema, accessor) {
  ctx.definite = false;
  const schemaConst = addConstant(ctx, schema);
  const runConst = addConstant(ctx, runtimeRun);
  const outVar = newVar(ctx);
  doc.write("const ".concat(outVar, " = ").concat(runConst, "(").concat(schemaConst, ", ").concat(accessor, ");"));
  doc.write("if (".concat(outVar, " === INVALID) return INVALID;"));
  return outVar;
}
var WHEN_DEFAULTED_CHECKS = /* @__PURE__ */ new Set([
  "max_size",
  "min_size",
  "size_equals",
  "max_length",
  "min_length",
  "length_equals"
]);
function generateChecks(doc, ctx, schema, accessor) {
  const schemaChecks = schema._zod.def.checks;
  if (!schemaChecks || schemaChecks.length === 0)
    return accessor;
  let currentAccessor = accessor;
  for (const check of schemaChecks) {
    const def = check._zod.def;
    if (def.when && !WHEN_DEFAULTED_CHECKS.has(def.check)) {
      throw new ZodCompileUnsupportedError('check with a custom "when" condition');
    }
    switch (def.check) {
      case "greater_than":
        generateGreaterThanCheck(doc, ctx, def, currentAccessor);
        break;
      case "less_than":
        generateLessThanCheck(doc, ctx, def, currentAccessor);
        break;
      case "multiple_of":
        generateMultipleOfCheck(doc, ctx, def, currentAccessor);
        break;
      case "number_format":
        generateNumberFormatCheck(doc, def, currentAccessor);
        break;
      case "min_length": {
        const min = numericOperand(def.minimum, "min_length");
        const len = codePointLengthVar(doc, ctx, currentAccessor, "".concat(currentAccessor, ".length >= ").concat(min, " && ").concat(currentAccessor, ".length < ").concat(def.minimum * 2));
        doc.write("if (".concat(len, " < ").concat(min, ") return INVALID;"));
        break;
      }
      case "max_length": {
        const max = numericOperand(def.maximum, "max_length");
        const len = codePointLengthVar(doc, ctx, currentAccessor, "".concat(currentAccessor, ".length > ").concat(max));
        doc.write("if (".concat(len, " > ").concat(max, ") return INVALID;"));
        break;
      }
      case "length_equals": {
        const exact = numericOperand(def.length, "length_equals");
        const len = codePointLengthVar(doc, ctx, currentAccessor, "".concat(currentAccessor, ".length >= ").concat(exact, " && ").concat(currentAccessor, ".length <= ").concat(def.length * 2));
        doc.write("if (".concat(len, " !== ").concat(exact, ") return INVALID;"));
        break;
      }
      case "min_size":
        doc.write("if (".concat(currentAccessor, ".size < ").concat(numericOperand(def.minimum, "min_size"), ") return INVALID;"));
        break;
      case "max_size":
        doc.write("if (".concat(currentAccessor, ".size > ").concat(numericOperand(def.maximum, "max_size"), ") return INVALID;"));
        break;
      case "size_equals":
        doc.write("if (".concat(currentAccessor, ".size !== ").concat(numericOperand(def.size, "size_equals"), ") return INVALID;"));
        break;
      case "string_format":
        currentAccessor = generateStringFormatCheck(doc, ctx, def, currentAccessor);
        break;
      case "custom":
        currentAccessor = generateCustomRefineCheck(doc, ctx, check, currentAccessor);
        break;
      case "bigint_format":
        generateBigIntFormatCheck(doc, def, currentAccessor);
        break;
      case "mime_type":
        generateMimeTypeCheck(doc, ctx, def, currentAccessor);
        break;
      case "property":
        generatePropertyCheck(doc, ctx, def, currentAccessor);
        break;
      case "properties":
        generatePropertiesChecks(doc, ctx, def, currentAccessor);
        break;
      case "overwrite": {
        const newAccessor = newVar(ctx);
        generateOverwriteCheck(doc, ctx, check, currentAccessor, newAccessor);
        currentAccessor = newAccessor;
        break;
      }
      default: {
        void def;
        throw new ZodCompileUnsupportedError("check type ".concat(def.check));
      }
    }
  }
  return currentAccessor;
}
function codePointLengthVar(doc, ctx, accessor, inDoubt) {
  const cpLen = addConstant(ctx, codePointLength);
  const v = newVar(ctx);
  doc.write("const ".concat(v, " = typeof ").concat(accessor, ' === "string" && ').concat(inDoubt, " ? ").concat(cpLen, "(").concat(accessor, ") : ").concat(accessor, ".length;"));
  return v;
}
function numericOperand(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ZodCompileUnsupportedError("".concat(label, " bound of type ").concat(typeof value));
  }
  return "".concat(value);
}
function comparisonOperand(ctx, value) {
  if (typeof value === "bigint")
    return "".concat(value, "n");
  if (typeof value === "number") {
    if (Number.isNaN(value))
      throw new ZodCompileUnsupportedError("comparison check with NaN bound");
    return "".concat(value);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ZodCompileUnsupportedError("comparison check with Invalid Date bound");
    }
    return addConstant(ctx, value);
  }
  throw new ZodCompileUnsupportedError("comparison check bound of type ".concat(typeof value));
}
function generateGreaterThanCheck(doc, ctx, def, accessor) {
  const op = def.inclusive ? "<" : "<=";
  doc.write("if (".concat(accessor, " ").concat(op, " ").concat(comparisonOperand(ctx, def.value), ") return INVALID;"));
}
function generateLessThanCheck(doc, ctx, def, accessor) {
  const op = def.inclusive ? ">" : ">=";
  doc.write("if (".concat(accessor, " ").concat(op, " ").concat(comparisonOperand(ctx, def.value), ") return INVALID;"));
}
function generateMultipleOfCheck(doc, ctx, def, accessor) {
  if (typeof def.value === "bigint") {
    if (def.value === BigInt(0))
      throw new ZodCompileUnsupportedError("multiple_of check with a zero divisor");
    doc.write("if (".concat(accessor, " % ").concat(def.value, "n !== 0n) return INVALID;"));
  } else {
    const remainder = addConstant(ctx, floatSafeRemainder);
    doc.write("if (".concat(remainder, "(").concat(accessor, ", ").concat(numericOperand(def.value, "multiple_of"), ") !== 0) return INVALID;"));
  }
}
function generateNumberFormatCheck(doc, def, accessor) {
  const format = def.format;
  switch (format) {
    case "safeint":
      doc.write("if (!Number.isSafeInteger(".concat(accessor, ")) return INVALID;"));
      break;
    case "int32":
      doc.write("if (!Number.isInteger(".concat(accessor, ") || ").concat(accessor, " < -2147483648 || ").concat(accessor, " > 2147483647) return INVALID;"));
      break;
    case "uint32":
      doc.write("if (!Number.isInteger(".concat(accessor, ") || ").concat(accessor, " < 0 || ").concat(accessor, " > 4294967295) return INVALID;"));
      break;
    case "float32":
      doc.write("if (!Number.isFinite(".concat(accessor, ") || ").concat(accessor, " < -3.4028234663852886e38 || ").concat(accessor, " > 3.4028234663852886e38) return INVALID;"));
      break;
    case "float64":
      doc.write("if (!Number.isFinite(".concat(accessor, ")) return INVALID;"));
      break;
    default: {
      void format;
      throw new ZodCompileUnsupportedError("number format ".concat(format));
    }
  }
}
function generateBigIntFormatCheck(doc, def, accessor) {
  const format = def.format;
  if (!format)
    return;
  switch (format) {
    case "int64":
      doc.write("if (".concat(accessor, " < -9223372036854775808n || ").concat(accessor, " > 9223372036854775807n) return INVALID;"));
      break;
    case "uint64":
      doc.write("if (".concat(accessor, " < 0n || ").concat(accessor, " > 18446744073709551615n) return INVALID;"));
      break;
    default: {
      void format;
      throw new ZodCompileUnsupportedError("bigint format ".concat(format));
    }
  }
}
function generateMimeTypeCheck(doc, ctx, def, accessor) {
  const mimeTypes = def.mime;
  if (mimeTypes && mimeTypes.length > 0) {
    const mimeSet = addConstant(ctx, new Set(mimeTypes));
    doc.write("if (!".concat(mimeSet, ".has(").concat(accessor, ".type)) return INVALID;"));
  }
}
function generatePropertiesChecks(doc, ctx, def, accessor) {
  if (def.when) {
    throw new ZodCompileUnsupportedError('check with a custom "when" condition');
  }
  doc.write("if (".concat(accessor, " == null) return INVALID;"));
  const shape = def.shape;
  for (const key of Reflect.ownKeys(shape)) {
    const keyExpr = typeof key === "symbol" ? addConstant(ctx, key) : esc(key);
    const inputVar = newVar(ctx);
    doc.write("const ".concat(inputVar, " = ").concat(accessor, "[").concat(keyExpr, "];"));
    compileChild(doc, ctx, shape[key], inputVar, false);
  }
}
function generatePropertyCheck(doc, ctx, def, accessor) {
  const propAccessor = "".concat(accessor, "[").concat(JSON.stringify(def.property), "]");
  generateCheck(doc, ctx, def.schema, propAccessor);
}
function generateOverwriteCheck(doc, ctx, check, currentAccessor, newAccessor) {
  const tx = check._zod.def.tx;
  if (!tx) {
    throw new ZodCompileUnsupportedError("overwrite check without a transform function");
  }
  if (isAsyncFunction(tx)) {
    throw new ZodCompileAsyncError("z.compile: async overwrite transforms are not supported");
  }
  const txConst = addConstant(ctx, tx);
  doc.write("const ".concat(newAccessor, " = ").concat(txConst, "(").concat(currentAccessor, ");"));
}
function throwAsync() {
  throw new $ZodAsyncError();
}
function pushIssue(issue) {
  this.issues.push(issue);
}
function generateCustomRefineCheck(doc, ctx, check, accessor) {
  const def = check._zod.def;
  if (def.fn) {
    if (isAsyncFunction(def.fn)) {
      throw new ZodCompileAsyncError("z.compile: async .refine() predicates are not supported");
    }
    const fnConst = addUserConstant(ctx, def.fn);
    const throwAsyncConst = addConstant(ctx, throwAsync);
    const resVar = newVar(ctx);
    doc.write("const ".concat(resVar, " = ").concat(fnConst, "(").concat(accessor, ");"));
    doc.write("if (".concat(resVar, " instanceof Promise) ").concat(throwAsyncConst, "();"));
    doc.write("if (!".concat(resVar, ") return INVALID;"));
    return accessor;
  }
  if (check._zod.check) {
    if (isAsyncFunction(check._zod.check)) {
      throw new ZodCompileAsyncError("z.compile: async .superRefine() / check functions are not supported");
    }
    const checkFn = check._zod.check;
    const helperFn = (value) => {
      const fakePayload = { value, issues: [], addIssue: pushIssue };
      const result = checkFn(fakePayload);
      if (result instanceof Promise)
        throwAsync();
      return fakePayload.issues.length === 0 ? fakePayload.value : INVALID;
    };
    const helperConst = addUserConstant(ctx, helperFn);
    const outVar = newVar(ctx);
    doc.write("const ".concat(outVar, " = ").concat(helperConst, "(").concat(accessor, ");"));
    doc.write("if (".concat(outVar, " === INVALID) return INVALID;"));
    return outVar;
  }
  throw new ZodCompileUnsupportedError("custom check without a predicate or check function");
}
var PATTERN_IS_COMPLETE = /* @__PURE__ */ new Set([
  "cidrv4",
  "cuid",
  "cuid2",
  "date",
  "datetime",
  "duration",
  "e164",
  "email",
  "emoji",
  "ends_with",
  "guid",
  "includes",
  "ipv4",
  "ksuid",
  "lowercase",
  "mac",
  "nanoid",
  "regex",
  "starts_with",
  "time",
  "ulid",
  "uppercase",
  "uuid",
  "xid"
]);
function generateStringFormatCheck(doc, ctx, def, accessor, needsValue = true) {
  const fmt = def.format;
  if (fmt === "base64") {
    const validator = addConstant(ctx, isValidBase64);
    doc.write("if (!".concat(validator, "(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  if (fmt === "base64url") {
    const validator = addConstant(ctx, isValidBase64URL);
    doc.write("if (!".concat(validator, "(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  if (fmt === "jwt") {
    const validator = addConstant(ctx, isValidJWT);
    const alg = addConstant(ctx, def.alg ?? null);
    doc.write("if (!".concat(validator, "(").concat(accessor, ", ").concat(alg, ")) return INVALID;"));
    return accessor;
  }
  if (fmt === "ipv6") {
    const validator = addConstant(ctx, isValidIPv6);
    doc.write("if (!".concat(validator, "(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  if (fmt === "cidrv6") {
    const validator = addConstant(ctx, isValidCIDRv6);
    doc.write("if (!".concat(validator, "(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  if (fmt === "credit_card") {
    const validator = addConstant(ctx, isValidCreditCard);
    doc.write("if (!".concat(validator, "(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  if (fmt === "iban") {
    const validator = addConstant(ctx, isValidIBAN);
    doc.write("if (!".concat(validator, "(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  const formatDef = def;
  if (fmt === "url" || fmt === "httpurl" || formatDef.normalize || formatDef.hostname !== void 0 || formatDef.protocol !== void 0) {
    const parseConst = addConstant(ctx, validateURL);
    const defConst = addConstant(ctx, def);
    const trimVar = newVar(ctx);
    const urlVar = newVar(ctx);
    doc.write("const ".concat(trimVar, " = ").concat(accessor, ".trim();"));
    doc.write("const ".concat(urlVar, " = ").concat(parseConst, "(").concat(trimVar, ", ").concat(defConst, ");"));
    doc.write("if (typeof ".concat(urlVar, ' === "number") return INVALID;'));
    if (formatDef.hostname !== void 0) {
      const hostnameConst = addConstant(ctx, urlHostnameOk);
      doc.write("if (!".concat(hostnameConst, "(").concat(urlVar, ", ").concat(defConst, ".hostname)) return INVALID;"));
    }
    if (formatDef.protocol !== void 0) {
      const protocolConst = addConstant(ctx, urlProtocolOk);
      doc.write("if (!".concat(protocolConst, "(").concat(urlVar, ", ").concat(defConst, ".protocol)) return INVALID;"));
    }
    if (!needsValue)
      return null;
    const outputVar = newVar(ctx);
    const outputExpr = formatDef.normalize ? "".concat(urlVar, ".href") : "".concat(addConstant(ctx, stripTabAndNewline), "(").concat(trimVar, ")");
    doc.write("const ".concat(outputVar, " = ").concat(outputExpr, ";"));
    return outputVar;
  }
  const customFn = def.fn;
  if (customFn) {
    if (isAsyncFunction(customFn))
      throw new ZodCompileUnsupportedError("async string format ".concat(fmt));
    const fnConst = addConstant(ctx, customFn);
    doc.write("if (!".concat(fnConst, "(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  if (PATTERN_IS_COMPLETE.has(fmt) && def.pattern) {
    const patternConst = addConstant(ctx, def.pattern);
    doc.write("".concat(patternConst, ".lastIndex = 0;"));
    doc.write("if (!".concat(patternConst, ".test(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  const format = def.format;
  switch (format) {
    case "regex":
      throw new ZodCompileUnsupportedError("regex format without a pattern");
    case "lowercase":
      doc.write("if (".concat(accessor, " !== ").concat(accessor, ".toLowerCase()) return INVALID;"));
      break;
    case "uppercase":
      doc.write("if (".concat(accessor, " !== ").concat(accessor, ".toUpperCase()) return INVALID;"));
      break;
    case "includes":
      doc.write("if (!".concat(accessor, ".includes(").concat(esc(def.includes), ")) return INVALID;"));
      break;
    case "starts_with": {
      const prefix = def.prefix;
      doc.write("if (".concat(accessor, ".slice(0, ").concat(prefix.length, ") !== ").concat(esc(prefix), ") return INVALID;"));
      break;
    }
    case "ends_with": {
      const suffix = def.suffix;
      doc.write("if (".concat(accessor, ".slice(-").concat(suffix.length, ") !== ").concat(esc(suffix), ") return INVALID;"));
      break;
    }
    default: {
      void format;
      throw new ZodCompileUnsupportedError("string format ".concat(format));
    }
  }
  return accessor;
}
function generateCheck(doc, ctx, schema, accessor, needsValue = true) {
  const def = schema._zod.def;
  const type = def.type;
  if (def.coerce) {
    throw new ZodCompileUnsupportedError("coercion (z.coerce.".concat(type, "())"));
  }
  const buildsValue = needsValue || !!def.checks?.length;
  let typeAccessor;
  switch (type) {
    case "string":
      typeAccessor = generateStringCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "number":
      typeAccessor = generateNumberCheck(doc, schema, accessor);
      break;
    case "boolean":
      typeAccessor = generateBooleanCheck(doc, accessor);
      break;
    case "bigint":
      typeAccessor = generateBigIntCheck(doc, schema, accessor);
      break;
    case "symbol":
      typeAccessor = generateSymbolCheck(doc, accessor);
      break;
    case "undefined":
      typeAccessor = generateUndefinedCheck(doc, accessor);
      break;
    case "null":
      typeAccessor = generateNullCheck(doc, accessor);
      break;
    case "any":
    case "unknown":
      typeAccessor = accessor;
      break;
    case "never":
      doc.write("return INVALID;");
      typeAccessor = accessor;
      break;
    case "void":
      typeAccessor = generateVoidCheck(doc, accessor);
      break;
    case "nan":
      typeAccessor = generateNaNCheck(doc, accessor);
      break;
    case "date":
      typeAccessor = generateDateCheck(doc, accessor);
      break;
    case "object":
      typeAccessor = generateObjectCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "optional":
      typeAccessor = generateOptionalCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "nullable":
      typeAccessor = generateNullableCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "array":
      typeAccessor = generateArrayCheck(doc, ctx, schema, accessor, buildsValue);
      break;
    case "literal":
      typeAccessor = generateLiteralCheck(doc, ctx, schema, accessor);
      break;
    case "enum":
      typeAccessor = generateEnumCheck(doc, ctx, schema, accessor);
      break;
    case "readonly": {
      const innerOut = generateWrapperCheck(doc, ctx, schema, accessor);
      const frozenVar = newVar(ctx);
      doc.write("const ".concat(frozenVar, " = Object.freeze(").concat(innerOut, ");"));
      typeAccessor = frozenVar;
      break;
    }
    case "success":
      generateWrapperCheck(doc, ctx, schema, accessor);
      typeAccessor = "true";
      break;
    case "default":
    case "prefault":
      typeAccessor = generateDefaultCheck(doc, ctx, schema, accessor);
      break;
    case "nonoptional":
      typeAccessor = generateNonOptionalCheck(doc, ctx, schema, accessor);
      break;
    case "tuple":
      typeAccessor = generateTupleCheck(doc, ctx, schema, accessor);
      break;
    case "union":
      typeAccessor = generateUnionCheck(doc, ctx, schema, accessor);
      break;
    case "intersection":
      typeAccessor = generateIntersectionCheck(doc, ctx, schema, accessor);
      break;
    case "record":
      typeAccessor = generateRecordCheck(doc, ctx, schema, accessor);
      break;
    case "map":
      typeAccessor = generateMapCheck(doc, ctx, schema, accessor);
      break;
    case "set":
      typeAccessor = generateSetCheck(doc, ctx, schema, accessor);
      break;
    case "file":
      typeAccessor = generateFileCheck(doc, accessor);
      break;
    case "template_literal":
      typeAccessor = generateTemplateLiteralCheck(doc, ctx, schema, accessor);
      break;
    case "lazy":
      typeAccessor = generateLazyCheck(doc, ctx, schema, accessor);
      break;
    case "pipe":
      typeAccessor = generatePipeCheck(doc, ctx, schema, accessor);
      break;
    case "custom":
      typeAccessor = generateCustomCheck(doc, ctx, schema, accessor);
      break;
    case "transform":
      typeAccessor = generateTransformCheck(doc, ctx, schema, accessor);
      break;
    case "catch":
      typeAccessor = generateCatchCheck(doc, ctx, schema, accessor);
      break;
    default: {
      void type;
      throw new ZodCompileUnsupportedError("schema type ".concat(type));
    }
  }
  if (typeAccessor === null)
    return null;
  return generateChecks(doc, ctx, schema, typeAccessor);
}
function generateStringCheck(doc, ctx, schema, accessor, needsValue = true) {
  doc.write("if (typeof ".concat(accessor, ' !== "string") return INVALID;'));
  const def = schema._zod.def;
  if (def.format === void 0)
    return accessor;
  return generateStringFormatCheck(doc, ctx, def, accessor, needsValue);
}
function generateNumberCheck(doc, schema, accessor) {
  doc.write("if (typeof ".concat(accessor, ' !== "number" || !Number.isFinite(').concat(accessor, ")) return INVALID;"));
  const def = schema._zod.def;
  if (def.check === "number_format" && def.format) {
    generateNumberFormatCheck(doc, { format: def.format }, accessor);
  }
  return accessor;
}
function generateBooleanCheck(doc, accessor) {
  doc.write("if (typeof ".concat(accessor, ' !== "boolean") return INVALID;'));
  return accessor;
}
function generateBigIntCheck(doc, schema, accessor) {
  doc.write("if (typeof ".concat(accessor, ' !== "bigint") return INVALID;'));
  const def = schema._zod.def;
  if (def.format) {
    switch (def.format) {
      case "int64":
        doc.write("if (".concat(accessor, " < -9223372036854775808n || ").concat(accessor, " > 9223372036854775807n) return INVALID;"));
        break;
      case "uint64":
        doc.write("if (".concat(accessor, " < 0n || ").concat(accessor, " > 18446744073709551615n) return INVALID;"));
        break;
    }
  }
  return accessor;
}
function generateSymbolCheck(doc, accessor) {
  doc.write("if (typeof ".concat(accessor, ' !== "symbol") return INVALID;'));
  return accessor;
}
function generateUndefinedCheck(doc, accessor) {
  doc.write("if (".concat(accessor, " !== undefined) return INVALID;"));
  return accessor;
}
function generateNullCheck(doc, accessor) {
  doc.write("if (".concat(accessor, " !== null) return INVALID;"));
  return accessor;
}
function generateVoidCheck(doc, accessor) {
  doc.write("if (".concat(accessor, " !== undefined) return INVALID;"));
  return accessor;
}
function generateNaNCheck(doc, accessor) {
  doc.write("if (typeof ".concat(accessor, ' !== "number" || !Number.isNaN(').concat(accessor, ")) return INVALID;"));
  return accessor;
}
function generateDateCheck(doc, accessor) {
  doc.write("if (!(".concat(accessor, " instanceof Date) || Number.isNaN(").concat(accessor, ".getTime())) return INVALID;"));
  return accessor;
}
function generateObjectCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  doc.write("if (typeof ".concat(accessor, ' !== "object" || ').concat(accessor, " === null || Array.isArray(").concat(accessor, ")) return INVALID;"));
  const shape = def.shape;
  const keys = Object.keys(shape);
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  const keyExpr = (k) => typeof k === "symbol" ? addConstant(ctx, k) : esc(k);
  const propKey = (k) => typeof k === "symbol" ? "[".concat(keyExpr(k), "]") : esc(k);
  const propShape = shape;
  if (keys.includes("__proto__")) {
    throw new ZodCompileUnsupportedError('object shape key "__proto__"');
  }
  const propOutputs = /* @__PURE__ */ new Map();
  for (const key of allKeys) {
    const propSchema = propShape[key];
    const kx = keyExpr(key);
    const inputVar = newVar(ctx);
    doc.write("const ".concat(inputVar, " = ").concat(accessor, "[").concat(kx, "];"));
    if (propSchema._zod.optin !== void 0) {
      const outputVar2 = newVar(ctx);
      doc.write("let ".concat(outputVar2, " = (() => {"));
      doc.indented((d) => {
        const outputAccessor = compileChild(d, ctx, propSchema, inputVar);
        d.write("return ".concat(outputAccessor, ";"));
      });
      doc.write("})();");
      if (propSchema._zod.optout === "optional") {
        doc.write("if (".concat(outputVar2, " === INVALID) {"));
        doc.indented((d) => {
          d.write("if (".concat(kx, " in ").concat(accessor, ") return INVALID;"));
          d.write("".concat(outputVar2, " = undefined;"));
        });
        doc.write("}");
      } else {
        doc.write("if (".concat(outputVar2, " === INVALID) return INVALID;"));
      }
      propOutputs.set(key, outputVar2);
    } else {
      if (requiresPresenceCheck(propSchema)) {
        doc.write("if (!(".concat(kx, " in ").concat(accessor, ")) return INVALID;"));
      }
      const outputAccessor = compileChild(doc, ctx, propSchema, inputVar, buildsValue);
      if (outputAccessor !== null)
        propOutputs.set(key, outputAccessor);
    }
  }
  const catchall = def.catchall;
  let unknownKeysMode = "none";
  if (catchall) {
    const catchallType = catchall._zod.def.type;
    if (catchallType === "never") {
      const condition = keys.map((k) => "k !== ".concat(esc(k))).join(" && ") || "true";
      doc.write("for (const k in ".concat(accessor, ") {"));
      doc.indented((d) => {
        d.write("if (".concat(condition, ") return INVALID;"));
      });
      doc.write("}");
    } else if ((catchallType === "unknown" || catchallType === "any") && !catchall._zod.def.checks?.length) {
      unknownKeysMode = "passthrough";
    } else {
      unknownKeysMode = "schema";
    }
  }
  const outputVar = newVar(ctx);
  const hasConditionalKeys = allKeys.some((k) => mayOmitUndefined(propShape[k]) || dropsWhenAbsent(propShape[k]));
  if (!buildsValue) {
    if (unknownKeysMode === "schema") {
      const knownSet = keys.length > 0 ? addConstant(ctx, new Set(keys)) : null;
      doc.write("for (const k in ".concat(accessor, ") {"));
      doc.indented((d) => {
        d.write('if (k === "__proto__") continue;');
        if (knownSet)
          d.write("if (".concat(knownSet, ".has(k)) continue;"));
        const valVar = newVar(ctx);
        d.write("const ".concat(valVar, " = ").concat(accessor, "[k];"));
        compileChild(d, ctx, catchall, valVar, false);
      });
      doc.write("}");
    }
    return null;
  }
  if (!hasConditionalKeys) {
    const propLiterals = allKeys.map((k) => "".concat(propKey(k), ": ").concat(propOutputs.get(k))).join(", ");
    doc.write("const ".concat(outputVar, " = { ").concat(propLiterals, " };"));
  } else {
    doc.write("const ".concat(outputVar, " = {};"));
    for (const k of allKeys) {
      const kx = keyExpr(k);
      const out = propOutputs.get(k);
      if (dropsWhenAbsent(propShape[k])) {
        doc.write("if (".concat(kx, " in ").concat(accessor, ") ").concat(outputVar, "[").concat(kx, "] = ").concat(out, ";"));
      } else if (mayOmitUndefined(propShape[k])) {
        doc.write("if (".concat(out, " !== undefined || ").concat(kx, " in ").concat(accessor, ") ").concat(outputVar, "[").concat(kx, "] = ").concat(out, ";"));
      } else {
        doc.write("".concat(outputVar, "[").concat(kx, "] = ").concat(out, ";"));
      }
    }
  }
  if (unknownKeysMode !== "none") {
    const knownSet = keys.length > 0 ? addConstant(ctx, new Set(keys)) : null;
    doc.write("for (const k in ".concat(accessor, ") {"));
    doc.indented((d) => {
      d.write('if (k === "__proto__") continue;');
      if (knownSet)
        d.write("if (".concat(knownSet, ".has(k)) continue;"));
      if (unknownKeysMode === "passthrough") {
        d.write("".concat(outputVar, "[k] = ").concat(accessor, "[k];"));
      } else {
        const valVar = newVar(ctx);
        d.write("const ".concat(valVar, " = ").concat(accessor, "[k];"));
        const catchallOut = compileChild(d, ctx, catchall, valVar);
        d.write("".concat(outputVar, "[k] = ").concat(catchallOut, ";"));
      }
    });
    doc.write("}");
  }
  return outputVar;
}
function generateOptionalCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  if (isExactOptional(schema)) {
    return generateCheck(doc, ctx, def.innerType, accessor, buildsValue);
  }
  if (def.innerType._zod.optin === "defaulted") {
    const outputVar2 = newVar(ctx);
    const branchVar = newVar(ctx);
    doc.write("let ".concat(outputVar2, ";"));
    doc.write("if (".concat(accessor, " === undefined) {"));
    doc.indented((d) => {
      d.write("const ".concat(branchVar, " = (() => {"));
      d.indented((d2) => {
        const innerOutput = generateCheck(d2, ctx, def.innerType, accessor);
        d2.write("return ".concat(innerOutput, ";"));
      });
      d.write("})();");
      d.write("if (".concat(branchVar, " !== INVALID) ").concat(outputVar2, " = ").concat(branchVar, ";"));
    });
    doc.write("} else {");
    doc.indented((d) => {
      const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
      d.write("".concat(outputVar2, " = ").concat(innerOutput, ";"));
    });
    doc.write("}");
    return outputVar2;
  }
  const outputVar = buildsValue ? newVar(ctx) : null;
  if (outputVar)
    doc.write("let ".concat(outputVar, ";"));
  doc.write("if (".concat(accessor, " !== undefined) {"));
  doc.indented((d) => {
    const innerOutput = generateCheck(d, ctx, def.innerType, accessor, buildsValue);
    if (outputVar && innerOutput !== null)
      d.write("".concat(outputVar, " = ").concat(innerOutput, ";"));
  });
  doc.write("}");
  return outputVar;
}
function isExactOptional(schema) {
  return schema._zod.traits?.has("$ZodExactOptional") === true;
}
function requiresPresenceCheck(schema) {
  return schema._zod.optin === void 0 && fastPathAcceptsAbsence(schema);
}
function fastPathAcceptsAbsence(schema) {
  if (schema._zod.def.coerce)
    return true;
  const def = schema._zod.def;
  switch (def.type) {
    case "any":
    case "unknown":
    case "undefined":
    case "void":
    case "default":
    case "prefault":
    case "transform":
    case "custom":
    case "lazy":
      return true;
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "null":
    case "never":
    case "nan":
    case "date":
    case "object":
    case "array":
    case "tuple":
    case "record":
    case "map":
    case "set":
    case "file":
    case "template_literal":
      return false;
    case "nonoptional":
      return def.innerType ? fastPathAcceptsAbsence(def.innerType) : false;
    case "literal":
      return !!def.values?.includes(void 0);
    case "enum":
      return !!schema._zod.values?.has(void 0);
    case "optional":
    case "nullable":
    case "readonly":
    case "success":
      return def.innerType ? fastPathAcceptsAbsence(def.innerType) : true;
    case "catch":
      return true;
    case "union":
      return def.options ? def.options.some(fastPathAcceptsAbsence) : true;
    case "intersection":
      if (!def.left || !def.right)
        return true;
      return fastPathAcceptsAbsence(def.left) && fastPathAcceptsAbsence(def.right);
    case "pipe":
      return def.in ? fastPathAcceptsAbsence(def.in) : true;
    default:
      return true;
  }
}
function dropsWhenAbsent(schema) {
  return schema._zod.optin === "optional" && schema._zod.optout === "optional";
}
function mayOmitUndefined(schema) {
  return (schema._zod.optin !== "defaulted" || schema._zod.optout === "optional") && mayOutputUndefined(schema);
}
function mayOutputUndefined(schema) {
  const def = schema._zod.def;
  switch (def.type) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "null":
    case "nan":
    case "date":
    case "object":
    case "array":
    case "tuple":
    case "record":
    case "map":
    case "set":
    case "file":
    case "template_literal":
    case "never":
    case "success":
      return false;
    case "literal":
      return !!def.values?.includes(void 0);
    case "enum":
      return !!schema._zod.values?.has(void 0);
    case "optional":
      return true;
    case "nullable":
    case "readonly":
    case "nonoptional":
      return def.innerType ? mayOutputUndefined(def.innerType) : true;
    case "union":
      return def.options ? def.options.some(mayOutputUndefined) : true;
    case "intersection":
      return !def.left || !def.right || mayOutputUndefined(def.left) || mayOutputUndefined(def.right);
    case "pipe":
      return def.out ? mayOutputUndefined(def.out) : true;
    default:
      return true;
  }
}
function generateNullableCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  const outputVar = buildsValue ? newVar(ctx) : null;
  if (outputVar)
    doc.write("let ".concat(outputVar, " = null;"));
  doc.write("if (".concat(accessor, " !== null) {"));
  doc.indented((d) => {
    const innerOutput = generateCheck(d, ctx, def.innerType, accessor, buildsValue);
    if (outputVar && innerOutput !== null)
      d.write("".concat(outputVar, " = ").concat(innerOutput, ";"));
  });
  doc.write("}");
  return outputVar;
}
function generateSizeGate(doc, schema, size) {
  for (const [max, check] of sizeCaps(schema._zod.def.checks)) {
    doc.write("if (".concat(size, " > ").concat(numericOperand(max, check._zod.def.check), ") return INVALID;"));
  }
}
function generateArrayCheck(doc, ctx, schema, accessor, buildsValue = true) {
  const def = schema._zod.def;
  doc.write("if (!Array.isArray(".concat(accessor, ")) return INVALID;"));
  generateSizeGate(doc, schema, "".concat(accessor, ".length"));
  const outputVar = buildsValue ? newVar(ctx) : null;
  const iVar = newVar(ctx);
  const elemVar = newVar(ctx);
  if (outputVar)
    doc.write("const ".concat(outputVar, " = new Array(").concat(accessor, ".length);"));
  doc.write("for (let ".concat(iVar, " = 0; ").concat(iVar, " < ").concat(accessor, ".length; ").concat(iVar, "++) {"));
  doc.indented((d) => {
    d.write("const ".concat(elemVar, " = ").concat(accessor, "[").concat(iVar, "];"));
    const elemOutput = compileChild(d, ctx, def.element, elemVar, buildsValue);
    if (outputVar && elemOutput !== null)
      d.write("".concat(outputVar, "[").concat(iVar, "] = ").concat(elemOutput, ";"));
  });
  doc.write("}");
  return outputVar;
}
function generateLiteralCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const values = def.values;
  if (values.length !== 1) {
    const literalSet = addConstant(ctx, new Set(values));
    doc.write("if (!".concat(literalSet, ".has(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  const value = values[0];
  if (typeof value === "number" && Number.isNaN(value)) {
    const literalSet = addConstant(ctx, new Set(values));
    doc.write("if (!".concat(literalSet, ".has(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  if (typeof value === "string") {
    doc.write("if (".concat(accessor, " !== ").concat(esc(value), ") return INVALID;"));
  } else if (typeof value === "number" || typeof value === "boolean") {
    doc.write("if (".concat(accessor, " !== ").concat(value, ") return INVALID;"));
  } else if (value === null) {
    doc.write("if (".concat(accessor, " !== null) return INVALID;"));
  } else if (value === void 0) {
    doc.write("if (".concat(accessor, " !== undefined) return INVALID;"));
  } else if (typeof value === "bigint") {
    doc.write("if (".concat(accessor, " !== ").concat(value, "n) return INVALID;"));
  } else {
    throw new ZodCompileUnsupportedError("literal type ".concat(typeof value));
  }
  return accessor;
}
function generateEnumCheck(doc, ctx, schema, accessor) {
  const values = schema._zod.values;
  if (!values) {
    throw new ZodCompileUnsupportedError("enum schema without enumerated values");
  }
  const enumSet = addConstant(ctx, values);
  doc.write("if (!".concat(enumSet, ".has(").concat(accessor, ")) return INVALID;"));
  return accessor;
}
function generateWrapperCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  return generateCheck(doc, ctx, def.innerType, accessor);
}
function generateDefaultCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const descriptor = Object.getOwnPropertyDescriptor(schema._zod.def, "defaultValue");
  const defaultGetter = descriptor ? () => schema._zod.def.defaultValue : void 0;
  if (schema._zod.def.type === "prefault") {
    if (!defaultGetter) {
      return generateCheck(doc, ctx, def.innerType, accessor);
    }
    const defaultFn = addConstant(ctx, defaultGetter);
    const inputVar = newVar(ctx);
    doc.write("let ".concat(inputVar, " = ").concat(accessor, ";"));
    doc.write("if (".concat(accessor, " === undefined) ").concat(inputVar, " = ").concat(defaultFn, "();"));
    return generateCheck(doc, ctx, def.innerType, inputVar);
  }
  const outputVar = newVar(ctx);
  if (defaultGetter) {
    const defaultFn = addConstant(ctx, defaultGetter);
    const cloneFn = addConstant(ctx, shallowClone);
    doc.write("let ".concat(outputVar, ";"));
    doc.write("if (".concat(accessor, " === undefined) {"));
    doc.indented((d) => {
      d.write("".concat(outputVar, " = ").concat(cloneFn, "(").concat(defaultFn, "());"));
    });
    doc.write("} else {");
    doc.indented((d) => {
      const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
      d.write("".concat(outputVar, " = ").concat(innerOutput, " === undefined ? ").concat(cloneFn, "(").concat(defaultFn, "()) : ").concat(innerOutput, ";"));
    });
    doc.write("}");
  } else {
    doc.write("let ".concat(outputVar, ";"));
    doc.write("if (".concat(accessor, " !== undefined) {"));
    doc.indented((d) => {
      const innerOutput = generateCheck(d, ctx, def.innerType, accessor);
      d.write("".concat(outputVar, " = ").concat(innerOutput, ";"));
    });
    doc.write("}");
  }
  return outputVar;
}
function generateNonOptionalCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const innerOutput = generateCheck(doc, ctx, def.innerType, accessor);
  const outputVar = newVar(ctx);
  doc.write("const ".concat(outputVar, " = ").concat(innerOutput, ";"));
  doc.write("if (".concat(outputVar, " === undefined) return INVALID;"));
  return outputVar;
}
function generateTupleCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const items = def.items;
  const rest = def.rest;
  doc.write("if (!Array.isArray(".concat(accessor, ")) return INVALID;"));
  const optinStart = getTupleOptStart(items, "optin");
  const optoutStart = getTupleOptStart(items, "optout");
  if (rest) {
    doc.write("if (".concat(accessor, ".length < ").concat(optinStart, ") return INVALID;"));
  } else {
    doc.write("if (".concat(accessor, ".length < ").concat(optinStart, " || ").concat(accessor, ".length > ").concat(items.length, ") return INVALID;"));
  }
  const outputVar = newVar(ctx);
  doc.write("const ".concat(outputVar, " = [];"));
  for (let i = 0; i < items.length; i++) {
    const itemSchema = items[i];
    if (i >= optoutStart) {
      doc.write("if (".concat(outputVar, ".length === ").concat(i, ") {"));
      doc.indented((d) => {
        d.write("if (".concat(i, " < ").concat(accessor, ".length) {"));
        d.indented((d2) => {
          const elemVar = newVar(ctx);
          d2.write("const ".concat(elemVar, " = ").concat(accessor, "[").concat(i, "];"));
          const elemOutput = compileChild(d2, ctx, itemSchema, elemVar);
          d2.write("".concat(outputVar, "[").concat(i, "] = ").concat(elemOutput, ";"));
        });
        d.write("} else {");
        d.indented((d2) => {
          if (dropsWhenAbsent(itemSchema)) {
            d2.write("".concat(outputVar, ".length = ").concat(i, ";"));
            return;
          }
          const elemVar = newVar(ctx);
          const branchVar = newVar(ctx);
          d2.write("const ".concat(elemVar, " = undefined;"));
          d2.write("const ".concat(branchVar, " = (() => {"));
          d2.indented((d3) => {
            const elemOutput = compileChild(d3, ctx, itemSchema, elemVar);
            d3.write("return ".concat(elemOutput, ";"));
          });
          d2.write("})();");
          d2.write("if (".concat(branchVar, " === INVALID || ").concat(branchVar, " === undefined) ").concat(outputVar, ".length = ").concat(i, ";"));
          d2.write("else ".concat(outputVar, "[").concat(i, "] = ").concat(branchVar, ";"));
        });
        d.write("}");
      });
      doc.write("}");
    } else {
      const elemVar = newVar(ctx);
      doc.write("const ".concat(elemVar, " = ").concat(accessor, "[").concat(i, "];"));
      const elemOutput = compileChild(doc, ctx, itemSchema, elemVar);
      doc.write("".concat(outputVar, "[").concat(i, "] = ").concat(elemOutput, ";"));
    }
  }
  if (rest) {
    const iVar = newVar(ctx);
    const elemVar = newVar(ctx);
    doc.write("for (let ".concat(iVar, " = ").concat(items.length, "; ").concat(iVar, " < ").concat(accessor, ".length; ").concat(iVar, "++) {"));
    doc.indented((d) => {
      d.write("const ".concat(elemVar, " = ").concat(accessor, "[").concat(iVar, "];"));
      const elemOutput = compileChild(d, ctx, rest, elemVar);
      d.write("".concat(outputVar, "[").concat(iVar, "] = ").concat(elemOutput, ";"));
    });
    doc.write("}");
  }
  return outputVar;
}
function getTupleOptStart(items, key) {
  for (let i = items.length - 1; i >= 0; i--) {
    const omittable = key === "optin" ? items[i]._zod.optin !== void 0 : items[i]._zod.optout === "optional";
    if (!omittable)
      return i + 1;
  }
  return 0;
}
function generateUnionCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const options = def.options;
  if (def.discriminator) {
    return generateDiscriminatedUnionCheck(doc, ctx, def, accessor);
  }
  if (def.inclusive === false) {
    throw new ZodCompileUnsupportedError("exclusive unions (z.xor)");
  }
  if (options.length === 0) {
    doc.write("return INVALID;");
    return accessor;
  }
  if (options.length === 1) {
    return generateCheck(doc, ctx, options[0], accessor);
  }
  const allLiterals = options.every((opt) => opt._zod.def.type === "literal" && !opt._zod.def.checks?.length);
  if (allLiterals) {
    const values = new Set(options.flatMap((opt) => opt._zod.def.values));
    const valuesConst = addConstant(ctx, values);
    doc.write("if (!".concat(valuesConst, ".has(").concat(accessor, ")) return INVALID;"));
    return accessor;
  }
  const outputVar = newVar(ctx);
  doc.write("let ".concat(outputVar, ";"));
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (i === 0) {
      doc.write("".concat(outputVar, " = (() => {"));
    } else {
      doc.write("if (".concat(outputVar, " === INVALID) ").concat(outputVar, " = (() => {"));
    }
    doc.indented((d) => {
      const branchOutput = generateCheck(d, ctx, opt, accessor);
      d.write("return ".concat(branchOutput, ";"));
    });
    doc.write("})();");
  }
  doc.write("if (".concat(outputVar, " === INVALID) return INVALID;"));
  return outputVar;
}
function generateDiscriminatedUnionCheck(doc, ctx, def, accessor) {
  if (def.unionFallback) {
    throw new ZodCompileUnsupportedError("discriminated union with unionFallback");
  }
  if (def.options.length === 0) {
    doc.write("return INVALID;");
    return accessor;
  }
  const discVar = newVar(ctx);
  const outputVar = newVar(ctx);
  doc.write("const ".concat(discVar, " = ").concat(accessor, "?.[").concat(esc(def.discriminator), "];"));
  doc.write("let ".concat(outputVar, ";"));
  let firstBranch = true;
  const claimed = /* @__PURE__ */ new Set();
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0) {
      throw new ZodCompileUnsupportedError("discriminated union option without static discriminator values");
    }
    for (const value of values) {
      if (claimed.has(value)) {
        throw new ZodCompileUnsupportedError("duplicate discriminator value ".concat(String(value)));
      }
      claimed.add(value);
    }
    const conditions = Array.from(values, (value) => literalEquality(ctx, discVar, value));
    const prefix = firstBranch ? "if" : "else if";
    doc.write("".concat(prefix, " (").concat(conditions.join(" || "), ") {"));
    doc.indented((d) => {
      const branchOutput = generateCheck(d, ctx, option, accessor);
      d.write("".concat(outputVar, " = ").concat(branchOutput, ";"));
    });
    doc.write("}");
    firstBranch = false;
  }
  doc.write("else { return INVALID; }");
  return outputVar;
}
function literalEquality(ctx, accessor, value) {
  if (typeof value === "string")
    return "".concat(accessor, " === ").concat(esc(value));
  if (typeof value === "number") {
    if (Number.isNaN(value))
      return "Number.isNaN(".concat(accessor, ")");
    return "".concat(accessor, " === ").concat(value);
  }
  if (typeof value === "boolean")
    return "".concat(accessor, " === ").concat(value);
  if (value === null)
    return "".concat(accessor, " === null");
  if (value === void 0)
    return "".concat(accessor, " === undefined");
  if (typeof value === "bigint")
    return "".concat(accessor, " === ").concat(value, "n");
  if (typeof value === "symbol") {
    const symbolConst = addConstant(ctx, value);
    return "".concat(accessor, " === ").concat(symbolConst);
  }
  throw new ZodCompileUnsupportedError("literal discriminator value ".concat(String(value)));
}
function generateIntersectionCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  ctx.definite = false;
  const leftOutput = compileChild(doc, ctx, def.left, accessor);
  const rightOutput = compileChild(doc, ctx, def.right, accessor);
  const mergeConst = addConstant(ctx, mergeValues);
  const mergedVar = newVar(ctx);
  doc.write("const ".concat(mergedVar, " = ").concat(mergeConst, "(").concat(leftOutput, ", ").concat(rightOutput, ");"));
  doc.write("if (!".concat(mergedVar, ".valid) return INVALID;"));
  return "".concat(mergedVar, ".data");
}
function generateRecordCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const isPlainObjectConst = addConstant(ctx, isPlainObject);
  doc.write("if (!".concat(isPlainObjectConst, "(").concat(accessor, ")) return INVALID;"));
  const outputVar = newVar(ctx);
  const kVar = newVar(ctx);
  const valVar = newVar(ctx);
  doc.write("const ".concat(outputVar, " = {};"));
  const recordDef = def;
  const keyValues = recordDef.partial ? void 0 : def.keyType._zod.values;
  if (keyValues) {
    const inputKeys = [];
    for (const key of keyValues) {
      if (!(typeof key === "string" || typeof key === "number" || typeof key === "symbol")) {
        throw new ZodCompileUnsupportedError("record key value ".concat(String(key)));
      }
      const inputKey = typeof key === "number" ? key.toString() : key;
      if (inputKey === "__proto__") {
        throw new ZodCompileUnsupportedError('record key "__proto__"');
      }
      inputKeys.push(inputKey);
      const keyConst = addConstant(ctx, key);
      const outKey = generateCheck(doc, ctx, def.keyType, keyConst);
      const valueVar = newVar(ctx);
      doc.write("const ".concat(valueVar, " = ").concat(accessor, "[").concat(literalPropertyKey(ctx, inputKey), "];"));
      const valOutput = compileChild(doc, ctx, def.valueType, valueVar);
      doc.write("".concat(outputVar, "[").concat(outKey, "] = ").concat(valOutput, ";"));
    }
    const knownKeysConst = addConstant(ctx, new Set(inputKeys));
    doc.write("for (const ".concat(kVar, " in ").concat(accessor, ") {"));
    doc.indented((d) => {
      d.write("if (".concat(knownKeysConst, ".has(").concat(kVar, ")) continue;"));
      if (recordDef.mode === "loose") {
        d.write("if (".concat(kVar, ' !== "__proto__") ').concat(outputVar, "[").concat(kVar, "] = ").concat(accessor, "[").concat(kVar, "];"));
      } else {
        d.write("return INVALID;");
      }
    });
    doc.write("}");
    return outputVar;
  }
  const keyDef = def.keyType._zod.def;
  const keyIsBareString = keyDef.type === "string" && keyDef.format === void 0 && !keyDef.coerce && (keyDef.checks?.length ?? 0) === 0;
  if (!keyIsBareString) {
    const isLoose = def.mode === "loose";
    const keyFn = compileFn(def.keyType);
    if (keyFn.definite === false)
      ctx.definite = false;
    const keyFast = addConstant(ctx, keyFn);
    const numericConst = addConstant(ctx, number);
    const outKeyVar = newVar(ctx);
    emitOwnKeys(doc, ctx, accessor, kVar, (d) => {
      d.write("let ".concat(outKeyVar, " = ").concat(keyFast, "(").concat(kVar, ");"));
      d.write("if (".concat(outKeyVar, " === INVALID && typeof ").concat(kVar, ' === "string" && ').concat(numericConst, ".test(").concat(kVar, ")) ").concat(outKeyVar, " = ").concat(keyFast, "(Number(").concat(kVar, "));"));
      if (isLoose) {
        d.write("if (".concat(outKeyVar, " === INVALID) { ").concat(outputVar, "[").concat(kVar, "] = ").concat(accessor, "[").concat(kVar, "]; continue; }"));
      } else {
        d.write("if (".concat(outKeyVar, " === INVALID) return INVALID;"));
      }
      d.write("if (".concat(outKeyVar, ' === "__proto__") continue;'));
      const valueVar = newVar(ctx);
      d.write("const ".concat(valueVar, " = ").concat(accessor, "[").concat(kVar, "];"));
      const valOutput = compileChild(d, ctx, def.valueType, valueVar);
      d.write("".concat(outputVar, "[").concat(outKeyVar, "] = ").concat(valOutput, ";"));
    });
    return outputVar;
  }
  emitOwnKeys(doc, ctx, accessor, kVar, (d) => {
    d.write("const ".concat(valVar, " = ").concat(accessor, "[").concat(kVar, "];"));
    const valOutput = compileChild(d, ctx, def.valueType, valVar);
    d.write("".concat(outputVar, "[").concat(kVar, "] = ").concat(valOutput, ";"));
  }, "return INVALID;");
  return outputVar;
}
function emitOwnKeys(doc, ctx, accessor, kVar, body, onSymbol) {
  const propIsEnumerableConst = addConstant(ctx, Object.prototype.propertyIsEnumerable);
  const symsVar = newVar(ctx);
  const keysVar = newVar(ctx);
  const iVar = newVar(ctx);
  doc.write("const ".concat(symsVar, " = Object.getOwnPropertySymbols(").concat(accessor, ");"));
  doc.write("const ".concat(keysVar, " = Object.getOwnPropertyNames(").concat(accessor, ");"));
  doc.write("for (let ".concat(iVar, " = 0; ").concat(iVar, " < ").concat(keysVar, ".length; ").concat(iVar, "++) {"));
  doc.indented((d) => {
    d.write("const ".concat(kVar, " = ").concat(keysVar, "[").concat(iVar, "];"));
    d.write("if (".concat(kVar, ' === "__proto__" || !').concat(propIsEnumerableConst, ".call(").concat(accessor, ", ").concat(kVar, ")) continue;"));
    body(d);
  });
  doc.write("}");
  doc.write("for (let ".concat(iVar, " = 0; ").concat(iVar, " < ").concat(symsVar, ".length; ").concat(iVar, "++) {"));
  doc.indented((d) => {
    d.write("const ".concat(kVar, " = ").concat(symsVar, "[").concat(iVar, "];"));
    d.write("if (!".concat(propIsEnumerableConst, ".call(").concat(accessor, ", ").concat(kVar, ")) continue;"));
    if (onSymbol)
      d.write(onSymbol);
    else
      body(d);
  });
  doc.write("}");
}
function literalPropertyKey(ctx, key) {
  if (typeof key === "string")
    return esc(key);
  return addConstant(ctx, key);
}
function generateMapCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  doc.write("if (!(".concat(accessor, " instanceof Map)) return INVALID;"));
  generateSizeGate(doc, schema, "".concat(accessor, ".size"));
  const outputVar = newVar(ctx);
  const kVar = newVar(ctx);
  const valVar = newVar(ctx);
  doc.write("const ".concat(outputVar, " = new Map();"));
  doc.write("for (const [".concat(kVar, ", ").concat(valVar, "] of ").concat(accessor, ") {"));
  doc.indented((d) => {
    const keyOutput = generateCheck(d, ctx, def.keyType, kVar);
    const valOutput = generateCheck(d, ctx, def.valueType, valVar);
    d.write("".concat(outputVar, ".set(").concat(keyOutput, ", ").concat(valOutput, ");"));
  });
  doc.write("}");
  return outputVar;
}
function generateSetCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  doc.write("if (!(".concat(accessor, " instanceof Set)) return INVALID;"));
  generateSizeGate(doc, schema, "".concat(accessor, ".size"));
  const outputVar = newVar(ctx);
  const valVar = newVar(ctx);
  doc.write("const ".concat(outputVar, " = new Set();"));
  doc.write("for (const ".concat(valVar, " of ").concat(accessor, ") {"));
  doc.indented((d) => {
    const valOutput = generateCheck(d, ctx, def.valueType, valVar);
    d.write("".concat(outputVar, ".add(").concat(valOutput, ");"));
  });
  doc.write("}");
  return outputVar;
}
function generateFileCheck(doc, accessor) {
  doc.write("if (!(".concat(accessor, " instanceof File)) return INVALID;"));
  return accessor;
}
function generateTemplateLiteralCheck(doc, ctx, schema, accessor) {
  doc.write("if (typeof ".concat(accessor, ' !== "string") return INVALID;'));
  const pattern = schema._zod.pattern;
  if (pattern) {
    const patternConst = addConstant(ctx, pattern);
    doc.write("".concat(patternConst, ".lastIndex = 0;"));
    doc.write("if (!".concat(patternConst, ".test(").concat(accessor, ")) return INVALID;"));
  }
  return accessor;
}
function generateLazyCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const getterConst = addUserConstant(ctx, def.getter);
  const cacheConst = addConstant(ctx, { parser: null });
  doc.write("if (!".concat(cacheConst, ".parser) {"));
  doc.indented((d) => {
    d.write("const inner = ".concat(getterConst, "();"));
    d.write("".concat(cacheConst, ".parser = function(input) {"));
    d.indented((d2) => {
      d2.write("const result = inner._zod.run({ value: input, issues: [] }, {});");
      d2.write("return result.issues.length === 0 ? result.value : INVALID;");
    });
    d.write("};");
  });
  doc.write("}");
  const outputVar = newVar(ctx);
  doc.write("const ".concat(outputVar, " = ").concat(cacheConst, ".parser(").concat(accessor, ");"));
  doc.write("if (".concat(outputVar, " === INVALID) return INVALID;"));
  return outputVar;
}
function generatePipeCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  const inputOutput = generateCheck(doc, ctx, def.in, accessor);
  if (def.transform) {
    if (isAsyncFunction(def.transform)) {
      throw new ZodCompileAsyncError("z.compile: async transforms in pipes are not supported");
    }
    const transformFn = def.transform;
    const helperFn = (value) => {
      const fakePayload = { value, issues: [], addIssue: pushIssue };
      const result = transformFn(value, fakePayload);
      if (result instanceof Promise)
        return INVALID;
      return fakePayload.issues.length === 0 ? result : INVALID;
    };
    const helperConst = addUserConstant(ctx, helperFn);
    const transformedVar = newVar(ctx);
    doc.write("const ".concat(transformedVar, " = ").concat(helperConst, "(").concat(inputOutput, ");"));
    doc.write("if (".concat(transformedVar, " === INVALID) return INVALID;"));
    return generateCheck(doc, ctx, def.out, transformedVar);
  } else {
    return generateCheck(doc, ctx, def.out, inputOutput);
  }
}
function isAsyncFunction(fn) {
  return typeof fn === "function" && (fn.constructor.name === "AsyncFunction" || fn[Symbol.toStringTag] === "AsyncFunction");
}
function generateCustomCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  if (def.fn) {
    if (isAsyncFunction(def.fn)) {
      throw new ZodCompileAsyncError("z.compile: async custom predicates are not supported");
    }
    const fnConst = addUserConstant(ctx, def.fn);
    const throwAsyncConst = addConstant(ctx, throwAsync);
    const resVar = newVar(ctx);
    doc.write("const ".concat(resVar, " = ").concat(fnConst, "(").concat(accessor, ");"));
    doc.write("if (".concat(resVar, " instanceof Promise) ").concat(throwAsyncConst, "();"));
    doc.write("if (!".concat(resVar, ") return INVALID;"));
  } else {
    throw new ZodCompileUnsupportedError("custom schema without a predicate function");
  }
  return accessor;
}
function runtimeCatch(innerSchema, catchValue, value) {
  const result = innerSchema._zod.run({ value, issues: [] }, {});
  if (result && typeof result.then === "function")
    return INVALID;
  const r = result;
  if (r.issues.length === 0)
    return r.value;
  return catchValue();
}
function generateCatchCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  if (!def.catchValue[CONSTANT_CATCH]) {
    throw new ZodCompileUnsupportedError("catch with a callback (only a constant catch value compiles)", false);
  }
  const outputVar = newVar(ctx);
  doc.write("let ".concat(outputVar, " = (() => {"));
  doc.indented((d) => {
    const innerOut = compileChild(d, ctx, def.innerType, accessor);
    d.write("return ".concat(innerOut, ";"));
  });
  doc.write("})();");
  const innerConst = addConstant(ctx, def.innerType);
  const catchConst = addUserConstant(ctx, def.catchValue);
  const catchHelperConst = addConstant(ctx, runtimeCatch);
  doc.write("if (".concat(outputVar, " === INVALID) {"));
  doc.indented((d) => {
    d.write("".concat(outputVar, " = ").concat(catchHelperConst, "(").concat(innerConst, ", ").concat(catchConst, ", ").concat(accessor, ");"));
    d.write("if (".concat(outputVar, " === INVALID) return INVALID;"));
  });
  doc.write("}");
  return outputVar;
}
function generateTransformCheck(doc, ctx, schema, accessor) {
  const def = schema._zod.def;
  if (def.transform) {
    if (isAsyncFunction(def.transform)) {
      throw new ZodCompileAsyncError("z.compile: async transforms are not supported");
    }
    const transformFn = def.transform;
    const helperFn = (value) => {
      const fakePayload = { value, issues: [], addIssue: pushIssue };
      const result = transformFn(value, fakePayload);
      if (result instanceof Promise)
        return INVALID;
      return fakePayload.issues.length === 0 ? result : INVALID;
    };
    const helperConst = addUserConstant(ctx, helperFn);
    const outputVar = newVar(ctx);
    doc.write("const ".concat(outputVar, " = ").concat(helperConst, "(").concat(accessor, ");"));
    doc.write("if (".concat(outputVar, " === INVALID) return INVALID;"));
    return outputVar;
  }
  return accessor;
}

export {
  $ZodCyclicError,
  isRecursiveSchema,
  memoizer,
  isBackEdge,
  INVALID,
  ZodCompileAsyncError,
  ZodCompileUnsupportedError,
  compile,
  withParser,
  compileFn
};
