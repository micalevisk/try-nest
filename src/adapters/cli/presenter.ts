import type { Presenter } from "../../application/ports.ts";
import type { TryNestError } from "../../domain/errors.ts";
import type { PackageManager } from "../../domain/package-manager.ts";
import type { ScaffoldPlan } from "../../domain/scaffold-plan.ts";
import {
  UPSTREAM_OWNER,
  UPSTREAM_REF,
  UPSTREAM_REPOSITORY,
} from "../github/constants.ts";

/** User error exits 2; a run the user ended exits 130; a broken world exits 1. */
export function exitCodeFor(error: TryNestError): number {
  switch (error.kind) {
    case "input-required":
    case "target-directory-unusable":
    case "sample-not-found":
      return 2;
    // The conventional code for a run ended by an interactive interrupt, which
    // is what a shell reports for SIGINT.
    case "cancelled":
      return 130;
    default:
      return 1;
  }
}

export function renderFailure(error: TryNestError): string {
  const directory = error.details.directory;

  switch (error.kind) {
    case "rate-limited":
      return `${error.message}\n\nThis is a request quota, not an outage — the same command should work again shortly.`;
    case "catalog-incomplete":
      return `${error.message}\n\nThe listing came back incomplete, so some samples would be missing. This usually means upstream has outgrown a single request.`;
    case "extraction-failed":
      return `${error.message}${directory === undefined ? "" : `\n\nPartial output may remain in "${directory}".`}`;
    case "install-failed":
      return `${error.message}\n\nYour project was created successfully — only the dependency install failed. Run the install again inside the directory.`;
    default:
      return error.message;
  }
}

export function createPresenter(
  stream: NodeJS.WritableStream = process.stderr,
): Presenter {
  const write = (line: string): void => {
    stream.write(`${line}\n`);
  };

  return {
    starting() {
      write("Fetching the available NestJS samples…");
    },
    scaffolding(plan: ScaffoldPlan) {
      write(`Scaffolding ${plan.sample.id} into ${plan.targetDirectory}…`);
    },
    installing(directory: string) {
      write(`Installing dependencies in ${directory}…`);
    },
    succeeded(
      plan: ScaffoldPlan,
      installed: boolean,
      manager?: PackageManager,
    ) {
      const tool = manager ?? "npm";
      const upstream = `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/tree/${UPSTREAM_REF}/sample/${plan.sample.id}`;

      write("");
      write(`Done. ${plan.sample.id} is ready in ${plan.targetDirectory}.`);
      write("");
      write("Next steps:");
      write(`  cd ${plan.targetDirectory}`);

      if (plan.sample.layout === "composite") {
        // A composite holds no manifest of its own — that is how it is
        // classified — so there is nothing to install or start at its root.
        write("");
        write(
          `This sample is ${plan.sample.subProjects.length} projects side by side. Each runs on its own:`,
        );
        for (const unit of plan.sample.subProjects) {
          write("");
          write(`  cd ${unit}`);
          if (!installed) write(`  ${tool} install`);
          write(`  ${tool} run start:dev`);
          write(`  cd ..`);
        }
      } else {
        if (!installed) write(`  ${tool} install`);
        write(`  ${tool} run start:dev`);
      }

      write("");
      write(`Upstream: ${upstream}`);
    },
    warn(message: string) {
      write(`Warning: ${message}`);
    },
    failed(error: TryNestError) {
      write("");
      write(renderFailure(error));
    },
  };
}
