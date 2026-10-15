---
description: pro-page-complete — audit one page end to end, fix its must-fix atoms, prove them, record the audit
argument-hint: "<route or URL> [focus notes]"
---

Run pro-page-complete on: $ARGUMENTS

Delegate to the **page-auditor** agent if your host supports subagents; otherwise follow the `pro-page-complete` skill (`guide skills/pro-page-complete`). If the product map is stale or missing, call `product_sync` (or `product_adopt`) first. Record the result with `page_audit_write` and finish with the skill's short report.
