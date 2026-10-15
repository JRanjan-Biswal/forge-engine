import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { loadTokens, type Token } from "./tokens.js";

/**
 * Design audits: WCAG contrast for declared foreground/background token pairs in
 * every theme, and drift — hard-coded colours in product code that should come
 * from tokens.
 */

// ── Contrast ─────────────────────────────────────────────────────────────────

function parseColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m?.[1]) {
    const hex = m[1].length <= 4 ? [...m[1].slice(0, 3)].map((c) => c + c).join("") : m[1].slice(0, 6);
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(v);
  if (m) {
    const [h, s, l] = [Number(m[1]) / 360, Number(m[2]) / 100, Number(m[3]) / 100];
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  }
  return null; // oklch/oklab/color() — not checked (reported, not guessed)
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export interface ContrastResult {
  theme: string;
  fg: string;
  bg: string;
  ratio: number | null;
  min: number;
  pass: boolean;
  note?: string;
}

export interface ContrastReport {
  declared: boolean;
  results: ContrastResult[];
  errors: string[];
}

/** Check every pair in design/contrast.json in the base theme and every override theme. */
export function auditContrast(root: string): ContrastReport {
  const file = join(root, "design", "contrast.json");
  if (!existsSync(file)) return { declared: false, results: [], errors: ["design/contrast.json is missing — declare the text/background pairs to check"] };
  let pairs: { fg: string; bg: string; min?: number }[];
  try {
    pairs = (JSON.parse(readFileSync(file, "utf8")) as { pairs?: { fg: string; bg: string; min?: number }[] }).pairs ?? [];
  } catch (error) {
    return { declared: false, results: [], errors: [`design/contrast.json is invalid: ${(error as Error).message}`] };
  }
  if (!pairs.length) return { declared: false, results: [], errors: ["design/contrast.json declares no pairs"] };
  const set = loadTokens(root);
  const themes: [string, Map<string, Token>][] = [["base", set.base], ...Object.entries(set.themes)];
  const results: ContrastResult[] = [];
  const errors: string[] = [];
  for (const pair of pairs) {
    for (const [theme, tokens] of themes) {
      const fg = tokens.get(pair.fg);
      const bg = tokens.get(pair.bg);
      const min = pair.min ?? 4.5;
      if (!fg || !bg) {
        errors.push(`${theme}: ${!fg ? pair.fg : pair.bg} is not a token`);
        continue;
      }
      const ratio = contrastRatio(String(fg.value), String(bg.value));
      results.push(
        ratio === null
          ? { theme, fg: pair.fg, bg: pair.bg, ratio, min, pass: false, note: "colour format not checkable (use hex, rgb or hsl)" }
          : { theme, fg: pair.fg, bg: pair.bg, ratio, min, pass: ratio >= min },
      );
    }
  }
  return { declared: true, results, errors };
}

// ── Drift: hard-coded colours in product code ───────────────────────────────

const STYLE_FILES = new Set([".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".css", ".scss", ".sass", ".less", ".html"]);
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", "design", ".forge", "graphify-out", "__tests__", "test", "tests", "e2e", "fixtures"]);
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;

export interface DriftHit {
  file: string;
  line: number;
  value: string;
  /** A token with exactly this value, if one exists. */
  suggest?: string;
}

export function auditDrift(root: string, dirs: string[], limit = 100): DriftHit[] {
  const tokens = loadTokens(root);
  // Suggest semantic tokens over primitives: code should say "accent", not "indigo-500".
  const byValue = new Map<string, Token>();
  for (const token of tokens.base.values()) {
    if (token.type !== "color" || typeof token.value !== "string") continue;
    const key = token.value.toLowerCase();
    const current = byValue.get(key);
    if (!current || (/semantic/i.test(token.file) && !/semantic/i.test(current.file))) byValue.set(key, token);
  }
  const hits: DriftHit[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (hits.length >= limit) return;
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP.has(name) && !name.startsWith(".")) walk(full);
        continue;
      }
      if (!STYLE_FILES.has(extname(name)) || /\.(test|spec|stories)\./.test(name) || stat.size > 1_000_000) continue;
      readFileSync(full, "utf8")
        .split("\n")
        .forEach((text, index) => {
          if (/^\s*(\/\/|\*|\/\*|#!)/.test(text)) return; // comments
          for (const match of text.matchAll(HEX)) {
            if (hits.length >= limit) return;
            const value = match[0].toLowerCase();
            hits.push({ file: relative(root, full), line: index + 1, value, suggest: byValue.get(value)?.path });
          }
        });
    }
  };
  for (const dir of dirs) {
    const full = join(root, dir);
    if (existsSync(full) && statSync(full).isDirectory()) walk(full);
  }
  return hits;
}
