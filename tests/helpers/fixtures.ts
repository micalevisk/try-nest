export interface StubResponseInit {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/** Minimal stand-in for a fetch Response, enough for the adapters under test. */
export function stubResponse(init: StubResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  const body = init.body === undefined ? "" : JSON.stringify(init.body);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

/** A recorded shape of the recursive git tree response, trimmed to what we read. */
export const treeResponseFixture = {
  sha: "abc123",
  truncated: false,
  tree: [
    { path: "package.json", type: "blob" },
    { path: "packages/core/package.json", type: "blob" },
    { path: "sample", type: "tree" },
    { path: "sample/01-cats-app", type: "tree" },
    { path: "sample/01-cats-app/package.json", type: "blob" },
    { path: "sample/01-cats-app/src/main.ts", type: "blob" },
    { path: "sample/31-graphql-federation-code-first", type: "tree" },
    {
      path: "sample/31-graphql-federation-code-first/gateway/package.json",
      type: "blob",
    },
  ],
};
