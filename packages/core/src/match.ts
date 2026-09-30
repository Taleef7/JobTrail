// Fuzzy matching for list items and material names. Deliberately simple and
// explainable: normalized token sets compared with the Dice coefficient, plus a
// short trade synonym table and two "these are different things" rules (#114).
// Validated against blind panel labels in data/matcher-validation*.csv.

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "on",
  "some",
  "the",
  "to",
  "with",
]);

/** Validated in #114: ≥ 90 % agreement on every labeled set (see SCORING.md). */
export const MATCH_THRESHOLD = 0.5;

/** Material names get the head-noun rule; list items (work, issues, follow-ups) don't. */
export type MatchKind = "material" | "statement";

function singular(token: string): string {
  if (token.length <= 3 || token.endsWith("ss")) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  // "boxes"/"brushes"/"glasses" drop -es; "fuses"/"hoses" only drop -s (silent e).
  if (/(?:x|z|ch|sh|ss)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/** Tokens as said. Grounding (score.ts) uses these directly, without synonyms. */
export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "") // possessive: "plumber's" → "plumber"
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(singular);
}

// Multi-word synonyms, rewritten before tokenizing. Kept short on purpose: each
// entry is a wording tradespeople use interchangeably for the same thing.
const PHRASES: [RegExp, string][] = [
  [/\b(?:plumber['’]?s|plumbers|teflon|ptfe|thread[- ]seal(?:ing)?|thread)\s+tape\b/g, "ptfe tape"],
  [/\btopped (?:off|up)\b/g, "recharged"],
  [/\b(?:swapped|switched) out\b/g, "replaced"],
  [/\b(?:installed|put in) (?:a )?new\b/g, "replaced"],
];

// Single-word synonyms, applied to normalized tokens.
const WORDS: Record<string, string> = {
  replaced: "replace",
  replacing: "replace",
  swapped: "replace",
  patched: "repair",
  repaired: "repair",
  fixed: "repair",
  fix: "repair",
  sealed: "seal",
  caulked: "seal",
  recharged: "recharge",
  receptacle: "outlet",
  bath: "bathroom",
};

/** Normalized tokens with the synonym table applied: what matching compares. */
export function matchTokens(text: string): string[] {
  let t = text.toLowerCase();
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  return normalizeTokens(t).map((w) => WORDS[w] ?? w);
}

// If both sides name one of these and the names don't overlap, the two items are
// about different places or materials, whatever else they share.
const CONFLICT_CLASSES: Set<string>[] = [
  new Set(
    "kitchen bathroom bedroom basement attic garage laundry hallway hall upstairs downstairs porch patio office crawlspace living dining closet foyer".split(
      " ",
    ),
  ),
  new Set("wall ceiling floor door window trim cabinet countertop stair".split(" ")),
  new Set("copper pvc pex cpvc abs galvanized brass iron steel".split(" ")),
];

function conflicts(A: Set<string>, B: Set<string>): boolean {
  return CONFLICT_CLASSES.some((cls) => {
    const a = [...A].filter((t) => cls.has(t));
    const b = [...B].filter((t) => cls.has(t));
    return a.length > 0 && b.length > 0 && !a.some((t) => B.has(t));
  });
}

/**
 * Material names end in the item ("roofing cement", "roofing nail"). They are the
 * same item only if that last word agrees, or one name is contained in the other
 * ("breaker" / "20 amp breaker", "2x4s" / "2x4 studs").
 */
function headsAgree(a: string[], b: string[]): boolean {
  if (a.at(-1) === b.at(-1)) return true;
  const A = new Set(a);
  const B = new Set(b);
  return a.every((t) => B.has(t)) || b.every((t) => A.has(t));
}

/**
 * Token-set Dice coefficient 2|A∩B| / (|A|+|B|) over matchTokens, in [0, 1];
 * 0 when the conflict rule fires, or (materials) when the head nouns disagree.
 */
export function similarity(a: string, b: string, kind: MatchKind = "statement"): number {
  const ta = matchTokens(a);
  const tb = matchTokens(b);
  const A = new Set(ta);
  const B = new Set(tb);
  if (A.size === 0 || B.size === 0) return 0;
  if (conflicts(A, B)) return 0;
  if (kind === "material" && !headsAgree(ta, tb)) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

export function isMatch(a: string, b: string, kind: MatchKind = "statement"): boolean {
  return similarity(a, b, kind) >= MATCH_THRESHOLD;
}

export interface MatchResult {
  pairs: { pred: number; gold: number; score: number }[];
  unmatchedPred: number[];
  unmatchedGold: number[];
}

/**
 * One-to-one matching: all pairs at or above the threshold, taken greedily by
 * descending score (ties broken by original order), each item used at most once.
 */
export function matchOneToOne(
  pred: string[],
  gold: string[],
  threshold: number,
  kind: MatchKind = "statement",
): MatchResult {
  const candidates: { pred: number; gold: number; score: number }[] = [];
  pred.forEach((p, i) =>
    gold.forEach((g, j) => {
      const score = similarity(p, g, kind);
      if (score >= threshold) candidates.push({ pred: i, gold: j, score });
    }),
  );
  candidates.sort((x, y) => y.score - x.score || x.pred - y.pred || x.gold - y.gold);

  const usedPred = new Set<number>();
  const usedGold = new Set<number>();
  const pairs: MatchResult["pairs"] = [];
  for (const c of candidates) {
    if (usedPred.has(c.pred) || usedGold.has(c.gold)) continue;
    usedPred.add(c.pred);
    usedGold.add(c.gold);
    pairs.push(c);
  }
  pairs.sort((x, y) => x.pred - y.pred);
  return {
    pairs,
    unmatchedPred: pred.map((_, i) => i).filter((i) => !usedPred.has(i)),
    unmatchedGold: gold.map((_, j) => j).filter((j) => !usedGold.has(j)),
  };
}
