import { readdir, stat } from "node:fs/promises";
import type { TargetDirectoryProbe } from "../../application/ports.ts";
import type { DirectoryState } from "../../domain/target-directory.ts";

export function createTargetDirectoryProbe(): TargetDirectoryProbe {
  return {
    async inspect(path: string): Promise<DirectoryState> {
      try {
        const stats = await stat(path);

        if (!stats.isDirectory()) {
          return { exists: true, isDirectory: false, isEmpty: false };
        }

        const contents = await readdir(path);
        return {
          exists: true,
          isDirectory: true,
          isEmpty: contents.length === 0,
        };
      } catch {
        return { exists: false, isDirectory: false, isEmpty: true };
      }
    },
  };
}
