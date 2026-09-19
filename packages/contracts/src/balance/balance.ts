import { z } from "zod";
import { pointsSchema } from "../money/money";

/**
 * The user's wallet balance — answers the three questions docs/17 section 3
 * says the Wallet surface exists to answer: what do I have, what's coming,
 * what am I about to lose. `pendingUnlockAt`/`expiringAt` are required
 * exactly when their corresponding amount is positive, enforced below.
 */
export const balanceSchema = z
  .object({
    userId: z.uuid(),
    availablePoints: pointsSchema,
    pendingPoints: pointsSchema,
    pendingUnlockAt: z.iso.datetime().nullable(),
    expiringPoints: pointsSchema,
    expiringAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .refine((balance) => balance.pendingPoints > 0 === (balance.pendingUnlockAt !== null), {
    message: "pendingUnlockAt must be set if and only if pendingPoints is positive",
    path: ["pendingUnlockAt"],
  })
  .refine((balance) => balance.expiringPoints > 0 === (balance.expiringAt !== null), {
    message: "expiringAt must be set if and only if expiringPoints is positive",
    path: ["expiringAt"],
  })
  .refine((balance) => balance.expiringPoints <= balance.availablePoints, {
    message:
      "expiringPoints cannot exceed availablePoints (holdback funds cannot be about to expire yet)",
    path: ["expiringPoints"],
  });

export type Balance = z.infer<typeof balanceSchema>;
