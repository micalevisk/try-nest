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
  | "input-required";

export class TryNestError extends Error {
  readonly kind: FailureKind;
  readonly details: Readonly<Record<string, string>>;

  constructor(
    kind: FailureKind,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "TryNestError";
    this.kind = kind;
    this.details = details;
  }
}

export function isTryNestError(error: unknown): error is TryNestError {
  return error instanceof TryNestError;
}
