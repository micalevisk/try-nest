# Upstream contract

`try-nest` depends on a repository it does not control. This document is the
**register of everything we assume about `nestjs/nest`**, so that when the tool
breaks, the first place to look is a list rather than the source.

Treat it as a liability register. Every entry is something that can be taken away
without notice.

> **Maintenance rule:** when an assumption here turns out to be wrong, update this
> document in the same change that fixes the code. A stale register is worse than
> no register, because it will be trusted.

**Last verified against upstream: 2026-10-03.**

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
| C4 | A composite sample's sub-projects describe themselves with a shared leading phrase | A composite gets no description, and in one case is left as the only row still showing boilerplate (see below) |

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

### Samples that do not install (C3) — observed, not hypothetical

Verified 2026-09-27 against `master`: most samples pin `typescript@5.9.3` as a dev
dependency while their `@nestjs/schematics@12.0.5` declares `peer typescript
>=6.0.0`. A plain `npm install` in a freshly scaffolded sample therefore fails
with `ERESOLVE`, and npm suggests `--legacy-peer-deps`. Spot-checked five samples:
four conflict, `35-zod-validation` (which pins `typescript@6.0.3`) does not.

This is upstream's defect and nothing this tool can fix — rewriting a sample's
manifest during extraction would break the standalone-output invariant's whole
point, which is that the user gets upstream's project and not our edit of it.

What matters is that it degrades the way it should: the scaffold succeeds, the
install failure is reported as a warning naming the directory, the project is left
intact on disk, and the run exits 0. npm's own `--legacy-peer-deps` advice reaches
the user directly, because installs inherit stdio.

Deliberately **not** added to the drift sentinel. A scheduled check that is born
red for a reason outside this repository trains people to ignore the job, which
costs more than the signal is worth. If upstream fixes this and it later regresses,
that is the moment a check would earn its place.

### Moving default branch (A5)

Scaffolding from the default branch means users get whatever is on it, including
samples mid-refactor and dependency versions not yet released. This is accepted —
it is the same trade as [ADR-0002](./adr/0002-no-backward-compatibility.md), and
it is what keeps new samples available the day they land.

If it ever becomes intolerable, the lever is pinning to the latest tag; it is an
adapter-local change, because no port mentions a revision.

### Composite descriptions (C4) — soft, with one sharp edge

A composite has no manifest of its own, so it is described by the leading phrase
its sub-projects share ([ADR-0009](./adr/0009-derived-composite-descriptions.md)).
Nothing upstream obliges them to share one, and nothing here asks them to.

C4 holds trivially today: the three sub-projects of the code-first composite all
carry the same boilerplate, which the picker suppresses along with 33 of the 35
single-project samples. The schema-first composite's sub-projects carry empty
descriptions, so it has no description at all and nothing is derived for it. What
does not exist yet is a *meaningful* shared prefix. That is recorded from
[`nestjs/nest#18009`](https://github.com/nestjs/nest/pull/18009), which is still
open, and is not verified against a merged `master`.

Usually when this breaks the composite has no description and every other sample
is untouched. It is recorded because the failure is silent, and because someone
reading an unlabelled composite should be able to find out why in one place
rather than in the code.

There is one case where it does not degrade cleanly. The shared phrase is trimmed
of trailing punctuation, so a composite's derived description is returned
byte-for-byte only when the shared phrase ends in a letter or digit. Today's
boilerplate ("Nest TypeScript starter repository") does. If upstream's shared
string ever gained a trailing period, the code-first composite's derived
description would differ from the 33 single-project samples' and so would repeat
fewer than the three times cross-sample suppression requires. It would become the
one row still showing boilerplate while every other row was suppressed.

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
