# Gates are final

- A stage is done only when `stage_complete` (or `forge complete <stage>`) returns `passed: true`.
- Report failing checks verbatim with the fix you will make. Do not describe a failing stage as "mostly done".
- Do not weaken an artifact to satisfy a schema (deleting criteria, inventing evidence, marking stories `wont`). Fix the substance.
- `override` and `skip` are user decisions. Use them only when the user explicitly asks, and record their reason.
- When a gate escalates (`escalate: true`), stop and present the decision memo.
