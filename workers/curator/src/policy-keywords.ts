import type { Question } from "./question";

/**
 * Deterministic first pass of the content policy (deaths, violence, self-harm,
 * minors). Conservative on purpose: a false positive only skips a question.
 * The Claude check (policy.ts) covers what words can't: private individuals
 * and outcomes a market participant could decide.
 */
const RULES: [RegExp, string][] = [
  [
    /\b(die|dies|died|death|deaths|dead|deadly|fatalit\w*|casualt\w*|killed|kills?|killing)\b/i,
    "death",
  ],
  [/\b(assassinat\w*|murder\w*|homicide|executed)\b/i, "killing"],
  [/\b(suicide|self[- ]harm|overdose)\b/i, "self-harm"],
  [
    /\b(shooting|terror\w*|bomb\w*|massacre|genocide|hostages?|riots?|violen\w*|airstrikes?|attacks?|invade[sd]?|invasion|missile strikes?)\b/i,
    "violence",
  ],
  [/\b(child|children|minors?|kids?|teen(ager)?s?|underage)\b/i, "minors"],
  [/\b(rape|sexual assault|abuse)\b/i, "abuse"],
];

/** The matched rule's label, or null. Checks title, question text and criteria. */
export function keywordScreen(q: Pick<Question, "title" | "text" | "criteria">): string | null {
  const hay = `${q.title}\n${q.text}\n${q.criteria}`;
  for (const [re, label] of RULES) {
    const m = hay.match(re);
    if (m) return `${label} ("${m[0]}")`;
  }
  return null;
}
