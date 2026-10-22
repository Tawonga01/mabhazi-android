import { prepareLead, type LeadDraft } from './minimum-lead-model';
import type { V2MinimumLeadRequest } from '@workspace/api-client-react';
import { SecureDraftStore, type SecureDraftRecord, type DraftStorage } from './secure-draft-store';
export type { DraftStorage } from './secure-draft-store';
export type DraftRecord = SecureDraftRecord<LeadDraft, V2MinimumLeadRequest>;
export class LeadDraftStore extends SecureDraftStore<LeadDraft, V2MinimumLeadRequest> {
  constructor(storage: DraftStorage, now = () => Date.now()) {
    super(storage, 'mabhazi_lead_draft_v1', record => {
        if (!record.draft || typeof record.draft.time !== 'string' || typeof record.draft.operator !== 'string' || record.draft.time.length > 5 || record.draft.operator.length > 240) throw new Error('Invalid draft');
        for (const city of [record.draft.origin, record.draft.destination]) if (city !== null && (!city || !Number.isInteger(city.id) || city.id < 1 || typeof city.name !== 'string' || city.name.length > 200 || typeof city.placeType !== 'string')) throw new Error('Invalid city');
        if (record.pending && (record.pending.actor !== record.owner || !record.pending.request || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.pending.request.clientSubmissionId))) throw new Error('Invalid pending draft');
        if (record.pending && JSON.stringify(record.pending.request) !== JSON.stringify(prepareLead(record.draft, record.pending.request.clientSubmissionId))) throw new Error('Pending answers differ');
    }, now);
  }
}
