# ADR-0006: Sample metadata from upstream only, eagerly enriched

**Status:** Accepted · 2026-09-27

## Context

Sample directory names are terse. Some are self-explanatory, many are not, and a
picker showing names alone asks the user to guess.

Issue #2 asked for optional extra metadata per sample, easy to change, and drawing
on the sample's own metadata such as its manifest description.

An obvious route is a curated overlay maintained in this repository, merged over
whatever upstream provides. It gives complete control over wording and coverage.
It also creates a second catalog to keep in step with a repository that changes
without telling us — the maintenance burden that
[ADR-0003](./0003-structure-driven-sample-discovery.md) was written to avoid,
reintroduced through a side door.

The listing mechanism returns paths, not file contents, so descriptions require a
separate retrieval per sample.

## Decision

**Descriptions come from upstream only.** A sample's own manifest description,
falling back to its directory name. No curated overlay, in this repository or
anywhere else.

**Enrich eagerly, in the background.** Once the catalog resolves, retrieve every
sample's description concurrently, with bounded concurrency, tolerating partial
failure. Descriptions merge into the presented list as they arrive.

Retrieval uses the direct file-content path rather than the main API, keeping this
traffic off the metered budget ([upstream-contract.md](../upstream-contract.md)).

**Enrichment can never block or fail anything.** The picker renders from names the
moment the catalog lands. A description that never arrives is simply absent.

## Consequences

**Good:**

- Nothing to maintain. No second catalog, no drift between our descriptions and
  upstream's samples, no release needed for wording.
- Descriptions are as accurate as upstream's own, and improve when upstream does.
- Every row is annotated, not just the selected one, so users can compare before
  choosing.
- The degradation path is honest and total: no descriptions at all is a working
  tool.

**Bad:**

- Roughly one request per sample per run — dozens where the catalog took one.
  Wasteful in absolute terms, and it will grow as upstream does.
- Upstream descriptions are sparse and inconsistent. Where they are missing, the
  picker is no better than names, and we have given ourselves no lever to fix
  that.
- Concurrency, partial failure and late-arriving results add real complexity to
  the presentation layer, which must accept updates without disturbing the user.

**Obligations this creates:** concurrency must be bounded, failures must be
swallowed individually rather than collectively, and the picker must tolerate
metadata arriving after the user is already looking at the list — and after they
have started navigating it.

## Alternatives considered

**Curated overlay fetched from this repository.** Best descriptions, editable
without a release. Rejected: a second catalog to keep in step with a repository
that changes without notice, which is the maintenance trap this project avoids
elsewhere.

**Overlay bundled in the published package.** Same benefit, no extra request.
Rejected: changing a description would require a release, failing the
easy-to-change requirement.

**Lazy enrichment — describe only the selected sample.** One extra request rather
than dozens, and no concurrency to manage. Rejected because descriptions are most
valuable *while choosing*; after selection the user has already decided.

**No descriptions at all.** One request total, simplest possible. Rejected: it
drops the requirement outright and leaves the picker cryptic.
