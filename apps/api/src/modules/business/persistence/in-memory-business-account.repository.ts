import type { Business } from "@yourtal/contracts/business";
import type { BusinessAccountRepository } from "./business-account.repository";
import type { InMemoryBusinessStore } from "./in-memory-business-store";

export class InMemoryBusinessAccountRepository implements BusinessAccountRepository {
  constructor(private readonly store: InMemoryBusinessStore) {}

  findById(businessId: string): Promise<Business | null> {
    return Promise.resolve(this.store.businesses.get(businessId) ?? null);
  }
}
