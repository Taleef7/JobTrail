# Evidence — #63 monorepo skeleton + live build-info site

Captured 2026-09-29 with `agent-browser` (headless Chrome 154) against the **production** URL https://jobtrail-drab.vercel.app.

| File                                            | What it shows                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `before/preview-branch-before-visual-fixes.png` | First deploy (branch commit `3873a45`, wrongly served as production before `main` had the app). Shows the three bugs later fixed: literal backticks, oversized section gaps, misaligned progress-table rows. |
| `after/live-desktop.png`                        | Production at 1280px after merge: commit `38a18c0`, branch `main`, env `production`, live milestones, changelog with rendered code spans.                                                                    |
| `after/live-mobile.png`                         | Same at 375px.                                                                                                                                                                                               |

DOM assertions on production (after):

```json
{
  "sha": "38a18c04757f5ba98d4f237f8da65ae8bf91bbdc",
  "env": "production",
  "branch": "main",
  "milestones": 6,
  "shipped": 8,
  "codeSpans": 8,
  "literalBackticks": false
}
```

At 375px: `document.documentElement.scrollWidth > window.innerWidth` → `false` (no horizontal overflow).
