# Meaningful sample metadata in the picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sample picker annotate every row with its own description, and
give a composite sample a description derived from the phrase its sub-projects
share rather than borrowed from the first one.

**Architecture:** Three layers move. The domain gains `sharedDescriptionPrefix`
(combine several descriptions into one) and turns `manifestPathFor` into
`manifestPathsFor` (a composite has one manifest per sub-project). The
application's `describeSamples` changes its work unit from "a sample" to "a
manifest path", then regroups per sample. The CLI renders each picker row as
`id`, padding, truncated description, while inquirer's footer keeps the full
text. No port changes — `readDescription(manifestPath)` still says everything
the application needs.

**Tech Stack:** Node >=22, TypeScript 7 (ESM, `verbatimModuleSyntax`,
`erasableSyntaxOnly`, `allowImportingTsExtensions` — so import with explicit
`.ts` extensions, use `import type`, and emit no runtime TS syntax: no enums, no
parameter properties), Vitest (`globals: false` — import `describe`/`it`/`expect`
from `vitest`), Biome (2-space indent, double quotes), `@inquirer/prompts`.

**Spec:** [`docs/superpowers/specs/2026-10-03-sample-metadata-design.md`](../specs/2026-10-03-sample-metadata-design.md)

## Global Constraints

- **`nestjs/nest#18009` is open, not merged.** Every change must behave correctly
  against today's `master` as well as after the merge. No code may assume
  descriptions are meaningful, or that they exist at all.
- **`withoutUninformativeDescriptions` stays exactly as it is.** It is what keeps
  pre-merge output identical to today's. Only its doc comment changes.
- **The port `SampleMetadataSource` is unchanged.** No adapter under
  `src/adapters/github/` is touched by this plan.
- **`name` from the manifest is ignored entirely.** Nothing reads it; the
  suggested target directory stays derived from the sample id.
- **No colour.** The picker has never emitted any and must not start.
- **Enrichment can never block or fail anything** (ADR-0006). `describeSamples`
  never rejects; an absent description is a normal outcome.
- **Identity is never truncated.** A description may be clipped; a sample id may
  not.
- Commit messages are conventional commits and end with the trailer
  `Co-authored-by: Claude Code (claude-opus-5) <noreply@anthropic.com>`.
- Verification commands, all of which must pass before a task is complete:
  `npm test`, `npm run typecheck`, `npm run build`. Run `npm run format` and
  `npm run lint` before committing.

## Review Focus

Input classes the spec implies that each get a test in the task that owns them:

1. **A composite's boilerplate must survive combining byte-for-byte.** Before the
   merge, three identical `"Nest TypeScript starter repository"` strings must
   combine back to that exact string — otherwise the composite's description no
   longer matches the singles', `withoutUninformativeDescriptions` does not count
   them together, and the composite is the one row showing boilerplate. Pinned in
   Task 1 and again end-to-end in Task 3.
2. **A description containing a newline or runs of whitespace.** Manifest
   descriptions are free text. One newline in a picker row corrupts inquirer's
   redraw for the rest of the prompt. Pinned in Task 4.
3. **A composite where exactly one sub-project answered.** The two-input floor
   means it gets no description — deliberately, since one sub-project standing in
   for the whole sample is the defect this change exists to remove. Pinned in
   Task 3.
4. **A terminal narrower than the id column.** `columns: 10` must still produce
   rows that do not wrap: bare names, no description, no negative slice. Pinned
   in Task 4.
5. **An empty catalog reaching the renderer.** `sampleChoices([], 80)` computes a
   widest-id of zero; it must return `[]` rather than throw. Pinned in Task 4.

---

### Task 1: `sharedDescriptionPrefix`

Adds the pure function that combines several descriptions into the one phrase
they share. Nothing calls it yet — Task 3 does.

**Files:**
- Modify: `src/domain/description.ts`
- Test: `tests/domain/description.spec.ts`

