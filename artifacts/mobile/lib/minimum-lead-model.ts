import type { V2City, V2MinimumLeadRequest, V2LeadReceipt } from '@workspace/api-client-react';

export interface LeadDraft { origin: V2City | null; destination: V2City | null; time: string; operator: string }
export const emptyLeadDraft = (): LeadDraft => ({ origin: null, destination: null, time: '', operator: '' });
export type LeadField = keyof LeadDraft;
export function draftErrors(draft: LeadDraft): Partial<Record<LeadField, string>> {
  const errors: Partial<Record<LeadField, string>> = {};
  if (!draft.origin) errors.origin = 'Choose a departure city from the list.';
  if (!draft.destination) errors.destination = 'Choose a destination city from the list.';
  else if (draft.destination.id === draft.origin?.id) errors.destination = 'Choose a different destination city.';
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(draft.time)) errors.time = 'Enter a departure time in 24-hour format, for example 08:30.';
  const name = draft.operator.trim();
  if (!name || Array.from(name).length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(name) || ['unknown','n/a','-'].includes(name.toLowerCase())) errors.operator = 'Enter the bus operator name.';
  return errors;
}
export function prepareLead(draft: LeadDraft, key: string, entrySurface: V2MinimumLeadRequest['entrySurface'] = 'contribute_tab'): V2MinimumLeadRequest {
  if (Object.keys(draftErrors(draft)).length) throw new Error('Check the four required answers.');
  return { schemaVersion: '1.0', clientSubmissionId: key, entrySurface,
    target: { newLead: { originCityId: draft.origin!.id, destinationCityId: draft.destination!.id,
      departureTime: draft.time, operator: { name: draft.operator.trim() } } }, observations: [] };
}
export interface PendingLead<R = V2MinimumLeadRequest> { actor: string; request: R }
export interface LeadTransport<R = V2MinimumLeadRequest> {
  lookup(key: string): Promise<{ found: boolean; initialReceipt?: V2LeadReceipt }>;
  submit(input: R): Promise<V2LeadReceipt>;
}
/** A lost response never invents another key or replaces its frozen answers. */
export async function recoverOrSubmit<R extends { clientSubmissionId: string }>(pending: PendingLead<R>, transport: LeadTransport<R>, currentActor: () => string | null) {
  function guard() { if (pending.actor !== currentActor()) throw new Error('ACCOUNT_CHANGED'); }
  guard();
  const lookup = await transport.lookup(pending.request.clientSubmissionId);
  guard();
  const receipt = lookup.found ? lookup.initialReceipt : await transport.submit(pending.request);
  guard();
  if (!receipt || receipt.clientSubmissionId.toLowerCase() !== pending.request.clientSubmissionId.toLowerCase() || receipt.saveStatus !== 'saved') throw new Error('SAVE_UNCONFIRMED');
  return receipt;
}
