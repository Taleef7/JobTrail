import { describe, expect, it } from "vitest";
import { parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  it("returns no releases for empty input", () => {
    expect(parseChangelog("")).toEqual({ releases: [] });
  });

  it("ignores the preamble before the first release heading", () => {
    const md = "# Changelog\n\nSome intro text.\n- not an entry\n";
    expect(parseChangelog(md).releases).toEqual([]);
  });

  it("parses the Unreleased section with its subsections and entries", () => {
    const md = [
      "## [Unreleased]",
      "",
      "### Removed",
      "- Legacy app archived (#62).",
      "",
      "### Added",
      "- Design doc (#62).",
      "- Monorepo skeleton (#63).",
    ].join("\n");

    const { releases } = parseChangelog(md);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ version: "Unreleased", date: null });
    expect(releases[0]?.sections.map((s) => s.heading)).toEqual(["Removed", "Added"]);
    expect(releases[0]?.sections[1]?.entries.map((e) => e.text)).toEqual([
      "Design doc (#62).",
      "Monorepo skeleton (#63).",
    ]);
  });

  it("parses versioned releases with dates (em dash or hyphen)", () => {
    const md = "## [0.2.0] — 2026-10-05\n### Added\n- a\n## [0.1.0] - 2026-09-30\n### Fixed\n- b\n";
    const { releases } = parseChangelog(md);
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ["0.2.0", "2026-10-05"],
      ["0.1.0", "2026-09-30"],
    ]);
  });

  it("extracts unique issue references in order of appearance", () => {
    const md = "## [Unreleased]\n### Added\n- Scorer (#68), schema (#67), again #68 and #7x.\n";
    expect(parseChangelog(md).releases[0]?.sections[0]?.entries[0]?.issues).toEqual([68, 67]);
  });

  it("joins indented continuation lines into the previous entry", () => {
    const md = "## [Unreleased]\n### Removed\n- Legacy app,\n  archived at legacy-v0 (#62).\n";
    expect(parseChangelog(md).releases[0]?.sections[0]?.entries[0]?.text).toBe(
      "Legacy app, archived at legacy-v0 (#62).",
    );
  });

  it("collects entries that appear before any subsection under 'Other'", () => {
    const md = "## [Unreleased]\n- stray entry\n### Added\n- real entry\n";
    const sections = parseChangelog(md).releases[0]?.sections ?? [];
    expect(sections.map((s) => [s.heading, s.entries.length])).toEqual([
      ["Other", 1],
      ["Added", 1],
    ]);
  });

  it("drops subsections that end up with no entries", () => {
    const md = "## [Unreleased]\n### Added\n### Fixed\n- only fix\n";
    expect(parseChangelog(md).releases[0]?.sections.map((s) => s.heading)).toEqual(["Fixed"]);
  });

  it("handles CRLF line endings", () => {
    const md = "## [Unreleased]\r\n### Added\r\n- entry (#63)\r\n";
    expect(parseChangelog(md).releases[0]?.sections[0]?.entries[0]).toEqual({
      text: "entry (#63)",
      issues: [63],
    });
  });
});
