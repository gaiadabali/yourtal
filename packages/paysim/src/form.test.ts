import { describe, expect, it } from "vitest";
import { FormError, parseForm } from "./form";

describe("parseForm", () => {
  it("parses flat pairs, plus signs and percent escapes", () => {
    expect(parseForm("a=1&b=x+y&c=%C3%A9")).toEqual({ a: "1", b: "x y", c: "é" });
  });

  it("nests bracket keys", () => {
    expect(parseForm("metadata[reference]=x&metadata[n]=2")).toEqual({
      metadata: { reference: "x", n: "2" },
    });
    expect(parseForm("a[b][c][d]=1")).toEqual({ a: { b: { c: { d: "1" } } } });
  });

  it("turns numeric keys into arrays, in index order", () => {
    const parsed = parseForm(
      "line_items[1][quantity]=2&line_items[0][price_data][unit_amount]=4500&line_items[0][quantity]=1",
    );
    expect(parsed).toEqual({
      line_items: [{ price_data: { unit_amount: "4500" }, quantity: "1" }, { quantity: "2" }],
    });
  });

  it("collects repeated empty brackets into an array", () => {
    expect(parseForm("expand[]=payment_intent&expand[]=setup_intent")).toEqual({
      expand: ["payment_intent", "setup_intent"],
    });
    expect(parseForm("expand%5B%5D=customer")).toEqual({ expand: ["customer"] });
  });

  it("keeps an empty value and handles a key without =", () => {
    expect(parseForm("a=&b")).toEqual({ a: "", b: "" });
  });

  it("returns an empty tree for an empty string", () => {
    expect(parseForm("")).toEqual({});
  });

  it("lets a later value win", () => {
    expect(parseForm("a=1&a=2")).toEqual({ a: "2" });
  });

  it("refuses prototype-polluting names and keeps the prototype clean", () => {
    expect(() => parseForm("__proto__[x]=1")).toThrow(FormError);
    expect(() => parseForm("a[constructor]=1")).toThrow(FormError);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("refuses malformed encodings and names", () => {
    expect(() => parseForm("a=%E0%A4%A")).toThrow(FormError);
    expect(() => parseForm("a[b=1")).toThrow(FormError);
    expect(() => parseForm("[a]=1")).toThrow(FormError);
  });

  it("limits nesting depth and the number of pairs", () => {
    expect(() => parseForm(`a${"[b]".repeat(12)}=1`)).toThrow(FormError);
    const many = Array.from({ length: 600 }, (_, i) => `k${i}=1`).join("&");
    expect(() => parseForm(many)).toThrow(FormError);
  });
});
