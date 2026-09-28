import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../src/domain/catalog.ts";

describe("buildCatalog", () => {
  it("treats a directory with its own manifest as a single sample", () => {
    const catalog = buildCatalog([
      "sample/01-cats-app/package.json",
      "sample/01-cats-app/src/main.ts",
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: "01-cats-app",
      layout: "single",
      subProjects: [],
    });
  });

  it("treats a manifest-less directory whose children have manifests as composite", () => {
    const catalog = buildCatalog([
      "sample/31-graphql-federation-code-first/gateway/package.json",
      "sample/31-graphql-federation-code-first/posts-application/package.json",
      "sample/31-graphql-federation-code-first/users-application/package.json",
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: "31-graphql-federation-code-first",
      layout: "composite",
      subProjects: ["gateway", "posts-application", "users-application"],
    });
  });

  it("ignores paths outside the samples root", () => {
    const catalog = buildCatalog([
      "packages/core/package.json",
      "integration/hello-world/package.json",
      "sample/01-cats-app/package.json",
    ]);

    expect(catalog.map((s) => s.id)).toEqual(["01-cats-app"]);
  });

  it("ignores a samples directory that contains no manifest at any supported depth", () => {
    const catalog = buildCatalog([
      "sample/99-docs-only/README.md",
      "sample/98-too-deep/a/b/package.json",
    ]);

    expect(catalog).toEqual([]);
  });

  it("prefers single when a directory has both its own and nested manifests", () => {
    const catalog = buildCatalog([
      "sample/weird/package.json",
      "sample/weird/nested/package.json",
    ]);

    expect(catalog[0]).toMatchObject({ layout: "single", subProjects: [] });
  });

  it("orders samples by id so upstream numbering is preserved", () => {
    const catalog = buildCatalog([
      "sample/10-fastify/package.json",
      "sample/02-gateways/package.json",
      "sample/01-cats-app/package.json",
    ]);

    expect(catalog.map((s) => s.id)).toEqual([
      "01-cats-app",
      "02-gateways",
      "10-fastify",
    ]);
  });
});
