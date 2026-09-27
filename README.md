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

Samples are read from `nestjs/nest` at run time, so there is no pinned list and
no compatibility guarantee between versions — always use `@latest`.


## Demo

<!-- TODO(micalevisk): add a demo mp4 here -->
