import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { credentials } from "./schema/credential.table";
import type { Credential, CredentialRepository } from "./credential.repository";

export class DrizzleCredentialRepository implements CredentialRepository {
  constructor(private readonly db: AppDb) {}

  async findByUserAndKind(userId: string, kind: string): Promise<Credential | null> {
    const [row] = await this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, kind)));
    return row ?? null;
  }

  async findByKindAndIdentifier(kind: string, identifier: string): Promise<Credential | null> {
    const [row] = await this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.kind, kind), eq(credentials.identifier, identifier)));
    return row ?? null;
  }

  async create(input: {
    userId: string;
    kind: string;
    identifier: string;
    secretHash: string;
  }): Promise<boolean> {
    // `onConflictDoNothing` targeting `(kind, identifier)` — NOT the primary
    // key. `userId` is a fresh `crypto.randomUUID()` minted by the caller
    // before this runs, so a primary-key collision on `(user_id, kind)` is
    // not a real race to defend against; the race that matters is two
    // concurrent registrations for the SAME email, which is exactly what
    // `UNIQUE (kind, identifier)` exists to catch. The empty `returning()`
    // result on conflict is how the caller learns it lost that race —
    // exactly the "attempt, don't ask-then-act" shape
    // `checkpoint-nonce.repository.ts` already documents at length for the
    // same reason (a read-then-write pair cannot be made race-free here
    // either).
    const inserted = await this.db
      .insert(credentials)
      .values({
        userId: input.userId,
        kind: input.kind,
        identifier: input.identifier,
        secretHash: input.secretHash,
      })
      .onConflictDoNothing({ target: [credentials.kind, credentials.identifier] })
      .returning({ userId: credentials.userId });
    return inserted.length > 0;
  }

  async updateSecret(userId: string, kind: string, secretHash: string): Promise<boolean> {
    const updated = await this.db
      .update(credentials)
      .set({ secretHash, updatedAt: new Date() })
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, kind)))
      .returning({ userId: credentials.userId });
    return updated.length > 0;
  }
}
