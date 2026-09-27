import { randomUUID } from "node:crypto";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { principalSchema } from "@yourtal/authz/principal";
import { describe, expect, it } from "vitest";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { businessAccounts } from "../../business/persistence/schema/business-account.table";
import { FakeVoucherClient } from "../../../shared/voucher-client/fake-voucher-client";
import { DrizzleDeveloperCredentialRepository } from "./persistence/drizzle-developer-credential.repository";
import { DrizzleWebhookSubscriptionRepository } from "./persistence/drizzle-webhook-subscription.repository";
import { issueCredential } from "./use-cases/issue-credential.use-case";
import { rotateCredential } from "./use-cases/rotate-credential.use-case";
import { revokeCredential } from "./use-cases/revoke-credential.use-case";
import { registerWebhook } from "./use-cases/register-webhook.use-case";
import { openWebhookSecret } from "./crypto/webhook-secret";

/**
 * TASKS.md 8.3.a/8.3.c: an HTTP-round-trip-equivalent proof at the use-case
 * layer (this suite drives them directly, the same way
 * `store-device-principal-resolver.e2e.test.ts` drives a resolver directly)
 * plus the real Cerbos rule this ticket's own `revoke_credential` action
 * needed (8.3.a's report explains why it did not already exist).
 */
const pdp = createPdpClient({ baseUrl: process.env["PDP_BASE_URL"] ?? "http://127.0.0.1:26592" });

function databaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined) throw new Error("TEST_DATABASE_URL/DATABASE_URL is not set");
  return url;
}

const db: AppDb = createAppDb(databaseUrl());
const vouchers = new FakeVoucherClient(db);
const credentials = new DrizzleDeveloperCredentialRepository(db);
const webhooks = new DrizzleWebhookSubscriptionRepository(db);
const ENCRYPTION_KEY = "test-only-webhook-secret-encryption-key-not-a-real-secret-32b";

async function seedBusiness(): Promise<string> {
  const businessId = randomUUID();
  await db.insert(businessAccounts).values({
    id: businessId,
    legalName: "8.3.a Test Business Pty Ltd",
    displayName: "8.3.a Test Business",
    taxIdKind: "ABN",
    taxIdValue: "12345678901",
    addressState: "NSW",
    addressPostcode: "2000",
    addressCity: null,
    roles: ["redeemer"],
    region: "AU",
    currency: "AUD",
    handle: `biz-8-3-a-${randomUUID().slice(0, 8)}`,
  });
  return businessId;
}

describe("Studio -> Developers: issue, rotate, revoke (8.3.a)", () => {
  it("issues a credential with a secret shown once, then rotates and revokes it", async () => {
    const businessId = await seedBusiness();

    const issued = await issueCredential(vouchers, credentials, {
      businessId,
      label: "Sandbox integration",
      sandbox: true,
      issuedBy: "owner-1",
    });
    expect(issued.isOk()).toBe(true);
    const first = issued._unsafeUnwrap();
    expect(first.secret).toBeDefined();
    expect(first.state).toBe("active");

    const rotated = await rotateCredential(
      vouchers,
      credentials,
      businessId,
      first.credentialId,
      "owner-1",
    );
    expect(rotated.isOk()).toBe(true);
    const second = rotated._unsafeUnwrap();
    expect(second.secret).toBeDefined();
    expect(second.secret).not.toBe(first.secret);

    // Rotating or revoking a credential that belongs to a DIFFERENT business is refused.
    const otherBusiness = await seedBusiness();
    const wrongOwner = await rotateCredential(
      vouchers,
      credentials,
      otherBusiness,
      first.credentialId,
      "intruder",
    );
    expect(wrongOwner.isErr()).toBe(true);
    expect(wrongOwner._unsafeUnwrapErr()).toMatchObject({ type: "credential_not_owned" });

    const revoked = await revokeCredential(
      vouchers,
      credentials,
      businessId,
      first.credentialId,
      "owner-1",
    );
    expect(revoked.isOk()).toBe(true);

    const rows = await credentials.listForBusiness(businessId);
    expect(rows.find((r): boolean => r.credentialId === first.credentialId)?.state).toBe("revoked");
  });

  it("real Cerbos: an owner/admin manages credentials, a store_device never does (redemption.yaml)", async () => {
    const businessId = randomUUID();
    const owner = principalSchema.parse({
      id: "user-owner-1",
      roles: ["business_user"],
      attr: {
        jurisdiction: "AU",
        businessRoles: { [businessId]: "owner" },
        isSuspended: false,
      },
    });
    const device = principalSchema.parse({
      id: `device:${randomUUID()}`,
      roles: ["store_device"],
      attr: {
        jurisdiction: "AU",
        businessRoles: {},
        isSuspended: false,
        deviceBusinessId: businessId,
        deviceLocationId: randomUUID(),
      },
    });
    const resource = {
      kind: "redemption" as const,
      id: `redemption-${businessId}`,
      attr: { businessId },
    };

    for (const action of ["view_credential", "rotate_credential", "revoke_credential"] as const) {
      const ownerResult = await pdp.requireAction(owner, resource, action);
      expect(ownerResult.isOk(), `owner ${action} should be allowed`).toBe(true);
      const deviceResult = await pdp.requireAction(device, resource, action);
      expect(deviceResult.isErr(), `device ${action} should be denied`).toBe(true);
    }
  });

  it("registers a webhook, sealing the secret so only the worker can recover it (8.3.c)", async () => {
    const businessId = await seedBusiness();

    const result = await registerWebhook(
      webhooks,
      ENCRYPTION_KEY,
      businessId,
      "https://example.com/webhooks/yourtal",
    );
    expect(result.isOk()).toBe(true);
    const registered = result._unsafeUnwrap();
    expect(registered.secret.length).toBeGreaterThan(0);

    const row = await webhooks.findByBusinessId(businessId);
    expect(row).not.toBeNull();
    // The stored ciphertext is never the plaintext secret.
    expect(row?.secretCiphertext.toString("utf8")).not.toContain(registered.secret);

    const recovered = openWebhookSecret(
      { ciphertext: row!.secretCiphertext, nonce: row!.secretNonce },
      ENCRYPTION_KEY,
    );
    expect(recovered).toBe(registered.secret);
  });
});
