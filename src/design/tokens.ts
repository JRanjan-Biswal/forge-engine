import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportNative } from "./native.js";

/**
 * Design-token pipeline (W3C DTCG): load design/tokens/*.tokens.json, apply theme
 * overrides (*.<theme>.tokens.json, e.g. semantic.dark.tokens.json), resolve
 * {alias.references}, validate types, and export CSS custom properties, a Tailwind
 * v4 @theme block, a typed TS theme and flat JSON — one source for every platform.
 */

export interface Token {
  path: string;
  type: string;
  value: unknown;
  description?: string;
  file: string;
}

export interface TokenSet {
  /** Resolved base tokens. */
  base: Map<string, Token>;
  /** Resolved full token set per theme (base + overrides). */
  themes: Record<string, Map<string, Token>>;
  errors: string[];
  warnings: string[];
  files: string[];
}

const TOKEN_FILE = /^(.+?)(?:\.([a-z0-9-]+))?\.tokens\.json$/;
const ALIAS = /^\{([^{}]+)\}$/;

export function tokensDir(root: string): string {
  return join(root, "design", "tokens");
}

function flatten(node: unknown, path: string[], inheritedType: string | undefined, file: string, out: Map<string, Token>, errors: string[]): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  const type = typeof record.$type === "string" ? record.$type : inheritedType;
  if ("$value" in record) {
    const tokenPath = path.join(".");
    if (!type) errors.push(`${file}: ${tokenPath} has no $type (set it on the token or a parent group)`);
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
    if (!key.startsWith("$")) flatten(child, [...path, key], type, file, out, errors);
  }
}

function resolveValue(value: unknown, tokens: Map<string, Token>, stack: string[], errors: string[], at: string): unknown {
  if (typeof value === "string") {
    const alias = ALIAS.exec(value);
    if (!alias?.[1]) return value;
    const target = alias[1];
    if (stack.includes(target)) {
      errors.push(`alias cycle: ${[...stack, target].join(" → ")}`);
      return value;
    }
    const token = tokens.get(target);
    if (!token) {
      errors.push(`${at}: {${target}} does not resolve to a token`);
      return value;
    }
    return resolveValue(token.value, tokens, [...stack, target], errors, at);
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, tokens, stack, errors, at));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, tokens, stack, errors, at)]));
  }
  return value;
}

const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla|oklch|oklab|color)\(.+\)|transparent|currentColor)$/i;
const LENGTH = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|dp|pt)$|^0$/;
const TIME = /^\d*\.?\d+(ms|s)$/;

function validate(token: Token, value: unknown): string | null {
  const unitValue = (v: unknown, units: RegExp) =>
    (typeof v === "string" && units.test(v)) ||
    (typeof v === "object" && v !== null && typeof (v as { value?: unknown }).value === "number" && typeof (v as { unit?: unknown }).unit === "string");
  switch (token.type) {
    case "color":
      return typeof value === "string" && COLOR.test(value.trim()) ? null : `color expected, got ${JSON.stringify(value)}`;
    case "dimension":
      return unitValue(value, LENGTH) ? null : `dimension expected (e.g. "16px" or {value, unit}), got ${JSON.stringify(value)}`;
    case "duration":
      return unitValue(value, TIME) ? null : `duration expected (e.g. "200ms"), got ${JSON.stringify(value)}`;
    case "cubicBezier":
      return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number") ? null : "cubicBezier expects [x1, y1, x2, y2]";
    case "number":
    case "fontWeight":
      return typeof value === "number" || typeof value === "string" ? null : `${token.type} expected`;
    case "fontFamily":
      return typeof value === "string" || (Array.isArray(value) && value.every((f) => typeof f === "string")) ? null : "fontFamily expects a string or string[]";
    case "spring": {
      const spring = value as { stiffness?: unknown; damping?: unknown };
      return typeof spring?.stiffness === "number" && typeof spring?.damping === "number" ? null : "spring expects {stiffness, damping, mass?}";
    }
    default:
      return null; // shadow, typography, border, gradient… passed through
  }
}

