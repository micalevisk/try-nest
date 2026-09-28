import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { describe, expect, it } from "vitest";
import { createCodeloadArchiveSource } from "../../src/adapters/github/codeload-archive-source.ts";
import { createWorkspaceWriter } from "../../src/adapters/fs/workspace-writer.ts";
import { scaffoldSample } from "../../src/application/scaffold-sample.ts";
import type { Sample } from "../../src/domain/sample.ts";
import { planScaffold } from "../../src/domain/scaffold-plan.ts";

/**
 * Builds a gzipped tarball shaped like GitHub's repository archive.
 *
 * `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: the bare form widens
 * to `ArrayBufferLike`, which `Response` refuses as a body because it might be
 * shared memory.
 */
async function buildArchive(
  files: Readonly<Record<string, string>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const tarball = pack();
  for (const [name, contents] of Object.entries(files)) {
    tarball.entry({ name: `nest-master/${name}` }, contents);
  }
  tarball.finalize();

  const chunks: Uint8Array[] = [];
  for await (const chunk of tarball) chunks.push(chunk as Uint8Array);

  return gzipSync(Buffer.concat(chunks));
}

function archiveResponse(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, { status: 200 });
}

async function walk(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const full = join(directory, name);
      if ((await stat(full)).isDirectory()) await visit(full);
      else found.push(full);
    }
  }

  await visit(root);
  return found;
}

const RELATIVE_SPECIFIER = /["'](\.[^"']*)["']/g;

/**
 * Asserts nothing in the scaffolded tree resolves outside its own root — the
 * standalone-output invariant (ADR-0008).
 */
async function assertStandalone(root: string): Promise<void> {
  const absoluteRoot = resolve(root);

  for (const file of await walk(root)) {
    if (!/\.(ts|mts|js|mjs|json)$/.test(file)) continue;

    const contents = await readFile(file, "utf8");

    for (const match of contents.matchAll(RELATIVE_SPECIFIER)) {
      const specifier = match[1] as string;
      const resolved = resolve(dirname(file), specifier);

      expect(
        resolved === absoluteRoot || resolved.startsWith(absoluteRoot + sep),
        `${relative(root, file)} references "${specifier}", which escapes the scaffolded project`,
      ).toBe(true);
    }
  }
}

const sample: Sample = {
  id: "01-cats-app",
  displayName: "01-cats-app",
  layout: "single",
  subProjects: [],
};

describe("scaffolding end to end", () => {
  it("produces a standalone project rooted at the target directory", async () => {
    const bytes = await buildArchive({
      "package.json": '{"name":"monorepo"}',
      "packages/core/index.ts": "export {};",
      "sample/02-gateways/src/main.ts": "export {};",
      "sample/01-cats-app/package.json":
        '{"name":"cats","dependencies":{"@nestjs/core":"^12.0.0"}}',
      "sample/01-cats-app/tsconfig.json": '{"compilerOptions":{}}',
      "sample/01-cats-app/tsconfig.build.json": '{"extends":"./tsconfig.json"}',
      "sample/01-cats-app/src/main.ts":
        'import { AppModule } from "./app.module.js";',
      "sample/01-cats-app/e2e/cats/cats.e2e-spec.ts":
        'import { CatsModule } from "../../src/cats/cats.module.js";',
    });

    const root = await mkdtemp(join(tmpdir(), "try-nest-e2e-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    const archive = createCodeloadArchiveSource({
      fetch: async () => archiveResponse(bytes),
    });

    await scaffoldSample(plan, archive, createWorkspaceWriter());

    // The sample's own files land at the root, not nested under sample/.
    expect(await readFile(join(target, "package.json"), "utf8")).toContain(
      "cats",
    );
    await expect(stat(join(target, "sample"))).rejects.toThrow();
    await expect(stat(join(target, "packages"))).rejects.toThrow();

    // Nothing from another sample came along.
    await expect(stat(join(target, "src", "main.ts"))).resolves.toBeTruthy();

    await assertStandalone(target);
  });

  it("scaffolds every sub-project of a composite sample", async () => {
    const bytes = await buildArchive({
      "sample/31-federation/gateway/package.json": '{"name":"gateway"}',
      "sample/31-federation/posts-application/package.json": '{"name":"posts"}',
      "sample/31-federation/users-application/package.json": '{"name":"users"}',
    });

    const root = await mkdtemp(join(tmpdir(), "try-nest-e2e-"));
    const target = join(root, "federation");

    const composite: Sample = {
      id: "31-federation",
      displayName: "31-federation",
      layout: "composite",
      subProjects: ["gateway", "posts-application", "users-application"],
    };

    const plan = planScaffold(composite, target);
    expect(plan.installUnits).toHaveLength(3);

    await scaffoldSample(
      plan,
      createCodeloadArchiveSource({
        fetch: async () => archiveResponse(bytes),
      }),
      createWorkspaceWriter(),
    );

    for (const unit of plan.installUnits) {
      await expect(
        stat(join(target, unit, "package.json")),
      ).resolves.toBeTruthy();
    }

    await assertStandalone(target);
  });
});
