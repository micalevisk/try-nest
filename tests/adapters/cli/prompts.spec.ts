import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createPrompts,
  sampleChoices,
} from "../../../src/adapters/cli/prompts.ts";
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

function terminal(columns = 80): {
  prompts: Interaction;
  input: PassThrough;
  press: (keys: string, afterMs?: number) => void;
  rendered: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();

  // A PassThrough is neither a TTY nor raw-mode capable; inquirer's readline
  // requires both to render at all.
  Object.assign(input, { isTTY: true, setRawMode: () => input });
  Object.assign(output, { isTTY: true, columns, rows: 24 });

  const drawn: string[] = [];
  output.on("data", (chunk: Buffer | string) => void drawn.push(String(chunk)));
  output.resume();

  return {
    prompts: createPrompts({ input, output }),
    input,
    press: (keys: string, afterMs = 40) => {
      setTimeout(() => void input.write(keys), afterMs);
    },
    rendered: () => drawn.join(""),
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

  // The wiring, not the layout: sampleChoices is unit-tested at several
  // widths above, but only chooseSample knows where the width comes from. If
  // it stopped passing the stream's columns the picker would silently assume
  // 80 again and mangle exactly the narrow terminal that fallback exists for.
  it("sizes the rows from the output stream's columns, not a fixed 80", async () => {
    // Short enough that the row cannot wrap at either width, so the only way
    // it can go missing from the narrow render is the width being honoured.
    const annotated = [single("01-cats-app", "Cats")];
    const inline = "01-cats-app  Cats";

    const wide = terminal(80);
    wide.press(ENTER);
    await wide.prompts.chooseSample(annotated);

    const narrow = terminal(30);
    narrow.press(ENTER);
    await narrow.prompts.chooseSample(annotated);

    expect(wide.rendered()).toContain(inline);
    expect(narrow.rendered()).not.toContain(inline);
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

function single(id: string, description?: string): Sample {
  return {
    id,
    displayName: id,
    layout: "single",
    subProjects: [],
    ...(description === undefined ? {} : { description }),
  };
}

describe("sampleChoices", () => {
  it("puts the description inline, aligned past the widest id", () => {
    const [first, second] = sampleChoices(
      [single("01-cats-app", "A REST API over cats"), single("02-gateways")],
      80,
    );

    // Both ids are 11 wide, so the column is 11 and the gap is the two spaces.
    expect(first?.name).toBe("01-cats-app  A REST API over cats");
    expect(second?.name).toBe("02-gateways");
  });

  it("caps the id column at 24 so two long ids cannot eat the line", () => {
    const [, long] = sampleChoices(
      [
        single("01-cats-app", "Cats"),
        single(
          "32-graphql-federation-schema-first",
          "Federation, schema first",
        ),
      ],
      80,
    );

    // 34 characters wide: past the column, so a single space, not alignment.
    expect(long?.name).toBe(
      "32-graphql-federation-schema-first Federation, schema first",
    );
  });

  it("keeps a composite's project count on the name", () => {
    const [choice] = sampleChoices(
      [
        {
          id: "31-federation",
          displayName: "31-federation",
          layout: "composite",
          subProjects: ["gateway", "posts-application"],
          description: "Apollo Federation",
        },
      ],
      80,
    );

    expect(choice?.name).toContain("31-federation  (2 projects)");
    expect(choice?.name).toContain("Apollo Federation");
  });

  it("truncates an over-long description with an ellipsis", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "x".repeat(200))],
      60,
    );

    expect(choice?.name.length).toBeLessThanOrEqual(59);
    expect(choice?.name.endsWith("…")).toBe(true);
  });

  it("keeps the untruncated description for inquirer's footer", () => {
    const full = "x".repeat(200);
    const [choice] = sampleChoices([single("01-cats-app", full)], 60);

    expect(choice?.description).toBe(full);
  });

  it("drops inline descriptions rather than mangle a narrow terminal", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "A REST API over cats")],
      30,
    );

    expect(choice?.name).toBe("01-cats-app");
    expect(choice?.description).toBe("A REST API over cats");
  });

  // The spec's success criterion, with the id widths upstream actually has:
  // at 40 columns the id column is capped at 24, leaving too little for a
  // description, so no row wraps *because of* one.
  it("fits every row inside 40 columns with upstream's widest ids", () => {
    const choices = sampleChoices(
      [
        single("01-cats-app", "A REST API over cats"),
        single(
          "32-graphql-federation-schema-first",
          "Federation, schema first",
        ),
      ],
      40,
    );

    expect(choices.map((choice) => choice.name)).toEqual([
      "01-cats-app",
      "32-graphql-federation-schema-first",
    ]);
  });

  // Identity is never truncated, so an id wider than the whole terminal is
  // rendered in full and the arithmetic around it must not underflow.
  it("renders a terminal narrower than the id without wrapping or throwing", () => {
    const [choice] = sampleChoices(
      [single("32-graphql-federation-schema-first", "Federation")],
      10,
    );

    expect(choice?.name).toBe("32-graphql-federation-schema-first");
  });

  it("falls back to 80 columns when the stream reports none", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "A REST API over cats")],
      undefined,
    );

    expect(choice?.name).toBe("01-cats-app  A REST API over cats");
  });

  // Review Focus 2. One newline in a row corrupts inquirer's redraw for the
  // rest of the prompt, and manifest descriptions are free text.
  it("collapses whitespace so a multi-line description cannot break the redraw", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "  A REST API\nover\t cats  ")],
      80,
    );

    expect(choice?.name).toBe("01-cats-app  A REST API over cats");
    expect(choice?.description).toBe("A REST API over cats");
  });

  // A manifest description is free text fetched from the network, and an
  // escape byte is not whitespace, so collapsing /\s+/ alone would write it
  // into every visible row rather than only the highlighted row's footer.
  it("strips control characters so an escape sequence cannot reach a row", () => {
    const [choice] = sampleChoices(
      [single("01-cats-app", "A \u001b[31mREST\u001b[0m API\u0007 over cats")],
      80,
    );

    expect(choice?.name).not.toContain("\u001b");
    expect(choice?.name).not.toContain("\u0007");
  });

  // An empty catalog reaches the picker whenever upstream answers with a tree
  // this tool recognises nothing in; mapping over it must not invent a row.
  it("renders an empty catalog as no choices", () => {
    expect(sampleChoices([], 80)).toEqual([]);
  });
});
