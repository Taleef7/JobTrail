// Parses a Keep-a-Changelog markdown file into releases → sections → entries.
// Drives the "What's shipped" list on the build-info page.

export interface ChangelogEntry {
  text: string;
  issues: number[];
}
export interface ChangelogSection {
  heading: string;
  entries: ChangelogEntry[];
}
export interface ChangelogRelease {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}
export interface Changelog {
  releases: ChangelogRelease[];
}

const RELEASE = /^## \[([^\]]+)\](?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?/;
const SECTION = /^### (.+?)\s*$/;
const ENTRY = /^[-*] (.*)$/;
const CONTINUATION = /^\s+(\S.*)$/;
const ISSUE_REF = /#(\d+)\b/g;

function issueRefs(text: string): number[] {
  const refs = [...text.matchAll(ISSUE_REF)].map((m) => Number(m[1]));
  return [...new Set(refs)];
}

export function parseChangelog(markdown: string): Changelog {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;
  let entry: ChangelogEntry | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const releaseMatch = RELEASE.exec(line);
    if (releaseMatch) {
      release = { version: releaseMatch[1] ?? "", date: releaseMatch[2] ?? null, sections: [] };
      releases.push(release);
      section = null;
      entry = null;
      continue;
    }
    if (!release) continue;

    const sectionMatch = SECTION.exec(line);
    if (sectionMatch) {
      section = { heading: sectionMatch[1] ?? "", entries: [] };
      release.sections.push(section);
      entry = null;
      continue;
    }

    const entryMatch = ENTRY.exec(line);
    if (entryMatch) {
      if (!section) {
        section = { heading: "Other", entries: [] };
        release.sections.push(section);
      }
      entry = { text: (entryMatch[1] ?? "").trim(), issues: [] };
      section.entries.push(entry);
      continue;
    }

    const continuation = CONTINUATION.exec(line);
    if (continuation && entry) {
      entry.text = `${entry.text} ${continuation[1] ?? ""}`.trim();
      continue;
    }

    if (line.trim() === "") entry = null;
  }

  for (const r of releases) {
    r.sections = r.sections.filter((s) => s.entries.length > 0);
    for (const s of r.sections) for (const e of s.entries) e.issues = issueRefs(e.text);
  }
  return { releases };
}
