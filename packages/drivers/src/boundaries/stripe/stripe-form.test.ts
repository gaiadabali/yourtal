import { describe, expect, it } from "vitest";
import { encodeStripeForm } from "./stripe-form";

describe("Stripe's bracket form encoding", () => {
  it("nests objects with literal brackets and percent-encodes the rest", () => {
    expect(
      encodeStripeForm({
        mode: "payment",
        metadata: { reference: "card-purchase:1 & 2" },
        success_url: "https://app.test/ok?session={CHECKOUT_SESSION_ID}",
      }),
    ).toBe(
      "mode=payment&metadata[reference]=card-purchase%3A1%20%26%202" +
        "&success_url=https%3A%2F%2Fapp.test%2Fok%3Fsession%3D%7BCHECKOUT_SESSION_ID%7D",
    );
  });

  it("indexes arrays of objects (line_items[0]) and brackets arrays of scalars (expand[])", () => {
    expect(
      encodeStripeForm({
        line_items: [
          {
            price_data: { currency: "aud", unit_amount: 4500, product_data: { name: "Points" } },
            quantity: 1,
          },
        ],
        expand: ["payment_intent", "setup_intent"],
      }),
    ).toBe(
      "line_items[0][price_data][currency]=aud&line_items[0][price_data][unit_amount]=4500" +
        "&line_items[0][price_data][product_data][name]=Points&line_items[0][quantity]=1" +
        "&expand[]=payment_intent&expand[]=setup_intent",
    );
  });

  it("writes booleans as true/false, omits undefined, and sends null as an empty value", () => {
    expect(
      encodeStripeForm({ confirm: true, off_session: false, email: undefined, description: null }),
    ).toBe("confirm=true&off_session=false&description=");
  });

  it("encodes nested capabilities the way Connect expects", () => {
    expect(encodeStripeForm({ capabilities: { transfers: { requested: true } } })).toBe(
      "capabilities[transfers][requested]=true",
    );
  });

  it("refuses a non-finite number rather than sending it", () => {
    expect(() => encodeStripeForm({ amount: Number.NaN })).toThrow();
  });
});
