import type { TryNestError } from "../domain/errors.ts";
import type { PackageManager } from "../domain/package-manager.ts";
import type { Sample } from "../domain/sample.ts";
import type { ScaffoldPlan } from "../domain/scaffold-plan.ts";
import type { DirectoryState } from "../domain/target-directory.ts";

/** "What samples exist right now?" */
export interface SampleCatalogSource {
  listPaths(signal?: AbortSignal): Promise<readonly string[]>;
}

/** "Describe the sample whose manifest lives at this repository path." */
export interface SampleMetadataSource {
  readDescription(
    manifestPath: string,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
}

export interface ArchiveEntry {
  /** Repository-relative; the archive's own root segment is already stripped. */
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
  readonly mode: number;
  readonly body: AsyncIterable<Uint8Array>;
}

/** "Give me this sample's bytes." */
export interface SampleArchiveSource {
  entries(signal?: AbortSignal): AsyncIterable<ArchiveEntry>;
}

export interface WorkspaceWriter {
  materialize(
    plan: ScaffoldPlan,
    entries: AsyncIterable<ArchiveEntry>,
  ): Promise<void>;
}

export interface TargetDirectoryProbe {
  inspect(path: string): Promise<DirectoryState>;
}

export interface PackageManagerRunner {
  detect(): Promise<readonly PackageManager[]>;
  install(directory: string, manager: PackageManager): Promise<void>;
}

export interface Interaction {
  chooseSample(samples: readonly Sample[]): Promise<Sample>;
  chooseTargetDirectory(suggested: string): Promise<string>;
  confirmInstall(): Promise<boolean>;
  choosePackageManager(
    available: readonly PackageManager[],
  ): Promise<PackageManager>;
}

export interface Presenter {
  installing(directory: string): void;
  /** `manager` is the one actually used, so next steps name the right tool. */
  succeeded(
    plan: ScaffoldPlan,
    installed: boolean,
    manager?: PackageManager,
  ): void;
  warn(message: string): void;
  failed(error: TryNestError): void;
}
