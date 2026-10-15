import type { Token } from "./tokens.js";

/**
 * Native token exporters: Flutter (Dart), SwiftUI (Swift) and Jetpack Compose
 * (Kotlin), generated from the same resolved DTCG tokens as the web outputs.
 * Values that a platform cannot express (e.g. oklch colours) are skipped with a
 * comment rather than approximated.
 */

const camel = (path: string) =>
  path
    .split(/[.\-_\s]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("")
    .replace(/^(\d)/, "t$1");
const pascal = (path: string) => {
  const c = camel(path);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

function rgba(value: unknown): [number, number, number, number] | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) : 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 255 : Math.round(Number(rgb[4]) * 255)];
  return null;
}

const argbHex = ([r, g, b, a]: [number, number, number, number]) =>
  `0x${[a, r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** px / rem / dp / pt → logical points (1rem = 16). */
function points(value: unknown): number | null {
  if (typeof value === "object" && value !== null && "value" in value && "unit" in value) {
    return points(`${(value as { value: number }).value}${(value as { unit: string }).unit}`);
  }
  const m = /^(-?\d*\.?\d+)(px|rem|em|dp|pt)?$/.exec(String(value).trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
}

function millis(value: unknown): number | null {
  if (typeof value === "object" && value !== null && "value" in value && "unit" in value) {
    return millis(`${(value as { value: number }).value}${(value as { unit: string }).unit}`);
  }
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(String(value).trim());
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : null;
}

const num = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

interface Spring {
  stiffness: number;
  damping: number;
  mass?: number;
}

type Line = (token: Token) => string | null;

function emit(tokens: Map<string, Token>, line: Line): string[] {
  return [...tokens.values()].map((token) => line(token) ?? `  // ${token.path}: ${token.type} not expressible here — skipped`);
}

const dartLine: Line = (t) => {
  const name = camel(t.path);
  switch (t.type) {
    case "color": {
      const c = rgba(t.value);
      return c ? `  static const ${name} = Color(${argbHex(c)});` : null;
    }
    case "dimension": {
      const p = points(t.value);
      return p === null ? null : `  static const double ${name} = ${num(p)};`;
    }
    case "duration": {
      const ms = millis(t.value);
      return ms === null ? null : `  static const ${name} = Duration(milliseconds: ${Math.round(ms)});`;
    }
    case "cubicBezier":
      return `  static const ${name} = Cubic(${(t.value as number[]).map(num).join(", ")});`;
    case "spring": {
      const s = t.value as Spring;
      return `  static const ${name} = SpringDescription(mass: ${num(s.mass ?? 1)}, stiffness: ${num(s.stiffness)}, damping: ${num(s.damping)});`;
    }
    case "number":
    case "fontWeight":
      return typeof t.value === "number" ? `  static const double ${name} = ${num(t.value)};` : null;
    case "fontFamily":
      return `  static const String ${name} = ${JSON.stringify(Array.isArray(t.value) ? t.value[0] : t.value)};`;
    default:
      return null;
  }
};

const swiftLine: Line = (t) => {
  const name = camel(t.path);
  switch (t.type) {
    case "color": {
      const c = rgba(t.value);
      if (!c) return null;
      const [r, g, b, a] = c.map((n) => Math.round((n / 255) * 1000) / 1000);
      return `  static let ${name} = Color(.sRGB, red: ${r}, green: ${g}, blue: ${b}, opacity: ${a})`;
    }
    case "dimension": {
      const p = points(t.value);
      return p === null ? null : `  static let ${name}: CGFloat = ${p}`;
    }
    case "duration": {
      const ms = millis(t.value);
      return ms === null ? null : `  static let ${name}: Double = ${ms / 1000}`;
    }
    case "cubicBezier": {
      const [x1, y1, x2, y2] = t.value as number[];
      return `  static let ${name} = Animation.timingCurve(${x1}, ${y1}, ${x2}, ${y2})`;
    }
    case "spring": {
      const s = t.value as Spring;
      return `  static let ${name} = Animation.interpolatingSpring(mass: ${s.mass ?? 1}, stiffness: ${s.stiffness}, damping: ${s.damping})`;
    }
    case "number":
    case "fontWeight":
      return typeof t.value === "number" ? `  static let ${name}: Double = ${t.value}` : null;
    case "fontFamily":
      return `  static let ${name} = ${JSON.stringify(Array.isArray(t.value) ? t.value[0] : t.value)}`;
    default:
      return null;
  }
};

