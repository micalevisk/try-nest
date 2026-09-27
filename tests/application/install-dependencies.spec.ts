import { describe, expect, it } from "vitest";
import { installDependencies } from "../../src/application/install-dependencies.ts";
import type { PackageManagerRunner } from "../../src/application/ports.ts";
import { planScaffold } from "../../src/domain/scaffold-plan.ts";

const single = planScaffold(
  {
    id: "01-cats-app",
    displayName: "01-cats-app",
    layout: "single",
    subProjects: [],
  },
  "cats",
);

const composite = planScaffold(
  {
    id: "31-federation",
    displayName: "31-federation",
    layout: "composite",
    subProjects: ["gateway", "posts-application"],
  },
  "federation",
);

function recordingRunner(failOn: string[] = []): {
  runner: PackageManagerRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const runner: PackageManagerRunner = {
    detect: async () => ["npm"],
    install: async (directory) => {
      calls.push(directory);
      if (failOn.some((needle) => directory.includes(needle))) {
        throw new Error("install blew up");
      }
    },
  };
  return { runner, calls };
}

describe("installDependencies", () => {
  it("installs once at the root for a single sample", async () => {
    const { runner, calls } = recordingRunner();

    const outcome = await installDependencies(single, runner, "npm");

    expect(calls).toEqual(["cats"]);
    expect(outcome.failures).toEqual([]);
  });

  it("installs once per sub-project for a composite sample", async () => {
    const { runner, calls } = recordingRunner();

    await installDependencies(composite, runner, "npm");

    expect(calls).toEqual([
      "federation/gateway",
      "federation/posts-application",
    ]);
  });

  it("records a failure without throwing, and keeps going", async () => {
    const { runner, calls } = recordingRunner(["gateway"]);

    const outcome = await installDependencies(composite, runner, "npm");

    expect(calls).toHaveLength(2);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.directory).toBe("federation/gateway");
  });
});
