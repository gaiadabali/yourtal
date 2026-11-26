import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";

/**
 * The management API's errors, all `{ code, message }` (spambank/BUILD.md section 5). Built here so a
 * use-case and a controller say the same thing, and the code is always one a client can switch on.
 */

export const unknownSubject = (): HttpException =>
  new NotFoundException({ code: "unknown_subject", message: "no such person in this app" });

/** A teen, an account on hold, outside the app's regions, the app's consent ended, or a suspended mailbox. */
export const notAllowed = (message = "this person may not use Spambank"): HttpException =>
  new ForbiddenException({ code: "not_allowed", message });

export const notEnabled = (): HttpException =>
  new ConflictException({ code: "not_enabled", message: "the person has no mailbox yet" });

export const mailboxErasing = (): HttpException =>
  new ConflictException({
    code: "mailbox_erasing",
    message: "the mailbox is being deleted; try again in a few minutes",
  });

export const appPasswordLimit = (): HttpException =>
  new ConflictException({
    code: "app_password_limit",
    message: "five app passwords already exist; revoke one first",
  });

export const spambankUnavailable = (
  message = "the mail server could not be reached; try again shortly",
): HttpException => new ServiceUnavailableException({ code: "spambank_unavailable", message });

/** YourTal's own switch (`SPAMBANK_ENABLED`) is off. */
export const switchedOff = (): HttpException =>
  new NotFoundException({ code: "not_found", message: "Spambank is switched off" });

export const noSetting = (): HttpException =>
  new BadRequestException({
    code: "no_setting",
    message: "send at least one of statementsToSnapApp and newMailAlerts",
  });

/** An app password id that is not one of ours (the path is not an id at all). */
export const notFoundAppPassword = (): HttpException =>
  new NotFoundException({ code: "not_found", message: "no such app password" });
