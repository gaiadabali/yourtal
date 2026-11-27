import { createZodDto } from "nestjs-zod";
import { decideGuardianGodNoticeRequestSchema } from "@yourtal/contracts/identity/guardian";

/** `POST /api/guardian/:token/god-notice` (9.1.c): `accepted` or `declined`. */
export class DecideGuardianGodNoticeDto extends createZodDto(
  decideGuardianGodNoticeRequestSchema,
) {}
