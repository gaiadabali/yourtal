import { createZodDto } from "nestjs-zod";
import {
  passkeyRegisterRequestSchema,
  passkeySignInRequestSchema,
  stepUpRequestSchema,
  totpCodeRequestSchema,
  totpDisableRequestSchema,
  totpSignInRequestSchema,
} from "@yourtal/contracts/identity/sign-in-methods";

export class PasskeySignInDto extends createZodDto(passkeySignInRequestSchema) {}
export class PasskeyRegisterDto extends createZodDto(passkeyRegisterRequestSchema) {}
export class TotpCodeDto extends createZodDto(totpCodeRequestSchema) {}
export class TotpDisableDto extends createZodDto(totpDisableRequestSchema) {}
export class StepUpDto extends createZodDto(stepUpRequestSchema) {}
export class TotpSignInDto extends createZodDto(totpSignInRequestSchema) {}
