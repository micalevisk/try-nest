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
