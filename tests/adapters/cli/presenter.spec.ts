import { describe, expect, it } from "vitest";
import {
  exitCodeFor,
  renderFailure,
} from "../../../src/adapters/cli/presenter.ts";
import { TryNestError } from "../../../src/domain/errors.ts";

describe("renderFailure", () => {
  it("explains a rate limit as a quota rather than an outage", () => {
    const message = renderFailure(
      new TryNestError("rate-limited", "quota exhausted", {
        retryInSeconds: "600",
      }),
    );

    expect(message).toMatch(/quota/i);
    expect(message).not.toMatch(/stack/i);
  });

  it("tells the user which directory was left behind", () => {
    const message = renderFailure(
      new TryNestError("extraction-failed", "failed midway", {
        directory: "cats",
      }),
    );

    expect(message).toContain("cats");
  });

  it("refuses to continue on an incomplete catalog, and says why", () => {
    const message = renderFailure(
      new TryNestError("catalog-incomplete", "truncated"),
    );

    expect(message).toMatch(/incomplete/i);
  });
});

describe("exitCodeFor", () => {
  it("distinguishes user error from environmental failure", () => {
    expect(exitCodeFor(new TryNestError("input-required", "x"))).toBe(2);
    expect(
      exitCodeFor(new TryNestError("target-directory-unusable", "x")),
    ).toBe(2);
    expect(exitCodeFor(new TryNestError("sample-not-found", "x"))).toBe(2);

    expect(exitCodeFor(new TryNestError("catalog-unavailable", "x"))).toBe(1);
    expect(exitCodeFor(new TryNestError("rate-limited", "x"))).toBe(1);
  });
});
