"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import * as z from "zod";
import { apiFetch } from "@/lib/api/api-fetch";

const queuedSchema = z.object({ queued: z.literal(true), jobId: z.string() });

/** 13.1.a: asks the worker to rebuild the demo world. The page shows the outcome. */
export async function resetDemoWorldAction(formData: FormData): Promise<void> {
  const key = formData.get("idempotencyKey");
  const result = await apiFetch("/api/dev/demo/reset", queuedSchema, {
    method: "POST",
    headers: { "idempotency-key": typeof key === "string" ? key : crypto.randomUUID() },
    body: {},
  });
  redirect((result.ok ? "/staff?demo=queued" : "/staff?demo=failed") as Route);
}
