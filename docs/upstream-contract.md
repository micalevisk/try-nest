# Upstream contract

`try-nest` depends on a repository it does not control. This document is the
**register of everything we assume about `nestjs/nest`**, so that when the tool
breaks, the first place to look is a list rather than the source.

Treat it as a liability register. Every entry is something that can be taken away
without notice.

> **Maintenance rule:** when an assumption here turns out to be wrong, update this
> document in the same change that fixes the code. A stale register is worse than
> no register, because it will be trusted.

**Last verified against upstream: 2026-09-27.**

## What we assume

### Structural assumptions

| # | Assumption | If it breaks |
|---|---|---|
| S1 | Samples live under a single well-known directory in the repository | Nothing is discovered; the tool has no catalog |
| S2 | Each sample is a directory whose own manifest marks it as a project | Samples are silently missing from the list |
| S3 | A sample with no manifest but manifest-bearing children is a multi-project sample | Composites are missed or misclassified |
| S4 | Samples nest at most one level deep | Deeper samples are ignored (not broken — see [domain-model.md](./domain-model.md)) |
| S5 | A sample's subtree is self-contained: no configuration, dependency or import escapes it | **The core promise of the tool fails.** See below |

### Availability assumptions

| # | Assumption | If it breaks |
|---|---|---|
| A1 | The repository's full file listing is retrievable in one unauthenticated request | Listing becomes slow, paginated, or requires auth |
| A2 | That listing is complete, not truncated | Samples silently disappear from the catalog |
| A3 | Individual files are retrievable unauthenticated, without consuming the main API's rate budget | Enrichment degrades or stops; the picker still works |
| A4 | An archive of the repository at a revision is downloadable unauthenticated | **Scaffolding is impossible.** Fatal |
| A5 | The default branch is the right thing to scaffold from | Users get unreleased or stale samples |

### Content assumptions

| # | Assumption | If it breaks |
|---|---|---|
| C1 | A sample's manifest may carry a human description | Descriptions are absent; picker shows names only (degrades cleanly) |
| C2 | Directory names are meaningful enough to display as-is | The picker becomes cryptic |
| C3 | Samples install and boot with a standard package manager, unaided | The tool scaffolds something that does not run |

## Known hazards

These are not hypothetical. They are the specific ways this will go wrong.

### Truncated listings (A2) — the quiet one

The single-request full-file-listing mechanism has a size ceiling, and when it is
exceeded it says so in the response and returns **partial results rather than an
error**.

`nestjs/nest` is a large monorepo. As it grows, this will eventually trip.

The failure mode is what makes it dangerous: nothing throws, nothing logs, the
tool works — the list is just quietly incomplete, and the missing samples are
unlikely to be noticed. **The adapter must treat a truncation signal as a hard
failure rather than ignoring it**, because a loud error is enormously preferable
to a catalog that is wrong in a way nobody can see.

### Rate limiting (A1, A3)

Unauthenticated API access is metered per address, and the budget is small enough
that ordinary repeated use can exhaust it — CI, a shared network, or a developer
trying several samples in a row.

This is why catalog retrieval and file retrieval are separate ports served by
different hosts: the enrichment traffic, which is the high-volume part, is kept
off the metered path entirely. A rate-limit response must be surfaced to the user
as itself, with a wait-and-retry suggestion, never as a generic network error.

### Self-containment drift (S5) — the expensive one

Verified true on 2026-09-27: every sample pins published dependency versions
rather than linking to the monorepo's own packages, configuration extends only
within the sample, and the only references climbing out of a sample directory are
inside end-to-end specs pointing at that same sample's sources — which stay valid
after extraction.

This is a **property of upstream's current discipline, not a guarantee.** One
merged pull request that links a sample to a workspace package, or points its
configuration at a repository-root file, produces a scaffolded project that
installs and then fails — and it fails on the user's machine, not in our CI.

There is no way to prevent this. The only defence is to detect it: see
[testing-strategy.md](./testing-strategy.md) on the drift sentinel.

### Moving default branch (A5)

Scaffolding from the default branch means users get whatever is on it, including
samples mid-refactor and dependency versions not yet released. This is accepted —
it is the same trade as [ADR-0002](./adr/0002-no-backward-compatibility.md), and
it is what keeps new samples available the day they land.

If it ever becomes intolerable, the lever is pinning to the latest tag; it is an
adapter-local change, because no port mentions a revision.

## What we deliberately do not assume

- **That the sample list is stable.** No sample name appears anywhere in the tool.
- **That upstream will keep a machine-readable index.** Discovery is derived from
  structure alone, so nothing has to be maintained upstream on our behalf.
- **That descriptions exist.** Everything works without them.
- **That today's hosts, endpoints or response shapes persist.** They are named
  only inside adapters and ADRs.
- **That our own previously published versions keep working.** Per
  [ADR-0002](./adr/0002-no-backward-compatibility.md), an old release breaking
  because upstream moved is expected, not a defect.

## Re-verification

Assumptions decay. Re-check this document when the tool breaks in the field, and
whenever making a change that depends on one of these entries. The drift sentinel
described in [testing-strategy.md](./testing-strategy.md) exists to turn silent
decay into a visible signal — but it only covers what it was written to cover, and
this list is longer than it.
