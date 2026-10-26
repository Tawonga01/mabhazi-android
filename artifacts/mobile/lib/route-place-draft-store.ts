import type { V2RouteObservationRequest } from '@workspace/api-client-react';
import { SecureDraftStore, type DraftStorage } from './secure-draft-store';
import { preparePlaces, validPlaceDraft, type PlaceDraft } from './route-place-model';
export class RoutePlaceDraftStore extends SecureDraftStore<PlaceDraft, V2RouteObservationRequest> {
  constructor(storage: DraftStorage, now = () => Date.now()) {
    super(storage, 'mabhazi_place_draft_v1', record => {
      if (!validPlaceDraft(record.draft) || record.draft.route && record.draft.route.ownerId !== record.owner) throw Error('INVALID_PLACE_DRAFT');
      if (record.pending && (!record.owner || record.pending.actor !== record.owner || JSON.stringify(record.pending.request) !== JSON.stringify(preparePlaces(record.draft, record.pending.request.clientSubmissionId)))) throw Error('PENDING_PLACE_ANSWERS_DIFFER');
    }, now);
  }
}
