import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import type {
  ArchiveEntry,
  SampleArchiveSource,
} from "../../application/ports.ts";
import { TryNestError, isTryNestError } from "../../domain/errors.ts";
import { ARCHIVE_ENDPOINT, ARCHIVE_ROOT } from "./constants.ts";
import { defaultHeaders, translateHttpFailure } from "./http.ts";
import type { FetchLike } from "./http.ts";

/**
 * The tarball nests everything under a single root directory named for the
 * repository and ref. Removing it is archive-format knowledge, so it belongs
 * here rather than in the domain.
 */
export function stripArchiveRoot(entryName: string): string | null {
  const prefix = `${ARCHIVE_ROOT}/`;
  if (!entryName.startsWith(prefix)) return null;

  const rest = entryName.slice(prefix.length);
  return rest.length === 0 ? null : rest;
}

export interface CodeloadArchiveSourceOptions {
  readonly fetch?: FetchLike;
  readonly endpoint?: string;
}

export function createCodeloadArchiveSource(
  options: CodeloadArchiveSourceOptions = {},
): SampleArchiveSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? ARCHIVE_ENDPOINT;

  return {
    async *entries(signal?: AbortSignal): AsyncIterable<ArchiveEntry> {
      let response: Response;

      try {
        response = await doFetch(endpoint, {
          headers: defaultHeaders(),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (isTryNestError(error)) throw error;
        throw new TryNestError(
          "archive-unavailable",
          "Could not download the sample archive from GitHub.",
        );
      }

      if (!response.ok || response.body === null) {
        throw translateHttpFailure(response, "archive-unavailable");
      }

      const tar = extract();

      // `lib.dom`'s ReadableStream and the one `node:stream` consumes are the
      // same object at runtime but not assignable to one another in types.
      const downloaded = Readable.fromWeb(
        response.body as unknown as WebReadableStream<Uint8Array>,
      );

      downloaded.pipe(createGunzip()).pipe(tar);

      for await (const entry of tar) {
        const path = stripArchiveRoot(entry.header.name);

        if (path !== null) {
          yield {
            path,
            kind:
              entry.header.type === "file"
                ? "file"
                : entry.header.type === "directory"
                  ? "directory"
                  : "other",
            mode: entry.header.mode,
            // tar-stream types an entry as `AsyncIterable<unknown>`; it yields
            // chunks of bytes.
            body: entry as AsyncIterable<Uint8Array>,
          };
        }

        // Drain whatever the consumer did not read, so the stream advances.
        entry.resume();
      }
    },
  };
}
