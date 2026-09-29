import { describe, expect, it } from "vitest";
import { summarizeMilestones } from "./milestones";

const api = (m: Partial<Record<string, unknown>>) => ({
  title: "M0 Reset & de-risk",
  state: "open",
  open_issues: 0,
  closed_issues: 0,
  html_url: "https://github.com/x/y/milestone/3",
  ...m,
});

describe("summarizeMilestones", () => {
  it("keeps only v2 milestones (M0–M5) sorted by number", () => {
    const rows = summarizeMilestones([
      api({ title: "M2 Model" }),
      api({ title: "v0.2.0 — Polish" }),
      api({ title: "M0 Reset & de-risk" }),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["M0 Reset & de-risk", "M2 Model"]);
  });

  it("computes progress from closed / total issues", () => {
    const [row] = summarizeMilestones([api({ open_issues: 3, closed_issues: 1 })]);
    expect(row).toMatchObject({ open: 3, closed: 1, percent: 25, status: "in progress" });
  });

  it("labels milestones with no closed issues as not started", () => {
    expect(summarizeMilestones([api({ open_issues: 4 })])[0]?.status).toBe("not started");
  });

  it("labels fully closed or closed-state milestones as done", () => {
    expect(summarizeMilestones([api({ closed_issues: 5 })])[0]?.status).toBe("done");
    expect(summarizeMilestones([api({ state: "closed", open_issues: 1 })])[0]?.status).toBe("done");
  });

  it("ignores malformed items instead of throwing", () => {
    expect(summarizeMilestones([null, 42, { title: 7 }, api({})])).toHaveLength(1);
    expect(summarizeMilestones("nope")).toEqual([]);
  });
});
