# ADR-0008: Scaffolded output must be standalone

**Status:** Accepted · 2026-09-27

## Context

The samples live inside a large monorepo. Naive approaches to getting one out —
cloning the repository, copying a directory while preserving its path, extracting
an archive wholesale — all produce something that carries traces of where it came
from: nested paths, sibling directories, configuration or dependencies resolved
from a parent.

A user asked for a project. Handing them a fragment of somebody else's monorepo is
not that, and it fails in ways that only appear after they have already started
working.

## Decision

**The scaffolded directory is a project in its own right.** It can be moved,
renamed, committed to a fresh repository and run, with no memory of its origin.

Concretely: the chosen subtree's contents become the target directory's contents,
with intermediate path components stripped. Nothing outside the chosen subtree is
written. The result contains no reference that escapes its own root — no relative
import climbing out, no configuration extending outside, no dependency resolved
from a parent.

This is stated as a **domain invariant**, not an extraction detail, so it holds
regardless of how the bytes arrive. It is verified by end-to-end assertions over
the scaffolded tree ([testing-strategy.md](../testing-strategy.md)).

## Consequences

**Good:**

- The tool's central promise is explicit, named and mechanically checkable rather
  than implied.
- Changing how content is transported — a different archive format, a different
  host, a different protocol — cannot quietly break it.
- The check that enforces it is also the check that detects upstream
  self-containment drift, which is the project's most expensive failure mode
  ([upstream-contract.md](../upstream-contract.md)).

**Bad:**

- Upstream can violate it without any change on our side, and we cannot prevent
  that — only detect it.
- When upstream does violate it, there is no good automatic response. Rewriting a
  sample's contents to restore self-containment would mean shipping something that
  differs from what the user believes they got.
- It constrains transport: whatever mechanism is used must support extracting a
  subtree and re-rooting it, not merely downloading and unpacking.

**The response to a violation is to report it, not to repair it.** A scaffolded
sample that honestly fails is better than one silently rewritten into something
upstream never wrote.

## Alternatives considered

**Clone the repository and copy the sample out.** Simple and obviously correct
about content. Rejected: it downloads an entire monorepo to deliver one directory,
needs a version-control tool present, and leaves the user's disk holding far more
than they asked for.

**Extract the archive and leave the nested path in place.** Trivial to implement.
Rejected: the user gets their project buried several directories down, which is
not what they asked for and breaks every instruction the tool then prints.

**Detect escaping references and rewrite them.** Would survive upstream drift
automatically. Rejected: it makes the tool a transformer of somebody else's code,
the rewrites would be guesses, and a subtly altered sample is harder to diagnose
than one that fails outright.
