# ADR-0002: No backward compatibility between releases

**Status:** Accepted · 2026-09-27

## Context

`try-nest` is a thin layer over a repository layout it does not control. Samples
upstream get renamed, restructured and removed with no regard for what any
published version of this tool expects.

A released version can therefore stop working through no change of ours. Treating
that as a defect would mean either pinning to an upstream revision — which
defeats the point of always offering current samples — or maintaining
compatibility shims for names upstream has already abandoned.

The tool is also invoked, essentially always, through a one-shot runner that
fetches on demand rather than from a long-lived installation.

## Decision

**No compatibility guarantee between any two releases**, including patch versions.

Users are directed to always run the latest version. Documentation and messaging
should make that the obvious path rather than an advanced tip.

A previously published version breaking because upstream moved is **expected
behaviour, not a bug**, and will not be patched.

## Consequences

**Good:**

- No compatibility shims, no alias registry, no deprecation cycles.
- Sample identity can be upstream's path directly, with no mapping to maintain
  ([ADR-0003](./0003-structure-driven-sample-discovery.md)).
- Refactoring is unusually cheap for a published package — nothing downstream is
  promised anything.
- New upstream samples are available the day they land.

**Bad:**

- A pinned version in a script is a latent failure. Someone will do it anyway.
- A user on a stale cached version may hit failures that are already fixed, and
  will not know that.
- Ordinary semantic-versioning expectations do not apply here, which is
  surprising, and surprise is a cost even when the reasoning is sound.

**Obligation:** because the guarantee is absent, failures caused by upstream drift
must be *legible*. A user hitting one needs to be told to try the latest version
rather than be left with an unexplained error. Conventional-commit discipline and
release notes still matter — they are how someone diagnoses what changed.

## Alternatives considered

**Pin to an upstream revision per release.** Fully reproducible and each published
version keeps working forever. Rejected: new samples would require a release,
directly contradicting the goal that the tool support them automatically, and
users would silently get stale samples.

**Maintain an alias map for renamed samples.** Keeps pinned invocations working.
Rejected: it is exactly the registry this project is built to avoid, it grows
without bound, and it requires noticing every upstream rename — which nobody will
reliably do.
