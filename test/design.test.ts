import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditContrast, auditDrift, contrastRatio } from "../src/design/audit.js";
import { buildDesign, loadTokens } from "../src/design/tokens.js";
import { isolate, tempDir } from "./helpers.js";

isolate();

function project(files: Record<string, unknown>): string {
  const root = tempDir();
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

const TOKENS = {
  "design/tokens/primitive.tokens.json": {
    color: { $type: "color", indigo: { 500: { $value: "#5B5BD6" } }, white: { $value: "#FFFFFF" }, ink: { $value: "#1A1A2E" }, grey: { $value: "#777777" } },
    space: { $type: "dimension", 4: { $value: "16px" } },
    easing: { standard: { $type: "cubicBezier", $value: [0.2, 0, 0, 1] } },
    spring: { snappy: { $type: "spring", $value: { stiffness: 400, damping: 30 } } },
    font: { body: { $type: "fontFamily", $value: ["Inter", "Helvetica Neue", "sans-serif"] } },
  },
  "design/tokens/semantic.tokens.json": {
    color: {
      $type: "color",
      accent: { default: { $value: "{color.indigo.500}" } },
      text: { default: { $value: "{color.ink}" } },
      bg: { default: { $value: "{color.white}" } },
    },
  },
  "design/tokens/semantic.dark.tokens.json": {
    color: { $type: "color", text: { default: { $value: "{color.white}" } }, bg: { default: { $value: "{color.ink}" } } },
  },
  "design/contrast.json": { pairs: [{ fg: "color.text.default", bg: "color.bg.default" }] },
};

describe("design tokens", () => {
  it("resolves aliases and theme overrides", () => {
    const set = loadTokens(project(TOKENS));
    expect(set.errors).toEqual([]);
    expect(set.base.get("color.accent.default")?.value).toBe("#5B5BD6");
    expect(set.themes.dark?.get("color.bg.default")?.value).toBe("#1A1A2E");
    expect(set.themes.dark?.get("color.accent.default")?.value).toBe("#5B5BD6"); // inherited from base
  });

  it("reports unresolved aliases, cycles, invalid values and missing types", () => {
    const set = loadTokens(
      project({
        "design/tokens/bad.tokens.json": {
          color: { $type: "color", a: { $value: "{color.missing}" }, b: { $value: "{color.c}" }, c: { $value: "{color.b}" }, d: { $value: "blue-ish" } },
          orphan: { $value: "12px" },
        },
      }),
    );
    expect(set.errors.join("\n")).toMatch(/\{color\.missing\} does not resolve/);
    expect(set.errors.join("\n")).toMatch(/alias cycle/);
    expect(set.errors.join("\n")).toMatch(/color\.d — color expected/);
    expect(set.errors.join("\n")).toMatch(/orphan has no \$type/);
  });

  it("builds CSS (themes + prefers-color-scheme), Tailwind v4 @theme, typed TS and JSON", () => {
    const root = project(TOKENS);
    const result = buildDesign(root);
    expect(result.errors).toEqual([]);
    const css = readFileSync(join(root, "design/dist/tokens.css"), "utf8");
    expect(css).toContain("--color-accent-default: #5B5BD6;");
    expect(css).toContain("--easing-standard: cubic-bezier(0.2, 0, 0, 1);");
    expect(css).toContain('--font-body: Inter, "Helvetica Neue", sans-serif;');
    expect(css).toMatch(/\[data-theme="dark"\] \{\n {2}--color-text-default: #FFFFFF;\n {2}--color-bg-default: #1A1A2E;\n\}/);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).not.toContain("spring"); // no CSS equivalent
    const tailwind = readFileSync(join(root, "design/dist/tailwind.css"), "utf8");
    expect(tailwind).toContain("--color-accent-default: #5B5BD6;");
    expect(tailwind).toContain("--spacing-4: 16px;");
    expect(tailwind).toContain("--ease-standard: cubic-bezier(0.2, 0, 0, 1);");
    const ts = readFileSync(join(root, "design/dist/theme.ts"), "utf8");
    expect(ts).toContain('"stiffness": 400');
    expect(ts).toContain("export const themes");
  });

  it("exports Flutter, SwiftUI and Compose tokens with dark overrides", () => {
    const root = project(TOKENS);
    buildDesign(root);
    const dart = readFileSync(join(root, "design/dist/tokens.dart"), "utf8");
    expect(dart).toContain("static const colorAccentDefault = Color(0xFF5B5BD6);");
    expect(dart).toContain("static const double space4 = 16.0;");
    expect(dart).toContain("static const springSnappy = SpringDescription(mass: 1.0, stiffness: 400.0, damping: 30.0);");
    expect(dart).toMatch(/class ForgeTokensDark \{[\s\S]*colorTextDefault = Color\(0xFFFFFFFF\)/);
    const swift = readFileSync(join(root, "design/dist/ForgeTokens.swift"), "utf8");
    expect(swift).toContain("static let easingStandard = Animation.timingCurve(0.2, 0, 0, 1)");
    expect(swift).toContain("static let space4: CGFloat = 16");
    const kotlin = readFileSync(join(root, "design/dist/ForgeTokens.kt"), "utf8");
    expect(kotlin).toContain("val ColorAccentDefault = Color(0xFF5B5BD6)");
    expect(kotlin).toContain("val SpringSnappy = spring<Float>(dampingRatio = 0.75f, stiffness = 400f)");
    expect(kotlin).toContain("val Space4 = 16.dp");
  });

  it("scaffolds a prototype with every screen × state on the tokens", async () => {
    const root = project(TOKENS);
    const { Forge } = await import("../src/core/engine.js");
    Forge.init(root, { name: "proto" });
    const { writeArtifact } = await import("../src/core/artifacts.js");
    writeArtifact(root, "screens", { screens: [{ id: "checkin", storyIds: ["S-1"], route: "/checkin", platform: "web", states: ["empty", "loading", "error", "success"] }] });
    buildDesign(root);
    const { buildPrototype } = await import("../src/design/prototype.js");
    expect(buildPrototype(root)).toEqual({ path: "design/prototype/index.html", screens: 1 });
    const html = readFileSync(join(root, "design/prototype/index.html"), "utf8");
    expect(html).toContain('href="../dist/tokens.css"');
    expect(html.match(/data-state="(empty|loading|error|success)"/g)).toHaveLength(4);
  });

  it("refuses to build invalid tokens", () => {
    const result = buildDesign(project({ "design/tokens/x.tokens.json": { color: { $type: "color", a: { $value: "{nope}" } } } }));
    expect(result.files).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("design audits", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeLessThan(4.5);
    expect(contrastRatio("rgb(0, 0, 0)", "hsl(0, 0%, 100%)")).toBe(21);
    expect(contrastRatio("oklch(0.5 0.1 200)", "#fff")).toBeNull();
  });

  it("checks declared pairs in every theme", () => {
    const report = auditContrast(project(TOKENS));
    expect(report.results.map((r) => [r.theme, r.pass])).toEqual([
      ["base", true],
      ["dark", true],
    ]);
    const weak = auditContrast(project({ ...TOKENS, "design/contrast.json": { pairs: [{ fg: "color.grey", bg: "color.white" }] } }));
    expect(weak.results.filter((r) => !r.pass)).toHaveLength(2);
    const { "design/contrast.json": _pairs, ...withoutPairs } = TOKENS;
    expect(auditContrast(project(withoutPairs)).declared).toBe(false);
  });

  it("finds hard-coded colours in product code and suggests the matching token", () => {
    const root = project({
      ...TOKENS,
      "src/Button.tsx": "export const Button = () => <button style={{ color: '#5B5BD6', background: '#123456' }} />;\n// docs: #FFFFFF in a comment is fine",
      "src/Button.test.tsx": "expect(color).toBe('#5B5BD6')",
    });
    const hits = auditDrift(root, ["src"]);
    expect(hits).toEqual([
      { file: "src/Button.tsx", line: 1, value: "#5b5bd6", suggest: "color.accent.default" },
      { file: "src/Button.tsx", line: 1, value: "#123456", suggest: undefined },
    ]);
  });
});
