"use server";

import * as z from "zod";
import { kybDocumentSchema, kybDocumentTypeSchema } from "@yourtal/contracts/business/kyb-document";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * KYB upload (13.3.b): the browser asks for a presigned PUT, sends the file
 * straight to object storage, then records it for ops review. The file never
 * passes through this server (a server action's body is capped at 1 MB).
 */
export type KybActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const uploadUrlSchema = z.object({
  storageRef: z.string().min(1),
  uploadUrl: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});
const contentTypeSchema = z.enum(["application/pdf", "image/jpeg", "image/png"]);

export async function createKybUploadUrlAction(
  businessId: string,
  contentType: string,
): Promise<KybActionResult<z.infer<typeof uploadUrlSchema>>> {
  const type = contentTypeSchema.safeParse(contentType);
  if (!type.success) return { ok: false, message: "unsupported_type" };
  const result = await apiFetch(
    `/api/${encodeURIComponent(businessId)}/business/kyb-documents/upload-url`,
    uploadUrlSchema,
    { method: "POST", body: { contentType: type.data } },
  );
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: "upload_failed" };
}

export async function submitKybDocumentAction(
  businessId: string,
  documentType: string,
  storageRef: string,
): Promise<KybActionResult<{ id: string }>> {
  const type = kybDocumentTypeSchema.safeParse(documentType);
  if (!type.success) return { ok: false, message: "upload_failed" };
  const result = await apiFetch(
    `/api/${encodeURIComponent(businessId)}/business/kyb-documents`,
    kybDocumentSchema,
    {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: { documentType: type.data, storageRef, expiresAt: null },
    },
  );
  return result.ok
    ? { ok: true, data: { id: result.data.id } }
    : { ok: false, message: "upload_failed" };
}
