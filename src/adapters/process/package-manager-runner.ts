import { spawn } from "node:child_process";
import type { PackageManagerRunner } from "../../application/ports.ts";
import {
  PACKAGE_MANAGERS,
  type PackageManager,
} from "../../domain/package-manager.ts";

/**
 * Windows resolves npm/pnpm/yarn through .cmd shims. Naming the shim directly
 * avoids spawning through a shell, which would otherwise mangle paths
 * containing spaces.
 */
export function executableFor(
  manager: PackageManager,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return manager;
  return manager === "bun" ? "bun.exe" : `${manager}.cmd`;
}

export function installArgsFor(_manager: PackageManager): readonly string[] {
  return ["install"];
}

export interface SpawnPlan {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * How to actually launch a manager, per platform.
 *
 * On Windows the managers are `.cmd` shims, and since the CVE-2024-27980
 * hardening Node refuses to spawn a `.bat`/`.cmd` without a shell — it fails
 * with EINVAL. The documented alternatives are a shell, `exec()`, or handing
 * the file to `cmd.exe`; `shell: true` is itself deprecated (DEP0190), so we
 * name `cmd.exe` and pass the shim as an argument. That also keeps a `cwd`
 * containing spaces out of any shell's hands, since it travels as an option.
 */
export function spawnPlanFor(
  manager: PackageManager,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): SpawnPlan {
  if (platform !== "win32") {
    return { command: manager, args };
  }

  const shell = process.env.ComSpec ?? "cmd.exe";
  return {
    command: shell,
    args: ["/c", executableFor(manager, platform), ...args],
  };
}

function run(
  manager: PackageManager,
  args: readonly string[],
  cwd: string,
  stdio: "inherit" | "ignore",
): Promise<number> {
  const plan = spawnPlanFor(manager, args);

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(plan.command, [...plan.args], {
      cwd,
      stdio,
      shell: false,
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

export function createPackageManagerRunner(): PackageManagerRunner {
  return {
    async detect(): Promise<readonly PackageManager[]> {
      const available: PackageManager[] = [];

      for (const manager of PACKAGE_MANAGERS) {
        try {
          const code = await run(
            manager,
            ["--version"],
            process.cwd(),
            "ignore",
          );
          if (code === 0) available.push(manager);
        } catch {
          // Not installed. Nothing to report.
        }
      }

      return available;
    },

    async install(directory: string, manager: PackageManager): Promise<void> {
      const code = await run(
        manager,
        installArgsFor(manager),
        directory,
        "inherit",
      );

      if (code !== 0) {
        throw new Error(`${manager} install exited with code ${code}`);
      }
    },
  };
}
