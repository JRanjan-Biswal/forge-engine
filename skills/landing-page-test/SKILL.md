---
name: landing-page-test
description: Run the cheapest demand experiment for a validated-but-uncertain idea — a single honest landing page with a waitlist, a traffic plan and a pre-registered success threshold — then feed the result back into validation. Use when the forge validate verdict is needs-experiment or pivot.
---

# Landing-page demand test

**Use when:** the validation verdict is `needs-experiment` (or `pivot`) and the experiment list starts with "landing page + waitlist".
**Produces:** `landing/index.html` (one static, accessible page), an entry in `validation.experiments`, and a ledger record of the result.

## Honesty rules (non-negotiable)

- No invented testimonials, user counts, customer logos, press mentions or "as seen on". If you have none, show none.
- The waitlist form must post to a **real endpoint the user provides** (their backend, or a form service such as Tally, Formspree or Google Forms). No endpoint → `blocker_add "waitlist endpoint (form URL) for the landing-page test"` and stop.
- No dark patterns: no fake scarcity, countdowns or pre-ticked consent. Say what you will email people about.
- Analytics only if the user provides an account (e.g. Plausible, PostHog); otherwise count signups at the form endpoint and visits from the traffic source.

## Steps

1. **Pre-register the test** before building anything — write it into `validation.experiments` and `ledger_add`:
   - hypothesis ("busy developers will join a waitlist for X"),
   - traffic source(s) and expected volume (e.g. one Show HN post + two relevant communities found during validation),
   - success threshold (e.g. ≥ 5% visitor → signup over 7 days with ≥ 200 visitors), and what you will do on success / failure.
2. **Write the page** from the vision and validation evidence: headline = the user's pain in their words (reuse saved quotes), sub-headline = the "only we" claim, 3 benefits tied to the documented gaps, one form (email + optional "what do you use today?"), honest FAQ including "this is not built yet".
3. **Quality:** single HTML file, no build step, system fonts, < 50 KB, works without JavaScript, WCAG AA contrast, labelled inputs, visible focus, mobile-first.
4. **Ship:** the user deploys it (any static host). Never deploy to an account you were not given; if needed, `blocker_add` the hosting credential.
5. **Read the result** after the window closes: record visitors, signups and the threshold outcome with `ledger_add`, add the numbers as evidence (the form tool's export or analytics page, saved with `evidence_save` when it is a fetchable URL), then `stage_reopen validate` and update the affected criteria.
