import { createZodDto } from "nestjs-zod";
import { deleteGuardianAccountRequestSchema } from "@yourtal/contracts/identity/guardian";

/** `POST /api/guardian/:token/delete-account` (12.4.b #6) — `confirm` must be the literal `true`. */
export class DeleteGuardianAccountDto extends createZodDto(deleteGuardianAccountRequestSchema) {}
