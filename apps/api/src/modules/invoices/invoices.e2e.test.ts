import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoiceListSchema } from "@yourtal/contracts/invoice";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";
import { INVOICE_ISSUER } from "./invoice-issuer";
import type { InvoiceIssuer } from "./invoice-issuer";
import { pdfText } from "./testing/pdf-text";

/**
 * 5.3 / 14.9 over the real HTTP stack (real Postgres, real Cerbos, the
 * simulated payments driver): a brand buys points, the purchase is invoiced
 * once, and Studio lists and downloads it. A business sees only its own, and
 * staff see any.
 */
let app: NestFastifyApplication;
let owner: Pool;
let issuer: InvoiceIssuer;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
  issuer = app.get<InvoiceIssuer>(INVOICE_ISSUER);
  await setIssuerAbn(null);
});

afterAll(async () => {
  await setIssuerAbn(null);
  await owner.end();
  await app.close();
});

/** A new approved row, so the latest wins; null is the demo state (no ABN). */
async function setIssuerAbn(abn: string | null): Promise<void> {
  await owner.query(
    `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
     VALUES ('AU', 'invoice_issuer', $1::jsonb, 'test-a', 'test-b', clock_timestamp())`,
    [
      JSON.stringify({
        legalName: "YourTal Demo Pty Ltd",
        abn,
        address: "Demo address only, Sydney NSW 2000",
        email: "billing@demo.yourtal.example",
      }),
    ],
  );
}

async function businessOwner() {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  return { cookie: session.cookie, businessId };
}

/** Buys points through the real route; the simulated driver settles at once. */
async function buyPoints(cookie: string, businessId: string, tierKey = "starter"): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: { tierKey, currency: "AUD" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ purchaseId: string }>().purchaseId;
}

async function listFor(cookie: string, businessId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/${businessId}/studio/invoices`,
    headers: { cookie },
  });
  return {
    response,
    body: response.statusCode === 200 ? invoiceListSchema.parse(response.json()) : null,
  };
}

describe("Studio: GET /api/:tenantId/studio/invoices", () => {
  it("lists an invoice for a paid purchase, with the purchase's own amounts, once however often it is issued", async () => {
    const { cookie, businessId } = await businessOwner();
    expect((await listFor(cookie, businessId)).body?.invoices).toEqual([]);

    const purchaseId = await buyPoints(cookie, businessId, "starter");
    const purchase = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/purchases/${purchaseId}`,
      headers: { cookie },
    });
    const paid = purchase.json<{ subtotalMinor: number; taxMinor: number; totalMinor: number }>();

    const first = await issuer.issueInvoice({ kind: "card_purchase", id: purchaseId });
    const again = await issuer.issueInvoice({ kind: "card_purchase", id: purchaseId });
    expect(first.status).toBe("issued");
    expect(again.status).toBe("exists");

    const { body } = await listFor(cookie, businessId);
    expect(body?.invoices).toHaveLength(1);
    const invoice = body?.invoices[0];
    expect(invoice).toMatchObject({
      region: "AU",
      businessId,
      currency: "AUD",
      sourceKind: "card_purchase",
      subtotalMinor: paid.subtotalMinor,
      taxMinor: paid.taxMinor,
      totalMinor: paid.totalMinor,
      taxRateBps: 1_000,
      isTaxInvoice: false,
      buyer: { legalName: "1.5.a Test Business Pty Ltd" },
    });
    expect(invoice?.number).toMatch(/^YT-AU-\d{6}$/);
    expect(invoice?.lines).toMatchObject([{ description: "1,000 YourTal points", quantity: 1 }]);
  });

  it("shows a business only its own invoices", async () => {
    const a = await businessOwner();
    const b = await businessOwner();
    await issuer.issueInvoice({
      kind: "card_purchase",
      id: await buyPoints(a.cookie, a.businessId),
    });
    await issuer.issueInvoice({
      kind: "card_purchase",
      id: await buyPoints(b.cookie, b.businessId),
    });

    const mine = (await listFor(a.cookie, a.businessId)).body?.invoices ?? [];
    expect(mine).toHaveLength(1);
    expect(mine.every((invoice) => invoice.businessId === a.businessId)).toBe(true);

    // Naming another business in the route is refused, not filtered.
    const stolen = await listFor(a.cookie, b.businessId);
    expect(stolen.response.statusCode).toBe(403);
  });
});

