import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeArtifact } from "../src/core/artifacts.js";
import { Forge } from "../src/core/engine.js";
import { scoreValidation, validationTemplate } from "../src/core/validation.js";
import { searchEvidence } from "../src/evidence/connectors.js";
import { EvidenceMismatchError, loadEvidence, saveEvidence } from "../src/evidence/store.js";
import { quoteAppears } from "../src/evidence/text.js";
import { Validation } from "../src/schemas/artifacts.js";
import { isolate, tmpProject } from "./helpers.js";

isolate();

const json = (body: unknown) => ({ type: "application/json", body: JSON.stringify(body) });
const ROUTES: Record<string, { status?: number; type: string; body: string }> = {
  "/api/v1/search": json({
    hits: [
      {
        objectID: "41",
        title: "Ask HN: How do you keep habits?",
        story_text: "I keep dropping my habits after a week &amp; feel bad",
        points: 120,
        num_comments: 88,
        author: "someone",
        created_at: "2026-01-02T00:00:00Z",
      },
    ],
  }),
  "/search/repositories": json({
    items: [
      {
        full_name: "acme/habits",
        html_url: "https://github.com/acme/habits",
        description: "Open-source habit tracker",
        stargazers_count: 1234,
        forks_count: 10,
        open_issues_count: 3,
        pushed_at: "2026-09-01T00:00:00Z",
        created_at: "2020-01-01T00:00:00Z",
      },
    ],
  }),
  "/-/v1/search": json({ objects: [{ package: { name: "habit-kit", description: "Streak helpers" }, score: { final: 0.734 }, downloads: { weekly: 900 } }] }),
  "/search": json({
    results: [
      { trackName: "Streaks", trackViewUrl: "https://apps.apple.com/app/id1", description: "The to-do list that helps you form good habits", averageUserRating: 4.7, userRatingCount: 5000, formattedPrice: "$5.99" },
    ],
  }),
  "/search.json": json({
    data: { children: [{ data: { title: "I can't stick to habits", selftext: "Every app nags me", permalink: "/r/productivity/comments/abc/", subreddit: "productivity", score: 42, num_comments: 17 } }] },
  }),
  "/blog": {
    type: "text/html",
    body: "<html><body><p>Most people quit a new habit within <b>seven days</b>.</p><script>var secret='hidden script text';</script></body></html>",
  },
  "/blocked": { status: 403, type: "text/plain", body: "forbidden" },
};

let server: Server;
let base = "";
let requests = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    requests++;
    const route = ROUTES[new URL(req.url ?? "/", "http://localhost").pathname];
    if (!route) return void res.writeHead(404).end();
    res.writeHead(route.status ?? 200, { "content-type": route.type }).end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("evidence connectors", () => {
  it("parse every source into url + text + metrics", async () => {
    const root = tmpProject();
    const hn = await searchEvidence(root, "hackernews", "habits", { baseUrl: base });
    expect(hn.results[0]).toMatchObject({ url: "https://news.ycombinator.com/item?id=41", metrics: { points: 120 } });
    expect(hn.results[0]?.text).toContain("after a week & feel bad");
    expect((await searchEvidence(root, "github", "habit tracker", { baseUrl: base })).results[0]?.metrics.stars).toBe(1234);
    expect((await searchEvidence(root, "npm", "habit", { baseUrl: base })).results[0]).toMatchObject({ url: "https://www.npmjs.com/package/habit-kit", metrics: { weeklyDownloads: 900, score: 0.73 } });
    expect((await searchEvidence(root, "appstore", "habits", { baseUrl: base })).results[0]?.metrics.rating).toBe(4.7);
    expect((await searchEvidence(root, "reddit", "habits", { baseUrl: base })).results[0]?.url).toBe("https://www.reddit.com/r/productivity/comments/abc/");
  });

  it("caches searches for 24h and rejects unknown sources", async () => {
    const root = tmpProject();
    const first = await searchEvidence(root, "npm", "cache me", { baseUrl: base });
    const before = requests;
    const second = await searchEvidence(root, "npm", "cache me", { baseUrl: base });
    expect([first.cached, second.cached]).toEqual([false, true]);
    expect(requests).toBe(before);
    expect((await searchEvidence(root, "npm", "cache me", { baseUrl: base, fresh: true })).cached).toBe(false);
    await expect(searchEvidence(root, "twitter", "x")).rejects.toThrow(/Unknown evidence source/);
  });
});

