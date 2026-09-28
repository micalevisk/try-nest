import { TryNestError } from "../../domain/errors.ts";
import type { FailureKind } from "../../domain/errors.ts";
import { USER_AGENT } from "./constants.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function defaultHeaders(): Record<string, string> {
  return { "user-agent": USER_AGENT };
}

/**
 * Is this response GitHub telling us to slow down?
 *
 * Two shapes, not one. The primary quota answers with
 * `x-ratelimit-remaining: 0`. The secondary (burst) limit answers 403 or 429
 * with `retry-after` and no quota headers at all — which matters here, because
 * enrichment fires one request per sample and that is exactly the pattern that
 * trips it.
 */
function isThrottled(response: Response): boolean {
  if (response.status !== 403 && response.status !== 429) return false;
  if (response.headers.get("x-ratelimit-remaining") === "0") return true;

  return response.headers.has("retry-after");
}

/** Seconds to wait, when the response says; `undefined` when it does not. */
function retryDelaySeconds(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }

  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const resetsAt = Number(reset);
    if (Number.isFinite(resetsAt)) {
      return Math.max(0, resetsAt - Math.floor(Date.now() / 1000));
    }
  }

  return undefined;
}

/**
 * Turns a transport-level failure into something the core can reason about.
 * The core never reads a status code; it reads a `FailureKind` (ADR-0004).
 */
export function translateHttpFailure(
  response: Response,
  fallback: FailureKind,
): TryNestError {
  if (isThrottled(response)) {
    const waitSeconds = retryDelaySeconds(response);

    if (waitSeconds === undefined) {
      return new TryNestError(
        "rate-limited",
        "GitHub's request quota for this network is exhausted. Try again later.",
      );
    }

    // Floor the display at one minute: "wait about 0 minutes" reads as a bug,
    // and a missing or skewed reset header makes zero easy to arrive at.
    const minutes = Math.max(1, Math.ceil(waitSeconds / 60));

    return new TryNestError(
      "rate-limited",
      `GitHub's request quota for this network is exhausted. Try again in about ${minutes} minute(s).`,
      { retryInSeconds: String(waitSeconds) },
    );
  }

  return new TryNestError(
    fallback,
    `Upstream request failed with status ${response.status}.`,
    { status: String(response.status) },
  );
}
