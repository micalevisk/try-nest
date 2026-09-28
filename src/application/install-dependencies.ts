import { join } from "node:path";
import type { PackageManager } from "../domain/package-manager.ts";
import type { ScaffoldPlan } from "../domain/scaffold-plan.ts";
import type { PackageManagerRunner } from "./ports.ts";

export interface InstallFailure {
  readonly directory: string;
  readonly reason: string;
}

export interface InstallOutcome {
  readonly failures: readonly InstallFailure[];
}

/**
 * Installs dependencies for every install unit in the plan.
 *
 * Never throws. By the time this runs the project already exists on disk and
 * is intact, so a failure here is a warning, not a failed run — presenting it
 * otherwise would send the user to delete work that is fine.
 */
export async function installDependencies(
  plan: ScaffoldPlan,
  runner: PackageManagerRunner,
  manager: PackageManager,
): Promise<InstallOutcome> {
  const failures: InstallFailure[] = [];

  for (const unit of plan.installUnits) {
    const directory =
      unit === "." ? plan.targetDirectory : join(plan.targetDirectory, unit);

    try {
      await runner.install(directory, manager);
    } catch (error) {
      failures.push({
        directory,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { failures };
}
