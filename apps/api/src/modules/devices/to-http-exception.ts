import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type {
  DeviceLockedError,
  DeviceNotFoundError,
  LocationNotFoundError,
  PairingCodeInvalidError,
  PersistenceFailedError,
  PinIncorrectError,
} from "./devices.errors";

const logger = new Logger("DevicesErrorMapper");

export type DevicesDomainError =
  | LocationNotFoundError
  | DeviceNotFoundError
  | PairingCodeInvalidError
  | DeviceLockedError
  | PinIncorrectError
  | PersistenceFailedError;

export function mapDevicesErrorToHttpException(error: DevicesDomainError): HttpException {
  switch (error.type) {
    case "location_not_found":
      return new NotFoundException({
        code: "location_not_found",
        message: `location ${error.locationId} is not one of this business's own`,
      });
    case "device_not_found":
      return new NotFoundException({
        code: "device_not_found",
        message: `device ${error.deviceId} was not found`,
      });
    case "pairing_code_invalid":
      // Deliberately the same refusal for unknown, expired and already-used
      // — see pair-device.use-case.ts's own comment.
      return new BadRequestException({
        code: "pairing_code_invalid",
        message: "this pairing code is not valid",
      });
    case "device_locked":
      return new UnauthorizedException({
        code: "device_locked",
        message: `too many incorrect PINs; locked until ${error.lockedUntil}`,
      });
    case "pin_incorrect":
      return new UnauthorizedException({ code: "pin_incorrect", message: "incorrect PIN" });
    case "persistence_failed":
      logger.error(error.cause);
      return new ServiceUnavailableException({
        code: "persistence_unavailable",
        message: "the request could not be completed",
      });
    default: {
      const unreachable: never = error;
      return new ServiceUnavailableException({
        code: "unknown_error",
        message: String(unreachable),
      });
    }
  }
}
