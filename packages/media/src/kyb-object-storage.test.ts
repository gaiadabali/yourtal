import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKybObjectStorage, resolveKybObjectStorageConfig } from "./kyb-object-storage";

/**
 * Against the real RustFS from `pnpm dev:up` (YT-0521's origin) — fails
 * rather than skips when it is down, matching `hls-origin.test.ts` and
 * `packages/db`'s own real-Postgres-or-fail discipline. A presigned URL is
 * only proven by actually PUTting through it with plain `fetch`, no SDK,
 * exactly what a browser does — asserting through the S3 client's own
 * PutObjectCommand would prove the SDK works, not that the signature this
 * module hands a client is one RustFS accepts.
 */
function storage() {
  return createKybObjectStorage(resolveKybObjectStorageConfig());
}

describe("createKybObjectStorage", () => {
  it("mints a presigned PUT that a plain fetch can actually upload through, and exists() then sees it", async () => {
    const kyb = storage();
    const { storageRef, uploadUrl } = await kyb.createUploadUrl({
      businessId: randomUUID(),
      contentType: "application/pdf",
    });

    expect(await kyb.exists(storageRef)).toBe(false);

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: "%PDF-1.4 fixture bytes",
    });
    expect(put.ok, `PUT to the presigned URL failed: ${String(put.status)}`).toBe(true);

    expect(await kyb.exists(storageRef)).toBe(true);
  });

  it("reports a storageRef nothing was ever uploaded to as not existing", async () => {
    const kyb = storage();
    expect(await kyb.exists(`kyb/${randomUUID()}/${randomUUID()}`)).toBe(false);
  });
});
