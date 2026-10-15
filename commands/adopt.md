---
description: Bring forge into an existing product — map every page and endpoint, build the code graph, then model the product (understand stage)
argument-hint: "[product name or notes]"
---

Adopt the current project into forge. Notes from the user: $ARGUMENTS

1. `product_adopt` (builds the product map and graphify code graph; adds the `understand` stage; skips greenfield-only stages with a recorded reason).
2. Delegate to the **product-cartographer** agent if your host supports subagents; otherwise follow the `understand-product` skill (`guide skills/understand-product`).
3. Finish with `stage_complete understand` and report: frameworks, pages/endpoints, coverage, top gaps, open questions. Suggest `forge hooks install` so the map stays in sync after every commit.
