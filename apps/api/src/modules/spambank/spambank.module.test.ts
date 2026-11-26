import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import { APP_CONFIG } from "../../config/app-config.module";
import { loadAppConfig } from "../../config/app-config";
import { SPAMBANK_CONFIG, SPAMBANK_DRIVER, SpambankModule } from "./spambank.module";

const BASE_ENV = {
  DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
  CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "test-only-webhook-secret-encryption-key-not-a-real-secret",
  SNAP_APP_PARTNER_SECRET: "test-only-snap-app-partner-secret-not-a-real-secret",
};

async function compile() {
  @Global()
  @Module({
    providers: [{ provide: APP_CONFIG, useFactory: () => loadAppConfig(BASE_ENV) }],
    exports: [APP_CONFIG],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- test double of AppConfigModule
  class ConfigForTest {}
  return Test.createTestingModule({ imports: [ConfigForTest, SpambankModule] }).compile();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SpambankModule", () => {
  it("is the simulated driver by default, with the settings from the app config", async () => {
    const moduleRef = await compile();
    const driver = moduleRef.get<SpambankDriver>(SPAMBANK_DRIVER);
    expect(driver.mode).toBe("simulated");
    expect(moduleRef.get<{ mailDomain: string }>(SPAMBANK_CONFIG).mailDomain).toBe(
      "yourtal.gaiada.com",
    );
  });

  it("builds the live driver without calling Stalwart: a mail server that is down cannot fail a boot", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("Stalwart is down")));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("SPAMBANK_DRIVER", "live");
    vi.stubEnv("SPAMBANK_STALWART_URL", "http://127.0.0.1:1");
    vi.stubEnv("SPAMBANK_STALWART_API_KEY", "API_abcdefghijkl");
    for (const [name, letter] of [
      ["SPAMBANK_CREDENTIAL_KEY", "a"],
      ["SPAMBANK_TOKEN_KEY", "b"],
      ["SPAMBANK_WEBHOOK_SECRET", "c"],
      ["SPAMBANK_OPTOUT_KEY", "d"],
    ] as const) {
      vi.stubEnv(name, letter.repeat(43));
    }
    const moduleRef = await compile();
    expect(moduleRef.get<SpambankDriver>(SPAMBANK_DRIVER).mode).toBe("live");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses live without its variables, naming them", async () => {
    vi.stubEnv("SPAMBANK_DRIVER", "live");
    await expect(compile()).rejects.toThrow(/SPAMBANK_STALWART_URL/);
  });
});
