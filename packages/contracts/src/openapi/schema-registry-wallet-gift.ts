import {
  giftVoucherBodySchema,
  walletGiftListSchema,
  walletGiftRefusalSchema,
  walletGiftSchema,
} from "../wallet/wallet-gift";
import type { ContractComponent } from "./schema-registry";

/** 13.20's wallet gift components, split out for the 300-line ceiling. */
export const WALLET_GIFT_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "GiftVoucherBody",
    schema: giftVoucherBodySchema,
    description:
      "Who to give the voucher to: a verified adult's sign-in email, in the same region.",
    crossFieldRules: [],
  },
  {
    id: "WalletGift",
    schema: walletGiftSchema,
    description:
      "A gift the caller sent or received. A received gift names only the sender's display name; a sent one names nobody.",
    crossFieldRules: [],
  },
  {
    id: "WalletGiftList",
    schema: walletGiftListSchema,
    description: "GET /api/wallet/gifts: sent and received, newest first.",
    crossFieldRules: [],
  },
  {
    id: "WalletGiftRefusal",
    schema: walletGiftRefusalSchema,
    description:
      "Why a gift was refused (409). gift_recipient_ineligible covers every recipient problem, so an email reveals nothing.",
    crossFieldRules: [],
  },
];
