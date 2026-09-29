<!-- Every PR follows docs/WORKFLOW.md. Keep it to one issue. -->

Refs #
<!-- Use "Refs", not "Closes": the issue is closed manually after live verification (docs/WORKFLOW.md step 6). -->

## What changed

<!-- One or two sentences. -->

## Workflow checklist

- [ ] **Pre-flight** comment posted on the issue (plan, test plan, "done looks like"): <!-- link -->
- [ ] **Before snapshot** captured: <!-- link to comment / evidence/<issue#>/before -->
- [ ] Tests written first for new logic; all suites pass locally
- [ ] Typecheck + lint pass locally
- [ ] CHANGELOG updated if behavior changed

## After merge (don't close the issue until done)

- [ ] Verified on the **live surface** — live web URL and/or release APK on the Note 9S (not a dev build)
- [ ] **After snapshot** + evidence linked; each acceptance criterion ticked with its evidence
- [ ] Verification comment posted on the issue (before vs after, anything unexpected)

## Notes / known gaps

<!-- Anything skipped, failing, or deferred — stated plainly, with a follow-up issue if needed. -->
