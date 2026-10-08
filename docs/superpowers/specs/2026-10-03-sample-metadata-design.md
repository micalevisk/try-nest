# Design: meaningful sample metadata in the picker

**Date:** 2026-10-03 · **Branch:** `feat/display-sample-description`

A working artifact. It records the decisions behind one change and can be deleted
once that change has merged. The long-lived statements it produces belong in
`docs/adr/0009-*`, `docs/upstream-contract.md` and `docs/cli-ux.md`.

## Why now

[`nestjs/nest#18009`](https://github.com/nestjs/nest/pull/18009) gives every
`sample/**/package.json` a `name` and a `description` that say what the sample
demonstrates. Today 36 of 41 manifests describe themselves as "Nest TypeScript
starter repository" and 33 are named `nest-typescript-starter`.

The pull request is **open, not merged**. Everything here must behave correctly
against today's `master` as well as after the merge. No part of this change may
assume that descriptions are meaningful, or that they exist at all.

## What already works

`try-nest` reads manifest descriptions today: `raw-metadata-source.ts` fetches
them, `describe-samples.ts` resolves them concurrently, and the picker renders
them. `withoutUninformativeDescriptions` then drops any description shared by at
least three samples and more than half the catalog, which is what currently
removes the boilerplate.

That rule is computed rather than a list of known strings, so **the picker starts
annotating itself the moment #18009 merges, with no code change.** The baseline
win needs nothing from us.

## What the merge does not give us, and what it breaks

1. **Composites get a wrong description.** `manifestPathFor` reads a composite's
   *first* sub-project manifest and presents it as the whole sample's. After the
   merge `31-graphql-federation-code-first` is labelled "Code-first Apollo
   Federation gateway for the users and posts subgraphs" — the gateway's
   description standing in for a three-project sample. Boilerplate hid this;
   meaningful text exposes it. **The merge creates this defect.**
2. **Only the highlighted row is annotated.** Inquirer renders a choice's
   `description` as a footer for the active row. ADR-0006 claims "every row is
   annotated, not just the selected one, so users can compare before choosing".
   That claim is false today.

## Scope

**In:** inline per-row descriptions in the picker; composite descriptions derived
rather than borrowed; the documentation those two require.

**Out, decided deliberately:**

- **`--list` and `--list --json` stay unenriched.** `run.ts` returns before
  enrichment, so the listing costs one request. Annotating it would cost
  forty-one, on the path scripts use most.
- **The success output stays as it is.** The user has already chosen by then.
- **`name` is ignored entirely.** After the merge it is the directory id minus its
  numeric prefix, so it carries nothing the id does not. Deriving the suggested
  target directory from it would make that suggestion depend on a network request
  that is allowed to time out — sometimes `cats-app`, sometimes `01-cats-app`,
  for reasons the user cannot see. A deterministic suggestion is worth more than
  a prettier one.
- **No colour.** The picker has never emitted any, and dimming descriptions would
  mean owning capability detection and the conventional opt-out signals.

The port `SampleMetadataSource` is unchanged. Ignoring `name` means
`readDescription(manifestPath)` still expresses everything the application needs,
so no adapter is touched.

## Design

### Domain

**`catalog.ts`: `manifestPathFor` becomes `manifestPathsFor`**

```ts
export function manifestPathsFor(sample: Sample): readonly string[]
```

A single sample yields one path. A composite yields one per sub-project, in
`subProjects` order. A composite with no sub-projects — unreachable through
`buildCatalog`, which only classifies a directory as composite when its children
carry manifests — yields an empty list rather than a malformed path.

The "first sub-project stands in for the composite" rule and its comment are
removed. Call sites: `describe-samples.ts` and `tests/drift/upstream.spec.ts`.

**`description.ts`: new `sharedDescriptionPrefix`**

```ts
export function sharedDescriptionPrefix(
  descriptions: readonly string[],
): string | undefined
```

The longest run of leading **whole words** common to every input, compared
case-sensitively, then trimmed of trailing punctuation and of a dangling
connective (`for`, `with`, `and`, `the`, `a`, `an`, `of`, `in`, `via`, `to`, `on`)
so the result never ends mid-clause.

Returns `undefined` unless there are **at least two** inputs and the result is
**at least two words**. The word floor stops `"A"` or `"The"` from becoming a
sample's description.

Word-level rather than character-level: a character-level prefix of "Code-first
Apollo Federation gateway…" and "Code-first Apollo Federation subgraph…" is
"Code-first Apollo Federation s", which is worse than nothing.

The two-input floor is the one real judgement call. It means a composite whose
third sub-project failed to answer still gets a description derived from the
other two. Requiring every sub-project would be more cautious, but it makes a
composite's label hostage to one flaky request, against the tolerate-partial-
failure stance of [ADR-0006](../../adr/0006-upstream-only-sample-metadata.md).
The trailing-connective list is typography, not content: it decides where a true
statement stops, never what it says.

**`withoutUninformativeDescriptions` is unchanged**, and its doc comment gains a
line saying why it must stay. #18009 is open, so it is still doing its job
against today's `master`; it disables itself on merge and re-arms if upstream
regresses. Without that note it will later read as dead code.

### Application

**`describe-samples.ts`: the work unit becomes a manifest path.**

Flatten every sample's paths into one task list, run the existing bounded worker
pool over it, group the results back per sample, then resolve each sample:

- `single` — the description its one manifest returned
- `composite` — `sharedDescriptionPrefix` over whichever sub-project descriptions
  arrived

Request count goes from 37 to 41 for today's upstream. The catalog holds 37
samples — 35 singles and 2 composites — against 41 manifests, because each
composite contributes three. Concurrency stays at 8.

Unchanged: the function never rejects, individual failures resolve to `undefined`,
and `withoutUninformativeDescriptions` still runs over the result.

**An optional `onPartial` publishes the catalog as answers land.** The signature
and return value are otherwise untouched; a caller that does not pass it sees no
difference. Each snapshot is produced by the same combine-then-suppress pipeline
as the returned value, never a half-built one, so a caller can render a snapshot
directly and a composite with one answer so far still has no description. This
is what lets the deadline in `run.ts` bound how long the user waits without
bounding how much of the answer survives: six waves of eight requests is a long
way to get nothing back from.

### CLI

**`prompts.ts`: each row renders `id`, padding, truncated description.**

Width comes from the output stream's `columns`, following the type and fallback
already established in `progress.ts` rather than inventing a second convention.
`prompts.spec.ts` already sets `columns` on its fake output.

- **The id column is padded to the widest id, capped at 24 columns.** The widest
  id upstream is `32-graphql-federation-schema-first` at 34 characters. Aligning
  every row to it spends roughly 33 columns of whitespace per row to accommodate
  two outliers; at 80 columns that is most of the line. Capping keeps the common
  case aligned and leaves about 52 columns for description. The two long ids run
  past the column and take a single space instead.
- **`(N projects)` stays on the name, not in the description.**
  [cli-ux.md](../../cli-ux.md) obliges composites to be visibly distinguishable,
  and that must hold when there is no description — which is the case today.
- **The description is truncated with an ellipsis**, and the full text still goes
  to inquirer's footer for the highlighted row, so truncation costs no
  information.
- **Below roughly 20 remaining columns, inline descriptions are dropped** and the
  picker renders bare names. A mangled row is worse than an unannotated one.

Nothing here blocks the picker: it still renders from whatever enrichment
delivered before the deadline in `run.ts`, and an absent description is still a
normal outcome.

## Documentation

| Document | Change |
|---|---|
| `docs/adr/0009-derived-composite-descriptions.md` | New. Why a composite's description is derived from its sub-projects rather than borrowed from one, and the three rejected alternatives |
| `docs/adr/0006-upstream-only-sample-metadata.md` | Amendment dated 2026-10-03: the "sparse and inconsistent" cost is resolved by #18009; the "every row is annotated" benefit becomes true only with the inline rows |
| `docs/upstream-contract.md` | New content assumption **C4**: a composite's sub-projects share a leading phrase. Soft — it degrades to no description. Bump "Last verified" |
| `docs/cli-ux.md` | Picker obligations gain the inline-row rule and the narrow-terminal fallback |
| `AGENTS.md` | Sample range `01…36` becomes `01…37`; #18009 adds `37-outbox` |
| `docs/README.md` | Done in this commit: the map's last row pointed at a directory deleted in 94c06df, so it has been removed rather than repaired |

## Testing

| Spec | Proves |
|---|---|
| `tests/domain/description.spec.ts` | `sharedDescriptionPrefix`: a shared trio, nothing in common, one input, zero inputs, single-word rejection, dangling connective trimmed, case mismatch |
| `tests/domain/catalog.spec.ts` | `manifestPathsFor` for both layouts, and for a composite with no sub-projects |
| `tests/application/describe-samples.spec.ts` | A composite reads *every* sub-project manifest. The existing "reads from its first sub-project" case inverts. Partial failure still yields a description; total failure yields none; the function still never rejects |
| `tests/adapters/cli/prompts.spec.ts` | Truncation at width, the narrow-terminal fallback, the id column cap, and that the footer keeps the untruncated text |

**The drift sentinel is deferred until #18009 merges.** A live check asserting
that descriptions are distinct would be born red against today's `master`, which
is exactly what `upstream-contract.md` warns against: "a scheduled check that is
born red for a reason outside this repository trains people to ignore the job,
which costs more than the signal is worth." It becomes the last task, gated on
the merge.

## How this behaves before the merge

Almost every row stays bare, and **one does not**. Taking the 37-sample catalog
as upstream has it today:

- 33 single samples and the code-first composite carry "Nest TypeScript starter
  repository". The composite reads three manifests instead of one and comes out
  with that same string, because the shared prefix of three identical
  descriptions is that description. Thirty-four repeats out of 37 trips
  `withoutUninformativeDescriptions`, so all 34 rows render bare — exactly as
  they do today. The two steps compose in that order by construction: combine
  per sample, then suppress across samples.
- One single sample and the schema-first composite have no description to show.
  The composite's three sub-projects all answer with an empty string, so nothing
  is derived for it.
- **One single sample carries "Nest Babel starter repository", and that row
  changes.** It repeats once, so the suppression rule keeps it — correctly: a
  description one sample has is a description that distinguishes it. Today that
  text reaches only inquirer's footer, and then only while the row is
  highlighted. With inline rows it is also drawn on the row itself.

So pre-merge output is not byte-identical to today's, and should not be. Making
it identical would mean suppressing descriptions that repeat once, which would
throw away the informative ones along with this one and defeat the whole change
the moment #18009 merges. The right statement is the narrower one: the
boilerplate stays invisible, and the one sample whose description is not
boilerplate becomes visible.

The only other observable cost is four extra requests.

## Success criteria

- After the merge, every single sample's row carries its own description, and
  both federation composites carry the phrase their sub-projects share rather
  than their gateway's description.
- Before the merge, every row carrying the boilerplate renders exactly as it
  does today — bare. The one sample whose description is not boilerplate gains
  that text inline, where previously it reached only the footer.
- With metadata unreachable, the picker is exactly what it is now.
- At 40 columns, no row wraps *because of a description*. An id wider than the
  terminal still overflows, exactly as it does today: identity is never
  truncated.
- `npm run typecheck`, `npm test` and `npm run build` pass.
