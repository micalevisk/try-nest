import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodeloadArchiveSource } from "../../src/adapters/github/codeload-archive-source.ts";
import { createWorkspaceWriter } from "../../src/adapters/fs/workspace-writer.ts";
import { scaffoldSample } from "../../src/application/scaffold-sample.ts";
import type { Sample } from "../../src/domain/sample.ts";
import { planScaffold } from "../../src/domain/scaffold-plan.ts";
import { findEscapes } from "../helpers/standalone.ts";
import {
  ARCHIVE_ENDPOINT,
  RAW_CONTENT_BASE,
} from "../../src/adapters/github/constants.ts";
import { createTreeCatalogSource } from "../../src/adapters/github/tree-catalog-source.ts";
import { buildCatalog, manifestPathsFor } from "../../src/domain/catalog.ts";

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

    const [manifestPath] = manifestPathsFor(first);
    if (manifestPath === undefined) throw new Error("sample had no manifest");

    const response = await fetch(`${RAW_CONTENT_BASE}/${manifestPath}`);

    expect(response.ok).toBe(true);
  }, 30_000);

  it("still serves the repository archive (A4)", async () => {
    const response = await fetch(ARCHIVE_ENDPOINT, { method: "HEAD" });

    expect(response.ok).toBe(true);
  }, 30_000);
});

/**
 * Assumption S5 — each `sample/*` is self-contained — is the expensive one, and
 * the only defence against it drifting is to notice. The offline e2e test
 * asserts the invariant against an archive it invents, so it can never see
 * upstream change. This scaffolds real samples from the real archive.
 */
describe.skipIf(!live)("upstream self-containment (S5)", () => {
  async function scaffoldFromUpstream(sample: Sample): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "try-nest-drift-"));
    const target = join(root, sample.id);

    await scaffoldSample(
      planScaffold(sample, target),
      createCodeloadArchiveSource(),
      createWorkspaceWriter(),
    );

    return target;
  }

  it("a real single sample scaffolds standalone", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());
    const single = catalog.find((entry) => entry.layout === "single");
    if (single === undefined) throw new Error("no single sample upstream");

    const target = await scaffoldFromUpstream(single);

    expect(await readdir(target)).toContain("package.json");
    expect(await findEscapes(target)).toEqual([]);
  }, 300_000);

  it("a real composite sample scaffolds standalone, with every sub-project", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());
    const composite = catalog.find((entry) => entry.layout === "composite");
    if (composite === undefined)
      throw new Error("no composite sample upstream");

    const target = await scaffoldFromUpstream(composite);

    for (const unit of composite.subProjects) {
      expect(await readdir(join(target, unit))).toContain("package.json");
    }

    expect(await findEscapes(target)).toEqual([]);
  }, 300_000);
});
