# evidence/

Proof that acceptance criteria were met, following [`docs/WORKFLOW.md`](../docs/WORKFLOW.md). Nothing in the README, the web app or the write-up may claim something that isn't backed by a file here, a committed results file, or a CI run.

## Layout

```
evidence/<issue#>/
  before/   state before the change (screenshots, failing-test output, benchmark JSON)
  after/    state after the change, on the live surface (live URL or release APK)
```

## Rules

- **Device claims** (`needs-device` issues) need a benchmark/measurement JSON **and** a short screen recording or screenshot from the named device (Redmi Note 9S or iPhone 16 Pro), captured from the **release build**, not a dev build.
- Every JSON records device model, OS version, RAM, app commit and model id.
- Large recordings (> 10 MB) go to the GitHub issue as attachments; the folder keeps a `LINKS.md` pointing to them.
- No personal data: role-played notes only, no real customer names or addresses.
