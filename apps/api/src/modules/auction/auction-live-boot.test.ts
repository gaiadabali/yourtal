import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDriversConfiguredForBoot } from "@yourtal/drivers/driver-mode";
import { startPaySimServer } from "@yourtal/paysim/server";
import type { PaySimServer } from "@yourtal/paysim/server";
import { AppModule } from "../../app.module";
import { PAYMENT_PROVIDERS } from "../../shared/drivers/payment-providers.module";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import { AuctionService } from "./auction.service";

/**
 * 5.1.d: the API used to refuse to boot with PAYMENTS_DRIVER=live, because the auction module built
 * its own simulated-only marketplace driver. It now takes the shared per-region providers: AU runs
 * the Stripe driver (here against the payment simulation, in-process), Indonesia stays simulated.
 */
const KEYS = [
  "PAYMENTS_DRIVER",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_API_BASE",
] as const;
const saved = new Map<string, string | undefined>();
let paysim: PaySimServer;
let app: NestFastifyApplication;

beforeAll(async () => {
  paysim = await startPaySimServer();
  for (const key of KEYS) saved.set(key, process.env[key]);
  process.env["PAYMENTS_DRIVER"] = "live";
  process.env["STRIPE_SECRET_KEY"] = paysim.secretKey;
  process.env["STRIPE_WEBHOOK_SECRET"] = paysim.webhookSecret;
  process.env["STRIPE_API_BASE"] = paysim.baseUrl;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await paysim.close();
  for (const key of KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = before;
  }
});

describe("the API with live AU payments (5.1.d)", () => {
  it("passes the boot check and boots", () => {
    expect(() => assertDriversConfiguredForBoot(process.env, "dev")).not.toThrow();
  });

  it("gives auctions the Stripe driver in AU and the simulated one in Indonesia", () => {
    const auctions = app.get(AuctionService);
    expect(auctions.marketplace("AU")).toMatchObject({
      provider: "stripe",
      mode: "live",
      needsSavedCard: true,
    });
    expect(auctions.marketplace("ID")).toMatchObject({
      provider: "simulated",
      needsSavedCard: false,
    });
    // One set of drivers for the whole process: billing and auctions share it.
    const providers = app.get<RegionPaymentProviders>(PAYMENT_PROVIDERS);
    expect(auctions.marketplace("AU")).toBe(providers.AU.marketplace);
  });
});
