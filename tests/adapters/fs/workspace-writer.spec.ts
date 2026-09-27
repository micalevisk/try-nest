import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceWriter } from "../../../src/adapters/fs/workspace-writer.ts";
import type { ArchiveEntry } from "../../../src/application/ports.ts";
import { planScaffold } from "../../../src/domain/scaffold-plan.ts";

const sample = {
  id: "01-cats-app",
  displayName: "01-cats-app",
  layout: "single" as const,
  subProjects: [],
};

function fileEntry(path: string, contents: string, mode = 0o644): ArchiveEntry {
  return {
    path,
    kind: "file",
    mode,
    body: (async function* () {
      yield new TextEncoder().encode(contents);
    })(),
  };
}

async function* streamOf(...entries: ArchiveEntry[]): AsyncIterable<ArchiveEntry> {
  for (const entry of entries) yield entry;
}

describe("createWorkspaceWriter", () => {
  it("writes the sample's own files at the target root", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await createWorkspaceWriter().materialize(
      plan,
      streamOf(
        fileEntry("sample/01-cats-app/package.json", '{"name":"cats"}'),
        fileEntry("sample/01-cats-app/src/main.ts", "export {};"),
      ),
    );

    expect(await readFile(join(target, "package.json"), "utf8")).toBe(
      '{"name":"cats"}',
    );
    expect(await readFile(join(target, "src", "main.ts"), "utf8")).toBe(
      "export {};",
    );
  });

  it("writes nothing that belongs to another sample", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await createWorkspaceWriter().materialize(
      plan,
      streamOf(
        fileEntry("sample/01-cats-app/keep.txt", "keep"),
        fileEntry("sample/02-gateways/skip.txt", "skip"),
        fileEntry("packages/core/skip.txt", "skip"),
      ),
    );

    expect(await readFile(join(target, "keep.txt"), "utf8")).toBe("keep");
    await expect(stat(join(target, "skip.txt"))).rejects.toThrow();
  });

  it("refuses an entry that would escape the target directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await expect(
      createWorkspaceWriter().materialize(
        plan,
        streamOf(fileEntry("sample/01-cats-app/../../escaped.txt", "bad")),
      ),
    ).rejects.toMatchObject({ kind: "unsafe-archive-entry" });

    await expect(stat(join(root, "escaped.txt"))).rejects.toThrow();
  });

  it("preserves the executable bit", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await createWorkspaceWriter().materialize(
      plan,
      streamOf(fileEntry("sample/01-cats-app/run.sh", "#!/bin/sh\n", 0o755)),
    );

    const stats = await stat(join(target, "run.sh"));
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });
});
