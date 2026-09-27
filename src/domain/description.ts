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
