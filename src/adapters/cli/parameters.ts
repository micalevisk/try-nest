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

  Samples are read from nestjs/nest at run time, so always use @latest.
`.trimStart();

export function parseParameters(argv: readonly string[]): Inputs {
  const { values } = parseArgs({
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
 * Without a usable terminal there is nobody to answer a prompt, so a missing
 * required input is an error rather than a question.
 */
export function assertSufficientForNonInteractive(inputs: Inputs): void {
  if (inputs.help || inputs.version || inputs.list) return;

  const missing: string[] = [];
  if (inputs.sample === undefined) missing.push("--sample");
  if (inputs.directory === undefined && !inputs.yes) missing.push("--dir");

  if (missing.length > 0) {
    throw new TryNestError(
      "input-required",
      `No interactive terminal is available, so ${missing.join(" and ")} must be supplied. Add --yes to accept defaults.`,
      { missing: missing.join(",") },
    );
  }
}
