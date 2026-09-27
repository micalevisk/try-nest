import { describe, expect, it } from "vitest";
import { createTreeCatalogSource } from "../../../src/adapters/github/tree-catalog-source.ts";
import { stubResponse, treeResponseFixture } from "../../helpers/fixtures.ts";

describe("createTreeCatalogSource", () => {
  it("returns only file paths from a recorded response", async () => {
    const source = createTreeCatalogSource({
      fetch: async () => stubResponse({ body: treeResponseFixture }),
    });

    const paths = await source.listPaths();

    expect(paths).toContain("sample/01-cats-app/package.json");
    expect(paths).not.toContain("sample/01-cats-app");
  });

  it("sends a User-Agent, which the API requires", async () => {
    let seen: Headers | undefined;
    const source = createTreeCatalogSource({
      fetch: async (_url, init) => {
        seen = new Headers(init?.headers);
        return stubResponse({ body: treeResponseFixture });
      },
    });

    await source.listPaths();

    expect(seen?.get("user-agent")).toBeTruthy();
  });

  it("refuses a truncated listing rather than returning a short catalog", async () => {
    const source = createTreeCatalogSource({
      fetch: async () =>
        stubResponse({ body: { ...treeResponseFixture, truncated: true } }),
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "catalog-incomplete",
    });
  });

  it("reads an exhausted quota as a rate limit, not an outage", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const source = createTreeCatalogSource({
      fetch: async () =>
        stubResponse({
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(reset),
          },
        }),
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });

  it("treats any other failure status as the catalog being unavailable", async () => {
    const source = createTreeCatalogSource({
      fetch: async () => stubResponse({ status: 500 }),
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "catalog-unavailable",
    });
  });

  it("translates a transport error rather than leaking it", async () => {
    const source = createTreeCatalogSource({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "catalog-unavailable",
    });
  });
});
