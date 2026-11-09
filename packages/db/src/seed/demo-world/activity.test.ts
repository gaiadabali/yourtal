import { describe, expect, it, vi } from "vitest";
import { KEEP_GIFTABLE, keepAuctionOpen, pickToAuction, pickToRedeem, settled } from "./activity";
import type { DemoApi } from "./api-client";

const active = (id: string, giftable: boolean) => ({ id, status: "active", giftable });

describe("pickToRedeem: what the daily counter visit spends", () => {
  it("spends a voucher the member cannot pass on before any they can", () => {
    const won = active("won", false);
    expect(pickToRedeem([active("a", true), won, active("b", true)])).toEqual([won]);
  });

  it("keeps the guide's giftable vouchers plus the auction keeper's one spare", () => {
    const stock = Array.from({ length: KEEP_GIFTABLE }, (_, i) => active(`g${String(i)}`, true));
    expect(pickToRedeem(stock)).toEqual([]);
    expect(pickToRedeem([...stock, active("spare", true)])).toEqual([]);
    expect(pickToRedeem([...stock, active("spare", true), active("extra", true)])).toHaveLength(1);
  });

  it("ignores vouchers that are not active, and an account with none", () => {
    expect(pickToRedeem([{ status: "redeemed", giftable: false }])).toEqual([]);
    expect(pickToRedeem([])).toEqual([]);
  });
});

describe("pickToAuction: the voucher put up for a charity when no auction is open", () => {
  it("takes a giftable voucher only while more than KEEP_GIFTABLE would remain", () => {
    const stock = Array.from({ length: KEEP_GIFTABLE }, (_, i) => active(`g${String(i)}`, true));
    expect(pickToAuction([active("won", false), ...stock])).toBeUndefined();
    const extra = active("extra", true);
    expect(pickToAuction([active("won", false), extra, ...stock])).toBe(extra);
  });

  it("takes nothing when none can be passed on", () => {
    expect(
      pickToAuction([active("won", false), { status: "redeemed", giftable: true }]),
    ).toBeUndefined();
  });
});

describe("keepAuctionOpen: the daily step that keeps one charity auction open", () => {
  /** A seller api answering only the routes the step calls. */
  function seller(
    stock: { voucherId: string; status: string; giftable: boolean }[],
    open = 0,
    refuse = false,
  ) {
    const listed: string[] = [];
    const api = {
      get: (path: string) =>
        Promise.resolve({
          status: 200,
          body: path.startsWith("/api/auctions")
            ? { auctions: Array.from({ length: open }, () => ({})) }
            : path.startsWith("/api/charities")
              ? { charities: [{ id: "charity-1" }] }
              : { vouchers: [...stock] },
        }),
      post: (path: string) => {
        if (refuse) return Promise.resolve({ status: 409, body: { code: "voucher_holdback" } });
        listed.push(path.split("/")[4] ?? "");
        return Promise.resolve({ status: 201, body: { auctionId: "a1" } });
      },
    } as unknown as DemoApi;
    return { api, listed };
  }
  const kept = () =>
    Array.from({ length: KEEP_GIFTABLE }, (_, i) => ({
      voucherId: `kept${String(i)}`,
      status: "active",
      giftable: true,
    }));

  it("buys one more and lists it when the seller holds only the kept stock (5.13.ad)", async () => {
    const stock = kept();
    const { api, listed } = seller(stock);
    const topUp = vi.fn(() => {
      stock.push({ voucherId: "fresh", status: "active", giftable: true });
      return Promise.resolve({ bought: true as const });
    });
    expect(await keepAuctionOpen(api, "ID", topUp)).toBe("ID opened an auction");
    expect(topUp).toHaveBeenCalledOnce();
    expect(listed).toEqual(["fresh"]);
  });

  it("lists a spare voucher without buying, and does nothing while an auction is open", async () => {
    const spare = seller([...kept(), { voucherId: "spare", status: "active", giftable: true }]);
    const topUp = vi.fn(() => Promise.resolve({ bought: true as const }));
    expect(await keepAuctionOpen(spare.api, "AU", topUp)).toBe("AU opened an auction");
    expect(spare.listed).toHaveLength(1);
    const busy = seller(kept(), 1);
    expect(await keepAuctionOpen(busy.api, "AU", topUp)).toBe("AU auctions open: 1");
    expect(busy.listed).toEqual([]);
    expect(topUp).not.toHaveBeenCalled();
  });

  it("says what the top-up granted when it bought nothing", async () => {
    const { api, listed } = seller(kept());
    const why = "ID: goodwill 3000 granted, balance 83 pts, no demo voucher affordable or in stock";
    expect(
      await keepAuctionOpen(api, "ID", () => Promise.resolve({ bought: false as const, why })),
    ).toBe(`ID no auction opened: top-up bought nothing (${why})`);
    expect(listed).toEqual([]);
  });

  it("buys at most once while its spare cannot be listed: the counter leaves the spare alone", async () => {
    const stock = kept();
    const refused = seller(stock, 0, true);
    const topUp = vi.fn(() => {
      stock.push({ voucherId: "spare", status: "active", giftable: true });
      return Promise.resolve({ bought: true as const });
    });
    expect(await keepAuctionOpen(refused.api, "AU", topUp)).toBe(
      "AU no auction opened: voucher_holdback",
    );
    // That night's counter visit keeps the spare, so the next day retries it without buying.
    expect(pickToRedeem(stock)).toEqual([]);
    expect(await keepAuctionOpen(refused.api, "AU", topUp)).toBe(
      "AU no auction opened: voucher_holdback",
    );
    expect(topUp).toHaveBeenCalledOnce();
  });
});

describe("settled: one failing step never stops the steps after it", () => {
  it("turns a throw (a failed login, say) into the step's log line", async () => {
    const failing = settled("AU auction keeper", () => Promise.reject(new Error("login 503")));
    await expect(failing).resolves.toBe("AU auction keeper: Error: login 503");
    await expect(settled("x", () => Promise.resolve("done"))).resolves.toBe("done");
  });
});
