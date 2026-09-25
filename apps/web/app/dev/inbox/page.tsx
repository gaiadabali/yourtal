/**
 * `/dev/inbox` (1.6.b) — a plain page over `GET /api/dev/inbox`. Reads
 * `platform.sim_outbox` fresh on every load (`cache: "no-store"`): a
 * reviewer who just registered needs to see the verification email that
 * arrived a second ago, not a cached response from before it existed.
 *
 * Deliberately not built against any BFF client library — 1.7 (the web/API
 * plumbing every other page will use) is a separate, later task; this is a
 * direct server-side fetch to `apps/api`, matching "plain" in this task's
 * own name.
 */

interface DevInboxEntry {
  readonly id: string;
  readonly boundary: "email" | "push" | "webhook";
  readonly region: "AU" | "ID";
  readonly recipient: string;
  readonly category: string;
  readonly subject?: string;
  readonly body: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

interface DevInboxResponse {
  readonly entries: readonly DevInboxEntry[];
}

// Both `apps/web` and `apps/api` load the SAME root `.env` (0.2.b) — `PORT`
// is `apps/api`'s own listen port there, not a web-side variable, which is
// why this reads it directly rather than inventing a second one to say the
// same thing.
function apiBaseUrl(): string {
  return process.env["API_BASE_URL"] ?? `http://127.0.0.1:${process.env["PORT"] ?? "3001"}`;
}

async function fetchInbox(): Promise<DevInboxResponse | { error: string }> {
  try {
    const response = await fetch(`${apiBaseUrl()}/api/dev/inbox`, { cache: "no-store" });
    if (!response.ok) {
      return { error: `GET /api/dev/inbox returned ${String(response.status)}` };
    }
    return (await response.json()) as DevInboxResponse;
  } catch (cause) {
    return { error: `could not reach the API: ${String(cause)}` };
  }
}

export default async function DevInboxPage() {
  const result = await fetchInbox();

  return (
    <main style={{ padding: "1.5rem", fontFamily: "monospace", maxWidth: "60rem" }}>
      <h1>Dev inbox</h1>
      <p>
        Every simulated email, push and webhook message (<code>platform.sim_outbox</code>), newest
        first. Enabled only while <code>APP_ENV</code> is <code>dev</code> or <code>staging</code>.
      </p>
      {"error" in result ? (
        <p role="alert" style={{ color: "crimson" }}>
          {result.error}
        </p>
      ) : result.entries.length === 0 ? (
        <p>Nothing sent yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {result.entries.map((entry) => (
            <li
              key={entry.id}
              style={{
                border: "1px solid #ccc",
                borderRadius: "0.5rem",
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div>
                <strong>{entry.boundary}</strong> · {entry.category} · {entry.region} ·{" "}
                {new Date(entry.createdAt).toLocaleString()}
              </div>
              <div>To: {entry.recipient}</div>
              {entry.subject === undefined ? null : <div>Subject: {entry.subject}</div>}
              <pre style={{ whiteSpace: "pre-wrap" }}>{entry.body}</pre>
              {Object.keys(entry.metadata).length > 0 ? (
                <pre style={{ whiteSpace: "pre-wrap", color: "#555" }}>
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
