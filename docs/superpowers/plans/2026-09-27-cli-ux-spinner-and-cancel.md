# CLI UX: progress spinners and Esc-to-cancel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate the CLI's slow steps with a spinner, and let a person leave any
prompt with Esc and get a truthful "nothing was written" and exit code 130.

**Architecture:** Both changes live in the CLI adapter. A new adapter-local
`Progress` scope (`progress.while(label, work)`) owns each spinner's whole
lifecycle and is injected through `RunDependencies`; a module-local `escapable`
helper in `prompts.ts` binds Esc to an `AbortController` and translates
inquirer's two cancel errors into one new domain failure kind. The four prompts
move ahead of the first filesystem write so cancellation needs no
stage-awareness.

**Tech Stack:** TypeScript 7 (ESM, `verbatimModuleSyntax`, `erasableSyntaxOnly`),
Node >=22, `@inquirer/prompts` 8, `node:readline`, Vitest 5, Biome 2.

**Spec:** [`docs/superpowers/specs/2026-09-27-cli-ux-spinner-and-cancel-design.md`](../specs/2026-09-27-cli-ux-spinner-and-cancel-design.md)

## Global Constraints

- Node `>=22`, ESM, `"type": "module"`. Import with explicit `.ts` extensions.
- `import type` for type-only imports; **no runtime-emitting TS syntax** (no enums,
  no parameter properties) — `erasableSyntaxOnly` is on.
- **Runtime dependencies stay at exactly two:** `@inquirer/prompts`, `tar-stream`.
  No new dependency, and **no import from an undeclared transitive package** —
  that rules out `@inquirer/core` and `@inquirer/type` (see Verified Facts V4).
