---
name: ship-release
description: forge's ship stage — generate CI from the stacks, deploy a preview with the official CLIs (Vercel, Fly.io, EAS, Supabase), let forge smoke-test the URL, probe its security headers and run the e2e suite against it, review the release notes and rollback plan with the user, then deploy production only after their approval. Never fakes a deploy; missing logins or project links become blockers. Use for the forge `ship` stage and every later release.
---

# Ship & release (forge `ship` stage)

**Produces:** `release` artifact (`.forge/releases/latest.json`) written by `forge deploy` from checks it actually ran, release notes in `.forge/releases/`, `.github/workflows/forge.yml`. **Gate:** release valid, every release check passed, the released URL answers now (`release.live`), human approval.

## 1. Before the first deploy
1. `stack_use` is current and `verify` has passed (reviews, security scan, QA coverage, e2e).
2. **CI:** `ci_generate` (CLI `forge ci`) — one job per stack running the same commands as the gates, plus the security scan. Commit it.
3. **Plan:** `deploy_plan` shows the target per stack and anything missing:
   - CLI not installed or not logged in → `blocker_add` with the login command; the user logs in (in Claude Code: `! vercel login`). Never use someone else's token or invent one.
   - Project not linked (`fly.toml`, `eas.json`, `supabase link`) → run the `create` command shown, review what it generated (Dockerfile, regions, app name) and commit it.
   - Pick a target explicitly with `deploy.targets` in `forge.config.yaml` when a pack offers several.
4. **Secrets:** set runtime env vars on the platform (`vercel env add`, `fly secrets set`, `eas secret:create`) — never in the repo or forge memory. Missing values are blockers.

## 2. Preview
- `deploy` (CLI `forge deploy`) goes database → services → apps. For each, forge checks the login, runs the deploy, captures the URL, then:
  - smoke `GET <url><deploy.healthPath>` must be < 400 (protected previews: set the target's bypass env var, e.g. `VERCEL_AUTOMATION_BYPASS_SECRET`);
  - security headers at `security.failOn`;
  - `commands.e2e` with `BASE_URL` / `PLAYWRIGHT_BASE_URL` set to the deployed URL.
- Any failure → fix it through the build/verify loop and deploy again. Never edit the release record by hand.

## 3. Decide with the user
- Show the release notes (`forge release notes`): URL, checks, what's new (stories), decisions, commits, rollback.
- Ask for approval in plain words: what goes to production, what could break, how to roll back. The user runs `forge approve ship` (or says yes, and only then you call `stage_approve`).

## 4. Production
- `deploy` with `env: production` (CLI `forge deploy --prod`) — refused without the approval. Database migrations go first and stay backward compatible with the running app (expand → migrate → contract).
- Watch the first minutes: smoke check, error logs (`vercel logs`, `fly logs`), the key user path. Something wrong → roll back with the command in the release record first, investigate second.
- `stage_complete ship` (re-checks the URL live). Tag the release (`git tag v<version>`), then `memory_save_episode`.
