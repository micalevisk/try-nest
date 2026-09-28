import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ArchiveEntry, WorkspaceWriter } from "../../application/ports.ts";
import { TryNestError } from "../../domain/errors.ts";
import { rerootEntryPath } from "../../domain/scaffold-plan.ts";
import type { ScaffoldPlan } from "../../domain/scaffold-plan.ts";

export function createWorkspaceWriter(): WorkspaceWriter {
  return {
    async materialize(
      plan: ScaffoldPlan,
      entries: AsyncIterable<ArchiveEntry>,
    ): Promise<void> {
      const targetRoot = resolve(plan.targetDirectory);
      await mkdir(targetRoot, { recursive: true });

      for await (const entry of entries) {
        const relative = rerootEntryPath(plan, entry.path);
        if (relative === null) continue;

        const destination = resolve(join(targetRoot, relative));

        // Belt and braces. The domain already rejects traversal, but this is
        // the only code that writes, so it checks the resolved result too.
        if (
          destination !== targetRoot &&
          !destination.startsWith(targetRoot + sep)
        ) {
          throw new TryNestError(
            "unsafe-archive-entry",
            `Refusing to write "${entry.path}" outside the target directory.`,
            { entry: entry.path },
          );
        }

        if (entry.kind === "directory") {
          await mkdir(destination, { recursive: true });
          continue;
        }

        if (entry.kind !== "file") continue;

        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, Readable.from(entry.body));

        const permissions = entry.mode & 0o777;
        if (permissions !== 0) await chmod(destination, permissions);
      }
    },
  };
}
