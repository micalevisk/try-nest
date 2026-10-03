import { manifestPathsFor } from "../domain/catalog.ts";
import {
  sharedDescriptionPrefix,
  withoutUninformativeDescriptions,
} from "../domain/description.ts";
import type { Sample } from "../domain/sample.ts";
import type { SampleMetadataSource } from "./ports.ts";

const DEFAULT_CONCURRENCY = 8;

export interface DescribeSamplesOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/** One retrieval, and the sample it answers for. */
interface Lookup {
  readonly sampleIndex: number;
  readonly manifestPath: string;
}

/**
 * Resolves every sample's description concurrently, tolerating partial failure.
 *
 * The unit of work is a manifest, not a sample: a composite owns one per
 * sub-project and is described by the phrase they share, because no single
 * sub-project speaks for the whole sample (ADR-0009).
 *
 * This never rejects. A description is an enhancement: losing one, or all of
 * them, must leave a usable catalog behind (ADR-0006).
 */
export async function describeSamples(
  samples: readonly Sample[],
  source: SampleMetadataSource,
  options: DescribeSamplesOptions = {},
): Promise<readonly Sample[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const lookups: Lookup[] = [];
  for (const [sampleIndex, sample] of samples.entries()) {
    for (const manifestPath of manifestPathsFor(sample)) {
      lookups.push({ sampleIndex, manifestPath });
    }
  }

  const answers = new Array<string | undefined>(lookups.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= lookups.length) return;

      const lookup = lookups[index];
      if (lookup === undefined) return;

      try {
        answers[index] = await source.readDescription(
          lookup.manifestPath,
          options.signal,
        );
      } catch {
        // Individual failures are expected and uninteresting.
        answers[index] = undefined;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, lookups.length) }, worker),
  );

  // Only what actually arrived: a sub-project that failed or answered with
  // nothing simply is not here, which is what lets a composite still describe
  // itself from the rest.
  const arrived: string[][] = samples.map(() => []);
  for (const [index, lookup] of lookups.entries()) {
    const answer = answers[index];
    if (answer === undefined || answer.length === 0) continue;
    arrived[lookup.sampleIndex]?.push(answer);
  }

  const enriched = samples.map((sample, index) => {
    const found = arrived[index] ?? [];
    const description =
      sample.layout === "composite" ? sharedDescriptionPrefix(found) : found[0];

    if (description === undefined || description.length === 0) return sample;
    return { ...sample, description };
  });

  return withoutUninformativeDescriptions(enriched);
}
