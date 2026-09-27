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

function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  stdio: "inherit" | "ignore",
): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [...args], { cwd, stdio, shell: false });
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
            executableFor(manager),
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
        executableFor(manager),
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
