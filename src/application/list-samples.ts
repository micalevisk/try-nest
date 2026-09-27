import { buildCatalog } from "../domain/catalog.ts";
import { TryNestError } from "../domain/errors.ts";
import type { Sample } from "../domain/sample.ts";
import type { SampleCatalogSource } from "./ports.ts";

export async function listSamples(
  source: SampleCatalogSource,
  signal?: AbortSignal,
): Promise<readonly Sample[]> {
  const paths = await source.listPaths(signal);
  const catalog = buildCatalog(paths);

  if (catalog.length === 0) {
    throw new TryNestError(
      "catalog-unavailable",
      "No samples were found upstream. The repository layout may have changed.",
    );
  }

  return catalog;
}
