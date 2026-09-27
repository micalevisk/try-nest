# ADR-0003: Discover samples from structure, never a list

**Status:** Accepted · 2026-09-27

## Context

Upstream adds, renames and removes samples continuously. Any enumeration of them
inside this tool — a constant, a bundled manifest, a generated file — is wrong the
moment upstream changes, and correcting it requires a release.

Issue #2 states the requirement directly: the tool should support new samples
automatically, with no change and no release, as long as they follow the expected
structure.

## Decision

Derive the catalog by applying a rule to the upstream file listing. Nothing
enumerates samples.

The rule, over each directory beneath the samples root:

- contains a manifest → a **single** sample
- no manifest, but immediate children have one → a **composite** sample
- otherwise → ignored

**The rule lives in the domain, not in the adapter that fetches paths.** It is a
pure function from a list of paths to a catalog.

Nesting deeper than one level is not supported. Such a directory is ignored rather
than guessed at.

## Consequences

**Good:**

- New samples work with no release. The requirement is satisfied structurally
  rather than by process.
- The hardest logic in the project is also the cheapest to test — real upstream
  layouts replay as lists of strings.
- Composites are handled by rule, so a third one appearing upstream needs nothing
  ([ADR-0007](./0007-composite-samples-scaffolded-whole.md)).
- Nothing has to be maintained upstream on our behalf.

**Bad:**

- A sample that does not follow the shape is invisible, with no diagnostic. The
  tool cannot distinguish "not a sample" from "a sample we failed to recognise".
- Ordering and presentation must be derived from names, since there is no
  curation layer to carry them.
- An upstream restructure breaks discovery wholesale rather than partially.

**Mitigation for the first point:** the drift sentinel
([testing-strategy.md](../testing-strategy.md)) exists partly to catch this —
a sudden drop in discovered samples is a signal, even though an individual
unrecognised directory is not.

## Alternatives considered

**A bundled sample list, refreshed at release time.** Instant, offline, fully
curated. Rejected outright: it makes every upstream addition a release, which is
the exact requirement this decision exists to satisfy.

**A remote index maintained in this repository.** Updatable without a release, and
allows curation. Rejected: it still requires a human to notice every upstream
change, so it fails the same way as a bundled list, only later and less visibly.

**Ask upstream for a machine-readable index.** Cleanest if it existed. Rejected as
a dependency on someone else's roadmap for a tool they do not maintain.
