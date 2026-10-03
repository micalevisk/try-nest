import { emitKeypressEvents } from "node:readline";
import { confirm, input, select } from "@inquirer/prompts";
import type { Interaction } from "../../application/ports.ts";
import { TryNestError } from "../../domain/errors.ts";
import type { PackageManager } from "../../domain/package-manager.ts";
import type { Sample } from "../../domain/sample.ts";
import { FALLBACK_COLUMNS, type ProgressStream } from "./progress.ts";

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
  readonly output?: ProgressStream;
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

/**
 * How wide the id column is allowed to get. The widest id upstream is
 * `32-graphql-federation-schema-first` at 34 characters; aligning every row to
 * it would spend most of an 80-column line on whitespace to accommodate two
 * outliers. Beyond the cap a row takes a single space instead.
 */
const ID_COLUMN_CAP = 24;
/** Between the id column and the description, when the id fits the column. */
const COLUMN_GAP = "  ";
/** Inquirer draws a two-column pointer gutter to the left of every choice. */
const POINTER_COLUMNS = 2;
/** Narrower than this and a description is noise; the row renders bare. */
const MINIMUM_DESCRIPTION_COLUMNS = 20;

export interface SampleChoice {
  readonly name: string;
  readonly value: Sample;
  /** Untruncated. Inquirer renders it as a footer for the highlighted row. */
  readonly description?: string;
}

/** Composites must stay visibly distinguishable even with no description (cli-ux.md). */
function labelFor(sample: Sample): string {
  return sample.layout === "composite"
    ? `${sample.displayName}  (${sample.subProjects.length} projects)`
    : sample.displayName;
}

/**
 * One line of printable text, whatever the source put in it. A newline in a
 * choice corrupts inquirer's redraw for the rest of the prompt.
 *
 * Control and format characters go too, not just whitespace: `\s` matches
 * neither `\x1b` nor `\x07`, and a manifest description is free text off the
 * network, so an escape sequence left in would now be drawn into *every*
 * visible row rather than one footer.
 *
 * Width is still counted in UTF-16 code units, the same convention
 * `progress.ts` uses. Grapheme-aware counting here and code units there would
 * be worse than one convention applied consistently.
 */
function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/**
 * The picker's rows: id, padding, truncated description.
 *
 * Inquirer renders `description` as a footer for the highlighted row only, so
 * without this only one row is ever annotated — the inline copy is what lets a
 * user compare before choosing (ADR-0006). Truncation costs no information:
 * the full text still reaches the footer.
 *
 * Identity is never truncated. An id wider than the terminal overflows, exactly
 * as it does today.
 */
export function sampleChoices(
  samples: readonly Sample[],
  columns?: number,
): readonly SampleChoice[] {
  // Leave the last column alone, as the spinner does: a line ending exactly at
  // the edge wraps on some terminals.
  const width =
    columns === undefined ? FALLBACK_COLUMNS : Math.max(1, columns - 1);
  const widestId = samples.reduce(
    (widest, sample) => Math.max(widest, sample.displayName.length),
    0,
  );
  const idColumn = Math.min(widestId, ID_COLUMN_CAP);

  return samples.map((sample) => {
    const label = labelFor(sample);
    const choice = { value: sample };

    if (sample.description === undefined) return { ...choice, name: label };

    const description = oneLine(sample.description);
    // A label that overruns the column takes a single space rather than
    // pushing every other row across to meet it.
    const prefix =
      label.length <= idColumn
        ? `${label.padEnd(idColumn)}${COLUMN_GAP}`
        : `${label} `;
    const available = width - prefix.length - POINTER_COLUMNS;

    return {
      ...choice,
      description,
      name:
        available < MINIMUM_DESCRIPTION_COLUMNS
          ? label
          : `${prefix}${truncate(description, available)}`,
    };
  });
}

export function createPrompts(streams: PromptStreams = {}): Interaction {
  const inputStream: NodeJS.ReadableStream = streams.input ?? process.stdin;
  const outputStream: ProgressStream = streams.output ?? process.stdout;

  /**
   * Binds Esc to abandoning the prompt. The keypress has to come from our own
   * listener: `@inquirer/core` exports no `isEscapeKey` and no bundled prompt
   * binds Esc. Two things this must not do — it never touches raw mode, which
   * inquirer owns and fighting breaks terminal teardown, and it never keeps its
   * listener past the prompt, or four sequential questions accumulate four.
   *
   * Calling `emitKeypressEvents` here, before inquirer builds its own
   * `readline.Interface`, pre-empts readline's internal call to the same
   * function: it guards on an already-installed keypress decoder and returns
   * early, so inquirer's interface never becomes the one receiving
   * `isCompletionEnabled`/`kSawKeyPress` or supplying `escapeCodeTimeout`.
   * Checked on Node 26: neither `kSawKeyPress` nor `escapeCodeTimeout` is ever
   * read on the path inquirer exercises, and `isCompletionEnabled` only gates
   * tab completion (which needs a `completer` inquirer never passes) and a
   * fast path in string insertion — so the only real cost is that a long
   * pasted answer redraws per character instead of in one write.
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
            choices: sampleChoices(samples, outputStream.columns),
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
