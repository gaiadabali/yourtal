import { apiFetch } from "@/lib/api/api-fetch";
import { meResponseSchema } from "@/lib/api/me-schema";

/**
 * `/dev/whoami` (1.7.e's Check) — a Server Component proving `apiFetch`
 * (1.7.a) works end to end: a real `GET /api/me` round trip, through the
 * `yt_session` cookie `loginAction` (1.7.b) set, rendering the signed-in
 * account's own `displayName`. Plain like `/dev/inbox` — a reviewer's tool,
 * not a shipped page (that page is B's Me screen, `features/me/**`).
 */
export default async function DevWhoamiPage() {
  const result = await apiFetch("/api/me", meResponseSchema);

  return (
    <main style={{ padding: "1.5rem", fontFamily: "monospace", maxWidth: "30rem" }}>
      <h1>Dev whoami</h1>
      {result.ok ? (
        <p data-testid="whoami-name">Signed in as: {result.data.profile.displayName}</p>
      ) : (
        <p data-testid="whoami-anonymous" role="status">
          Not signed in ({result.error.kind}).
        </p>
      )}
    </main>
  );
}
