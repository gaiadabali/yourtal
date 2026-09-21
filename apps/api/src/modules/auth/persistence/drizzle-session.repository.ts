import { and, eq, isNull, lt } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { sessions } from "./schema/session.table";
import type { SessionRepository, StoredSession } from "./session.repository";

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: { id: string; userId: string; absoluteExpiresAt: Date }): Promise<void> {
    await this.db.insert(sessions).values({
      id: input.id,
      userId: input.userId,
      absoluteExpiresAt: input.absoluteExpiresAt,
    });
  }

  async findById(id: string): Promise<StoredSession | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id));
    return row ?? null;
  }

  async touch(id: string, now: Date): Promise<void> {
    await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }

  async revoke(id: string, now: Date): Promise<void> {
    // Unconditional on current state — setting `revokedAt` on an
    // already-revoked row just writes the same kind of value again, which
    // is what makes a repeated logout a no-op rather than an error.
    await this.db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, id));
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async pruneExpired(now: Date): Promise<number> {
    const removed = await this.db
      .delete(sessions)
      .where(lt(sessions.absoluteExpiresAt, now))
      .returning({ id: sessions.id });
    return removed.length;
  }
}
