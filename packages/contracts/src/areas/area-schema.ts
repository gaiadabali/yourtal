import * as z from "zod";
import { regionSchema } from "../region/region";

/** F116: what `GET /api/areas*` and `/api/me/settings/area` send and take. */

const postcodeText = z.string().regex(/^[0-9]{4,5}$/);

export const areaStatesResponseSchema = z.object({
  region: regionSchema,
  states: z.array(z.object({ code: z.string(), name: z.string(), placeCount: z.number().int() })),
});
export type AreaStatesResponse = z.infer<typeof areaStatesResponseSchema>;

export const areaPlacesResponseSchema = z.object({
  region: regionSchema,
  state: z.object({ code: z.string(), name: z.string() }),
  places: z.array(z.object({ name: z.string(), postcode: postcodeText })),
});
export type AreaPlacesResponse = z.infer<typeof areaPlacesResponseSchema>;

/** A postcode as a person reads it: its first suburb names and how many more it covers. */
export const areaSummarySchema = z.object({
  postcode: postcodeText,
  names: z.array(z.string()),
  moreCount: z.number().int().nonnegative(),
  states: z.array(z.string()),
});
export type AreaSummary = z.infer<typeof areaSummarySchema>;

export const areaSummariesResponseSchema = z.object({
  region: regionSchema,
  areas: z.array(areaSummarySchema),
});
export type AreaSummariesResponse = z.infer<typeof areaSummariesResponseSchema>;

/** `GET`/`PUT`/`DELETE /api/me/settings/area`: the viewer's declared area, or null. */
export const viewerAreaResponseSchema = z.object({ area: areaSummarySchema.nullable() });
export type ViewerAreaResponse = z.infer<typeof viewerAreaResponseSchema>;

export const setViewerAreaBodySchema = z.object({ postcode: postcodeText });

/** How many places `GET /api/areas/summaries` answers for at once. */
export const MAX_AREA_SUMMARIES = 50;
