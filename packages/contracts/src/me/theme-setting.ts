import { z } from "zod";

/** 13.16.a: the viewer's colour theme. `system` follows the device. */
export const themeSettingSchema = z.enum(["system", "light", "dark"]);
export type ThemeSetting = z.infer<typeof themeSettingSchema>;

export const themeResponseSchema = z.object({ theme: themeSettingSchema });
export type ThemeResponse = z.infer<typeof themeResponseSchema>;
