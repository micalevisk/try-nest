import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { describe, expect, it } from "vitest";
import {
  createCodeloadArchiveSource,
  stripArchiveRoot,
} from "../../../src/adapters/github/codeload-archive-source.ts";
import type { SampleArchiveSource } from "../../../src/application/ports.ts";

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

/**
 * Builds a gzipped tarball shaped like GitHub's repository archive.
 *
 * `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: the bare form widens
 * to `ArrayBufferLike`, which `Response` refuses as a body because it might be
 * shared memory.
 */
async function gzippedArchive(
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

async function drain(source: SampleArchiveSource): Promise<number> {
  let seen = 0;
  for await (const entry of source.entries()) {
    for await (const _chunk of entry.body) {
      // Consume the entry so the stream advances.
    }
    seen += 1;
  }
  return seen;
}

describe("createCodeloadArchiveSource failure handling", () => {
  it("reads a well-formed archive to the end", async () => {
    const bytes = await gzippedArchive({
      "sample/01-cats-app/package.json": "{}",
      "sample/01-cats-app/src/main.ts": "export {};",
    });

    const source = createCodeloadArchiveSource({
      fetch: async () => new Response(bytes, { status: 200 }),
    });

    expect(await drain(source)).toBe(2);
  });

  it("translates a body that is not an archive instead of crashing", async () => {
    const source = createCodeloadArchiveSource({
      fetch: async () =>
        new Response(new TextEncoder().encode("<html>captive portal</html>"), {
          status: 200,
        }),
    });

    await expect(drain(source)).rejects.toMatchObject({
      kind: "archive-unavailable",
    });
  });

  it("translates a download that stops midway instead of crashing", async () => {
    const bytes = await gzippedArchive({
      "sample/01-cats-app/package.json": "{}",
    });

    const source = createCodeloadArchiveSource({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 32));
              controller.error(new Error("terminated"));
            },
          }),
          { status: 200 },
        ),
    });

    await expect(drain(source)).rejects.toMatchObject({
      kind: "archive-unavailable",
    });
  });

  it("cancels the download when the consumer stops early", async () => {
    let cancelled = false;
    const bytes = await gzippedArchive({
      "sample/01-cats-app/a.txt": "a",
      "sample/01-cats-app/b.txt": "b",
    });

    const source = createCodeloadArchiveSource({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              // Deliberately left open, like a download still in flight.
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200 },
        ),
    });

    for await (const entry of source.entries()) {
      void entry;
      break;
    }

    for (let attempt = 0; attempt < 50 && !cancelled; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(cancelled).toBe(true);
  });
});