**Interfaces:**
- Consumes: `Sample` from `src/domain/sample.ts` (already imported there).
- Produces: `sharedDescriptionPrefix(descriptions: readonly string[]): string | undefined`,
  exported from `src/domain/description.ts`. Task 3 imports it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/domain/description.spec.ts`. Keep the existing
`withoutUninformativeDescriptions` block above it untouched, and add
`sharedDescriptionPrefix` to the existing import on line 2 so it reads:

```ts
import {
  sharedDescriptionPrefix,
  withoutUninformativeDescriptions,
} from "../../src/domain/description.ts";
```

Then append:

```ts
describe("sharedDescriptionPrefix", () => {
  it("returns the leading words every description shares", () => {
    expect(
      sharedDescriptionPrefix([
        "Code-first Apollo Federation gateway over users and posts",
        "Code-first Apollo Federation subgraph exposing users",
        "Code-first Apollo Federation subgraph exposing posts",
      ]),
    ).toBe("Code-first Apollo Federation");
  });

  it("returns undefined when the descriptions share no leading word", () => {
    expect(sharedDescriptionPrefix(["Caching", "Logging"])).toBeUndefined();
  });

  it("returns undefined for a single description", () => {
    expect(sharedDescriptionPrefix(["Caching with Redis"])).toBeUndefined();
  });

  it("returns undefined for no descriptions", () => {
    expect(sharedDescriptionPrefix([])).toBeUndefined();
  });

  it("rejects a one-word prefix, which describes nothing", () => {
    expect(
      sharedDescriptionPrefix(["Caching with Redis", "Caching layer"]),
    ).toBeUndefined();
  });

  it("drops a dangling connective so the phrase does not end mid-clause", () => {
    expect(
      sharedDescriptionPrefix([
        "GraphQL federation gateway for users",
        "GraphQL federation gateway for posts",
      ]),
    ).toBe("GraphQL federation gateway");
  });

  it("drops trailing punctuation left behind by the split", () => {
    expect(
      sharedDescriptionPrefix([
        "Testing utilities, with mocks",
        "Testing utilities, with spies",
      ]),
    ).toBe("Testing utilities");
  });

  it("compares case-sensitively, so a case mismatch is not a shared word", () => {
    expect(
      sharedDescriptionPrefix([
        "Apollo federation gateway",
        "Apollo Federation gateway",
      ]),
    ).toBeUndefined();
  });

  // Review Focus 1. Before #18009 merges every sub-project carries the same
  // boilerplate, and the combined result has to come back byte-for-byte equal
  // to it — otherwise withoutUninformativeDescriptions counts the composite
  // separately from the singles and the composite becomes the one row still
  // showing "Nest TypeScript starter repository".
  it("returns identical descriptions unchanged, so suppression still matches them", () => {
    const boilerplate = "Nest TypeScript starter repository";

    expect(
      sharedDescriptionPrefix([boilerplate, boilerplate, boilerplate]),
    ).toBe(boilerplate);
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(
      sharedDescriptionPrefix([
        "  Redis backed  cache adapter ",
        "Redis backed\ncache invalidation",
      ]),
    ).toBe("Redis backed cache");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest --config ./vitest.config.ts run tests/domain/description.spec.ts`
Expected: FAIL — the module has no export named `sharedDescriptionPrefix`.

- [ ] **Step 3: Implement it**

Append to `src/domain/description.ts`:

```ts
/**
 * Words that may legitimately end a sentence nowhere, so a prefix ending on one
 * reads as a cut-off clause rather than a statement. Typography, not content:
 * this list decides where a true phrase stops, never what it says.
 */
const DANGLING_CONNECTIVES = new Set([
  "for",
  "with",
  "and",
  "the",
  "a",
  "an",
  "of",
  "in",
  "via",
  "to",
  "on",
]);

/** Below this, the "prefix" is an article or a bare noun and describes nothing. */
const MINIMUM_PREFIX_WORDS = 2;
/** One description is not evidence of a shared phrase — it is just that description. */
const MINIMUM_DESCRIPTIONS = 2;

/**
 * The longest run of leading whole words every description shares.
 *
 * A composite sample has no manifest of its own, so this is how several
 * sub-project descriptions become one (ADR-0009). Whole words rather than
 * characters: the character-level prefix of "…Federation gateway" and
 * "…Federation subgraph" is "…Federation s", which is worse than nothing.
 *
 * Returns `undefined` unless at least two descriptions were supplied and at
 * least two words survive.
 */
export function sharedDescriptionPrefix(
  descriptions: readonly string[],
): string | undefined {
  if (descriptions.length < MINIMUM_DESCRIPTIONS) return undefined;

  const wordLists = descriptions.map((description) =>
    description.split(/\s+/).filter((word) => word.length > 0),
  );

  const [first, ...rest] = wordLists;
  if (first === undefined) return undefined;

  const shared: string[] = [];
  for (const [index, word] of first.entries()) {
    if (rest.some((words) => words[index] !== word)) break;
    shared.push(word);
  }

  // Walk back off anything that cannot end a phrase. A word that is pure
  // punctuation disappears entirely and the one before it is judged in turn.
  while (shared.length > 0) {
    const last = shared.at(-1) as string;
    const trimmed = last.replace(/[^\p{L}\p{N}]+$/u, "");

    if (trimmed.length === 0 || DANGLING_CONNECTIVES.has(trimmed.toLowerCase())) {
      shared.pop();
      continue;
    }

    shared[shared.length - 1] = trimmed;
    break;
  }

  if (shared.length < MINIMUM_PREFIX_WORDS) return undefined;

  return shared.join(" ");
}
```

- [ ] **Step 4: Explain why `withoutUninformativeDescriptions` must stay**

`nestjs/nest#18009` is open, so the suppression rule is still doing its job.
Without a note it will read as dead code the moment the merge lands. Replace the
doc comment above `withoutUninformativeDescriptions` (currently lines 7–14) with:

```ts
/**
 * A description shared by most samples distinguishes none of them, so it is
 * dropped rather than rendered on every row.
 *
 * Deliberately a computed rule and not a list of known boilerplate strings: it
 * needs no maintenance, and it stops suppressing on its own once upstream
 * descriptions become distinct.
 *
 * **Do not delete this once upstream descriptions become meaningful.** It is
 * the only thing keeping today's output clean while `nestjs/nest#18009` is
 * unmerged, it disables itself the moment that lands, and it re-arms by itself
 * if upstream ever regresses.
 */
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest --config ./vitest.config.ts run tests/domain/description.spec.ts`
Expected: PASS — 13 tests in the file (3 existing, 10 new) all green.

- [ ] **Step 6: Verify the whole suite, types and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all three exit 0.

- [ ] **Step 7: Format, lint and commit**

```bash
npm run format && npm run lint
git add src/domain/description.ts tests/domain/description.spec.ts
git commit -m "$(cat <<'EOF'
feat(domain): combine descriptions into their shared leading phrase

sharedDescriptionPrefix takes the longest run of leading whole words
every description shares, trimmed of trailing punctuation and of a
connective that would leave the phrase ending mid-clause. It needs two
descriptions and two surviving words, so an article can never become a
sample's description.

Nothing calls it yet. It is what lets a composite sample describe itself
from its sub-projects instead of borrowing the first one's description.

Co-authored-by: Claude Code (claude-opus-5) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `manifestPathsFor`

A composite has one manifest per sub-project, not one manifest. This task adds
the plural function beside the singular one; Task 3 migrates the callers and
deletes the singular.

**Files:**
- Modify: `src/domain/catalog.ts`
- Test: `tests/domain/catalog.spec.ts`

**Interfaces:**
- Consumes: `Sample`, `SAMPLES_ROOT`, `MANIFEST_FILENAME` — all already in
  `src/domain/catalog.ts`.
- Produces: `manifestPathsFor(sample: Sample): readonly string[]`, exported from
  `src/domain/catalog.ts`. A single yields one path; a composite yields one per
  sub-project in `subProjects` order; a composite with no sub-projects yields
  `[]`. Task 3 imports it and deletes `manifestPathFor`.

- [ ] **Step 1: Write the failing tests**

Add `manifestPathsFor` to the import on line 2 of `tests/domain/catalog.spec.ts`:

```ts
import { buildCatalog, manifestPathsFor } from "../../src/domain/catalog.ts";
```

Append to the same file, after the closing `});` of the `buildCatalog` block:

```ts
describe("manifestPathsFor", () => {
  it("gives a single sample the one manifest it owns", () => {
    expect(
      manifestPathsFor({
        id: "01-cats-app",
        displayName: "01-cats-app",
        layout: "single",
        subProjects: [],
      }),
    ).toEqual(["sample/01-cats-app/package.json"]);
  });

  it("gives a composite one manifest per sub-project, in order", () => {
    expect(
      manifestPathsFor({
        id: "31-graphql-federation-code-first",
        displayName: "31-graphql-federation-code-first",
        layout: "composite",
        subProjects: ["gateway", "posts-application", "users-application"],
      }),
    ).toEqual([
      "sample/31-graphql-federation-code-first/gateway/package.json",
      "sample/31-graphql-federation-code-first/posts-application/package.json",
      "sample/31-graphql-federation-code-first/users-application/package.json",
    ]);
  });

  // Unreachable through buildCatalog, which only calls a directory composite
  // when its children carry manifests. Asserted so the shape stays an empty
  // list rather than a malformed "sample/x//package.json".
  it("gives a composite with no sub-projects nothing to read", () => {
    expect(
      manifestPathsFor({
        id: "weird",
        displayName: "weird",
        layout: "composite",
        subProjects: [],
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest --config ./vitest.config.ts run tests/domain/catalog.spec.ts`
Expected: FAIL — the module has no export named `manifestPathsFor`.

- [ ] **Step 3: Implement it**

In `src/domain/catalog.ts`, leave `manifestPathFor` in place (Task 3 removes it)
and add after it:

```ts
/**
 * Every manifest that describes this sample.
 *
 * A single sample owns one. A composite owns none of its own, so it answers
 * with its sub-projects' — all of them, because no one of them speaks for the
 * whole sample (ADR-0009).
 */
export function manifestPathsFor(sample: Sample): readonly string[] {
  if (sample.layout !== "composite") {
    return [`${SAMPLES_ROOT}/${sample.id}/${MANIFEST_FILENAME}`];
  }

  return sample.subProjects.map(
    (subProject) =>
      `${SAMPLES_ROOT}/${sample.id}/${subProject}/${MANIFEST_FILENAME}`,
  );
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest --config ./vitest.config.ts run tests/domain/catalog.spec.ts`
Expected: PASS — 9 tests (6 existing, 3 new).

- [ ] **Step 5: Verify the whole suite, types and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all three exit 0.

- [ ] **Step 6: Format, lint and commit**

```bash
npm run format && npm run lint
git add src/domain/catalog.ts tests/domain/catalog.spec.ts
git commit -m "$(cat <<'EOF'
feat(domain): give a composite sample every manifest it owns

manifestPathsFor answers with one path per sub-project rather than the
first one only. manifestPathFor stays for now; its last callers move in
the next commit.

Co-authored-by: Claude Code (claude-opus-5) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `describeSamples` resolves per manifest

The work unit becomes a manifest path. Flatten every sample's paths into one
list, run the existing bounded pool over it, group the answers back per sample,
then resolve: a single takes its one description, a composite takes the phrase
its sub-projects share. Removes `manifestPathFor` and its last two callers.

Request count goes from 37 to 41 against today's upstream — 35 singles plus 2
composites contributing three manifests each. Concurrency stays at 8.

**Files:**
- Modify: `src/application/describe-samples.ts`
- Modify: `src/domain/catalog.ts` (delete `manifestPathFor`)
- Modify: `tests/drift/upstream.spec.ts:16,50` (last other caller)
- Test: `tests/application/describe-samples.spec.ts`

**Interfaces:**
- Consumes: `manifestPathsFor(sample: Sample): readonly string[]` from Task 2;
  `sharedDescriptionPrefix(descriptions: readonly string[]): string | undefined`
  from Task 1; `withoutUninformativeDescriptions` (unchanged);
  `SampleMetadataSource.readDescription(manifestPath: string, signal?: AbortSignal): Promise<string | undefined>`.
- Produces: `describeSamples` keeps its exact signature —
  `(samples: readonly Sample[], source: SampleMetadataSource, options?: DescribeSamplesOptions) => Promise<readonly Sample[]>`.
  `run.ts` is unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/application/describe-samples.spec.ts`, **replace** the last test —
`"reads a composite's description from its first sub-project"`, lines 75–97 — with
the block below. Leave the four tests above it untouched.

```ts
const composite: Sample = {
  id: "31-federation",
  displayName: "31-federation",
  layout: "composite",
  subProjects: ["gateway", "posts-application", "users-application"],
};

describe("describeSamples, for a composite sample", () => {
  it("reads every sub-project's manifest, not just the first", async () => {
    const seen: string[] = [];
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        seen.push(path);
        return undefined;
      },
    };

    await describeSamples([composite], source);

    expect(seen.sort()).toEqual([
      "sample/31-federation/gateway/package.json",
      "sample/31-federation/posts-application/package.json",
      "sample/31-federation/users-application/package.json",
    ]);
  });

  it("describes itself with the phrase its sub-projects share", async () => {
    const descriptions: Record<string, string> = {
      gateway: "Code-first Apollo Federation gateway over users and posts",
      "posts-application": "Code-first Apollo Federation subgraph for posts",
      "users-application": "Code-first Apollo Federation subgraph for users",
    };
    const source: SampleMetadataSource = {
      readDescription: async (path) => descriptions[path.split("/")[2] ?? ""],
    };

    const [result] = await describeSamples([composite], source);

    expect(result?.description).toBe("Code-first Apollo Federation");
  });

  it("still derives a description when one sub-project fails", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) => {
        if (path.includes("users-application")) throw new Error("404");
        return path.includes("gateway")
          ? "Schema-first Apollo Federation gateway"
          : "Schema-first Apollo Federation subgraph";
      },
    };

    const [result] = await describeSamples([composite], source);

    expect(result?.description).toBe("Schema-first Apollo Federation");
  });

  // Review Focus 3. One sub-project speaking for the whole sample is exactly
  // the defect this change removes, so one answer is not enough.
  it("has no description when only one sub-project answers", async () => {
    const source: SampleMetadataSource = {
      readDescription: async (path) =>
        path.includes("gateway") ? "Apollo Federation gateway" : undefined,
    };

    const [result] = await describeSamples([composite], source);

    expect(result?.description).toBeUndefined();
  });

  it("has no description when every sub-project fails", async () => {
    const source: SampleMetadataSource = {
      readDescription: async () => {
        throw new Error("network down");
      },
    };

    const result = await describeSamples([composite], source);

    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBeUndefined();
  });

  it("has no description when it has no sub-projects to read", async () => {
    const source: SampleMetadataSource = {
      readDescription: async () => "never asked for",
    };

    const [result] = await describeSamples(
      [{ ...composite, subProjects: [] }],
      source,
    );

    expect(result?.description).toBeUndefined();
  });
});

// Review Focus 1, end to end. While nestjs/nest#18009 is unmerged every
// manifest carries the same boilerplate; the composite must come out of
// combining with that same string, so suppression counts it with the singles
// and the picker looks exactly as it does today.
describe("describeSamples, before upstream descriptions become meaningful", () => {
  it("suppresses the boilerplate on the composite as well as the singles", async () => {
    const boilerplate = "Nest TypeScript starter repository";
    const source: SampleMetadataSource = {
      readDescription: async () => boilerplate,
    };

    const result = await describeSamples([...samples, composite], source);

    expect(result.map((s) => s.description)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest --config ./vitest.config.ts run tests/application/describe-samples.spec.ts`
Expected: FAIL. "reads every sub-project's manifest" fails with `seen` holding
only `sample/31-federation/gateway/package.json`; the derivation and partial-
failure cases fail with `description` `undefined` or the gateway's own text.

- [ ] **Step 3: Rewrite `describeSamples`**

Replace the whole of `src/application/describe-samples.ts` with:

```ts
import { manifestPathsFor } from "../domain/catalog.ts";
import {
  sharedDescriptionPrefix,
  withoutUninformativeDescriptions,
} from "../domain/description.ts";
import type { Sample } from "../domain/sample.ts";
import type { SampleMetadataSource } from "./ports.ts";

const DEFAULT_CONCURRENCY = 8;

export interface DescribeSamplesOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/** One retrieval, and the sample it answers for. */
interface Lookup {
  readonly sampleIndex: number;
  readonly manifestPath: string;
}

/**
 * Resolves every sample's description concurrently, tolerating partial failure.
 *
 * The unit of work is a manifest, not a sample: a composite owns one per
 * sub-project and is described by the phrase they share, because no single
 * sub-project speaks for the whole sample (ADR-0009).
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

  const lookups: Lookup[] = [];
  for (const [sampleIndex, sample] of samples.entries()) {
    for (const manifestPath of manifestPathsFor(sample)) {
      lookups.push({ sampleIndex, manifestPath });
    }
  }

  const answers = new Array<string | undefined>(lookups.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= lookups.length) return;

      const lookup = lookups[index];
      if (lookup === undefined) return;

      try {
        answers[index] = await source.readDescription(
          lookup.manifestPath,
          options.signal,
        );
      } catch {
        // Individual failures are expected and uninteresting.
        answers[index] = undefined;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, lookups.length) }, worker),
  );

  // Only what actually arrived: a sub-project that failed or answered with
  // nothing simply is not here, which is what lets a composite still describe
  // itself from the rest.
  const arrived: string[][] = samples.map(() => []);
  for (const [index, lookup] of lookups.entries()) {
    const answer = answers[index];
    if (answer === undefined || answer.length === 0) continue;
    arrived[lookup.sampleIndex]?.push(answer);
  }

  const enriched = samples.map((sample, index) => {
    const found = arrived[index] ?? [];
    const description =
      sample.layout === "composite"
        ? sharedDescriptionPrefix(found)
        : found[0];

    if (description === undefined || description.length === 0) return sample;
    return { ...sample, description };
  });

  return withoutUninformativeDescriptions(enriched);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest --config ./vitest.config.ts run tests/application/describe-samples.spec.ts`
Expected: PASS — 11 tests (4 existing, 7 new).

- [ ] **Step 5: Delete `manifestPathFor` and move its last caller**

In `src/domain/catalog.ts`, delete the whole `manifestPathFor` function and the
doc comment above it (currently lines 65–76) — the one reading "A composite has
no manifest of its own, so its first sub-project stands in for it." That rule is
gone.

In `tests/drift/upstream.spec.ts`, change the import on line 16:

```ts
import { buildCatalog, manifestPathsFor } from "../../src/domain/catalog.ts";
```

and replace the `fetch` in the "still serves manifests from the raw content host
(A3)" test (currently lines 49–51) with:

```ts
    const [manifestPath] = manifestPathsFor(first);
    if (manifestPath === undefined) throw new Error("sample had no manifest");

    const response = await fetch(`${RAW_CONTENT_BASE}/${manifestPath}`);
```

- [ ] **Step 6: Verify nothing else referenced the removed function**

Run: `grep -rn "manifestPathFor" src tests`
Expected: no output. (Scoped to code on purpose — `docs/superpowers/` still names
the old function while describing this very change, and must keep doing so.)

- [ ] **Step 7: Verify the whole suite, types and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all three exit 0. (`npm test` is offline, so the drift spec is skipped;
`npm run typecheck` is what proves the edited drift spec compiles.)

- [ ] **Step 8: Format, lint and commit**

```bash
npm run format && npm run lint
git add src/application/describe-samples.ts src/domain/catalog.ts \
  tests/application/describe-samples.spec.ts tests/drift/upstream.spec.ts
git commit -m "$(cat <<'EOF'
fix(application): derive a composite's description from all its sub-projects

The unit of work in describeSamples becomes a manifest rather than a
sample, so a composite reads every sub-project and is described by the
phrase they share. It used to present its first sub-project's
description as the whole sample's, which upstream boilerplate hid and
meaningful descriptions would expose.

Costs four extra requests against today's upstream, 37 to 41.
manifestPathFor is gone with its last caller.

Co-authored-by: Claude Code (claude-opus-5) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Inline descriptions on every picker row

Inquirer renders a choice's `description` as a footer for the *highlighted* row
only, so today only one row is annotated. Each row becomes `id`, padding,
truncated description; the untruncated text stays on `description` so the footer
loses nothing.

**Files:**
- Modify: `src/adapters/cli/progress.ts` (export `FALLBACK_COLUMNS`)
- Modify: `src/adapters/cli/prompts.ts`
- Test: `tests/adapters/cli/prompts.spec.ts`

**Interfaces:**
- Consumes: `Sample` (with its optional `description`), `ProgressStream` and
  `FALLBACK_COLUMNS` from `./progress.ts`.
- Produces: `sampleChoices(samples: readonly Sample[], columns?: number): readonly SampleChoice[]`
  and `interface SampleChoice { readonly name: string; readonly value: Sample; readonly description?: string }`,
  both exported from `src/adapters/cli/prompts.ts`. `createPrompts` and the
  `Interaction` port are otherwise unchanged, so `run.ts` is not touched.

- [ ] **Step 1: Write the failing tests**

In `tests/adapters/cli/prompts.spec.ts`, extend the import on line 3:

```ts
import {
  createPrompts,
  sampleChoices,
} from "../../../src/adapters/cli/prompts.ts";
```

Append to the end of the file:

```ts
function single(id: string, description?: string): Sample {
  return {
    id,
    displayName: id,
    layout: "single",
    subProjects: [],
    ...(description === undefined ? {} : { description }),
  };
}

describe("sampleChoices", () => {
  it("puts the description inline, aligned past the widest id", () => {
    const [first, second] = sampleChoices(
      [single("01-cats-app", "A REST API over cats"), single("02-gateways")],
      80,
    );

    // Both ids are 11 wide, so the column is 11 and the gap is the two spaces.
    expect(first?.name).toBe("01-cats-app  A REST API over cats");
    expect(second?.name).toBe("02-gateways");
  });

  it("caps the id column at 24 so two long ids cannot eat the line", () => {
    const [, long] = sampleChoices(
      [
        single("01-cats-app", "Cats"),
        single("32-graphql-federation-schema-first", "Federation, schema first"),
      ],
      80,
    );

    // 34 characters wide: past the column, so a single space, not alignment.
    expect(long?.name).toBe(
      "32-graphql-federation-schema-first Federation, schema first",
    );
  });

  it("keeps a composite's project count on the name", () => {
    const [choice] = sampleChoices(
      [
        {
          id: "31-federation",
          displayName: "31-federation",
          layout: "composite",
          subProjects: ["gateway", "posts-application"],
          description: "Apollo Federation",
        },
      ],
      80,
    );

    expect(choice?.name).toContain("31-federation  (2 projects)");
    expect(choice?.name).toContain("Apollo Federation");
  });

  it("truncates an over-long description with an ellipsis", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "x".repeat(200))],
      60,
    );

    expect(choice?.name.length).toBeLessThanOrEqual(59);
    expect(choice?.name.endsWith("…")).toBe(true);
  });

  it("keeps the untruncated description for inquirer's footer", () => {
    const full = "x".repeat(200);
    const [choice] = sampleChoices([single("01-cats-app", full)], 60);

    expect(choice?.description).toBe(full);
  });

  it("drops inline descriptions rather than mangle a narrow terminal", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "A REST API over cats")],
      30,
    );

    expect(choice?.name).toBe("01-cats-app");
    expect(choice?.description).toBe("A REST API over cats");
  });

  // The spec's success criterion, with the id widths upstream actually has:
  // at 40 columns the id column is capped at 24, leaving too little for a
  // description, so no row wraps *because of* one.
  it("fits every row inside 40 columns with upstream's widest ids", () => {
    const choices = sampleChoices(
      [
        single("01-cats-app", "A REST API over cats"),
        single("32-graphql-federation-schema-first", "Federation, schema first"),
      ],
      40,
    );

    expect(choices.map((choice) => choice.name)).toEqual([
      "01-cats-app",
      "32-graphql-federation-schema-first",
    ]);
  });

  // Review Focus 4.
  it("renders a terminal narrower than the id without wrapping or throwing", () => {
    const [choice] = sampleChoices(
      [single("32-graphql-federation-schema-first", "Federation")],
      10,
    );

    expect(choice?.name).toBe("32-graphql-federation-schema-first");
  });

  it("falls back to 80 columns when the stream reports none", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "A REST API over cats")],
      undefined,
    );

    expect(choice?.name).toBe("01-cats-app  A REST API over cats");
  });

  // Review Focus 2. One newline in a row corrupts inquirer's redraw for the
  // rest of the prompt, and manifest descriptions are free text.
  it("collapses whitespace so a multi-line description cannot break the redraw", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "  A REST API\nover\t cats  ")],
      80,
    );

    expect(choice?.name).toBe("01-cats-app  A REST API over cats");
    expect(choice?.description).toBe("A REST API over cats");
  });

  // Review Focus 5.
  it("renders an empty catalog as no choices", () => {
    expect(sampleChoices([], 80)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/prompts.spec.ts`
Expected: FAIL — the module has no export named `sampleChoices`.

- [ ] **Step 3: Export the width fallback from `progress.ts`**

In `src/adapters/cli/progress.ts` line 22, add `export` so the picker follows the
same convention rather than inventing a second one:

```ts
/** What to assume when a stream does not know how wide it is. */
export const FALLBACK_COLUMNS = 80;
```

- [ ] **Step 4: Implement `sampleChoices`**

In `src/adapters/cli/prompts.ts`, add to the imports (after the `@inquirer/prompts`
import, Biome's organize-imports will settle the final order):

```ts
import { FALLBACK_COLUMNS, type ProgressStream } from "./progress.ts";
```

Widen `PromptStreams.output` and the local stream so the picker can read the
width — `ProgressStream` is `NodeJS.WritableStream` plus an optional `columns`,
which is exactly what is needed here too:

```ts
export interface PromptStreams {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: ProgressStream;
}
```

and inside `createPrompts`:

```ts
  const outputStream: ProgressStream = streams.output ?? process.stdout;
```

Add above `createPrompts`:

```ts
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
 * One line, whatever the source did with whitespace. A newline in a choice
 * corrupts inquirer's redraw for the rest of the prompt.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
```

Then make `chooseSample` use it — replace the `choices:` expression (currently
lines 97–106) so the body reads:

```ts
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
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/prompts.spec.ts`
Expected: PASS — the existing Esc/Ctrl+C/arrow-key tests still green, plus 11 new
`sampleChoices` tests.

- [ ] **Step 6: Verify the whole suite, types and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all three exit 0.

- [ ] **Step 7: Format, lint and commit**

```bash
npm run format && npm run lint
git add src/adapters/cli/prompts.ts src/adapters/cli/progress.ts \
  tests/adapters/cli/prompts.spec.ts
git commit -m "$(cat <<'EOF'
feat(cli): annotate every picker row, not just the highlighted one

Inquirer renders a choice's description as a footer for the active row,
so ADR-0006's promise that users can compare before choosing was not
true. Each row now carries its own description inline: id, padding
aligned to the widest id up to 24 columns, then the description clipped
to what is left. The untruncated text still goes to the footer, so
clipping costs no information.

Below roughly 20 remaining columns the inline copy is dropped and the
picker renders bare names — a mangled row is worse than an unannotated
one. An id wider than the terminal still overflows: identity is never
truncated.

Co-authored-by: Claude Code (claude-opus-5) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Documentation

The code is done; these are the long-lived statements it produces. No test
changes — the verification here is that the links resolve and the facts match
the code just written.

**Files:**
- Create: `docs/adr/0009-derived-composite-descriptions.md`
- Modify: `docs/adr/README.md` (index row)
- Modify: `docs/adr/0006-upstream-only-sample-metadata.md` (amendment)
- Modify: `docs/upstream-contract.md` (assumption C4)
- Modify: `docs/cli-ux.md` (picker obligations)
- Modify: `AGENTS.md:66` (sample range)

**Interfaces:**
- Consumes: the names and behaviours from Tasks 1–4 — `sharedDescriptionPrefix`,
  `manifestPathsFor`, the two-input floor, the 24-column cap, the 20-column
  fallback.
- Produces: nothing code depends on. ADR-0009 is referenced by doc comments
  already written in Tasks 1–3.

- [ ] **Step 1: Write ADR-0009**

Create `docs/adr/0009-derived-composite-descriptions.md`:

```markdown
# ADR-0009: A composite's description is derived, never borrowed

**Status:** Accepted · 2026-10-03

## Context

A composite sample — `31-graphql-federation-code-first` and its schema-first
twin — has no manifest of its own. Its sub-projects each have one.

[ADR-0006](./0006-upstream-only-sample-metadata.md) takes descriptions from
upstream manifests, so the question "which manifest describes a composite?" had
to be answered. It was answered by reading the first sub-project's and
presenting it as the whole sample's.

That answer was invisible while it was wrong. Upstream's manifests described
themselves as "Nest TypeScript starter repository" almost uniformly, so the
borrowed description was suppressed along with everyone else's and nobody saw
it. [`nestjs/nest#18009`](https://github.com/nestjs/nest/pull/18009) gives every
manifest a description that says what it demonstrates, and the moment it merges
the gateway's description starts standing in for a three-project sample.

## Decision

**A composite is described by the leading phrase its sub-projects share**, not by
any one of them. `sharedDescriptionPrefix` takes the longest run of leading whole
words common to every description that arrived, trimmed of trailing punctuation
and of a connective that would leave the phrase ending mid-clause.

**Two descriptions are enough.** A composite whose third sub-project failed to
answer is still described, from the other two.

**Two words are the floor.** A shared prefix of `"A"` or `"The"` yields no
description at all.

**Comparison is case-sensitive.** `"federation"` and `"Federation"` are different
words; the shared phrase stops before them.

## Consequences

**Good:**

- No sub-project is ever presented as the whole sample.
- Nothing to maintain. The rule is computed, names no sample, and needs no
  release when upstream adds a composite.
- It degrades to silence. A composite that shares no leading phrase simply has
  no description, which was already a normal outcome (ADR-0006).
- It is a true statement about the sample whenever it says anything at all,
  because every sub-project's description begins with it.

**Bad:**

- The description is shorter and blander than any one sub-project's. "Code-first
  Apollo Federation" says less than "Code-first Apollo Federation gateway over
  the users and posts subgraphs" — but the longer one is false about two thirds
  of the sample.
- It depends on upstream writing sub-project descriptions that share a prefix
  (assumption C4 in [upstream-contract.md](../upstream-contract.md)). Nothing
  obliges them to.
- A composite costs one request per sub-project rather than one, taking today's
  run from 37 requests to 41.

**Obligations this creates:** the two-input floor means partial failure must stay
survivable rather than becoming all-or-nothing, and the combine step must run
before cross-sample suppression — combine per sample, then suppress across
samples — or an all-boilerplate catalog would leave the composite as the one row
still showing boilerplate.

## Alternatives considered

**Borrow the first sub-project's description.** What the code did. Rejected: it
is a false statement about the sample as soon as upstream descriptions become
meaningful, and false is worse than absent.

**Concatenate every sub-project's description.** Complete, loses nothing.
Rejected: three sentences cannot be a picker row, and the user is choosing, not
reading.

**Require every sub-project to answer before describing a composite.** More
cautious than the two-input floor. Rejected: it makes a composite's label hostage
to one flaky request, against the tolerate-partial-failure stance of ADR-0006 —
and the failure is silent, so a composite would be unlabelled for reasons nobody
can see.

**Add a curated description for the two composites.** Best wording by far.
Rejected for the same reason ADR-0006 rejected a curated overlay: it is a second
catalog to keep in step with a repository that changes without telling us.
```

- [ ] **Step 2: Add ADR-0009 to the index**

In `docs/adr/README.md`, add a row to the table after the 0008 row:

```markdown
| [0009](./0009-derived-composite-descriptions.md) | A composite's description is derived, never borrowed | Accepted |
```

- [ ] **Step 3: Amend ADR-0006**

ADRs are append-only — do not rewrite the existing text. Append to the end of
`docs/adr/0006-upstream-only-sample-metadata.md`:

```markdown

## Amendment · 2026-10-03

Two statements above have been overtaken by events, and are corrected here rather
than edited in place.

**"Upstream descriptions are sparse and inconsistent"** (under *Bad*) was true
when written: 36 of 41 manifests described themselves as "Nest TypeScript starter
repository". [`nestjs/nest#18009`](https://github.com/nestjs/nest/pull/18009)
gives every sample a description of what it demonstrates. The cost stands until
that merges, and the computed suppression rule in `description.ts` is what keeps
the picker clean in the meantime — it disables itself once descriptions become
distinct, and re-arms if upstream regresses.

**"Every row is annotated, not just the selected one"** (under *Good*) was false
when written. Inquirer renders a choice's description as a footer for the
highlighted row, so one row was annotated. It became true on 2026-10-03, when the
picker started rendering each description inline on its own row as well.

A composite's description is no longer borrowed from its first sub-project; see
[ADR-0009](./0009-derived-composite-descriptions.md).
```

- [ ] **Step 4: Register assumption C4**

In `docs/upstream-contract.md`, add a row to the **Content assumptions** table
(currently lines 41–44), after C3:

```markdown
| C4 | A composite sample's sub-projects describe themselves with a shared leading phrase | A composite gets no description; its singles are unaffected (degrades cleanly) |
```

Then append to the end of the same file, before `## Re-verification`:

```markdown
### Composite descriptions (C4) — soft by construction

A composite has no manifest of its own, so it is described by the leading phrase
its sub-projects share ([ADR-0009](./adr/0009-derived-composite-descriptions.md)).
Nothing upstream obliges them to share one, and nothing here asks them to.

This is the gentlest entry in this register: when it breaks, the composite has no
description and every other sample is untouched. It is recorded because the
failure is silent, and because someone reading an unlabelled composite should be
able to find out why in one place rather than in `description.ts`.
```

- [ ] **Step 5: Decide the "Last verified" date honestly**

The register's maintenance rule makes a stale date dangerous and a false one
worse. Run the live sentinel and let the result decide:

Run: `npm run test:drift`
Expected: PASS (network, up to a few minutes). The suite covers A2, A3, A4, S1,
S2, S3 and S5 against real upstream.

- **If it passes:** change line 14 of `docs/upstream-contract.md` to
  `**Last verified against upstream: 2026-10-03.**`
- **If it fails or cannot reach the network:** leave the date at 2026-09-27 and
  append one line under the C4 section saying C4 is recorded from
  `nestjs/nest#18009` as proposed and is not yet verified against a merged
  `master`. Record which happened in the ledger as a `Ruling:`.

Either way, C4 describes a pull request that is still open, so note that in the
C4 section if it is not already clear.

- [ ] **Step 6: Give the picker its new obligations**

In `docs/cli-ux.md`, add to the **Obligations of the picker** list (currently
lines 44–51), after the composite bullet:

```markdown
- Each row must carry its own description, not only the highlighted one. A user
  comparing samples should not have to move the cursor to read them
  ([ADR-0006](./adr/0006-upstream-only-sample-metadata.md)).
- A description may be clipped to fit the terminal; a sample's identity may not.
  The full text must stay reachable for whichever row the user is on.
- When the terminal is too narrow for a description to be worth anything, the
  picker drops descriptions and renders names alone. A mangled row is worse than
  an unannotated one.
```

- [ ] **Step 7: Correct the sample range in `AGENTS.md`**

`nestjs/nest#18009` adds `37-outbox`. On line 66, replace
`` `01-cats-app` … `36-valibot-serializer` `` with
`` `01-cats-app` … `37-outbox` ``, so the sentence reads:

```markdown
`nestjs/nest/sample` holds numbered directories, currently `01-cats-app` … `37-outbox`.
```

- [ ] **Step 8: Verify every link this task wrote resolves**

Run:
```bash
cd "$(git rev-parse --show-toplevel)"
for file in docs/adr/0009-derived-composite-descriptions.md docs/adr/README.md \
  docs/adr/0006-upstream-only-sample-metadata.md docs/upstream-contract.md \
  docs/cli-ux.md; do
  dir=$(dirname "$file")
  grep -oE '\]\(\.{1,2}/[^)#]+' "$file" | sed 's/^](//' | sort -u |
    while read -r link; do
      [ -e "$dir/$link" ] || echo "BROKEN in $file: $link"
    done
done
```
Expected: no `BROKEN` lines.

- [ ] **Step 9: Verify the suite, types and build one last time**

Run: `npm test && npm run typecheck && npm run build`
Expected: all three exit 0. Documentation cannot break these, so a failure here
means something from Tasks 1–4 regressed.

- [ ] **Step 10: Format, lint and commit**

```bash
npm run format && npm run lint
git add docs/adr/0009-derived-composite-descriptions.md docs/adr/README.md \
  docs/adr/0006-upstream-only-sample-metadata.md docs/upstream-contract.md \
  docs/cli-ux.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs: record derived composite descriptions and inline picker rows

ADR-0009 explains why a composite is described by the phrase its
sub-projects share rather than by the first one's description, with the
three alternatives that lost. ADR-0006 is amended rather than rewritten:
its "sparse and inconsistent" cost is resolved by nestjs/nest#18009, and
its "every row is annotated" benefit was false until today.

The upstream register gains C4 — a composite's sub-projects share a
leading phrase — which is soft: it degrades to no description. cli-ux
gains the inline-row rule and the narrow-terminal fallback, and the
sample range in AGENTS.md catches up with 37-outbox.

Co-authored-by: Claude Code (claude-opus-5) <noreply@anthropic.com>
EOF
)"
```

---

## Deliberately not in this plan

**The drift sentinel for distinct descriptions.** The spec gates it on
`nestjs/nest#18009` merging, and the pull request is still open. A live check
asserting that descriptions are distinct would be born red against today's
`master` — exactly what `upstream-contract.md` warns against: "a scheduled check
that is born red for a reason outside this repository trains people to ignore the
job, which costs more than the signal is worth." It is a separate change, after
the merge.

**`--list` and `--list --json` stay unenriched.** `run.ts` returns before
enrichment, so the listing costs one request. Annotating it would cost 41, on the
path scripts use most.

**The manifest `name` field.** After the merge it is the directory id minus its
numeric prefix, carrying nothing the id does not. Deriving the suggested target
directory from it would make a deterministic suggestion depend on a network
request that is allowed to time out.

**The success output, and colour.** Out of scope per the spec.
