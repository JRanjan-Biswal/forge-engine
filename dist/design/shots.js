import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { onPath } from "../build/stacks.js";
import { loadArtifact } from "../core/artifacts.js";
import { loadConfig } from "../core/config.js";
import { layout, nowIso } from "../core/paths.js";
import { runCommand, withCommandSlot } from "../core/proc.js";
import { decodePng, diffRatio, distinctColors } from "./png.js";
/**
 * Screenshots for the design critique loop: every screen × state × viewport of the
 * prototype (or the running app's routes), taken with a local Chromium-family
 * browser in headless mode — one short-lived process per shot, sequential, holding
 * the project's command slot. The manifest records what was rendered when, so the
 * design gate can require fresh shots and a critique newer than them.
 */
export const STATES = ["empty", "loading", "error", "success"];
export const VIEWPORTS = {
    mobile: { width: 360, height: 800 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1280, height: 800 },
    phone: { width: 390, height: 844 },
};
const SHOTS_DIR = "design/shots";
export const MANIFEST = `${SHOTS_DIR}/manifest.json`;
const PROTOTYPE = join("design", "prototype", "index.html");
/** Viewports a screen is judged at, by platform. */
export function viewportsFor(platform) {
    if (platform === "ios" || platform === "android")
        return ["phone"];
    if (platform === "desktop")
        return ["desktop"];
    if (platform === "api")
        return [];
    return ["mobile", "tablet", "desktop"];
}
/** FORGE_BROWSER, Playwright's headless shell, then installed Chrome, Chromium, Edge or Brave. */
export function findBrowser() {
    const fromEnv = process.env.FORGE_BROWSER;
    if (fromEnv)
        return existsSync(fromEnv) || onPath(fromEnv) ? fromEnv : undefined;
    const caches = [
        process.env.PLAYWRIGHT_BROWSERS_PATH,
        join(homedir(), "Library", "Caches", "ms-playwright"),
        join(homedir(), ".cache", "ms-playwright"),
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : undefined,
    ].filter((dir) => Boolean(dir && existsSync(dir)));
    for (const cache of caches) {
        const shells = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
        for (const dir of shells) {
            for (const sub of readdirSync(join(cache, dir))) {
                for (const name of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
                    const bin = join(cache, dir, sub, name);
                    if (existsSync(bin))
                        return bin;
                }
            }
        }
    }
    const apps = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    const app = apps.find((path) => existsSync(path));
    if (app)
        return app;
    return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"].find((bin) => onPath(bin));
}
export const BROWSER_HINT = "No Chromium-family browser found — install one (`npx playwright install chromium-headless-shell`, or Chrome) or set FORGE_BROWSER to its executable";
const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
/** Prototype states whose container still holds nothing but forge's placeholder comment. */
export function unfilledStates(root) {
    const file = join(root, PROTOTYPE);
    if (!existsSync(file))
        return [];
    const html = readFileSync(file, "utf8");
    const found = [];
    for (const section of html.split(/<section\b[^>]*data-screen="/).slice(1)) {
        const screen = section.slice(0, section.indexOf('"'));
        const body = section.split(/<\/section>/)[0] ?? "";
        for (const part of body.split(/<div\b[^>]*data-state="/).slice(1)) {
            const state = part.slice(0, part.indexOf('"'));
            const content = part
                .slice(part.indexOf(">") + 1)
                .replace(/<!--[\s\S]*?-->/g, "")
                .replace(/<\/div>/g, "")
                .trim();
            if (!content)
                found.push({ screen, state });
        }
    }
    return found;
}
export async function captureShots(root, options = {}) {
    const browser = findBrowser();
    if (!browser)
        throw new Error(BROWSER_HINT);
    const screens = loadArtifact(root, "screens");
    if (!screens)
        throw new Error("No screens artifact yet — write design/screens.json first");
    const source = options.url ? "url" : "prototype";
    const prototype = join(root, PROTOTYPE);
    if (source === "prototype" && !existsSync(prototype))
        throw new Error("No prototype yet — run `forge design prototype`, then design every state");
    const dir = join(root, SHOTS_DIR);
    mkdirSync(dir, { recursive: true });
    const previous = readManifest(root);
    const profile = join(layout(root).forge, "browser-profile");
    const config = loadConfig(root);
    const timeoutMs = options.timeoutMs ?? 30_000;
    const shots = [];
    const skipped = [];
    const jobs = [];
    for (const screen of screens.screens.filter((s) => !options.screens?.length || options.screens.includes(s.id))) {
        const allowed = viewportsFor(screen.platform);
        const viewports = options.viewports && allowed.length ? options.viewports : allowed;
        if (!viewports.length) {
            skipped.push(`${screen.id}: no visual viewport for platform ${screen.platform}`);
            continue;
        }
        if (source === "url" && /[[\]:*]/.test(screen.route)) {
            skipped.push(`${screen.id}: route ${screen.route} has parameters — screenshot it from the prototype or a concrete URL`);
            continue;
        }
        const states = source === "url" ? ["rendered"] : screen.stateless ? ["success"] : [...STATES];
        for (const state of states) {
            for (const viewport of viewports) {
                const url = source === "url"
                    ? new URL(screen.route, options.url).href
                    : `${pathToFileURL(prototype).href}?screen=${encodeURIComponent(screen.id)}&state=${state}&chrome=0`;
                jobs.push({ screen: screen.id, state, viewport, url });
            }
        }
    }
    await withCommandSlot(root, { max: config.resources.maxConcurrentCommands, waitMs: config.resources.commandWaitMs, task: "forge design shots", onWait: options.onWait }, async () => {
        try {
            for (const job of jobs) {
                const name = `${job.screen}--${job.state}--${job.viewport}.png`.replace(/[^\w.-]/g, "_");
                const file = join(dir, name);
                const rel = `${SHOTS_DIR}/${name}`;
                const before = existsSync(file) ? readFileSync(file) : undefined;
                rmSync(file, { force: true });
                const { width, height } = VIEWPORTS[job.viewport];
                const args = [
                    "--headless",
                    "--disable-gpu",
                    "--hide-scrollbars",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-extensions",
                    "--mute-audio",
                    `--user-data-dir=${profile}`,
                    `--window-size=${width},${height}`,
                    "--virtual-time-budget=2500",
                    `--screenshot=${file}`,
                    job.url,
                ];
                const result = await runCommand(`${quote(browser)} ${args.map(quote).join(" ")}`, root, { timeoutMs });
                if (!existsSync(file)) {
                    const reason = result.timedOut ? `timed out after ${timeoutMs}ms` : result.output.trim().split("\n").slice(-2).join(" ").slice(0, 300) || `exited ${result.code}`;
                    shots.push({ ...job, file: rel, sha256: "", blank: true, error: reason });
                    continue;
                }
                const png = readFileSync(file);
                const bitmap = decodePng(png);
                const old = before ? decodePng(before) : undefined;
                shots.push({
                    screen: job.screen,
                    state: job.state,
                    viewport: job.viewport,
                    file: rel,
                    ...(bitmap ? { width: bitmap.width, height: bitmap.height } : {}),
                    sha256: createHash("sha256").update(png).digest("hex"),
                    blank: bitmap ? distinctColors(bitmap, 2) <= 1 : false,
                    ...(bitmap && old ? { changedRatio: Math.round(diffRatio(old, bitmap) * 10_000) / 10_000 } : {}),
                });
            }
        }
        finally {
            rmSync(profile, { recursive: true, force: true });
        }
    });
    const manifest = { generatedAt: nowIso(), source, ...(options.url ? { url: options.url } : {}), browser, shots, skipped };
    // A filtered run (some screens or viewports) keeps the other shots of the previous manifest.
    if (previous && previous.source === source && (options.screens?.length || options.viewports?.length)) {
        const key = (s) => `${s.screen}|${s.state}|${s.viewport}`;
        const fresh = new Set(shots.map(key));
        manifest.shots = [...previous.shots.filter((s) => !fresh.has(key(s))), ...shots];
    }
    writeFileSync(join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}
export function readManifest(root) {
    const file = join(root, MANIFEST);
    if (!existsSync(file))
        return undefined;
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    }
    catch {
        return undefined;
    }
}
/** What the design gate needs: a fully designed prototype, complete fresh non-blank shots, and a critique newer than them. */
export function shotProblems(root) {
    const screens = loadArtifact(root, "screens");
    if (!screens)
        return ["no screens artifact"];
    const prototype = join(root, PROTOTYPE);
    if (!existsSync(prototype))
        return ["no prototype — run `forge design prototype` and design every state"];
    const problems = [];
    const unfilled = unfilledStates(root);
    if (unfilled.length)
        problems.push(`${unfilled.length} prototype state(s) not designed yet: ${unfilled.slice(0, 8).map((u) => `${u.screen}/${u.state}`).join(", ")}`);
    const manifest = readManifest(root);
    if (!manifest || manifest.source !== "prototype")
        return [...problems, "no screenshots of the prototype — run `forge design shots`"];
    const taken = new Set(manifest.shots.filter((s) => !s.error).map((s) => `${s.screen}|${s.state}|${s.viewport}`));
    const missing = screens.screens.flatMap((screen) => (screen.stateless ? ["success"] : [...STATES]).flatMap((state) => viewportsFor(screen.platform)
        .filter((viewport) => !taken.has(`${screen.id}|${state}|${viewport}`))
        .map((viewport) => `${screen.id}/${state}@${viewport}`)));
    if (missing.length)
        problems.push(`${missing.length} shot(s) missing: ${missing.slice(0, 8).join(", ")}`);
    const failed = manifest.shots.filter((s) => s.error);
    if (failed.length)
        problems.push(`${failed.length} shot(s) failed: ${failed.slice(0, 4).map((s) => `${s.screen}/${s.state}@${s.viewport} (${s.error})`).join("; ")}`);
    const blank = manifest.shots.filter((s) => s.blank && !s.error);
    if (blank.length)
        problems.push(`${blank.length} blank render(s): ${blank.slice(0, 8).map((s) => `${s.screen}/${s.state}@${s.viewport}`).join(", ")}`);
    const shotsAt = Date.parse(manifest.generatedAt);
    const inputs = [prototype, join(root, "design", "dist", "tokens.css")].filter((f) => existsSync(f));
    if (Math.max(...inputs.map((f) => statSync(f).mtimeMs)) > shotsAt)
        problems.push("the prototype or tokens changed after the last screenshots — run `forge design shots` again");
    const rubric = join(layout(root).gates, "design.rubric.json");
    if (existsSync(rubric) && statSync(rubric).mtimeMs < shotsAt)
        problems.push("the design critique predates the latest screenshots — the design-critic must re-score them");
    return problems;
}
