import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { ResourceAttributeLoader } from "../../shared/authz/resource-attribute-loader";
import {
  VOUCHER_INTERNAL_CLIENT,
  type VoucherInternalClient,
} from "../../shared/voucher-client/voucher-internal-client";

/**
 * The `wallet` resource for `account_owner` (4.8.a). A wallet is always the
 * caller's own, so its owner is the caller. A route naming a voucher asks
 * the voucher service for it AS the caller: one they do not hold is a 404,
 * never someone else's wallet.
 */
@Injectable()
export class WalletAttributeLoader implements ResourceAttributeLoader<"wallet"> {
  readonly kind = "wallet" as const;

  constructor(
    private readonly principals: PrincipalService,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
  ) {}

  async resolve(
    request: FastifyRequest,
  ): Promise<{ readonly id: string; readonly attr: Readonly<Record<string, unknown>> } | null> {
    const principal = await this.principals.resolve(request);
    if (!principal.roles.includes("user")) return { id: principal.id, attr: { ownerId: "" } };

    const voucherId = voucherIdOf(request);
    if (voucherId !== undefined) {
      if (!(await this.holds(voucherId, principal.id))) return null;
    }
    return { id: principal.id, attr: { ownerId: principal.id } };
  }

  // The fake throws for an unknown voucher; either way the caller holds nothing.
  private async holds(voucherId: string, ownerId: string): Promise<boolean> {
    try {
      return (await this.vouchers.get({ voucherId, ownerId })).isOk();
    } catch {
      return false;
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function voucherIdOf(request: FastifyRequest): string | undefined {
  const params: unknown = request.params;
  if (typeof params !== "object" || params === null) return undefined;
  const value: unknown = Reflect.get(params, "voucherId");
  if (typeof value !== "string") return undefined;
  // A malformed id names no voucher anyone holds.
  return UUID.test(value) ? value : "00000000-0000-0000-0000-000000000000";
}
