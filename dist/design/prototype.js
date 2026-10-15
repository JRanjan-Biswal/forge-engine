import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadArtifact } from "../core/artifacts.js";
/**
 * Prototype scaffold: one dependency-free HTML file with a page per screen and a
 * state switcher (empty / loading / error / success), styled by the generated
 * design/dist/tokens.css. The screen designer fills each state; `forge design shots`
 * screenshots `?screen=<id>&state=<state>&chrome=0` at 360 / 768 / 1280 px (390 for mobile apps).
 */
const STATES = ["empty", "loading", "error", "success"];
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
export function buildPrototype(root, options = {}) {
    const screens = loadArtifact(root, "screens");
    if (!screens)
        throw new Error("No screens artifact yet — write design/screens.json first (artifact_write screens)");
    if (existsSync(join(root, "design", "prototype", "index.html")) && !options.force) {
        throw new Error("design/prototype/index.html already exists and may hold designed states — pass --force (force: true) to regenerate it from scratch");
    }
    const hasTokens = existsSync(join(root, "design", "dist", "tokens.css"));
    const sections = screens.screens
        .map((screen) => {
        const states = screen.stateless ? ["success"] : STATES;
        return "<section data-screen=\"".concat(escape(screen.id), "\" hidden>\n  <header class=\"fp-meta\"><h1>", escape(screen.id), "</h1><p>", escape(screen.route), " · ", escape(screen.platform), " · stories ", escape(screen.storyIds.join(", ")), "</p></header>\n", states
            .map((state) => "  <div data-state=\"".concat(state, "\" hidden>\n    <!-- forge: design the \"", state, "\" state of ", escape(screen.id), " here, using token classes / CSS variables only.", screen.components.length ? " Components: ".concat(escape(screen.components.join(", ")), ".") : "", " -->\n  </div>"))
            .join("\n"), "\n</section>");
    })
        .join("\n");
    const html = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Prototype</title>\n".concat(hasTokens ? '<link rel="stylesheet" href="../dist/tokens.css">' : "<!-- run `forge design build` to generate ../dist/tokens.css -->", "\n<style>\n  body { margin: 0; font-family: var(--font-body, system-ui, sans-serif); background: var(--color-bg-default, Canvas); color: var(--color-text-default, CanvasText); }\n  .fp-bar { display: flex; flex-wrap: wrap; gap: .5rem; padding: .75rem 1rem; border-bottom: 1px solid currentColor; font-size: .875rem; }\n  .fp-bar a { color: inherit; } .fp-bar a[aria-current=\"true\"] { font-weight: 700; }\n  .fp-meta { opacity: .7; font-size: .8rem; padding: 0 1rem; } .fp-meta h1 { font-size: 1rem; margin: .75rem 0 0; }\n  main { padding: 1rem; }\n  [hidden] { display: none !important; } /* the hidden attribute must win over display rules (chrome=0 screenshots) */\n</style>\n</head>\n<body>\n<nav class=\"fp-bar\" aria-label=\"Screens\">", screens.screens.map((s) => "<a href=\"?screen=".concat(encodeURIComponent(s.id), "\">", escape(s.id), "</a>")).join(""), "</nav>\n<nav class=\"fp-bar\" aria-label=\"States\">", STATES.map((state) => "<a data-state-link=\"".concat(state, "\" href=\"#\">", state, "</a>")).join(""), "</nav>\n<main>\n", sections, "\n</main>\n<script>\n  const params = new URLSearchParams(location.search);\n  const screen = params.get(\"screen\") || ", JSON.stringify(screens.screens[0]?.id ?? ""), ";\n  const state = params.get(\"state\") || \"success\";\n  // chrome=0: only the design (used by `forge design shots` for the critique screenshots).\n  if (params.get(\"chrome\") === \"0\") for (const el of document.querySelectorAll(\".fp-bar, .fp-meta\")) el.hidden = true;\n  for (const el of document.querySelectorAll(\"[data-screen]\")) el.hidden = el.dataset.screen !== screen;\n  for (const el of document.querySelectorAll(\"[data-screen='\" + CSS.escape(screen) + \"'] [data-state]\")) el.hidden = el.dataset.state !== state;\n  for (const a of document.querySelectorAll(\"nav a[href^='?screen=']\")) a.setAttribute(\"aria-current\", String(a.getAttribute(\"href\") === \"?screen=\" + encodeURIComponent(screen)));\n  for (const a of document.querySelectorAll(\"[data-state-link]\")) {\n    a.href = \"?screen=\" + encodeURIComponent(screen) + \"&state=\" + a.dataset.stateLink;\n    a.setAttribute(\"aria-current\", String(a.dataset.stateLink === state));\n  }\n</script>\n</body>\n</html>\n");
    const dir = join(root, "design", "prototype");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html);
    return { path: "design/prototype/index.html", screens: screens.screens.length };
}
