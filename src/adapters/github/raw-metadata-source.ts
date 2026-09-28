import type { SampleMetadataSource } from "../../application/ports.ts";
import { RAW_CONTENT_BASE } from "./constants.ts";
import { defaultHeaders } from "./http.ts";
import type { FetchLike } from "./http.ts";

interface Manifest {
  readonly description?: unknown;
}

export interface RawMetadataSourceOptions {
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

/**
 * A description is an enhancement, so every failure here resolves to
 * `undefined` rather than rejecting — the caller must not have to care.
 */
export function createRawMetadataSource(
  options: RawMetadataSourceOptions = {},
): SampleMetadataSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? RAW_CONTENT_BASE;

  return {
    async readDescription(
      manifestPath: string,
      signal?: AbortSignal,
    ): Promise<string | undefined> {
      try {
        const response = await doFetch(`${baseUrl}/${manifestPath}`, {
          headers: defaultHeaders(),
          ...(signal === undefined ? {} : { signal }),
        });

        if (!response.ok) return undefined;

        const manifest = (await response.json()) as Manifest;
        if (typeof manifest.description !== "string") return undefined;

        const description = manifest.description.trim();
        return description.length === 0 ? undefined : description;
      } catch {
        return undefined;
      }
    },
  };
}
