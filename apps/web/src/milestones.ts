// Turns the GitHub milestones API response into rows for the status table.
// Fetched at runtime so the page never shows a hand-maintained (and drifting) status.

export type MilestoneStatus = "not started" | "in progress" | "done";

export interface MilestoneRow {
  title: string;
  url: string;
  open: number;
  closed: number;
  percent: number;
  status: MilestoneStatus;
}

const V2_TITLE = /^M(\d) /;

interface ApiMilestone {
  title: string;
  state: string;
  open_issues: number;
  closed_issues: number;
  html_url: string;
}

function isApiMilestone(x: unknown): x is ApiMilestone {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.title === "string" &&
    typeof m.state === "string" &&
    typeof m.open_issues === "number" &&
    typeof m.closed_issues === "number" &&
    typeof m.html_url === "string"
  );
}

export function summarizeMilestones(json: unknown): MilestoneRow[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter(isApiMilestone)
    .filter((m) => V2_TITLE.test(m.title))
    .sort((a, b) => Number(V2_TITLE.exec(a.title)?.[1]) - Number(V2_TITLE.exec(b.title)?.[1]))
    .map((m) => {
      const total = m.open_issues + m.closed_issues;
      const percent = total === 0 ? 0 : Math.round((m.closed_issues / total) * 100);
      const done = m.state === "closed" || (total > 0 && m.open_issues === 0);
      const status: MilestoneStatus = done
        ? "done"
        : m.closed_issues > 0
          ? "in progress"
          : "not started";
      return {
        title: m.title,
        url: m.html_url,
        open: m.open_issues,
        closed: m.closed_issues,
        percent,
        status,
      };
    });
}
