import { confirm, input, select } from "@inquirer/prompts";
import type { Interaction } from "../../application/ports.ts";
import type { PackageManager } from "../../domain/package-manager.ts";
import type { Sample } from "../../domain/sample.ts";

export function createPrompts(): Interaction {
  return {
    async chooseSample(samples: readonly Sample[]): Promise<Sample> {
      return select({
        message: "Which sample would you like to try?",
        pageSize: 15,
        choices: samples.map((sample) => ({
          name:
            sample.layout === "composite"
              ? `${sample.displayName}  (${sample.subProjects.length} projects)`
              : sample.displayName,
          value: sample,
          ...(sample.description === undefined
            ? {}
            : { description: sample.description }),
        })),
      });
    },

    async chooseTargetDirectory(suggested: string): Promise<string> {
      return input({
        message: "Where should it go?",
        default: suggested,
      });
    },

    async confirmInstall(): Promise<boolean> {
      return confirm({
        message: "Install dependencies now?",
        default: true,
      });
    },

    async choosePackageManager(
      available: readonly PackageManager[],
    ): Promise<PackageManager> {
      return select({
        message: "Which package manager?",
        choices: available.map((manager) => ({ name: manager, value: manager })),
      });
    },
  };
}
