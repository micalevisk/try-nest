/**
 * A spinner for work slow enough to look hung. `while` owns the whole
 * lifecycle — start, frames, stop, clear — so no caller can leak a live
 * interval into the next render, and no `finally` has to be remembered.
 *
 * Deliberately not a port: no use case reports progress, only the composition
 * root does, so an application-layer interface would have no consumer.
 */
export interface Progress {
  /** Runs `work` under a spinner labelled `label`. Stops it on success and on throw. */
  while<T>(label: string, work: () => Promise<T>): Promise<T>;
}

/** `columns` is a TTY's; a plain writable has none. */
export type ProgressStream = NodeJS.WritableStream & {
  readonly columns?: number;
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;
const CLEAR_LINE = "\r\x1b[K";
const FALLBACK_COLUMNS = 80;

export function createProgress(
  stream: ProgressStream = process.stderr,
  // Whether the *user's* terminal animates is a question about process.stderr
  // even when the writes are directed somewhere else, so the default probes it
  // rather than `stream`. Tests pass both arguments explicitly.
  animated: boolean = process.stderr.isTTY === true &&
    process.env.TERM !== "dumb",
): Progress {
  return {
    async while<T>(label: string, work: () => Promise<T>): Promise<T> {
      // Not a terminal: keep the single static line CI logs have today, and let
      // no escape sequence reach a pipe.
      if (!animated) {
        stream.write(`${label}\n`);
        return work();
      }

      let frame = 0;
      const render = (): void => {
        const line = `${FRAMES[frame]} ${label}`;
        frame = (frame + 1) % FRAMES.length;
        stream.write(`${CLEAR_LINE}${clip(line, stream.columns)}`);
      };

      render();
      const timer: NodeJS.Timeout = setInterval(render, FRAME_INTERVAL_MS);
      // A spinner is never a reason to hold the process open.
      timer.unref();

      try {
        return await work();
      } finally {
        clearInterval(timer);
        stream.write(CLEAR_LINE);
      }
    },
  };
}

/**
 * A wrapped line cannot be erased by a one-line clear, and a deep target path
 * makes that ordinary rather than exotic.
 */
function clip(line: string, columns?: number): string {
  const width =
    columns === undefined ? FALLBACK_COLUMNS : Math.max(1, columns - 1);

  return line.length <= width ? line : `${line.slice(0, width - 1)}…`;
}
