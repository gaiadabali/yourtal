import { apiFetch } from "@/lib/api/api-fetch";
import { devInboxResponseSchema } from "@/lib/api/dev-inbox-schema";
import type { DevInboxResponse } from "@/lib/api/dev-inbox-schema";

/**
 * `/dev/inbox` (1.6.b) — a plain page over `GET /api/dev/inbox`, read fresh
 * on every load so a reviewer sees the email that arrived a second ago.
 *
 * 5.13.b: read through `apiFetch`, so it reaches the API at `API_INTERNAL_URL`
 * and forwards the viewer's own session. On staging the API shows a viewer
 * only their own mail (staff see everyone's) and refuses a signed-out one;
 * in production it 404s, which this page shows rather than hides.
 */
export default async function DevInboxPage() {
  const result = await apiFetch("/api/dev/inbox", devInboxResponseSchema);

  return (
    <main style={{ padding: "1.5rem", fontFamily: "monospace", maxWidth: "60rem" }}>
      <h1>Dev inbox</h1>
      <p>
        Simulated emails, push and webhook messages, newest first. Only on dev and staging, never in
        production.
      </p>
      {result.ok ? (
        <Inbox data={result.data} />
      ) : result.error.kind === "http" && result.error.status === 401 ? (
        <p data-testid="inbox-signed-out" role="status">
          Sign in to see your own emails. <a href="/login?returnTo=%2Fdev%2Finbox">Sign in</a>
        </p>
      ) : (
        <p role="alert" className="text-danger-solid">
          {result.error.kind === "http"
            ? `GET /api/dev/inbox returned ${String(result.error.status)}`
            : `could not read the inbox: ${result.error.message}`}
        </p>
      )}
    </main>
  );
}

function Inbox({ data }: { data: DevInboxResponse }) {
  return (
    <>
      <p data-testid="inbox-whose">{whoseMessages(data)}</p>
      {data.entries.length === 0 ? (
        <p>Nothing sent yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.entries.map((entry) => (
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
                <pre className="whitespace-pre-wrap text-fg-muted">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function whoseMessages(data: DevInboxResponse): string {
  switch (data.access) {
    case "open":
      return "Everyone's messages. This is a local dev run, so no sign-in is needed.";
    case "staff":
      return `Signed in as ${data.viewerEmail ?? "staff"}. You are staff, so you see everyone's messages.`;
    case "own":
      return data.viewerEmail === null
        ? "Your account has no sign-in email, so there are no messages to show."
        : `Signed in as ${data.viewerEmail}. These are the messages sent to you.`;
  }
}
