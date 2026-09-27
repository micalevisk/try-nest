import { TryNestError, isTryNestError } from "../domain/errors.ts";
import type { ScaffoldPlan } from "../domain/scaffold-plan.ts";
import type { SampleArchiveSource, WorkspaceWriter } from "./ports.ts";

export async function scaffoldSample(
  plan: ScaffoldPlan,
  archive: SampleArchiveSource,
  writer: WorkspaceWriter,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await writer.materialize(plan, archive.entries(signal));
  } catch (error) {
    if (isTryNestError(error)) throw error;

    // The tool aims not to leave debris, but if it did, the user must not have
    // to guess where it is.
    throw new TryNestError(
      "extraction-failed",
      `Failed while extracting into "${plan.targetDirectory}". You may need to remove it before retrying.`,
      { directory: plan.targetDirectory },
    );
  }
}
