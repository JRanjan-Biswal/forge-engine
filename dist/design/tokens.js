import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportNative } from "./native.js";
const TOKEN_FILE = /^(.+?)(?:\.([a-z0-9-]+))?\.tokens\.json$/;
const ALIAS = /^\{([^{}]+)\}$/;
export function tokensDir(root) {
    return join(root, "design", "tokens");
}
function flatten(node, path, inheritedType, file, out, errors) {
    if (!node || typeof node !== "object" || Array.isArray(node))
        return;
    const record = node;
    const type = typeof record.$type === "string" ? record.$type : inheritedType;
    if ("$value" in record) {
        const tokenPath = path.join(".");
        if (!type)
            errors.push("".concat(file, ": ", tokenPath, " has no $type (set it on the token or a parent group)"));
        out.set(tokenPath, {
            path: tokenPath,
            type: type ?? "unknown",
            value: record.$value,
            description: typeof record.$description === "string" ? record.$description : undefined,
            file,
        });
        return;
    }
    for (const [key, child] of Object.entries(record)) {
        if (!key.startsWith("$"))
            flatten(child, [...path, key], type, file, out, errors);
    }
}
function resolveValue(value, tokens, stack, errors, at) {
    if (typeof value === "string") {
        const alias = ALIAS.exec(value);
        if (!alias?.[1])
            return value;
        const target = alias[1];
        if (stack.includes(target)) {
            errors.push("alias cycle: ".concat([...stack, target].join(" → ")));
            return value;
        }
        const token = tokens.get(target);
        if (!token) {
            errors.push("".concat(at, ": {", target, "} does not resolve to a token"));
            return value;
        }
        return resolveValue(token.value, tokens, [...stack, target], errors, at);
    }
    if (Array.isArray(value))
        return value.map((item) => resolveValue(item, tokens, stack, errors, at));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, tokens, stack, errors, at)]));
    }
    return value;
}
const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla|oklch|oklab|color)\(.+\)|transparent|currentColor)$/i;
const LENGTH = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|dp|pt)$|^0$/;
const TIME = /^\d*\.?\d+(ms|s)$/;
function validate(token, value) {
    const unitValue = (v, units) => (typeof v === "string" && units.test(v)) ||
        (typeof v === "object" && v !== null && typeof v.value === "number" && typeof v.unit === "string");
    switch (token.type) {
        case "color":
            return typeof value === "string" && COLOR.test(value.trim()) ? null : "color expected, got ".concat(JSON.stringify(value));
        case "dimension":
            return unitValue(value, LENGTH) ? null : "dimension expected (e.g. \"16px\" or {value, unit}), got ".concat(JSON.stringify(value));
        case "duration":
            return unitValue(value, TIME) ? null : "duration expected (e.g. \"200ms\"), got ".concat(JSON.stringify(value));
        case "cubicBezier":
            return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number") ? null : "cubicBezier expects [x1, y1, x2, y2]";
        case "number":
        case "fontWeight":
            return typeof value === "number" || typeof value === "string" ? null : "".concat(token.type, " expected");
        case "fontFamily":
            return typeof value === "string" || (Array.isArray(value) && value.every((f) => typeof f === "string")) ? null : "fontFamily expects a string or string[]";
        case "spring": {
            const spring = value;
            return typeof spring?.stiffness === "number" && typeof spring?.damping === "number" ? null : "spring expects {stiffness, damping, mass?}";
        }
        default:
            return null; // shadow, typography, border, gradient… passed through
    }
}
function resolveAll(raw, errors) {
    const resolved = new Map();
    for (const token of raw.values()) {
        const value = resolveValue(token.value, raw, [token.path], errors, token.path);
        const problem = validate(token, value);
        if (problem)
            errors.push("".concat(token.file, ": ", token.path, " — ", problem));
        resolved.set(token.path, { ...token, value });
    }
    return resolved;
}
export function loadTokens(root) {
    const dir = tokensDir(root);
    const errors = [];
    const warnings = [];
    const base = new Map();
    const overrides = {};
    const files = [];
    if (!existsSync(dir))
        return { base, themes: {}, errors: ["design/tokens/ does not exist"], warnings, files };
    for (const name of readdirSync(dir).filter((n) => TOKEN_FILE.test(n)).sort()) {
        files.push(name);
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
        }
        catch (error) {
            errors.push("".concat(name, ": invalid JSON (", error.message, ")"));
            continue;
        }
        const theme = TOKEN_FILE.exec(name)?.[2];
        const target = theme ? (overrides[theme] ??= new Map()) : base;
        flatten(parsed, [], undefined, name, target, errors);
    }
    if (!files.length)
        errors.push("design/tokens/ has no *.tokens.json files");
    for (const [theme, map] of Object.entries(overrides)) {
        for (const path of map.keys())
            if (!base.has(path))
                warnings.push("theme \"".concat(theme, "\" defines ", path, ", which has no base token"));
    }
    const resolvedBase = resolveAll(base, errors);
    const themes = {};
    for (const [theme, map] of Object.entries(overrides)) {
        themes[theme] = resolveAll(new Map([...base, ...map]), errors);
    }
    if (![...resolvedBase.values()].some((t) => t.type === "color"))
        errors.push("no color tokens defined");
    return { base: resolvedBase, themes, errors: [...new Set(errors)], warnings, files };
}
// ── Export ───────────────────────────────────────────────────────────────────
const kebab = (path) => path
    .split(".")
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase())
    .join("-");
