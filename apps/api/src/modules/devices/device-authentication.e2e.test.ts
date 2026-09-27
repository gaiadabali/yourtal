import { randomUUID } from "node:crypto";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import type { Resource } from "@yourtal/authz/resources";
import { describe, expect, it } from "vitest";
import { hash as argon2Hash } from "@node-rs/argon2";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { businessAccounts } from "../business/persistence/schema/business-account.table";
import { merchantLocations } from "../store/persistence/schema/listing.table";
import { StoreDevicePrincipalResolver } from "../../shared/authz/store-device-principal-resolver";
import { CounterDeviceCredentialVerifier } from "./counter-device-credential-verifier";
import { DrizzleCounterDeviceRepository } from "./persistence/drizzle-counter-device.repository";
import { issueDeviceCredential, issuePairingCode } from "./crypto/device-token";

/**
 * TASKS.md 8.1.c: "a paired device gets a principal, and a revoked one gets
 * 401" — the Check for the whole of 8.1, proved against a REAL Cerbos, the
 * same shape `store-device-principal-resolver.e2e.test.ts` (1.5.c) already
 * uses. That suite drives the resolver with a FAKE verifier; this one drives
 * it with the REAL `CounterDeviceCredentialVerifier` this ticket adds, over
 * a real `store.counter_device` row this ticket's own migration creates.
 */
const pdp = createPdpClient({ baseUrl: process.env["PDP_BASE_URL"] ?? "http://127.0.0.1:26592" });

function databaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined) throw new Error("TEST_DATABASE_URL/DATABASE_URL is not set");
  return url;
}

const db: AppDb = createAppDb(databaseUrl());
const devices = new DrizzleCounterDeviceRepository(db);
const verifier = new CounterDeviceCredentialVerifier(devices);
const resolver = new StoreDevicePrincipalResolver(verifier);

function requestWithBearer(secret: string) {
  return { headers: { authorization: `Bearer ${secret}` } } as unknown as Parameters<
    typeof resolver.resolve
  >[0];
}

function redemptionAt(businessId: string): Resource<"redemption"> {
  return { kind: "redemption", id: `redemption-${businessId}`, attr: { businessId } };
}

/** A real, minimal business.business_accounts + store.merchant_location pair (7.1.a's shape). */
async function seedBusinessAndLocation(): Promise<{ businessId: string; locationId: string }> {
  const businessId = randomUUID();
  await db.insert(businessAccounts).values({
    id: businessId,
    legalName: "8.1.c Test Business Pty Ltd",
    displayName: "8.1.c Test Business",
    taxIdKind: "ABN",
    taxIdValue: "12345678901",
    addressState: "NSW",
    addressPostcode: "2000",
    addressCity: null,
    roles: ["redeemer"],
    region: "AU",
    currency: "AUD",
    handle: `biz-8-1-c-${randomUUID().slice(0, 8)}`,
  });
  const locationId = randomUUID();
  await db.insert(merchantLocations).values({
    id: locationId,
    merchantId: businessId,
    name: "8.1.c Test Store",
    address: "1 Test St",
    district: "Sydney",
  });
  return { businessId, locationId };
}

/** Provisions and immediately pairs a device, bypassing the HTTP layer — this suite drives the resolver directly. */
async function provisionAndPairDevice(businessId: string, locationId: string) {
  const pinHash = await argon2Hash("1234");
  const pairing = issuePairingCode();
  const device = await devices.create({
    businessId,
    region: "AU",
    locationId,
    label: "Front counter",
    pinHash,
    pairingCodeHash: pairing.hash,
    pairingExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    createdBy: "test-owner",
  });
  const credential = issueDeviceCredential();
  const paired = await devices.pair(device.id, credential.hash, new Date());
  if (paired === null) throw new Error("pairing failed in test setup");
  return { deviceId: device.id, secret: credential.secret };
}

describe("a real store.counter_device against real Cerbos (8.1.c)", () => {
  it("a paired device gets a store_device principal that ALLOWS its own redemptions", async () => {
    const { businessId, locationId } = await seedBusinessAndLocation();
    const { secret } = await provisionAndPairDevice(businessId, locationId);

    const principal = await resolver.resolve(requestWithBearer(secret));
    expect(principal.roles).toEqual(["store_device"]);

    for (const action of ["authorize", "capture", "lookup"] as const) {
      const result = await pdp.requireAction(principal, redemptionAt(businessId), action);
      expect(result.isOk(), `${action} should be allowed`).toBe(true);
    }

    // 8.2.c: a device principal can never void or refund, even at its own business.
    const voidResult = await pdp.requireAction(principal, redemptionAt(businessId), "void");
    expect(voidResult.isErr()).toBe(true);
  });

  it("a revoked device's credential gets 401, not a Cerbos DENY", async () => {
    const { businessId, locationId } = await seedBusinessAndLocation();
    const { deviceId, secret } = await provisionAndPairDevice(businessId, locationId);

    const revoked = await devices.revoke(deviceId, businessId, "test-owner");
    expect(revoked).not.toBeNull();

    await expect(resolver.resolve(requestWithBearer(secret))).rejects.toMatchObject({
      response: { code: "invalid_device_credential" },
    });
  });

  it("an unpaired device's own pairing code is not a redemption credential", async () => {
    const { businessId, locationId } = await seedBusinessAndLocation();
    const pinHash = await argon2Hash("1234");
    const pairing = issuePairingCode();
    await devices.create({
      businessId,
      region: "AU",
      locationId,
      label: "Never paired",
      pinHash,
      pairingCodeHash: pairing.hash,
      pairingExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      createdBy: "test-owner",
    });

    // The pairing code is not a bearer credential — presenting it as one is refused.
    await expect(resolver.resolve(requestWithBearer(pairing.secret))).rejects.toMatchObject({
      response: { code: "invalid_device_credential" },
    });
  });
});
