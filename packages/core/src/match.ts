// Fuzzy matching for list items and material names. Deliberately simple and
// explainable: normalized token sets compared with the Dice coefficient. The
// threshold is validated against human judgments (data/matcher-validation.csv).

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

/** Provisional until the owner's same/different labels are in (see SCORING.md). */
export const MATCH_THRESHOLD = 0.5;

function singular(token: string): string {
  if (token.length <= 3 || token.endsWith("ss")) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  // "boxes"/"brushes"/"glasses" drop -es; "fuses"/"hoses" only drop -s (silent e).
  if (/(?:x|z|ch|sh|ss)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "") // possessive: "plumber's" → "plumber"
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(singular);
}

/** Token-set Dice coefficient: 2|A∩B| / (|A|+|B|), in [0, 1]. */
export function similarity(a: string, b: string): number {
  const A = new Set(normalizeTokens(a));
  const B = new Set(normalizeTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
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
export function matchOneToOne(pred: string[], gold: string[], threshold: number): MatchResult {
  const candidates: { pred: number; gold: number; score: number }[] = [];
  pred.forEach((p, i) =>
    gold.forEach((g, j) => {
      const score = similarity(p, g);
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
