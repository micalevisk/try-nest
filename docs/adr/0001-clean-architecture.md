# ADR-0001: Clean Architecture, with the CLI as an adapter

**Status:** Accepted · 2026-09-27

## Context

`try-nest` is a small tool with an unusually unstable foundation. The upstream
repository it scaffolds from is restructured on someone else's schedule, the APIs
it reads are outside our control, and the terminal libraries it uses turn over
every few years.

The obvious shape for a tool this size is a script: parse arguments, fetch, prompt,
extract, done. That shape puts the CLI at the centre and everything else in
service of it — and it means every one of those external changes is edited in
whatever place it happens to be referenced.

Issue #2 set the direction explicitly: the CLI should be an interface to the tool,
not the tool itself.

## Decision

Adopt Clean Architecture with four layers — domain, application, ports, adapters —
and a strict inward-pointing dependency rule.

**The CLI is an adapter.** Argument parsing, prompting and terminal rendering sit
at the same distance from the core as the upstream API client does. A use case
cannot tell whether it was invoked from a terminal or a test.

A single composition root wires concrete adapters to ports. It is the only place
where the abstract and the concrete meet.

## Consequences

**Good:**

- The rules that matter — what a sample is, what scaffolding means — are testable
  with no network, no disk and no doubles.
- Upstream changes land in one adapter instead of being scattered.
- The tool could grow a programmatic API, or be driven by something other than a
  terminal, without touching a use case.
- Error handling has one obvious home: adapters translate, use cases decide,
  the presenter renders.

**Bad:**

- More indirection than a tool this size needs. A reader has to hold the
  port/adapter split in their head before any single file makes sense.
- The gap between "I want to add a flag" and "here is where that lands" is wider
  than in a script.
- The pattern invites ceremony. A port with one implementation and no plausible
  second one is overhead, not insulation.

**Mitigation for the last point:** layering is justified only where something
genuinely varies. Where it does not, call the thing directly. This ADR is not a
licence to wrap everything.

## Alternatives considered

**A single-file script.** Fastest to write and easiest to read end to end. Rejected
because the change this project will actually face, repeatedly and for years, is
upstream moving — and a script absorbs each such change in every place at once.

**Layering without the dependency rule** (folders named for layers, imports going
any direction). Rejected: it produces the indirection cost with none of the
isolation benefit, and it degrades silently because nothing makes the violation
visible.
