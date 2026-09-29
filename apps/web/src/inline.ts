// Minimal inline markdown for changelog entries: `code` spans and #issue links.

export type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "issue"; value: string; number: number };

const CODE_SPAN = /`([^`]+)`/g;
const ISSUE_REF = /#(\d+)\b/g;

function textAndIssues(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(ISSUE_REF)) {
    const start = m.index;
    if (start > last) tokens.push({ kind: "text", value: text.slice(last, start) });
    tokens.push({ kind: "issue", value: m[0], number: Number(m[1]) });
    last = start + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", value: text.slice(last) });
  return tokens;
}

export function inlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    const start = m.index;
    tokens.push(...textAndIssues(text.slice(last, start)));
    tokens.push({ kind: "code", value: m[1] ?? "" });
    last = start + m[0].length;
  }
  tokens.push(...textAndIssues(text.slice(last)));
  return tokens;
}
