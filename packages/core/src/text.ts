// Dependency-free text helpers (no Zod), safe to import from lightweight bundles
// via "@jobtrail/core/text".

/**
 * Remove <think>…</think> blocks in one linear pass. A regex like
 * /<think>[\s\S]*?<\/think>/g backtracks polynomially on many unclosed tags
 * (CodeQL js/polynomial-redos), and this runs on untrusted model output.
 */
export function stripThinkBlocks(text: string): string {
  const open = "<think>";
  const close = "</think>";
  let out = "";
  let pos = 0;
  for (;;) {
    const start = text.indexOf(open, pos);
    if (start === -1) break;
    const end = text.indexOf(close, start + open.length);
    if (end === -1) break; // unclosed: keep the rest as-is
    out += text.slice(pos, start);
    pos = end + close.length;
  }
  return out + text.slice(pos);
}

/**
 * Yield balanced `{…}` spans in order of their opening brace, ignoring braces
 * inside JSON strings. Callers try each span with JSON.parse, so prose before
 * or after the record — even prose containing braces — doesn't break parsing.
 * Unclosed or unparseable spans are skipped; `maxAttempts` bounds the work on
 * hostile input (each attempt is one linear scan).
 */
export function* balancedObjectSpans(text: string, maxAttempts = 64): Generator<string> {
  let from = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = text.indexOf("{", from);
    if (start === -1) return;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end !== -1) yield text.slice(start, end + 1);
    from = start + 1;
  }
}
