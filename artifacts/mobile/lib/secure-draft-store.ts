import type { PendingLead } from './minimum-lead-model';

export interface SecureDraftRecord<D, R> { version: 1; owner: string | null; updatedAt: number; draft: D; pending?: PendingLead<R> }
export interface DraftStorage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
const MAX_CHUNKS = 16;
const TTL = 30 * 24 * 60 * 60 * 1000;
const bytes = (value: string) => encodeURIComponent(value).replace(/%[A-F\d]{2}/gi, 'x').length;

/** Two encrypted banks retain the previous complete draft on a partial write. */
export class SecureDraftStore<D, R> {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  constructor(private storage: DraftStorage, private prefix: string, private validate: (record: SecureDraftRecord<D, R>) => void, private now = () => Date.now()) {}
  private key(slot: string, suffix: string) { return `${this.prefix}_${slot}_${suffix}`; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  private slot(owner: string | null) { return owner === null ? 'guest' : 'account'; }
  private async purge(slot: string) {
    // Invalidate the pointer first; every possible partial bank is also removed.
    await this.storage.remove(this.key(slot, 'manifest'));
    for (const bank of [0, 1]) for (let i = 0; i < MAX_CHUNKS; i++) await this.storage.remove(this.key(slot, `${bank}_${i}`));
  }
  read(owner: string | null): Promise<SecureDraftRecord<D, R> | null> {
    return this.serial(async () => {
      const slot = this.slot(owner), raw = await this.storage.get(this.key(slot, 'manifest'));
      if (!raw) return null;
      try {
        const manifest = JSON.parse(raw);
        if (![0, 1].includes(manifest.bank) || !Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > MAX_CHUNKS) throw new Error('Invalid manifest');
        let data = '';
        for (let i = 0; i < manifest.count; i++) {
          const chunk = await this.storage.get(this.key(slot, `${manifest.bank}_${i}`));
          if (chunk === null) throw new Error('Incomplete draft');
          data += chunk;
        }
        if (bytes(data) > 16384) throw new Error('Oversize draft');
        const record = JSON.parse(data) as SecureDraftRecord<D, R>;
        if (record.version !== 1 || record.owner !== owner) return null;
        if (!Number.isFinite(record.updatedAt) || record.updatedAt > this.now() || this.now() - record.updatedAt >= TTL) { await this.purge(slot); return null; }
        this.validate(record);
        return record;
      } catch { await this.purge(slot); return null; }
    });
  }
  write(record: SecureDraftRecord<D, R>): Promise<void> {
    const epoch = this.epoch;
    const data = JSON.stringify(record);
    return this.serial(async () => {
      if (epoch !== this.epoch) throw new Error('DRAFT_CLEARED');
      if (bytes(data) > 16384) throw new Error('Draft is too large to save securely.');
      const chunks = Array.from(data).reduce<string[]>((parts, char, i) => { if (i % 300 === 0) parts.push(''); parts[parts.length - 1] += char; return parts; }, []);
      if (chunks.length > MAX_CHUNKS) throw new Error('Draft is too large to save securely.');
      const slot = this.slot(record.owner), previous = await this.storage.get(this.key(slot, 'manifest'));
      let bank = 0;
      try { bank = JSON.parse(previous ?? '{}').bank === 0 ? 1 : 0; } catch { /* overwrite malformed pointer */ }
      for (let i = 0; i < chunks.length; i++) {
        if (epoch !== this.epoch) throw new Error('DRAFT_CLEARED');
        await this.storage.set(this.key(slot, `${bank}_${i}`), chunks[i]);
      }
      if (epoch !== this.epoch) throw new Error('DRAFT_CLEARED');
      await this.storage.set(this.key(slot, 'manifest'), JSON.stringify({ bank, count: chunks.length }));
      // Remove the old bank so historical answers are not retained indefinitely.
      for (let i = 0; i < MAX_CHUNKS; i++) await this.storage.remove(this.key(slot, `${1 - bank}_${i}`));
      for (let i = chunks.length; i < MAX_CHUNKS; i++) await this.storage.remove(this.key(slot, `${bank}_${i}`));
    });
  }
  remove(owner: string | null): Promise<void> { return this.serial(() => this.purge(this.slot(owner))); }
  clear(): Promise<void> {
    this.epoch++;
    return this.serial(async () => { await this.purge('guest'); await this.purge('account'); });
  }
}
