import { Body, Controller, Inject, Post } from "@nestjs/common";
import { PairDeviceDto } from "./dto/pair-device.schema";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { PAIR_DEVICE_RETENTION_MS } from "./retention";
import { COUNTER_DEVICE_REPOSITORY } from "./persistence/counter-device.repository";
import type { CounterDeviceRepository } from "./persistence/counter-device.repository";
import { pairDevice } from "./use-cases/pair-device.use-case";
import { mapDevicesErrorToHttpException } from "./to-http-exception";

/**
 * `POST /api/devices/pair` (TASKS.md 8.1.a) — a bare physical terminal,
 * never a signed-in person, so there is no `:tenantId` and no session.
 * `@PublicRoute`, backed by `policies/resource_policies/device.yaml`'s own
 * `pair` rule (anonymous, always) — the real gate is the hashed, single-use,
 * 15-minute pairing code, enforced by `pair-device.use-case.ts`'s
 * conditional UPDATE, not by this decorator.
 */
@Controller("api/devices")
export class DevicePairingController {
  constructor(
    @Inject(COUNTER_DEVICE_REPOSITORY) private readonly devices: CounterDeviceRepository,
  ) {}

  @RateLimit({
    routeId: "devices.pair",
    ip: { max: 20, windowSeconds: 60 * 60 },
    route: { max: 500, windowSeconds: 60 * 60 },
  })
  @Idempotent({ retentionMs: PAIR_DEVICE_RETENTION_MS })
  @PublicRoute("no principal exists yet; the hashed one-time pairing code is the real credential")
  @Post("pair")
  async pair(@Body() body: PairDeviceDto) {
    const result = await pairDevice(this.devices, body.pairingCode, new Date());
    if (result.isErr()) throw mapDevicesErrorToHttpException(result.error);
    return { deviceId: result.value.deviceId, credential: result.value.credential };
  }
}
