import { z } from "zod";
import { businessHandleSchema } from "@yourtal/contracts/business";
import { createZodDto } from "nestjs-zod";

/** Pasted image links must be https: a `javascript:` or `http:` link never reaches a page. */
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);

/** A full replacement of the channel identity (region never changes, so it is not a field). */
export const updateChannelSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  handle: businessHandleSchema,
  logoUrl: httpsUrl.nullable(),
  coverUrl: httpsUrl.nullable(),
});

export class UpdateChannelSettingsDto extends createZodDto(updateChannelSettingsSchema) {}
