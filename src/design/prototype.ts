import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadArtifact } from "../core/artifacts.js";
import type { Screens } from "../schemas/artifacts.js";

/**
 * Prototype scaffold: one dependency-free HTML file with a page per screen and a
 * state switcher (empty / loading / error / success), styled by the generated
 * design/dist/tokens.css. The screen designer fills each state; the design critic
 * screenshots `?screen=<id>&state=<state>` at 360 / 768 / 1280 px.
 */

const STATES = ["empty", "loading", "error", "success"] as const;
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function buildPrototype(root: string): { path: string; screens: number } {
  const screens = loadArtifact<Screens>(root, "screens");
  if (!screens) throw new Error("No screens artifact yet — write design/screens.json first (artifact_write screens)");
  const hasTokens = existsSync(join(root, "design", "dist", "tokens.css"));
  const sections = screens.screens
    .map((screen) => {
      const states = screen.stateless ? (["success"] as const) : STATES;
      return `<section data-screen="${escape(screen.id)}" hidden>
  <header class="fp-meta"><h1>${escape(screen.id)}</h1><p>${escape(screen.route)} · ${escape(screen.platform)} · stories ${escape(screen.storyIds.join(", "))}</p></header>
${states
  .map(
    (state) => `  <div data-state="${state}" hidden>
    <!-- forge: design the "${state}" state of ${escape(screen.id)} here, using token classes / CSS variables only.${screen.components.length ? ` Components: ${escape(screen.components.join(", "))}.` : ""} -->
  </div>`,
  )
  .join("\n")}
</section>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prototype</title>
${hasTokens ? '<link rel="stylesheet" href="../dist/tokens.css">' : "<!-- run `forge design build` to generate ../dist/tokens.css -->"}
<style>
  body { margin: 0; font-family: var(--font-body, system-ui, sans-serif); background: var(--color-bg-default, Canvas); color: var(--color-text-default, CanvasText); }
  .fp-bar { display: flex; flex-wrap: wrap; gap: .5rem; padding: .75rem 1rem; border-bottom: 1px solid currentColor; font-size: .875rem; }
  .fp-bar a { color: inherit; } .fp-bar a[aria-current="true"] { font-weight: 700; }
  .fp-meta { opacity: .7; font-size: .8rem; padding: 0 1rem; } .fp-meta h1 { font-size: 1rem; margin: .75rem 0 0; }
  main { padding: 1rem; }
</style>
</head>
<body>
<nav class="fp-bar" aria-label="Screens">${screens.screens.map((s) => `<a href="?screen=${encodeURIComponent(s.id)}">${escape(s.id)}</a>`).join("")}</nav>
<nav class="fp-bar" aria-label="States">${STATES.map((state) => `<a data-state-link="${state}" href="#">${state}</a>`).join("")}</nav>
<main>
${sections}
</main>
<script>
  const params = new URLSearchParams(location.search);
  const screen = params.get("screen") || ${JSON.stringify(screens.screens[0]?.id ?? "")};
  const state = params.get("state") || "success";
  for (const el of document.querySelectorAll("[data-screen]")) el.hidden = el.dataset.screen !== screen;
  for (const el of document.querySelectorAll("[data-screen='" + CSS.escape(screen) + "'] [data-state]")) el.hidden = el.dataset.state !== state;
  for (const a of document.querySelectorAll("nav a[href^='?screen=']")) a.setAttribute("aria-current", String(a.getAttribute("href") === "?screen=" + encodeURIComponent(screen)));
  for (const a of document.querySelectorAll("[data-state-link]")) {
    a.href = "?screen=" + encodeURIComponent(screen) + "&state=" + a.dataset.stateLink;
    a.setAttribute("aria-current", String(a.dataset.stateLink === state));
  }
</script>
</body>
</html>
`;
  const dir = join(root, "design", "prototype");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  return { path: "design/prototype/index.html", screens: screens.screens.length };
}
