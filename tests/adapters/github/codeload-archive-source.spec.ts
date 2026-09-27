import { describe, expect, it } from "vitest";
import { stripArchiveRoot } from "../../../src/adapters/github/codeload-archive-source.ts";

describe("stripArchiveRoot", () => {
  it("removes the archive's own root directory", () => {
    expect(
      stripArchiveRoot("nest-master/sample/01-cats-app/package.json"),
    ).toBe("sample/01-cats-app/package.json");
  });

  it("returns null for the root entry itself", () => {
    expect(stripArchiveRoot("nest-master/")).toBeNull();
    expect(stripArchiveRoot("nest-master")).toBeNull();
  });

  it("returns null for anything not under the expected root", () => {
    expect(stripArchiveRoot("somethingelse/sample/x")).toBeNull();
  });
});
