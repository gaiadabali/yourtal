import { randomUUID } from "node:crypto";

/**
 * A tiny HTTP client for the demo-activity driver: it talks to the real api
 * exactly as the web app does (session cookie, idempotency keys), never to the
 * database, so every row history writes comes from the same code users hit.
 */
export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export class DemoApi {
  constructor(
    private readonly baseUrl: string,
    private readonly headers: Readonly<Record<string, string>> = {},
  ) {}

  withSession(token: string): DemoApi {
    return new DemoApi(this.baseUrl, { ...this.headers, cookie: `yt_session=${token}` });
  }

  withDevice(deviceId: string, credential: string): DemoApi {
    return new DemoApi(this.baseUrl, {
      "x-yt-device-id": deviceId,
      authorization: `Bearer ${credential}`,
    });
  }

  async get(path: string): Promise<ApiResponse> {
    return this.send("GET", path, undefined);
  }

  /** Every POST carries a fresh idempotency key; routes that do not need one ignore it. */
  async post(path: string, body: unknown = {}): Promise<ApiResponse> {
    return this.send("POST", path, body);
  }

  async put(path: string, body: unknown): Promise<ApiResponse> {
    return this.send("PUT", path, body);
  }

  private async send(method: string, path: string, body: unknown): Promise<ApiResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.headers,
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "idempotency-key": randomUUID() }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      // Not JSON; the raw text is the useful part of the error.
    }
    return { status: response.status, body: parsed };
  }
}

/** Reads `body.a.b` without trusting the shape. */
export function field(body: unknown, ...path: string[]): unknown {
  let node = body;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function ok(response: ApiResponse, what: string): unknown {
  if (response.status >= 400) {
    throw new Error(`${what}: HTTP ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sessions = new Map<string, { api: DemoApi; userId: string }>();

/**
 * One login per demo account per run (the login route allows 30 per 15 min per
 * address), and a 429 is waited out rather than failed.
 */
export async function loginAs(
  base: DemoApi,
  email: string,
  password: string,
): Promise<{ api: DemoApi; userId: string }> {
  const cached = sessions.get(email);
  if (cached !== undefined) return cached;
  for (;;) {
    const response = await base.post("/api/auth/login", { email, password });
    if (response.status === 429) {
      await sleep((Number(field(response.body, "retryAfterSeconds")) || 60) * 1000);
      continue;
    }
    const body = ok(response, `login ${email}`);
    const session = {
      api: base.withSession(String(field(body, "token"))),
      userId: String(field(body, "userId")),
    };
    sessions.set(email, session);
    return session;
  }
}

/** A reset retires accounts, so their sessions go with them. */
export function forgetSessions(): void {
  sessions.clear();
}
