/**
 * 11.2.b: the anonymous Open Viewing session, called directly from the
 * BROWSER — never through a Server Action. `apps/web/lib/api/api-fetch.ts`
 * is `"server-only"` and every existing watch flow (`watch-player-actions.ts`)
 * proxies through the Next.js server, which is right for a session-cookie
 * read but wrong here: the F12 per-IP cap needs the VISITOR's real IP, and
 * a server-to-server hop would replace it with the Next.js server's own
 * (see `next.config.ts`'s dev rewrite for this route, and
 * `infra/helios/nginx/yourtal.gaiada.com.conf`'s `/api/` block for how
 * staging/production preserve it). A same-origin relative fetch keeps this
 * one request off the Next.js server entirely.
 */

export type StartOpenViewSessionResult =
  | { ok: true; sessionId: string; manifestUrl: string; durationSeconds: number }
  | { ok: false; status: number; message: string | null };

export async function startOpenViewSession(campaignId: string): Promise<StartOpenViewSessionResult> {
  try {
    const response = await fetch("/api/watch/open-view-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    if (!response.ok) {
      // Best-effort only — used to pick which denial copy to show (daily
      // cap vs. one-concurrent-session), never to decide access. A body
      // that fails to parse just falls back to a generic message.
      const message = await response
        .json()
        .then((body: unknown) =>
          typeof body === "object" && body !== null && "message" in body
            ? String(body.message)
            : null,
        )
        .catch(() => null);
      return { ok: false, status: response.status, message };
    }
    const body = (await response.json()) as {
      sessionId: string;
      manifestUrl: string;
      durationSeconds: number;
    };
    return {
      ok: true,
      sessionId: body.sessionId,
      manifestUrl: body.manifestUrl,
      durationSeconds: body.durationSeconds,
    };
  } catch {
    return { ok: false, status: 0, message: null };
  }
}

/** Best-effort — a dropped progress report loses nothing claimable (there is nothing to claim). */
export function reportOpenViewProgress(
  sessionId: string,
  campaignId: string,
  fromSeconds: number,
  toSeconds: number,
): void {
  if (toSeconds <= fromSeconds) return;
  void fetch(`/api/watch/open-view-sessions/${sessionId}/progress`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, fromSeconds, toSeconds }),
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry for the F12 cap and 11.2.d's open-views metric
    // — never blocks or interrupts anonymous playback.
  });
}
