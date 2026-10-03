import { manifestPathsFor } from "../domain/catalog.ts";
import { withoutUninformativeDescriptions } from "../domain/description.ts";
import type { Sample } from "../domain/sample.ts";
import type { SampleMetadataSource } from "./ports.ts";

const DEFAULT_CONCURRENCY = 8;

export interface DescribeSamplesOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /**
   * Called with a complete catalog every time a description lands, so a caller
   * that stops waiting early still has what arrived.
   *
   * The snapshot runs the same pick-then-suppress pipeline as the returned
   * value — never a half-built one — so a caller can render it directly. It is
   * therefore a fair picture of the catalog at that instant, not a prediction:
   * a repeated description is only suppressed once enough copies of it have
   * arrived to meet the rule.
   *
   * Optional, and never required for correctness. A throw from it is swallowed
   * like any other failure here: enrichment must not be able to fail the run.
   */
  readonly onPartial?: (samples: readonly Sample[]) => void;
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
 * sub-project, and the first of them to carry a description speaks for the
 * whole sample, verbatim (ADR-0009).
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

  /**
   * The whole pipeline over whatever has answered so far: pick each sample's
   * description, then suppress across samples. One function, so a snapshot and
   * the final result can never diverge — if suppression ran only at the end, a
   * caller rendering a snapshot would show the boilerplate the complete run
   * hides (ADR-0009).
   */
  function catalogSoFar(): readonly Sample[] {
    // Only what actually arrived: a sub-project that failed or answered with
    // nothing simply is not here, which is what lets a composite fall back to
    // the next one.
    const arrived: string[][] = samples.map(() => []);
    for (const [index, lookup] of lookups.entries()) {
      const answer = answers[index];
      if (answer === undefined || answer.length === 0) continue;
      arrived[lookup.sampleIndex]?.push(answer);
    }

    const enriched = samples.map((sample, index) => {
      // Verbatim, and the same rule for both layouts. A composite has no
      // manifest of its own, so its first sub-project to answer stands in for
      // it; ordering is lookup order, not arrival order, so the borrowed text
      // does not depend on which request won the race (ADR-0009).
      const description = (arrived[index] ?? [])[0];

      if (description === undefined || description.length === 0) return sample;
      return { ...sample, description };
    });

    return withoutUninformativeDescriptions(enriched);
  }

  const { onPartial } = options;

  function publish(): void {
    if (onPartial === undefined) return;
    try {
      onPartial(catalogSoFar());
    } catch {
      // A caller that cannot take the news does not get to fail the run.
    }
  }

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

      // Nothing arrived means nothing changed, so there is nothing to report.
      const answer = answers[index];
      if (answer !== undefined && answer.length > 0) publish();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, lookups.length) }, worker),
  );

  return catalogSoFar();
}
