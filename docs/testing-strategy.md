# Testing strategy

Each layer is responsible for proving something different. Where a behaviour gets
tested follows from where it lives, so the layering pays for itself here more than
anywhere else.

## What each layer proves

### Domain — that the rules are right

Pure unit tests over values. No network, no filesystem, no test doubles of any
kind, because there is nothing to stand in for.

This is where the bulk of the tests live, and it is where the tool's actual
intelligence sits: classifying paths into single and composite samples, rejecting
what is not a sample, computing how a subtree is re-rooted, validating a target
directory, deciding which sub-paths get installed.

The whole of sample discovery is exercisable by handing in a list of strings. Any
real upstream layout, past or hypothetical, can be replayed as a fixture in
microseconds. If a bug in classification is ever only reproducible with a network
call, something has leaked out of the domain.

### Application — that the orchestration is right

Use cases run against in-memory stand-ins for their ports. Fast, deterministic,
and able to produce failures on demand that are impractical to arrange for real.

What belongs here is everything about *sequencing and degradation*:

- Enrichment failing, partially or entirely, still yields a usable catalog.
- Enrichment is never awaited on a path the user is blocked by.
- An install failure leaves the run reported as a scaffold that succeeded.
- A failed extraction reports the directory it left behind.
- A composite sample triggers one install per sub-project.
- Rate limiting and truncation surface as themselves, not as generic errors.

That list is largely a list of things that will otherwise be discovered in the
field. They are cheap here and expensive anywhere else.

### Adapters — that translation is right

Two kinds, and the distinction matters.

**Contract tests, against recorded fixtures.** Deterministic, offline, run always.
They prove an adapter turns a real upstream response into the right domain values,
and — just as importantly — turns real upstream *failures* into the right domain
failures. Recorded responses for rate limiting and truncation belong here
permanently; they are the cases hardest to arrange and most important to get
right.

**The drift sentinel, against live upstream.** Opt-in, excluded from the normal
run, scheduled rather than gating.

This exists because of the project's defining risk: **upstream can break this tool
without any change on our side** ([upstream-contract.md](./upstream-contract.md)).
No offline test can detect that, by construction. The sentinel checks the
assumptions that decay silently — that the listing still arrives complete, that
the samples root still holds what we expect, that a known sample still classifies
as it should, that the archive is still retrievable.

It must be **scheduled, not merely available**. A live test that only runs when
someone remembers to run it detects nothing, and the whole point is catching drift
before a user does.

### End to end — that the promise holds

The smallest set of full runs that verify the thing the tool exists to do: scaffold
into a temporary directory and assert the result is standalone.

Concretely, assert against the scaffolded tree that no reference escapes its root
— no relative import climbing out, no configuration extending outside, no
dependency resolved from a parent. This is
[ADR-0008](./adr/0008-standalone-output-invariant.md) made executable, and it is
the single most valuable test in the repository: it is the one that fails when
upstream self-containment drifts.

Cover one single sample and one composite. Composites are where re-rooting and
per-sub-project installs interact, and where a mistake is least likely to be
noticed by hand.

Running an actual install and boot is slower and flakier than the rest — worth
doing, worth keeping out of the fast path, and worth scheduling alongside the
sentinel.

## Principles

**Test through ports, not around them.** A test that reaches past a port into a
concrete adapter has coupled itself to a replaceable detail and will need
rewriting for reasons that have nothing to do with behaviour.

**Never let the offline suite touch the network.** It makes tests slow, flaky, and
dependent on someone else's uptime. Live checks are a separate, deliberate,
scheduled thing.

**Fixtures are recorded, not invented.** A hand-written approximation of an
upstream response tests our imagination. Record real ones, note when they were
captured, and re-record when the sentinel says they are stale.

**Prefer a failing test over a defensive branch.** When upstream returns something
unexpected — a truncated listing above all — the right response is to stop loudly.
Code that papers over an incomplete catalog produces the worst outcome available:
a tool that works and is quietly wrong.
