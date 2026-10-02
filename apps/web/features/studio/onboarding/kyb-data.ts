import "server-only";

import * as z from "zod";
import { kybDocumentSchema } from "@yourtal/contracts/business/kyb-document";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import { apiFetch } from "@/lib/api/api-fetch";
import { resolveStudioDataSource } from "../studio-data-source";

/** The business's KYB documents, so the banner can say they are under review after a reload. */
export function listKybDocuments(businessId: string): Promise<KybDocument[]> {
  return resolveStudioDataSource<(id: string) => Promise<KybDocument[]>>({
    mock: () => Promise.resolve([]),
    live: async (id) => {
      const result = await apiFetch(
        `/api/${encodeURIComponent(id)}/business/kyb-documents`,
        z.array(kybDocumentSchema),
      );
      // Only the owner and admin may read these; anyone else just sees the upload prompt.
      return result.ok ? result.data : [];
    },
  })(businessId);
}
