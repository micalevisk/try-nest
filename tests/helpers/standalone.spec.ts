import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findEscapes } from "./standalone.ts";

async function treeOf(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "try-nest-standalone-"));

  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents);
  }

  return root;
}

describe("findEscapes", () => {
  it("finds nothing in a self-contained project", async () => {
    const root = await treeOf({
      "package.json": '{"name":"cats"}',
      "tsconfig.build.json": '{"extends":"./tsconfig.json"}',
      "src/main.ts": 'import { App } from "./app.module.js";',
    });

    expect(await findEscapes(root)).toEqual([]);
  });

  it("accepts an e2e spec reaching back into the project's own src", async () => {
    // This is the case a `../../` string search gets wrong: from e2e/<feature>/
    // it resolves to <root>/src/..., which is inside.
    const root = await treeOf({
      "src/cats/cats.module.ts": "export {};",
      "e2e/cats/cats.e2e-spec.ts":
        'import { CatsModule } from "../../src/cats/cats.module.js";',
    });

    expect(await findEscapes(root)).toEqual([]);
  });

  it("reports an import that climbs out of the project", async () => {
    const root = await treeOf({
      "src/main.ts": 'import { Core } from "../../packages/core/index.js";',
    });

    expect(await findEscapes(root)).toEqual([
      {
        file: join("src", "main.ts"),
        specifier: "../../packages/core/index.js",
      },
    ]);
  });

  it("reports a manifest extending something outside the project", async () => {
    const root = await treeOf({
      "tsconfig.json": '{"extends":"../../tsconfig.base.json"}',
    });

    expect(await findEscapes(root)).toHaveLength(1);
  });

  it("ignores files it cannot reason about", async () => {
    const root = await treeOf({
      "README.md": "see ../../elsewhere",
      "logo.svg": '<svg href="../../x"/>',
    });

    expect(await findEscapes(root)).toEqual([]);
  });
});
