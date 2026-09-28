import { describe, expect, it } from "vitest";
import { translateHttpFailure } from "../../../src/adapters/github/http.ts";
import { stubResponse } from "../../helpers/fixtures.ts";

describe("translateHttpFailure", () => {
  it("reads an exhausted primary quota as a rate limit", () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const failure = translateHttpFailure(
      stubResponse({
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(reset),
        },
      }),
      "catalog-unavailable",
    );

    expect(failure.kind).toBe("rate-limited");
    expect(failure.message).toMatch(/10 minute/);
  });

  it("reads a secondary rate limit as a rate limit too", () => {
    // GitHub's burst throttling answers 403 with retry-after and no quota
    // headers at all. Enrichment fires one request per sample, which is
    // exactly the pattern that trips it.
    const failure = translateHttpFailure(
      stubResponse({ status: 403, headers: { "retry-after": "60" } }),
      "catalog-unavailable",
    );

    expect(failure.kind).toBe("rate-limited");
  });

  it("reads a bare 429 as a rate limit", () => {
    const failure = translateHttpFailure(
      stubResponse({ status: 429, headers: { "retry-after": "120" } }),
      "catalog-unavailable",
    );

    expect(failure.kind).toBe("rate-limited");
    expect(failure.details.retryInSeconds).toBe("120");
  });

  it("never tells the user to wait about zero minutes", () => {
    const failure = translateHttpFailure(
      stubResponse({ status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      "catalog-unavailable",
    );

    expect(failure.kind).toBe("rate-limited");
    expect(failure.message).not.toMatch(/0 minute/);
  });

  it("rounds a sub-minute wait up rather than down", () => {
    const failure = translateHttpFailure(
      stubResponse({ status: 429, headers: { "retry-after": "5" } }),
      "catalog-unavailable",
    );

    expect(failure.message).toMatch(/1 minute/);
  });

  it("falls back for a plain failure status", () => {
    const failure = translateHttpFailure(
      stubResponse({ status: 500 }),
      "catalog-unavailable",
    );

    expect(failure.kind).toBe("catalog-unavailable");
  });

  it("does not mistake a 403 that is not a quota for one", () => {
    const failure = translateHttpFailure(
      stubResponse({ status: 403, headers: { "x-ratelimit-remaining": "42" } }),
      "catalog-unavailable",
    );

    expect(failure.kind).toBe("catalog-unavailable");
  });
});
