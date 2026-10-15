---
name: qa-e2e
description: forge's QA — turn every MVP acceptance criterion into a tagged, deterministic end-to-end test (Playwright for web, Maestro for mobile, HTTP tests for APIs) that covers the empty, loading, error and success states and the permission paths; run them locally and against the deployed preview; keep coverage at 100% of acceptance criteria. Use in the build stage (alongside each story) and the verify stage.
---

# QA: acceptance → tagged e2e tests (forge `build` + `verify`)

**Gate:** `qa.coverage` (verify) — every MVP acceptance criterion has a test tagged `@<story>/AC<n>`; `commands.e2e` must pass; after `forge deploy`, the same suite runs against the deployed URL.

## 1. Plan
- `qa_plan` (CLI `forge qa plan`) lists the cases — `S-1/AC1`, … — with Given/When/Then, the tool (Playwright when the story has web screens, Maestro for iOS/Android screens, HTTP tests otherwise) and a suggested file.
- Add the negative paths each story implies even when the PRD forgot them: validation errors, unauthorized/forbidden, not found, empty state, network failure, double submit.
- Tool missing? `stack_info <pack>` names the fix (`pnpm dlx create-playwright@latest`, Maestro install); then `stack_use` so `commands.e2e` is configured.

## 2. Write the tests
- **Tag** each test with its case id in the title: `test("streak grows after a check-in @S-1/AC1", …)` · Maestro: `tags: [S-1/AC1]` · pytest: a `# @S-1/AC1` comment or marker. One test may cover several cases; every case needs at least one test.
- **Given** = real setup through the app's public API or UI (sign up a user, create a habit) — never by changing product code paths or shipping seed data. Test data lives in test fixtures and is unique per run (suffix a run id) so tests can run in parallel and against shared previews.
- **When** = what a user does: Playwright `getByRole` / `getByLabel` / `getByText` locators (no CSS/XPath chains); Maestro `tapOn` by visible text or accessibility id.
- **Then** = the user-visible outcome with web-first assertions (`await expect(locator).toHaveText(…)`), plus the API status for HTTP tests. No `waitForTimeout` or sleeps; wait on state.
- **States:** for every screen the story touches, reach empty, loading (throttle or intercept the request), error (make the request fail) and success.
- **Base URL** from `PLAYWRIGHT_BASE_URL` / `BASE_URL` (forge sets both when testing a deployment). Assert you are on the app's origin: a protected preview redirects to the platform's login page, which answers 200 and can look like a real page — HTTP checks use `redirect: "manual"`, browser tests assert the URL after navigation. Locally, `webServer` in `playwright.config.ts` runs `build && start` — not a dev server — and Playwright stops it.
- **Accessibility:** an `@axe-core/playwright` scan on each screen's success state; fail on serious/critical violations.
- Mobile (Maestro): one flow per story under `.maestro/`, run against a development or preview build on a simulator.

## 3. Run and report
- Locally: `commands.e2e` (one heavy job; browsers close at the end). Flaky test → fix the wait or the isolation; never retry until green.
- `qa_coverage` with `link: true` adds story → test trace links (the gap gate counts them).
- After `forge deploy`, the release record shows `e2e against <url>`; a failure there blocks the release.
- File bugs as findings in `reviews` (severity by user impact) with the failing test as evidence; the **debugger** takes anything without a clear cause.
