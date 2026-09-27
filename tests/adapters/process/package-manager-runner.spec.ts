import { describe, expect, it } from "vitest";
import {
  executableFor,
  installArgsFor,
  spawnPlanFor,
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

describe("spawnPlanFor", () => {
  it("runs the binary directly off Windows", () => {
    expect(spawnPlanFor("pnpm", ["install"], "linux")).toEqual({
      command: "pnpm",
      args: ["install"],
    });
  });

  it("goes through cmd.exe on Windows, because a .cmd shim cannot be spawned directly", () => {
    // Since the CVE-2024-27980 hardening, spawning a .bat/.cmd without a shell
    // fails with EINVAL. The documented ways are a shell, exec(), or passing the
    // file to cmd.exe — and `shell: true` is itself deprecated (DEP0190).
    const plan = spawnPlanFor("npm", ["install"], "win32");

    expect(plan.command.toLowerCase()).toContain("cmd.exe");
    expect(plan.args).toEqual(["/c", "npm.cmd", "install"]);
  });

  it("still goes through cmd.exe for bun, whose executable is a real .exe", () => {
    const plan = spawnPlanFor("bun", ["--version"], "win32");

    expect(plan.args).toEqual(["/c", "bun.exe", "--version"]);
  });

  it("never asks node to spawn a .cmd file directly", () => {
    for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
      const plan = spawnPlanFor(manager, ["install"], "win32");
      expect(plan.command.endsWith(".cmd")).toBe(false);
    }
  });
});
