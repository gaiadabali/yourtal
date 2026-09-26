import { apiFetch } from "@/lib/api/api-fetch";
import { devClockJobsResponseSchema } from "@/lib/api/dev-clock-schema";
import { advanceDaysAction, releasePendingAction, runJobAction } from "@/lib/api/dev-clock-actions";

/**
 * `/dev/clock` (2.3.d) — a reviewer's own clock controls, same "plain,
 * zero-client-JS, `/dev/inbox`-style" convention as every other page under
 * `apps/web/app/dev/**`: three forms bound straight to the Server Actions in
 * `dev-clock-actions.ts`, each of which calls the real `/api/dev/clock/*`
 * route and redirects back here with `?result=`/`?error=` for this page to
 * render. Enabled only while `APP_ENV` is `dev` or `staging` — the API
 * itself refuses (404) in production; this page shows that refusal rather
 * than hiding it, the same way `/dev/whoami` shows "not signed in" rather
 * than a blank page.
 */
export default async function DevClockPage(props: PageProps<"/dev/clock">) {
  const searchParams = await props.searchParams;
  const resultParam = searchParams["result"];
  const errorParam = searchParams["error"];
  const resultRaw = Array.isArray(resultParam) ? resultParam[0] : resultParam;
  const errorCode = Array.isArray(errorParam) ? errorParam[0] : errorParam;

  const jobsResult = await apiFetch("/api/dev/clock/jobs", devClockJobsResponseSchema);

  return (
    <main style={{ padding: "1.5rem", fontFamily: "monospace", maxWidth: "40rem" }}>
      <h1>Dev clock</h1>
      <p>
        Time-based journeys for the signed-in reviewer's own account. Every action here is
        audited (<code>platform.dev_clock_audit</code>) and gated by <code>APP_ENV</code>, the
        same way <code>/dev/inbox</code> is.
      </p>

      {errorCode === undefined ? null : (
        <p role="alert" style={{ color: "crimson" }}>
          Failed: {errorCode}
        </p>
      )}
      {resultRaw === undefined ? null : (
        <pre style={{ background: "#f0f0f0", padding: "0.75rem" }}>{formatResult(resultRaw)}</pre>
      )}

      {jobsResult.ok ? null : (
        <p role="alert" style={{ color: "crimson" }}>
          Not signed in ({jobsResult.error.kind}). Sign in at <code>/dev/login</code> first.
        </p>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Release my pending points now</h2>
        <p>Moves every one of your own still-pending grants (unlock_at) to unlock immediately.</p>
        <form action={releasePendingAction}>
          <button type="submit">Release pending points</button>
        </form>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Advance my account by N days</h2>
        <p>
          Shifts your own still-pending grants&apos; unlock time N days earlier — the same field
          the ledger reads to decide what is available, so a big enough N makes a grant available
          immediately. Does not touch anyone else&apos;s account or a global clock.
        </p>
        <form
          action={advanceDaysAction}
          style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
        >
          <label>
            Days
            <input name="days" type="number" min={1} max={3650} defaultValue={7} required />
          </label>
          <button type="submit">Advance</button>
        </form>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Run a scheduled job now</h2>
        {jobsResult.ok ? (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {jobsResult.data.jobs.map((job) => (
              <li key={job.key} style={{ marginBottom: "0.5rem" }}>
                <strong>{job.label}</strong>
                {job.queue === undefined ? null : (
                  <span>
                    {" "}
                    ({job.queue}
                    {job.schedule === undefined ? "" : `, ${job.schedule}`})
                  </span>
                )}
                {job.built ? (
                  <form action={runJobAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
                    <input type="hidden" name="job" value={job.key} />
                    <button type="submit">Run now</button>
                  </form>
                ) : (
                  <span style={{ color: "#888" }}> — not yet built</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>Cannot list jobs while not signed in.</p>
        )}
      </section>
    </main>
  );
}

function formatResult(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}
