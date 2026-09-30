import { Injectable, Inject, Module } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { ResourceAttributeLoader } from "../../shared/authz/resource-attribute-loader";
import { CHARITY_DB, CharityRepository } from "./charity.repository";
import { CharityController } from "./charity.controller";
import { StaffCharityController } from "./staff-charity.controller";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The PDP's `charity` attributes, from the `:charityId` in the URL (1.5.d's loader convention). */
@Injectable()
export class CharityAttributeLoader implements ResourceAttributeLoader<"charity"> {
  readonly kind = "charity" as const;
  constructor(@Inject(CHARITY_DB) private readonly charities: CharityRepository) {}

  async resolve(request: FastifyRequest) {
    const id = (request.params as Record<string, string> | undefined)?.["charityId"];
    if (id === undefined) return undefined;
    if (!UUID.test(id)) return null;
    const attrs = await this.charities.authzAttributes(id);
    return attrs === null ? null : { id, attr: attrs };
  }
}

@Module({
  controllers: [CharityController, StaffCharityController],
  providers: [
    {
      provide: CHARITY_DB,
      useFactory: (config: AppConfig) => new CharityRepository(createAppDb(config.databaseUrl)),
      inject: [APP_CONFIG],
    },
    CharityAttributeLoader,
  ],
  exports: [CharityAttributeLoader],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class CharityModule {}
