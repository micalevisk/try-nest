import { describe, expect, it } from "vitest";
import {
  sharedDescriptionPrefix,
  withoutUninformativeDescriptions,
} from "../../src/domain/description.ts";
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

describe("sharedDescriptionPrefix", () => {
  it("returns the leading words every description shares", () => {
    expect(
      sharedDescriptionPrefix([
        "Code-first Apollo Federation gateway over users and posts",
        "Code-first Apollo Federation subgraph exposing users",
        "Code-first Apollo Federation subgraph exposing posts",
      ]),
    ).toBe("Code-first Apollo Federation");
  });

  it("returns undefined when the descriptions share no leading word", () => {
    expect(sharedDescriptionPrefix(["Caching", "Logging"])).toBeUndefined();
  });

  it("returns undefined for a single description", () => {
    expect(sharedDescriptionPrefix(["Caching with Redis"])).toBeUndefined();
  });

  it("returns undefined for no descriptions", () => {
    expect(sharedDescriptionPrefix([])).toBeUndefined();
  });

  it("rejects a one-word prefix, which describes nothing", () => {
    expect(
      sharedDescriptionPrefix(["Caching with Redis", "Caching layer"]),
    ).toBeUndefined();
  });

  it("drops a dangling connective so the phrase does not end mid-clause", () => {
    expect(
      sharedDescriptionPrefix([
        "GraphQL federation gateway for users",
        "GraphQL federation gateway for posts",
      ]),
    ).toBe("GraphQL federation gateway");
  });

  it("drops trailing punctuation left behind by the split", () => {
    expect(
      sharedDescriptionPrefix([
        "Testing utilities, with mocks",
        "Testing utilities, with spies",
      ]),
    ).toBe("Testing utilities");
  });

  it("compares case-sensitively, so a case mismatch is not a shared word", () => {
    expect(
      sharedDescriptionPrefix([
        "Apollo federation gateway",
        "Apollo Federation gateway",
      ]),
    ).toBeUndefined();
  });

  // Review Focus 1. Before #18009 merges every sub-project carries the same
  // boilerplate, and the combined result has to come back byte-for-byte equal
  // to it — otherwise withoutUninformativeDescriptions counts the composite
  // separately from the singles and the composite becomes the one row still
  // showing "Nest TypeScript starter repository".
  it("returns identical descriptions unchanged, so suppression still matches them", () => {
    const boilerplate = "Nest TypeScript starter repository";

    expect(
      sharedDescriptionPrefix([boilerplate, boilerplate, boilerplate]),
    ).toBe(boilerplate);
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(
      sharedDescriptionPrefix([
        "  Redis backed  cache adapter ",
        "Redis backed\ncache invalidation",
      ]),
    ).toBe("Redis backed cache");
  });
});
