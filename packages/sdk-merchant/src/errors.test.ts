import { describe, expect, it } from "vitest";
import {
  MerchantApiError,
  MerchantNetworkError,
  MerchantUnparseableErrorResponse,
  isRetryable,
} from "./errors";

function apiError(httpStatus: number, code = "some_error"): MerchantApiError {
  return new MerchantApiError(httpStatus, {
    error: { type: "invalid_request_error", code, message: "something happened" },
  });
}

describe("MerchantApiError", () => {
  it("carries the server's type, code and param", () => {
    const error = new MerchantApiError(400, {
      error: {
        type: "invalid_request_error",
        code: "amount_not_positive",
        message: "bad amount",
        param: "amount_minor",
      },
    });
    expect(error.httpStatus).toBe(400);
    expect(error.type).toBe("invalid_request_error");
    expect(error.code).toBe("amount_not_positive");
    expect(error.param).toBe("amount_minor");
    expect(error.message).toContain("amount_not_positive");
  });

  it("leaves param undefined when the server did not send one", () => {
    const error = apiError(404, "voucher_not_found");
    expect(error.param).toBeUndefined();
  });
});

describe("isRetryable", () => {
  it("retries a network error", () => {
    expect(isRetryable(new MerchantNetworkError("timed out"))).toBe(true);
  });

  it("retries 429 and every 5xx", () => {
    expect(isRetryable(apiError(429))).toBe(true);
    expect(isRetryable(apiError(500))).toBe(true);
    expect(isRetryable(apiError(503))).toBe(true);
  });

  it("does not retry a 400, 401, 403 or 404", () => {
    expect(isRetryable(apiError(400))).toBe(false);
    expect(isRetryable(apiError(401))).toBe(false);
    expect(isRetryable(apiError(403))).toBe(false);
    expect(isRetryable(apiError(404))).toBe(false);
  });

  it("applies the same 429/5xx rule to an unparseable error response", () => {
    expect(isRetryable(new MerchantUnparseableErrorResponse(502, "bad gateway"))).toBe(true);
    expect(isRetryable(new MerchantUnparseableErrorResponse(400, "nope"))).toBe(false);
  });

  it("does not retry an unrelated error", () => {
    expect(isRetryable(new Error("something else entirely"))).toBe(false);
  });
});
