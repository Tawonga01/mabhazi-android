import type { V2ActualJourneyRequest } from '@workspace/api-client-react';
import { SecureDraftStore, type DraftStorage } from './secure-draft-store';
import { prepareActual, validActualDraft, type ActualDraft } from './actual-journey-model';
export class ActualDraftStore extends SecureDraftStore<ActualDraft, V2ActualJourneyRequest> {
  constructor(storage: DraftStorage, now = () => Date.now()) {
    super(storage, 'mabhazi_actual_draft_v1', record => {
      if (!validActualDraft(record.draft) || record.draft.route && record.draft.route.ownerId !== record.owner) throw new Error('Invalid journey draft');
      if (record.pending && (record.pending.actor !== record.owner || !record.owner ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.pending.request?.clientSubmissionId) ||
        JSON.stringify(record.pending.request) !== JSON.stringify(prepareActual(record.draft, record.pending.request.clientSubmissionId)))) throw new Error('Pending answers differ');
    }, now);
  }
}
