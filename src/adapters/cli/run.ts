import { describeSamples } from "../../application/describe-samples.ts";
import { installDependencies } from "../../application/install-dependencies.ts";
import { listSamples } from "../../application/list-samples.ts";
import type {
  Interaction,
  PackageManagerRunner,
  Presenter,
  SampleArchiveSource,
  SampleCatalogSource,
  SampleMetadataSource,
  TargetDirectoryProbe,
  WorkspaceWriter,
} from "../../application/ports.ts";
import { scaffoldSample } from "../../application/scaffold-sample.ts";
import { findSample } from "../../domain/catalog.ts";
import { TryNestError, isTryNestError } from "../../domain/errors.ts";
import type { PackageManager } from "../../domain/package-manager.ts";
import type { Sample } from "../../domain/sample.ts";
import { planScaffold } from "../../domain/scaffold-plan.ts";
import {
  assertTargetDirectoryUsable,
  defaultTargetDirectoryFor,
} from "../../domain/target-directory.ts";
import { createTargetDirectoryProbe } from "../fs/target-directory-probe.ts";
import { createWorkspaceWriter } from "../fs/workspace-writer.ts";
import { createCodeloadArchiveSource } from "../github/codeload-archive-source.ts";
import { createRawMetadataSource } from "../github/raw-metadata-source.ts";
import { createTreeCatalogSource } from "../github/tree-catalog-source.ts";
import { createPackageManagerRunner } from "../process/package-manager-runner.ts";
import {
  HELP_TEXT,
  assertSufficientForNonInteractive,
  parseParameters,
} from "./parameters.ts";
import { createPresenter, exitCodeFor } from "./presenter.ts";
import { createPrompts } from "./prompts.ts";

/** How long the picker will wait for descriptions before rendering without them. */
const ENRICHMENT_DEADLINE_MS = 1_500;

export interface RunDependencies {
  readonly catalog: SampleCatalogSource;
  readonly metadata: SampleMetadataSource;
  readonly archive: SampleArchiveSource;
  readonly writer: WorkspaceWriter;
  readonly probe: TargetDirectoryProbe;
  readonly runner: PackageManagerRunner;
  readonly interaction: Interaction;
  readonly presenter: Presenter;
  readonly stdout: { write(chunk: string): void };
}

export interface RunEnvironment {
  readonly interactive: boolean;
  /** Printed by --version. Supplied by the entry point from package metadata. */
  readonly version: string;
}

export function createRunDependencies(): RunDependencies {
  return {
    catalog: createTreeCatalogSource(),
    metadata: createRawMetadataSource(),
    archive: createCodeloadArchiveSource(),
    writer: createWorkspaceWriter(),
    probe: createTargetDirectoryProbe(),
    runner: createPackageManagerRunner(),
    interaction: createPrompts(),
    presenter: createPresenter(),
    stdout: { write: (chunk: string) => void process.stdout.write(chunk) },
  };
}

async function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  fallback: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<T>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(fallback), milliseconds);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function run(
  argv: readonly string[],
  deps: RunDependencies,
  env: RunEnvironment,
): Promise<number> {
  try {
    const inputs = parseParameters(argv);

    if (inputs.help) {
      deps.stdout.write(HELP_TEXT);
      return 0;
    }

    if (inputs.version) {
      deps.stdout.write(`${env.version}\n`);
      return 0;
    }

    if (!env.interactive) assertSufficientForNonInteractive(inputs);

    // Start the catalog request before anything is drawn (ADR-0005).
    const catalogPromise = listSamples(deps.catalog);
    deps.presenter.starting();
    const samples = await catalogPromise;

    if (inputs.list) {
      deps.stdout.write(
        inputs.json
          ? `${JSON.stringify(samples.map((s) => ({ id: s.id, layout: s.layout })))}\n`
          : `${samples.map((s) => s.id).join("\n")}\n`,
      );
      return 0;
    }

    // Enrichment is an enhancement: bounded wait, then render regardless.
    const enrichment = new AbortController();
    let enriched: readonly Sample[];

    try {
      enriched = await withDeadline(
        describeSamples(samples, deps.metadata, {
          signal: enrichment.signal,
        }),
        ENRICHMENT_DEADLINE_MS,
        samples,
      );
    } finally {
      // The deadline bounds how long we wait, not how long the requests run.
      // Without this, one request per sample outlives the whole command, and a
      // stalled metadata host leaves the user staring at a dead terminal after
      // we already told them we were done.
      enrichment.abort();
    }

    const sample: Sample =
      inputs.sample === undefined
        ? await deps.interaction.chooseSample(enriched)
        : findSample(enriched, inputs.sample);

    const suggested = defaultTargetDirectoryFor(sample);
    const directory =
      inputs.directory ??
      (inputs.yes || !env.interactive
        ? suggested
        : await deps.interaction.chooseTargetDirectory(suggested));

    assertTargetDirectoryUsable(directory, await deps.probe.inspect(directory));

    const plan = planScaffold(sample, directory);
    deps.presenter.scaffolding(plan);
    await scaffoldSample(plan, deps.archive, deps.writer);

    let installed = false;
    let usedManager: PackageManager | undefined;
    const wantsInstall =
      inputs.install ??
      (inputs.yes || !env.interactive
        ? true
        : await deps.interaction.confirmInstall());

    if (wantsInstall) {
      const available = await deps.runner.detect();
      const manager =
        inputs.packageManager ??
        (available.length <= 1 || inputs.yes || !env.interactive
          ? (available[0] ?? "npm")
          : await deps.interaction.choosePackageManager(available));

      usedManager = manager;

      for (const unit of plan.installUnits) {
        deps.presenter.installing(
          unit === "."
            ? plan.targetDirectory
            : `${plan.targetDirectory}/${unit}`,
        );
      }

      const outcome = await installDependencies(plan, deps.runner, manager);
      installed = outcome.failures.length === 0;

      for (const failure of outcome.failures) {
        deps.presenter.warn(
          `Dependency install failed in ${failure.directory} (${failure.reason}). Your project is intact — run the install again there.`,
        );
      }
    }

    deps.presenter.succeeded(plan, installed, usedManager);
    return 0;
  } catch (error) {
    const failure = isTryNestError(error)
      ? error
      : new TryNestError(
          "catalog-unavailable",
          error instanceof Error ? error.message : String(error),
        );

    deps.presenter.failed(failure);
    return exitCodeFor(failure);
  }
}
