/** A recording `fetch` for the Stripe driver tests: every call is kept, every answer is scripted. Test-only. */

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

export interface ScriptedAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly calls: RecordedCall[];
}

/** Answers in order; the last answer repeats. */
export function recordingFetch(...answers: readonly ScriptedAnswer[]): RecordingFetch {
  const calls: RecordedCall[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      headers: { ...headers },
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? {
      status: 200,
      body: {},
    };
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
  };
  return { fetch: impl, calls };
}

/** A body as decoded `key=value` lines, in the order sent. */
export function formLines(body: string | undefined): string[] {
  if (body === undefined || body === "") return [];
  return body.split("&").map((pair) => decodeURIComponent(pair));
}

export const TEST_KEY = "sk_test_fetch_double_key";
export const TEST_BASE = "http://127.0.0.1:26301/api/paysim";
