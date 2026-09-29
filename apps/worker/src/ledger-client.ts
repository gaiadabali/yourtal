import {
  releasesNotifiedSchema,
  unnotifiedReleasesSchema,
} from "@yourtal/contracts/ledger-internal/releases";
import type {
  ReleasesNotified,
  UnnotifiedReleases,
} from "@yourtal/contracts/ledger-internal/releases";
import {
  pointsExpiryNotifiedSchema,
  unnotifiedPointsExpirySchema,
} from "@yourtal/contracts/ledger-internal/expiry";
import type {
  PointsExpiryNotified,
  UnnotifiedPointsExpiry,
} from "@yourtal/contracts/ledger-internal/expiry";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { grantSchema } from "@yourtal/contracts/ledger-internal/rewards";
import type { Grant, GrantActionRequest } from "@yourtal/contracts/ledger-internal/rewards";
import type { WorkerConfig } from "./config";

/**
 * The few ledger routes the worker calls, signed as `worker`. A non-2xx
 * answer throws, so pg-boss retries the job that made the call.
 */
export interface WorkerLedgerClient {
  unnotifiedReleases(limit: number): Promise<UnnotifiedReleases>;
  releasesNotified(grantIds: readonly string[]): Promise<ReleasesNotified>;
  /** TASKS.md 10.2.d. */
  unnotifiedPointsExpiry(limit: number): Promise<UnnotifiedPointsExpiry>;
  pointsExpiryNotified(
    notices: readonly { accountId: string; milestoneDays: 30 | 7; expiringAt: string }[],
  ): Promise<PointsExpiryNotified>;
  /**
   * TASKS.md 11.5.h: `streak-backstop.ts`'s `LEDGER_MODE=live` path — the
   * same `/v1/actions/grants` route `apps/api`'s `HttpLedgerClient.grantAction`
   * calls, signed here as `worker` instead of `api` (the same distinction
   * `caller` already makes on the api side).
   */
  grantAction(request: GrantActionRequest): Promise<Grant>;
}

export function createWorkerLedgerClient(
  ledger: Pick<WorkerConfig["ledger"], "baseUrl" | "serviceSecret">,
): WorkerLedgerClient {
  async function post(path: string, body: unknown): Promise<unknown> {
    const payload = JSON.stringify(body);
    const response = await fetch(`${ledger.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
          secret: ledger.serviceSecret,
          caller: "worker",
          method: "POST",
          pathAndQuery: path,
          body: payload,
        }),
      },
      body: payload,
    });
    if (!response.ok) {
      throw new Error(
        `ledger ${path} answered ${String(response.status)}: ${await response.text()}`,
      );
    }
    return response.json();
  }

  return {
    async unnotifiedReleases(limit) {
      return unnotifiedReleasesSchema.parse(await post("/v1/releases/unnotified", { limit }));
    },
    async releasesNotified(grantIds) {
      return releasesNotifiedSchema.parse(await post("/v1/releases/notified", { grantIds }));
    },
    async unnotifiedPointsExpiry(limit) {
      return unnotifiedPointsExpirySchema.parse(
        await post("/v1/economy/expiry/unnotified", { limit }),
      );
    },
    async pointsExpiryNotified(notices) {
      return pointsExpiryNotifiedSchema.parse(
        await post("/v1/economy/expiry/notified", { notices }),
      );
    },
    async grantAction(request) {
      return grantSchema.parse(await post("/v1/actions/grants", request));
    },
  };
}
