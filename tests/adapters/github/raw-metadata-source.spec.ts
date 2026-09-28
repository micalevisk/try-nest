import { describe, expect, it } from "vitest";
import { createRawMetadataSource } from "../../../src/adapters/github/raw-metadata-source.ts";
import { stubResponse } from "../../helpers/fixtures.ts";

describe("createRawMetadataSource", () => {
  it("reads the description out of a manifest", async () => {
    const source = createRawMetadataSource({
      fetch: async () =>
        stubResponse({ body: { description: "Cats, but REST" } }),
    });

    expect(
      await source.readDescription("sample/01-cats-app/package.json"),
    ).toBe("Cats, but REST");
  });

  it("requests the manifest from the raw content host", async () => {
    let seen = "";
    const source = createRawMetadataSource({
      fetch: async (url) => {
        seen = url;
        return stubResponse({ body: {} });
      },
    });

    await source.readDescription("sample/01-cats-app/package.json");

    expect(seen).toContain("raw.githubusercontent.com");
    expect(seen).toContain("sample/01-cats-app/package.json");
  });

  it("returns nothing when the manifest is missing", async () => {
    const source = createRawMetadataSource({
      fetch: async () => stubResponse({ status: 404 }),
    });

    expect(
      await source.readDescription("sample/nope/package.json"),
    ).toBeUndefined();
  });

  it("returns nothing when the manifest has no description", async () => {
    const source = createRawMetadataSource({
      fetch: async () => stubResponse({ body: { name: "x" } }),
    });

    expect(await source.readDescription("a/package.json")).toBeUndefined();
  });

  it("returns nothing for an empty description", async () => {
    const source = createRawMetadataSource({
      fetch: async () => stubResponse({ body: { description: "   " } }),
    });

    expect(await source.readDescription("a/package.json")).toBeUndefined();
  });

  it("survives malformed JSON", async () => {
    const source = createRawMetadataSource({
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => {
            throw new SyntaxError("unexpected token");
          },
        }) as unknown as Response,
    });

    expect(await source.readDescription("a/package.json")).toBeUndefined();
  });
});
