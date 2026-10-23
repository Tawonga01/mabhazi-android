import type { V2ActualJourneyRequest, V2ActualObservation, V2ActualFareScope, V2ActualContext, V2City } from '@workspace/api-client-react';
export type ActualFact = 'departure' | 'arrival' | 'fare' | 'operator' | 'place';
export interface ClockDraft { time: string; date: string; zone: string }
export interface FareDraft {
  amount: string; currency: string; basis: '' | 'paid' | 'quoted' | 'advertised';
  origin: V2City | null; destination: V2City | null; date: string;
  passenger: '' | V2ActualFareScope['passengerCategory']; passengerLabel: string;
  ticket: '' | V2ActualFareScope['ticketBasis']; ticketLabel: string;
}
export interface ActualDraft {
  facts: ActualFact[]; departure: ClockDraft; arrival: ClockDraft; operator: string; operatorDate: string;
  place: { kind: '' | 'pickup' | 'dropoff'; city: V2City | null; name: string; instructions: string; date: string };
  fare: FareDraft; serviceDate: string; timezone: string; knowledgeBasis: '' | NonNullable<V2ActualContext['knowledgeBasis']>;
}
export const emptyFare = (): FareDraft => ({ amount: '', currency: '', basis: '', origin: null, destination: null, date: '', passenger: '', passengerLabel: '', ticket: '', ticketLabel: '' });
export const emptyActualDraft = (): ActualDraft => ({ facts: [], departure: { time: '', date: '', zone: '' }, arrival: { time: '', date: '', zone: '' }, operator: '', operatorDate: '', place: { kind: '', city: null, name: '', instructions: '', date: '' }, fare: emptyFare(), serviceDate: '', timezone: '', knowledgeBasis: '' });
export const knowledgeChoices = [['travelled', 'I travelled'], ['saw_operating', 'I saw the bus'], ['observed_sign', 'I saw a sign'], ['operator_statement', 'Operator told me'], ['heard_from_other', 'Someone told me'], ['unprovided', 'Not provided']] as const;
export const fareCurrencies = ['USD', 'ZAR', 'ZWG', 'BWP', 'ZMW', 'MZN'] as const;
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validZone(value: string) {
  if (/^[+-]/.test(value)) return false; // Offset input has its own bounded validator.
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return !!value && value.length <= 100; } catch { return false; }
}
const offset = /^[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$/;
const named = (s: string, max: number) => !!s.trim() && Array.from(s.trim()).length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(s);
export function fareErrors(f: FareDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!/^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$/.test(f.amount)) e['fare.amount'] = 'Enter an amount with up to two decimal places. Enter 0 only for a free fare.';
  if (!(fareCurrencies as readonly string[]).includes(f.currency)) e['fare.currency'] = 'Choose the currency.';
  if (!['paid', 'quoted', 'advertised'].includes(f.basis)) e['fare.basis'] = 'Choose paid, quoted or advertised.';
  if (!f.origin) e['fare.origin'] = 'Choose the fare departure city.';
  if (!f.destination || f.destination.id === f.origin?.id) e['fare.destination'] = 'Choose a different fare destination city.';
  if ((f.basis === 'paid' || f.date) && !validDate(f.date)) e['fare.date'] = 'Enter a valid date as YYYY-MM-DD. A paid fare needs its travel date.';
  if (!['adult','child','concession','other','unknown'].includes(f.passenger)) e['fare.passenger'] = 'Choose a passenger category, or Unknown.';
  if (f.passenger === 'other' && !named(f.passengerLabel, 120)) e['fare.passengerLabel'] = 'Describe the passenger category.';
  if (!['one_way','return','other','unknown'].includes(f.ticket)) e['fare.ticket'] = 'Choose a ticket type, or Unknown.';
  if (f.ticket === 'other' && !named(f.ticketLabel, 120)) e['fare.ticketLabel'] = 'Describe the ticket type.';
  return e;
}
export function actualErrors(d: ActualDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.facts.length) e.facts = 'Choose at least one thing you can report.';
  if (d.serviceDate && !validDate(d.serviceDate)) e.serviceDate = 'Enter a valid journey date as YYYY-MM-DD, or leave it unknown.';
  if (d.timezone && !validZone(d.timezone.trim())) e.timezone = 'Enter an IANA timezone, for example Africa/Harare, or leave it unknown.';
  if (d.knowledgeBasis && !knowledgeChoices.some(([key]) => key === d.knowledgeBasis)) e.knowledgeBasis = 'Choose how you know, or leave it unprovided.';
  for (const fact of ['departure', 'arrival'] as const) if (d.facts.includes(fact)) {
    const c = d[fact];
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(c.time)) e[`${fact}.time`] = 'Enter an actual clock time as HH:MM, for example 08:30.';
    if (c.date && !validDate(c.date)) e[`${fact}.date`] = 'Enter a valid date as YYYY-MM-DD, or leave it unknown.';
    if (c.zone && !offset.test(c.zone.trim()) && !validZone(c.zone.trim())) e[`${fact}.zone`] = 'Use an IANA timezone or UTC offset, for example Africa/Harare or +02:00.';
  }
  if (d.facts.includes('operator') && (!named(d.operator, 120) || ['unknown','n/a','-'].includes(d.operator.trim().toLowerCase()))) e.operator = 'Enter the operator you observed, or remove this fact.';
  if (d.facts.includes('operator') && d.operatorDate && !validDate(d.operatorDate)) e.operatorDate = 'Enter a valid operator observation date as YYYY-MM-DD, or leave it unknown.';
  if (d.facts.includes('place')) {
    if (!['pickup', 'dropoff'].includes(d.place.kind)) e['place.kind'] = 'Choose pickup or drop-off.';
    if (!d.place.city) e['place.city'] = 'Choose the city containing this place.';
    if (!named(d.place.name, 200)) e['place.name'] = 'Enter the place name.';
    if (Array.from(d.place.instructions).length > 500 || /[\u0000-\u001f\u007f-\u009f]/.test(d.place.instructions)) e['place.instructions'] = 'Use up to 500 characters without line breaks.';
    if (d.place.date && !validDate(d.place.date)) e['place.date'] = 'Enter a valid place observation date as YYYY-MM-DD, or leave it unknown.';
  }
  if (d.facts.includes('fare')) Object.assign(e, fareErrors(d.fare));
  return e;
}
/** Removing a fact erases its hidden answers; reopening never revives them. */
export function toggleActualFact(d: ActualDraft, fact: ActualFact): ActualDraft {
  if (!d.facts.includes(fact)) return { ...d, facts: [...d.facts, fact] };
  const empty = emptyActualDraft();
  return { ...d, facts: d.facts.filter(f => f !== fact), [fact]: empty[fact], ...(fact === 'operator' ? { operatorDate: '' } : {}) };
}
export function prepareActual(d: ActualDraft, key: string): V2ActualJourneyRequest {
  if (Object.keys(actualErrors(d)).length) throw new Error('Check the marked report answers.');
  const observations: V2ActualObservation[] = [];
  for (const fact of ['departure', 'arrival'] as const) if (d.facts.includes(fact)) {
    const c = d[fact], zone = c.zone.trim();
    observations.push({ fieldKey: fact === 'departure' ? 'departure.actual' : 'arrival.actual', value: { time: c.time },
      scope: { schemaVersion: '1.0', ...(c.date ? { serviceDate: c.date } : {}), ...(zone ? offset.test(zone) ? { utcOffset: zone } : { timezone: zone } : {}) } });
  }
  if (d.facts.includes('operator')) observations.push({ fieldKey: 'operator.reported', value: { name: d.operator.trim() }, scope: {}, ...(d.operatorDate ? { observedDate: d.operatorDate } : {}) });
  if (d.facts.includes('place')) observations.push({ fieldKey: d.place.kind === 'pickup' ? 'boarding.pickup' : 'alighting.dropoff', value: { cityId: d.place.city!.id, name: d.place.name.trim(), ...(d.place.instructions.trim() ? { instructions: d.place.instructions.trim() } : {}) }, scope: {}, ...(d.place.date ? { observedDate: d.place.date } : {}) });
  if (d.facts.includes('fare')) {
    const f = d.fare;
    observations.push({ fieldKey: `fare.${f.basis}` as 'fare.paid' | 'fare.quoted' | 'fare.advertised', value: { amount: f.amount, currency: f.currency }, scope: {
      schemaVersion: '1.0', segment: { kind: 'city_pair', originCityId: f.origin!.id, destinationCityId: f.destination!.id },
      passengerCategory: f.passenger as V2ActualFareScope['passengerCategory'], ticketBasis: f.ticket as V2ActualFareScope['ticketBasis'],
      ...(f.passenger === 'other' ? { passengerLabel: f.passengerLabel.trim() } : {}), ...(f.ticket === 'other' ? { ticketLabel: f.ticketLabel.trim() } : {}),
      ...(f.date ? f.basis === 'paid' ? { serviceDate: f.date } : f.basis === 'quoted' ? { quotationDate: f.date } : { sourceDate: f.date } : {}),
    } });
  }
  // Header context is never copied into individual clock or fare scopes.
  return { schemaVersion: '1.0', clientSubmissionId: key, entrySurface: 'contribute_tab', target: { newActualJourney: {
    ...(d.serviceDate ? { reportedServiceDate: d.serviceDate } : {}), ...(d.timezone.trim() ? { timezone: d.timezone.trim() } : {}),
  } }, observations, ...(d.knowledgeBasis ? { actualContext: { knowledgeBasis: d.knowledgeBasis } } : {}) };
}
/** Validate storage shape separately: incomplete, unsent answers are legitimate. */
export function validActualDraft(value: unknown): value is ActualDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as ActualDraft, empty = emptyActualDraft();
  function shape(v: unknown, template: unknown): boolean {
    if (template === null) { const c = v as V2City | null; return c === null || !!c && Number.isInteger(c.id) && c.id > 0 && typeof c.name === 'string' && c.name.length <= 200 && typeof c.placeType === 'string'; }
    if (typeof template === 'string') return typeof v === 'string' && v.length <= 1000;
    return !!v && typeof v === 'object' && Object.keys(template as object).every(k => shape((v as Record<string, unknown>)[k], (template as Record<string, unknown>)[k]));
  }
  return Array.isArray(d.facts) && d.facts.length <= 5 && new Set(d.facts).size === d.facts.length && d.facts.every(f => ['departure','arrival','fare','operator','place'].includes(f)) &&
    Object.keys(empty).filter(k => k !== 'facts').every(k => shape(d[k as keyof ActualDraft], empty[k as keyof ActualDraft]));
}