function resolveAll(raw: Map<string, Token>, errors: string[]): Map<string, Token> {
  const resolved = new Map<string, Token>();
  for (const token of raw.values()) {
    const value = resolveValue(token.value, raw, [token.path], errors, token.path);
    const problem = validate(token, value);
    if (problem) errors.push(`${token.file}: ${token.path} — ${problem}`);
    resolved.set(token.path, { ...token, value });
  }
  return resolved;
}

export function loadTokens(root: string): TokenSet {
  const dir = tokensDir(root);
  const errors: string[] = [];
  const warnings: string[] = [];
  const base = new Map<string, Token>();
  const overrides: Record<string, Map<string, Token>> = {};
  const files: string[] = [];
  if (!existsSync(dir)) return { base, themes: {}, errors: ["design/tokens/ does not exist"], warnings, files };

  for (const name of readdirSync(dir).filter((n) => TOKEN_FILE.test(n)).sort()) {
    files.push(name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (error) {
      errors.push(`${name}: invalid JSON (${(error as Error).message})`);
      continue;
    }
    const theme = TOKEN_FILE.exec(name)?.[2];
    const target = theme ? (overrides[theme] ??= new Map()) : base;
    flatten(parsed, [], undefined, name, target, errors);
  }
  if (!files.length) errors.push("design/tokens/ has no *.tokens.json files");

  for (const [theme, map] of Object.entries(overrides)) {
    for (const path of map.keys()) if (!base.has(path)) warnings.push(`theme "${theme}" defines ${path}, which has no base token`);
  }
  const resolvedBase = resolveAll(base, errors);
  const themes: Record<string, Map<string, Token>> = {};
  for (const [theme, map] of Object.entries(overrides)) {
    themes[theme] = resolveAll(new Map([...base, ...map]), errors);
  }
  if (![...resolvedBase.values()].some((t) => t.type === "color")) errors.push("no color tokens defined");
  return { base: resolvedBase, themes, errors: [...new Set(errors)], warnings, files };
}

// ── Export ───────────────────────────────────────────────────────────────────

const kebab = (path: string) =>
  path
    .split(".")
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase())
    .join("-");

function cssValue(token: Token): string | null {
  const v = token.value as unknown;
  if (typeof v === "object" && v !== null && "value" in v && "unit" in v) return `${(v as { value: number }).value}${(v as { unit: string }).unit}`;
  switch (token.type) {
    case "cubicBezier":
      return `cubic-bezier(${(v as number[]).join(", ")})`;
    case "fontFamily":
      return (Array.isArray(v) ? v : [v]).map((f) => (/\s/.test(String(f)) ? `"${f}"` : String(f))).join(", ");
    case "spring":
      return null; // no CSS equivalent — exported to theme.ts for Motion/Reanimated/SwiftUI
    default:
      return typeof v === "string" || typeof v === "number" ? String(v) : null;
  }
}

