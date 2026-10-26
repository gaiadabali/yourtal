import { formatMoney } from "@yourtal/contracts/money/format";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { EmailDriver } from "@yourtal/drivers/email";
import type { GiftParty, GiftPartyReader } from "../../wallet/gift-party-reader";
import type { SettledParties } from "./settle-auction";

type Locale = GiftParty["displayLocale"];
type Party = "seller" | "winner" | "charity";

/** Receipt copy, both locales. No bidder is ever named, only amounts. */
const COPY: Record<
  Locale,
  Record<Party, (amount: string | null, outcome: string) => [string, string]>
> = {
  "en-AU": {
    seller: (amount, outcome) =>
      outcome === "sold"
        ? [
            "Your charity auction has closed",
            `Your voucher raised ${amount ?? ""}, paid straight to the charity.`,
          ]
        : outcome === "unsold"
          ? [
              "Your charity auction has closed",
              "Nobody bid, so the voucher has gone to the charity to use.",
            ]
          : [
              "Your charity auction was cancelled",
              "Your voucher is back in your wallet with a new code.",
            ],
    winner: (amount) => [
      "You won a charity auction",
      `Your payment of ${amount ?? ""} went straight to the charity. The voucher is in your wallet.`,
    ],
    charity: (amount, outcome) =>
      outcome === "sold"
        ? ["An auction for your charity has closed", `${amount ?? ""} was paid into your account.`]
        : [
            "An auction for your charity has closed",
            "Nobody bid, so the voucher is now yours to use.",
          ],
  },
  "id-ID": {
    seller: (amount, outcome) =>
      outcome === "sold"
        ? [
            "Lelang amalmu telah ditutup",
            `Vouchermu menghasilkan ${amount ?? ""}, dibayarkan langsung ke lembaga amal.`,
          ]
        : outcome === "unsold"
          ? [
              "Lelang amalmu telah ditutup",
              "Tidak ada penawaran, jadi voucher diberikan kepada lembaga amal.",
            ]
          : ["Lelang amalmu dibatalkan", "Vouchermu kembali ke dompetmu dengan kode baru."],
    winner: (amount) => [
      "Kamu memenangkan lelang amal",
      `Pembayaranmu sebesar ${amount ?? ""} langsung masuk ke lembaga amal. Voucher ada di dompetmu.`,
    ],
    charity: (amount, outcome) =>
      outcome === "sold"
        ? [
            "Lelang untuk lembaga Anda telah ditutup",
            `${amount ?? ""} telah dibayarkan ke rekening Anda.`,
          ]
        : [
            "Lelang untuk lembaga Anda telah ditutup",
            "Tidak ada penawaran, jadi voucher ini sekarang milik Anda.",
          ],
  },
};

/** 13.22.c: one email per party, best effort, idempotent per auction and party. */
export async function sendReceipts(
  email: EmailDriver,
  parties: GiftPartyReader,
  settled: SettledParties,
): Promise<void> {
  const amount =
    settled.amountMinor === null
      ? null
      : formatMoney(toMinorUnits(settled.amountMinor), settled.currency);
  const recipients: [Party, string | null][] = [
    ["seller", settled.sellerId],
    ["winner", settled.winnerId],
    ["charity", settled.charityAdminId],
  ];
  for (const [party, userId] of recipients) {
    if (userId === null) continue;
    const person = await parties.byUserId(userId);
    if (person === null) continue;
    const [subject, body] = COPY[person.displayLocale][party](amount, settled.outcome);
    const sent = await email.send({
      idempotencyKey: `auction-receipt:${settled.auctionId}:${party}`,
      to: person.email,
      region: person.region,
      category: "auction_receipt",
      subject,
      body,
      metadata: { auctionId: settled.auctionId, party, outcome: settled.outcome },
    });
    if (sent.isErr()) continue;
  }
}
