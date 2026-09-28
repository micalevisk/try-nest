import { SAMPLES_ROOT } from "./catalog.ts";
import { TryNestError } from "./errors.ts";
import type { Sample } from "./sample.ts";

export interface ScaffoldPlan {
  readonly sample: Sample;
  readonly targetDirectory: string;
  /** Repository-relative prefix that gets stripped so the sample lands at the root. */
  readonly sourcePrefix: string;
  /** Directories, relative to the target, that each need their own install. */
  readonly installUnits: readonly string[];
}

export function planScaffold(
  sample: Sample,
  targetDirectory: string,
): ScaffoldPlan {
  return {
    sample,
    targetDirectory,
    sourcePrefix: `${SAMPLES_ROOT}/${sample.id}/`,
    installUnits:
      sample.layout === "composite" ? [...sample.subProjects] : ["."],
  };
}

/**
 * Maps a repository-relative archive path to its path inside the target
 * directory, or null when the entry is not part of the chosen sample.
 *
 * This is where the standalone-output invariant is enforced (ADR-0008): the
 * sample's own contents become the target's contents, and nothing may resolve
 * outside the target.
 */
export function rerootEntryPath(
  plan: ScaffoldPlan,
  repoRelativePath: string,
): string | null {
  if (!repoRelativePath.startsWith(plan.sourcePrefix)) return null;

  const relative = repoRelativePath.slice(plan.sourcePrefix.length);
  if (relative.length === 0) return null;

  // Split on both separators. A tar header uses "/", but an entry may still
  // carry a "\\" that means nothing on POSIX and is a directory separator on
  // Windows — so the guard that runs first must be no laxer than the writer's.
  const segments = relative.split(/[/\\]/);

  // An empty segment means a doubled or leading separator; ".." can escape.
  const unsafe = segments.some(
    (segment, index) =>
      segment === ".." ||
      (segment.length === 0 && index !== segments.length - 1),
  );

  if (unsafe) {
    throw new TryNestError(
      "unsafe-archive-entry",
      `Refusing to extract "${repoRelativePath}": it resolves outside the target directory.`,
      { entry: repoRelativePath },
    );
  }

  return relative;
}
