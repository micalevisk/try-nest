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

describe("createProgress() defaults", () => {
  it("writes to stderr, not stdout, when called with no arguments", async () => {
    const originalTerm = process.env.TERM;
    process.env.TERM = "dumb";
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await createProgress().while("Fetching…", async () => "done");
      // Assert before restoring: mockRestore() also clears recorded calls.
      expect(stderrSpy).toHaveBeenCalledWith("Fetching…\n");
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
      if (originalTerm === undefined) delete process.env.TERM;
      else process.env.TERM = originalTerm;
    }
  });
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
