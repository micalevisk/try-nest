import { describe, expect, it } from "vitest";
import { scaffoldSample } from "../../src/application/scaffold-sample.ts";
import type {
  ArchiveEntry,
  SampleArchiveSource,
  WorkspaceWriter,
} from "../../src/application/ports.ts";
import { TryNestError } from "../../src/domain/errors.ts";
import { planScaffold } from "../../src/domain/scaffold-plan.ts";

const plan = planScaffold(
  {
    id: "01-cats-app",
    displayName: "01-cats-app",
    layout: "single",
    subProjects: [],
  },
  "cats",
);

async function* streamOf(
  entries: readonly ArchiveEntry[],
): AsyncIterable<ArchiveEntry> {
  for (const entry of entries) yield entry;
}

const emptyArchive: SampleArchiveSource = {
  entries: () => streamOf([]),
};

describe("scaffoldSample", () => {
  it("hands the plan and the entry stream to the writer", async () => {
    let received: string | undefined;
    const writer: WorkspaceWriter = {
      materialize: async (received_plan) => {
        received = received_plan.targetDirectory;
      },
    };

    await scaffoldSample(plan, emptyArchive, writer);

    expect(received).toBe("cats");
  });

  it("names the directory it left behind when extraction fails midway", async () => {
    const writer: WorkspaceWriter = {
      materialize: async () => {
        throw new Error("disk full");
      },
    };

    await expect(
      scaffoldSample(plan, emptyArchive, writer),
    ).rejects.toMatchObject({
      kind: "extraction-failed",
      details: { directory: "cats" },
    });
  });

  it("lets an already-translated domain failure through unchanged", async () => {
    const writer: WorkspaceWriter = {
      materialize: async () => {
        throw new TryNestError("unsafe-archive-entry", "nope");
      },
    };

    await expect(
      scaffoldSample(plan, emptyArchive, writer),
    ).rejects.toMatchObject({
      kind: "unsafe-archive-entry",
    });
  });
});