describe("evidence store verification", () => {
  it("verifies a quote against the search result it came from, without refetching", async () => {
    const root = tmpProject();
    await searchEvidence(root, "hackernews", "habits", { baseUrl: base });
    const item = await saveEvidence(root, { url: "https://news.ycombinator.com/item?id=41", quote: "I keep dropping my habits after a week" });
    expect(item.verification).toMatchObject({ status: "verified", method: "search-result" });
    expect(item.source).toBe("hackernews");
  });

  it("verifies against the fetched page (tags stripped, fragments with …)", async () => {
    const root = tmpProject();
    const exact = await saveEvidence(root, { url: `${base}/blog`, quote: "quit a new habit within seven days" });
    const fragments = await saveEvidence(root, { url: `${base}/blog`, quote: "Most people quit … seven days" });
    expect([exact.verification.status, fragments.verification.status]).toEqual(["verified", "verified"]);
    expect([exact.id, fragments.id]).toEqual(["E-1", "E-2"]);
    expect((await saveEvidence(root, { url: `${base}/blog`, quote: "quit a new habit within seven days" })).id).toBe("E-1");
  });

  it("rejects quotes that are not on the page (including script text) and stores nothing", async () => {
    const root = tmpProject();
    await expect(saveEvidence(root, { url: `${base}/blog`, quote: "everyone keeps every habit forever" })).rejects.toThrow(EvidenceMismatchError);
    await expect(saveEvidence(root, { url: `${base}/blog`, quote: "hidden script text" })).rejects.toThrow(EvidenceMismatchError);
    await expect(saveEvidence(root, { url: `${base}/blog`, quote: "habit" })).rejects.toThrow(/at least 8 characters/);
    expect(loadEvidence(root)).toEqual([]);
  });

  it("stores blocked pages as unverifiable, with the reason", async () => {
    const item = await saveEvidence(tmpProject(), { url: `${base}/blocked`, quote: "a quote we could not check" });
    expect(item.verification).toMatchObject({ status: "unverifiable", note: "HTTP 403" });
  });

  it("matches tolerantly across curly quotes, dashes and whitespace", () => {
    expect(quoteAppears("it's   a “big” deal — really", "It’s a \"big\" deal - really.")).toBe(true);
    expect(quoteAppears("b … a", "a then b")).toBe(false); // fragments must be in order
  });
});

describe("validation scorecard", () => {
  it("provides a schema-valid 12-criteria template", () => {
    const template = Validation.parse(validationTemplate("Streak-based habit coach"));
    expect(template.criteria).toHaveLength(12);
    expect(template.criteria.every((c) => c.answer === "unknown")).toBe(true);
  });

  it("scores with weights and suggests a verdict", () => {
    const criteria = Validation.parse(validationTemplate("x")).criteria;
    expect(scoreValidation(criteria).suggestedVerdict).toBe("needs-experiment");
    const answered = criteria.map((c, i) => ({ ...c, answer: (i < 10 ? "yes" : "no") as "yes" | "no" }));
    const report = scoreValidation(answered);
    expect(report.score).toBe(87); // (17.5 − 2) / 17.5 weighted yes
    expect(report.suggestedVerdict).toBe("go");
    expect(report.unsupportedYes).toHaveLength(10);
    expect(scoreValidation(answered.map((c) => ({ ...c, answer: "no" as const }))).suggestedVerdict).toBe("kill");
  });
});

describe("validate gate × evidence store", () => {
  it("fails until cited quotes are saved through the store, then counts verified quotes", async () => {
    const root = tmpProject({ autonomy: "auto" });
    const forge = new Forge(root);
    forge.start("validate", { force: true });
    const evidence = [{ url: `${base}/blog`, quote: "quit a new habit within seven days", retrievedAt: "2026-10-15T00:00:00.000Z" }];
    const scorecard = Validation.parse(validationTemplate("Habit coach"));
    scorecard.criteria = scorecard.criteria.map((c, i) => (i === 0 ? { ...c, answer: "yes", evidence } : c));
    writeArtifact(root, "validation", { ...scorecard, score: scoreValidation(scorecard.criteria).score });

    let checks = Object.fromEntries((await forge.complete("validate")).checks.map((c) => [c.id, c]));
    expect(checks["evidence-registered"]?.status).toBe("fail");
    expect(checks["evidence-registered"]?.message).toContain("C-01");

    await saveEvidence(root, { url: `${base}/blog`, quote: "quit a new habit within seven days" });
    checks = Object.fromEntries((await forge.complete("validate")).checks.map((c) => [c.id, c]));
    expect(checks["evidence-registered"]?.status).toBe("pass");
    expect(checks["evidence-verifiedShare"]).toMatchObject({ status: "pass", message: expect.stringContaining("1/1") });
  });
});
