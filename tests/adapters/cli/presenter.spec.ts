import { describe, expect, it } from "vitest";
import {
  createPresenter,
  exitCodeFor,
  renderFailure,
} from "../../../src/adapters/cli/presenter.ts";
import type { Presenter } from "../../../src/application/ports.ts";
import { TryNestError } from "../../../src/domain/errors.ts";
import { planScaffold } from "../../../src/domain/scaffold-plan.ts";

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

function captured(): { presenter: Presenter; output: () => string } {
  const chunks: string[] = [];
  const stream = { write: (chunk: string) => void chunks.push(chunk) };

  return {
    presenter: createPresenter(stream as unknown as NodeJS.WritableStream),
    output: () => chunks.join(""),
  };
}

const single = planScaffold(
  {
    id: "01-cats-app",
    displayName: "01-cats-app",
    layout: "single",
    subProjects: [],
  },
  "cats",
);

const composite = planScaffold(
  {
    id: "31-graphql-federation-code-first",
    displayName: "31-graphql-federation-code-first",
    layout: "composite",
    subProjects: ["gateway", "posts-application", "users-application"],
  },
  "federation",
);

describe("createPresenter().succeeded", () => {
  it("tells a single sample's user how to enter and start it", () => {
    const { presenter, output } = captured();

    presenter.succeeded(single, true);

    expect(output()).toContain("cd cats");
    expect(output()).toContain("npm run start:dev");
  });

  it("does not tell a composite's user to start a project that has no manifest", () => {
    const { presenter, output } = captured();

    presenter.succeeded(composite, true);

    // A composite has no root package.json — that is how it is classified — so
    // a bare `npm run start:dev` at the root cannot work.
    expect(output()).not.toMatch(/cd federation\n\s+npm run start:dev/);
  });

  it("names each of a composite's sub-projects", () => {
    const { presenter, output } = captured();

    presenter.succeeded(composite, true);

    for (const unit of composite.installUnits) {
      expect(output()).toContain(unit);
    }
  });

  it("suggests the install command for the manager that was actually chosen", () => {
    const { presenter, output } = captured();

    presenter.succeeded(single, false, "pnpm");

    expect(output()).toContain("pnpm install");
    // "pnpm install" contains "npm install", so compare whole lines.
    expect(
      output()
        .split("\n")
        .map((line) => line.trim()),
    ).not.toContain("npm install");
  });
});
