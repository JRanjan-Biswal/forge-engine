---
description: forge QA — tagged e2e tests for every MVP acceptance criterion, states and permission paths, with coverage proof
argument-hint: "[story ids or scope]"
---

QA for: $ARGUMENTS

Use the **qa-engineer** agent following the `qa-e2e` skill: `qa_plan` → write tests tagged `@S-1/AC1` (Playwright for web, Maestro for mobile, HTTP tests for APIs) covering empty/loading/error/success and permission paths → run `commands.e2e` → `qa_coverage` with `link: true`. Report uncovered criteria and failing tests; failures go to the `reviews` artifact.

Without MCP: `forge qa plan`, `forge qa coverage --link`.
