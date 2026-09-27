export type SampleLayout = "single" | "composite";

export interface Sample {
  /** Path beneath the samples root, e.g. "01-cats-app". The only identifier we expose. */
  readonly id: string;
  /** What the picker shows. Derived from the id — we never invent names. */
  readonly displayName: string;
  readonly layout: SampleLayout;
  /** Relative sub-project paths for a composite; empty for a single. */
  readonly subProjects: readonly string[];
  /** Resolved from upstream, often absent. Never required for anything to work. */
  readonly description?: string;
}

export function isComposite(sample: Sample): boolean {
  return sample.layout === "composite";
}
