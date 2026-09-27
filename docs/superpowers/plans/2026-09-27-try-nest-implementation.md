# try-nest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `try-nest` stub with a working CLI that scaffolds any `nestjs/nest` sample into a standalone local project.

**Architecture:** Clean Architecture with four layers and an inward-pointing dependency rule. A pure domain holds sample classification, scaffold planning and the standalone-output invariant. Use cases orchestrate through ports they declare themselves. Adapters — GitHub, filesystem, terminal, child process — implement those ports; the CLI is one of them, not the centre. A single composition root wires the concrete pieces.

**Tech Stack:** Node >=22 (ESM), TypeScript 7, Vitest, Biome. Runtime dependencies are deliberately two: `tar-stream@^3.2.1` (ships its own types; `tar-fs@3` does not) and `@inquirer/prompts@^8.7.2`. Everything else is a Node built-in — `fetch`, `node:zlib` for gunzip, `node:util`'s `parseArgs` for flags, `node:fs`.

**Spec:** [`docs/`](../../README.md) — in particular [architecture.md](../../architecture.md), [domain-model.md](../../domain-model.md), [upstream-contract.md](../../upstream-contract.md), [cli-ux.md](../../cli-ux.md), [testing-strategy.md](../../testing-strategy.md) and [adr/](../../adr/README.md).

## Global Constraints

- **Node `>=22.0.0`** (`package.json` engines, `.nvmrc` is 22). ESM only — `"type": "module"`.
- **TypeScript 7 with `erasableSyntaxOnly`:** no `enum`, no parameter properties, no runtime-emitting TS syntax. Use union types and `as const` objects instead of enums.
- **`verbatimModuleSyntax`:** type-only imports MUST use `import type`.
- **`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`:** every relative import MUST carry an explicit `.ts` extension.
- **Vitest `globals: false`:** import `describe`/`it`/`expect` from `vitest` explicitly in every spec.
- **Tests live in `tests/`**, matching `**/*.spec.ts`. Mirror the `src/` structure.
- **Biome:** 2-space indent, double quotes. `npm run lint` and `npm run format` must be clean; lefthook runs lint + format + test on every commit.
- **Conventional commits** — `semantic-release` parses them. End every commit message with a `Co-Authored-By:` line as its final line.
- **Do not `git push`.** Leave commits on the local branch unless explicitly asked.
- **No sample name may appear anywhere in `src/`** (ADR-0003). No analytics, no telemetry, no config file, no update check (cli-ux.md).
- **Never write outside the target directory.**

## Review Focus

Failure modes the spec implies that are most likely to bite a real user. Each has a test pinned to the task that owns the code.

1. **Truncated tree listing** — upstream returns `truncated: true` with partial results and HTTP 200. Must be a hard failure, never a silently short catalog. *(Task 7)*
2. **Path traversal in archive entries** — a tar header containing `../` must never write outside the target directory. *(Task 3, enforced again in Task 10)*
3. **No TTY with a required input missing** — must exit with a message naming what was missing, never block forever on a prompt nobody can answer. *(Task 12)*
4. **Rate limiting** — HTTP 403 with an exhausted quota must read as a quota, with retry timing, not as a generic network error. *(Task 7)*
5. **Install failure after a successful scaffold** — must report the project as created and intact, so the user does not delete good work. *(Task 6)*

---

## File Structure

```
src/
  domain/                      pure, no I/O, no dependencies
    errors.ts                  failure taxonomy shared by every layer
    sample.ts                  Sample, SampleLayout
    catalog.ts                 buildCatalog() — the classification rule (ADR-0003)
    target-directory.ts        usability rules for the destination
    scaffold-plan.ts           ScaffoldPlan, re-rooting, traversal guard (ADR-0008)
    package-manager.ts         known managers, install-unit derivation
  application/
    ports.ts                   every port interface, in our vocabulary (ADR-0004)
    list-samples.ts            fetch paths -> catalog
    describe-samples.ts        bounded-concurrency enrichment (ADR-0006)
    scaffold-sample.ts         plan -> writer
    install-dependencies.ts    per-install-unit, failure is non-fatal
  adapters/
    github/
      http.ts                  shared fetch + failure translation
      tree-catalog-source.ts   trees API; truncation = hard failure
      raw-metadata-source.ts   raw file content; off the metered path
      codeload-archive-source.ts  tarball -> ArchiveEntry stream
    fs/
      workspace-writer.ts      re-rooted extraction to disk
      target-directory-probe.ts  fs state -> domain snapshot
    process/
      package-manager-runner.ts  detection + install execution
    cli/
      parameters.ts            parseArgs -> Inputs
      prompts.ts               @inquirer/prompts behind the Interaction port
      presenter.ts             all terminal output, incl. failure rendering
      run.ts                   composition root + orchestration + prefetch
  bin/
    try-nest.cli.ts            thin entry: call run(), map failure to exit code

tests/                         mirrors src/, plus:
  helpers/fixtures.ts          recorded upstream fixtures
  e2e/scaffold.spec.ts         standalone-output verification
  drift/upstream.spec.ts       opt-in live sentinel
```

---

## Task 1: Domain foundations — failure taxonomy and sample classification

This is the load-bearing task. `buildCatalog` is a pure function from a list of paths to a catalog, and it is the whole of "new samples need no release" (ADR-0003).

