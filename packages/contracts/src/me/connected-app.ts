import * as z from "zod";

/** Group 3.7 Y3 (docs/29 §5): the apps a person signs in to with YourTal. */
export const connectedAppIdSchema = z.enum(["snapapp", "ftr"]);
export type ConnectedAppId = z.infer<typeof connectedAppIdSchema>;

/** One live consent, with the app and company from YourTal's registry. Never the `sub`. */
export const connectedAppSchema = z.object({
  app: connectedAppIdSchema,
  name: z.string(),
  operator: z.string(),
  scopes: z.array(z.string()),
  grantedAt: z.iso.datetime(),
});
export type ConnectedApp = z.infer<typeof connectedAppSchema>;

/** `GET /api/me/connected-apps`: live consents only. */
export const connectedAppsResponseSchema = z.object({ connectedApps: z.array(connectedAppSchema) });
export type ConnectedAppsResponse = z.infer<typeof connectedAppsResponseSchema>;

/** `DELETE /api/me/connected-apps/:app`: the same answer whether or not a consent stood. */
export const removeConnectedAppResponseSchema = z.object({
  app: connectedAppIdSchema,
  connected: z.literal(false),
});
export type RemoveConnectedAppResponse = z.infer<typeof removeConnectedAppResponseSchema>;
