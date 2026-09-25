import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { resolveCredentials } from "./hls-origin";

describe("resolveCredentials", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalS3Key = process.env.S3_SECRET_KEY;

  beforeEach(() => {
    // Clear S3_SECRET_KEY before each test
    delete process.env.S3_SECRET_KEY;
  });

  afterEach(() => {
    // Restore original values
    process.env.NODE_ENV = originalNodeEnv;
    if (originalS3Key !== undefined) {
      process.env.S3_SECRET_KEY = originalS3Key;
    } else {
      delete process.env.S3_SECRET_KEY;
    }
  });

  it("uses default secret in development when S3_SECRET_KEY is unset", () => {
    process.env.NODE_ENV = "development";

    const credentials = resolveCredentials();

    expect(credentials.secretAccessKey).toBe("yourtal_local_only");
  });

  it("uses default secret in test when S3_SECRET_KEY is unset", () => {
    process.env.NODE_ENV = "test";

    const credentials = resolveCredentials();

    expect(credentials.secretAccessKey).toBe("yourtal_local_only");
  });

  it("throws in production when S3_SECRET_KEY is unset", () => {
    process.env.NODE_ENV = "production";

    expect(() => resolveCredentials()).toThrow(
      "S3_SECRET_KEY environment variable is required in production",
    );
  });

  it("uses explicit S3_SECRET_KEY value when provided", () => {
    process.env.NODE_ENV = "production";
    process.env.S3_SECRET_KEY = "my-secret-key";

    const credentials = resolveCredentials();

    expect(credentials.secretAccessKey).toBe("my-secret-key");
  });
});
