# ADR-0009: A composite borrows its first sub-project's description

**Status:** Accepted · 2026-10-03

## Context

A composite sample — `31-graphql-federation-code-first` and its schema-first
twin — has no manifest of its own. Its sub-projects each have one.

[ADR-0006](./0006-upstream-only-sample-metadata.md) takes descriptions from
upstream manifests, so the question "which manifest describes a composite?" has
to be answered.

The answer is invisible while upstream's manifests are uniform. They describe
themselves as "Nest TypeScript starter repository" almost everywhere, so
whatever a composite shows is suppressed along with everyone else's and nobody
sees it. [`nestjs/nest#18009`](https://github.com/nestjs/nest/pull/18009)
proposes giving every manifest a description that says what it demonstrates,
and the moment it merges a composite's row starts saying something a user reads.

This record first answered the question by *deriving* a phrase: the longest run
of leading whole words every sub-project's description shared, trimmed of
trailing punctuation and of a connective that would leave the phrase ending
mid-clause. That derivation was implemented and then removed before this branch
merged — see the alternatives below.

## Decision

**A composite is described by the first of its sub-projects to carry a
description, verbatim.** One rule for both layouts: whatever upstream wrote is
what the picker shows.

**First means lookup order, not arrival order.** Sub-projects are read
concurrently; the description is picked by position in `subProjects`, so the
gateway's text wins whenever it arrived at all and the row does not depend on
which request won the race.

**Every sub-project's manifest is still read.** Not to combine them — to fall
back. A composite whose first sub-project 404s is described by the next one that
answered.

## Consequences

**Good:**

- Nothing to maintain, and nothing to explain. No word lists, no prefix rules,
  no floor on how many sub-projects answered. A description is passed through.
- What the picker shows is what upstream wrote, byte-for-byte. That is what
  keeps a composite counted with the single-project samples by cross-sample
  suppression: there is no transformation that could make its text differ.
- It degrades to silence the same way every other description does (ADR-0006):
  no manifest, no description, no row annotation.

**Bad:**

- **A composite's row describes one of its sub-projects, not the sample.** Once
  `#18009` merges, `31-graphql-federation-code-first` will be labelled with its
  gateway's description — true of one directory out of three. This is the cost
  of the decision and it is not mitigated anywhere; it is accepted because the
  row is a pick-one hint, not documentation, and because the alternative cost
  more than the inaccuracy was worth.
- The borrowed text can be misleadingly specific. "…gateway over the users and
  posts subgraphs" reads as a description of the whole sample while naming only
  a third of it.
- Which sub-project speaks is upstream's directory order, which upstream can
  change without telling us (C4 in
  [upstream-contract.md](../upstream-contract.md)).
- A composite costs one request per sub-project rather than one — today's run is
  41 requests, not 37 — and all but the first are only ever used as a fallback.

## Alternatives considered

**Derive the shared leading phrase.** What this record decided first, and what
the code did until this branch dropped it. A composite was described by the
longest run of leading words all its sub-projects shared, so no sub-project was
ever presented as the whole sample, and the statement was true of every one of
them. Rejected on cost, not on correctness: it needed a two-word floor, a
two-input floor, trailing-punctuation trimming and a list of connectives that
cannot end a phrase, plus an upstream assumption that sub-projects share a
prefix at all — roughly seventy lines of lexical heuristics in the domain to
win a shorter, blander string ("Code-first Apollo Federation") than the one it
replaced. The accuracy was real; it was not worth that much machinery in a
picker row. **If upstream's sub-project descriptions ever diverge enough that
the borrowed one is actively wrong, this is the alternative to bring back** —
it is in this branch's history at `e68e364`.

**Concatenate every sub-project's description.** Complete, loses nothing.
Rejected: three sentences cannot be a picker row, and the user is choosing, not
reading.

**Add a curated description for the two composites.** Best wording by far.
Rejected for the same reason ADR-0006 rejected a curated overlay: it is a second
catalog to keep in step with a repository that changes without telling us.

**Show no description for a composite at all.** Honest, and free. Rejected: the
composites are the two samples a user is least likely to recognise from their
directory name, so they are the rows that most need a hint.
