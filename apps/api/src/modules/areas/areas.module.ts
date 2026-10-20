import { Module } from "@nestjs/common";
import { AreasController } from "./areas.controller";

/** F116: the fixed area list (postcode and suburb) as an API. No storage: it is a static file. */
@Module({ controllers: [AreasController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AreasModule {}
