import { describe, expect, it } from "vitest";
import { publicTwitterCard } from "./public-twitter-card";

describe("publicTwitterCard", () => {
  it("carries the same title, description and image the Open Graph card already uses", () => {
    const card = publicTwitterCard({
      title: "Voucher — Kopi Sentosa",
      description: "A coffee voucher.",
      imageUrl: "https://yourtal.com/id/rewards/kopi-sentosa/abc/opengraph-image",
    });

    expect(card).toEqual({
      card: "summary_large_image",
      title: "Voucher — Kopi Sentosa",
      description: "A coffee voucher.",
      images: ["https://yourtal.com/id/rewards/kopi-sentosa/abc/opengraph-image"],
    });
  });
});
