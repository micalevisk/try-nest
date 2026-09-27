import { describe, expect, it } from "vitest";
import {
  executableFor,
  installArgsFor,
} from "../../../src/adapters/process/package-manager-runner.ts";

describe("executableFor", () => {
  it("uses the plain binary name off Windows", () => {
    expect(executableFor("pnpm", "linux")).toBe("pnpm");
    expect(executableFor("npm", "darwin")).toBe("npm");
  });

  it("uses the .cmd shim on Windows, so no shell is needed", () => {
    expect(executableFor("npm", "win32")).toBe("npm.cmd");
    expect(executableFor("yarn", "win32")).toBe("yarn.cmd");
  });

  it("leaves bun alone on Windows, which ships a real executable", () => {
    expect(executableFor("bun", "win32")).toBe("bun.exe");
  });
});

describe("installArgsFor", () => {
  it("installs with every supported manager", () => {
    expect(installArgsFor("npm")).toEqual(["install"]);
    expect(installArgsFor("pnpm")).toEqual(["install"]);
    expect(installArgsFor("yarn")).toEqual(["install"]);
    expect(installArgsFor("bun")).toEqual(["install"]);
  });
});
