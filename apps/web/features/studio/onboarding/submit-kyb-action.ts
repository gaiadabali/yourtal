"use server";

import { redirect } from "next/navigation";

/**
 * KYB document submission (task 7.8.b). No live upload/review API exists
 * yet — the real presigned-MinIO upload is 7.1.b, and the ops review queue
 * that actually flips `Business.isVerified` is 9.3 (docs/tasks note "the
 * policy grant exists and nothing calls it yet" for `kyb_document` review).
 * This action is honest about that: it does not fake an instant verify, it
 * only acknowledges the submission. `document` (a `File`) is accepted and
 * discarded rather than stored anywhere, matching "everything external is
 * simulated" — there is nowhere real to put encrypted PII bytes yet.
 */
export function submitKybDocumentAction(formData: FormData): void {
  const documentType = formData.get("documentType");
  const file = formData.get("document");
  if (typeof documentType !== "string" || !(file instanceof File) || file.size === 0) {
    redirect("/studio?kyb=error");
  }
  redirect("/studio?kyb=submitted");
}
