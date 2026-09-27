import { describe, expect, it } from "vitest";
import {
  ARCHIVE_ENDPOINT,
  RAW_CONTENT_BASE,
} from "../../src/adapters/github/constants.ts";
import { createTreeCatalogSource } from "../../src/adapters/github/tree-catalog-source.ts";
import { buildCatalog, manifestPathFor } from "../../src/domain/catalog.ts";

const live = process.env.TRY_NEST_LIVE === "1";

/**
 * These run against the real nestjs/nest. They are opt-in so the ordinary
 * suite stays offline, and scheduled in CI so drift is caught before a user
 * hits it. See docs/upstream-contract.md for what each assumption protects.
 */
describe.skipIf(!live)("upstream contract", () => {
  it("still returns a complete listing (assumption A2)", async () => {
    await expect(createTreeCatalogSource().listPaths()).resolves.toBeTruthy();
  }, 30_000);

  it("still holds a plausible number of samples (S1, S2)", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());

    expect(catalog.length).toBeGreaterThanOrEqual(30);
  }, 30_000);

  it("still contains multi-project samples (S3)", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());
    const composites = catalog.filter((s) => s.layout === "composite");

    expect(composites.length).toBeGreaterThan(0);
    expect(composites[0]?.subProjects.length).toBeGreaterThan(1);
  }, 30_000);

  it("still serves manifests from the raw content host (A3)", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());
    const first = catalog[0];
    if (first === undefined) throw new Error("catalog was empty");

    const response = await fetch(
      `${RAW_CONTENT_BASE}/${manifestPathFor(first)}`,
    );

    expect(response.ok).toBe(true);
  }, 30_000);

  it("still serves the repository archive (A4)", async () => {
    const response = await fetch(ARCHIVE_ENDPOINT, { method: "HEAD" });

    expect(response.ok).toBe(true);
  }, 30_000);
});
