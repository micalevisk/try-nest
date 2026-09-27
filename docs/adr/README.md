# Architecture decision records

One record per decision that shapes the code. Each states the context at the time,
what was decided, and what it cost.

**These are append-only.** A decision that no longer holds is *superseded* by a new
record — the old one stays, with its status updated and a pointer forward. Never
rewrite a record to match current reality; the reasoning that led somewhere wrong
is exactly what a future maintainer needs to avoid repeating it.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-clean-architecture.md) | Clean Architecture, with the CLI as an adapter | Accepted |
| [0002](./0002-no-backward-compatibility.md) | No backward compatibility between releases | Accepted |
| [0003](./0003-structure-driven-sample-discovery.md) | Discover samples from structure, never a list | Accepted |
| [0004](./0004-anti-corruption-layer-for-upstream.md) | Anti-corruption layer over upstream APIs | Accepted |
| [0005](./0005-prefetch-without-cache.md) | Prefetch the catalog; no on-disk cache | Accepted |
| [0006](./0006-upstream-only-sample-metadata.md) | Sample metadata from upstream only, eagerly enriched | Accepted |
| [0007](./0007-composite-samples-scaffolded-whole.md) | Multi-project samples are scaffolded whole | Accepted |
| [0008](./0008-standalone-output-invariant.md) | Scaffolded output must be standalone | Accepted |

## Writing a new one

Keep it short. Context, decision, consequences — including the ones you do not
like. A record that lists no costs is marketing, and will not be trusted by the
person who finds it two years from now.

Record the alternatives that were genuinely considered and why they lost. That is
usually the most useful part, because the alternative is what someone will propose
again.
