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
it. [`nestjs/nest#18009`](https://github.com/nestjs/nest/pull/18009) proposes
giving every manifest a description that says what it demonstrates, and the
moment it merges the gateway's description starts standing in for a
three-project sample.

## Decision

**A composite is described by the leading phrase its sub-projects share**, not by
any one of them. The derivation takes the longest run of leading whole words
common to every description that arrived, trimmed of trailing punctuation and of
a connective that would leave the phrase ending mid-clause.

**Two descriptions are enough.** A composite whose third sub-project failed to
answer is still described, from the other two.

**Two words are the floor.** A shared prefix of "A" or "The" yields no
description at all.

**Comparison is case-sensitive.** "federation" and "Federation" are different
words; the shared phrase stops before them.

## Consequences

**Good:**

- No sub-project is ever presented as the whole sample.
- Nothing to maintain. The rule is computed, names no sample, and needs no
  release when upstream adds a composite.
- It almost always degrades to silence. A composite that shares no leading phrase
  simply has no description, which was already a normal outcome (ADR-0006). The
  one exception is recorded under C4 in
  [upstream-contract.md](../upstream-contract.md).
- It is a true statement about the sample whenever it says anything at all,
  because every description that arrived begins with it.

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
- A composite that suffered a partial failure can be described by a phrase its
  missing sub-project does not share, and nothing tells the user that happened.
- Trailing punctuation is trimmed from the shared phrase, so the derived text is
  not always what the sub-projects wrote byte-for-byte. Where it differs from the
  single-project samples' text it can slip past cross-sample suppression; see C4
  in [upstream-contract.md](../upstream-contract.md).

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
