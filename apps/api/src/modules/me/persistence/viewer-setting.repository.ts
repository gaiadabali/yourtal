import { eq } from "drizzle-orm";
import type { AutoplaySetting } from "@yourtal/contracts/me/autoplay-setting";
import { defaultAutoplayFor } from "@yourtal/contracts/me/autoplay-setting";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { ThemeSetting } from "@yourtal/contracts/me/theme-setting";
import { viewerSettings, viewerThemes } from "./schema/me-schema";

/**
 * `me.viewer_setting` (6.7.a) — read/write for the settings controller.
 * `AutoplaySettingReader` below is the narrow read-only port a future
 * consumer (6.3's feed) injects instead of this whole repository, matching
 * `CompletedWatchDaysReader`'s own precedent in this module.
 */
export interface ViewerSettingRepository {
  /** `null` when the user has never set one — the caller resolves the region default. */
  autoplayFor(userId: string): Promise<AutoplaySetting | null>;
  setAutoplay(userId: string, autoplay: AutoplaySetting): Promise<void>;
  /** 13.16.a: `system` when the viewer never picked one. */
  themeFor(userId: string): Promise<ThemeSetting>;
  setTheme(userId: string, theme: ThemeSetting): Promise<void>;
}

export const VIEWER_SETTING_REPOSITORY = Symbol("VIEWER_SETTING_REPOSITORY");

export class DrizzleViewerSettingRepository implements ViewerSettingRepository {
  constructor(private readonly db: AppDb) {}

  async autoplayFor(userId: string): Promise<AutoplaySetting | null> {
    const rows = await this.db
      .select({ autoplay: viewerSettings.autoplay })
      .from(viewerSettings)
      .where(eq(viewerSettings.userId, userId))
      .limit(1);
    return (rows[0]?.autoplay as AutoplaySetting | undefined) ?? null;
  }

  async setAutoplay(userId: string, autoplay: AutoplaySetting): Promise<void> {
    await this.db
      .insert(viewerSettings)
      .values({ userId, autoplay })
      .onConflictDoUpdate({ target: viewerSettings.userId, set: { autoplay } });
  }

  async themeFor(userId: string): Promise<ThemeSetting> {
    const rows = await this.db
      .select({ theme: viewerThemes.theme })
      .from(viewerThemes)
      .where(eq(viewerThemes.userId, userId))
      .limit(1);
    return (rows[0]?.theme as ThemeSetting | undefined) ?? "system";
  }

  async setTheme(userId: string, theme: ThemeSetting): Promise<void> {
    await this.db
      .insert(viewerThemes)
      .values({ userId, theme })
      .onConflictDoUpdate({ target: viewerThemes.userId, set: { theme, updatedAt: new Date() } });
  }
}

/** Resolves the EFFECTIVE autoplay setting: the stored row, or the region default when there is none. */
export interface AutoplaySettingReader {
  resolveFor(userId: string, region: Region): Promise<AutoplaySetting>;
}

export const AUTOPLAY_SETTING_READER = Symbol("AUTOPLAY_SETTING_READER");

export class DrizzleAutoplaySettingReader implements AutoplaySettingReader {
  constructor(private readonly repository: Pick<ViewerSettingRepository, "autoplayFor">) {}

  async resolveFor(userId: string, region: Region): Promise<AutoplaySetting> {
    const stored = await this.repository.autoplayFor(userId);
    return stored ?? defaultAutoplayFor(region);
  }
}
