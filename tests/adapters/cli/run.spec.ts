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
  labels: string[];
} {
  const lines: string[] = [];
  const labels: string[] = [];

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
      installing: () => {},
      succeeded: () => lines.push("succeeded"),
      warn: (message) => lines.push(`warn:${message}`),
      failed: (error) => lines.push(`failed:${error.kind}`),
    },
    progress: {
      while: async (label, work) => {
        labels.push(label);
        return work();
      },
    },
    stdout: { write: (chunk: string) => void lines.push(chunk.trimEnd()) },
    ...overrides,
  };

  return { deps, lines, labels };
}

const nonInteractive = { interactive: false, version: "0.0.0-test" };
const interactive = { interactive: true, version: "0.0.0-test" };

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

  it("names each slow step while it waits", async () => {
    const { deps, labels } = depsWith();

    const code = await run(
      ["--sample", "01-cats-app", "--dir", "cats", "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(labels).toEqual([
      "Fetching the available NestJS samples…",
      "Looking up sample descriptions…",
      "Scaffolding 01-cats-app into cats…",
    ]);
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

describe("run without a terminal", () => {
  function refusingInteraction(): RunDependencies["interaction"] {
    const refuse = (name: string) => async (): Promise<never> => {
      throw new Error(`prompted for ${name} with no terminal`);
    };

    return {
      chooseSample: refuse("sample") as never,
      chooseTargetDirectory: refuse("directory") as never,
      confirmInstall: refuse("install") as never,
      choosePackageManager: refuse("package manager") as never,
    };
  }

  it("never prompts for an install decision", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const { deps, lines } = depsWith({ interaction: refusingInteraction() });

    const code = await run(
      ["--sample", "01-cats-app", "--dir", join(root, "cats")],
      deps,
      nonInteractive,
    );

    expect(code).toBe(2);
    expect(lines).toContain("failed:input-required");
  });

  it("never prompts for a package manager", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const { deps, lines } = depsWith({
      interaction: refusingInteraction(),
      runner: {
        detect: async () => ["npm", "pnpm", "yarn"],
        install: async () => {},
      },
    });

    const code = await run(
      ["--sample", "01-cats-app", "--dir", join(root, "cats"), "--install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(2);
    expect(lines).toContain("failed:input-required");
  });

  it("names the flag that would have answered the question", async () => {
    const { deps } = depsWith({ interaction: refusingInteraction() });
    const messages: string[] = [];
    const observing = {
      ...deps,
      presenter: {
        ...deps.presenter,
        failed: (e: TryNestError) => messages.push(e.message),
      },
    };

    await run(
      ["--sample", "01-cats-app", "--dir", "x"],
      observing,
      nonInteractive,
    );

    expect(messages.join("\n")).toMatch(/--install/);
  });

  it("accepts --yes in place of both install answers", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const installed: string[] = [];
    const { deps, lines } = depsWith({
      interaction: refusingInteraction(),
      runner: {
        detect: async () => ["npm", "pnpm"],
        install: async (directory) => void installed.push(directory),
      },
    });

    const code = await run(
      ["--sample", "01-cats-app", "--dir", join(root, "cats"), "--yes"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(lines).toContain("succeeded");
    expect(installed).toHaveLength(1);
  });
});

describe("run in a terminal", () => {
  it("asks every question before it writes anything", async () => {
    const events: string[] = [];
    const { deps } = depsWith({
      interaction: {
        chooseSample: async (samples) => {
          events.push("chooseSample");
          return samples[0] as never;
        },
        chooseTargetDirectory: async (suggested) => {
          events.push("chooseTargetDirectory");
          return suggested;
        },
        confirmInstall: async () => {
          events.push("confirmInstall");
          return true;
        },
        choosePackageManager: async () => {
          events.push("choosePackageManager");
          return "npm";
        },
      },
      runner: { detect: async () => ["npm", "pnpm"], install: async () => {} },
      writer: { materialize: async () => void events.push("materialize") },
    });

    const code = await run([], deps, interactive);

    expect(code).toBe(0);
    expect(events).toEqual([
      "chooseSample",
      "chooseTargetDirectory",
      "confirmInstall",
      "choosePackageManager",
      "materialize",
    ]);
  });

  it("writes nothing and exits 130 when a question is abandoned", async () => {
    const writes: string[] = [];
    const { deps, lines } = depsWith({
      interaction: {
        chooseSample: async (samples) => samples[0] as never,
        chooseTargetDirectory: async (suggested) => suggested,
        confirmInstall: async () => {
          throw new TryNestError(
            "cancelled",
            "Cancelled. Nothing was written.",
          );
        },
        choosePackageManager: async () => "npm",
      },
      writer: { materialize: async () => void writes.push("materialize") },
    });

    const code = await run([], deps, interactive);

    expect(code).toBe(130);
    expect(writes).toEqual([]);
    expect(lines).toContain("failed:cancelled");
  });

  it("does not relabel a cancellation as a broken world", async () => {
    const { deps, lines } = depsWith({
      interaction: {
        chooseSample: async () => {
          // What createPrompts() rejects with for Ctrl+C as well as for Esc.
          throw new TryNestError(
            "cancelled",
            "Cancelled. Nothing was written.",
          );
        },
        chooseTargetDirectory: async (suggested) => suggested,
        confirmInstall: async () => false,
        choosePackageManager: async () => "npm",
      },
    });

    const code = await run([], deps, interactive);

    expect(code).toBe(130);
    expect(lines).not.toContain("failed:catalog-unavailable");
  });
});

describe("run enrichment lifetime", () => {
  it("cancels description lookups once it has waited long enough", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const signals: AbortSignal[] = [];

    const { deps, lines } = depsWith({
      metadata: {
        readDescription: async (_path, signal) => {
          if (signal !== undefined) signals.push(signal);
          // A host that accepts the connection and never answers.
          await new Promise(() => {});
          return undefined;
        },
      },
    });

    const code = await run(
      ["--sample", "01-cats-app", "--dir", join(root, "cats"), "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(lines).toContain("succeeded");
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  }, 10_000);
});
