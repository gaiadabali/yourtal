import { describe, expect, it } from "vitest";
import { isCellularOrSaveData } from "./connection";

describe("isCellularOrSaveData", () => {
  it("is false when there is no Network Information API at all", () => {
    expect(isCellularOrSaveData(undefined)).toBe(false);
    expect(isCellularOrSaveData(null)).toBe(false);
  });

  it("is false on wifi/ethernet with data saver off", () => {
    expect(isCellularOrSaveData({ type: "wifi", saveData: false })).toBe(false);
  });

  it("is true when the connection is reported as cellular", () => {
    expect(isCellularOrSaveData({ type: "cellular", saveData: false })).toBe(true);
  });

  it("is true when data saver is on, regardless of connection type", () => {
    expect(isCellularOrSaveData({ type: "wifi", saveData: true })).toBe(true);
  });
});
