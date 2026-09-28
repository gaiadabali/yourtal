import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ResourceAttributeLoader } from "../../shared/authz/resource-attribute-loader";
import { REGION_SETTINGS_READER } from "../../shared/settings/region-settings-reader";
import type { RegionSettingsReader } from "../../shared/settings/region-settings-reader";
import { STAFF_USER_DIRECTORY } from "./persistence/staff-user-directory";
import type { StaffUserDirectory } from "./persistence/staff-user-directory";

/** F12's goodwill-per-case limit key, seeded by 1.2.f (`20260925193000_platform_region_setting.sql`). */
const GOODWILL_CASE_LIMIT_KEY = "goodwill_case_limit_points";

/**
 * The `user_account` resource for every `/api/staff/users/:userId/*` route
 * (TASKS.md 9.4). Two jobs a synchronous `attrsFrom` cannot do:
 *
 *   1. Turn a bad `:userId` into a real 404 (the loader's `null` outcome) —
 *      instead of every action DENYing against an ownerId nobody holds.
 *   2. For `goodwill_credit` only, read F12's per-case limit fresh from
 *      `platform.region_setting` FOR THE TARGET'S OWN REGION and hand it to
 *      Cerbos as `R.attr.goodwillCeilingPts` — `region-settings-reader.ts`'s
 *      `getSetting` is async, which a decorator-time `attrsFrom` (evaluated
 *      as plain metadata, no DI) can never be. See `user_account.yaml`'s
 *      `goodwill-stays-under-the-ceiling` rule for the other half.
 *
 * `/api/staff/users` itself (the search route) has no `:userId`, so this
 * loader returns `undefined` for it and `PdpGuard` falls through to the
 * plain `idFrom`/`attrsFrom` path on that route's own `@Authorize`.
 */
@Injectable()
export class UserAccountAttributeLoader implements ResourceAttributeLoader<"user_account"> {
  readonly kind = "user_account" as const;

  constructor(
    @Inject(STAFF_USER_DIRECTORY) private readonly users: StaffUserDirectory,
    @Inject(REGION_SETTINGS_READER) private readonly settings: RegionSettingsReader,
  ) {}

  async resolve(
    request: FastifyRequest,
  ): Promise<
    { readonly id: string; readonly attr: Readonly<Record<string, unknown>> } | null | undefined
  > {
    const userId = readParam(request, "userId");
    if (userId === undefined) return undefined;

    const target = await this.users.findById(userId);
    if (target === null) return null;

    const attr: Record<string, unknown> = { ownerId: userId };
    if (isGoodwillRoute(request)) {
      const points = readBodyPoints(request);
      if (points !== undefined) {
        attr["goodwillAmountPts"] = points;
        const ceiling = await this.settings.getSetting<number>(
          target.region,
          GOODWILL_CASE_LIMIT_KEY,
        );
        if (ceiling !== null) attr["goodwillCeilingPts"] = ceiling;
      }
    }
    return { id: userId, attr };
  }
}

function readParam(request: FastifyRequest, name: string): string | undefined {
  const params: unknown = request.params;
  if (typeof params !== "object" || params === null) return undefined;
  const value: unknown = Reflect.get(params, name);
  return typeof value === "string" ? value : undefined;
}

function isGoodwillRoute(request: FastifyRequest): boolean {
  return request.url.split("?")[0]?.endsWith("/goodwill") === true;
}

/** Raw, pre-validation body read -- `ZodValidationPipe` runs after guards, same as `readBodyField` elsewhere in this app. */
function readBodyPoints(request: FastifyRequest): number | undefined {
  const body: unknown = request.body;
  if (typeof body !== "object" || body === null) return undefined;
  const value: unknown = Reflect.get(body, "points");
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
