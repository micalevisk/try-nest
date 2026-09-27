import { TryNestError } from "../../domain/errors.ts";
import type { FailureKind } from "../../domain/errors.ts";
import { USER_AGENT } from "./constants.ts";

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export function defaultHeaders(): Record<string, string> {
  return { "user-agent": USER_AGENT };
}

/**
 * Turns a transport-level failure into something the core can reason about.
 * No status code ever crosses this boundary (ADR-0004).
 */
export function translateHttpFailure(
  response: Response,
  fallback: FailureKind,
): TryNestError {
  const remaining = response.headers.get("x-ratelimit-remaining");

  if ((response.status === 403 || response.status === 429) && remaining === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const waitSeconds = Number.isFinite(reset)
      ? Math.max(0, reset - Math.floor(Date.now() / 1000))
      : undefined;

    return new TryNestError(
      "rate-limited",
      waitSeconds === undefined
        ? "GitHub's request quota for this network is exhausted. Try again later."
        : `GitHub's request quota for this network is exhausted. Try again in about ${Math.ceil(waitSeconds / 60)} minute(s).`,
      waitSeconds === undefined ? {} : { retryInSeconds: String(waitSeconds) },
    );
  }

  return new TryNestError(
    fallback,
    `Upstream request failed with status ${response.status}.`,
    { status: String(response.status) },
  );
}
