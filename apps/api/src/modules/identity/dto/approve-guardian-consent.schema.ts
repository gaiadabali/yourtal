import { createZodDto } from "nestjs-zod";
import { approveGuardianConsentRequestSchema } from "@yourtal/contracts/identity/guardian";

/** `POST /api/guardian/:token/approve` (12.1.a) — `confirmAdult` must be the literal `true`. */
export class ApproveGuardianConsentDto extends createZodDto(approveGuardianConsentRequestSchema) {}
