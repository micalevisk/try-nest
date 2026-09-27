import { TryNestError } from "./errors.ts";
import type { Sample } from "./sample.ts";

export interface DirectoryState {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isEmpty: boolean;
}

export function defaultTargetDirectoryFor(sample: Sample): string {
  return sample.id;
}

/**
 * The tool never merges into existing content: a destination is usable when it
 * is absent, or an empty directory. Refusing is a domain rule, not a
 * filesystem accident.
 */
export function assertTargetDirectoryUsable(
  name: string,
  state: DirectoryState,
): void {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    throw new TryNestError(
      "target-directory-unusable",
      "A target directory name is required.",
    );
  }

  if (trimmed.split(/[/\\]/).includes("..")) {
    throw new TryNestError(
      "target-directory-unusable",
      `"${name}" would escape the current directory.`,
      { path: name },
    );
  }

  if (!state.exists) return;

  if (!state.isDirectory) {
    throw new TryNestError(
      "target-directory-unusable",
      `"${name}" already exists and is not a directory.`,
      { path: name },
    );
  }

  if (!state.isEmpty) {
    throw new TryNestError(
      "target-directory-unusable",
      `"${name}" already exists and is not empty. Choose another name or clear it first.`,
      { path: name },
    );
  }
}
