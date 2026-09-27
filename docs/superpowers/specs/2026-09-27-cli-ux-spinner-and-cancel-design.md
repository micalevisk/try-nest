# CLI UX: progress spinners and Esc-to-cancel

**Status:** design approved, ready for planning
**Date:** 2026-09-27
**Touches:** `src/adapters/cli/`, `src/domain/errors.ts`, `src/application/ports.ts`, `docs/`

## Intent

Two improvements to how the CLI behaves while a person is sitting in front of it:

1. **Async steps that can take time animate instead of printing a dead line.** Today
   `Fetching the available NestJS samples…` is written once and then the terminal sits
   still for as long as the request takes, with nothing distinguishing "working" from
   "hung".
2. **Any prompt can be abandoned with Esc.** Today the only way out of a prompt is
   Ctrl+C, which is mishandled (see [Ctrl+C today](#ctrlc-today)).

Success means: a person who starts the tool and changes their mind can leave from any
question with one keystroke and a clear message, and a person waiting on the network can
see that something is still happening. Neither change may leak decoration into a pipe, and
neither may alter what the scriptable path does.

This is a UX change to the CLI adapter. No use case, and nothing in `src/domain/` beyond a
single new failure kind, changes behaviour.

## Decisions

### D1 — Progress is an adapter-local scope, not a port

`Progress.while(label, work)` owns the spinner's whole lifecycle, so it cannot leak:

```ts
export interface Progress {
  /** Runs `work` under a spinner labelled `label`. Stops it on success and on throw. */
  while<T>(label: string, work: () => Promise<T>): Promise<T>;
}
```

It lives in `src/adapters/cli/progress.ts` and is **not** added to
`src/application/ports.ts`. No use case reports progress — only the composition root in
`run.ts` does — so a port would place a terminal concern in the application layer for no
consumer. It is injected through `RunDependencies` so tests can substitute a fake, exactly
as `stdout` already is.

*Rejected:* making `Presenter` methods return a stoppable handle. Four call sites would
each need their own `try`/`finally`, and any path that forgot would leak a live spinner
into the next render — including the `--list` path, which returns through `stdout.write`
with no further `Presenter` call at all.

*Rejected:* letting the next `Presenter` call implicitly stop the previous spinner. The
lifecycle becomes invisible, and the `--list` path would exit with the interval still
running.

### D2 — `Presenter` narrows; `progress.while` subsumes its two transient methods

`starting()` and `scaffolding(plan)` are removed from the `Presenter` port. Their text
becomes the `label` argument at the call site. `installing`, `succeeded`, `warn` and
`failed` are unchanged.

`installing` deliberately keeps no spinner: package managers draw their own output, and
two things animating over one another is worse than neither.

### D3 — Esc is one internal helper, and the `Interaction` port does not change

A module-local `escapable` in `src/adapters/cli/prompts.ts` is used by all four prompt
methods:

```ts
async function escapable<T>(ask: (ctx: Context) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  readline.emitKeypressEvents(input);
  const onKeypress = (_: string, key?: { name?: string }) => {
    if (key?.name === "escape") controller.abort();
  };
  input.on("keypress", onKeypress);
  try {
    return await ask({ signal: controller.signal, input, output });
  } catch (error) {
    throw asCancellation(error);
  } finally {
    input.off("keypress", onKeypress);
  }
}
```

`input` and `output` are closed over from `createPrompts`. Every `@inquirer` prompt accepts
a `Context` carrying `signal?: AbortSignal`, and aborting it rejects with
`AbortPromptError`. No forked or custom prompt is needed.

`asCancellation` lives in `prompts.ts`, beside `escapable` — **not** in
`src/domain/errors.ts`. It is the only code that names `AbortPromptError` and
`ExitPromptError`, which keeps those vendor types inside the adapter that owns inquirer, as
[ADR-0004](../../adr/0004-anti-corruption-layer-for-upstream.md) requires: the domain learns only that
the kind is `cancelled`.

The keypress must come from our own listener: `@inquirer/core` exports no `isEscapeKey`,
and no bundled prompt binds Esc. A `keypress` listener coexists with inquirer's readline —
verified by probe: a bare `\u001b` fires it while `\u001b[B` (arrow-down, which begins with
Esc) does not, and normal answers are unaffected.

Two things the helper must not do. It never touches raw mode — inquirer owns that, and
fighting it breaks terminal teardown. And it removes its listener in `finally`, so four
sequential prompts leave no accumulation.

`createPrompts(streams?)` gains injectable `input`/`output`, defaulting to `process.stdin`
and `process.stdout`, so the behaviour is testable offline.

*Rejected:* threading an `AbortSignal` through the `Interaction` port. It widens all four
port signatures for a concern that exists only in a terminal.

*Rejected:* wrapping each of the four methods separately. The same listener dance written
four times, tested four times.

### D4 — Every prompt moves before the first write

`docs/cli-ux.md` prescribes: pick sample → name directory → **choose install and manager**
→ scaffold → install. The implementation diverges: `confirmInstall` and
`choosePackageManager` run *after* `scaffoldSample`.

The order is corrected to match the spec. This is a precondition for D5, not a separate
improvement: with all four prompts ahead of the first write, `Nothing was written.` is
unconditionally true and cancellation needs no stage-awareness. Telling someone their
project is gone when it is intact is the failure `cli-ux.md` already names — *"Install
failure is not scaffold failure… would send them to delete work that is fine."*

Resulting order in `run.ts`:

```
parse → help/version → non-interactive guard
progress.while("Fetching the available NestJS samples…", () => catalogPromise)
--list ⇒ return 0
progress.while("Looking up sample descriptions…", () => withDeadline(…))
chooseSample
chooseTargetDirectory → assertTargetDirectoryUsable
confirmInstall → runner.detect() → choosePackageManager
progress.while("Scaffolding <id> into <dir>…", () => scaffoldSample(…))
installing() lines + installDependencies
succeeded
```

Three consequences: an unusable target directory now fails *before* the install questions
rather than after, which is fail-fast and strictly better; `usedManager` is known before the
scaffold, so nothing about `succeeded` changes; and `detect()` still runs only when an
install is actually wanted.

### D5 — One new failure kind, exit code 130

`src/domain/errors.ts` gains `cancelled` to its `FailureKind` union. Both cancel keys
converge on it:

```ts
function asCancellation(error: unknown): unknown {
  return error instanceof AbortPromptError || error instanceof ExitPromptError
    ? new TryNestError("cancelled", "Cancelled. Nothing was written.")
    : error;
}
```

`exitCodeFor` gains `case "cancelled": return 130;` — the conventional code for a run ended
by an interactive interrupt, matching SIGINT.

`renderFailure`'s `default:` already returns the bare message and `presenter.failed()`
already writes a leading blank line, so what the presenter contributes is exactly:

```

Cancelled. Nothing was written.
```

No new `Presenter` method. Cancellation reuses `failed()`: the error stream is the right
channel for it, and the wording assigns no blame.

<h4 id="ctrlc-today">Ctrl+C today</h4>

Ctrl+C throws `ExitPromptError`, which reaches the generic `catch` at `run.ts:201`, is
relabelled `catalog-unavailable`, and exits 1 after printing inquirer's raw
`User force closed the prompt`. Since `cancelled` is a `TryNestError`, the
`isTryNestError` branch takes it and the relabelling path is never reached. The bug is
closed by construction rather than by a special case.

## Component contracts

### `src/adapters/cli/progress.ts` (new, ~50 lines, no new dependency)

```ts
export function createProgress(
  stream: NodeJS.WritableStream = process.stderr,
  animated: boolean = process.stderr.isTTY === true && process.env.TERM !== "dumb",
): Progress;
```

- Writes to **stderr**. `docs/cli-ux.md`: *"Progress belongs on the error stream;
  machine-readable results on the standard stream."*
- Braille frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` at 80 ms, cleared with `\r\x1b[K` on stop.
- A spinner is never live while a prompt renders: `while` stops before it returns, and every
  prompt is called outside a `while` scope. There is no interleaving case to handle.
- `--list` is reached *after* the catalog `while` resolves, so a terminal shows a spinner and
  then the list, while a pipe gets the static label on stderr and untouched stdout.
- The interval is `unref`'d, so it can never hold the process open.
- `while` takes a **thunk** so ADR-0005's prefetch survives: `listSamples()` still fires
  before anything is drawn, and `while` adopts the already-pending promise.
- The `animated` default probes `process.stderr` even when `stream` is overridden: the
  question is whether the *user's* terminal animates. Tests pass both arguments explicitly.
- When `animated` is false it writes the label **once, statically** and animates nothing.
  This is `cli-ux.md`'s *"degrade when not attached to a terminal"*: CI logs keep the line
  they have today, `--list --json` keeps a clean stdout, and no ANSI reaches a pipe.
- Hand-rolled rather than a dependency. Runtime dependencies stay at two
  (`@inquirer/prompts`, `tar-stream`). inquirer's own theme spinner renders only during a
  prompt's `loading` status, so it cannot cover non-prompt work.

### Changed files

| File | Change |
|---|---|
| `src/adapters/cli/prompts.ts` | `escapable` helper; injectable `input`/`output`; all four methods routed through it |
| `src/adapters/cli/presenter.ts` | drop `starting`/`scaffolding`; `exitCodeFor` → 130 for `cancelled` |
| `src/adapters/cli/run.ts` | `progress` in `RunDependencies`; three `while` scopes; prompt reorder (D4) |
| `src/application/ports.ts` | `Presenter` narrowed by two methods; `Interaction` unchanged |
| `src/domain/errors.ts` | `cancelled` added to `FailureKind` |

## Test plan

Every behaviour is offline and deterministic. A `PassThrough` pair with `isTTY = true` and
a stubbed `setRawMode` drives the prompts; fake timers drive the spinner.

**`tests/adapters/cli/progress.spec.ts`** (new)

- `animated: false` writes the label once and emits no ANSI escape.
- `animated: true` emits at least one frame, then a clear sequence.
- `while` returns the work's value.
- `while` re-throws the work's error **and still clears** the line.
- The thunk is called once and adopts an already-pending promise (ADR-0005).
- No further writes after resolution, once timers advance past the frame interval.

**`tests/adapters/cli/prompts.spec.ts`**

- Esc rejects with kind `cancelled` at each of the four prompts.
- `\u0003` (Ctrl+C) rejects with kind `cancelled` — the RED test for the mislabelling bug.
- `\u001b[B` then Enter resolves the **moved** selection, proving Esc-prefixed sequences are
  discriminated rather than swallowed.
- Typing `my-app` then Enter still resolves `"my-app"`.
- `input.listenerCount("keypress")` returns to its prior value after each call.

**`tests/adapters/cli/run.spec.ts`**

- The reorder is pinned by a shared event log fed by both the fake `Interaction` and the
  fake `WorkspaceWriter`: `confirmInstall` and `choosePackageManager` appear **before** the
  writer's first entry. *This test fails against today's code* — the reorder is behaviour
  change under test, not a refactor.
- Esc at `confirmInstall` writes nothing and returns 130.
- A fake `Progress` records `["Fetching…", "Looking up…", "Scaffolding…"]` in order.
- Existing non-interactive guard tests keep passing, with prompts never called.

`RunDependencies` gains `progress`; the existing `depsWith` helper in `run.spec.ts` is the
single place that needs a default.

**`tests/adapters/cli/presenter.spec.ts`** — drop `starting`/`scaffolding`; add
`exitCodeFor` → 130 and the terse `renderFailure` output.

## Documentation updates

| File | Change |
|---|---|
| `docs/cli-ux.md` | line 104: exit codes gain the *interrupted* class; the interactive path gains a line about Esc |
| `README.md` | line 46: exit codes gain `130` |
| `docs/architecture.md` | line 68: `Presenter` becomes "Report results and failures" — transient progress is no longer a port's job |

## Non-goals

- **Esc during non-prompt async work.** Ctrl+C already covers the spinner; binding Esc
  outside a prompt would mean owning stdin for the whole run.
- **A spinner on the install step.** Package managers draw their own output.
- **Moving prompt rendering off stdout.** Pre-existing, and a separate argument from
  `cli-ux.md`'s progress-on-stderr rule.
- **Colour or theming changes.**
- **Reworking the generic `catch` relabel at `run.ts:201`.** Cancellation no longer reaches
  it; whether an unexpected error should still be called `catalog-unavailable` is a
  different question.
