import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";
import { ABR_LOOKUP, FakeAbrLookup } from "./abr/abr-lookup";

/**
 * 6.10.b over the real HTTP stack: a business whose ABN fails the check digit is
 * refused on create, and staff confirm a good ABN with the ABR through a fake
 * (never the network). With no ABR_GUID the lookup is off and the action says so.
 */
const ATO_EXAMPLE_ABN = "51824753556";

async function boot(abr?: FakeAbrLookup): Promise<NestFastifyApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (abr !== undefined) builder = builder.overrideProvider(ABR_LOOKUP).useValue(abr);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

async function createBusiness(app: NestFastifyApplication, cookie: string, taxIdValue: string) {
  const handle = `abn-${randomUUID().slice(0, 8)}`;
  return app.inject({
    method: "POST",
    url: "/api/businesses",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: {
      legalName: `ABN Test Co ${handle}`,
      displayName: "ABN Test",
      taxIdKind: "ABN",
      taxIdValue,
      addressState: "NSW",
      addressPostcode: "2000",
      roles: ["advertiser"],
      region: "AU",
      handle,
    },
  });
}

async function opsStaff(app: NestFastifyApplication) {
  const staff = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(ownerPool(), staff.userId, "ops");
  return staff;
}

describe("6.10.b: business create checks the ABN", () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await boot();
  });
  afterAll(async () => {
    await app.close();
  });

  it("refuses a one-digit change to the ATO example with the en-AU message, and accepts the example", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const bad = await createBusiness(app, owner.cookie, "51824753557");
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("That ABN doesn't look right");

    const good = await createBusiness(app, owner.cookie, ATO_EXAMPLE_ABN);
    expect(good.statusCode, good.body).toBe(201);
  });

  it("ABR lookup is OFF without ABR_GUID: staff see no lookup and the action answers 503", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await opsStaff(app);
    const created = await createBusiness(app, owner.cookie, ATO_EXAMPLE_ABN);
    const businessId = created.json<{ business: { id: string } }>().business.id;

    const detail = await app.inject({
      method: "GET",
      url: `/api/staff/businesses/${businessId}`,
      headers: { cookie: staff.cookie },
    });
    expect(detail.json()).toMatchObject({ abnConfirmation: null, abrLookupEnabled: false });

    const check = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/abn/check`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "ABR check" },
    });
    expect(check.statusCode).toBe(503);
  });
});

describe("6.10.b: the ABR check, with a fake driver", () => {
  const fake = new FakeAbrLookup(
    new Map([
      [
        ATO_EXAMPLE_ABN,
        { found: true as const, entityName: "EXAMPLE PTY LTD", gstRegistered: true },
      ],
    ]),
  );
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await boot(fake);
  });
  afterAll(async () => {
    await app.close();
  });

  it("records the entity name and GST status, shows it on the detail, and audits it; a non-ops role is refused", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await opsStaff(app);
    const created = await createBusiness(app, owner.cookie, ATO_EXAMPLE_ABN);
    const businessId = created.json<{ business: { id: string } }>().business.id;

    const before = await app.inject({
      method: "GET",
      url: `/api/staff/businesses/${businessId}`,
      headers: { cookie: staff.cookie },
    });
    expect(before.json()).toMatchObject({ abnConfirmation: null, abrLookupEnabled: true });

    const refused = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/abn/check`,
      headers: { cookie: owner.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "not staff" },
    });
    expect(refused.statusCode).toBe(403);

    const checked = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/abn/check`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "ABR check" },
    });
    expect(checked.statusCode, checked.body).toBe(201);
    expect(checked.json()).toMatchObject({
      abnConfirmation: { abn: ATO_EXAMPLE_ABN, entityName: "EXAMPLE PTY LTD", gstRegistered: true },
    });
    expect(fake.calls).toContain(ATO_EXAMPLE_ABN);

    const owner2 = ownerPool();
    const audit = await owner2.query(
      `SELECT outcome FROM staff.audit_event WHERE action = 'business.abn.check' AND target_id = $1`,
      [businessId],
    );
    await owner2.end();
    expect(audit.rows).toEqual([{ outcome: "succeeded" }]);
  });

  it("reads still work for a stored ABN that fails the check, and the check refuses it (422) without calling the ABR", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await opsStaff(app);
    const created = await createBusiness(app, owner.cookie, ATO_EXAMPLE_ABN);
    const businessId = created.json<{ business: { id: string } }>().business.id;
    const db = ownerPool();
    await db.query(
      `UPDATE business.business_accounts SET tax_id_value = '00000000000' WHERE id = $1`,
      [businessId],
    );
    await db.end();
    const callsBefore = fake.calls.length;

    const detail = await app.inject({
      method: "GET",
      url: `/api/staff/businesses/${businessId}`,
      headers: { cookie: staff.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ taxIdValue: "00000000000", abnConfirmation: null });

    const check = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/abn/check`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "ABR check" },
    });
    expect(check.statusCode).toBe(422);
    expect(fake.calls.length).toBe(callsBefore);
  });
});
