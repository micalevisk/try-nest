# Domain model

The domain is the part of `try-nest` that would still be true if GitHub vanished
tomorrow. It holds the vocabulary, the classification rules and the invariants.
It performs no I/O.

## Vocabulary

### Sample

One scaffoldable unit from the upstream repository — the thing a user picks.

A sample has:

- **an identity**: its path beneath the samples root, e.g. `01-cats-app`. This is
  stable enough to be used as a flag value and to appear in scripts, and it is the
  only identifier the tool exposes.
- **a display name**: what the picker shows. Derived from the identity.
- **an optional description**: resolved from upstream, may be absent. Never
  required for any operation to succeed.
- **a layout**: `single` or `composite` (below).
- **sub-projects**: for a composite, the relative paths that each constitute an
  installable package. Empty for a single.

Note what a sample deliberately is **not**: it carries no URL, no revision, no
SHA, no host. Where its bytes come from is an adapter's business.

### Sample catalog

The set of samples that currently exist upstream, together with the rules for
deriving that set from a flat list of paths.

The catalog is a value, computed once per run. It is not a cache, not a registry
and not a singleton with a lifecycle.

### Scaffold plan

The decision of what will be written where, computed entirely in the core before
anything touches the disk:

- which sample,
- the target directory,
- how paths are re-rooted (below),
- which sub-paths will have dependencies installed.

Separating the plan from its execution is what makes the interesting part
testable without a filesystem, and it gives the tool one obvious place to answer
"what is about to happen?" before it happens.

### Target directory

A user-supplied destination plus the rules for whether it may be used: valid as a
directory name, and either absent or empty. Rejecting a non-empty directory is a
domain rule, not a filesystem accident — the tool never merges into existing
content.

### Package manager

Which installer to run, as a closed set of known managers. The domain knows they
exist and that a composite needs one install per sub-project; it does not know
their command-line syntax.

## Classification: how the catalog is derived

This is the load-bearing rule of the whole project, and **it lives in the domain,
not in the adapter that fetches paths.**

Given a flat list of file paths from upstream, for each directory beneath the
samples root:

| Condition | Result |
|---|---|
| The directory directly contains a manifest | a **single** sample |
| The directory contains no manifest, but its immediate children do | a **composite** sample, with those children as sub-projects |
| Anything else | ignored |

Three things follow, and they are the reason this rule sits where it does:

1. **New samples need no release.** Nothing enumerates sample names. A directory
   that appears upstream tomorrow and follows the shape is discovered tomorrow.
   ([ADR-0003](./adr/0003-structure-driven-sample-discovery.md))
2. **The composite case is a rule, not a special case.** The federation samples
   are not named anywhere. A third composite appearing upstream is handled
   automatically. ([ADR-0007](./adr/0007-composite-samples-scaffolded-whole.md))
3. **It is a pure function over strings**, so the hardest part of the system is
   also the cheapest to test — no network, no fixtures beyond a list of paths.

Deeper nesting is deliberately not supported. A directory whose grandchildren hold
manifests but whose children do not is ignored rather than guessed at. If upstream
ever adopts that shape, this is the rule to revisit, and the omission should
surface as an absent sample rather than a broken scaffold.

## Invariants

### The output must be standalone

**The defining promise of the tool.** A scaffolded directory is a project in its
own right: it can be moved, renamed, committed to a fresh repository and run,
with no memory of the monorepo it came from.

Concretely, the scaffolded tree may contain no reference that escapes its own
root — no relative import climbing out of it, no configuration extending a path
outside it, no dependency resolved from a parent directory.

This is why the plan re-roots paths: the chosen subtree's own contents become the
target directory's contents, with the intermediate path components stripped. A
user who picks `01-cats-app` gets that sample's files at the top level, not nested
under `sample/01-cats-app/`.

Stated as a domain invariant rather than an extraction detail because it must hold
regardless of how the bytes arrive. If the archive format changes, this still
holds. See [ADR-0008](./adr/0008-standalone-output-invariant.md).

### A composite is scaffolded whole

For composite samples, every sub-project is scaffolded, and each gets its own
install. Handing a user one piece of a multi-service sample would produce
something that cannot run — which would violate the promise above in spirit while
technically satisfying it.

### Descriptions are optional, everywhere

No operation may require a description. A sample with none is listed, chosen,
scaffolded and installed exactly like any other. This is what allows enrichment to
be slow, partial or entirely absent without degrading the tool.
([ADR-0006](./adr/0006-upstream-only-sample-metadata.md))

### Identity is upstream's, not ours

A sample's identity is its upstream path. We do not invent slugs, maintain a
mapping or preserve old names when upstream renames a directory. A rename upstream
is a rename here, and a script pinned to the old name breaks — which is
acceptable, by [ADR-0002](./adr/0002-no-backward-compatibility.md), and is the
direct trade for never maintaining a registry.
