import { describe, expect, it } from "vitest";
import { withoutUninformativeDescriptions } from "../../src/domain/description.ts";
import type { Sample } from "../../src/domain/sample.ts";

function sampleOf(id: string, description?: string): Sample {
  return {
    id,
    displayName: id,
    layout: "single",
    subProjects: [],
    ...(description === undefined ? {} : { description }),
  };
}

describe("withoutUninformativeDescriptions", () => {
  it("drops a description shared by most samples", () => {
    const boilerplate = "Nest TypeScript starter repository";
    const samples = [
      sampleOf("a", boilerplate),
      sampleOf("b", boilerplate),
      sampleOf("c", boilerplate),
      sampleOf("d", "Something specific"),
    ];

    const result = withoutUninformativeDescriptions(samples);

    expect(result.map((s) => s.description)).toEqual([
      undefined,
      undefined,
      undefined,
      "Something specific",
    ]);
  });

  it("keeps descriptions when they distinguish samples", () => {
    const samples = [
      sampleOf("a", "GraphQL federation"),
      sampleOf("b", "TypeORM with SQL"),
      sampleOf("c", "Caching"),
      sampleOf("d", "Caching"),
    ];

    const result = withoutUninformativeDescriptions(samples);

    expect(result.map((s) => s.description)).toEqual([
      "GraphQL federation",
      "TypeORM with SQL",
      "Caching",
      "Caching",
    ]);
  });

  it("leaves a small catalog alone", () => {
    const samples = [sampleOf("a", "same"), sampleOf("b", "same")];

    expect(withoutUninformativeDescriptions(samples)).toEqual(samples);
  });
});
