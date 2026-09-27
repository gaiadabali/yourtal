import { createZodDto } from "nestjs-zod";
import {
  issueDeveloperCredentialRequestSchema,
  registerWebhookRequestSchema,
} from "@yourtal/contracts/merchant/merchant-developer-credential";

export class IssueDeveloperCredentialDto extends createZodDto(
  issueDeveloperCredentialRequestSchema,
) {}
export class RegisterWebhookDto extends createZodDto(registerWebhookRequestSchema) {}
