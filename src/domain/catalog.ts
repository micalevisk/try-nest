import { TryNestError } from "./errors.ts";
import type { Sample } from "./sample.ts";

export const SAMPLES_ROOT = "sample";
export const MANIFEST_FILENAME = "package.json";

/**
 * Derives the catalog from a flat list of repository paths.
 *
 * A directory beneath the samples root is a `single` sample when it holds a
 * manifest of its own, and a `composite` sample when it holds none but its
 * immediate children do. Anything else is ignored. Nesting deeper than one
 * level is deliberately unsupported — see docs/domain-model.md.
 *
 * Pure: no sample name appears here, which is what lets new upstream samples
 * work with no release (ADR-0003).
 */
export function buildCatalog(paths: readonly string[]): readonly Sample[] {
  const singles = new Set<string>();
  const nested = new Map<string, Set<string>>();

  for (const path of paths) {
    const segments = path.split("/");
    if (segments[0] !== SAMPLES_ROOT) continue;
    if (segments.at(-1) !== MANIFEST_FILENAME) continue;

    if (segments.length === 3) {
      singles.add(segments[1] as string);
    } else if (segments.length === 4) {
      const name = segments[1] as string;
      const child = segments[2] as string;
      const children = nested.get(name) ?? new Set<string>();
      children.add(child);
      nested.set(name, children);
    }
  }

  const samples: Sample[] = [];

  for (const id of singles) {
    samples.push({
      id,
      displayName: id,
      layout: "single",
      subProjects: [],
    });
  }

  for (const [id, children] of nested) {
    // A directory holding its own manifest is a single sample, whatever else
    // it contains.
    if (singles.has(id)) continue;

    samples.push({
      id,
      displayName: id,
      layout: "composite",
      subProjects: [...children].sort(),
    });
  }

  return samples.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every manifest that describes this sample.
 *
 * A single sample owns one. A composite owns none of its own, so it answers
 * with its sub-projects' — all of them, because no one of them speaks for the
 * whole sample (ADR-0009).
 */
export function manifestPathsFor(sample: Sample): readonly string[] {
  if (sample.layout !== "composite") {
    return [`${SAMPLES_ROOT}/${sample.id}/${MANIFEST_FILENAME}`];
  }

  return sample.subProjects.map(
    (subProject) =>
      `${SAMPLES_ROOT}/${sample.id}/${subProject}/${MANIFEST_FILENAME}`,
  );
}

export function findSample(samples: readonly Sample[], id: string): Sample {
  const match = samples.find((sample) => sample.id === id);
  if (match !== undefined) return match;

  const needle = id.toLowerCase();
  const close = samples
    .filter((sample) => sample.id.toLowerCase().includes(needle))
    .slice(0, 5)
    .map((sample) => sample.id);

  throw new TryNestError(
    "sample-not-found",
    close.length === 0
      ? `No sample named "${id}". Run with --list to see what is available.`
      : `No sample named "${id}". Did you mean: ${close.join(", ")}?`,
    { requested: id },
  );
}
