import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_CONFIG } from "../../config/app-config.module";
import { loadAppConfig } from "../../config/app-config";
import { HlsAuthController } from "./hls-auth.controller";
import { signHlsPath, verifyHlsUri } from "./hls-token";

const SECRET = "test-only-hls-signing-secret-0123456789";
const NOW = 1_800_000_000;

describe("HLS URL tokens", () => {
  const url = signHlsPath(SECRET, "sess-1", "camp-9/720p/seg-003.ts", NOW + 60);

  it("accepts the signed URL and any other file in the same session", () => {
    expect(verifyHlsUri(SECRET, url, NOW)).toBe("ok");
    expect(verifyHlsUri(SECRET, url.replace("seg-003.ts", "index.m3u8"), NOW)).toBe("ok");
  });

  it("refuses another session, another secret, a moved expiry and traversal", () => {
    expect(verifyHlsUri(SECRET, url.replace("/sess-1/", "/sess-2/"), NOW)).toBe("invalid");
    expect(verifyHlsUri(`${SECRET}x`, url, NOW)).toBe("invalid");
    expect(verifyHlsUri(SECRET, url.replace(String(NOW + 60), String(NOW + 9999)), NOW)).toBe(
      "invalid",
    );
    expect(verifyHlsUri(SECRET, url.replace("camp-9", "../camp-9"), NOW)).toBe("invalid");
    expect(verifyHlsUri(SECRET, "/media/hls/unsigned.m3u8", NOW)).toBe("invalid");
  });

  it("reports an expired signature separately", () => {
    expect(verifyHlsUri(SECRET, url, NOW + 61)).toBe("expired");
  });
});

describe("GET /api/internal/hls-auth", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HlsAuthController],
      providers: [{ provide: APP_CONFIG, useValue: { hlsSigningSecret: SECRET } }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (uri?: string) =>
    app.inject({
      method: "GET",
      url: "/api/internal/hls-auth",
      headers: uri === undefined ? {} : { "x-original-uri": uri },
    });

  it("204 for a valid signature, 403 for a forged one, 410 once expired, 403 with no URI", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await call(signHlsPath(SECRET, "s1", "a/index.m3u8", now + 60))).statusCode).toBe(204);
    expect(
      (await call(signHlsPath("wrong-secret", "s1", "a/index.m3u8", now + 60))).statusCode,
    ).toBe(403);
    expect((await call(signHlsPath(SECRET, "s1", "a/index.m3u8", now - 1))).statusCode).toBe(410);
    expect((await call()).statusCode).toBe(403);
  });
});

describe("loadAppConfig and HLS_SIGNING_SECRET", () => {
  const base = {
    DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  };

  it("refuses the local-only default on staging, allows it in dev", () => {
    expect(() => loadAppConfig({ ...base, APP_ENV: "staging" })).toThrow(/HLS_SIGNING_SECRET/);
    expect(loadAppConfig({ ...base, APP_ENV: "dev" }).hlsSigningSecret).toMatch(/^local-only/);
  });
});