describe("Studio: GET /api/:tenantId/studio/invoices/:id/pdf", () => {
  it("downloads a PDF that carries the number, the GST and the buyer", async () => {
    const { cookie, businessId } = await businessOwner();
    await issuer.issueInvoice({ kind: "card_purchase", id: await buyPoints(cookie, businessId) });
    const invoice = (await listFor(cookie, businessId)).body?.invoices[0];
    if (invoice === undefined) throw new Error("no invoice was issued");

    const response = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/invoices/${invoice.id}/pdf`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="${invoice.number}.pdf"`,
    );
    const text = pdfText(response.rawPayload);
    expect(response.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(text).toContain(`Number: ${invoice.number}`);
    expect(text).toContain("GST (10%)");
    expect(text).toContain("1.5.a Test Business Pty Ltd");
    // The demo company has no ABN, so this is an invoice and says so.
    expect(text).toContain("This document is not a tax invoice.");

    const again = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/invoices/${invoice.id}/pdf`,
      headers: { cookie },
    });
    expect(again.rawPayload.equals(response.rawPayload)).toBe(true);
  });

  it("is a Tax invoice with the ABN once the company's ABN is approved", async () => {
    await setIssuerAbn("51 824 753 556");
    try {
      const { cookie, businessId } = await businessOwner();
      await issuer.issueInvoice({ kind: "card_purchase", id: await buyPoints(cookie, businessId) });
      const invoice = (await listFor(cookie, businessId)).body?.invoices[0];
      expect(invoice).toMatchObject({ isTaxInvoice: true, issuer: { abn: "51824753556" } });
      const response = await app.inject({
        method: "GET",
        url: `/api/${businessId}/studio/invoices/${invoice?.id ?? ""}/pdf`,
        headers: { cookie },
      });
      const text = pdfText(response.rawPayload);
      expect(text).toContain("Tax invoice");
      expect(text).toContain("ABN 51 824 753 556");
      expect(text).not.toContain("not a tax invoice");
    } finally {
      await setIssuerAbn(null);
    }
  });

  it("does not hand one business another's invoice, and refuses a stranger's tenant", async () => {
    const a = await businessOwner();
    const b = await businessOwner();
    await issuer.issueInvoice({
      kind: "card_purchase",
      id: await buyPoints(a.cookie, a.businessId),
    });
    const invoice = (await listFor(a.cookie, a.businessId)).body?.invoices[0];
    if (invoice === undefined) throw new Error("no invoice was issued");

    // B asks for A's invoice under B's own tenant: indistinguishable from a missing one.
    const underOwnTenant = await app.inject({
      method: "GET",
      url: `/api/${b.businessId}/studio/invoices/${invoice.id}/pdf`,
      headers: { cookie: b.cookie },
    });
    expect(underOwnTenant.statusCode).toBe(404);
    // B names A's tenant: not a member, refused by the PDP.
    const underTheirTenant = await app.inject({
      method: "GET",
      url: `/api/${a.businessId}/studio/invoices/${invoice.id}/pdf`,
      headers: { cookie: b.cookie },
    });
    expect(underTheirTenant.statusCode).toBe(403);
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/${a.businessId}/studio/invoices/${invoice.id}/pdf`,
    });
    expect([401, 403]).toContain(anonymous.statusCode);
  });

  it("is not offered to a role that cannot see billing", async () => {
    const { businessId } = await businessOwner();
    const marketer = await sessionFor(app, { jurisdiction: "AU" });
    await seedBusinessMembership(db, { userId: marketer.userId, role: "marketer" });
    const response = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/invoices`,
      headers: { cookie: marketer.cookie },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("Staff: /api/staff/invoices", () => {
  async function staffWith(role: "finance" | "ops" | "support") {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(owner, session.userId, role);
    return session;
  }

  it("lets finance list and download any business's invoice, and audits it", async () => {
    const { cookie, businessId } = await businessOwner();
    await issuer.issueInvoice({ kind: "card_purchase", id: await buyPoints(cookie, businessId) });
    const invoice = (await listFor(cookie, businessId)).body?.invoices[0];
    if (invoice === undefined) throw new Error("no invoice was issued");
    const finance = await staffWith("finance");

    const list = await app.inject({
      method: "GET",
      url: `/api/staff/invoices?businessId=${businessId}&region=AU`,
      headers: { cookie: finance.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(invoiceListSchema.parse(list.json()).invoices.map((entry) => entry.id)).toEqual([
      invoice.id,
    ]);

    const pdf = await app.inject({
      method: "GET",
      url: `/api/staff/invoices/${invoice.id}/pdf`,
      headers: { cookie: finance.cookie },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdfText(pdf.rawPayload)).toContain(`Number: ${invoice.number}`);

    const audit = await owner.query<{ action: string; outcome: string; region: string | null }>(
      `SELECT action, outcome, region FROM staff.audit_event
        WHERE target_kind = 'invoice' AND target_id = $1`,
      [invoice.id],
    );
    expect(audit.rows).toEqual([
      { action: "invoices.download", outcome: "succeeded", region: "AU" },
    ]);
  });

  it("refuses a business user, a staff role outside finance and ops, and a bad query", async () => {
    const { cookie, businessId } = await businessOwner();
    const asBusiness = await app.inject({
      method: "GET",
      url: "/api/staff/invoices",
      headers: { cookie },
    });
    expect(asBusiness.statusCode).toBe(403);

    const support = await staffWith("support");
    const asSupport = await app.inject({
      method: "GET",
      url: `/api/staff/invoices?businessId=${businessId}`,
      headers: { cookie: support.cookie },
    });
    expect(asSupport.statusCode).toBe(403);

    const ops = await staffWith("ops");
    const bad = await app.inject({
      method: "GET",
      url: "/api/staff/invoices?region=NZ",
      headers: { cookie: ops.cookie },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: "GET",
      url: `/api/staff/invoices/${randomUUID()}/pdf`,
      headers: { cookie: ops.cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});
