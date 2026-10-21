"use server";

import * as z from "zod";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

/**
 * F126's first step from the player: sends the signed-in person a fresh
 * email-verification link (`POST /api/auth/email/verify/request`, the same
 * email registration sends). The link opens `/verify`.
 */
export async function requestEmailVerificationAction(): Promise<ApiResult<{ requested: boolean }>> {
  return apiFetch("/api/auth/email/verify/request", z.object({ requested: z.boolean() }), {
    method: "POST",
  });
}
