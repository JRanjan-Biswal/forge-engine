---
name: competitor-teardown
description: Find and tear down competitors with forge — direct, indirect and substitutes; features, pricing, positioning and review complaints backed by saved quotes; ending in a white-space map. Produces the forge `competitors` artifact.
---

# Competitor teardown

**Produces:** `competitors` artifact — `{ competitors: [{ name, url, segment, pricing, features[], strengths[], weaknesses[], reviewComplaints[{source, quote}], gapOpportunities[], evidence[] }] }`.

## 1. Scout (breadth first)

Aim for **8+ candidates**, then keep the 5–10 that matter:
- `evidence_search github` / `npm` / `appstore` with solution keywords.
- `evidence_search hackernews` "Show HN" + category; "alternative to <leader>".
- Host web search: "<leader> alternatives", "best <category> tools", pricing pages.
- Segment each: **direct** (same job, same user), **indirect** (same job, different approach), **substitute** (spreadsheets, agencies, doing nothing).

## 2. Tear down each competitor

| Field | How |
|---|---|
| `pricing` | From the pricing page — quote it with `evidence_save`, or "unknown" |
| `features` | From their site/README; only what you saw |
| `strengths` | Why users choose them (reviews, stars, ratings) |
| `weaknesses` | Recurring complaints, gaps, abandonment (last commit, unanswered issues) |
| `reviewComplaints` | 1–3 real complaints per competitor: App Store reviews, GitHub issues, Reddit/HN threads. **Save each quote** with `evidence_save`; put the same `url` as `source` and the same `quote` |
| `gapOpportunities` | What the complaints imply nobody does well |
| `evidence` | Saved items for traction claims (stars, ratings, user counts) |

Never estimate a competitor's revenue or user count without a source — leave it out.

## 3. White space

Cluster complaints across competitors. A gap appearing at 2+ competitors is a real opportunity; feed it into `gapOpportunities` and into the scorecard criteria C-07 (documented gap) and C-08 (only-we claim).

## 4. Write

`artifact_write competitors`. The validate gate needs ≥ `gates.validate.minCompetitors` (default 5) and checks every cited quote against the evidence store.
