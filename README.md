# JobTrail

> **Status: rebuild in progress.** Nothing below is shipped yet — this README only claims what exists.
> The previous version is archived at tag [`legacy-v0`](https://github.com/Taleef7/JobTrail/tree/legacy-v0).

**JobTrail v2** is an offline capture tool for solo tradespeople, and an on-device ML project.

Talk for 30 seconds at the truck after a job. A small language model **running entirely on your phone** — no signal, no account, nothing uploaded — turns the note into a structured job record, prices it from your own price list, flags billable items you forgot, and exports it to whatever you already invoice with.

The ML goal: distill structured extraction from a cloud model into a fine-tuned, quantized **sub-1B model** that runs on a 2020 budget Android phone (Redmi Note 9S, CPU-only), and prove its quality with a public, reproducible evaluation.

## Where things stand

| Milestone              | Status                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| M0 Reset & de-risk     | in progress — [issues](https://github.com/Taleef7/JobTrail/milestone/3) |
| M1 Eval foundation     | not started                                                             |
| M2 Model               | not started                                                             |
| M3 Mobile MVP          | not started                                                             |
| M4 Web demo & evidence | not started                                                             |
| M5 Launch              | not started                                                             |

## Read more

- [Design doc](docs/superpowers/specs/2026-09-28-jobtrail-rebuild-design.md) — goals, market research, architecture, ML pipeline
- [Workflow](docs/WORKFLOW.md) — how every issue is pre-flighted, verified on the live app, and closed with evidence
- [Changelog](CHANGELOG.md)

## License

MIT
