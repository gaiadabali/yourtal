// Zod-free, so client code can build its own schema from it without pulling in the wallet contract.
export const VOUCHER_GIFT_BLOCKS = ["not_unused", "not_transferable", "received_as_gift"] as const;
