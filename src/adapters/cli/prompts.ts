import { emitKeypressEvents } from "node:readline";
import { confirm, input, select } from "@inquirer/prompts";
import type { Interaction } from "../../application/ports.ts";
import { TryNestError } from "../../domain/errors.ts";
import type { PackageManager } from "../../domain/package-manager.ts";
import type { Sample } from "../../domain/sample.ts";

/**
 * What `@inquirer/prompts` accepts as a prompt's second argument. Declared here
 * rather than imported: the type lives in `@inquirer/type`, a transitive
 * package we do not depend on, and the shape is three optional fields.
 */
interface PromptContext {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly signal?: AbortSignal;
}

export interface PromptStreams {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

/**
 * Both ways out of a prompt, named by the classes inquirer rejects with.
 * Matched by name rather than `instanceof`: those classes live in
 * `@inquirer/core`, which we do not declare as a dependency, and two copies of
 * it in one tree would make `instanceof` fail silently — turning a cancelled
 * run back into the crash this exists to prevent.
 */
const CANCEL_ERROR_NAMES = new Set(["AbortPromptError", "ExitPromptError"]);

/**
 * The only place that names inquirer's error vocabulary, so it stops at the
 * adapter that owns inquirer (ADR-0004). The domain learns one thing: the run
 * was cancelled.
 */
function asCancellation(error: unknown): unknown {
  return error instanceof Error && CANCEL_ERROR_NAMES.has(error.name)
    ? new TryNestError("cancelled", "Cancelled. Nothing was written.")
    : error;
}

export function createPrompts(streams: PromptStreams = {}): Interaction {
  const inputStream = streams.input ?? process.stdin;
  const outputStream = streams.output ?? process.stdout;

  /**
   * Binds Esc to abandoning the prompt. The keypress has to come from our own
   * listener: `@inquirer/core` exports no `isEscapeKey` and no bundled prompt
   * binds Esc. Two things this must not do — it never touches raw mode, which
   * inquirer owns and fighting breaks terminal teardown, and it never keeps its
   * listener past the prompt, or four sequential questions accumulate four.
   */
  async function escapable<T>(
    ask: (context: PromptContext) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    emitKeypressEvents(inputStream);
    const onKeypress = (_chunk: string, key?: { name?: string }): void => {
      if (key?.name === "escape") controller.abort();
    };

    inputStream.on("keypress", onKeypress);

    try {
      return await ask({
        signal: controller.signal,
        input: inputStream,
        output: outputStream,
      });
    } catch (error) {
      throw asCancellation(error);
    } finally {
      inputStream.off("keypress", onKeypress);
    }
  }

  return {
    async chooseSample(samples: readonly Sample[]): Promise<Sample> {
      return escapable((context) =>
        select(
          {
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
          },
          context,
        ),
      );
    },

    async chooseTargetDirectory(suggested: string): Promise<string> {
      return escapable((context) =>
        input(
          {
            message: "Where should it go?",
            default: suggested,
          },
          context,
        ),
      );
    },

    async confirmInstall(): Promise<boolean> {
      return escapable((context) =>
        confirm(
          {
            message: "Install dependencies now?",
            default: true,
          },
          context,
        ),
      );
    },

    async choosePackageManager(
      available: readonly PackageManager[],
    ): Promise<PackageManager> {
      return escapable((context) =>
        select(
          {
            message: "Which package manager?",
            choices: available.map((manager) => ({
              name: manager,
              value: manager,
            })),
          },
          context,
        ),
      );
    },
  };
}
