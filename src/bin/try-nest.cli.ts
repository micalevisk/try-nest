#!/usr/bin/env node
import { createRequire } from "node:module";
import process from "node:process";
import { createRunDependencies, run } from "../adapters/cli/run.ts";

const { version } = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

process.exitCode = await run(process.argv.slice(2), createRunDependencies(), {
  interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  version,
});
