import { createZodDto } from "nestjs-zod";
import { purchasePointsRequestSchema } from "@yourtal/contracts/billing";

/** `region` is never a body field -- resolved from the business, same rule `create-listing.schema.ts` follows. */
export class PurchasePointsDto extends createZodDto(purchasePointsRequestSchema) {}
