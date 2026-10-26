import type { V2RouteContributionContext, V2RouteObservationRequest, V2RoutePlaceObservation } from '@workspace/api-client-react';
import { validDate } from './actual-journey-model';
export type PlaceKind = 'pickup' | 'dropoff';
export interface PlaceAnswer { name: string; instructions: string; date: string; knowledge: '' | NonNullable<V2RoutePlaceObservation['knowledgeBasis']> }
export interface PlaceDraft {
  route: (V2RouteContributionContext & { ownerId: string }) | null;
  entrySurface: V2RouteObservationRequest['entrySurface']; needsContextRefresh: boolean;
  selected: PlaceKind[]; pickup: PlaceAnswer; dropoff: PlaceAnswer;
}
export const emptyPlaceAnswer = (): PlaceAnswer => ({ name: '', instructions: '', date: '', knowledge: '' });
export const emptyPlaceDraft = (): PlaceDraft => ({ route: null, entrySurface: 'contribute_tab', needsContextRefresh: false, selected: ['pickup'], pickup: emptyPlaceAnswer(), dropoff: emptyPlaceAnswer() });
export function togglePlace(d: PlaceDraft, kind: PlaceKind): PlaceDraft {
  return d.selected.includes(kind) ? { ...d, selected: d.selected.filter(k => k !== kind), [kind]: emptyPlaceAnswer() } : { ...d, selected: [...d.selected, kind] };
}
export function placeErrors(d: PlaceDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!d.route || d.needsContextRefresh) errors.route = 'Check the route before saving.';
  if (!d.selected.length) errors.selected = 'Choose pickup, drop-off, or both.';
  for (const k of d.selected) {
    if (!d[k].name.trim() || d[k].name.trim().length > 200) errors[k + '.name'] = 'Name the station, rank or landmark.';
    if (d[k].instructions.trim().length > 500) errors[k + '.instructions'] = 'Keep directions within 500 characters.';
    if (d[k].date && !validDate(d[k].date)) errors[k + '.date'] = 'Enter a valid date as YYYY-MM-DD, or leave it blank.';
  }
  return errors;
}
export function preparePlaces(d: PlaceDraft, key: string): V2RouteObservationRequest {
  if (!uuid.test(key) || Object.keys(placeErrors(d)).length || !d.route) throw Error('INVALID_PLACE_DRAFT');
  return { schemaVersion: '1.0', clientSubmissionId: key, entrySurface: d.entrySurface,
    target: { existing: { subjectId: d.route.subjectId, expectedRevision: d.route.revision, identityKey: d.route.identityKey } },
    observations: (['pickup', 'dropoff'] as const).filter(k => d.selected.includes(k)).map(k => ({
      fieldKey: k === 'pickup' ? 'boarding.pickup' : 'alighting.dropoff',
      value: { cityId: (k === 'pickup' ? d.route!.origin : d.route!.destination).id, name: d[k].name.trim(), ...(d[k].instructions.trim() ? { instructions: d[k].instructions.trim() } : {}) }, scope: {},
      ...(d[k].date ? { observedDate: d[k].date } : {}), ...(d[k].knowledge ? { knowledgeBasis: d[k].knowledge } : {}),
    })) };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validPlaceDraft(value: unknown): value is PlaceDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as PlaceDraft;
  if (!['contribute_tab','search_result','route_detail','own_contribution'].includes(d.entrySurface) || typeof d.needsContextRefresh !== 'boolean' || !Array.isArray(d.selected) || d.selected.length > 2 || new Set(d.selected).size !== d.selected.length || d.selected.some(k => !['pickup','dropoff'].includes(k))) return false;
  for (const k of ['pickup','dropoff'] as const) {
    const a = d[k];
    if (!a || typeof a.name !== 'string' || a.name.length > 200 || typeof a.instructions !== 'string' || a.instructions.length > 500 || typeof a.date !== 'string' || a.date.length > 10 || !['','unprovided','travelled','saw_operating','observed_sign','operator_statement','heard_from_other'].includes(a.knowledge)) return false;
  }
  if (d.route === null) return true;
  const r = d.route;
  return !!r && typeof r.ownerId === 'string' && !!r.ownerId && uuid.test(r.subjectId) && Number.isSafeInteger(r.revision) && r.revision > 0 && /^[0-9a-f]{64}$/.test(r.identityKey) && typeof r.operatorName === 'string' && !!r.operatorName.trim() && r.operatorName.length <= 120 && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(r.departureTime) && [r.origin,r.destination].every(c => c && Number.isSafeInteger(c.id) && c.id > 0 && typeof c.name === 'string' && !!c.name && typeof c.placeType === 'string');
}
