/**
 * A stand-in for `@yourtal/media`'s `mintSegmentUrl` (5.1.d).
 *
 * `packages/media/src/signed-segment-url.ts` already exists — HMAC-signed,
 * session-bound, exactly what nginx's `auth_request` (2.1.c) verifies — but
 * `packages/media/package.json` does not export it yet (only `./hls-origin`
 * and `./publish-fixture` are public), and that package is area C's (7.2.c).
 * TASKS.md 5.1.d says to call a LOCAL stub with the same call shape in the
 * meantime rather than reimplement nginx's HMAC scheme a second time, which
 * would only give the two a chance to drift.
 *
 * This returns an UNSIGNED url. nginx's `auth_request` will refuse it in
 * any environment where the signed-HLS vhost is actually enforcing —
 * exactly as it should, since this is not yet the real signing path. It
 * exists so `WatchController.start` has a `manifestUrl` field to return at
 * all, wired to the real export the moment 7.2.c makes one. See the
 * `(requested by B)` subtask under 7.2.c in TASKS.md.
 *
 * Delete this file once `@yourtal/media` exports `mintSegmentUrl` and
 * `WatchModule` can call that instead.
 */
export interface StubSegmentUrlInput {
  readonly baseUrl: string;
  readonly sessionId: string;
  readonly assetId: string;
}

export function stubSegmentUrl(input: StubSegmentUrlInput): string {
  const base = input.baseUrl.replace(/\/+$/, "");
  // No `session=` query param, deliberately — an unsigned identity in the
  // URL is worse than none at all (`signed-segment-url.ts`'s own header
  // makes this argument), so this stub carries no session claim, signed or
  // otherwise, rather than a fake one someone might mistake for real.
  return `${base}/${input.assetId}/index.m3u8`;
}
