import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/adapters/cli/run.ts";
import type { RunDependencies } from "../../../src/adapters/cli/run.ts";
import type { ArchiveEntry } from "../../../src/application/ports.ts";
import { TryNestError } from "../../../src/domain/errors.ts";

async function* streamOf(
  entries: readonly ArchiveEntry[],
): AsyncIterable<ArchiveEntry> {
  for (const entry of entries) yield entry;
}

function depsWith(overrides: Partial<RunDependencies> = {}): {
  deps: RunDependencies;
  lines: string[];
} {
  const lines: string[] = [];

  const deps: RunDependencies = {
    catalog: {
      listPaths: async () => [
        "sample/01-cats-app/package.json",
        "sample/02-gateways/package.json",
      ],
    },
    metadata: { readDescription: async () => undefined },
    archive: { entries: () => streamOf([]) },
    writer: { materialize: async () => {} },
    probe: {
      inspect: async () => ({
        exists: false,
        isDirectory: false,
        isEmpty: true,
      }),
    },
    runner: { detect: async () => ["npm"], install: async () => {} },
    interaction: {
      chooseSample: async (samples) => samples[0] as never,
      chooseTargetDirectory: async (suggested) => suggested,
      confirmInstall: async () => false,
      choosePackageManager: async () => "npm",
    },
    presenter: {
      starting: () => {},
      scaffolding: () => {},
      installing: () => {},
      succeeded: () => lines.push("succeeded"),
      warn: (message) => lines.push(`warn:${message}`),
      failed: (error) => lines.push(`failed:${error.kind}`),
    },
    stdout: { write: (chunk: string) => void lines.push(chunk.trimEnd()) },
    ...overrides,
  };

  return { deps, lines };
}

const nonInteractive = { interactive: false, version: "0.0.0-test" };

describe("run", () => {
  it("scaffolds without prompting when every input is supplied", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const { deps, lines } = depsWith();

    const code = await run(
      ["--sample", "01-cats-app", "--dir", join(root, "cats"), "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(lines).toContain("succeeded");
  });

  it("lists the samples and exits", async () => {
    const { deps, lines } = depsWith();

    const code = await run(["--list"], deps, nonInteractive);

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("01-cats-app");
  });

  it("exits 2 for an unknown sample", async () => {
    const { deps, lines } = depsWith();

    const code = await run(
      ["--sample", "99-nope", "--dir", "x", "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(2);
    expect(lines).toContain("failed:sample-not-found");
  });

  it("exits 2 when a required input is missing and there is no terminal", async () => {
    const { deps, lines } = depsWith();

    const code = await run([], deps, nonInteractive);

    expect(code).toBe(2);
    expect(lines).toContain("failed:input-required");
  });

  it("exits 1 when upstream rate limits us", async () => {
    const { deps, lines } = depsWith({
      catalog: {
        listPaths: async () => {
          throw new TryNestError("rate-limited", "quota exhausted");
        },
      },
    });

    const code = await run(
      ["--sample", "01-cats-app", "--dir", "x", "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(1);
    expect(lines).toContain("failed:rate-limited");
  });

  it("still succeeds when the install fails, and warns instead", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const { deps, lines } = depsWith({
      runner: {
        detect: async () => ["npm"],
        install: async () => {
          throw new Error("network down");
        },
      },
    });

    const code = await run(
      [
        "--sample",
        "01-cats-app",
        "--dir",
        join(root, "cats"),
        "--install",
        "--package-manager",
        "npm",
      ],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(lines).toContain("succeeded");
    expect(lines.some((line) => line.startsWith("warn:"))).toBe(true);
  });
});
