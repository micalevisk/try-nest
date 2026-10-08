# CLI experience

This describes the tool from the outside: what a user goes through, what they can
automate, and what they see when things fail. It specifies behaviour and
obligations, not flag spelling or output formatting — those live in the source and
in `--help`.

Remember that the CLI is an **adapter** ([architecture.md](./architecture.md)).
Everything here is one possible front end over use cases that know nothing about
terminals.

## The guiding shape

> Someone who has never used this tool should get from `npx try-nest` to a running
> sample without reading anything, and someone automating it should never see a
> prompt.

Those are the same flow. Prompts fill in what was not supplied; they are not a
separate mode.

## The interactive path

1. **Start.** Retrieval of the sample list begins immediately, before anything is
   drawn, and runs alongside whatever comes next.
2. **Pick a sample.** The list renders as soon as the catalog resolves.
   Descriptions arrive afterwards, in the background, and fill in progressively —
   the list is never held back waiting for them.
3. **Name a target directory.** Defaulted from the chosen sample. Rejected if it
   exists and is not empty; the tool never merges into existing content.
4. **Choose whether to install, and with which package manager.** The default
   offered should reflect what the user appears to have available.
5. **Scaffold.** Only the chosen sample's subtree is written, re-rooted at the
   target directory.
6. **Install**, if asked. For a composite sample, once per sub-project.
7. **Next steps.** How to enter the directory and start it, plus a link to the
   sample upstream.

**Any question can be abandoned.** Esc, like Ctrl+C, ends the run from any
prompt. Every question is asked before anything is written, so this is always
true and always says so: nothing was written, and there is nothing to clean up.

### Obligations of the picker

- It must render from names alone. Waiting on descriptions to draw the list would
  trade the tool's responsiveness for a cosmetic gain.
- It must accept late-arriving descriptions without disturbing the user's
  position in the list.
- It must handle a description that never arrives — that is a normal outcome, not
  an error state.
- Composite samples should be visibly distinguishable, since choosing one produces
  several projects rather than one.
- Each row must carry its own description, not only the highlighted one. A user
  comparing samples should not have to move the cursor to read them
  ([ADR-0006](./adr/0006-upstream-only-sample-metadata.md)).
- A composite pays for being distinguishable: its row carries the project count
  as well as its id, so it overruns the id column the other rows are aligned to
  and has fewer columns left for a description than a single sample does. At 60
  columns the singles are annotated and the two composites are not. Nothing
  breaks — identity still wins over description — but the two are not annotated
  at the same terminal width.
- A description may be clipped to fit the terminal; a sample's identity may not.
  The full text must stay reachable for whichever row the user is on.
- When the terminal is too narrow for a description to be worth anything, the
  picker drops descriptions and renders names alone. A mangled row is worse than
  an unannotated one.

In a terminal, this merge is bounded rather than continuous: a `select` prompt
cannot redraw its choices once open, so the CLI adapter waits on enrichment
against a short deadline and renders whatever has arrived instead of
continuing to merge afterwards ([architecture.md](./architecture.md)). The
obligation above still holds — the picker is never blocked — only how
descriptions catch up to it differs from the ideal.

## The scriptable path

**Every prompt has a non-interactive equivalent.** When all required inputs are
supplied, the tool runs start to finish without asking anything.

The inputs are exactly the prompts above: which sample, where to put it, whether
to install, which package manager. Plus the usual conveniences — assume-yes for
defaults, suppress non-essential output, print the catalog and exit.

Two rules that matter more than the spelling:

- **A missing required input in a non-interactive context is an error, not a
  prompt.** Detect the absence of a usable terminal and fail with a message naming
  what was missing. Blocking forever on a prompt nobody can answer is the worst
  available outcome in CI.
- **Sample identity is the upstream path** ([domain-model.md](./domain-model.md)).
  It is not translated or aliased, and it is not kept stable across upstream
  renames ([ADR-0002](./adr/0002-no-backward-compatibility.md)).

A machine-readable catalog listing is worth providing, so scripts can discover
sample identities without scraping human-formatted output.

## Failure, as the user sees it

Use cases report what went wrong; the presenter decides how it looks. Every
failure a user can hit should say **what happened, and what they can do about
it** — a stack trace is never an answer.

| What happened | What the user should be told |
|---|---|
| Catalog unreachable | The tool needs network access to list samples; retry |
| Rate limited | This is a quota, not an outage, and roughly when to retry |
| Catalog incomplete (truncated) | Refuse to continue — a partial list is worse than none ([upstream-contract.md](./upstream-contract.md)) |
| Named sample does not exist | That it is unknown, plus the closest matches |
| Target directory occupied | Which path, and that it must be empty or absent |
| Archive download failed | That scaffolding could not start; nothing was written |
| Extraction failed midway | **Which directory was left behind**, so the user can clear it |
| Install failed | That scaffolding succeeded — the code is there — and how to install manually |
| Description unavailable | Nothing. Silent, by design |

Two of these carry weight beyond their wording:

**Install failure is not scaffold failure.** By the time dependencies are being
installed, the user's project exists and is intact. Presenting a failed install as
a failed run would send them to delete work that is fine.

**Partial extraction must name the directory it left.** The tool aims not to leave
debris, but if it does, the user must not have to guess where it is.

## Output discipline

- Progress belongs on the error stream; machine-readable results on the standard
  stream. A script redirecting output should get data, not decoration.
- Respect the conventional environment signals for disabling colour, and degrade
  when not attached to a terminal.
- Exit codes distinguish success, user error (bad input, occupied directory), a
  run the user ended themselves at a prompt, and environmental failure (network,
  upstream). Scripts should be able to tell "I asked for the wrong thing" from
  "the world was broken", and someone who walked away from a question is
  neither.

## Deliberate non-features

- **No update or self-check nag.** Users are directed to run the latest version;
  a version check would spend a request on every run to say so.
- **No telemetry, and no analytics hooks of any kind.**
- **No editor or extension suggestions.**
- **No configuration file.** Everything is a flag or a prompt. A tool invoked
  through `npx` in a fresh directory has nowhere meaningful to read config from.
- **No caching of the catalog between runs** ([ADR-0005](./adr/0005-prefetch-without-cache.md)).
