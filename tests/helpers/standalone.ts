import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const RELATIVE_SPECIFIER = /["'](\.[^"']*)["']/g;
const INSPECTED = /\.(ts|mts|cts|js|mjs|cjs|json)$/;

export async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const full = join(directory, name);
      if ((await stat(full)).isDirectory()) await visit(full);
      else found.push(full);
    }
  }

  await visit(root);
  return found;
}

export interface Escape {
  readonly file: string;
  readonly specifier: string;
}

/**
 * Finds every relative specifier in a scaffolded tree that resolves outside the
 * tree — the standalone-output invariant (ADR-0008).
 *
 * Resolves rather than grepping for `../../`: upstream e2e specs sit in
 * `e2e/<feature>/` and import `../../src/...`, which lands back inside the
 * sample and is correct after extraction.
 */
export async function findEscapes(root: string): Promise<readonly Escape[]> {
  const absoluteRoot = resolve(root);
  const escapes: Escape[] = [];

  for (const file of await walkFiles(root)) {
    if (!INSPECTED.test(file)) continue;

    const contents = await readFile(file, "utf8");

    for (const match of contents.matchAll(RELATIVE_SPECIFIER)) {
      const specifier = match[1] as string;
      const resolved = resolve(dirname(file), specifier);

      if (
        resolved !== absoluteRoot &&
        !resolved.startsWith(absoluteRoot + sep)
      ) {
        escapes.push({ file: relative(root, file), specifier });
      }
    }
  }

  return escapes;
}
