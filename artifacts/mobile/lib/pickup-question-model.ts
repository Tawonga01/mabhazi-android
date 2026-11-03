import type { V2PickupQuestionEventRequest, V2PickupQuestionReservation, V2PickupQuestionState } from '@workspace/api-client-react';
import type { PlaceDraft } from './route-place-model';

export type PickupDeclaration = V2PickupQuestionReservation['declaredContext'][number];
export interface PickupQuestionDraft {
  subjectId: string; identityKey: string; requestId: string; declaration: '' | PickupDeclaration;
  phase: 'setup' | 'reserving' | 'offered' | 'answer' | 'none' | 'ended';
  invitationId?: string; reason?: string;
  events: (V2PickupQuestionEventRequest & { sent: boolean })[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const declarations = ['', 'knows_route', 'at_stop', 'travelled'];
const outcomes = ['shown', 'opened', 'skip', 'dismiss', 'unknown'];
export function newPickupQuestion(d: PlaceDraft, requestId: string): PickupQuestionDraft {
  if (!d.route || !uuid.test(requestId)) throw Error('QUESTION_TARGET_REQUIRED');
  return { subjectId: d.route.subjectId, identityKey: d.route.identityKey, requestId, declaration: '', phase: 'setup', events: [] };
}
export function validPickupQuestion(q: PickupQuestionDraft, d: PlaceDraft) {
  if (!q || !d.route || q.subjectId !== d.route.subjectId || q.identityKey !== d.route.identityKey || !uuid.test(q.requestId) || !declarations.includes(q.declaration) || !['setup','reserving','offered','answer','none','ended'].includes(q.phase)) return false;
  if (q.invitationId !== undefined && !uuid.test(q.invitationId) || q.reason !== undefined && (typeof q.reason !== 'string' || q.reason.length > 40)) return false;
  if (q.phase !== 'setup' && !q.declaration || ['offered','answer','ended'].includes(q.phase) && !q.invitationId) return false;
  if (!Array.isArray(q.events) || q.events.length > 5 || q.events.some(e => !e || typeof e !== 'object') || new Set(q.events.map(e => e.outcome)).size !== q.events.length || new Set(q.events.map(e => e.clientEventId)).size !== q.events.length) return false;
  if (q.events.some(e => !e || !uuid.test(e.clientEventId) || !outcomes.includes(e.outcome) || typeof e.sent !== 'boolean' || typeof e.timezone !== 'string' || e.timezone.length > 100 || !validTimezone(e.timezone))) return false;
  if (q.events.filter(e => ['skip','dismiss','unknown'].includes(e.outcome)).length > 1) return false;
  return q.phase !== 'answer' || q.events.some(e => e.outcome === 'opened');
}
export function validTimezone(value: string) { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; } }
export function reservationFor(d: PlaceDraft): V2PickupQuestionReservation {
  const q = d.question;
  if (!q || !q.declaration || !validPickupQuestion(q, d)) throw Error('QUESTION_CONTEXT_REQUIRED');
  return { clientRequestId: q.requestId, subjectId: q.subjectId, entrySurface: d.entrySurface, declaredContext: [q.declaration] };
}
export function acceptPickupQuestion(d: PlaceDraft, state: V2PickupQuestionState): PlaceDraft {
  const q = d.question;
  if (!q || !d.route) throw Error('QUESTION_TARGET_REQUIRED');
  if (state.status !== 'offered' && state.status !== 'opened') return { ...d, question: { ...q, phase: 'none', reason: state.status } };
  if (state.questionKey !== 'pickup_place' || state.formSchemaId !== 'boarding-pickup/1' || state.route.subjectId !== q.subjectId || state.route.identityKey !== q.identityKey) return { ...d, question: { ...q, phase: 'none', reason: 'reconfirm_identity' } };
  return { ...d, selected: ['pickup'], route: { ...state.route, ownerId: d.route.ownerId }, question: { ...q, phase: 'offered', invitationId: state.invitationId } };
}
/** The event is frozen in the encrypted draft before it can be transmitted. */
export function queuePickupEvent(d: PlaceDraft, outcome: V2PickupQuestionEventRequest['outcome'], id: string, timezone: string): PlaceDraft {
  const q = d.question;
  if (!q?.invitationId || !['offered','answer'].includes(q.phase) || !uuid.test(id) || !validTimezone(timezone)) throw Error('QUESTION_EVENT_UNAVAILABLE');
  if (q.events.some(e => e.outcome === outcome)) return d;
  if (q.events.some(e => ['skip','dismiss','unknown'].includes(e.outcome))) throw Error('QUESTION_FEEDBACK_FROZEN');
  return { ...d, question: { ...q, phase: outcome === 'opened' ? 'answer' : q.phase, events: [...q.events, { clientEventId: id, outcome, timezone, sent: false }] } };
}
export function acknowledgePickupEvent(d: PlaceDraft, id: string): PlaceDraft {
  const q = d.question, event = q?.events.find(e => e.clientEventId === id);
  if (!q || !event) throw Error('QUESTION_EVENT_REQUIRED');
  return { ...d, question: { ...q, events: q.events.map(e => e.clientEventId === id ? { ...e, sent: true } : e), phase: event.outcome === 'opened' ? 'answer' : ['skip','dismiss','unknown'].includes(event.outcome) ? 'ended' : q.phase } };
}
export function independentPlaces(d: PlaceDraft): PlaceDraft {
  const { question, ...ordinary } = d;
  return { ...ordinary, needsContextRefresh: question?.reason === 'reconfirm_identity' || d.needsContextRefresh };
}
