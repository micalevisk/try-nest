# Architecture

## The problem this shape solves

`try-nest` is a thin tool sitting on top of a large repository it does not own.
The samples in `nestjs/nest` get added, renamed, restructured and deleted on
somebody else's schedule. GitHub changes its APIs. Prompt libraries fall out of
fashion. Meanwhile the thing the tool actually *means* — "a sample is a directory
that can be lifted out and run on its own" — barely changes at all.

So the architecture separates those two speeds. The slow-changing meaning lives in
the middle, insulated. The fast-changing mechanics live at the edges, replaceable.

## Layers

Four layers. **Source dependencies point inward only.**

```
           ┌─────────────────────────────────────────────┐
           │  Adapters                                   │
           │  ┌───────────────────────────────────────┐  │
           │  │  Application (use cases + ports)      │  │
           │  │  ┌─────────────────────────────────┐  │  │
           │  │  │  Domain                         │  │  │
           │  │  │  Sample · Catalog · ScaffoldPlan│  │  │
           │  │  └─────────────────────────────────┘  │  │
           │  └───────────────────────────────────────┘  │
           └─────────────────────────────────────────────┘
                          ▲
                   Composition root
              (the only thing that sees it all)
```

### Domain

The vocabulary and the rules. A sample, a catalog of samples, a plan to scaffold
one, a target directory, a package manager. Pure: no I/O, no clock, no network, no
dependencies on anything else in the project or outside it.

This is small on purpose, and it is where the load-bearing logic lives — most
notably the rules that decide what counts as a sample at all. See
[domain-model.md](./domain-model.md).

### Application

The use cases: list the available samples, describe them, scaffold the chosen one,
install its dependencies, report what to do next. Each one orchestrates a single
user-meaningful outcome and owns its own error paths.

The application layer depends on the domain and on the **ports it declares**. It
never depends on an adapter, and it contains no knowledge of HTTP, the
filesystem, archives, terminals or subprocesses.

### Ports

Interfaces **owned by the application and written in our vocabulary, not the
vendor's**. A port says what the application needs; it never leaks how it is
satisfied.

| Port | The question it answers |
|---|---|
| Sample catalog source | What samples exist right now? |
| Sample metadata source | Describe these samples. |
| Sample archive source | Give me the bytes of this sample's subtree. |
| Workspace writer | Materialise this plan on disk. |
| Package manager runner | Install dependencies here, using this manager. |
| Interaction | Ask the user to choose among these options. |
| Presenter | Report results and failures. |

The first three are deliberately **separate ports rather than one "GitHub" port**.
They answer different questions, they change on different schedules, and today
they are already served by three different hosts. Collapsing them would couple
unrelated concerns and make each harder to replace. See
[ADR-0004](./adr/0004-anti-corruption-layer-for-upstream.md).

### Adapters

Everything that touches the world: the upstream APIs, the filesystem, the archive
format, the terminal, child processes. Adapters implement ports and depend inward.
Nothing depends on an adapter.

**The CLI is an adapter.** This is the point of issue #2's first design goal.
Parsing arguments, running prompts and rendering output are delivery concerns,
sitting at the same distance from the core as the GitHub client does. A use case
cannot tell whether it was invoked from a terminal, a test, or a future
programmatic API — and nothing in the core would have to change to add one.

### Composition root

One place — the executable's entry point — knows every concrete adapter, builds
them, wires them to ports and hands control to a use case. It is the only place
where the abstract and the concrete meet.

Keeping this single and explicit is what makes the dependency rule checkable
rather than aspirational: if a concrete adapter is being constructed anywhere
else, the rule has been broken.

## The dependency rule, stated plainly

> Nothing in an inner layer may know the name of anything in an outer layer.

Consequences worth internalising:

- The domain can be exercised with no network, no disk and no mocks at all.
- A use case is tested by handing it in-memory stand-ins for its ports.
- Swapping the prompt library, the HTTP client, the archive format or the entire
  CLI framework is an adapter-local change. If such a swap forces a change to a
  use case, a port was designed in the vendor's vocabulary rather than ours.
- Data crossing inward is translated at the boundary. Vendor-shaped values —
  response envelopes, status codes, tree entries, SHAs — stop at the adapter.

## Errors

Failure is a first-class part of the contract, not an afterthought.

Adapters translate transport-level failures into outcomes the core can reason
about: *the catalog is unavailable*, *we are being rate limited*, *no such
sample*, *metadata could not be resolved*, *the target directory is not usable*.
The core never sees a status code and never inspects an exception message to
decide what happened.

Use cases then decide what is fatal and what is survivable. The important
asymmetry: **a failure to describe samples must never prevent the user from
choosing one.** Enrichment is an enhancement, and it degrades to silence.

The presenter is the only thing that decides how a failure looks. Use cases
report *what* went wrong; they do not format, colour or exit.

## Concurrency

Two pieces of work run off the critical path:

1. **The catalog fetch starts at process boot**, in parallel with anything that
   does not depend on it. The user is never waiting on a request that could have
   been started earlier.
2. **Description enrichment runs in the background** against the resolved catalog,
   with bounded concurrency, tolerating partial failure. Results merge into the
   presented list as they arrive, where the presentation layer can accept them. A
   terminal `select` prompt cannot redraw its choices once open, so the CLI
   adapter instead waits on enrichment against a short deadline and renders
   whatever has arrived. The invariant is unchanged — the picker is never blocked
   — but the merge is bounded rather than continuous.

Both are the application's concern to schedule and the adapters' concern to
execute. The domain remains synchronous and pure.

The rule that makes this safe: **enrichment is never awaited on a path the user is
blocked by.** A sample whose description never arrives is presented without one.

## What this shape explicitly buys us

- **New upstream samples work with no release.** Discovery is a rule over
  structure, not a list. ([ADR-0003](./adr/0003-structure-driven-sample-discovery.md))
- **Upstream API changes are contained.** They land in one adapter, behind one
  port, with contract tests that fail loudly. ([ADR-0004](./adr/0004-anti-corruption-layer-for-upstream.md))
- **The interesting logic is trivially testable.** Classification and planning are
  pure functions over values. ([testing-strategy.md](./testing-strategy.md))
- **The CLI can be rewritten without touching the tool.** ([ADR-0001](./adr/0001-clean-architecture.md))

## What it costs

Indirection. There are more moving parts than a single-file script needs, and a
reader has to hold the port/adapter split in their head before anything makes
sense. For a tool this size that is a real, non-trivial tax.

It is accepted because the failure mode it prevents is the one this project will
actually hit: upstream shifting under us, repeatedly, for years. A script would
absorb each of those changes everywhere at once.

What the cost does **not** license is ceremony for its own sake. A port with one
implementation and no plausible second one is not insulation, it is overhead —
delete it and call the thing directly. The layering earns its keep only where
something genuinely varies.
