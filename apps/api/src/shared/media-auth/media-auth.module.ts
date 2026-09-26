import { Module } from "@nestjs/common";
import { HlsAuthController } from "./hls-auth.controller";

@Module({ controllers: [HlsAuthController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class MediaAuthModule {}
