# try-nest

`try-nest` is a CLI tool that helps you easily get up and running with NestJS sample that are available in the [`nest/sample`](https://github.com/nestjs/nest/tree/master/sample) repository.

## Usage

Just run the following in your terminal:

```sh
npx try-nest
## alternatively
npx try-nestjs
```

or, if you want to make sure that you're using the latest version available:

```sh
npx try-nest@latest
```

This will walk you through picking a sample, naming a directory, and optionally
installing dependencies.

## Options

Every prompt has a flag, so the whole thing is scriptable:

| Flag | Meaning |
|---|---|
| `-s, --sample <id>` | Sample to scaffold, e.g. `01-cats-app` |
| `-d, --dir <path>` | Directory to create |
| `-p, --package-manager <pm>` | `npm`, `pnpm`, `yarn` or `bun` |
| `--install` / `--no-install` | Install dependencies, or skip |
| `-y, --yes` | Accept defaults instead of prompting |
| `--list` | Print the available samples and exit |
| `--json` | Machine-readable output for `--list` |
| `-h, --help` | Show help |
| `-v, --version` | Show the version |

With no interactive terminal — in CI, or through a pipe — there is nobody to
answer a prompt, so every answer has to arrive as a flag: `--sample`, `--dir`
and an install decision. Pass `--yes` to accept the defaults for all of them
instead. A missing answer exits `2` naming the flag, rather than waiting on a
question nobody can see.

Exit codes: `0` success, `2` bad input, `130` a run you ended yourself at a
prompt, `1` something in the world was broken.
A failed dependency install is a warning, not a failure — the project is
already on disk and intact.

Samples are read from `nestjs/nest` at run time, so there is no pinned list and
no compatibility guarantee between versions — always use `@latest`.


## Demo

<!-- TODO(micalevisk): add a demo mp4 here -->
