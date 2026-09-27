# try-nest

## What this is

A CLI tool (`npx try-nest` / `npx try-nestjs`) that scaffolds any of the official NestJS
sample projects from <https://github.com/nestjs/nest/tree/master/sample> into a local
folder, so you can check one out and run it in seconds.

Published to npm as `try-nest`; repo: <https://github.com/micalevisk/try-nest>.

**Status: unfinished.** `src/bin/try-nest.cli.ts` is still a stub that only prints
`Work in progress by @micalevisk`. All the scaffolding logic described below is yet to be
written. The surrounding tooling (build, lint, test, release) is already set up and green.

## Goal

Reproduce the UX of [`try-prisma`](../try-prisma/) (`prisma/try-prisma`) but for the
`nestjs/nest` samples:

1. Fetch the list of available samples from `nestjs/nest` at runtime (do not hardcode it —
   samples are added/renamed upstream).
2. Interactive prompt to pick a sample (plus flags to skip the prompts for scripting).
3. Ask for the target directory name, optionally install dependencies with the user's
   package manager of choice.
4. Download and extract **only** the chosen sample into that directory.
5. Print next steps (cd, install, run, link to the sample's upstream folder).

## Hard constraint: the scaffolded output must be standalone

The point of the tool is to hand the user a self-contained project.

- Never clone/keep the whole `nestjs/nest` repo. Extract just the selected
  `sample/<name>/` subtree and strip the leading path components so the sample's own files
  land at the root of the target directory.
- The result must not contain any reference that escapes its own directory — no
  `../../` imports, no `extends`/`file:` paths pointing back at the monorepo, no reliance
  on the monorepo's root `node_modules` or root tsconfig.
- Good news, verified against upstream (2026-09-27): each `sample/*` is already
  effectively self-contained — its `package.json` pins real published `@nestjs/*` versions
  (no `file:../../packages/*` links), `tsconfig.build.json` extends `./tsconfig.json`, and
  the only `../../` occurrences are inside `e2e/**` specs importing `../../src/...`, which
  stay valid after extraction. So extraction is mostly a path-rewriting job — but re-check
  this when upstream changes, and validate that a freshly scaffolded sample installs and
  boots.

## Reference implementation: `try-prisma`

`../try-prisma/` is the model to follow. Its shape, and how it maps here:

| try-prisma | try-nest equivalent |
|---|---|
| `src/constants.ts` — GitHub trees API URL + `codeload` tar URL for `prisma/prisma-examples@latest` | same, but `nestjs/nest` (`.../git/trees/master?recursive=1`, `https://codeload.github.com/nestjs/nest/tar.gz/master`) |
| `src/helpers/getProjects.ts` — GETs the recursive git tree, keeps paths under a whitelist of top-level dirs, keeps only dirs containing a `package.json`, returns `[uniquePaths, projectsWithSubfolders]` | filter on the `sample/` prefix instead |
| `src/helpers/download.ts` — streams the repo tarball through `gunzip-maybe` + `tar-fs`, rewriting each entry header to drop the repo prefix and the template prefix, marking everything else `[[ignore-me]]` so it is skipped | same technique; this is what makes the output standalone |
| `src/cli/parameters.ts` — flags declared as zod schemas, parsed with `@molt/command` | pick any arg parser; keep flags for template, name, install/pkg-manager |
| `src/cli/prompts.ts` — `@inquirer/prompts` (`select`, `input`, `confirm`) | same prompts, minus the Prisma-specific starter/ORM branching |
| `src/cli/index.ts` — `Cli` class: `initialize()` (load list, parse args, validate), `collect()` (fill gaps via prompts) | same two-phase flow |
| `src/index.ts` — orchestrates download, optional install, final instructions | same |
| `src/helpers/installPackages.ts`, `logger.ts`, `execa.ts`, `validation.ts` | same responsibilities |

Do **not** copy try-prisma's analytics interceptor (`EXAMPLES_REPO_INTERCEPTOR`, the
`--anonymous` flag) or its VS Code extension suggestion — those are Prisma-specific.

## Upstream shape to handle

`nestjs/nest/sample` holds numbered directories, currently `01-cats-app` … `36-valibot-serializer`.

Two of them are **not** a single project — they contain sibling sub-projects, each with its
own `package.json`:

- `31-graphql-federation-code-first/{gateway,posts-application,users-application}`
- `32-graphql-federation-schema-first/{gateway,posts-application,users-application}`

Decide deliberately how to treat these: scaffold the whole parent directory (and install in
each sub-project, like try-prisma does for `rest-nextjs-express`), or let the user pick a
single sub-project. try-prisma's `projectsWithSubfolders` return value exists for exactly
this case.

Also note upstream samples target `@nestjs/*` v12, are `"type": "module"`, and ship
`vitest.config.mts` / `vitest.config.e2e.mts` (plus a legacy `jest.json` in some).

## Stack & conventions in this repo

- Node `>=22` (`.nvmrc`: 22), ESM (`"type": "module"`).
- TypeScript 7 with `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, `module`/
  `moduleResolution`: `nodenext`. So: import with explicit `.ts` extensions, use
  `import type` for type-only imports, and no runtime-emitting TS syntax (no enums, no
  parameter properties).
- Build is plain `tsc` (`tsconfig.build.json`, `src/` → `lib/`); no bundler. The bin entry
  is `lib/bin/try-nest.cli.js`, sources live under `src/bin/`.
- Biome for lint + format (2-space indent, double quotes, organize-imports on).
- Vitest: specs go in `tests/**/*.spec.ts` (currently empty except `.gitkeep`),
  `globals: false` so import from `vitest` explicitly, `passWithNoTests: true`.
- lefthook pre-commit runs lint, format and test.
- Releases: `semantic-release` from `main`, triggered manually via the
  `Release & publish to NPM Registry` workflow (`workflow_dispatch`). Conventional commits
  matter.

## Commands

```sh
npm run dev        # node --watch on src/bin/try-nest.cli.ts (native TS via --experimental-transform-types)
npm run build      # tsc -p tsconfig.build.json -> ./lib
npm start          # build, then run ./lib/bin/try-nest.cli.js
npm test           # vitest run
npm run typecheck  # vitest --typecheck
npm run lint       # biome lint --write
npm run format     # biome format --write
```

## Known rough edges

- `package.json` `homepage` still points at `https://github.com/micalevisk/card`
  (copy-paste leftover from another project).
- `tsconfig.build.json` excludes `test`/`**/*spec.ts` but this repo's test dir is `tests/`.
- `README.md` promises "a set of interactive options _(detailed below)_" that are not
  documented yet, and has a TODO for a demo video.
