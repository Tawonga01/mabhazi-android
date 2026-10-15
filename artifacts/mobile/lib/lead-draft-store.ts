import { prepareLead, type LeadDraft, type PendingLead } from './minimum-lead-model';

export interface DraftRecord { version: 1; owner: string | null; updatedAt: number; draft: LeadDraft; pending?: PendingLead }
export interface DraftStorage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
const PREFIX = 'mabhazi_lead_draft_v1';
const MAX_CHUNKS = 16;
const TTL = 30 * 24 * 60 * 60 * 1000;
const key = (slot: string, suffix: string) => `${PREFIX}_${slot}_${suffix}`;
const bytes = (value: string) => encodeURIComponent(value).replace(/%[A-F\d]{2}/gi, 'x').length;

/** Two encrypted banks retain the previous complete draft on a partial write. */
export class LeadDraftStore {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  constructor(private storage: DraftStorage, private now = () => Date.now()) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  private slot(owner: string | null) { return owner === null ? 'guest' : 'account'; }
  private async purge(slot: string) {
    // Invalidate the pointer first; every possible partial bank is also removed.
    await this.storage.remove(key(slot, 'manifest'));
    for (const bank of [0, 1]) for (let i = 0; i < MAX_CHUNKS; i++) await this.storage.remove(key(slot, `${bank}_${i}`));
  }
  read(owner: string | null): Promise<DraftRecord | null> {
    return this.serial(async () => {
      const slot = this.slot(owner), raw = await this.storage.get(key(slot, 'manifest'));
      if (!raw) return null;
      try {
        const manifest = JSON.parse(raw);
        if (![0, 1].includes(manifest.bank) || !Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > MAX_CHUNKS) throw new Error('Invalid manifest');
        let data = '';
        for (let i = 0; i < manifest.count; i++) {
          const chunk = await this.storage.get(key(slot, `${manifest.bank}_${i}`));
          if (chunk === null) throw new Error('Incomplete draft');
          data += chunk;
        }
        if (bytes(data) > 16384) throw new Error('Oversize draft');
        const record = JSON.parse(data) as DraftRecord;
        if (record.version !== 1 || record.owner !== owner) return null;
        if (!Number.isFinite(record.updatedAt) || record.updatedAt > this.now() || this.now() - record.updatedAt >= TTL) { await this.purge(slot); return null; }
        if (!record.draft || typeof record.draft.time !== 'string' || typeof record.draft.operator !== 'string' || record.draft.time.length > 5 || record.draft.operator.length > 240) throw new Error('Invalid draft');
        for (const city of [record.draft.origin, record.draft.destination]) if (city !== null && (!city || !Number.isInteger(city.id) || city.id < 1 || typeof city.name !== 'string' || city.name.length > 200 || typeof city.placeType !== 'string')) throw new Error('Invalid city');
        if (record.pending && (record.pending.actor !== owner || !record.pending.request || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.pending.request.clientSubmissionId))) throw new Error('Invalid pending draft');
        if (record.pending && JSON.stringify(record.pending.request) !== JSON.stringify(prepareLead(record.draft, record.pending.request.clientSubmissionId))) throw new Error('Pending answers differ');
        return record;
      } catch { await this.purge(slot); return null; }
    });
  }
  write(record: DraftRecord): Promise<void> {
    const epoch = this.epoch;
    const data = JSON.stringify(record);
    return this.serial(async () => {
      if (epoch !== this.epoch) throw new Error('DRAFT_CLEARED');
      if (bytes(data) > 16384) throw new Error('Draft is too large to save securely.');
      const chunks = Array.from(data).reduce<string[]>((parts, char, i) => { if (i % 300 === 0) parts.push(''); parts[parts.length - 1] += char; return parts; }, []);
      if (chunks.length > MAX_CHUNKS) throw new Error('Draft is too large to save securely.');
      const slot = this.slot(record.owner), previous = await this.storage.get(key(slot, 'manifest'));
      let bank = 0;
      try { bank = JSON.parse(previous ?? '{}').bank === 0 ? 1 : 0; } catch { /* overwrite malformed pointer */ }
      for (let i = 0; i < chunks.length; i++) {
        if (epoch !== this.epoch) throw new Error('DRAFT_CLEARED');
        await this.storage.set(key(slot, `${bank}_${i}`), chunks[i]);
      }
      if (epoch !== this.epoch) throw new Error('DRAFT_CLEARED');
      await this.storage.set(key(slot, 'manifest'), JSON.stringify({ bank, count: chunks.length }));
      // Remove the old bank so historical answers are not retained indefinitely.
      for (let i = 0; i < MAX_CHUNKS; i++) await this.storage.remove(key(slot, `${1 - bank}_${i}`));
      for (let i = chunks.length; i < MAX_CHUNKS; i++) await this.storage.remove(key(slot, `${bank}_${i}`));
    });
  }
  remove(owner: string | null): Promise<void> { return this.serial(() => this.purge(this.slot(owner))); }
  clear(): Promise<void> {
    this.epoch++;
    return this.serial(async () => { await this.purge('guest'); await this.purge('account'); });
  }
}
