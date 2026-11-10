import { describe, expect, it, vi } from "vitest";
import { FakeAbrLookup, HttpAbrLookup, createAbrLookup } from "./abr-lookup";

describe("createAbrLookup (6.10.b)", () => {
  it("is OFF without a GUID: no driver, so nothing can call the network", () => {
    expect(createAbrLookup(undefined)).toBeNull();
    expect(createAbrLookup("")).toBeNull();
    expect(createAbrLookup("   ")).toBeNull();
  });

  it("is ON with a GUID", () => {
    expect(createAbrLookup("a-guid")).toBeInstanceOf(HttpAbrLookup);
  });
});

describe("FakeAbrLookup", () => {
  it("answers from its register and says not found otherwise, recording each call", async () => {
    const fake = new FakeAbrLookup(
      new Map([
        [
          "51824753556",
          { found: true as const, entityName: "Example Pty Ltd", gstRegistered: true },
        ],
      ]),
    );
    expect(await fake.lookup("51824753556")).toEqual({
      found: true,
      entityName: "Example Pty Ltd",
      gstRegistered: true,
    });
    expect(await fake.lookup("99000000032")).toEqual({ found: false });
    expect(fake.calls).toEqual(["51824753556", "99000000032"]);
  });
});

describe("HttpAbrLookup parsing (a stubbed fetch, never the network)", () => {
  const answer = (body: string, status = 200) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));

  it("reads the JSONP answer: an active ABN with GST", async () => {
    const fetchFn = answer(
      'c({"Abn":"51824753556","AbnStatus":"Active","EntityName":"EXAMPLE PTY LTD","Gst":"2019-07-01","Message":""})',
    );
    const result = await new HttpAbrLookup("guid-1", fetchFn).lookup("51824753556");
    expect(result).toEqual({ found: true, entityName: "EXAMPLE PTY LTD", gstRegistered: true });
    const url = fetchFn.mock.calls[0]?.[0] as string;
    expect(url).toContain("abn=51824753556");
    expect(url).toContain("guid=guid-1");
  });

  it("is GST-not-registered when the ABR gives no GST date", async () => {
    const result = await new HttpAbrLookup(
      "g",
      answer('c({"AbnStatus":"Active","EntityName":"SOLE TRADER","Gst":null})'),
    ).lookup("51824753556");
    expect(result).toEqual({ found: true, entityName: "SOLE TRADER", gstRegistered: false });
  });

  it("is not found for a cancelled or unknown ABN, and throws when the ABR errors", async () => {
    expect(
      await new HttpAbrLookup("g", answer('c({"AbnStatus":"Cancelled","EntityName":"X"})')).lookup(
        "51824753556",
      ),
    ).toEqual({ found: false });
    expect(
      await new HttpAbrLookup("g", answer('c({"Message":"No records found"})')).lookup(
        "51824753556",
      ),
    ).toEqual({ found: false });
    await expect(
      new HttpAbrLookup("g", answer("oops", 500)).lookup("51824753556"),
    ).rejects.toThrow();
  });
});