const kotlinLine: Line = (t) => {
  const name = pascal(t.path);
  switch (t.type) {
    case "color": {
      const c = rgba(t.value);
      return c ? `  val ${name} = Color(${argbHex(c)})` : null;
    }
    case "dimension": {
      const p = points(t.value);
      return p === null ? null : `  val ${name} = ${p}.dp`;
    }
    case "duration": {
      const ms = millis(t.value);
      return ms === null ? null : `  const val ${name}Ms = ${Math.round(ms)}`;
    }
    case "cubicBezier":
      return `  val ${name} = CubicBezierEasing(${(t.value as number[]).map((n) => `${n}f`).join(", ")})`;
    case "spring": {
      const s = t.value as Spring;
      const ratio = Math.round((s.damping / (2 * Math.sqrt(s.stiffness * (s.mass ?? 1)))) * 1000) / 1000;
      return `  val ${name} = spring<Float>(dampingRatio = ${ratio}f, stiffness = ${s.stiffness}f)`;
    }
    case "number":
    case "fontWeight":
      return typeof t.value === "number" ? `  const val ${name} = ${t.value}f` : null;
    case "fontFamily":
      return `  const val ${name} = ${JSON.stringify(Array.isArray(t.value) ? t.value[0] : t.value)}`;
    default:
      return null;
  }
};

const HEADER = "Generated by forge from design/tokens — do not edit. Run `forge design build`.";
const themeName = (theme: string) => pascal(theme);

export function exportNative(base: Map<string, Token>, themes: Record<string, Map<string, Token>>): { dart: string; swift: string; kotlin: string } {
  const themeEntries = Object.entries(themes);
  const dart = [
    `// ${HEADER}`,
    "import 'package:flutter/animation.dart';",
    "import 'package:flutter/painting.dart';",
    "import 'package:flutter/physics.dart';",
    "",
    "class ForgeTokens {",
    "  ForgeTokens._();",
    ...emit(base, dartLine),
    "}",
    ...themeEntries.flatMap(([theme, tokens]) => ["", `/// Overrides for the "${theme}" theme.`, `class ForgeTokens${themeName(theme)} {`, `  ForgeTokens${themeName(theme)}._();`, ...emit(tokens, dartLine), "}"]),
    "",
  ].join("\n");
  const swift = [
    `// ${HEADER}`,
    "import SwiftUI",
    "",
    "enum ForgeTokens {",
    ...emit(base, swiftLine),
    "}",
    ...themeEntries.flatMap(([theme, tokens]) => ["", `/// Overrides for the "${theme}" theme.`, `enum ForgeTokens${themeName(theme)} {`, ...emit(tokens, swiftLine), "}"]),
    "",
  ].join("\n");
  const kotlin = [
    `// ${HEADER}`,
    "package forge.tokens",
    "",
    "import androidx.compose.animation.core.CubicBezierEasing",
    "import androidx.compose.animation.core.spring",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.unit.dp",
    "",
    "object ForgeTokens {",
    ...emit(base, kotlinLine),
    "}",
    ...themeEntries.flatMap(([theme, tokens]) => ["", `/** Overrides for the "${theme}" theme. */`, `object ForgeTokens${themeName(theme)} {`, ...emit(tokens, kotlinLine), "}"]),
    "",
  ].join("\n");
  return { dart, swift, kotlin };
}
