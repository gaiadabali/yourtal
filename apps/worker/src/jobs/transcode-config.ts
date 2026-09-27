import { z } from "zod";

/**
 * `transcode.ts`'s own env, read directly rather than through the shared
 * `WorkerConfig` (`apps/worker/src/config.ts`, a different session's file in
 * this phase split, TASKS.md 7.2 — same reasoning
 * `apps/api/src/modules/studio/media/media-service-config.ts` gives for not
 * extending the central `AppConfig` either). One file, one schema, same
 * convention `apps/worker/src/config.ts` itself uses for the whole app.
 *
 * `STUDIO_MEDIA_SERVICE_SECRET`'s default MUST match
 * `media-service-config.ts`'s — this is the shared secret both ends sign
 * and verify with.
 */
const envSchema = z.object({
  STUDIO_MEDIA_SERVICE_SECRET: z
    .string()
    .min(1)
    .default("local-only-studio-media-service-secret-not-real-32b"),
  /** The api process THIS worker's ready-callback reaches. No universal default: every phase slot runs its own api on its own port (infra/PORTS.md). */
  STUDIO_MEDIA_API_BASE_URL: z.url().default("http://127.0.0.1:3001"),
});

export interface TranscodeConfig {
  readonly serviceSecret: string;
  readonly apiBaseUrl: string;
}

export function loadTranscodeConfig(source: NodeJS.ProcessEnv = process.env): TranscodeConfig {
  const env = envSchema.parse(source);
  return {
    serviceSecret: env.STUDIO_MEDIA_SERVICE_SECRET,
    apiBaseUrl: env.STUDIO_MEDIA_API_BASE_URL,
  };
}
