# ADR-0007: Multi-project samples are scaffolded whole

**Status:** Accepted · 2026-09-27

## Context

Most samples are a single project. Some are not: a sample directory may hold
sibling sub-projects, each an independent package, that together form one running
system. The federation samples are the current instance — a gateway plus the
services it federates.

A gateway scaffolded alone does not run. Neither does a single service. They are
one sample that happens to be several packages.

This needed a deliberate answer for how such a sample is listed, scaffolded and
installed.

## Decision

A multi-project sample is **one entry and one unit**. Choosing it scaffolds the
entire parent directory, with every sub-project, and installs dependencies once
per sub-project.

It is **detected structurally, never by name**: a sample directory with no
manifest of its own whose immediate children have one
([domain-model.md](../domain-model.md)). No sample name appears anywhere in the
tool.

Sub-projects are not individually selectable.

## Consequences

**Good:**

- What the user receives always runs. This is the promise in
  [ADR-0008](./0008-standalone-output-invariant.md) applied to the multi-project
  case — a gateway without its services would satisfy the letter of standalone
  output while failing its intent.
- A new multi-project sample upstream needs nothing from us.
- The picker stays a flat list of complete, runnable things.
- No conditional branch in the flow and no extra flag surface.

**Bad:**

- A user who wants only the gateway must scaffold everything and delete the rest.
- Installing several sub-projects is slower, and a failure in one needs reporting
  in a way that makes clear which part failed and that the code is nonetheless
  present.
- If upstream ever groups genuinely independent projects under one directory, this
  would hand users more than they asked for. Nothing currently suggests that, but
  the rule cannot tell the difference.

## Alternatives considered

**Flatten sub-projects into separate picker entries.** Uniform — every entry is
exactly one package — and lets a user take only what they want. Rejected: it makes
it easy, and default, to scaffold something that cannot boot, which is the failure
the tool exists to prevent.

**Prompt for the whole sample or one sub-project.** Most flexible. Rejected as
disproportionate: a conditional branch in the flow plus a corresponding flag, to
serve two samples, with the default answer being "all of it" nearly every time.
Worth reconsidering if multi-project samples become common rather than
exceptional.
