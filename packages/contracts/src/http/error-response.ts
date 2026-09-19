import { z } from "zod";

/**
 * The one error envelope this API actually returns across the board.
 *
 * `apps/api/src/modules/business/to-http-exception.ts` (every business-domain
 * error) and `apps/api/src/shared/authz/authz-error.mapper.ts` (every PDP
 * denial or PDP-unavailable failure) both throw a Nest `HttpException` built
 * from exactly `{ code, message }` — `code` is the stable, machine-readable
 * string a client can switch on; `message` is for a human. Nothing in either
 * mapper ever adds a third field, so this is not a guess at a shape, it is
 * what is on disk today.
 *
 * NOT the shape of every 4xx this API can produce. `nestjs-zod`'s global
 * `ZodValidationPipe` (`apps/api/src/main.ts`) throws its own exception for a
 * body that fails Zod parsing, with its own field names, before a controller
 * or either mapper above ever runs. `route-registry.ts` documents that 400 by
 * description only, with no `content` schema, rather than assert a shape this
 * package has not verified — see the comment on `VALIDATION_400` there.
 */
export const errorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
