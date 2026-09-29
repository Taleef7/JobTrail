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