**Files:**
- Create: `src/domain/errors.ts`
- Create: `src/domain/sample.ts`
- Create: `src/domain/catalog.ts`
- Test: `tests/domain/catalog.spec.ts`
- Modify: `tsconfig.build.json` (exclude `tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `TryNestError`, `FailureKind`, `Sample`, `SampleLayout`, `SAMPLES_ROOT`, `buildCatalog(paths: readonly string[]): readonly Sample[]`.

- [ ] **Step 1: Fix the build config before adding any test helper**

`tsconfig.json` includes `./tests`, but `tsconfig.build.json` sets `rootDir: "./src"` and excludes only `test` and `**/*spec.ts`. The moment a non-spec file lands in `tests/`, `tsc` fails with TS6059 ("not under rootDir"). Fix it now, not later.

In `tsconfig.build.json`, replace the `exclude` array with:

```json
  "exclude": ["node_modules", "lib", "tests", "**/*spec.ts"],
```

- [ ] **Step 2: Verify the build still works**

Run: `npm run build`
Expected: exits 0, creates `lib/bin/try-nest.cli.js`.

- [ ] **Step 3: Write the failing test**

Create `tests/domain/catalog.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../src/domain/catalog.ts";

describe("buildCatalog", () => {
  it("treats a directory with its own manifest as a single sample", () => {
    const catalog = buildCatalog([
      "sample/01-cats-app/package.json",
      "sample/01-cats-app/src/main.ts",
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: "01-cats-app",
      layout: "single",
      subProjects: [],
    });
  });

  it("treats a manifest-less directory whose children have manifests as composite", () => {
    const catalog = buildCatalog([
      "sample/31-graphql-federation-code-first/gateway/package.json",
      "sample/31-graphql-federation-code-first/posts-application/package.json",
      "sample/31-graphql-federation-code-first/users-application/package.json",
    ]);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: "31-graphql-federation-code-first",
      layout: "composite",
      subProjects: ["gateway", "posts-application", "users-application"],
    });
  });

  it("ignores paths outside the samples root", () => {
    const catalog = buildCatalog([
      "packages/core/package.json",
      "integration/hello-world/package.json",
      "sample/01-cats-app/package.json",
    ]);

    expect(catalog.map((s) => s.id)).toEqual(["01-cats-app"]);
  });

  it("ignores a samples directory that contains no manifest at any supported depth", () => {
    const catalog = buildCatalog([
      "sample/99-docs-only/README.md",
      "sample/98-too-deep/a/b/package.json",
    ]);

    expect(catalog).toEqual([]);
  });

  it("prefers single when a directory has both its own and nested manifests", () => {
    const catalog = buildCatalog([
      "sample/weird/package.json",
      "sample/weird/nested/package.json",
    ]);

    expect(catalog[0]).toMatchObject({ layout: "single", subProjects: [] });
  });

  it("orders samples by id so upstream numbering is preserved", () => {
    const catalog = buildCatalog([
      "sample/10-fastify/package.json",
      "sample/02-gateways/package.json",
      "sample/01-cats-app/package.json",
    ]);

    expect(catalog.map((s) => s.id)).toEqual([
      "01-cats-app",
      "02-gateways",
      "10-fastify",
    ]);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npm test -- tests/domain/catalog.spec.ts`
Expected: FAIL — cannot resolve `../../src/domain/catalog.ts`.

- [ ] **Step 5: Write the failure taxonomy**

Create `src/domain/errors.ts`. Note `erasableSyntaxOnly` forbids parameter properties, so fields are assigned in the constructor body.

```ts
export type FailureKind =
  | "catalog-unavailable"
  | "catalog-incomplete"
  | "rate-limited"
  | "sample-not-found"
  | "archive-unavailable"
  | "target-directory-unusable"
  | "unsafe-archive-entry"
  | "extraction-failed"
  | "install-failed"
  | "input-required";

export class TryNestError extends Error {
  readonly kind: FailureKind;
  readonly details: Readonly<Record<string, string>>;

  constructor(
    kind: FailureKind,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "TryNestError";
    this.kind = kind;
    this.details = details;
  }
}

export function isTryNestError(error: unknown): error is TryNestError {
  return error instanceof TryNestError;
}
```

- [ ] **Step 6: Write the sample type**

Create `src/domain/sample.ts`:

```ts
export type SampleLayout = "single" | "composite";

export interface Sample {
  /** Path beneath the samples root, e.g. "01-cats-app". The only identifier we expose. */
  readonly id: string;
  /** What the picker shows. Derived from the id — we never invent names. */
  readonly displayName: string;
  readonly layout: SampleLayout;
  /** Relative sub-project paths for a composite; empty for a single. */
  readonly subProjects: readonly string[];
  /** Resolved from upstream, often absent. Never required for anything to work. */
  readonly description?: string;
}

export function isComposite(sample: Sample): boolean {
  return sample.layout === "composite";
}
```

- [ ] **Step 7: Write the classification rule**

Create `src/domain/catalog.ts`:

```ts
import type { Sample } from "./sample.ts";

export const SAMPLES_ROOT = "sample";
export const MANIFEST_FILENAME = "package.json";

/**
 * Derives the catalog from a flat list of repository paths.
 *
 * A directory beneath the samples root is a `single` sample when it holds a
 * manifest of its own, and a `composite` sample when it holds none but its
 * immediate children do. Anything else is ignored. Nesting deeper than one
 * level is deliberately unsupported — see docs/domain-model.md.
 *
 * Pure: no sample name appears here, which is what lets new upstream samples
 * work with no release (ADR-0003).
 */
export function buildCatalog(paths: readonly string[]): readonly Sample[] {
  const singles = new Set<string>();
  const nested = new Map<string, Set<string>>();

  for (const path of paths) {
    const segments = path.split("/");
    if (segments[0] !== SAMPLES_ROOT) continue;
    if (segments.at(-1) !== MANIFEST_FILENAME) continue;

    if (segments.length === 3) {
      singles.add(segments[1] as string);
    } else if (segments.length === 4) {
      const name = segments[1] as string;
      const child = segments[2] as string;
      const children = nested.get(name) ?? new Set<string>();
      children.add(child);
      nested.set(name, children);
    }
  }

  const samples: Sample[] = [];

  for (const id of singles) {
    samples.push({
      id,
      displayName: id,
      layout: "single",
      subProjects: [],
    });
  }

  for (const [id, children] of nested) {
    // A directory holding its own manifest is a single sample, whatever else
    // it contains.
    if (singles.has(id)) continue;

    samples.push({
      id,
      displayName: id,
      layout: "composite",
      subProjects: [...children].sort(),
    });
  }

  return samples.sort((a, b) => a.id.localeCompare(b.id));
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npm test -- tests/domain/catalog.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```bash
git add src/domain/errors.ts src/domain/sample.ts src/domain/catalog.ts tests/domain/catalog.spec.ts tsconfig.build.json
git commit -m "feat(domain): derive the sample catalog from repository structure"
```

---

## Task 2: Domain — target directory rules

The domain decides whether a destination is usable; it never touches the filesystem. The adapter supplies a state snapshot.

**Files:**
- Create: `src/domain/target-directory.ts`
- Test: `tests/domain/target-directory.spec.ts`

**Interfaces:**
- Consumes: `TryNestError` (Task 1), `Sample` (Task 1).
- Produces: `DirectoryState`, `assertTargetDirectoryUsable(name, state)`, `defaultTargetDirectoryFor(sample)`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/target-directory.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TryNestError } from "../../src/domain/errors.ts";
import {
  assertTargetDirectoryUsable,
  defaultTargetDirectoryFor,
} from "../../src/domain/target-directory.ts";

const absent = { exists: false, isDirectory: false, isEmpty: true };

describe("assertTargetDirectoryUsable", () => {
  it("accepts a directory that does not exist", () => {
    expect(() => assertTargetDirectoryUsable("cats", absent)).not.toThrow();
  });

  it("accepts an existing empty directory", () => {
    expect(() =>
      assertTargetDirectoryUsable("cats", {
        exists: true,
        isDirectory: true,
        isEmpty: true,
      }),
    ).not.toThrow();
  });

  it("refuses a non-empty directory rather than merging into it", () => {
    expect(() =>
      assertTargetDirectoryUsable("cats", {
        exists: true,
        isDirectory: true,
        isEmpty: false,
      }),
    ).toThrowError(TryNestError);
  });

  it("refuses a path that exists but is not a directory", () => {
    expect(() =>
      assertTargetDirectoryUsable("cats", {
        exists: true,
        isDirectory: false,
        isEmpty: true,
      }),
    ).toThrowError(/not a directory/i);
  });

  it("refuses an empty name", () => {
    expect(() => assertTargetDirectoryUsable("   ", absent)).toThrowError(
      TryNestError,
    );
  });

  it("refuses a name that would escape the working directory", () => {
    expect(() => assertTargetDirectoryUsable("../elsewhere", absent)).toThrowError(
      TryNestError,
    );
  });
});

describe("defaultTargetDirectoryFor", () => {
  it("uses the sample id", () => {
    const sample = {
      id: "05-sql-typeorm",
      displayName: "05-sql-typeorm",
      layout: "single" as const,
      subProjects: [],
    };

    expect(defaultTargetDirectoryFor(sample)).toBe("05-sql-typeorm");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/domain/target-directory.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/domain/target-directory.ts`:

```ts
import { TryNestError } from "./errors.ts";
import type { Sample } from "./sample.ts";

export interface DirectoryState {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isEmpty: boolean;
}

export function defaultTargetDirectoryFor(sample: Sample): string {
  return sample.id;
}

/**
 * The tool never merges into existing content: a destination is usable when it
 * is absent, or an empty directory. Refusing is a domain rule, not a
 * filesystem accident.
 */
export function assertTargetDirectoryUsable(
  name: string,
  state: DirectoryState,
): void {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    throw new TryNestError(
      "target-directory-unusable",
      "A target directory name is required.",
    );
  }

  if (trimmed.split(/[/\\]/).includes("..")) {
    throw new TryNestError(
      "target-directory-unusable",
      `"${name}" would escape the current directory.`,
      { path: name },
    );
  }

  if (!state.exists) return;

  if (!state.isDirectory) {
    throw new TryNestError(
      "target-directory-unusable",
      `"${name}" already exists and is not a directory.`,
      { path: name },
    );
  }

  if (!state.isEmpty) {
    throw new TryNestError(
      "target-directory-unusable",
      `"${name}" already exists and is not empty. Choose another name or clear it first.`,
      { path: name },
    );
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/domain/target-directory.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/target-directory.ts tests/domain/target-directory.spec.ts
git commit -m "feat(domain): add target directory usability rules"
```

---

## Task 3: Domain — scaffold plan, re-rooting and the traversal guard

This task owns [ADR-0008](../../adr/0008-standalone-output-invariant.md). **Review Focus item 2** is pinned here: an archive entry containing `..` must never produce a path outside the target.

**Files:**
- Create: `src/domain/package-manager.ts`
- Create: `src/domain/scaffold-plan.ts`
- Test: `tests/domain/scaffold-plan.spec.ts`

**Interfaces:**
- Consumes: `Sample` (Task 1), `TryNestError` (Task 1).
- Produces: `PackageManager`, `PACKAGE_MANAGERS`, `isPackageManager(value)`, `ScaffoldPlan`, `planScaffold(sample, targetDirectory)`, `rerootEntryPath(plan, repoRelativePath): string | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/scaffold-plan.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TryNestError } from "../../src/domain/errors.ts";
import type { Sample } from "../../src/domain/sample.ts";
import { planScaffold, rerootEntryPath } from "../../src/domain/scaffold-plan.ts";

const single: Sample = {
  id: "01-cats-app",
  displayName: "01-cats-app",
  layout: "single",
  subProjects: [],
};

const composite: Sample = {
  id: "31-graphql-federation-code-first",
  displayName: "31-graphql-federation-code-first",
  layout: "composite",
  subProjects: ["gateway", "posts-application", "users-application"],
};

describe("planScaffold", () => {
  it("installs once at the root for a single sample", () => {
    const plan = planScaffold(single, "cats");

    expect(plan.sourcePrefix).toBe("sample/01-cats-app/");
    expect(plan.installUnits).toEqual(["."]);
  });

  it("installs once per sub-project for a composite sample", () => {
    const plan = planScaffold(composite, "federation");

    expect(plan.installUnits).toEqual([
      "gateway",
      "posts-application",
      "users-application",
    ]);
  });
});

describe("rerootEntryPath", () => {
  const plan = planScaffold(single, "cats");

  it("strips the source prefix so the sample lands at the target root", () => {
    expect(rerootEntryPath(plan, "sample/01-cats-app/src/main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("skips anything outside the chosen sample", () => {
    expect(rerootEntryPath(plan, "packages/core/index.ts")).toBeNull();
    expect(rerootEntryPath(plan, "sample/02-gateways/src/main.ts")).toBeNull();
  });

  it("skips the sample directory entry itself", () => {
    expect(rerootEntryPath(plan, "sample/01-cats-app/")).toBeNull();
  });

  it("does not confuse a sibling whose name shares a prefix", () => {
    expect(rerootEntryPath(plan, "sample/01-cats-app-extra/src/main.ts")).toBeNull();
  });

  it("refuses an entry that would escape the target directory", () => {
    expect(() =>
      rerootEntryPath(plan, "sample/01-cats-app/../../../etc/passwd"),
    ).toThrowError(TryNestError);
  });

  it("refuses an absolute entry path", () => {
    expect(() => rerootEntryPath(plan, "sample/01-cats-app//etc/passwd")).toThrowError(
      TryNestError,
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/domain/scaffold-plan.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the package manager type**

Create `src/domain/package-manager.ts`. `erasableSyntaxOnly` forbids `enum`, so this is a const tuple plus a derived union.

```ts
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}
```

The domain knows these exist and that a composite needs one install per sub-project. It deliberately does not know their command-line syntax — that lives in the runner adapter.

- [ ] **Step 4: Write the plan and re-rooting rule**

Create `src/domain/scaffold-plan.ts`:

```ts
import { SAMPLES_ROOT } from "./catalog.ts";
import { TryNestError } from "./errors.ts";
import type { Sample } from "./sample.ts";

export interface ScaffoldPlan {
  readonly sample: Sample;
  readonly targetDirectory: string;
  /** Repository-relative prefix that gets stripped so the sample lands at the root. */
  readonly sourcePrefix: string;
  /** Directories, relative to the target, that each need their own install. */
  readonly installUnits: readonly string[];
}

export function planScaffold(
  sample: Sample,
  targetDirectory: string,
): ScaffoldPlan {
  return {
    sample,
    targetDirectory,
    sourcePrefix: `${SAMPLES_ROOT}/${sample.id}/`,
    installUnits:
      sample.layout === "composite" ? [...sample.subProjects] : ["."],
  };
}

/**
 * Maps a repository-relative archive path to its path inside the target
 * directory, or null when the entry is not part of the chosen sample.
 *
 * This is where the standalone-output invariant is enforced (ADR-0008): the
 * sample's own contents become the target's contents, and nothing may resolve
 * outside the target.
 */
export function rerootEntryPath(
  plan: ScaffoldPlan,
  repoRelativePath: string,
): string | null {
  if (!repoRelativePath.startsWith(plan.sourcePrefix)) return null;

  const relative = repoRelativePath.slice(plan.sourcePrefix.length);
  if (relative.length === 0) return null;

  const segments = relative.split("/");

  // An empty segment means a doubled or leading slash; "." and ".." can escape.
  const unsafe = segments.some(
    (segment, index) =>
      segment === ".." ||
      (segment.length === 0 && index !== segments.length - 1),
  );

  if (unsafe) {
    throw new TryNestError(
      "unsafe-archive-entry",
      `Refusing to extract "${repoRelativePath}": it resolves outside the target directory.`,
      { entry: repoRelativePath },
    );
  }

  return relative;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- tests/domain/scaffold-plan.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/domain/package-manager.ts src/domain/scaffold-plan.ts tests/domain/scaffold-plan.spec.ts
git commit -m "feat(domain): plan scaffolding with a path traversal guard"
```

---

## Task 4: Application — ports and the list-samples use case

Ports are declared by the application in **our** vocabulary, never the vendor's ([ADR-0004](../../adr/0004-anti-corruption-layer-for-upstream.md)). Nothing GitHub-shaped appears in this file.

**Files:**
- Create: `src/application/ports.ts`
- Create: `src/application/list-samples.ts`
- Modify: `src/domain/catalog.ts` (add `manifestPathFor`)
- Test: `tests/application/list-samples.spec.ts`

**Interfaces:**
- Consumes: `Sample`, `buildCatalog`, `TryNestError`, `ScaffoldPlan`, `PackageManager`, `DirectoryState`.
- Produces: `SampleCatalogSource`, `SampleMetadataSource`, `SampleArchiveSource`, `ArchiveEntry`, `WorkspaceWriter`, `TargetDirectoryProbe`, `PackageManagerRunner`, `Interaction`, `Presenter`, `listSamples(source, signal?)`, `manifestPathFor(sample)`.

- [ ] **Step 1: Add the manifest path rule to the domain**

Append to `src/domain/catalog.ts`:

```ts
import type { Sample } from "./sample.ts";

/**
 * Where a sample's description is read from. A composite has no manifest of
 * its own, so its first sub-project stands in for it.
 */
export function manifestPathFor(sample: Sample): string {
  const suffix =
    sample.layout === "composite" && sample.subProjects[0] !== undefined
      ? `/${sample.subProjects[0]}`
      : "";

  return `${SAMPLES_ROOT}/${sample.id}${suffix}/${MANIFEST_FILENAME}`;
}
```

(The `import type { Sample }` line already exists at the top of the file — do not duplicate it.)

- [ ] **Step 2: Write the failing test**

Create `tests/application/list-samples.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listSamples } from "../../src/application/list-samples.ts";
import type { SampleCatalogSource } from "../../src/application/ports.ts";
import { TryNestError } from "../../src/domain/errors.ts";

function sourceOf(paths: readonly string[]): SampleCatalogSource {
  return { listPaths: async () => paths };
}

describe("listSamples", () => {
  it("turns repository paths into a catalog", async () => {
    const samples = await listSamples(
      sourceOf([
        "sample/01-cats-app/package.json",
        "sample/02-gateways/package.json",
        "packages/core/package.json",
      ]),
    );

    expect(samples.map((s) => s.id)).toEqual(["01-cats-app", "02-gateways"]);
  });

  it("fails loudly when the catalog comes back empty", async () => {
    await expect(listSamples(sourceOf([]))).rejects.toThrowError(TryNestError);
  });

  it("lets a source failure through untouched", async () => {
    const failing: SampleCatalogSource = {
      listPaths: async () => {
        throw new TryNestError("rate-limited", "quota exhausted");
      },
    };

    await expect(listSamples(failing)).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/application/list-samples.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Declare the ports**

Create `src/application/ports.ts`:

```ts
import type { TryNestError } from "../domain/errors.ts";
import type { PackageManager } from "../domain/package-manager.ts";
import type { Sample } from "../domain/sample.ts";
import type { ScaffoldPlan } from "../domain/scaffold-plan.ts";
import type { DirectoryState } from "../domain/target-directory.ts";

/** "What samples exist right now?" */
export interface SampleCatalogSource {
  listPaths(signal?: AbortSignal): Promise<readonly string[]>;
}

/** "Describe the sample whose manifest lives at this repository path." */
export interface SampleMetadataSource {
  readDescription(
    manifestPath: string,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
}

export interface ArchiveEntry {
  /** Repository-relative; the archive's own root segment is already stripped. */
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
  readonly mode: number;
  readonly body: AsyncIterable<Uint8Array>;
}

/** "Give me this sample's bytes." */
export interface SampleArchiveSource {
  entries(signal?: AbortSignal): AsyncIterable<ArchiveEntry>;
}

export interface WorkspaceWriter {
  materialize(
    plan: ScaffoldPlan,
    entries: AsyncIterable<ArchiveEntry>,
  ): Promise<void>;
}

export interface TargetDirectoryProbe {
  inspect(path: string): Promise<DirectoryState>;
}

export interface PackageManagerRunner {
  detect(): Promise<readonly PackageManager[]>;
  install(directory: string, manager: PackageManager): Promise<void>;
}

export interface Interaction {
  chooseSample(samples: readonly Sample[]): Promise<Sample>;
  chooseTargetDirectory(suggested: string): Promise<string>;
  confirmInstall(): Promise<boolean>;
  choosePackageManager(
    available: readonly PackageManager[],
  ): Promise<PackageManager>;
}

export interface Presenter {
  starting(): void;
  scaffolding(plan: ScaffoldPlan): void;
  installing(directory: string): void;
  succeeded(plan: ScaffoldPlan, installed: boolean): void;
  warn(message: string): void;
  failed(error: TryNestError): void;
}
```

- [ ] **Step 5: Implement the use case**

Create `src/application/list-samples.ts`:

```ts
import { buildCatalog } from "../domain/catalog.ts";
import { TryNestError } from "../domain/errors.ts";
import type { Sample } from "../domain/sample.ts";
import type { SampleCatalogSource } from "./ports.ts";

export async function listSamples(
  source: SampleCatalogSource,
  signal?: AbortSignal,
): Promise<readonly Sample[]> {
  const paths = await source.listPaths(signal);
  const catalog = buildCatalog(paths);

  if (catalog.length === 0) {
    throw new TryNestError(
      "catalog-unavailable",
      "No samples were found upstream. The repository layout may have changed.",
    );
  }

  return catalog;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test -- tests/application/list-samples.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add src/application/ports.ts src/application/list-samples.ts src/domain/catalog.ts tests/application/list-samples.spec.ts
git commit -m "feat(application): declare ports and the list-samples use case"
```

---

## Task 5: Application — eager background enrichment

Implements [ADR-0006](../../adr/0006-upstream-only-sample-metadata.md). The binding rule: **enrichment can never block or fail the picker.** Individual failures are swallowed; total failure yields the plain catalog.

> **Note on the suppression rule (Step 5).** Upstream descriptions are currently identical boilerplate — 35 of 40 manifests say `"Nest TypeScript starter repository"`. Rather than hardcode that string (which would violate ADR-0003's no-hardcoding rule), a description shared by most samples is treated as carrying no distinguishing information and dropped. This is self-maintaining: it suppresses nothing once upstream writes real descriptions, which is exactly the bet ADR-0006 makes. Remove this step if you would rather show the boilerplate.

**Files:**
- Create: `src/domain/description.ts`
- Create: `src/application/describe-samples.ts`
- Test: `tests/domain/description.spec.ts`
- Test: `tests/application/describe-samples.spec.ts`

**Interfaces:**
- Consumes: `Sample`, `manifestPathFor` (Task 4), `SampleMetadataSource` (Task 4).
- Produces: `withoutUninformativeDescriptions(samples)`, `describeSamples(samples, source, options?)`.

- [ ] **Step 1: Write the failing test for the suppression rule**

Create `tests/domain/description.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withoutUninformativeDescriptions } from "../../src/domain/description.ts";
import type { Sample } from "../../src/domain/sample.ts";

function sampleOf(id: string, description?: string): Sample {
  return {
    id,
    displayName: id,
    layout: "single",
    subProjects: [],
    ...(description === undefined ? {} : { description }),
  };
}

describe("withoutUninformativeDescriptions", () => {
  it("drops a description shared by most samples", () => {
    const boilerplate = "Nest TypeScript starter repository";
    const samples = [
      sampleOf("a", boilerplate),
      sampleOf("b", boilerplate),
      sampleOf("c", boilerplate),
      sampleOf("d", "Something specific"),
    ];

    const result = withoutUninformativeDescriptions(samples);

    expect(result.map((s) => s.description)).toEqual([
      undefined,
      undefined,
      undefined,
      "Something specific",
    ]);
  });

  it("keeps descriptions when they distinguish samples", () => {
    const samples = [
      sampleOf("a", "GraphQL federation"),
      sampleOf("b", "TypeORM with SQL"),
      sampleOf("c", "Caching"),
      sampleOf("d", "Caching"),
    ];

    const result = withoutUninformativeDescriptions(samples);

    expect(result.map((s) => s.description)).toEqual([
      "GraphQL federation",
      "TypeORM with SQL",
      "Caching",
      "Caching",
    ]);
  });

  it("leaves a small catalog alone", () => {
    const samples = [sampleOf("a", "same"), sampleOf("b", "same")];

    expect(withoutUninformativeDescriptions(samples)).toEqual(samples);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/domain/description.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the suppression rule**

Create `src/domain/description.ts`:

```ts
import type { Sample } from "./sample.ts";

/** Below this many samples, a repeated description is not evidence of anything. */
const MINIMUM_CATALOG_SIZE = 4;
const MINIMUM_REPEATS = 3;

/**
 * A description shared by most samples distinguishes none of them, so it is
 * dropped rather than rendered on every row.
 *
 * Deliberately a computed rule and not a list of known boilerplate strings: it
 * needs no maintenance, and it stops suppressing on its own once upstream
 * descriptions become distinct.
 */
export function withoutUninformativeDescriptions(
  samples: readonly Sample[],
): readonly Sample[] {
  if (samples.length < MINIMUM_CATALOG_SIZE) return samples;

  const counts = new Map<string, number>();
  for (const sample of samples) {
    const description = sample.description;
    if (description === undefined || description.length === 0) continue;
    counts.set(description, (counts.get(description) ?? 0) + 1);
  }

  const uninformative = new Set(
    [...counts]
      .filter(
        ([, count]) => count >= MINIMUM_REPEATS && count * 2 > samples.length,
      )
      .map(([description]) => description),
  );

  if (uninformative.size === 0) return samples;

  return samples.map((sample) => {
    if (sample.description === undefined) return sample;
    if (!uninformative.has(sample.description)) return sample;

    const { description: _dropped, ...rest } = sample;
    return rest;
  });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/domain/description.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for enrichment**

Create `tests/application/describe-samples.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeSamples } from "../../src/application/describe-samples.ts";
import type { SampleMetadataSource } from "../../src/application/ports.ts";
import type { Sample } from "../../src/domain/sample.ts";

const samples: readonly Sample[] = [
  { id: "01-a", displayName: "01-a", layout: "single", subProjects: [] },
  { id: "02-b", displayName: "02-b", layout: "single", subProjects: [] },
  { id: "03-c", displayName: "03-c", layout: "single", subProjects: [] },
  { id: "04-d", displayName: "04-d", layout: "single", subProjects: [] },
];

describe("describeSamples", () => {
  it("attaches each sample's description", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => `describes ${path}`,
    };

    const result = await describeSamples(samples, source);

    expect(result[0]?.description).toBe(
      "describes sample/01-a/package.json",
    );
  });

  it("swallows a single failure without losing the others", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        if (path.includes("02-b")) throw new Error("404");
        return `ok ${path}`;
      },
    };

    const result = await describeSamples(samples, source);

    expect(result[1]?.description).toBeUndefined();
    expect(result[0]?.description).toBe("ok sample/01-a/package.json");
    expect(result).toHaveLength(4);
  });

  it("returns the plain catalog when every lookup fails", async () => {
    const source: SampleMetadataSource = {
      readDescription: async () => {
        throw new Error("network down");
      },
    };

    const result = await describeSamples(samples, source);

    expect(result.map((s) => s.description)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;

    const source: SampleMetadataSource = {
      readDescription: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return "x";
      },
    };

    await describeSamples(samples, source, { concurrency: 2 });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("reads a composite's description from its first sub-project", async () => {
    const seen: string[] = [];
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        seen.push(path);
        return undefined;
      },
    };

    await describeSamples(
      [
        {
          id: "31-federation",
          displayName: "31-federation",
          layout: "composite",
          subProjects: ["gateway", "posts-application"],
        },
      ],
      source,
    );

    expect(seen).toEqual(["sample/31-federation/gateway/package.json"]);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npm test -- tests/application/describe-samples.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement enrichment**

Create `src/application/describe-samples.ts`:

```ts
import { manifestPathFor } from "../domain/catalog.ts";
import { withoutUninformativeDescriptions } from "../domain/description.ts";
import type { Sample } from "../domain/sample.ts";
import type { SampleMetadataSource } from "./ports.ts";

const DEFAULT_CONCURRENCY = 8;

export interface DescribeSamplesOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/**
 * Resolves every sample's description concurrently, tolerating partial failure.
 *
 * This never rejects. A description is an enhancement: losing one, or all of
 * them, must leave a usable catalog behind (ADR-0006).
 */
export async function describeSamples(
  samples: readonly Sample[],
  source: SampleMetadataSource,
  options: DescribeSamplesOptions = {},
): Promise<readonly Sample[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const descriptions = new Array<string | undefined>(samples.length);

  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= samples.length) return;

      const sample = samples[index];
      if (sample === undefined) return;

      try {
        descriptions[index] = await source.readDescription(
          manifestPathFor(sample),
          options.signal,
        );
      } catch {
        // Individual failures are expected and uninteresting.
        descriptions[index] = undefined;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, samples.length) }, worker),
  );

  const enriched = samples.map((sample, index) => {
    const description = descriptions[index];
    if (description === undefined || description.length === 0) return sample;
    return { ...sample, description };
  });

  return withoutUninformativeDescriptions(enriched);
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npm test -- tests/application/describe-samples.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add src/domain/description.ts src/application/describe-samples.ts tests/domain/description.spec.ts tests/application/describe-samples.spec.ts
git commit -m "feat(application): enrich samples in the background without blocking"
```

---

## Task 6: Application — scaffold and install

**Review Focus item 5** is pinned here: an install failure must never be reported as a scaffold failure. By the time installs run, the user's project exists and is intact.

**Files:**
- Create: `src/application/scaffold-sample.ts`
- Create: `src/application/install-dependencies.ts`
- Test: `tests/application/scaffold-sample.spec.ts`
- Test: `tests/application/install-dependencies.spec.ts`

**Interfaces:**
- Consumes: `ScaffoldPlan`, `SampleArchiveSource`, `WorkspaceWriter`, `PackageManagerRunner`, `PackageManager`, `TryNestError`, `isTryNestError`.
- Produces: `scaffoldSample(plan, archive, writer, signal?)`, `InstallOutcome`, `installDependencies(plan, runner, manager)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/application/scaffold-sample.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scaffoldSample } from "../../src/application/scaffold-sample.ts";
import type {
  ArchiveEntry,
  SampleArchiveSource,
  WorkspaceWriter,
} from "../../src/application/ports.ts";
import { TryNestError } from "../../src/domain/errors.ts";
import { planScaffold } from "../../src/domain/scaffold-plan.ts";

const plan = planScaffold(
  { id: "01-cats-app", displayName: "01-cats-app", layout: "single", subProjects: [] },
  "cats",
);

const emptyArchive: SampleArchiveSource = {
  async *entries(): AsyncIterable<ArchiveEntry> {
    return;
  },
};

describe("scaffoldSample", () => {
  it("hands the plan and the entry stream to the writer", async () => {
    let received: string | undefined;
    const writer: WorkspaceWriter = {
      materialize: async (received_plan) => {
        received = received_plan.targetDirectory;
      },
    };

    await scaffoldSample(plan, emptyArchive, writer);

    expect(received).toBe("cats");
  });

  it("names the directory it left behind when extraction fails midway", async () => {
    const writer: WorkspaceWriter = {
      materialize: async () => {
        throw new Error("disk full");
      },
    };

    await expect(scaffoldSample(plan, emptyArchive, writer)).rejects.toMatchObject({
      kind: "extraction-failed",
      details: { directory: "cats" },
    });
  });

  it("lets an already-translated domain failure through unchanged", async () => {
    const writer: WorkspaceWriter = {
      materialize: async () => {
        throw new TryNestError("unsafe-archive-entry", "nope");
      },
    };

    await expect(scaffoldSample(plan, emptyArchive, writer)).rejects.toMatchObject({
      kind: "unsafe-archive-entry",
    });
  });
});
```

Create `tests/application/install-dependencies.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { installDependencies } from "../../src/application/install-dependencies.ts";
import type { PackageManagerRunner } from "../../src/application/ports.ts";
import { planScaffold } from "../../src/domain/scaffold-plan.ts";

const single = planScaffold(
  { id: "01-cats-app", displayName: "01-cats-app", layout: "single", subProjects: [] },
  "cats",
);

const composite = planScaffold(
  {
    id: "31-federation",
    displayName: "31-federation",
    layout: "composite",
    subProjects: ["gateway", "posts-application"],
  },
  "federation",
);

function recordingRunner(failOn: string[] = []): {
  runner: PackageManagerRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const runner: PackageManagerRunner = {
    detect: async () => ["npm"],
    install: async (directory) => {
      calls.push(directory);
      if (failOn.some((needle) => directory.includes(needle))) {
        throw new Error("install blew up");
      }
    },
  };
  return { runner, calls };
}

describe("installDependencies", () => {
  it("installs once at the root for a single sample", async () => {
    const { runner, calls } = recordingRunner();

    const outcome = await installDependencies(single, runner, "npm");

    expect(calls).toEqual(["cats"]);
    expect(outcome.failures).toEqual([]);
  });

  it("installs once per sub-project for a composite sample", async () => {
    const { runner, calls } = recordingRunner();

    await installDependencies(composite, runner, "npm");

    expect(calls).toEqual([
      "federation/gateway",
      "federation/posts-application",
    ]);
  });

  it("records a failure without throwing, and keeps going", async () => {
    const { runner, calls } = recordingRunner(["gateway"]);

    const outcome = await installDependencies(composite, runner, "npm");

    expect(calls).toHaveLength(2);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.directory).toBe("federation/gateway");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- tests/application/scaffold-sample.spec.ts tests/application/install-dependencies.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement scaffolding**

Create `src/application/scaffold-sample.ts`:

```ts
import { TryNestError, isTryNestError } from "../domain/errors.ts";
import type { ScaffoldPlan } from "../domain/scaffold-plan.ts";
import type { SampleArchiveSource, WorkspaceWriter } from "./ports.ts";

export async function scaffoldSample(
  plan: ScaffoldPlan,
  archive: SampleArchiveSource,
  writer: WorkspaceWriter,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await writer.materialize(plan, archive.entries(signal));
  } catch (error) {
    if (isTryNestError(error)) throw error;

    // The tool aims not to leave debris, but if it did, the user must not have
    // to guess where it is.
    throw new TryNestError(
      "extraction-failed",
      `Failed while extracting into "${plan.targetDirectory}". You may need to remove it before retrying.`,
      { directory: plan.targetDirectory },
    );
  }
}
```

- [ ] **Step 4: Implement installation**

Create `src/application/install-dependencies.ts`:

```ts
import { join } from "node:path";
import type { PackageManager } from "../domain/package-manager.ts";
import type { ScaffoldPlan } from "../domain/scaffold-plan.ts";
import type { PackageManagerRunner } from "./ports.ts";

export interface InstallFailure {
  readonly directory: string;
  readonly reason: string;
}

export interface InstallOutcome {
  readonly failures: readonly InstallFailure[];
}

/**
 * Installs dependencies for every install unit in the plan.
 *
 * Never throws. By the time this runs the project already exists on disk and
 * is intact, so a failure here is a warning, not a failed run — presenting it
 * otherwise would send the user to delete work that is fine.
 */
export async function installDependencies(
  plan: ScaffoldPlan,
  runner: PackageManagerRunner,
  manager: PackageManager,
): Promise<InstallOutcome> {
  const failures: InstallFailure[] = [];

  for (const unit of plan.installUnits) {
    const directory =
      unit === "." ? plan.targetDirectory : join(plan.targetDirectory, unit);

    try {
      await runner.install(directory, manager);
    } catch (error) {
      failures.push({
        directory,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { failures };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- tests/application/`
Expected: PASS — all application specs green.

- [ ] **Step 6: Commit**

```bash
git add src/application/scaffold-sample.ts src/application/install-dependencies.ts tests/application/scaffold-sample.spec.ts tests/application/install-dependencies.spec.ts
git commit -m "feat(application): scaffold and install, keeping install failures non-fatal"
```

---

## Task 7: Adapter — GitHub tree catalog source

Owns **Review Focus items 1 and 4**. Truncation arrives as HTTP 200 with partial results and must become a hard failure; a rate limit must read as a quota, not an outage.

**Files:**
- Create: `src/adapters/github/constants.ts`
- Create: `src/adapters/github/http.ts`
- Create: `src/adapters/github/tree-catalog-source.ts`
- Create: `tests/helpers/fixtures.ts`
- Test: `tests/adapters/github/tree-catalog-source.spec.ts`

**Interfaces:**
- Consumes: `SampleCatalogSource` (Task 4), `TryNestError` (Task 1).
- Produces: `UPSTREAM_OWNER`, `UPSTREAM_REPOSITORY`, `UPSTREAM_REF`, `USER_AGENT`, `FetchLike`, `translateHttpFailure(response, kind)`, `createTreeCatalogSource(options?)`.

- [ ] **Step 1: Write the fixture helper**

Create `tests/helpers/fixtures.ts`:

```ts
export interface StubResponseInit {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/** Minimal stand-in for a fetch Response, enough for the adapters under test. */
export function stubResponse(init: StubResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  const body = init.body === undefined ? "" : JSON.stringify(init.body);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

/** A recorded shape of the recursive git tree response, trimmed to what we read. */
export const treeResponseFixture = {
  sha: "abc123",
  truncated: false,
  tree: [
    { path: "package.json", type: "blob" },
    { path: "packages/core/package.json", type: "blob" },
    { path: "sample", type: "tree" },
    { path: "sample/01-cats-app", type: "tree" },
    { path: "sample/01-cats-app/package.json", type: "blob" },
    { path: "sample/01-cats-app/src/main.ts", type: "blob" },
    { path: "sample/31-graphql-federation-code-first", type: "tree" },
    {
      path: "sample/31-graphql-federation-code-first/gateway/package.json",
      type: "blob",
    },
  ],
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/adapters/github/tree-catalog-source.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTreeCatalogSource } from "../../../src/adapters/github/tree-catalog-source.ts";
import { stubResponse, treeResponseFixture } from "../../helpers/fixtures.ts";

describe("createTreeCatalogSource", () => {
  it("returns only file paths from a recorded response", async () => {
    const source = createTreeCatalogSource({
      fetch: async () => stubResponse({ body: treeResponseFixture }),
    });

    const paths = await source.listPaths();

    expect(paths).toContain("sample/01-cats-app/package.json");
    expect(paths).not.toContain("sample/01-cats-app");
  });

  it("sends a User-Agent, which the API requires", async () => {
    let seen: Headers | undefined;
    const source = createTreeCatalogSource({
      fetch: async (_url, init) => {
        seen = new Headers(init?.headers);
        return stubResponse({ body: treeResponseFixture });
      },
    });

    await source.listPaths();

    expect(seen?.get("user-agent")).toBeTruthy();
  });

  it("refuses a truncated listing rather than returning a short catalog", async () => {
    const source = createTreeCatalogSource({
      fetch: async () =>
        stubResponse({ body: { ...treeResponseFixture, truncated: true } }),
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "catalog-incomplete",
    });
  });

  it("reads an exhausted quota as a rate limit, not an outage", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const source = createTreeCatalogSource({
      fetch: async () =>
        stubResponse({
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(reset),
          },
        }),
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });

  it("treats any other failure status as the catalog being unavailable", async () => {
    const source = createTreeCatalogSource({
      fetch: async () => stubResponse({ status: 500 }),
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "catalog-unavailable",
    });
  });

  it("translates a transport error rather than leaking it", async () => {
    const source = createTreeCatalogSource({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(source.listPaths()).rejects.toMatchObject({
      kind: "catalog-unavailable",
    });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/adapters/github/tree-catalog-source.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the upstream constants**

Create `src/adapters/github/constants.ts`. These are the only place the vendor's hosts appear.

```ts
export const UPSTREAM_OWNER = "nestjs";
export const UPSTREAM_REPOSITORY = "nest";
export const UPSTREAM_REF = "master";

export const USER_AGENT = "try-nest (+https://github.com/micalevisk/try-nest)";

export const TREE_ENDPOINT = `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/git/trees/${UPSTREAM_REF}?recursive=1`;

export const RAW_CONTENT_BASE = `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/${UPSTREAM_REF}`;

export const ARCHIVE_ENDPOINT = `https://codeload.github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/tar.gz/${UPSTREAM_REF}`;

/** The archive's own root directory, which is stripped during extraction. */
export const ARCHIVE_ROOT = `${UPSTREAM_REPOSITORY}-${UPSTREAM_REF}`;
```

- [ ] **Step 5: Write the shared failure translation**

Create `src/adapters/github/http.ts`:

```ts
import { TryNestError } from "../../domain/errors.ts";
import type { FailureKind } from "../../domain/errors.ts";
import { USER_AGENT } from "./constants.ts";

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export function defaultHeaders(): Record<string, string> {
  return { "user-agent": USER_AGENT };
}

/**
 * Turns a transport-level failure into something the core can reason about.
 * No status code ever crosses this boundary (ADR-0004).
 */
export function translateHttpFailure(
  response: Response,
  fallback: FailureKind,
): TryNestError {
  const remaining = response.headers.get("x-ratelimit-remaining");

  if ((response.status === 403 || response.status === 429) && remaining === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const waitSeconds = Number.isFinite(reset)
      ? Math.max(0, reset - Math.floor(Date.now() / 1000))
      : undefined;

    return new TryNestError(
      "rate-limited",
      waitSeconds === undefined
        ? "GitHub's request quota for this network is exhausted. Try again later."
        : `GitHub's request quota for this network is exhausted. Try again in about ${Math.ceil(waitSeconds / 60)} minute(s).`,
      waitSeconds === undefined ? {} : { retryInSeconds: String(waitSeconds) },
    );
  }

  return new TryNestError(
    fallback,
    `Upstream request failed with status ${response.status}.`,
    { status: String(response.status) },
  );
}
```

- [ ] **Step 6: Implement the catalog source**

Create `src/adapters/github/tree-catalog-source.ts`:

```ts
import { TryNestError, isTryNestError } from "../../domain/errors.ts";
import type { SampleCatalogSource } from "../../application/ports.ts";
import { TREE_ENDPOINT } from "./constants.ts";
import { defaultHeaders, translateHttpFailure } from "./http.ts";
import type { FetchLike } from "./http.ts";

interface TreeEntry {
  readonly path?: unknown;
  readonly type?: unknown;
}

interface TreeResponse {
  readonly tree?: readonly TreeEntry[];
  readonly truncated?: unknown;
}

export interface TreeCatalogSourceOptions {
  readonly fetch?: FetchLike;
  readonly endpoint?: string;
}

export function createTreeCatalogSource(
  options: TreeCatalogSourceOptions = {},
): SampleCatalogSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? TREE_ENDPOINT;

  return {
    async listPaths(signal?: AbortSignal): Promise<readonly string[]> {
      let response: Response;

      try {
        response = await doFetch(endpoint, {
          headers: defaultHeaders(),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (isTryNestError(error)) throw error;
        throw new TryNestError(
          "catalog-unavailable",
          "Could not reach GitHub to list the available samples. Check your network connection.",
        );
      }

      if (!response.ok) {
        throw translateHttpFailure(response, "catalog-unavailable");
      }

      const payload = (await response.json()) as TreeResponse;

      // A truncated listing arrives as a success with partial results. A loud
      // failure is vastly preferable to a catalog that is quietly incomplete.
      if (payload.truncated === true) {
        throw new TryNestError(
          "catalog-incomplete",
          "GitHub returned an incomplete listing of the repository, so some samples would be missing. Refusing to continue.",
        );
      }

      const entries = payload.tree ?? [];

      return entries
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
        .map((entry) => entry.path as string);
    },
  };
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npm test -- tests/adapters/github/tree-catalog-source.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/github/ tests/helpers/fixtures.ts tests/adapters/github/tree-catalog-source.spec.ts
git commit -m "feat(adapters): read the sample catalog from the git tree API"
```

---

## Task 8: Adapter — raw metadata source

Deliberately reads from the raw-content host rather than the API, keeping enrichment traffic off the metered path ([upstream-contract.md](../../upstream-contract.md)).

**Files:**
- Create: `src/adapters/github/raw-metadata-source.ts`
- Test: `tests/adapters/github/raw-metadata-source.spec.ts`

**Interfaces:**
- Consumes: `SampleMetadataSource` (Task 4), `RAW_CONTENT_BASE`, `FetchLike`.
- Produces: `createRawMetadataSource(options?)`.

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/github/raw-metadata-source.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRawMetadataSource } from "../../../src/adapters/github/raw-metadata-source.ts";
import { stubResponse } from "../../helpers/fixtures.ts";

describe("createRawMetadataSource", () => {
  it("reads the description out of a manifest", async () => {
    const source = createRawMetadataSource({
      fetch: async () => stubResponse({ body: { description: "Cats, but REST" } }),
    });

    expect(await source.readDescription("sample/01-cats-app/package.json")).toBe(
      "Cats, but REST",
    );
  });

  it("requests the manifest from the raw content host", async () => {
    let seen = "";
    const source = createRawMetadataSource({
      fetch: async (url) => {
        seen = url;
        return stubResponse({ body: {} });
      },
    });

    await source.readDescription("sample/01-cats-app/package.json");

    expect(seen).toContain("raw.githubusercontent.com");
    expect(seen).toContain("sample/01-cats-app/package.json");
  });

  it("returns nothing when the manifest is missing", async () => {
    const source = createRawMetadataSource({
      fetch: async () => stubResponse({ status: 404 }),
    });

    expect(
      await source.readDescription("sample/nope/package.json"),
    ).toBeUndefined();
  });

  it("returns nothing when the manifest has no description", async () => {
    const source = createRawMetadataSource({
      fetch: async () => stubResponse({ body: { name: "x" } }),
    });

    expect(await source.readDescription("a/package.json")).toBeUndefined();
  });

  it("returns nothing for an empty description", async () => {
    const source = createRawMetadataSource({
      fetch: async () => stubResponse({ body: { description: "   " } }),
    });

    expect(await source.readDescription("a/package.json")).toBeUndefined();
  });

  it("survives malformed JSON", async () => {
    const source = createRawMetadataSource({
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => {
            throw new SyntaxError("unexpected token");
          },
        }) as unknown as Response,
    });

    expect(await source.readDescription("a/package.json")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/adapters/github/raw-metadata-source.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/adapters/github/raw-metadata-source.ts`:

```ts
import type { SampleMetadataSource } from "../../application/ports.ts";
import { RAW_CONTENT_BASE } from "./constants.ts";
import { defaultHeaders } from "./http.ts";
import type { FetchLike } from "./http.ts";

interface Manifest {
  readonly description?: unknown;
}

export interface RawMetadataSourceOptions {
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

/**
 * A description is an enhancement, so every failure here resolves to
 * `undefined` rather than rejecting — the caller must not have to care.
 */
export function createRawMetadataSource(
  options: RawMetadataSourceOptions = {},
): SampleMetadataSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? RAW_CONTENT_BASE;

  return {
    async readDescription(
      manifestPath: string,
      signal?: AbortSignal,
    ): Promise<string | undefined> {
      try {
        const response = await doFetch(`${baseUrl}/${manifestPath}`, {
          headers: defaultHeaders(),
          ...(signal === undefined ? {} : { signal }),
        });

        if (!response.ok) return undefined;

        const manifest = (await response.json()) as Manifest;
        if (typeof manifest.description !== "string") return undefined;

        const description = manifest.description.trim();
        return description.length === 0 ? undefined : description;
      } catch {
        return undefined;
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/adapters/github/raw-metadata-source.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/github/raw-metadata-source.ts tests/adapters/github/raw-metadata-source.spec.ts
git commit -m "feat(adapters): read sample descriptions from raw content"
```

---

## Task 9: Adapter — codeload archive source

Streams the repository tarball and yields repository-relative entries. `tar-stream@3` is used rather than `tar-fs@3` because it ships its own type definitions (`tar-fs@3` ships none, and `@types/tar-fs@2.0.4` describes the v2 API) and because header-level access is what re-rooting needs.

**Files:**
- Create: `src/adapters/github/codeload-archive-source.ts`
- Test: `tests/adapters/github/codeload-archive-source.spec.ts`
- Modify: `package.json` (add `tar-stream`)

**Interfaces:**
- Consumes: `SampleArchiveSource`, `ArchiveEntry` (Task 4), `ARCHIVE_ENDPOINT`, `ARCHIVE_ROOT`.
- Produces: `stripArchiveRoot(entryName)`, `createCodeloadArchiveSource(options?)`.

- [ ] **Step 1: Add the dependency**

```bash
npm install tar-stream@^3.2.1
```

- [ ] **Step 2: Write the failing test**

Create `tests/adapters/github/codeload-archive-source.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stripArchiveRoot } from "../../../src/adapters/github/codeload-archive-source.ts";

describe("stripArchiveRoot", () => {
  it("removes the archive's own root directory", () => {
    expect(stripArchiveRoot("nest-master/sample/01-cats-app/package.json")).toBe(
      "sample/01-cats-app/package.json",
    );
  });

  it("returns null for the root entry itself", () => {
    expect(stripArchiveRoot("nest-master/")).toBeNull();
    expect(stripArchiveRoot("nest-master")).toBeNull();
  });

  it("returns null for anything not under the expected root", () => {
    expect(stripArchiveRoot("somethingelse/sample/x")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/adapters/github/codeload-archive-source.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/adapters/github/codeload-archive-source.ts`:

```ts
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import type {
  ArchiveEntry,
  SampleArchiveSource,
} from "../../application/ports.ts";
import { TryNestError, isTryNestError } from "../../domain/errors.ts";
import { ARCHIVE_ENDPOINT, ARCHIVE_ROOT } from "./constants.ts";
import { defaultHeaders, translateHttpFailure } from "./http.ts";
import type { FetchLike } from "./http.ts";

/**
 * The tarball nests everything under a single root directory named for the
 * repository and ref. Removing it is archive-format knowledge, so it belongs
 * here rather than in the domain.
 */
export function stripArchiveRoot(entryName: string): string | null {
  const prefix = `${ARCHIVE_ROOT}/`;
  if (!entryName.startsWith(prefix)) return null;

  const rest = entryName.slice(prefix.length);
  return rest.length === 0 ? null : rest;
}

export interface CodeloadArchiveSourceOptions {
  readonly fetch?: FetchLike;
  readonly endpoint?: string;
}

export function createCodeloadArchiveSource(
  options: CodeloadArchiveSourceOptions = {},
): SampleArchiveSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? ARCHIVE_ENDPOINT;

  return {
    async *entries(signal?: AbortSignal): AsyncIterable<ArchiveEntry> {
      let response: Response;

      try {
        response = await doFetch(endpoint, {
          headers: defaultHeaders(),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (isTryNestError(error)) throw error;
        throw new TryNestError(
          "archive-unavailable",
          "Could not download the sample archive from GitHub.",
        );
      }

      if (!response.ok || response.body === null) {
        throw translateHttpFailure(response, "archive-unavailable");
      }

      const tar = extract();
      Readable.fromWeb(response.body).pipe(createGunzip()).pipe(tar);

      for await (const entry of tar) {
        const path = stripArchiveRoot(entry.header.name);

        if (path !== null) {
          yield {
            path,
            kind:
              entry.header.type === "file"
                ? "file"
                : entry.header.type === "directory"
                  ? "directory"
                  : "other",
            mode: entry.header.mode,
            body: entry,
          };
        }

        // Drain whatever the consumer did not read, so the stream advances.
        entry.resume();
      }
    },
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- tests/adapters/github/codeload-archive-source.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/github/codeload-archive-source.ts tests/adapters/github/codeload-archive-source.spec.ts package.json package-lock.json
git commit -m "feat(adapters): stream the sample archive from codeload"
```

---

## Task 10: Adapter — workspace writer

Writes the re-rooted tree to disk. **Review Focus item 2** is enforced a second time here, with a resolved-path containment check, because this is the only code that actually writes.

**Files:**
- Create: `src/adapters/fs/workspace-writer.ts`
- Create: `src/adapters/fs/target-directory-probe.ts`
- Test: `tests/adapters/fs/workspace-writer.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceWriter`, `TargetDirectoryProbe`, `ArchiveEntry` (Task 4), `rerootEntryPath` (Task 3).
- Produces: `createWorkspaceWriter()`, `createTargetDirectoryProbe()`.

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/fs/workspace-writer.spec.ts`:

```ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceWriter } from "../../../src/adapters/fs/workspace-writer.ts";
import type { ArchiveEntry } from "../../../src/application/ports.ts";
import { planScaffold } from "../../../src/domain/scaffold-plan.ts";

const sample = {
  id: "01-cats-app",
  displayName: "01-cats-app",
  layout: "single" as const,
  subProjects: [],
};

function fileEntry(path: string, contents: string, mode = 0o644): ArchiveEntry {
  return {
    path,
    kind: "file",
    mode,
    body: (async function* () {
      yield new TextEncoder().encode(contents);
    })(),
  };
}

async function* streamOf(...entries: ArchiveEntry[]): AsyncIterable<ArchiveEntry> {
  for (const entry of entries) yield entry;
}

describe("createWorkspaceWriter", () => {
  it("writes the sample's own files at the target root", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await createWorkspaceWriter().materialize(
      plan,
      streamOf(
        fileEntry("sample/01-cats-app/package.json", '{"name":"cats"}'),
        fileEntry("sample/01-cats-app/src/main.ts", "export {};"),
      ),
    );

    expect(await readFile(join(target, "package.json"), "utf8")).toBe(
      '{"name":"cats"}',
    );
    expect(await readFile(join(target, "src", "main.ts"), "utf8")).toBe(
      "export {};",
    );
  });

  it("writes nothing that belongs to another sample", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await createWorkspaceWriter().materialize(
      plan,
      streamOf(
        fileEntry("sample/01-cats-app/keep.txt", "keep"),
        fileEntry("sample/02-gateways/skip.txt", "skip"),
        fileEntry("packages/core/skip.txt", "skip"),
      ),
    );

    expect(await readFile(join(target, "keep.txt"), "utf8")).toBe("keep");
    await expect(stat(join(target, "skip.txt"))).rejects.toThrow();
  });

  it("refuses an entry that would escape the target directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await expect(
      createWorkspaceWriter().materialize(
        plan,
        streamOf(fileEntry("sample/01-cats-app/../../escaped.txt", "bad")),
      ),
    ).rejects.toMatchObject({ kind: "unsafe-archive-entry" });

    await expect(stat(join(root, "escaped.txt"))).rejects.toThrow();
  });

  it("preserves the executable bit", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    await createWorkspaceWriter().materialize(
      plan,
      streamOf(fileEntry("sample/01-cats-app/run.sh", "#!/bin/sh\n", 0o755)),
    );

    const stats = await stat(join(target, "run.sh"));
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/adapters/fs/workspace-writer.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the writer**

Create `src/adapters/fs/workspace-writer.ts`:

```ts
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ArchiveEntry, WorkspaceWriter } from "../../application/ports.ts";
import { TryNestError } from "../../domain/errors.ts";
import { rerootEntryPath } from "../../domain/scaffold-plan.ts";
import type { ScaffoldPlan } from "../../domain/scaffold-plan.ts";

export function createWorkspaceWriter(): WorkspaceWriter {
  return {
    async materialize(
      plan: ScaffoldPlan,
      entries: AsyncIterable<ArchiveEntry>,
    ): Promise<void> {
      const targetRoot = resolve(plan.targetDirectory);
      await mkdir(targetRoot, { recursive: true });

      for await (const entry of entries) {
        const relative = rerootEntryPath(plan, entry.path);
        if (relative === null) continue;

        const destination = resolve(join(targetRoot, relative));

        // Belt and braces. The domain already rejects traversal, but this is
        // the only code that writes, so it checks the resolved result too.
        if (
          destination !== targetRoot &&
          !destination.startsWith(targetRoot + sep)
        ) {
          throw new TryNestError(
            "unsafe-archive-entry",
            `Refusing to write "${entry.path}" outside the target directory.`,
            { entry: entry.path },
          );
        }

        if (entry.kind === "directory") {
          await mkdir(destination, { recursive: true });
          continue;
        }

        if (entry.kind !== "file") continue;

        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, Readable.from(entry.body));

        const permissions = entry.mode & 0o777;
        if (permissions !== 0) await chmod(destination, permissions);
      }
    },
  };
}
```

- [ ] **Step 4: Implement the directory probe**

Create `src/adapters/fs/target-directory-probe.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- tests/adapters/fs/workspace-writer.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/fs/ tests/adapters/fs/
git commit -m "feat(adapters): write the re-rooted sample tree to disk"
```

---

## Task 11: Adapter — package manager runner

The command-line syntax of each manager lives here, not in the domain. The pure parts are tested directly; actually spawning a manager is covered end to end in Task 15.

**Files:**
- Create: `src/adapters/process/package-manager-runner.ts`
- Test: `tests/adapters/process/package-manager-runner.spec.ts`

**Interfaces:**
- Consumes: `PackageManagerRunner` (Task 4), `PackageManager`, `PACKAGE_MANAGERS` (Task 3).
- Produces: `executableFor(manager, platform)`, `installArgsFor(manager)`, `createPackageManagerRunner()`.

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/process/package-manager-runner.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  executableFor,
  installArgsFor,
} from "../../../src/adapters/process/package-manager-runner.ts";

describe("executableFor", () => {
  it("uses the plain binary name off Windows", () => {
    expect(executableFor("pnpm", "linux")).toBe("pnpm");
    expect(executableFor("npm", "darwin")).toBe("npm");
  });

  it("uses the .cmd shim on Windows, so no shell is needed", () => {
    expect(executableFor("npm", "win32")).toBe("npm.cmd");
    expect(executableFor("yarn", "win32")).toBe("yarn.cmd");
  });

  it("leaves bun alone on Windows, which ships a real executable", () => {
    expect(executableFor("bun", "win32")).toBe("bun.exe");
  });
});

describe("installArgsFor", () => {
  it("installs with every supported manager", () => {
    expect(installArgsFor("npm")).toEqual(["install"]);
    expect(installArgsFor("pnpm")).toEqual(["install"]);
    expect(installArgsFor("yarn")).toEqual(["install"]);
    expect(installArgsFor("bun")).toEqual(["install"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/adapters/process/package-manager-runner.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/adapters/process/package-manager-runner.ts`:

```ts
import { spawn } from "node:child_process";
import type { PackageManagerRunner } from "../../application/ports.ts";
import {
  PACKAGE_MANAGERS,
  type PackageManager,
} from "../../domain/package-manager.ts";

/**
 * Windows resolves npm/pnpm/yarn through .cmd shims. Naming the shim directly
 * avoids spawning through a shell, which would otherwise mangle paths
 * containing spaces.
 */
export function executableFor(
  manager: PackageManager,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return manager;
  return manager === "bun" ? "bun.exe" : `${manager}.cmd`;
}

export function installArgsFor(_manager: PackageManager): readonly string[] {
  return ["install"];
}

function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  stdio: "inherit" | "ignore",
): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [...args], { cwd, stdio, shell: false });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

export function createPackageManagerRunner(): PackageManagerRunner {
  return {
    async detect(): Promise<readonly PackageManager[]> {
      const available: PackageManager[] = [];

      for (const manager of PACKAGE_MANAGERS) {
        try {
          const code = await run(
            executableFor(manager),
            ["--version"],
            process.cwd(),
            "ignore",
          );
          if (code === 0) available.push(manager);
        } catch {
          // Not installed. Nothing to report.
        }
      }

      return available;
    },

    async install(directory: string, manager: PackageManager): Promise<void> {
      const code = await run(
        executableFor(manager),
        installArgsFor(manager),
        directory,
        "inherit",
      );

      if (code !== 0) {
        throw new Error(`${manager} install exited with code ${code}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/adapters/process/package-manager-runner.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/process/ tests/adapters/process/
git commit -m "feat(adapters): run installs with the chosen package manager"
```

---

## Task 12: Delivery — command-line parameters

Owns **Review Focus item 3**: with no TTY and a required input missing, the tool must exit with a message naming what was missing, never block on a prompt nobody can answer.

`node:util`'s `parseArgs` is used rather than a dependency. Note that `allowNegative` only landed in Node 22.4, below our `>=22.0.0` floor, so `--no-install` is declared as its own boolean.

**Files:**
- Create: `src/adapters/cli/parameters.ts`
- Test: `tests/adapters/cli/parameters.spec.ts`

**Interfaces:**
- Consumes: `PackageManager`, `isPackageManager` (Task 3), `TryNestError` (Task 1).
- Produces: `Inputs`, `parseParameters(argv)`, `assertSufficientForNonInteractive(inputs)`, `HELP_TEXT`.

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/cli/parameters.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertSufficientForNonInteractive,
  parseParameters,
} from "../../../src/adapters/cli/parameters.ts";

describe("parseParameters", () => {
  it("defaults to an all-interactive run", () => {
    const inputs = parseParameters([]);

    expect(inputs.sample).toBeUndefined();
    expect(inputs.directory).toBeUndefined();
    expect(inputs.install).toBeUndefined();
  });

  it("reads the long flags", () => {
    const inputs = parseParameters([
      "--sample",
      "01-cats-app",
      "--dir",
      "cats",
      "--package-manager",
      "pnpm",
      "--install",
    ]);

    expect(inputs).toMatchObject({
      sample: "01-cats-app",
      directory: "cats",
      packageManager: "pnpm",
      install: true,
    });
  });

  it("reads the short flags", () => {
    expect(parseParameters(["-s", "02-gateways", "-d", "gw"])).toMatchObject({
      sample: "02-gateways",
      directory: "gw",
    });
  });

  it("treats --no-install as an explicit no", () => {
    expect(parseParameters(["--no-install"]).install).toBe(false);
  });

  it("rejects an unknown package manager", () => {
    expect(() => parseParameters(["--package-manager", "cargo"])).toThrowError(
      /cargo/,
    );
  });

  it("rejects an unknown flag", () => {
    expect(() => parseParameters(["--turbo"])).toThrowError();
  });
});

describe("assertSufficientForNonInteractive", () => {
  it("passes when everything needed was supplied", () => {
    expect(() =>
      assertSufficientForNonInteractive(
        parseParameters(["-s", "01-cats-app", "-d", "cats", "--no-install"]),
      ),
    ).not.toThrow();
  });

  it("names the missing sample rather than hanging on a prompt", () => {
    expect(() =>
      assertSufficientForNonInteractive(parseParameters(["-d", "cats"])),
    ).toThrowError(/--sample/);
  });

  it("names the missing directory", () => {
    expect(() =>
      assertSufficientForNonInteractive(parseParameters(["-s", "01-cats-app"])),
    ).toThrowError(/--dir/);
  });

  it("accepts --yes in place of the directory, which then defaults", () => {
    expect(() =>
      assertSufficientForNonInteractive(
        parseParameters(["-s", "01-cats-app", "--yes"]),
      ),
    ).not.toThrow();
  });

  it("needs nothing else when only listing", () => {
    expect(() =>
      assertSufficientForNonInteractive(parseParameters(["--list"])),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/adapters/cli/parameters.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/adapters/cli/parameters.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/adapters/cli/parameters.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/cli/parameters.ts tests/adapters/cli/parameters.spec.ts
git commit -m "feat(cli): parse parameters and fail fast without a terminal"
```

---

## Task 13: Delivery — prompts and presenter

Failure rendering is extracted as a pure function so it can be tested without a terminal. The prompt wiring itself is thin enough to be covered end to end.

**Files:**
- Create: `src/adapters/cli/presenter.ts`
- Create: `src/adapters/cli/prompts.ts`
- Test: `tests/adapters/cli/presenter.spec.ts`
- Modify: `package.json` (add `@inquirer/prompts`)

**Interfaces:**
- Consumes: `Presenter`, `Interaction` (Task 4), `TryNestError`, `Sample`, `ScaffoldPlan`, `PackageManager`.
- Produces: `renderFailure(error)`, `exitCodeFor(error)`, `createPresenter(stream?)`, `createPrompts()`.

- [ ] **Step 1: Add the dependency**

```bash
npm install @inquirer/prompts@^8.7.2
```

- [ ] **Step 2: Write the failing test**

Create `tests/adapters/cli/presenter.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  exitCodeFor,
  renderFailure,
} from "../../../src/adapters/cli/presenter.ts";
import { TryNestError } from "../../../src/domain/errors.ts";

describe("renderFailure", () => {
  it("explains a rate limit as a quota rather than an outage", () => {
    const message = renderFailure(
      new TryNestError("rate-limited", "quota exhausted", {
        retryInSeconds: "600",
      }),
    );

    expect(message).toMatch(/quota/i);
    expect(message).not.toMatch(/stack/i);
  });

  it("tells the user which directory was left behind", () => {
    const message = renderFailure(
      new TryNestError("extraction-failed", "failed midway", {
        directory: "cats",
      }),
    );

    expect(message).toContain("cats");
  });

  it("refuses to continue on an incomplete catalog, and says why", () => {
    const message = renderFailure(
      new TryNestError("catalog-incomplete", "truncated"),
    );

    expect(message).toMatch(/incomplete/i);
  });
});

describe("exitCodeFor", () => {
  it("distinguishes user error from environmental failure", () => {
    expect(exitCodeFor(new TryNestError("input-required", "x"))).toBe(2);
    expect(exitCodeFor(new TryNestError("target-directory-unusable", "x"))).toBe(2);
    expect(exitCodeFor(new TryNestError("sample-not-found", "x"))).toBe(2);

    expect(exitCodeFor(new TryNestError("catalog-unavailable", "x"))).toBe(1);
    expect(exitCodeFor(new TryNestError("rate-limited", "x"))).toBe(1);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/adapters/cli/presenter.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the presenter**

Create `src/adapters/cli/presenter.ts`:

```ts
import type { Presenter } from "../../application/ports.ts";
import type { TryNestError } from "../../domain/errors.ts";
import type { ScaffoldPlan } from "../../domain/scaffold-plan.ts";
import {
  UPSTREAM_OWNER,
  UPSTREAM_REF,
  UPSTREAM_REPOSITORY,
} from "../github/constants.ts";

/** User error exits 2; an environmental failure exits 1. */
export function exitCodeFor(error: TryNestError): number {
  switch (error.kind) {
    case "input-required":
    case "target-directory-unusable":
    case "sample-not-found":
      return 2;
    default:
      return 1;
  }
}

export function renderFailure(error: TryNestError): string {
  const directory = error.details.directory;

  switch (error.kind) {
    case "rate-limited":
      return `${error.message}\n\nThis is a request quota, not an outage — the same command should work again shortly.`;
    case "catalog-incomplete":
      return `${error.message}\n\nThe listing came back incomplete, so some samples would be missing. This usually means upstream has outgrown a single request.`;
    case "extraction-failed":
      return `${error.message}${directory === undefined ? "" : `\n\nPartial output may remain in "${directory}".`}`;
    case "install-failed":
      return `${error.message}\n\nYour project was created successfully — only the dependency install failed. Run the install again inside the directory.`;
    default:
      return error.message;
  }
}

export function createPresenter(
  stream: NodeJS.WritableStream = process.stderr,
): Presenter {
  const write = (line: string): void => {
    stream.write(`${line}\n`);
  };

  return {
    starting() {
      write("Fetching the available NestJS samples…");
    },
    scaffolding(plan: ScaffoldPlan) {
      write(`Scaffolding ${plan.sample.id} into ${plan.targetDirectory}…`);
    },
    installing(directory: string) {
      write(`Installing dependencies in ${directory}…`);
    },
    succeeded(plan: ScaffoldPlan, installed: boolean) {
      const upstream = `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPOSITORY}/tree/${UPSTREAM_REF}/sample/${plan.sample.id}`;

      write("");
      write(`Done. ${plan.sample.id} is ready in ${plan.targetDirectory}.`);
      write("");
      write("Next steps:");
      write(`  cd ${plan.targetDirectory}`);
      if (!installed) write("  npm install");
      write("  npm run start:dev");
      write("");
      write(`Upstream: ${upstream}`);
    },
    warn(message: string) {
      write(`Warning: ${message}`);
    },
    failed(error: TryNestError) {
      write("");
      write(renderFailure(error));
    },
  };
}
```

- [ ] **Step 5: Implement the prompts**

Create `src/adapters/cli/prompts.ts`:

```ts
import { confirm, input, select } from "@inquirer/prompts";
import type { Interaction } from "../../application/ports.ts";
import type { PackageManager } from "../../domain/package-manager.ts";
import type { Sample } from "../../domain/sample.ts";

export function createPrompts(): Interaction {
  return {
    async chooseSample(samples: readonly Sample[]): Promise<Sample> {
      return select({
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
      });
    },

    async chooseTargetDirectory(suggested: string): Promise<string> {
      return input({
        message: "Where should it go?",
        default: suggested,
      });
    },

    async confirmInstall(): Promise<boolean> {
      return confirm({
        message: "Install dependencies now?",
        default: true,
      });
    },

    async choosePackageManager(
      available: readonly PackageManager[],
    ): Promise<PackageManager> {
      return select({
        message: "Which package manager?",
        choices: available.map((manager) => ({ name: manager, value: manager })),
      });
    },
  };
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test -- tests/adapters/cli/presenter.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/cli/presenter.ts src/adapters/cli/prompts.ts tests/adapters/cli/presenter.spec.ts package.json package-lock.json
git commit -m "feat(cli): add prompts and terminal presentation"
```

---

## Task 14: Delivery — composition root and entry point

The one place that knows every concrete adapter. Also where the prefetch from [ADR-0005](../../adr/0005-prefetch-without-cache.md) happens.

> **Implementation note on enrichment.** [ADR-0006](../../adr/0006-upstream-only-sample-metadata.md) describes descriptions merging into the list "as they arrive". A terminal `select` prompt cannot mutate its choices once open, so the honest implementation is a **bounded wait**: enrichment starts as soon as the catalog lands and is awaited against a short deadline. Whatever has arrived by then is shown; the rest is dropped. This preserves the invariant that matters — enrichment never blocks the picker — without pretending the prompt can redraw. Task 17 records this in the docs.

**Files:**
- Create: `src/adapters/cli/run.ts`
- Modify: `src/domain/catalog.ts` (add `findSample`)
- Modify: `src/bin/try-nest.cli.ts` (replace the stub)
- Test: `tests/adapters/cli/run.spec.ts`

**Interfaces:**
- Consumes: every port and use case defined so far.
- Produces: `findSample(samples, id)`, `RunDependencies`, `RunEnvironment`, `createRunDependencies()`, `run(argv, deps, env)`.

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/cli/run.spec.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/adapters/cli/run.ts";
import type { RunDependencies } from "../../../src/adapters/cli/run.ts";
import type { ArchiveEntry } from "../../../src/application/ports.ts";
import { TryNestError } from "../../../src/domain/errors.ts";

function depsWith(overrides: Partial<RunDependencies> = {}): {
  deps: RunDependencies;
  lines: string[];
} {
  const lines: string[] = [];

  const deps: RunDependencies = {
    catalog: {
      listPaths: async () => [
        "sample/01-cats-app/package.json",
        "sample/02-gateways/package.json",
      ],
    },
    metadata: { readDescription: async () => undefined },
    archive: {
        async *entries(): AsyncIterable<ArchiveEntry> {
        return;
      },
    },
    writer: { materialize: async () => {} },
    probe: {
      inspect: async () => ({ exists: false, isDirectory: false, isEmpty: true }),
    },
    runner: { detect: async () => ["npm"], install: async () => {} },
    interaction: {
      chooseSample: async (samples) => samples[0] as never,
      chooseTargetDirectory: async (suggested) => suggested,
      confirmInstall: async () => false,
      choosePackageManager: async () => "npm",
    },
    presenter: {
      starting: () => {},
      scaffolding: () => {},
      installing: () => {},
      succeeded: () => lines.push("succeeded"),
      warn: (message) => lines.push(`warn:${message}`),
      failed: (error) => lines.push(`failed:${error.kind}`),
    },
    stdout: { write: (chunk: string) => void lines.push(chunk.trimEnd()) },
    ...overrides,
  };

  return { deps, lines };
}

const nonInteractive = { interactive: false, version: "0.0.0-test" };

describe("run", () => {
  it("scaffolds without prompting when every input is supplied", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const { deps, lines } = depsWith();

    const code = await run(
      ["--sample", "01-cats-app", "--dir", join(root, "cats"), "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(lines).toContain("succeeded");
  });

  it("lists the samples and exits", async () => {
    const { deps, lines } = depsWith();

    const code = await run(["--list"], deps, nonInteractive);

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("01-cats-app");
  });

  it("exits 2 for an unknown sample", async () => {
    const { deps, lines } = depsWith();

    const code = await run(
      ["--sample", "99-nope", "--dir", "x", "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(2);
    expect(lines).toContain("failed:sample-not-found");
  });

  it("exits 2 when a required input is missing and there is no terminal", async () => {
    const { deps, lines } = depsWith();

    const code = await run([], deps, nonInteractive);

    expect(code).toBe(2);
    expect(lines).toContain("failed:input-required");
  });

  it("exits 1 when upstream rate limits us", async () => {
    const { deps, lines } = depsWith({
      catalog: {
        listPaths: async () => {
          throw new TryNestError("rate-limited", "quota exhausted");
        },
      },
    });

    const code = await run(
      ["--sample", "01-cats-app", "--dir", "x", "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(1);
    expect(lines).toContain("failed:rate-limited");
  });

  it("still succeeds when the install fails, and warns instead", async () => {
    const root = await mkdtemp(join(tmpdir(), "try-nest-run-"));
    const { deps, lines } = depsWith({
      runner: {
        detect: async () => ["npm"],
        install: async () => {
          throw new Error("network down");
        },
      },
    });

    const code = await run(
      [
        "--sample",
        "01-cats-app",
        "--dir",
        join(root, "cats"),
        "--install",
        "--package-manager",
        "npm",
      ],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(lines).toContain("succeeded");
    expect(lines.some((line) => line.startsWith("warn:"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/adapters/cli/run.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add sample lookup to the domain**

Append to `src/domain/catalog.ts`:

```ts
import { TryNestError } from "./errors.ts";

export function findSample(samples: readonly Sample[], id: string): Sample {
  const match = samples.find((sample) => sample.id === id);
  if (match !== undefined) return match;

  const needle = id.toLowerCase();
  const close = samples
    .filter((sample) => sample.id.toLowerCase().includes(needle))
    .slice(0, 5)
    .map((sample) => sample.id);

  throw new TryNestError(
    "sample-not-found",
    close.length === 0
      ? `No sample named "${id}". Run with --list to see what is available.`
      : `No sample named "${id}". Did you mean: ${close.join(", ")}?`,
    { requested: id },
  );
}
```

- [ ] **Step 4: Implement the composition root**

Create `src/adapters/cli/run.ts`:

```ts
import { describeSamples } from "../../application/describe-samples.ts";
import { installDependencies } from "../../application/install-dependencies.ts";
import { listSamples } from "../../application/list-samples.ts";
import { scaffoldSample } from "../../application/scaffold-sample.ts";
import type {
  Interaction,
  PackageManagerRunner,
  Presenter,
  SampleArchiveSource,
  SampleCatalogSource,
  SampleMetadataSource,
  TargetDirectoryProbe,
  WorkspaceWriter,
} from "../../application/ports.ts";
import { findSample } from "../../domain/catalog.ts";
import { TryNestError, isTryNestError } from "../../domain/errors.ts";
import type { Sample } from "../../domain/sample.ts";
import { planScaffold } from "../../domain/scaffold-plan.ts";
import {
  assertTargetDirectoryUsable,
  defaultTargetDirectoryFor,
} from "../../domain/target-directory.ts";
import { createCodeloadArchiveSource } from "../github/codeload-archive-source.ts";
import { createRawMetadataSource } from "../github/raw-metadata-source.ts";
import { createTreeCatalogSource } from "../github/tree-catalog-source.ts";
import { createTargetDirectoryProbe } from "../fs/target-directory-probe.ts";
import { createWorkspaceWriter } from "../fs/workspace-writer.ts";
import { createPackageManagerRunner } from "../process/package-manager-runner.ts";
import {
  HELP_TEXT,
  assertSufficientForNonInteractive,
  parseParameters,
} from "./parameters.ts";
import { createPresenter, exitCodeFor } from "./presenter.ts";
import { createPrompts } from "./prompts.ts";

/** How long the picker will wait for descriptions before rendering without them. */
const ENRICHMENT_DEADLINE_MS = 1_500;

export interface RunDependencies {
  readonly catalog: SampleCatalogSource;
  readonly metadata: SampleMetadataSource;
  readonly archive: SampleArchiveSource;
  readonly writer: WorkspaceWriter;
  readonly probe: TargetDirectoryProbe;
  readonly runner: PackageManagerRunner;
  readonly interaction: Interaction;
  readonly presenter: Presenter;
  readonly stdout: { write(chunk: string): void };
}

export interface RunEnvironment {
  readonly interactive: boolean;
  /** Printed by --version. Supplied by the entry point from package metadata. */
  readonly version: string;
}

export function createRunDependencies(): RunDependencies {
  return {
    catalog: createTreeCatalogSource(),
    metadata: createRawMetadataSource(),
    archive: createCodeloadArchiveSource(),
    writer: createWorkspaceWriter(),
    probe: createTargetDirectoryProbe(),
    runner: createPackageManagerRunner(),
    interaction: createPrompts(),
    presenter: createPresenter(),
    stdout: { write: (chunk: string) => void process.stdout.write(chunk) },
  };
}

async function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  fallback: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<T>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(fallback), milliseconds);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function run(
  argv: readonly string[],
  deps: RunDependencies,
  env: RunEnvironment,
): Promise<number> {
  try {
    const inputs = parseParameters(argv);

    if (inputs.help) {
      deps.stdout.write(HELP_TEXT);
      return 0;
    }

    if (inputs.version) {
      deps.stdout.write(`${env.version}\n`);
      return 0;
    }

    if (!env.interactive) assertSufficientForNonInteractive(inputs);

    // Start the catalog request before anything is drawn (ADR-0005).
    const catalogPromise = listSamples(deps.catalog);
    deps.presenter.starting();
    const samples = await catalogPromise;

    if (inputs.list) {
      deps.stdout.write(
        inputs.json
          ? `${JSON.stringify(samples.map((s) => ({ id: s.id, layout: s.layout })))}\n`
          : `${samples.map((s) => s.id).join("\n")}\n`,
      );
      return 0;
    }

    // Enrichment is an enhancement: bounded wait, then render regardless.
    const enriched = await withDeadline(
      describeSamples(samples, deps.metadata),
      ENRICHMENT_DEADLINE_MS,
      samples,
    );

    const sample: Sample =
      inputs.sample === undefined
        ? await deps.interaction.chooseSample(enriched)
        : findSample(enriched, inputs.sample);

    const suggested = defaultTargetDirectoryFor(sample);
    const directory =
      inputs.directory ??
      (inputs.yes
        ? suggested
        : await deps.interaction.chooseTargetDirectory(suggested));

    assertTargetDirectoryUsable(directory, await deps.probe.inspect(directory));

    const plan = planScaffold(sample, directory);
    deps.presenter.scaffolding(plan);
    await scaffoldSample(plan, deps.archive, deps.writer);

    let installed = false;
    const wantsInstall =
      inputs.install ??
      (inputs.yes ? true : await deps.interaction.confirmInstall());

    if (wantsInstall) {
      const available = await deps.runner.detect();
      const manager =
        inputs.packageManager ??
        (available.length <= 1 || inputs.yes
          ? (available[0] ?? "npm")
          : await deps.interaction.choosePackageManager(available));

      for (const unit of plan.installUnits) {
        deps.presenter.installing(
          unit === "." ? plan.targetDirectory : `${plan.targetDirectory}/${unit}`,
        );
      }

      const outcome = await installDependencies(plan, deps.runner, manager);
      installed = outcome.failures.length === 0;

      for (const failure of outcome.failures) {
        deps.presenter.warn(
          `Dependency install failed in ${failure.directory} (${failure.reason}). Your project is intact — run the install again there.`,
        );
      }
    }

    deps.presenter.succeeded(plan, installed);
    return 0;
  } catch (error) {
    const failure = isTryNestError(error)
      ? error
      : new TryNestError(
          "catalog-unavailable",
          error instanceof Error ? error.message : String(error),
        );

    deps.presenter.failed(failure);
    return exitCodeFor(failure);
  }
}
```

- [ ] **Step 5: Replace the stub entry point**

Replace the whole contents of `src/bin/try-nest.cli.ts`:

```ts
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
```

- [ ] **Step 6: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all specs PASS, `tsc` exits 0.

- [ ] **Step 7: Try it against the real upstream**

Run: `node --experimental-transform-types ./src/bin/try-nest.cli.ts --list`
Expected: 36 sample ids, one per line.

Run: `node --experimental-transform-types ./src/bin/try-nest.cli.ts --sample 01-cats-app --dir /tmp/try-nest-smoke --no-install`
Expected: exits 0; `/tmp/try-nest-smoke/package.json` exists and `/tmp/try-nest-smoke/sample` does not.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/cli/run.ts src/bin/try-nest.cli.ts src/domain/catalog.ts tests/adapters/cli/run.spec.ts
git commit -m "feat(cli): wire the composition root and replace the stub entry point"
```

---

## Task 15: End to end — the standalone-output promise

The single most valuable test in the repository. It runs the real pipeline — archive stream, re-rooting, writer, disk — against a tarball built in the test, so it stays **fully offline** ([testing-strategy.md](../../testing-strategy.md)).

> **Why the assertion resolves paths instead of grepping for `../../`.** Upstream e2e specs live at `sample/<id>/e2e/<feature>/*.e2e-spec.ts` and import `../../src/...`, which resolves to `sample/<id>/src/...` — inside the sample, and valid after extraction. A string search for `../../` would flag those as escapes. The correct check resolves each relative specifier against its own file's directory and asserts the result stays within the target root.

**Files:**
- Create: `tests/e2e/scaffold.spec.ts`

**Interfaces:**
- Consumes: `createCodeloadArchiveSource`, `createWorkspaceWriter`, `planScaffold`, `scaffoldSample`.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/scaffold.spec.ts`:

```ts
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { describe, expect, it } from "vitest";
import { createCodeloadArchiveSource } from "../../src/adapters/github/codeload-archive-source.ts";
import { createWorkspaceWriter } from "../../src/adapters/fs/workspace-writer.ts";
import { scaffoldSample } from "../../src/application/scaffold-sample.ts";
import type { Sample } from "../../src/domain/sample.ts";
import { planScaffold } from "../../src/domain/scaffold-plan.ts";

/** Builds a gzipped tarball shaped like GitHub's repository archive. */
async function buildArchive(
  files: Readonly<Record<string, string>>,
): Promise<Uint8Array> {
  const tarball = pack();
  for (const [name, contents] of Object.entries(files)) {
    tarball.entry({ name: `nest-master/${name}` }, contents);
  }
  tarball.finalize();

  const chunks: Uint8Array[] = [];
  for await (const chunk of tarball) chunks.push(chunk as Uint8Array);

  return gzipSync(Buffer.concat(chunks));
}

function archiveResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200 });
}

async function walk(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const full = join(directory, name);
      if ((await stat(full)).isDirectory()) await visit(full);
      else found.push(full);
    }
  }

  await visit(root);
  return found;
}

const RELATIVE_SPECIFIER = /["'](\.[^"']*)["']/g;

/**
 * Asserts nothing in the scaffolded tree resolves outside its own root — the
 * standalone-output invariant (ADR-0008).
 */
async function assertStandalone(root: string): Promise<void> {
  const absoluteRoot = resolve(root);

  for (const file of await walk(root)) {
    if (!/\.(ts|mts|js|mjs|json)$/.test(file)) continue;

    const contents = await readFile(file, "utf8");

    for (const match of contents.matchAll(RELATIVE_SPECIFIER)) {
      const specifier = match[1] as string;
      const resolved = resolve(dirname(file), specifier);

      expect(
        resolved === absoluteRoot || resolved.startsWith(absoluteRoot + sep),
        `${relative(root, file)} references "${specifier}", which escapes the scaffolded project`,
      ).toBe(true);
    }
  }
}

const sample: Sample = {
  id: "01-cats-app",
  displayName: "01-cats-app",
  layout: "single",
  subProjects: [],
};

describe("scaffolding end to end", () => {
  it("produces a standalone project rooted at the target directory", async () => {
    const bytes = await buildArchive({
      "package.json": '{"name":"monorepo"}',
      "packages/core/index.ts": "export {};",
      "sample/02-gateways/src/main.ts": "export {};",
      "sample/01-cats-app/package.json": '{"name":"cats","dependencies":{"@nestjs/core":"^12.0.0"}}',
      "sample/01-cats-app/tsconfig.json": '{"compilerOptions":{}}',
      "sample/01-cats-app/tsconfig.build.json": '{"extends":"./tsconfig.json"}',
      "sample/01-cats-app/src/main.ts": 'import { AppModule } from "./app.module.js";',
      "sample/01-cats-app/e2e/cats/cats.e2e-spec.ts":
        'import { CatsModule } from "../../src/cats/cats.module.js";',
    });

    const root = await mkdtemp(join(tmpdir(), "try-nest-e2e-"));
    const target = join(root, "cats");
    const plan = planScaffold(sample, target);

    const archive = createCodeloadArchiveSource({
      fetch: async () => archiveResponse(bytes),
    });

    await scaffoldSample(plan, archive, createWorkspaceWriter());

    // The sample's own files land at the root, not nested under sample/.
    expect(await readFile(join(target, "package.json"), "utf8")).toContain("cats");
    await expect(stat(join(target, "sample"))).rejects.toThrow();
    await expect(stat(join(target, "packages"))).rejects.toThrow();

    // Nothing from another sample came along.
    await expect(stat(join(target, "src", "main.ts"))).resolves.toBeTruthy();

    await assertStandalone(target);
  });

  it("scaffolds every sub-project of a composite sample", async () => {
    const bytes = await buildArchive({
      "sample/31-federation/gateway/package.json": '{"name":"gateway"}',
      "sample/31-federation/posts-application/package.json": '{"name":"posts"}',
      "sample/31-federation/users-application/package.json": '{"name":"users"}',
    });

    const root = await mkdtemp(join(tmpdir(), "try-nest-e2e-"));
    const target = join(root, "federation");

    const composite: Sample = {
      id: "31-federation",
      displayName: "31-federation",
      layout: "composite",
      subProjects: ["gateway", "posts-application", "users-application"],
    };

    const plan = planScaffold(composite, target);
    expect(plan.installUnits).toHaveLength(3);

    await scaffoldSample(
      plan,
      createCodeloadArchiveSource({ fetch: async () => archiveResponse(bytes) }),
      createWorkspaceWriter(),
    );

    for (const unit of plan.installUnits) {
      await expect(
        stat(join(target, unit, "package.json")),
      ).resolves.toBeTruthy();
    }

    await assertStandalone(target);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/e2e/scaffold.spec.ts`
Expected: PASS, 2 tests. If the first fails on a missing file, the re-rooting prefix is wrong; if `assertStandalone` fails, the traversal guard let something through.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/scaffold.spec.ts
git commit -m "test: verify the scaffolded output is standalone"
```

---

## Task 16: The upstream drift sentinel

Detects the failure mode no offline test can: upstream breaking the tool with no change on our side. **Scheduled, not merely available** — a live check nobody runs detects nothing.

**Files:**
- Create: `tests/drift/upstream.spec.ts`
- Create: `.github/workflows/drift.yml`
- Modify: `package.json` (add `test:drift` script)

- [ ] **Step 1: Write the sentinel**

Create `tests/drift/upstream.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_ENDPOINT,
  RAW_CONTENT_BASE,
} from "../../src/adapters/github/constants.ts";
import { createTreeCatalogSource } from "../../src/adapters/github/tree-catalog-source.ts";
import { buildCatalog, manifestPathFor } from "../../src/domain/catalog.ts";

const live = process.env.TRY_NEST_LIVE === "1";

/**
 * These run against the real nestjs/nest. They are opt-in so the ordinary
 * suite stays offline, and scheduled in CI so drift is caught before a user
 * hits it. See docs/upstream-contract.md for what each assumption protects.
 */
describe.skipIf(!live)("upstream contract", () => {
  it("still returns a complete listing (assumption A2)", async () => {
    await expect(createTreeCatalogSource().listPaths()).resolves.toBeTruthy();
  }, 30_000);

  it("still holds a plausible number of samples (S1, S2)", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());

    expect(catalog.length).toBeGreaterThanOrEqual(30);
  }, 30_000);

  it("still contains multi-project samples (S3)", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());
    const composites = catalog.filter((s) => s.layout === "composite");

    expect(composites.length).toBeGreaterThan(0);
    expect(composites[0]?.subProjects.length).toBeGreaterThan(1);
  }, 30_000);

  it("still serves manifests from the raw content host (A3)", async () => {
    const catalog = buildCatalog(await createTreeCatalogSource().listPaths());
    const first = catalog[0];
    if (first === undefined) throw new Error("catalog was empty");

    const response = await fetch(`${RAW_CONTENT_BASE}/${manifestPathFor(first)}`);

    expect(response.ok).toBe(true);
  }, 30_000);

  it("still serves the repository archive (A4)", async () => {
    const response = await fetch(ARCHIVE_ENDPOINT, { method: "HEAD" });

    expect(response.ok).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 2: Add the script**

In `package.json` `scripts`, add:

```json
    "test:drift": "TRY_NEST_LIVE=1 vitest --config ./vitest.config.ts run tests/drift",
```

- [ ] **Step 3: Run it once to confirm it passes against real upstream**

Run: `npm run test:drift`
Expected: PASS, 5 tests.

- [ ] **Step 4: Confirm the ordinary suite still skips it**

Run: `npm test`
Expected: the drift tests report as skipped; everything else passes.

- [ ] **Step 5: Schedule it**

Create `.github/workflows/drift.yml`:

```yaml
name: 'Upstream drift'

on:
  workflow_dispatch:
  schedule:
    ## Weekly. Upstream can break this tool with no change on our side; this is
    ## the only check that notices. See docs/upstream-contract.md.
    - cron: '0 6 * * 1'

permissions:
  contents: read

jobs:
  drift:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: 'Checkout the repository'
        uses: actions/checkout@v4
      - name: 'Use node22'
        uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'
      - run: 'npm ci --ignore-scripts'
      - name: 'Check upstream assumptions'
        run: 'npm run test:drift'
```

- [ ] **Step 6: Commit**

```bash
git add tests/drift/upstream.spec.ts .github/workflows/drift.yml package.json
git commit -m "test: add a scheduled sentinel for upstream drift"
```

---

## Task 17: Housekeeping and documentation

Closes the rough edges recorded in `AGENTS.md` and records the one place the implementation diverged from the docs.

**Files:**
- Modify: `package.json` (`homepage`)
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Fix the wrong homepage**

In `package.json`, replace:

```json
  "homepage": "https://github.com/micalevisk/card",
```

with:

```json
  "homepage": "https://github.com/micalevisk/try-nest",
```

- [ ] **Step 2: Document the options README promises**

In `README.md`, replace the line `This will walk you through a set of interactive options _(detailed below)_ to help you set up your project.` with:

```markdown
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
```

- [ ] **Step 3: Record the enrichment divergence**

In `docs/architecture.md`, in the **Concurrency** section, replace the sentence
`Results merge into the presented list as they arrive.` with:

```markdown
Results merge into the presented list as they arrive, where the presentation
layer can accept them. A terminal `select` prompt cannot redraw its choices once
open, so the CLI adapter instead waits on enrichment against a short deadline
and renders whatever has arrived. The invariant is unchanged — the picker is
never blocked — but the merge is bounded rather than continuous.
```

- [ ] **Step 4: Point the docs map at the plan**

In `docs/README.md`, add a row to the Map table, after the `adr/` row:

```markdown
| [superpowers/plans/](./superpowers/plans/) | The implementation plan these documents were turned into (a working artifact, not a long-lived one) |
```

- [ ] **Step 5: Update the project status**

In `AGENTS.md`, replace the `**Status: unfinished.**` paragraph with:

```markdown
**Status: implemented.** The architecture is documented under `docs/` and the CLI
is built against it. `src/bin/try-nest.cli.ts` is a thin entry point over the
composition root in `src/adapters/cli/run.ts`.
```

Then delete the `## Known rough edges` section — all three entries are now fixed.

- [ ] **Step 6: Verify everything is green**

Run: `npm run lint && npm run format && npm test && npm run build`
Expected: all clean, all pass, `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md docs/ AGENTS.md
git commit -m "docs: document the options and fix the packaging metadata"
```
