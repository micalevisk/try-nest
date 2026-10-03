# try-nest architecture documentation

This directory describes **what `try-nest` is, how it is put together, and why**.
It deliberately stops short of code: no file paths, no function signatures, no
library APIs. Implementations get rewritten; these documents are meant to outlive
them and to still be true after the next refactor.

If you are about to change something here and find yourself writing the name of a
package or a module, that detail probably belongs in the source, in an ADR, or
nowhere.

## What the tool does

`try-nest` hands someone a **runnable, self-contained copy of any sample from the
[`nestjs/nest`](https://github.com/nestjs/nest/tree/master/sample) repository**.
You run it, you pick a sample, you get a directory you can `cd` into and start.

Everything in this architecture exists to keep that possible while the thing it
depends on — an upstream repository layout that nobody on this project controls —
keeps moving.

## Map

| Document | Read it when you want to know |
|---|---|
| [architecture.md](./architecture.md) | How the system is layered, what the ports are, which way dependencies point |
| [domain-model.md](./domain-model.md) | What a "sample" is, how the catalog is derived, what invariants hold |
| [upstream-contract.md](./upstream-contract.md) | Exactly what we assume about `nestjs/nest`, and how those assumptions break |
| [cli-ux.md](./cli-ux.md) | The user-facing flow, the interactive and scriptable paths, how failures surface |
| [testing-strategy.md](./testing-strategy.md) | What each layer is responsible for proving |
| [adr/](./adr/) | Why each significant decision was made, and what it cost |

## Reading order

New to the project: this file, then `architecture.md`, then `domain-model.md`.
That is enough to understand any part of the codebase you land in.

About to implement a feature: add `cli-ux.md` and `testing-strategy.md`.

About to change how the tool talks to GitHub, or responding to upstream breakage:
`upstream-contract.md` first, then the relevant ADRs.

## The one-paragraph version

The core of `try-nest` is a small, pure model of *what a NestJS sample is* and
*what it means to scaffold one*, surrounded by use cases that orchestrate the
work, talking to the outside world only through interfaces the core itself
defines. The CLI — argument parsing, prompts, terminal output — is one adapter
plugged into those interfaces, not the centre of the application. GitHub is
another. Neither can reach into the core, and the core knows about neither.

## Keeping these documents honest

- A decision that shapes the code belongs in an **ADR**, not buried in prose here.
  ADRs are append-only: supersede, never silently rewrite.
- When an assumption about upstream turns out to be wrong, update
  `upstream-contract.md` **in the same change** that fixes the code. That document
  is a liability register, and a stale one is worse than none.
- If a document and the code disagree, that is a bug in one of them. Decide which,
  and fix it — do not leave the contradiction standing.
