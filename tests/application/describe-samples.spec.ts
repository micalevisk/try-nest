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

    expect(result[0]?.description).toBe("describes sample/01-a/package.json");
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
});

const composite: Sample = {
  id: "31-federation",
  displayName: "31-federation",
  layout: "composite",
  subProjects: ["gateway", "posts-application", "users-application"],
};

describe("describeSamples, for a composite sample", () => {
  it("reads every sub-project's manifest, not just the first", async () => {
    const seen: string[] = [];
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        seen.push(path);
        return undefined;
      },
    };

    await describeSamples([composite], source);

    expect(seen.sort()).toEqual([
      "sample/31-federation/gateway/package.json",
      "sample/31-federation/posts-application/package.json",
      "sample/31-federation/users-application/package.json",
    ]);
  });

  it("borrows its first sub-project's description, verbatim", async () => {
    const descriptions: Record<string, string> = {
      gateway: "Code-first Apollo Federation gateway over users and posts",
      "posts-application": "Code-first Apollo Federation subgraph for posts",
      "users-application": "Code-first Apollo Federation subgraph for users",
    };
    const source: SampleMetadataSource = {
      readDescription: async (path) => descriptions[path.split("/")[2] ?? ""],
    };

    const [result] = await describeSamples([composite], source);

    expect(result?.description).toBe(
      "Code-first Apollo Federation gateway over users and posts",
    );
  });

  it("falls back to the next sub-project when the first one fails", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        if (path.includes("gateway")) throw new Error("404");
        return "Schema-first Apollo Federation subgraph";
      },
    };

    const [result] = await describeSamples([composite], source);

    expect(result?.description).toBe("Schema-first Apollo Federation subgraph");
  });

  // Lookup order, not arrival order: whichever request wins the race, the
  // gateway's description is the one shown whenever it arrived at all.
  it("prefers the first sub-project even when a later one answers first", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        if (path.includes("gateway")) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "Apollo Federation gateway";
        }
        return "Apollo Federation subgraph";
      },
    };

    const [result] = await describeSamples([composite], source);

    expect(result?.description).toBe("Apollo Federation gateway");
  });

  it("is described by the one sub-project that answers", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) =>
        path.includes("users-application")
          ? "Apollo Federation users subgraph"
          : undefined,
    };

    const [result] = await describeSamples([composite], source);

    expect(result?.description).toBe("Apollo Federation users subgraph");
  });

  it("has no description when every sub-project fails", async () => {
    const source: SampleMetadataSource = {
      readDescription: async () => {
        throw new Error("network down");
      },
    };

    const result = await describeSamples([composite], source);

    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBeUndefined();
  });

  it("has no description when it has no sub-projects to read", async () => {
    const source: SampleMetadataSource = {
      readDescription: async () => "never asked for",
    };

    const [result] = await describeSamples(
      [{ ...composite, subProjects: [] }],
      source,
    );

    expect(result?.description).toBeUndefined();
  });
});

// Review Focus 1, end to end. While nestjs/nest#18009 is unmerged every
// manifest carries the same boilerplate; the composite must come out carrying
// that same string, so suppression counts it with the singles and the picker
// looks exactly as it does today.
describe("describeSamples, before upstream descriptions become meaningful", () => {
  it("suppresses the boilerplate on the composite as well as the singles", async () => {
    const boilerplate = "Nest TypeScript starter repository";
    const source: SampleMetadataSource = {
      readDescription: async () => boilerplate,
    };

    const result = await describeSamples([...samples, composite], source);

    expect(result.map((s) => s.description)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

// The deadline in run.ts bounds how long the picker waits, not how much of the
// answer it gets to keep. That only works if describeSamples publishes what it
// has while it still has work in flight.
describe("describeSamples, publishing results as they arrive", () => {
  it("reports a snapshot each time a description lands", async () => {
    const snapshots: ReadonlyArray<string | undefined>[] = [];
    const source: SampleMetadataSource = {
      readDescription: async (path) => `describes ${path}`,
    };

    const result = await describeSamples(samples, source, {
      concurrency: 1,
      onPartial: (partial) => {
        snapshots.push(partial.map((s) => s.description));
      },
    });

    expect(snapshots).toHaveLength(4);
    expect(snapshots[0]).toEqual([
      "describes sample/01-a/package.json",
      undefined,
      undefined,
      undefined,
    ]);
    expect(snapshots.at(-1)).toEqual(result.map((s) => s.description));
  });

  it("suppresses boilerplate in a partial snapshot exactly as in the final one", async () => {
    const boilerplate = "Nest TypeScript starter repository";
    const snapshots: ReadonlyArray<string | undefined>[] = [];
    const source: SampleMetadataSource = {
      readDescription: async () => boilerplate,
    };

    const result = await describeSamples(samples, source, {
      concurrency: 1,
      onPartial: (partial) => {
        snapshots.push(partial.map((s) => s.description));
      },
    });

    // Three of four repeats is where the rule arms. From there on a snapshot
    // must look like the final result, or a user who hits the deadline late
    // sees boilerplate a complete run would have hidden.
    expect(snapshots[2]).toEqual([undefined, undefined, undefined, undefined]);
    expect(snapshots[3]).toEqual([undefined, undefined, undefined, undefined]);
    expect(result.map((s) => s.description)).toEqual(snapshots[3]);
  });

  it("describes a composite from its first answer and does not revise it", async () => {
    const descriptions: Record<string, string> = {
      gateway: "Code-first Apollo Federation gateway",
      "posts-application": "Code-first Apollo Federation subgraph for posts",
      "users-application": "Code-first Apollo Federation subgraph for users",
    };
    const snapshots: (string | undefined)[] = [];
    const source: SampleMetadataSource = {
      readDescription: async (path) => descriptions[path.split("/")[2] ?? ""],
    };

    await describeSamples([composite], source, {
      concurrency: 1,
      onPartial: (partial) => void snapshots.push(partial[0]?.description),
    });

    expect(snapshots).toEqual([
      "Code-first Apollo Federation gateway",
      "Code-first Apollo Federation gateway",
      "Code-first Apollo Federation gateway",
    ]);
  });

  it("still never rejects when the partial callback throws", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => `describes ${path}`,
    };

    const result = await describeSamples(samples, source, {
      onPartial: () => {
        throw new Error("the renderer blew up");
      },
    });

    expect(result[0]?.description).toBe("describes sample/01-a/package.json");
  });
});
