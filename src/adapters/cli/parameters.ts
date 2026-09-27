import { parseArgs } from "node:util";
import { TryNestError } from "../../domain/errors.ts";
import { isPackageManager } from "../../domain/package-manager.ts";
import type { PackageManager } from "../../domain/package-manager.ts";

export interface Inputs {
  readonly sample?: string;
  readonly directory?: string;
  readonly install?: boolean;
  readonly packageManager?: PackageManager;
  readonly yes: boolean;
  readonly list: boolean;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export const HELP_TEXT = `
  try-nest — scaffold any NestJS sample into a standalone project

  Usage
    $ npx try-nest@latest [options]

  Options
    -s, --sample <id>            Sample to scaffold (e.g. 01-cats-app)
    -d, --dir <path>             Directory to create
    -p, --package-manager <pm>   npm | pnpm | yarn | bun
        --install                Install dependencies
        --no-install             Skip installing dependencies
    -y, --yes                    Accept defaults instead of prompting
        --list                   Print the available samples and exit
        --json                   Machine-readable output for --list
    -h, --help                   Show this help
    -v, --version                Show the version

  With no interactive terminal there is nobody to answer a prompt, so every
  answer must arrive as a flag: --sample, --dir and an install decision. Or pass
  --yes to accept the defaults for all of them.

  Samples are read from nestjs/nest at run time, so always use @latest.
`.trimStart();

export function parseParameters(argv: readonly string[]): Inputs {
  const { values } = parseCommandLine(argv);

  const manager = values["package-manager"];
  if (manager !== undefined && !isPackageManager(manager)) {
    throw new TryNestError(
      "input-required",
      `Unknown package manager "${manager}". Expected npm, pnpm, yarn or bun.`,
    );
  }

  const install =
    values["no-install"] === true
      ? false
      : values.install === true
        ? true
        : undefined;

  return {
    ...(values.sample === undefined ? {} : { sample: values.sample }),
    ...(values.dir === undefined ? {} : { directory: values.dir }),
    ...(install === undefined ? {} : { install }),
    ...(manager === undefined ? {} : { packageManager: manager }),
    yes: values.yes === true,
    list: values.list === true,
    json: values.json === true,
    help: values.help === true,
    version: values.version === true,
  };
}

/**
 * `parseArgs` throws plain Node errors. Left alone they reach the top as an
 * unclassified failure and exit 1 — "the world was broken" — when a mistyped
 * flag is the user asking for the wrong thing, which is exit 2.
 */
function parseCommandLine(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        sample: { type: "string", short: "s" },
        dir: { type: "string", short: "d" },
        "package-manager": { type: "string", short: "p" },
        install: { type: "boolean" },
        "no-install": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        list: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    const complaint = error instanceof Error ? error.message : String(error);
    const looksPositional = argv.some(
      (argument) => !argument.startsWith("-") && argument.length > 0,
    );

    throw new TryNestError(
      "input-required",
      looksPositional
        ? `${complaint}. Name the sample with --sample, e.g. --sample 01-cats-app. Run with --help for every option.`
        : `${complaint}. Run with --help for the list of options.`,
    );
  }
}

/**
 * Without a usable terminal there is nobody to answer a prompt, so a missing
 * required input is an error rather than a question.
 */
export function assertSufficientForNonInteractive(inputs: Inputs): void {
  if (inputs.help || inputs.version || inputs.list) return;

  const missing: string[] = [];
  if (inputs.sample === undefined) missing.push("--sample");

  if (!inputs.yes) {
    if (inputs.directory === undefined) missing.push("--dir");

    // Every prompt the run can reach needs an answer up front, not just the
    // first two. Installing is a real choice — defaulting either way in a
    // script would be us deciding on the user's behalf.
    if (inputs.install === undefined) missing.push("--install/--no-install");

    // Picking a manager for them could install against the wrong lockfile,
    // and which one we would pick depends on what happens to be on the
    // machine. Better to be told.
    if (inputs.install === true && inputs.packageManager === undefined) {
      missing.push("--package-manager");
    }
  }

  if (missing.length > 0) {
    // Commas, not "and": one of the entries is itself an alternation, and
    // "--dir and --install/--no-install" would read as one choice.
    const named = missing.join(", ");

    // Only worth suggesting --yes to someone who has not already passed it.
    const hint = inputs.yes ? "" : " Add --yes to accept defaults.";

    throw new TryNestError(
      "input-required",
      `No interactive terminal is available, so these must be supplied: ${named}.${hint}`,
      { missing: missing.join(",") },
    );
  }
}
