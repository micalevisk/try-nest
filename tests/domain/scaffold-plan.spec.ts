import { describe, expect, it } from "vitest";
import { TryNestError } from "../../src/domain/errors.ts";
import type { Sample } from "../../src/domain/sample.ts";
import { planScaffold, rerootEntryPath } from "../../src/domain/scaffold-plan.ts";

const single: Sample = {
  id: "01-cats-app",
  displayName: "01-cats-app",
  layout: "single",
  subProjects: [],
};

const composite: Sample = {
  id: "31-graphql-federation-code-first",
  displayName: "31-graphql-federation-code-first",
  layout: "composite",
  subProjects: ["gateway", "posts-application", "users-application"],
};

describe("planScaffold", () => {
  it("installs once at the root for a single sample", () => {
    const plan = planScaffold(single, "cats");

    expect(plan.sourcePrefix).toBe("sample/01-cats-app/");
    expect(plan.installUnits).toEqual(["."]);
  });

  it("installs once per sub-project for a composite sample", () => {
    const plan = planScaffold(composite, "federation");

    expect(plan.installUnits).toEqual([
      "gateway",
      "posts-application",
      "users-application",
    ]);
  });
});

describe("rerootEntryPath", () => {
  const plan = planScaffold(single, "cats");

  it("strips the source prefix so the sample lands at the target root", () => {
    expect(rerootEntryPath(plan, "sample/01-cats-app/src/main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("skips anything outside the chosen sample", () => {
    expect(rerootEntryPath(plan, "packages/core/index.ts")).toBeNull();
    expect(rerootEntryPath(plan, "sample/02-gateways/src/main.ts")).toBeNull();
  });

  it("skips the sample directory entry itself", () => {
    expect(rerootEntryPath(plan, "sample/01-cats-app/")).toBeNull();
  });

  it("does not confuse a sibling whose name shares a prefix", () => {
    expect(rerootEntryPath(plan, "sample/01-cats-app-extra/src/main.ts")).toBeNull();
  });

  it("refuses an entry that would escape the target directory", () => {
    expect(() =>
      rerootEntryPath(plan, "sample/01-cats-app/../../../etc/passwd"),
    ).toThrowError(TryNestError);
  });

  it("refuses an absolute entry path", () => {
    expect(() => rerootEntryPath(plan, "sample/01-cats-app//etc/passwd")).toThrowError(
      TryNestError,
    );
  });
});