function cssValue(token) {
    const v = token.value;
    if (typeof v === "object" && v !== null && "value" in v && "unit" in v)
        return "".concat(v.value, v.unit);
    switch (token.type) {
        case "cubicBezier":
            return "cubic-bezier(".concat(v.join(", "), ")");
        case "fontFamily":
            return (Array.isArray(v) ? v : [v]).map((f) => (/\s/.test(String(f)) ? "\"".concat(f, "\"") : String(f))).join(", ");
        case "spring":
            return null; // no CSS equivalent — exported to theme.ts for Motion/Reanimated/SwiftUI
        default:
            return typeof v === "string" || typeof v === "number" ? String(v) : null;
    }
}
function cssBlock(selector, tokens, only) {
    const lines = [...tokens.values()]
        .filter((t) => !only || only.has(t.path))
        .map((t) => [t, cssValue(t)])
        .filter(([, value]) => value !== null)
        .map(([t, value]) => "  --".concat(kebab(t.path), ": ", value, ";"));
    return "".concat(selector, " {\n", lines.join("\n"), "\n}\n");
}
/** Tailwind v4 theme namespaces by token type / top-level group. */
function tailwindName(token) {
    const [group, ...rest] = token.path.split(".");
    const name = kebab(rest.join(".") || group || "");
    if (token.type === "color")
        return "--color-".concat(kebab(token.path.replace(/^colou?r\./, "")));
    if (token.type === "dimension" && /^(space|spacing)$/.test(group ?? ""))
        return "--spacing-".concat(name);
    if (token.type === "dimension" && /^radius|radii$/.test(group ?? ""))
        return "--radius-".concat(name);
    if (token.type === "fontFamily")
        return "--font-".concat(name);
    if (token.type === "cubicBezier")
        return "--ease-".concat(name);
    if (token.type === "shadow")
        return "--shadow-".concat(name);
    return null;
}
function nest(tokens, only) {
    const out = {};
    for (const token of tokens.values()) {
        if (only && !only.has(token.path))
            continue;
        const parts = token.path.split(".");
        let node = out;
        parts.slice(0, -1).forEach((part) => {
            node = (node[part] ??= {});
        });
        node[parts[parts.length - 1] ?? token.path] = token.value;
    }
    return out;
}
export function buildDesign(root, outDir = join(root, "design", "dist")) {
    const set = loadTokens(root);
    if (set.errors.length)
        return { tokens: set.base.size, themes: Object.keys(set.themes), files: [], errors: set.errors, warnings: set.warnings };
    mkdirSync(outDir, { recursive: true });
    const header = "/* Generated by forge from design/tokens — do not edit. Run `forge design build`. */\n";
    const changedIn = (theme) => {
        const themed = set.themes[theme] ?? new Map();
        return new Set([...themed.values()].filter((t) => JSON.stringify(t.value) !== JSON.stringify(set.base.get(t.path)?.value)).map((t) => t.path));
    };
    let css = "".concat(header, cssBlock(":root", set.base));
    for (const theme of Object.keys(set.themes)) {
        const changed = changedIn(theme);
        css += "\n".concat(cssBlock("[data-theme=\"".concat(theme, "\"]"), set.themes[theme] ?? new Map(), changed));
        if (theme === "dark") {
            css += "\n@media (prefers-color-scheme: dark) {\n".concat(cssBlock(':root:not([data-theme="light"])', set.themes.dark ?? new Map(), changed)
                .split("\n")
                .map((line) => (line ? "  ".concat(line) : line))
                .join("\n"), "}\n");
        }
    }
    const tailwind = "".concat(header, "@theme {\n", [...set.base.values()]
        .map((t) => [tailwindName(t), cssValue(t)])
        .filter(([name, value]) => name && value !== null)
        .map(([name, value]) => "  ".concat(name, ": ", value, ";"))
        .join("\n"), "\n}\n");
    const ts = "// Generated by forge from design/tokens — do not edit. Run `forge design build`.\nexport const tokens = ".concat(JSON.stringify(nest(set.base), null, 2), " as const;\n\nexport const themes = ", JSON.stringify(Object.fromEntries(Object.keys(set.themes).map((theme) => [theme, nest(set.themes[theme] ?? new Map(), changedIn(theme))])), null, 2), " as const;\n\nexport type Tokens = typeof tokens;\n");
    const json = JSON.stringify({
        base: Object.fromEntries([...set.base.values()].map((t) => [t.path, t.value])),
        themes: Object.fromEntries(Object.entries(set.themes).map(([theme, map]) => [theme, Object.fromEntries([...map.values()].map((t) => [t.path, t.value]))])),
    }, null, 2);
    const nativeThemes = Object.fromEntries(Object.keys(set.themes).map((theme) => {
        const changed = changedIn(theme);
        return [theme, new Map([...(set.themes[theme] ?? new Map()).entries()].filter(([path]) => changed.has(path)))];
    }));
    const native = exportNative(set.base, nativeThemes);
    const written = [];
    for (const [name, content] of [
        ["tokens.css", css],
        ["tailwind.css", tailwind],
        ["theme.ts", ts],
        ["tokens.json", "".concat(json, "\n")],
        ["tokens.dart", native.dart],
        ["ForgeTokens.swift", native.swift],
        ["ForgeTokens.kt", native.kotlin],
    ]) {
        writeFileSync(join(outDir, name), content);
        written.push("design/dist/".concat(name));
    }
    return { tokens: set.base.size, themes: Object.keys(set.themes), files: written, errors: [], warnings: set.warnings };
}
