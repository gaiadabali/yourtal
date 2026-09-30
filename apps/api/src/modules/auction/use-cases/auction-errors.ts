import { ConflictException, NotFoundException } from "@nestjs/common";
import type { AuctionRefusal } from "@yourtal/contracts/auction/auction";

export function refusal(code: AuctionRefusal, message: string): ConflictException {
  return new ConflictException({ code, message });
}

export function notFound(): NotFoundException {
  return new NotFoundException({ code: "not_found", message: "No such auction or voucher." });
}
