import type { Sample } from "./sample.ts";

/** Below this many samples, a repeated description is not evidence of anything. */
const MINIMUM_CATALOG_SIZE = 4;
const MINIMUM_REPEATS = 3;

/**
 * A description shared by most samples distinguishes none of them, so it is
 * dropped rather than rendered on every row.
 *
 * Deliberately a computed rule and not a list of known boilerplate strings: it
 * needs no maintenance, and it stops suppressing on its own once upstream
 * descriptions become distinct.
 *
 * **Do not delete this once upstream descriptions become meaningful.** It is
 * the only thing keeping today's output clean while `nestjs/nest#18009` is
 * unmerged, it disables itself the moment that lands, and it re-arms by itself
 * if upstream ever regresses.
 */
export function withoutUninformativeDescriptions(
  samples: readonly Sample[],
): readonly Sample[] {
  if (samples.length < MINIMUM_CATALOG_SIZE) return samples;

  const counts = new Map<string, number>();
  for (const sample of samples) {
    const description = sample.description;
    if (description === undefined || description.length === 0) continue;
    counts.set(description, (counts.get(description) ?? 0) + 1);
  }

  const uninformative = new Set(
    [...counts]
      .filter(
        ([, count]) => count >= MINIMUM_REPEATS && count * 2 > samples.length,
      )
      .map(([description]) => description),
  );

  if (uninformative.size === 0) return samples;

  return samples.map((sample) => {
    if (sample.description === undefined) return sample;
    if (!uninformative.has(sample.description)) return sample;

    const { description: _dropped, ...rest } = sample;
    return rest;
  });
}

/**
 * Words that may legitimately end a sentence nowhere, so a prefix ending on one
 * reads as a cut-off clause rather than a statement. Typography, not content:
 * this list decides where a true phrase stops, never what it says.
 */
const DANGLING_CONNECTIVES = new Set([
  "for",
  "with",
  "and",
  "the",
  "a",
  "an",
  "of",
  "in",
  "via",
  "to",
  "on",
]);

/** Below this, the "prefix" is an article or a bare noun and describes nothing. */
const MINIMUM_PREFIX_WORDS = 2;
/** One description is not evidence of a shared phrase — it is just that description. */
const MINIMUM_DESCRIPTIONS = 2;

/**
 * The longest run of leading whole words every description shares.
 *
 * A composite sample has no manifest of its own, so this is how several
 * sub-project descriptions become one (ADR-0009). Whole words rather than
 * characters: the character-level prefix of "…Federation gateway" and
 * "…Federation subgraph" is "…Federation s", which is worse than nothing.
 *
 * Returns `undefined` unless at least two descriptions were supplied and at
 * least two words survive.
 */
export function sharedDescriptionPrefix(
  descriptions: readonly string[],
): string | undefined {
  if (descriptions.length < MINIMUM_DESCRIPTIONS) return undefined;

  const wordLists = descriptions.map((description) =>
    description.split(/\s+/).filter((word) => word.length > 0),
  );

  const [first, ...rest] = wordLists;
  if (first === undefined) return undefined;

  const shared: string[] = [];
  for (const [index, word] of first.entries()) {
    if (rest.some((words) => words[index] !== word)) break;
    shared.push(word);
  }

  // Walk back off anything that cannot end a phrase. A word that is pure
  // punctuation disappears entirely and the one before it is judged in turn.
  while (shared.length > 0) {
    const last = shared.at(-1) as string;
    const trimmed = last.replace(/[^\p{L}\p{N}]+$/u, "");

    if (
      trimmed.length === 0 ||
      DANGLING_CONNECTIVES.has(trimmed.toLowerCase())
    ) {
      shared.pop();
      continue;
    }

    shared[shared.length - 1] = trimmed;
    break;
  }

  if (shared.length < MINIMUM_PREFIX_WORDS) return undefined;

  return shared.join(" ");
}