- Progress output goes to **stderr**; stdout stays machine-readable
  (`docs/cli-ux.md`: *"Progress belongs on the error stream; machine-readable
  results on the standard stream."*).
- Spinner frames: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` at **80 ms**, cleared with `\r\x1b[K`.
- Exit codes: `0` success, `2` user error, `130` cancelled, `1` environmental.
- Cancellation message, verbatim: `Cancelled. Nothing was written.`
- Biome: 2-space indent, double quotes, organize-imports. Specs live in
  `tests/**/*.spec.ts` with `globals: false` — import `describe`/`it`/`expect`
  from `vitest` explicitly.
- Conventional commits. Every commit message ends with these two trailers, in
  this order (`Co-Authored-By` last, per the user's global instruction):

  ```
  Claude-Session: https://claude.ai/code/session_019g6UcJUKkQUZh8fnLrm6yH
  Co-Authored-By: Claude Code (claude-opus-5) <noreply@anthropic.com>
  ```

## Verified Facts

Probed against the installed libraries on 2026-09-27. Do not re-derive these;
do not "fix" a test that depends on them.

- **V1 — Esc arrives ~500 ms late.** Node flushes a *trailing* `\u001b` only
  after `ESCAPE_CODE_TIMEOUT` (500 ms), because until then it might be the start
  of an escape sequence. Measured: 552–564 ms from byte to rejection. Tests that
  press Esc must use **real timers** and allow at least 2 s per test. This is
  also correct product behaviour: shortening it would risk reading the leading
  Esc of an arrow key as a cancel.
- **V2 — the spec's `escapable` ordering is safe.** `emitKeypressEvents(input)`
  then `input.on("keypress", …)` then calling the prompt was probed: arrow-down
  (`\u001b[B`) resolves the *moved* choice and never aborts, a typed answer
  resolves normally, and four sequential prompts on one stream end with
  `input.listenerCount("keypress") === 0`.
- **V3 — the two cancel errors.** Esc/abort rejects with `AbortPromptError`
  (`message: "Prompt was aborted"`); Ctrl+C rejects with `ExitPromptError`
  (`message: "User force closed the prompt with SIGINT"`). Both set `name` as an
  own instance property. Ctrl+C in a prompt does **not** signal the process —
  readline emits `SIGINT` on its interface instead — so our exit code is what the
  shell reports.
- **V4 — those classes are not importable from a declared dependency.**
  `AbortPromptError`/`ExitPromptError` live in `@inquirer/core` and the prompt
  `Context` type in `@inquirer/type`; `package.json` declares neither. Hence the
  name-based check and the local `PromptContext` type in Task 3.
- **V5 — a pre-aborted signal rejects immediately** with `AbortPromptError`, and
  an Esc typed *before* the prompt renders (buffered on stdin while the spinner
  was up) still cancels that prompt (~505 ms).
- **V6 — Vitest's faked `setInterval` returns an object with `unref`**, so
  `timer.unref()` is safe under `vi.useFakeTimers()`.
- **V7 — `setInterval` is typed `NodeJS.Timeout` in this project** (`run.ts:78`
  already annotates `NodeJS.Timeout`), so `unref()` typechecks.

## Deviations from the spec

Both are refinements, not reinterpretations. Keep them; they are load-bearing.

1. **`asCancellation` compares `error.name` instead of using `instanceof`, and
   the prompt context is a locally declared type.** The spec's sketch imports
   `AbortPromptError`, `ExitPromptError` and `Context`, but those live in
   `@inquirer/core` / `@inquirer/type`, which this package does not depend on
   (V4). Importing them would either break a strict install of the published
   package or push runtime dependencies from two to four, against the spec's own
   constraint. `instanceof` would also fail *silently* against a duplicated copy
   of `@inquirer/core`, turning a cancelled run back into the crash this work
   exists to remove. The spec's intent — that this adapter is the only code that
   names inquirer's error vocabulary, per ADR-0004 — is kept literally.
2. **The spinner truncates a label that would not fit the terminal.** `\r\x1b[K`
   erases one line; a label wide enough to wrap would leave its first row on
   screen. `Scaffolding <id> into <dir>…` makes that ordinary rather than exotic,
   since `<dir>` can be a deep path.

## Review Focus

Five input classes the spec is silent about, each with the test that pins it and
the task that owns it:

1. **An Esc typed while a spinner is up, before the prompt renders.** stdin
   buffers it; it must cancel the prompt it lands on rather than corrupt that
   prompt's answer (V5). → Task 3, step 9.
2. **Work that throws while the terminal cannot animate.** The static label must
   stand, the error must propagate, and **no** escape sequence may reach the
   pipe. → Task 2, step 5.
3. **Two `while` scopes in sequence.** The second must not inherit the first's
   interval, and nothing may be written after the last one resolves. → Task 2,
   steps 7 and 8.
4. **A label wider than the terminal.** Every drawn line must fit, so the clear
   can actually erase it. → Task 2, step 9.
5. **Ctrl+C, not just Esc, at a prompt.** It must exit 130 having written
   nothing — today it is relabelled `catalog-unavailable` and exits 1 printing
   inquirer's raw internal message. → Task 3, step 7 (unit) and Task 4, step 12
   (end to end).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/errors.ts` | gains one `FailureKind`: `cancelled` |
| `src/adapters/cli/progress.ts` | **new.** The `Progress` scope and its spinner. ~60 lines, no dependency |
| `src/adapters/cli/prompts.ts` | the four prompts, now routed through one `escapable` helper that owns Esc and error translation |
| `src/adapters/cli/presenter.ts` | loses `starting`/`scaffolding`; `exitCodeFor` learns 130 |
| `src/application/ports.ts` | `Presenter` narrows by two methods; `Interaction` untouched |
| `src/adapters/cli/run.ts` | composition: injects `Progress`, wraps three steps, asks every question before the first write |
| `tests/adapters/cli/progress.spec.ts` | **new.** Spinner behaviour, offline, fake timers |
| `tests/adapters/cli/prompts.spec.ts` | **new.** Esc/Ctrl+C/arrow-key behaviour against real inquirer over a `PassThrough` pair |
| `tests/adapters/cli/presenter.spec.ts` | exit code 130 and the terse cancellation render |
| `tests/adapters/cli/run.spec.ts` | prompt order, progress labels, cancellation end to end |

---

## Task 1: The `cancelled` failure kind and exit code 130

Nothing can cancel anything until the domain has a word for it. This task is
pure vocabulary plus the exit-code contract, and it ships on its own.

**Files:**
- Modify: `src/domain/errors.ts:1-11` (the `FailureKind` union)
- Modify: `src/adapters/cli/presenter.ts:11-21` (`exitCodeFor`)
- Test: `tests/adapters/cli/presenter.spec.ts`
- Modify: `README.md:46`, `docs/cli-ux.md:104-106`

**Interfaces:**
- Consumes: nothing.
- Produces: `FailureKind` includes `"cancelled"`; `exitCodeFor(new
  TryNestError("cancelled", …)) === 130`; `renderFailure` of a `cancelled` error
  returns its bare message (the existing `default:` branch already does this —
  the test pins it).

- [ ] **Step 1: Write the failing tests**

In `tests/adapters/cli/presenter.spec.ts`, add one case to the existing
`renderFailure` describe block:

```ts
  it("says only that the run was abandoned, with no advice attached", () => {
    const message = renderFailure(
      new TryNestError("cancelled", "Cancelled. Nothing was written."),
    );

    expect(message).toBe("Cancelled. Nothing was written.");
  });
```

and one to the existing `exitCodeFor` describe block:

```ts
  it("uses the interrupt convention when the user ends the run themselves", () => {
    expect(exitCodeFor(new TryNestError("cancelled", "Cancelled."))).toBe(130);
  });
```

- [ ] **Step 2: Run the tests to verify the exit-code one fails**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/presenter.spec.ts`

Expected: the `exitCodeFor` case FAILS with `expected 130, received 1` — the
`default:` branch is answering. The `renderFailure` case passes already; it is a
regression pin on the terse wording, not a RED.

Note: `vitest run` strips types with esbuild and does not typecheck, so
`"cancelled"` not yet being in the union does not stop the run. `npm run
typecheck` is what would catch that, and step 4 runs it.

- [ ] **Step 3: Add the kind and the exit code**

In `src/domain/errors.ts`, extend the union (keep `input-required` last so the
diff is one line):

```ts
export type FailureKind =
  | "catalog-unavailable"
  | "catalog-incomplete"
  | "rate-limited"
  | "sample-not-found"
  | "archive-unavailable"
  | "target-directory-unusable"
  | "unsafe-archive-entry"
  | "extraction-failed"
  | "install-failed"
  | "cancelled"
  | "input-required";
```

In `src/adapters/cli/presenter.ts`, replace the `exitCodeFor` block
(lines 11-21) with:

```ts
/** User error exits 2; a run the user ended exits 130; a broken world exits 1. */
export function exitCodeFor(error: TryNestError): number {
  switch (error.kind) {
    case "input-required":
    case "target-directory-unusable":
    case "sample-not-found":
      return 2;
    // The conventional code for a run ended by an interactive interrupt, which
    // is what a shell reports for SIGINT.
    case "cancelled":
      return 130;
    default:
      return 1;
  }
}
```

- [ ] **Step 4: Run the tests and the typechecker**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/presenter.spec.ts && npm run typecheck`

Expected: both new cases PASS, no type errors.

- [ ] **Step 5: Record the exit code in the two documents that promise them**

`README.md:46` — replace:

```
Exit codes: `0` success, `2` bad input, `1` something in the world was broken.
```

with:

```
Exit codes: `0` success, `2` bad input, `130` a run you ended yourself at a
prompt, `1` something in the world was broken.
```

`docs/cli-ux.md:104-106` — replace:

```
- Exit codes distinguish success, user error (bad input, occupied directory) and
  environmental failure (network, upstream). Scripts should be able to tell "I
  asked for the wrong thing" from "the world was broken".
```

with:

```
- Exit codes distinguish success, user error (bad input, occupied directory), a
  run the user ended themselves at a prompt, and environmental failure (network,
  upstream). Scripts should be able to tell "I asked for the wrong thing" from
  "the world was broken", and someone who walked away from a question is
  neither.
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/errors.ts src/adapters/cli/presenter.ts tests/adapters/cli/presenter.spec.ts README.md docs/cli-ux.md
git commit -m "$(cat <<'MSG'
feat: exit 130 when a run is ended at a prompt

A run the user walks away from is neither bad input nor a broken world, so it
gets the conventional interrupt code rather than being folded into either. The
message carries no advice: there is nothing to retry and nothing to clean up.

Claude-Session: https://claude.ai/code/session_019g6UcJUKkQUZh8fnLrm6yH
Co-Authored-By: Claude Code (claude-opus-5) <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: The `Progress` scope

A spinner whose lifecycle cannot leak, because the caller never holds a handle.
Self-contained: no other file changes, no dependency added.

**Files:**
- Create: `src/adapters/cli/progress.ts`
- Test: `tests/adapters/cli/progress.spec.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces, for Task 4:
  - `export interface Progress { while<T>(label: string, work: () => Promise<T>): Promise<T> }`
  - `export type ProgressStream = NodeJS.WritableStream & { readonly columns?: number }`
  - `export function createProgress(stream?: ProgressStream, animated?: boolean): Progress`

- [ ] **Step 1: Write the failing tests**

Create `tests/adapters/cli/progress.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ProgressStream,
  createProgress,
} from "../../../src/adapters/cli/progress.ts";

/** Escape introducer, spelled out so no regex literal carries a control byte. */
const ESC = "\u001b";
const CLEAR = `\r${ESC}[K`;

function recording(columns?: number): {
  stream: ProgressStream;
  written: () => string;
} {
  const chunks: string[] = [];
  const stream = {
    write: (chunk: string) => void chunks.push(chunk),
    ...(columns === undefined ? {} : { columns }),
  };

  return {
    stream: stream as unknown as ProgressStream,
    written: () => chunks.join(""),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createProgress().while without a terminal", () => {
  it("writes the label once and no escape sequence at all", async () => {
    const { stream, written } = recording();

    await createProgress(stream, false).while(
      "Fetching the available NestJS samples…",
      async () => "done",
    );

    expect(written()).toBe("Fetching the available NestJS samples…\n");
    expect(written()).not.toContain(ESC);
  });

  it("keeps a pipe clean when the work throws", async () => {
    const { stream, written } = recording();

    await expect(
      createProgress(stream, false).while("Scaffolding…", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(written()).toBe("Scaffolding…\n");
    expect(written()).not.toContain(ESC);
  });
});

describe("createProgress().while on a terminal", () => {
  it("returns the work's value", async () => {
    const { stream } = recording(80);

    const value = await createProgress(stream, true).while(
      "Fetching…",
      async () => 42,
    );

    expect(value).toBe(42);
  });

  it("re-throws the work's error and still clears the line", async () => {
    const { stream, written } = recording(80);

    await expect(
      createProgress(stream, true).while("Scaffolding…", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(written().endsWith(CLEAR)).toBe(true);
  });

  it("animates while the work is pending", async () => {
    vi.useFakeTimers();
    const { stream, written } = recording(80);
    let release: () => void = () => {};
    const pending = createProgress(stream, true).while(
      "Fetching…",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    expect(written()).toContain("⠋ Fetching…");

    await vi.advanceTimersByTimeAsync(80);
    expect(written()).toContain("⠙ Fetching…");

    release();
    await pending;
  });

  it("calls the thunk once and adopts a promise already in flight", async () => {
    const { stream } = recording(80);
    let calls = 0;
    // What run.ts does: the request is already away before anything is drawn.
    const inFlight = Promise.resolve("catalog");

    const value = await createProgress(stream, true).while("Fetching…", () => {
      calls += 1;
      return inFlight;
    });

    expect(calls).toBe(1);
    expect(value).toBe("catalog");
  });

  it("writes nothing more once the work has resolved", async () => {
    vi.useFakeTimers();
    const { stream, written } = recording(80);

    await createProgress(stream, true).while("Fetching…", async () => "x");
    const settled = written();

    await vi.advanceTimersByTimeAsync(400);
    expect(written()).toBe(settled);
  });

  it("does not let one scope's spinner outlive it into the next", async () => {
    vi.useFakeTimers();
    const { stream, written } = recording(80);
    const progress = createProgress(stream, true);

    await progress.while("Fetching…", async () => "a");
    await progress.while("Scaffolding…", async () => "b");
    const settled = written();

    await vi.advanceTimersByTimeAsync(400);
    expect(written()).toBe(settled);
    // The second label was drawn, and after the last clear nothing remains.
    expect(settled).toContain("Scaffolding…");
    expect(settled.endsWith(CLEAR)).toBe(true);
  });

  it("keeps a long label inside the terminal so the clear can erase it", async () => {
    const { stream, written } = recording(40);

    await createProgress(stream, true).while(
      `Scaffolding 01-cats-app into ${"deep/".repeat(12)}cats…`,
      async () => undefined,
    );

    const drawn = written()
      .split(CLEAR)
      .filter((part) => part.length > 0);

    expect(drawn.length).toBeGreaterThan(0);
    for (const line of drawn) expect(line.length).toBeLessThanOrEqual(39);
    expect(drawn[0]?.endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/progress.spec.ts`

Expected: FAIL — `Failed to resolve import ".../src/adapters/cli/progress.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/adapters/cli/progress.ts`:

```ts
/**
 * A spinner for work slow enough to look hung. `while` owns the whole
 * lifecycle — start, frames, stop, clear — so no caller can leak a live
 * interval into the next render, and no `finally` has to be remembered.
 *
 * Deliberately not a port: no use case reports progress, only the composition
 * root does, so an application-layer interface would have no consumer.
 */
export interface Progress {
  /** Runs `work` under a spinner labelled `label`. Stops it on success and on throw. */
  while<T>(label: string, work: () => Promise<T>): Promise<T>;
}

/** `columns` is a TTY's; a plain writable has none. */
export type ProgressStream = NodeJS.WritableStream & {
  readonly columns?: number;
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;
const CLEAR_LINE = "\r\x1b[K";
const FALLBACK_COLUMNS = 80;

export function createProgress(
  stream: ProgressStream = process.stderr,
  // Whether the *user's* terminal animates is a question about process.stderr
  // even when the writes are directed somewhere else, so the default probes it
  // rather than `stream`. Tests pass both arguments explicitly.
  animated: boolean = process.stderr.isTTY === true &&
    process.env.TERM !== "dumb",
): Progress {
  return {
    async while<T>(label: string, work: () => Promise<T>): Promise<T> {
      // Not a terminal: keep the single static line CI logs have today, and let
      // no escape sequence reach a pipe.
      if (!animated) {
        stream.write(`${label}\n`);
        return work();
      }

      let frame = 0;
      const render = (): void => {
        const line = `${FRAMES[frame]} ${label}`;
        frame = (frame + 1) % FRAMES.length;
        stream.write(`${CLEAR_LINE}${fit(line, stream.columns)}`);
      };

      render();
      const timer: NodeJS.Timeout = setInterval(render, FRAME_INTERVAL_MS);
      // A spinner is never a reason to hold the process open.
      timer.unref();

      try {
        return await work();
      } finally {
        clearInterval(timer);
        stream.write(CLEAR_LINE);
      }
    },
  };
}

/**
 * A wrapped line cannot be erased by a one-line clear, and a deep target path
 * makes that ordinary rather than exotic.
 */
function fit(line: string, columns?: number): string {
  const width =
    columns !== undefined && columns > 2 ? columns - 1 : FALLBACK_COLUMNS;

  return line.length <= width ? line : `${line.slice(0, width - 1)}…`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/progress.spec.ts && npm run typecheck`

Expected: 9 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
npm run lint && npm run format
git add src/adapters/cli/progress.ts tests/adapters/cli/progress.spec.ts
git commit -m "$(cat <<'MSG'
feat: add a progress scope that animates slow steps

`while(label, work)` owns the spinner's whole lifecycle, so no call site can
leak a live interval into the next render — including the --list path, which
returns through stdout with no further presenter call at all. The interval is
unref'd, the label is written once and statically when stderr is not a
terminal, and a label too wide for the terminal is truncated: a wrapped line
cannot be erased by a one-line clear, and a deep target path makes that
ordinary.

Hand-rolled rather than a dependency, keeping runtime dependencies at two.
inquirer's own theme spinner renders only during a prompt's loading status, so
it cannot cover work between prompts.

Claude-Session: https://claude.ai/code/session_019g6UcJUKkQUZh8fnLrm6yH
Co-Authored-By: Claude Code (claude-opus-5) <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: Esc abandons any prompt

**Files:**
- Modify: `src/adapters/cli/prompts.ts` (whole file)
- Test: `tests/adapters/cli/prompts.spec.ts` (new)
- Modify: `docs/cli-ux.md` (after the numbered interactive path, ~line 37)

**Interfaces:**
- Consumes: `TryNestError` and the `cancelled` kind from Task 1.
- Produces, for Task 4: `createPrompts(streams?: PromptStreams): Interaction`,
  where `PromptStreams = { readonly input?: NodeJS.ReadableStream; readonly
  output?: NodeJS.WritableStream }`. `createPrompts()` with no argument still
  reads `process.stdin`/`process.stdout`, so `run.ts` needs no change here. Every
  method rejects with `TryNestError { kind: "cancelled" }` on Esc or Ctrl+C.

- [ ] **Step 1: Write the failing tests**

Create `tests/adapters/cli/prompts.spec.ts`. Note the two facts these tests are
built on: Esc lands ~500 ms after the byte (V1), and inquirer needs a
terminal-shaped stream pair.

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPrompts } from "../../../src/adapters/cli/prompts.ts";
import type { Interaction } from "../../../src/application/ports.ts";
import { isTryNestError } from "../../../src/domain/errors.ts";
import type { Sample } from "../../../src/domain/sample.ts";

const ESC = "\u001b";
const CTRL_C = "\u0003";
const ENTER = "\r";
const ARROW_DOWN = `${ESC}[B`;

/**
 * Node flushes a trailing Esc only after its 500 ms escape-sequence timeout —
 * until then the byte might begin an arrow key. Every Esc case pays that.
 */
const ESCAPE_TEST_TIMEOUT_MS = 4_000;

const samples: readonly Sample[] = [
  {
    id: "01-cats-app",
    displayName: "01-cats-app",
    layout: "single",
    subProjects: [],
  },
  {
    id: "02-gateways",
    displayName: "02-gateways",
    layout: "single",
    subProjects: [],
  },
];

function terminal(): {
  prompts: Interaction;
  input: PassThrough;
  press: (keys: string, afterMs?: number) => void;
} {
  const input = new PassThrough();
  const output = new PassThrough();

  // A PassThrough is neither a TTY nor raw-mode capable; inquirer's readline
  // requires both to render at all.
  Object.assign(input, { isTTY: true, setRawMode: () => input });
  Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
  output.resume();

  return {
    prompts: createPrompts({ input, output }),
    input,
    press: (keys: string, afterMs = 40) => {
      setTimeout(() => void input.write(keys), afterMs);
    },
  };
}

async function kindOf(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  return isTryNestError(error) ? error.kind : `not-a-domain-error:${error}`;
}

const questions: ReadonlyArray<
  [name: string, ask: (prompts: Interaction) => Promise<unknown>]
> = [
  ["chooseSample", (prompts) => prompts.chooseSample(samples)],
  ["chooseTargetDirectory", (prompts) => prompts.chooseTargetDirectory("cats")],
  ["confirmInstall", (prompts) => prompts.confirmInstall()],
  [
    "choosePackageManager",
    (prompts) => prompts.choosePackageManager(["npm", "pnpm"]),
  ],
];

describe.each(questions)("createPrompts().%s", (_name, ask) => {
  it(
    "is abandoned by Esc",
    async () => {
      const { prompts, press } = terminal();
      press(ESC);

      expect(await kindOf(ask(prompts))).toBe("cancelled");
    },
    ESCAPE_TEST_TIMEOUT_MS,
  );

  it("is abandoned by Ctrl+C", async () => {
    const { prompts, press } = terminal();
    press(CTRL_C);

    expect(await kindOf(ask(prompts))).toBe("cancelled");
  });

  it(
    "leaves no keypress listener behind",
    async () => {
      const { prompts, input, press } = terminal();
      const before = input.listenerCount("keypress");
      press(ESC);

      await kindOf(ask(prompts));

      expect(input.listenerCount("keypress")).toBe(before);
    },
    ESCAPE_TEST_TIMEOUT_MS,
  );
});

describe("createPrompts() with an answer", () => {
  it("discriminates an Esc-prefixed sequence from a bare Esc", async () => {
    const { prompts, press } = terminal();
    press(ARROW_DOWN, 40);
    press(ENTER, 120);

    // Arrow-down begins with Esc. Reading it as a cancel would make the picker
    // unusable, so the moved selection is the assertion that matters.
    expect(await prompts.chooseSample(samples)).toBe(samples[1]);
  });

  it("still resolves a typed directory name", async () => {
    const { prompts, press } = terminal();
    press("my-app", 40);
    press(ENTER, 120);

    expect(await prompts.chooseTargetDirectory("cats")).toBe("my-app");
  });

  it(
    "cancels the prompt an Esc pressed during the previous wait lands on",
    async () => {
      const { prompts, input } = terminal();
      // Typed while the catalog spinner was up: stdin buffers it, and it
      // arrives as soon as the prompt starts reading.
      input.write(ESC);

      expect(await kindOf(prompts.confirmInstall())).toBe("cancelled");
    },
    ESCAPE_TEST_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/prompts.spec.ts`

Expected: FAIL. `createPrompts` takes no argument yet, so the prompts read the
real `process.stdin` and nothing is answered: the Esc and Ctrl+C cases report
`not-a-domain-error:…` or time out, and the answer cases hang until their
timeout.

- [ ] **Step 3: Write the implementation**

Replace `src/adapters/cli/prompts.ts` entirely:

```ts
import { emitKeypressEvents } from "node:readline";
import { confirm, input, select } from "@inquirer/prompts";
import type { Interaction } from "../../application/ports.ts";
import { TryNestError } from "../../domain/errors.ts";
import type { PackageManager } from "../../domain/package-manager.ts";
import type { Sample } from "../../domain/sample.ts";

/**
 * What `@inquirer/prompts` accepts as a prompt's second argument. Declared here
 * rather than imported: the type lives in `@inquirer/type`, a transitive
 * package we do not depend on, and the shape is three optional fields.
 */
interface PromptContext {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly signal?: AbortSignal;
}

export interface PromptStreams {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

/**
 * Both ways out of a prompt, named by the classes inquirer rejects with.
 * Matched by name rather than `instanceof`: those classes live in
 * `@inquirer/core`, which we do not declare as a dependency, and two copies of
 * it in one tree would make `instanceof` fail silently — turning a cancelled
 * run back into the crash this exists to prevent.
 */
const CANCEL_ERROR_NAMES = new Set(["AbortPromptError", "ExitPromptError"]);

/**
 * The only place that names inquirer's error vocabulary, so it stops at the
 * adapter that owns inquirer (ADR-0004). The domain learns one thing: the run
 * was cancelled.
 */
function asCancellation(error: unknown): unknown {
  return error instanceof Error && CANCEL_ERROR_NAMES.has(error.name)
    ? new TryNestError("cancelled", "Cancelled. Nothing was written.")
    : error;
}

export function createPrompts(streams: PromptStreams = {}): Interaction {
  const inputStream = streams.input ?? process.stdin;
  const outputStream = streams.output ?? process.stdout;

  /**
   * Binds Esc to abandoning the prompt. The keypress has to come from our own
   * listener: `@inquirer/core` exports no `isEscapeKey` and no bundled prompt
   * binds Esc. Two things this must not do — it never touches raw mode, which
   * inquirer owns and fighting breaks terminal teardown, and it never keeps its
   * listener past the prompt, or four sequential questions accumulate four.
   */
  async function escapable<T>(
    ask: (context: PromptContext) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    emitKeypressEvents(inputStream);
    const onKeypress = (_chunk: string, key?: { name?: string }): void => {
      if (key?.name === "escape") controller.abort();
    };

    inputStream.on("keypress", onKeypress);

    try {
      return await ask({
        signal: controller.signal,
        input: inputStream,
        output: outputStream,
      });
    } catch (error) {
      throw asCancellation(error);
    } finally {
      inputStream.off("keypress", onKeypress);
    }
  }

  return {
    async chooseSample(samples: readonly Sample[]): Promise<Sample> {
      return escapable((context) =>
        select(
          {
            message: "Which sample would you like to try?",
            pageSize: 15,
            choices: samples.map((sample) => ({
              name:
                sample.layout === "composite"
                  ? `${sample.displayName}  (${sample.subProjects.length} projects)`
                  : sample.displayName,
              value: sample,
              ...(sample.description === undefined
                ? {}
                : { description: sample.description }),
            })),
          },
          context,
        ),
      );
    },

    async chooseTargetDirectory(suggested: string): Promise<string> {
      return escapable((context) =>
        input(
          {
            message: "Where should it go?",
            default: suggested,
          },
          context,
        ),
      );
    },

    async confirmInstall(): Promise<boolean> {
      return escapable((context) =>
        confirm(
          {
            message: "Install dependencies now?",
            default: true,
          },
          context,
        ),
      );
    },

    async choosePackageManager(
      available: readonly PackageManager[],
    ): Promise<PackageManager> {
      return escapable((context) =>
        select(
          {
            message: "Which package manager?",
            choices: available.map((manager) => ({
              name: manager,
              value: manager,
            })),
          },
          context,
        ),
      );
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/prompts.spec.ts && npm run typecheck`

Expected: 15 passing (4 questions × 3 cases, plus 3 answer cases), no type
errors. The whole file takes roughly 4 s, most of it Esc timeouts.

If `npm run typecheck` rejects passing a `PassThrough` where
`NodeJS.ReadableStream`/`NodeJS.WritableStream` is expected, cast at the call
site — `createPrompts({ input: input as unknown as NodeJS.ReadableStream, output:
output as unknown as NodeJS.WritableStream })` — which is the pattern
`presenter.spec.ts` already uses for its fake stream.

- [ ] **Step 5: Document that a person can leave**

In `docs/cli-ux.md`, insert after the numbered interactive path (between the list
ending `7. **Next steps.** …` and the `### Obligations of the picker` heading):

```
**Any question can be abandoned.** Esc, like Ctrl+C, ends the run from any
prompt. Every question is asked before anything is written, so this is always
true and always says so: nothing was written, and there is nothing to clean up.
```

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run format
git add src/adapters/cli/prompts.ts tests/adapters/cli/prompts.spec.ts docs/cli-ux.md
git commit -m "$(cat <<'MSG'
feat: let Esc abandon any prompt

One `escapable` helper wraps all four questions: it binds Esc to an
AbortController, which every @inquirer prompt accepts through its context, and
translates inquirer's two cancel errors into the domain's `cancelled` kind. So
Ctrl+C is fixed by the same change — it used to reach the generic catch, get
relabelled catalog-unavailable, and exit 1 printing inquirer's raw internal
message.

The keypress comes from our own listener because no bundled prompt binds Esc
and @inquirer/core exports no isEscapeKey. The helper never touches raw mode,
which inquirer owns, and removes its listener in `finally` so four sequential
questions do not accumulate four. Esc-prefixed sequences stay discriminated:
arrow-down still moves the selection.

Matched by error name rather than instanceof, and the prompt context is
declared locally, because both live in transitive packages we do not depend on
— and a duplicated @inquirer/core would make instanceof fail silently, which
is exactly the crash this removes.

Claude-Session: https://claude.ai/code/session_019g6UcJUKkQUZh8fnLrm6yH
Co-Authored-By: Claude Code (claude-opus-5) <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: Wire it up — progress in `run.ts`, a narrower `Presenter`, every question first

Two commits: the progress wiring with the port narrowing, then the prompt
reorder that makes "Nothing was written." unconditionally true.

**Files:**
- Modify: `src/application/ports.ts:58-70` (`Presenter`)
- Modify: `src/adapters/cli/presenter.ts:47-56` (drop two methods)
- Modify: `src/adapters/cli/run.ts:41-51, 59-71, 111-199`
- Test: `tests/adapters/cli/run.spec.ts`
- Modify: `docs/architecture.md:68`

**Interfaces:**
- Consumes: `Progress`/`createProgress` (Task 2), the `cancelled` kind (Task 1),
  `createPrompts` (Task 3 — signature unchanged for a no-argument call).
- Produces: `RunDependencies` gains `readonly progress: Progress`. `Presenter`
  loses `starting()` and `scaffolding(plan)`; `installing`, `succeeded`, `warn`
  and `failed` are untouched.

- [ ] **Step 1: Write the failing test for the progress labels**

In `tests/adapters/cli/run.spec.ts`, teach `depsWith` about `progress` and
return the labels it records. Replace the signature and the `presenter`/`stdout`
entries of the fake:

```ts
function depsWith(overrides: Partial<RunDependencies> = {}): {
  deps: RunDependencies;
  lines: string[];
  labels: string[];
} {
  const lines: string[] = [];
  const labels: string[] = [];

  const deps: RunDependencies = {
    catalog: {
      listPaths: async () => [
        "sample/01-cats-app/package.json",
        "sample/02-gateways/package.json",
      ],
    },
    metadata: { readDescription: async () => undefined },
    archive: { entries: () => streamOf([]) },
    writer: { materialize: async () => {} },
    probe: {
      inspect: async () => ({
        exists: false,
        isDirectory: false,
        isEmpty: true,
      }),
    },
    runner: { detect: async () => ["npm"], install: async () => {} },
    interaction: {
      chooseSample: async (samples) => samples[0] as never,
      chooseTargetDirectory: async (suggested) => suggested,
      confirmInstall: async () => false,
      choosePackageManager: async () => "npm",
    },
    presenter: {
      installing: () => {},
      succeeded: () => lines.push("succeeded"),
      warn: (message) => lines.push(`warn:${message}`),
      failed: (error) => lines.push(`failed:${error.kind}`),
    },
    progress: {
      while: async (label, work) => {
        labels.push(label);
        return work();
      },
    },
    stdout: { write: (chunk: string) => void lines.push(chunk.trimEnd()) },
    ...overrides,
  };

  return { deps, lines, labels };
}
```

Two differences from what is there today: the `progress` fake is new, and
`starting`/`scaffolding` are gone from the presenter fake — it describes the
port as it is about to be.

Then add, inside the existing `describe("run", …)`:

```ts
  it("names each slow step while it waits", async () => {
    const { deps, labels } = depsWith();

    const code = await run(
      ["--sample", "01-cats-app", "--dir", "cats", "--no-install"],
      deps,
      nonInteractive,
    );

    expect(code).toBe(0);
    expect(labels).toEqual([
      "Fetching the available NestJS samples…",
      "Looking up sample descriptions…",
      "Scaffolding 01-cats-app into cats…",
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/run.spec.ts`

Expected: the new case FAILS — `labels` is `[]`, because `run` does not consult
`progress` yet. Other cases in the file still pass: `run` calls
`deps.presenter.starting()`, which the fake no longer has, but that TypeError is
caught by the generic handler in some paths. **If any previously passing case
now reports `failed:catalog-unavailable`, that is the same cause and step 3
fixes it.**

- [ ] **Step 3: Narrow the port, wire the progress scope**

In `src/application/ports.ts`, the `Presenter` interface becomes (note
`ScaffoldPlan` is still used by `succeeded`, so the import stays):

```ts
export interface Presenter {
  installing(directory: string): void;
  /** `manager` is the one actually used, so next steps name the right tool. */
  succeeded(
    plan: ScaffoldPlan,
    installed: boolean,
    manager?: PackageManager,
  ): void;
  warn(message: string): void;
  failed(error: TryNestError): void;
}
```

In `src/adapters/cli/presenter.ts`, delete the `starting` and `scaffolding`
members from the returned object (lines 48-53), leaving `installing` first.
Their text moves to the `progress.while` call sites. Keep every import:
`ScaffoldPlan` is still referenced by `succeeded`.

`tests/adapters/cli/presenter.spec.ts` has no cases for either method — nothing
to delete there, despite the spec's test plan listing it. The only presenter
spec work is Task 1's.

In `src/adapters/cli/run.ts`:

```ts
// with the other adapter imports
import { type Progress, createProgress } from "./progress.ts";
```

```ts
export interface RunDependencies {
  readonly catalog: SampleCatalogSource;
  readonly metadata: SampleMetadataSource;
  readonly archive: SampleArchiveSource;
  readonly writer: WorkspaceWriter;
  readonly probe: TargetDirectoryProbe;
  readonly runner: PackageManagerRunner;
  readonly interaction: Interaction;
  readonly presenter: Presenter;
  readonly progress: Progress;
  readonly stdout: { write(chunk: string): void };
}
```

```ts
export function createRunDependencies(): RunDependencies {
  return {
    catalog: createTreeCatalogSource(),
    metadata: createRawMetadataSource(),
    archive: createCodeloadArchiveSource(),
    writer: createWorkspaceWriter(),
    probe: createTargetDirectoryProbe(),
    runner: createPackageManagerRunner(),
    interaction: createPrompts(),
    presenter: createPresenter(),
    progress: createProgress(),
    stdout: { write: (chunk: string) => void process.stdout.write(chunk) },
  };
}
```

Then the three scopes. Replace lines 111-114:

```ts
    // Start the catalog request before anything is drawn (ADR-0005); `while`
    // takes a thunk so it adopts the promise already in flight.
    const catalogPromise = listSamples(deps.catalog);
    const samples = await deps.progress.while(
      "Fetching the available NestJS samples…",
      () => catalogPromise,
    );
```

Replace the enrichment block (lines 129-143) — the `finally` that aborts the
enrichment stays outside the scope, so the deadline still bounds only the wait:

```ts
    try {
      enriched = await deps.progress.while(
        "Looking up sample descriptions…",
        () =>
          withDeadline(
            describeSamples(samples, deps.metadata, {
              signal: enrichment.signal,
            }),
            ENRICHMENT_DEADLINE_MS,
            samples,
          ),
      );
    } finally {
      // The deadline bounds how long we wait, not how long the requests run.
      // Without this, one request per sample outlives the whole command, and a
      // stalled metadata host leaves the user staring at a dead terminal after
      // we already told them we were done.
      enrichment.abort();
    }
```

Replace lines 159-161:

```ts
    const plan = planScaffold(sample, directory);
    await deps.progress.while(
      `Scaffolding ${plan.sample.id} into ${plan.targetDirectory}…`,
      () => scaffoldSample(plan, deps.archive, deps.writer),
    );
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test && npm run typecheck`

Expected: every case passes, including the new label case.

- [ ] **Step 5: Record that the Presenter no longer reports progress**

`docs/architecture.md:68` — replace:

```
| Presenter | Report progress, results and failures. |
```

with:

```
| Presenter | Report results and failures. |
```

- [ ] **Step 6: Commit**

```bash
npm run lint && npm run format
git add src/application/ports.ts src/adapters/cli/presenter.ts src/adapters/cli/run.ts tests/adapters/cli/run.spec.ts docs/architecture.md
git commit -m "$(cat <<'MSG'
feat: animate the steps that wait on the network and the disk

Fetching the catalog, looking up descriptions and scaffolding now run inside a
progress scope instead of printing a line and leaving the terminal still. The
scope subsumes the presenter's two transient methods, so `starting` and
`scaffolding` leave the port: reporting progress is not a port's job when the
composition root is its only caller.

Installing keeps no spinner on purpose — package managers draw their own
output, and two things animating over one another is worse than neither.

Claude-Session: https://claude.ai/code/session_019g6UcJUKkQUZh8fnLrm6yH
Co-Authored-By: Claude Code (claude-opus-5) <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 7: Write the failing test for the prompt order**

Add to `tests/adapters/cli/run.spec.ts` a new describe block. One event log, fed
by both the fake `Interaction` and the fake `WorkspaceWriter`, is what pins the
order:

```ts
const interactive = { interactive: true, version: "0.0.0-test" };

describe("run in a terminal", () => {
  it("asks every question before it writes anything", async () => {
    const events: string[] = [];
    const { deps } = depsWith({
      interaction: {
        chooseSample: async (samples) => {
          events.push("chooseSample");
          return samples[0] as never;
        },
        chooseTargetDirectory: async (suggested) => {
          events.push("chooseTargetDirectory");
          return suggested;
        },
        confirmInstall: async () => {
          events.push("confirmInstall");
          return true;
        },
        choosePackageManager: async () => {
          events.push("choosePackageManager");
          return "npm";
        },
      },
      runner: { detect: async () => ["npm", "pnpm"], install: async () => {} },
      writer: { materialize: async () => void events.push("materialize") },
    });

    const code = await run([], deps, interactive);

    expect(code).toBe(0);
    expect(events).toEqual([
      "chooseSample",
      "chooseTargetDirectory",
      "confirmInstall",
      "choosePackageManager",
      "materialize",
    ]);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest --config ./vitest.config.ts run tests/adapters/cli/run.spec.ts -t "asks every question"`

Expected: FAIL, with `materialize` appearing *before* `confirmInstall` and
`choosePackageManager`. This is behaviour change under test, not a refactor:
`docs/cli-ux.md` has always prescribed this order and the code diverged.

- [ ] **Step 9: Move the install questions ahead of the scaffold**

In `src/adapters/cli/run.ts`, replace everything from `const plan =
planScaffold(...)` through `deps.presenter.succeeded(...)` with:

```ts
    // Every question is asked before the first write, so a cancelled run can
    // always say "Nothing was written." without knowing how far it got.
    const wantsInstall =
      inputs.install ??
      (inputs.yes || !env.interactive
        ? true
        : await deps.interaction.confirmInstall());

    let manager: PackageManager | undefined;

    if (wantsInstall) {
      const available = await deps.runner.detect();
      manager =
        inputs.packageManager ??
        (available.length <= 1 || inputs.yes || !env.interactive
          ? (available[0] ?? "npm")
          : await deps.interaction.choosePackageManager(available));
    }

    const plan = planScaffold(sample, directory);
    await deps.progress.while(
      `Scaffolding ${plan.sample.id} into ${plan.targetDirectory}…`,
      () => scaffoldSample(plan, deps.archive, deps.writer),
    );

    let installed = false;

    if (manager !== undefined) {
      for (const unit of plan.installUnits) {
        deps.presenter.installing(
          unit === "."
            ? plan.targetDirectory
            : `${plan.targetDirectory}/${unit}`,
        );
      }

      const outcome = await installDependencies(plan, deps.runner, manager);
      installed = outcome.failures.length === 0;

      for (const failure of outcome.failures) {
        deps.presenter.warn(
          `Dependency install failed in ${failure.directory} (${failure.reason}). Your project is intact — run the install again there.`,
        );
      }
    }

    deps.presenter.succeeded(plan, installed, manager);
    return 0;
```

`usedManager` is gone: `manager` now carries the same meaning and is set before
the scaffold, so `succeeded` is unchanged. `manager !== undefined` is exactly
`wantsInstall` — assigning it is the last thing the `if (wantsInstall)` block
does — and it is what narrows the type for `installDependencies`.

- [ ] **Step 10: Run the whole suite**

Run: `npm test && npm run typecheck`

Expected: everything passes. Two existing guarantees to confirm by eye in the
output: `"still succeeds when the install fails, and warns instead"` and the
four `run without a terminal` cases, which still exit 2 because the
non-interactive guard runs before any of this.

- [ ] **Step 11: Pin the end-to-end cancellation**

Add to the `describe("run in a terminal", …)` block:

```ts
  it("writes nothing and exits 130 when a question is abandoned", async () => {
    const writes: string[] = [];
    const { deps, lines } = depsWith({
      interaction: {
        chooseSample: async (samples) => samples[0] as never,
        chooseTargetDirectory: async (suggested) => suggested,
        confirmInstall: async () => {
          throw new TryNestError("cancelled", "Cancelled. Nothing was written.");
        },
        choosePackageManager: async () => "npm",
      },
      writer: { materialize: async () => void writes.push("materialize") },
    });

    const code = await run([], deps, interactive);

    expect(code).toBe(130);
    expect(writes).toEqual([]);
    expect(lines).toContain("failed:cancelled");
  });
```

- [ ] **Step 12: Pin it for Ctrl+C too**

Add, in the same block — a `cancelled` error is what `prompts.ts` produces for
both keys, so what this pins is that `run` treats them identically and that the
generic relabelling branch is unreachable:

```ts
  it("does not relabel a cancellation as a broken world", async () => {
    const { deps, lines } = depsWith({
      interaction: {
        chooseSample: async () => {
          // What createPrompts() rejects with for Ctrl+C as well as for Esc.
          throw new TryNestError("cancelled", "Cancelled. Nothing was written.");
        },
        chooseTargetDirectory: async (suggested) => suggested,
        confirmInstall: async () => false,
        choosePackageManager: async () => "npm",
      },
    });

    const code = await run([], deps, interactive);

    expect(code).toBe(130);
    expect(lines).not.toContain("failed:catalog-unavailable");
  });
```

- [ ] **Step 13: Run the suite**

Run: `npm test && npm run typecheck`

Expected: both new cases pass. Both would have failed before step 9 — the first
because `materialize` ran before `confirmInstall`, and both because `cancelled`
did not exist before Task 1.

- [ ] **Step 14: Commit**

```bash
npm run lint && npm run format
git add src/adapters/cli/run.ts tests/adapters/cli/run.spec.ts
git commit -m "$(cat <<'MSG'
fix: ask every question before the first write

cli-ux.md has always put the install questions before the scaffold; the
implementation asked them after it, so a run abandoned at either of the last
two prompts would have been told "Nothing was written." about a project that
was already on disk. Telling someone their work is gone when it is intact is
the failure cli-ux.md already names.

With all four questions ahead of the first write, cancellation needs no
stage-awareness. The chosen manager is known before the scaffold, so nothing
about the final instructions changes, and `detect()` still runs only when an
install is actually wanted.

Note: `assertTargetDirectoryUsable` already ran before the install questions, so
do not claim the reorder moved it. What moves is the write.

Claude-Session: https://claude.ai/code/session_019g6UcJUKkQUZh8fnLrm6yH
Co-Authored-By: Claude Code (claude-opus-5) <noreply@anthropic.com>
MSG
)"
```

---

## Verification before completion

- [ ] `npm test` — every spec, offline. The drift sentinel stays skipped.
- [ ] `npm run typecheck`
- [ ] `npm run lint && npm run format` — clean, or committed if they rewrote anything.
- [ ] `npm run build` — `tsc` to `lib/`, since the spec adds a file the build
      must emit.
- [ ] **By hand, in a real terminal** — the two things no offline test can see:

  ```sh
  npm run build && node ./lib/bin/try-nest.cli.js
  ```

  - The spinner animates on `Fetching the available NestJS samples…` and leaves
    no debris behind when the picker replaces it.
  - Esc at the picker prints `Cancelled. Nothing was written.` and nothing else;
    `echo $?` reports `130`; the shell prompt is not left in raw mode.
  - Esc at each of the other three questions does the same, and no directory was
    created.
  - `node ./lib/bin/try-nest.cli.js --list --json | cat` puts JSON on stdout with
    no escape sequences, and the labels on stderr as plain lines.
