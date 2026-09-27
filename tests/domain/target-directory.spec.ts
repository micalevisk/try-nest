import { describe, expect, it } from "vitest";
import { TryNestError } from "../../src/domain/errors.ts";
import {
  assertTargetDirectoryUsable,
  defaultTargetDirectoryFor,
} from "../../src/domain/target-directory.ts";

const absent = { exists: false, isDirectory: false, isEmpty: true };

describe("assertTargetDirectoryUsable", () => {
  it("accepts a directory that does not exist", () => {
    expect(() => assertTargetDirectoryUsable("cats", absent)).not.toThrow();
  });

  it("accepts an existing empty directory", () => {
    expect(() =>
      assertTargetDirectoryUsable("cats", {
        exists: true,
        isDirectory: true,
        isEmpty: true,
      }),
    ).not.toThrow();
  });

  it("refuses a non-empty directory rather than merging into it", () => {
    expect(() =>
      assertTargetDirectoryUsable("cats", {
        exists: true,
        isDirectory: true,
        isEmpty: false,
      }),
    ).toThrowError(TryNestError);
  });

  it("refuses a path that exists but is not a directory", () => {
    expect(() =>
      assertTargetDirectoryUsable("cats", {
        exists: true,
        isDirectory: false,
        isEmpty: true,
      }),
    ).toThrowError(/not a directory/i);
  });

  it("refuses an empty name", () => {
    expect(() => assertTargetDirectoryUsable("   ", absent)).toThrowError(
      TryNestError,
    );
  });

  it("refuses a name that would escape the working directory", () => {
    expect(() => assertTargetDirectoryUsable("../elsewhere", absent)).toThrowError(
      TryNestError,
    );
  });
});

describe("defaultTargetDirectoryFor", () => {
  it("uses the sample id", () => {
    const sample = {
      id: "05-sql-typeorm",
      displayName: "05-sql-typeorm",
      layout: "single" as const,
      subProjects: [],
    };

    expect(defaultTargetDirectoryFor(sample)).toBe("05-sql-typeorm");
  });
});
