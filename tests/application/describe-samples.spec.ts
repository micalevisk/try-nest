import { describe, expect, it } from "vitest";
import { describeSamples } from "../../src/application/describe-samples.ts";
import type { SampleMetadataSource } from "../../src/application/ports.ts";
import type { Sample } from "../../src/domain/sample.ts";

const samples: readonly Sample[] = [
  { id: "01-a", displayName: "01-a", layout: "single", subProjects: [] },
  { id: "02-b", displayName: "02-b", layout: "single", subProjects: [] },
  { id: "03-c", displayName: "03-c", layout: "single", subProjects: [] },
  { id: "04-d", displayName: "04-d", layout: "single", subProjects: [] },
];

describe("describeSamples", () => {
  it("attaches each sample's description", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => `describes ${path}`,
    };

    const result = await describeSamples(samples, source);

    expect(result[0]?.description).toBe(
      "describes sample/01-a/package.json",
    );
  });

  it("swallows a single failure without losing the others", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        if (path.includes("02-b")) throw new Error("404");
        return `ok ${path}`;
      },
    };

    const result = await describeSamples(samples, source);

    expect(result[1]?.description).toBeUndefined();
    expect(result[0]?.description).toBe("ok sample/01-a/package.json");
    expect(result).toHaveLength(4);
  });

  it("returns the plain catalog when every lookup fails", async () => {
    const source: SampleMetadataSource = {
      readDescription: async () => {
        throw new Error("network down");
      },
    };

    const result = await describeSamples(samples, source);

    expect(result.map((s) => s.description)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;

    const source: SampleMetadataSource = {
      readDescription: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return "x";
      },
    };

    await describeSamples(samples, source, { concurrency: 2 });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("reads a composite's description from its first sub-project", async () => {
    const seen: string[] = [];
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        seen.push(path);
        return undefined;
      },
    };

    await describeSamples(
      [
        {
          id: "31-federation",
          displayName: "31-federation",
          layout: "composite",
          subProjects: ["gateway", "posts-application"],
        },
      ],
      source,
    );

    expect(seen).toEqual(["sample/31-federation/gateway/package.json"]);
  });
});
