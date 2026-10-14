# No fake data

Applies to every build, verify and ship stage.

- Never seed, stub or hard-code placeholder data in product code paths (lorem ipsum, mock users, sample orders, fake API responses). Test fixtures belong in test directories.
- When something real is missing — an API key, account, dataset, asset, or a product decision — stop and record it with `blocker_add` (or `forge block "<need>"`), stating exactly what is needed and how to provide it.
- Never write secrets into the repo or into forge memory; use environment variables or the host's secret store.
- The `gap` stage scans for placeholder data and fails the gate if it finds any.
