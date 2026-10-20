/** A `fetch` for the Stripe driver in unit tests: answers by method and path, and records each call. */
export interface StripeCall {
  readonly method: string;
  readonly path: string;
  readonly body: URLSearchParams;
  readonly idempotencyKey: string | undefined;
}

export function stripeRouteFetch(routes: Record<string, unknown | (() => unknown)>): {
  readonly fetch: typeof fetch;
  readonly calls: StripeCall[];
} {
  const calls: StripeCall[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const path = url.pathname.replace(/^.*\/v1\//, "/v1/");
    calls.push({
      method,
      path,
      body: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
      idempotencyKey: headers["Idempotency-Key"] ?? headers["idempotency-key"],
    });
    const route = routes[`${method} ${path}`];
    if (route === undefined) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing" } }),
          {
            status: 404,
          },
        ),
      );
    }
    const body = typeof route === "function" ? (route as () => unknown)() : route;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { fetch: impl, calls };
}
