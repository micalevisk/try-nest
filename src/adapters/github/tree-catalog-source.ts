import type { SampleCatalogSource } from "../../application/ports.ts";
import { TryNestError, isTryNestError } from "../../domain/errors.ts";
import { TREE_ENDPOINT } from "./constants.ts";
import { defaultHeaders, translateHttpFailure } from "./http.ts";
import type { FetchLike } from "./http.ts";

interface TreeEntry {
  readonly path?: unknown;
  readonly type?: unknown;
}

interface TreeResponse {
  readonly tree?: readonly TreeEntry[];
  readonly truncated?: unknown;
}

export interface TreeCatalogSourceOptions {
  readonly fetch?: FetchLike;
  readonly endpoint?: string;
}

export function createTreeCatalogSource(
  options: TreeCatalogSourceOptions = {},
): SampleCatalogSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? TREE_ENDPOINT;

  return {
    async listPaths(signal?: AbortSignal): Promise<readonly string[]> {
      let response: Response;

      try {
        response = await doFetch(endpoint, {
          headers: defaultHeaders(),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (isTryNestError(error)) throw error;
        throw new TryNestError(
          "catalog-unavailable",
          "Could not reach GitHub to list the available samples. Check your network connection.",
        );
      }

      if (!response.ok) {
        throw translateHttpFailure(response, "catalog-unavailable");
      }

      let payload: TreeResponse;

      try {
        payload = (await response.json()) as TreeResponse;
      } catch {
        // A captive portal or an intercepting proxy answers 200 with HTML. The
        // parser's complaint about an unexpected "<" is not an answer.
        throw new TryNestError(
          "catalog-unavailable",
          "GitHub answered, but not with a repository listing. Something on this network may be intercepting the request.",
        );
      }

      // A truncated listing arrives as a success with partial results. A loud
      // failure is vastly preferable to a catalog that is quietly incomplete.
      if (payload.truncated === true) {
        throw new TryNestError(
          "catalog-incomplete",
          "GitHub returned an incomplete listing of the repository, so some samples would be missing. Refusing to continue.",
        );
      }

      const entries = payload.tree ?? [];

      return entries
        .filter(
          (entry) => entry.type === "blob" && typeof entry.path === "string",
        )
        .map((entry) => entry.path as string);
    },
  };
}
