# ADR-0004: Anti-corruption layer over upstream APIs

**Status:** Accepted · 2026-09-27

## Context

The tool reads from third-party HTTP APIs whose shapes are neither stable nor
ours. Those shapes are rich and specific — tree entries, blob references, content
encodings, rate-limit headers, pagination and truncation signals — and none of
those concepts mean anything in the domain of "scaffolding a NestJS sample".

If those shapes reach the core, the core is coupled to a vendor's data model, and
every change to that model becomes a change to the tool's logic.

Issue #2 called for third-party APIs to be defined so that the core does not rely
on their interfaces.

## Decision

Apply the anti-corruption layer pattern. Each upstream concern gets a **port
written in our vocabulary**, an **adapter** that speaks the vendor's, and
translation strictly at the boundary.

Three separate ports, not one:

| Port | Question |
|---|---|
| Sample catalog source | What samples exist? |
| Sample metadata source | Describe these samples. |
| Sample archive source | Give me this sample's bytes. |

Nothing vendor-shaped crosses inward: no response envelopes, no revision
identifiers, no status codes, no header semantics.

**Failures are translated too.** Adapters convert transport failures into
domain-meaningful outcomes — unavailable, rate limited, not found, incomplete. The
core never inspects a status code or parses an error message to decide what
happened.

## Consequences

**Good:**

- Upstream API changes are contained in one adapter, behind one port, with
  contract tests that fail loudly.
- The three concerns can be replaced independently — they already run against
  three different hosts, and the high-volume one is deliberately kept off the
  metered path ([upstream-contract.md](../upstream-contract.md)).
- Use cases are testable with in-memory stand-ins that are trivial to write,
  because the ports are small and expressed in our terms.
- Vendor-specific hazards get a designated owner. Truncation, in particular, is an
  adapter's responsibility to detect and convert into a hard failure.

**Bad:**

- Translation code is genuinely tedious, and its value is invisible right up until
  the moment upstream changes.
- Three ports where one would do is more surface. Justified by their independent
  change rates, but it is more.
- Vendor capabilities that do not fit the port are inaccessible without widening
  it — which is the point, and is occasionally inconvenient.

## Alternatives considered

**One "GitHub" port.** Fewer interfaces, simpler wiring. Rejected: it couples three
concerns with different change rates and different hosts, so replacing any one of
them would disturb the others.

**Use a vendor SDK's types as the internal model.** Zero translation code, and
those types are well maintained. Rejected: it is precisely the coupling this
decision prevents. The core would be shaped by an API client's release schedule,
and swapping the client would become a core refactor.

**Translate lazily, only where it hurts.** Pragmatic-sounding. Rejected: boundaries
that are enforced sometimes are not boundaries. The leak arrives through whichever
path was left unguarded, and nothing makes it visible.