function cssBlock(selector: string, tokens: Map<string, Token>, only?: Set<string>): string {
  const lines = [...tokens.values()]
    .filter((t) => !only || only.has(t.path))
    .map((t) => [t, cssValue(t)] as const)
    .filter(([, value]) => value !== null)
    .map(([t, value]) => `  --${kebab(t.path)}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

/** Tailwind v4 theme namespaces by token type / top-level group. */
function tailwindName(token: Token): string | null {
  const [group, ...rest] = token.path.split(".");
  const name = kebab(rest.join(".") || group || "");
  if (token.type === "color") return `--color-${kebab(token.path.replace(/^colou?r\./, ""))}`;
  if (token.type === "dimension" && /^(space|spacing)$/.test(group ?? "")) return `--spacing-${name}`;
  if (token.type === "dimension" && /^radius|radii$/.test(group ?? "")) return `--radius-${name}`;
  if (token.type === "fontFamily") return `--font-${name}`;
  if (token.type === "cubicBezier") return `--ease-${name}`;
  if (token.type === "shadow") return `--shadow-${name}`;
  return null;
}

function nest(tokens: Map<string, Token>, only?: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const token of tokens.values()) {
    if (only && !only.has(token.path)) continue;
    const parts = token.path.split(".");
    let node = out;
    parts.slice(0, -1).forEach((part) => {
      node = (node[part] ??= {}) as Record<string, unknown>;
    });
    node[parts[parts.length - 1] ?? token.path] = token.value;
  }
  return out;
}

export interface BuildResult {
  tokens: number;
  themes: string[];
  files: string[];
  errors: string[];
  warnings: string[];
}

export function buildDesign(root: string, outDir = join(root, "design", "dist")): BuildResult {
  const set = loadTokens(root);
  if (set.errors.length) return { tokens: set.base.size, themes: Object.keys(set.themes), files: [], errors: set.errors, warnings: set.warnings };
  mkdirSync(outDir, { recursive: true });
  const header = "/* Generated by forge from design/tokens — do not edit. Run `forge design build`. */\n";
  const changedIn = (theme: string) => {
    const themed = set.themes[theme] ?? new Map();
    return new Set([...themed.values()].filter((t) => JSON.stringify(t.value) !== JSON.stringify(set.base.get(t.path)?.value)).map((t) => t.path));
  };

  let css = `${header}${cssBlock(":root", set.base)}`;
  for (const theme of Object.keys(set.themes)) {
    const changed = changedIn(theme);
    css += `\n${cssBlock(`[data-theme="${theme}"]`, set.themes[theme] ?? new Map(), changed)}`;
    if (theme === "dark") {
      css += `\n@media (prefers-color-scheme: dark) {\n${cssBlock(':root:not([data-theme="light"])', set.themes.dark ?? new Map(), changed)
        .split("\n")
        .map((line) => (line ? `  ${line}` : line))
        .join("\n")}}\n`;
    }
  }
  const tailwind = `${header}@theme {\n${[...set.base.values()]
    .map((t) => [tailwindName(t), cssValue(t)] as const)
    .filter(([name, value]) => name && value !== null)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n")}\n}\n`;
  const ts = `// Generated by forge from design/tokens — do not edit. Run \`forge design build\`.\nexport const tokens = ${JSON.stringify(nest(set.base), null, 2)} as const;\n\nexport const themes = ${JSON.stringify(
    Object.fromEntries(Object.keys(set.themes).map((theme) => [theme, nest(set.themes[theme] ?? new Map(), changedIn(theme))])),
    null,
    2,
  )} as const;\n\nexport type Tokens = typeof tokens;\n`;
  const json = JSON.stringify(
    {
      base: Object.fromEntries([...set.base.values()].map((t) => [t.path, t.value])),
      themes: Object.fromEntries(Object.entries(set.themes).map(([theme, map]) => [theme, Object.fromEntries([...map.values()].map((t) => [t.path, t.value]))])),
    },
    null,
    2,
  );

  const nativeThemes = Object.fromEntries(
    Object.keys(set.themes).map((theme) => {
      const changed = changedIn(theme);
      return [theme, new Map([...(set.themes[theme] ?? new Map()).entries()].filter(([path]) => changed.has(path)))];
    }),
  );
  const native = exportNative(set.base, nativeThemes);
  const written: string[] = [];
  for (const [name, content] of [
    ["tokens.css", css],
    ["tailwind.css", tailwind],
    ["theme.ts", ts],
    ["tokens.json", `${json}\n`],
    ["tokens.dart", native.dart],
    ["ForgeTokens.swift", native.swift],
    ["ForgeTokens.kt", native.kotlin],
  ] as const) {
    writeFileSync(join(outDir, name), content);
    written.push(`design/dist/${name}`);
  }
  return { tokens: set.base.size, themes: Object.keys(set.themes), files: written, errors: [], warnings: set.warnings };
}
