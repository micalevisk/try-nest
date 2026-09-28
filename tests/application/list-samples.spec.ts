import { describe, expect, it } from "vitest";
import { listSamples } from "../../src/application/list-samples.ts";
import type { SampleCatalogSource } from "../../src/application/ports.ts";
import { TryNestError } from "../../src/domain/errors.ts";

function sourceOf(paths: readonly string[]): SampleCatalogSource {
  return { listPaths: async () => paths };
}

describe("listSamples", () => {
  it("turns repository paths into a catalog", async () => {
    const samples = await listSamples(
      sourceOf([
        "sample/01-cats-app/package.json",
        "sample/02-gateways/package.json",
        "packages/core/package.json",
      ]),
    );

    expect(samples.map((s) => s.id)).toEqual(["01-cats-app", "02-gateways"]);
  });

  it("fails loudly when the catalog comes back empty", async () => {
    await expect(listSamples(sourceOf([]))).rejects.toThrowError(TryNestError);
  });

  it("lets a source failure through untouched", async () => {
    const failing: SampleCatalogSource = {
      listPaths: async () => {
        throw new TryNestError("rate-limited", "quota exhausted");
      },
    };

    await expect(listSamples(failing)).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });
});
