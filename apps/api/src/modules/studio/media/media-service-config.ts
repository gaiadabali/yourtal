/**
 * `STUDIO_MEDIA_SERVICE_SECRET`, read directly rather than through the
 * central `AppConfig` (`apps/api/src/config/**`, a different session's files
 * in this phase split, TASKS.md 7.2). Same convention `packages/media`'s
 * `hls-origin.ts` already uses for `S3_*`: a module-local env read, with the
 * SAME dev default `apps/worker/src/jobs/transcode-config.ts` signs with, so
 * local dev needs no `.env` change. Staging sets a real value in
 * `/opt/yourtal/secrets/app.env` (2.1.d's convention) and this refuses the
 * default there, the same guard `loadAppConfig` applies to
 * `HLS_SIGNING_SECRET`.
 */
const DEV_DEFAULT_SECRET = "local-only-studio-media-service-secret-not-real-32b";

export function studioMediaServiceSecret(appEnv: string): string {
  const value = process.env["STUDIO_MEDIA_SERVICE_SECRET"] ?? DEV_DEFAULT_SECRET;
  if (appEnv === "staging" && value === DEV_DEFAULT_SECRET) {
    throw new Error(
      "STUDIO_MEDIA_SERVICE_SECRET is the local-only default; set a real one for staging.",
    );
  }
  return value;
}
