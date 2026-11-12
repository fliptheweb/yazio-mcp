/**
 * The durable storage of the remote server: a key-value store with expiry.
 * Everything the server remembers between two requests goes through this interface,
 * so that any instance can serve any request.
 *
 * A time to live is a positive number of milliseconds, at most `MAX_TTL_MS`. A store rounds
 * it up to a whole millisecond and refuses any other value with a rejected `RangeError`.
 */
export interface Store {
  get(key: string): Promise<string | null>;
  /**
   * Writes a value. `if: 'absent'` writes only a new key, `if: 'present'` only an existing one.
   * Without `ttlMs` an existing key keeps its time to live and a new key does not expire.
   * Returns whether the value was written.
   */
  set(key: string, value: string, options?: SetOptions): Promise<boolean>;
  /** Reads and deletes in one step, so that only one caller gets the value */
  take(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  /**
   * Deletes the key only if it holds `expected`, in one step. Returns whether it deleted.
   * A caller that got the key a while ago cannot delete the value of a later caller.
   */
  deleteIf(key: string, expected: string): Promise<boolean>;
  /**
   * Writes `value` only if the key holds `expected`, in one step. The key keeps its time
   * to live. Returns whether the value was written.
   */
  replaceIf(key: string, expected: string, value: string): Promise<boolean>;
  /** Gives an existing key a new time to live. Returns whether the key exists. */
  expire(key: string, ttlMs: number): Promise<boolean>;
  /**
   * Adds 1 to a counter that expires `ttlMs` after its first increment. Returns the new count.
   * A counter key is only written by `increment`: on another value the call fails.
   */
  increment(key: string, ttlMs: number): Promise<number>;
  close(): Promise<void>;
}

export interface SetOptions {
  ttlMs?: number;
  if?: 'absent' | 'present';
}

/** Ten years: far above what the server uses, and far inside what every store accepts */
export const MAX_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** The time to live as every store uses it: whole milliseconds, rounded up */
export function wholeMilliseconds(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    throw new RangeError('A time to live must be a positive number of milliseconds');
  }
  return Math.ceil(ttlMs);
}

/**
 * The key of a counter for the time window that `now` is in. A new window starts a new
 * counter, so a limit holds per window on every storage, whatever clock the storage has.
 */
export const windowKey = (name: string, windowMs: number, now: number): string =>
  `${name}:${Math.floor(now / windowMs)}`;
