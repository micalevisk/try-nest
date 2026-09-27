import { describe, expect, it } from "vitest";
import {
  assertSufficientForNonInteractive,
  parseParameters,
} from "../../../src/adapters/cli/parameters.ts";

describe("parseParameters", () => {
  it("defaults to an all-interactive run", () => {
    const inputs = parseParameters([]);

    expect(inputs.sample).toBeUndefined();
    expect(inputs.directory).toBeUndefined();
    expect(inputs.install).toBeUndefined();
  });

  it("reads the long flags", () => {
    const inputs = parseParameters([
      "--sample",
      "01-cats-app",
      "--dir",
      "cats",
      "--package-manager",
      "pnpm",
      "--install",
    ]);

    expect(inputs).toMatchObject({
      sample: "01-cats-app",
      directory: "cats",
      packageManager: "pnpm",
      install: true,
    });
  });

  it("reads the short flags", () => {
    expect(parseParameters(["-s", "02-gateways", "-d", "gw"])).toMatchObject({
      sample: "02-gateways",
      directory: "gw",
    });
  });

  it("treats --no-install as an explicit no", () => {
    expect(parseParameters(["--no-install"]).install).toBe(false);
  });

  it("rejects an unknown package manager", () => {
    expect(() => parseParameters(["--package-manager", "cargo"])).toThrowError(
      /cargo/,
    );
  });

  it("rejects an unknown flag", () => {
    expect(() => parseParameters(["--turbo"])).toThrowError();
  });
});

describe("assertSufficientForNonInteractive", () => {
  it("passes when everything needed was supplied", () => {
    expect(() =>
      assertSufficientForNonInteractive(
        parseParameters(["-s", "01-cats-app", "-d", "cats", "--no-install"]),
      ),
    ).not.toThrow();
  });

  it("names the missing sample rather than hanging on a prompt", () => {
    expect(() =>
      assertSufficientForNonInteractive(parseParameters(["-d", "cats"])),
    ).toThrowError(/--sample/);
  });

  it("names the missing directory", () => {
    expect(() =>
      assertSufficientForNonInteractive(parseParameters(["-s", "01-cats-app"])),
    ).toThrowError(/--dir/);
  });

  it("accepts --yes in place of the directory, which then defaults", () => {
    expect(() =>
      assertSufficientForNonInteractive(
        parseParameters(["-s", "01-cats-app", "--yes"]),
      ),
    ).not.toThrow();
  });

  it("needs nothing else when only listing", () => {
    expect(() =>
      assertSufficientForNonInteractive(parseParameters(["--list"])),
    ).not.toThrow();
  });
});
