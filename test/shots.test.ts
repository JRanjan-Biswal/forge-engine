import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { loadConfig } from "../src/core/config.js";
import { Forge } from "../src/core/engine.js";
import { BUILTINS } from "../src/core/gates.js";
import { findStage } from "../src/core/stages.js";
import { decodePng, diffRatio, distinctColors } from "../src/design/png.js";
import { buildPrototype } from "../src/design/prototype.js";
import { captureShots, findBrowser, shotProblems, unfilledStates } from "../src/design/shots.js";
import { isolate, screens, tmpProject } from "./helpers.js";

isolate();

// ── A tiny PNG encoder for decoder tests (CRC-32 per the PNG spec) ──────────
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** RGB image; every row written with the given filter type (0 none, 1 sub, 2 up). */
function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number], filter: 0 | 1 | 2 = 0): Buffer {
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(filter);
    for (let x = 0; x < width; x++) {
      const px = pixel(x, y);
      for (let k = 0; k < 3; k++) {
        const value = px[k] ?? 0;
        const left = x > 0 ? (pixel(x - 1, y)[k] ?? 0) : 0;
        const up = y > 0 ? (pixel(x, y - 1)[k] ?? 0) : 0;
        rows.push(filter === 1 ? (value - left) & 0xff : filter === 2 ? (value - up) & 0xff : value);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

describe("PNG analysis", () => {
  it("decodes filtered rows, counts colours and diffs images", () => {
    const gradient = (x: number, y: number): [number, number, number] => [x * 10, y * 20, 128];
    for (const filter of [0, 1, 2] as const) {
      const bitmap = decodePng(encodePng(8, 4, gradient, filter));
      expect(bitmap, `filter ${filter}`).toMatchObject({ width: 8, height: 4, channels: 3 });
      expect(Array.from(bitmap?.data.slice(3 * 9, 3 * 9 + 3) ?? []), `filter ${filter}`).toEqual([10, 20, 128]); // pixel (1,1)
    }
    const flat = decodePng(encodePng(8, 4, () => [255, 255, 255]))!;
    expect(distinctColors(flat)).toBe(1);
    expect(distinctColors(decodePng(encodePng(8, 4, gradient))!)).toBeGreaterThan(1);
    const half = decodePng(encodePng(8, 4, (x) => (x < 4 ? [255, 255, 255] : [0, 0, 0])))!;
    expect(diffRatio(flat, half)).toBe(0.5);
    expect(diffRatio(flat, decodePng(encodePng(4, 4, () => [255, 255, 255]))!)).toBe(1);
    expect(decodePng(Buffer.from("not a png"))).toBeUndefined();
  });
});

describe("prototype states", () => {
  it("refuses to overwrite a prototype and finds states that are still empty", () => {
    const root = tmpProject();
    writeArtifact(root, "screens", screens());
    buildPrototype(root);
    expect(unfilledStates(root)).toHaveLength(8);
    expect(() => buildPrototype(root)).toThrow(/already exists .*--force/);
    const file = join(root, "design/prototype/index.html");
    writeFileSync(file, readFileSync(file, "utf8").replace(/(<div data-state="empty" hidden>\s*<!--[^>]*-->)/, "$1\n    <p>No check-ins yet</p>"));
    expect(unfilledStates(root)).toHaveLength(7);
    expect(unfilledStates(root)).not.toContainEqual({ screen: "checkin", state: "empty" });
    expect(buildPrototype(root, { force: true }).screens).toBe(2);
    expect(unfilledStates(root)).toHaveLength(8);
  });
});

const browser = findBrowser();

describe.skipIf(!browser)("screenshots with a real headless browser", () => {
  /** Fill every prototype state with visible content; `blankState` renders nothing visible. */
  function designedPrototype(root: string, blankState?: string) {
    writeArtifact(root, "screens", screens());
    buildPrototype(root);
    const file = join(root, "design/prototype/index.html");
    const html = readFileSync(file, "utf8").replace(/<div data-state="(\w+)" hidden>(\s*<!--[^>]*-->)/g, (_, state: string, comment: string) =>
      state === blankState
        ? `<div data-state="${state}" hidden>${comment}\n    <span></span>`
        : `<div data-state="${state}" hidden>${comment}\n    <p style="margin:2rem;padding:2rem;background:#1d4ed8;color:#fff;font:24px sans-serif">${state} state</p>`,
    );
    writeFileSync(file, html);
    return file;
  }

  it("shoots every screen × state × viewport, flags blank renders, tracks changes, and gates the critique", async () => {
    const root = tmpProject({ autonomy: "auto" });
    const file = designedPrototype(root, "loading");
    const stage = findStage("design")!;
    const ctx = () => ({ root, config: loadConfig(root), stage, state: new Forge(root).readState() });

    expect(await BUILTINS["design.shotsFresh"]!(ctx())).toMatchObject({ status: "fail", message: expect.stringMatching(/run `forge design shots`/) });

    const first = await captureShots(root, { screens: ["checkin"] });
    expect(first.shots).toHaveLength(12); // 4 states × 3 web viewports
    expect(first.shots.every((s) => !s.error)).toBe(true);
    expect(first.shots.find((s) => s.state === "success" && s.viewport === "mobile")).toMatchObject({ width: 360, height: 800, blank: false, file: "design/shots/checkin--success--mobile.png" });
    expect(first.shots.filter((s) => s.blank).map((s) => s.state)).toEqual(["loading", "loading", "loading"]);
    expect(shotProblems(root).join("\n")).toMatch(/12 shot\(s\) missing: reminders\/empty@mobile[\s\S]*3 blank render\(s\): checkin\/loading@mobile/);

    // Redesign the blank state; the shots go stale until they are taken again.
    const later = Date.now() / 1000 + 5;
    writeFileSync(file, readFileSync(file, "utf8").replace(/<span><\/span>/g, '<p style="margin:2rem;padding:2rem;background:#15803d;color:#fff">loading…</p>'));
    utimesSync(file, later, later);
    expect(shotProblems(root).join("\n")).toMatch(/changed after the last screenshots/);

    const second = await captureShots(root);
    expect(second.shots).toHaveLength(24);
    expect(second.shots.some((s) => s.blank || s.error)).toBe(false);
    const loading = second.shots.find((s) => s.screen === "checkin" && s.state === "loading" && s.viewport === "mobile");
    const success = second.shots.find((s) => s.screen === "checkin" && s.state === "success" && s.viewport === "mobile");
    expect(loading?.changedRatio).toBeGreaterThan(0.01);
    expect(success?.changedRatio).toBe(0);
    // The prototype was touched "in the future" above; date the manifest after it so only the critique remains.
    const manifestFile = join(root, "design/shots/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { generatedAt: string };
    manifest.generatedAt = new Date((later + 1) * 1000).toISOString();
    writeFileSync(manifestFile, JSON.stringify(manifest));
    expect(shotProblems(root)).toEqual([]);

    // A critique written before the shots is stale; one written after passes.
    mkdirSync(join(root, ".forge/gates"), { recursive: true });
    const rubric = join(root, ".forge/gates/design.rubric.json");
    writeFileSync(rubric, JSON.stringify({ criteria: [{ id: "R-1", question: "q", pass: true }] }));
    utimesSync(rubric, later, later);
    expect(shotProblems(root)).toEqual(["the design critique predates the latest screenshots — the design-critic must re-score them"]);
    utimesSync(rubric, later + 2, later + 2);
    expect(await BUILTINS["design.shotsFresh"]!(ctx())).toMatchObject({ status: "pass" });

    const leftovers = spawnSync("pgrep", ["-f", join(root, ".forge", "browser-profile")], { encoding: "utf8" }).stdout.trim();
    expect(leftovers).toBe("");
  }, 120_000);

  it("shoots a running app's routes, and the gate check can be switched off", async () => {
    const root = tmpProject();
    writeArtifact(root, "screens", {
      screens: [
        { id: "home", storyIds: ["S-1"], route: "/", platform: "web", states: ["empty", "loading", "error", "success"] },
        { id: "post", storyIds: ["S-1"], route: "/posts/[id]", platform: "web", states: ["empty", "loading", "error", "success"] },
      ],
    });
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<body style="margin:0"><h1 style="background:#7c3aed;color:#fff;padding:3rem">live app</h1></body>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const manifest = await captureShots(root, { url, viewports: ["desktop"] });
      expect(manifest).toMatchObject({ source: "url", url, skipped: [expect.stringMatching(/post: route \/posts\/\[id\] has parameters/)] });
      expect(manifest.shots).toEqual([expect.objectContaining({ screen: "home", state: "rendered", viewport: "desktop", blank: false, width: 1280 })]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const stage = findStage("design")!;
    writeFileSync(join(root, "forge.config.yaml"), readFileSync(join(root, "forge.config.yaml"), "utf8").replace("screenshots: true", "screenshots: false"));
    expect(await BUILTINS["design.shotsFresh"]!({ root, config: loadConfig(root), stage, state: new Forge(root).readState() })).toMatchObject({ status: "skip" });
  }, 60_000);
});
