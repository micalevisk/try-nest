# ADR-0005: Prefetch the catalog; no on-disk cache

**Status:** Accepted · 2026-09-27

## Context

Two goals in issue #2 pull against each other. The catalog must be fully dynamic,
fetched at runtime so new samples appear without a release
([ADR-0003](./0003-structure-driven-sample-discovery.md)). It must also be
presented as quickly as possible.

The reflex answer is a local cache with a freshness window. But a cache is not a
small feature: it brings a location convention, a staleness policy, invalidation,
corruption handling, concurrent-run safety, and a new class of bug in which the
tool is confidently wrong because it is serving something old.

It is also a poor fit for how this tool is invoked. Runs are one-shot and
occasional. Most users run it once, get a sample, and never run it again — paying
the complexity on every run to benefit a repeat that usually does not happen.

## Decision

**No persistent cache.** Nothing is written outside the target directory.

Instead, **start catalog retrieval at process boot**, in parallel with startup
output and any step that does not depend on it. The request overlaps with the time
the user spends reading the first screen rather than following it.

## Consequences

**Good:**

- No cache location, no freshness policy, no invalidation, no corruption path, no
  concurrent-run interference.
- The catalog is always current. It cannot be subtly stale, which matters
  disproportionately given that staleness here means *missing samples*.
- The tool writes nothing to the user's machine outside the directory they named —
  easy to explain and easy to trust.
- One less thing to reason about when diagnosing "why is this sample missing".

**Bad:**

- Every run pays one network round trip before the picker can render. The
  prefetch hides much of it, not all.
- The tool is unusable offline. There is no degraded mode.
- Repeated runs — trying several samples in a row — repeat the same request,
  which also consumes the metered budget faster
  ([upstream-contract.md](../upstream-contract.md)).

**If this is revisited**, the trigger to watch for is repeated-run friction or
rate-limit complaints in practice, not a suspicion that it would feel faster. Note
that a cache is an adapter-local addition: no port mentions caching, so the
decision can be reversed without disturbing the core.

## Alternatives considered

**On-disk cache with background revalidation.** Instant on repeat runs and still
dynamic. Rejected for now as complexity disproportionate to a one-shot tool, and
because stale-catalog bugs are precisely the invisible kind this project is most
exposed to.

**A catalog snapshot bundled at publish time.** Instant even on a cold start.
Rejected: it ages between releases, adds a build step, and reintroduces the
enumeration that [ADR-0003](./0003-structure-driven-sample-discovery.md) exists to
eliminate — even as a fallback, it would sometimes be the thing the user sees.
