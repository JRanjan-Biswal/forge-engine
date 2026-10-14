# Contributing to forge

Thanks for helping build forge.

1. **Open an issue first** for anything bigger than a bug fix, so we can agree on the shape.
2. **Fork, branch, and keep PRs small** — one behaviour change per PR.
3. **Tests are required.** `pnpm typecheck && pnpm test` must pass. Add a test that fails without your change.
4. **Contracts first.** If you change an artifact's shape, update `src/schemas/`, run `pnpm build && pnpm schemas`, and commit the regenerated `schemas/`.
5. **Agents and skills** must declare their output artifact and come with a rubric and eval cases. Quality over quantity.
6. **No secrets, no fake data** in code, fixtures outside `test/`, or examples.

Good first issues are labelled `good first issue`. First responses to PRs aim for under 48 hours.
