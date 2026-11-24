import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { wholeMilliseconds, type SetOptions, type Store } from './store.js';

const FILE_NAME = 'yazio-mcp.json';
/** On Windows a virus scanner can hold the file for a moment while we replace it */
const RENAME_ATTEMPTS = 5;

interface Entry {
  /** Value */
  v: string;
  /** Expiry, epoch milliseconds */
  e?: number;
}

/**
 * A store in one JSON file, for a server that runs as one process on a host with a disk.
 * It loads the file once and writes it again after each change. Two processes on the same
 * file overwrite each other: use Redis when more than one instance runs.
 */
export class FileStore implements Store {
  private readonly path: string;
  private entries: Map<string, Entry> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now
  ) {
    this.path = join(dir, FILE_NAME);
  }

  get(key: string): Promise<string | null> {
    return this.run((entries) => this.live(entries, key)?.v ?? null);
  }

  async set(key: string, value: string, options: SetOptions = {}): Promise<boolean> {
    // Checked first, so a wrong value is an error also when the condition does not hold
    const ttl = options.ttlMs === undefined ? undefined : wholeMilliseconds(options.ttlMs);
    return this.run(async (entries) => {
      const existing = this.live(entries, key);
      if (options.if === 'absent' && existing) return false;
      if (options.if === 'present' && !existing) return false;
      const expiry = ttl === undefined ? existing?.e : this.now() + ttl;
      entries.set(key, expiry === undefined ? { v: value } : { v: value, e: expiry });
      await this.save(entries);
      return true;
    });
  }

  take(key: string): Promise<string | null> {
    return this.run(async (entries) => {
      const existing = this.live(entries, key);
      if (!existing) return null;
      entries.delete(key);
      await this.save(entries);
      return existing.v;
    });
  }

  delete(key: string): Promise<void> {
    return this.run(async (entries) => {
      if (entries.delete(key)) await this.save(entries);
    });
  }

  deleteIf(key: string, expected: string): Promise<boolean> {
    return this.run(async (entries) => {
      if (this.live(entries, key)?.v !== expected) return false;
      entries.delete(key);
      await this.save(entries);
      return true;
    });
  }

  replaceIf(key: string, expected: string, value: string): Promise<boolean> {
    return this.run(async (entries) => {
      const existing = this.live(entries, key);
      if (existing?.v !== expected) return false;
      existing.v = value;
      await this.save(entries);
      return true;
    });
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    const ttl = wholeMilliseconds(ttlMs);
    return this.run(async (entries) => {
      const existing = this.live(entries, key);
      if (!existing) return false;
      existing.e = this.now() + ttl;
      await this.save(entries);
      return true;
    });
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    const ttl = wholeMilliseconds(ttlMs);
    return this.run(async (entries) => {
      const existing = this.live(entries, key);
      if (existing && !/^-?\d+$/.test(existing.v)) throw new TypeError('The key is not a counter');
      const count = (existing ? Number(existing.v) : 0) + 1;
      // An existing key keeps its expiry, also when it has none
      const expiry = existing ? existing.e : this.now() + ttl;
      const entry: Entry = { v: String(count) };
      if (expiry !== undefined) entry.e = expiry;
      entries.set(key, entry);
      await this.save(entries);
      return count;
    });
  }

  async close(): Promise<void> {
    await this.queue.catch(() => {});
  }

  /** Runs one operation at a time, so that a read and its write cannot interleave with another */
  private run<T>(operation: (entries: Map<string, Entry>) => T | Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      try {
        return await operation(await this.load());
      } catch (error) {
        // The memory copy can now differ from the file: read the file again next time
        this.entries = undefined;
        throw error;
      }
    });
    this.queue = result.catch(() => {});
    return result;
  }

  private live(entries: Map<string, Entry>, key: string): Entry | undefined {
    const entry = entries.get(key);
    if (entry?.e !== undefined && entry.e <= this.now()) return undefined;
    return entry;
  }

  private async load(): Promise<Map<string, Entry>> {
    if (this.entries) return this.entries;
    let text: string | undefined;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.entries = new Map(text ? Object.entries(JSON.parse(text) as Record<string, Entry>) : []);
    return this.entries;
  }

  private async save(entries: Map<string, Entry>): Promise<void> {
    const now = this.now();
    for (const [key, entry] of entries) {
      if (entry.e !== undefined && entry.e <= now) entries.delete(key);
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    // A new file and a rename: a crash in the middle leaves the old file whole
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(temporary, this.path);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          attempt >= RENAME_ATTEMPTS ||
          (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')
        ) {
          throw error;
        }
        await sleep(20 * attempt);
      }
    }
  }
}
