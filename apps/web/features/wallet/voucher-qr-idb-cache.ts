/**
 * IndexedDB cache for a voucher's rotating QR windows (6.5.b/6.5.c). Twelve
 * consecutive 5-minute-window tokens (`wallet-data.ts`'s `WalletQrDetail.tokens`,
 * 4.5.b) are written here once, right after they are fetched, so the QR
 * keeps rotating through its own already-signed windows for up to an hour
 * with the network off — nothing about redeeming a voucher should depend on
 * a signal bar at the counter.
 *
 * IndexedDB, not localStorage (which the rest of this feature's caches use,
 * e.g. `voucher-detail-cache.ts`): the QR payload for a whole hour, times
 * however many vouchers are held, is small but unbounded, and IndexedDB is
 * the storage this repo already reaches for once a cache stops being "one
 * small record" (docs/15 stack lock). A dedicated object store, not reused
 * from anywhere else — this is the only feature that needs one today.
 *
 * Every call is best-effort and never throws: a private browsing tab, a
 * blocked/quota-exceeded store, or a test environment with no `indexedDB`
 * global at all must all degrade to "no cache", never break rendering —
 * same contract as `voucher-detail-cache.ts`'s localStorage reads/writes.
 */
const DB_NAME = "yourtal-wallet-qr";
const DB_VERSION = 1;
const STORE_NAME = "qr-windows";

export interface CachedQrWindow {
  token: string;
  expiresAt: string;
}

export interface CachedQrEntry {
  voucherId: string;
  windows: CachedQrWindow[];
  cachedAt: string;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "voucherId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });
}

/** Reads the cached QR windows for one voucher, or `null` on any miss or failure. Never throws. */
export async function readCachedQrWindows(voucherId: string): Promise<CachedQrEntry | null> {
  if (!hasIndexedDb()) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(voucherId);
      request.onsuccess = () => resolve((request.result as CachedQrEntry | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Best-effort write-through of a fresh batch of QR windows. A failed write must never break rendering. */
export async function writeCachedQrWindows(entry: CachedQrEntry): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Private mode, quota exceeded, or storage disabled — the caller keeps
    // working from its in-memory windows for this page view.
  }
}
