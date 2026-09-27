import { manifestPathFor } from "../domain/catalog.ts";
import { withoutUninformativeDescriptions } from "../domain/description.ts";
import type { Sample } from "../domain/sample.ts";
import type { SampleMetadataSource } from "./ports.ts";

const DEFAULT_CONCURRENCY = 8;

export interface DescribeSamplesOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/**
 * Resolves every sample's description concurrently, tolerating partial failure.
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
  const descriptions = new Array<string | undefined>(samples.length);

  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= samples.length) return;

      const sample = samples[index];
      if (sample === undefined) return;

      try {
        descriptions[index] = await source.readDescription(
          manifestPathFor(sample),
          options.signal,
        );
      } catch {
        // Individual failures are expected and uninteresting.
        descriptions[index] = undefined;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, samples.length) }, worker),
  );

  const enriched = samples.map((sample, index) => {
    const description = descriptions[index];
    if (description === undefined || description.length === 0) return sample;
    return { ...sample, description };
  });

  return withoutUninformativeDescriptions(enriched);
}
