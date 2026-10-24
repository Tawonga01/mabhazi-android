import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { getV2LeadReceipt, submitV2Lead, type V2City, type V2MinimumLeadRequest } from '@workspace/api-client-react';
import type { RoutePrefill } from '@/lib/contribution-moments';
import { useAuth } from '@/lib/auth';
import { leadDrafts } from '@/lib/lead-drafts';
import { emptyLeadDraft, draftErrors, prepareLead, type LeadDraft, type LeadField } from '@/lib/minimum-lead-model';
import type { OwnRouteContext } from '@/lib/actual-journey-model';
import { boundedRequest, useCapture, type CaptureOptions } from '@/lib/use-capture';
import { CaptureFrame, CaptureButton, CaptureInput, CityField, CityPicker, Field, ReviewRow, captureStyles as s } from './capture/CapturePrimitives';
import { CaptureStatus, CaptureMessages, SavedMessage } from './capture/CaptureStatus';
const options: CaptureOptions<LeadDraft, V2MinimumLeadRequest> = {
  empty: emptyLeadDraft, errors: draftErrors, prepare: prepareLead, store: leadDrafts,
  hasAnswers: d => !!(d.origin || d.destination || d.time || d.operator), capability: 'minimumLeadEnabled', submit: submitV2Lead,
};
interface LeadFormProps { openFullForm(): void; onClose(): void; entrySurface?: 'contribute_tab' | 'search_empty'; prefill?: RoutePrefill; onFollowUp?(route: OwnRouteContext): void }
export function MinimumLeadForm({ openFullForm, onClose, entrySurface = 'contribute_tab', prefill, onFollowUp }: LeadFormProps) {
  const { user, isLoading } = useAuth();
  return isLoading ? <ActivityIndicator style={{ marginTop: 80 }} /> : <AccountLeadForm key={user?.id ?? 'guest'} owner={user?.id ?? null} entrySurface={entrySurface} prefill={prefill} onFollowUp={onFollowUp} openFullForm={openFullForm} onClose={onClose} />;
}
function AccountLeadForm({ owner, openFullForm, onClose, prefill, entrySurface, onFollowUp }: LeadFormProps & { owner: string | null }) {
  const seededOptions = useMemo(() => ({ ...options,
    empty: () => ({ ...emptyLeadDraft(), origin: prefill?.origin ?? null, destination: prefill?.destination ?? null }),
    prepare: (draft: LeadDraft, key: string) => prepareLead(draft, key, entrySurface),
  }), [prefill, entrySurface]);
  const c = useCapture(owner, seededOptions), [picker, setPicker] = useState<'origin' | 'destination' | null>(null);
  const [following, setFollowing] = useState(false), [followError, setFollowError] = useState('');
  const followingRef = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function followUp() {
    if (!onFollowUp || !owner || !c.receipt || !c.draft.origin || !c.draft.destination || followingRef.current) return;
    followingRef.current = true; setFollowing(true); setFollowError('');
    try {
      const lookup = await boundedRequest(signal => getV2LeadReceipt(c.receipt!.clientSubmissionId, { signal, headers: { 'X-Mabhazi-Account': owner } }));
      if (!alive.current) return;
      if (!lookup.found || lookup.initialReceipt?.subjectId !== c.receipt.subjectId || !Number.isSafeInteger(lookup.currentLeadRevision) || lookup.currentLeadRevision! < 1) {
        setFollowError('Details are unavailable for this route. Your saved contribution is kept.'); return;
      }
      const context: OwnRouteContext = { ownerId: owner, subjectId: c.receipt.subjectId, clientSubmissionId: c.receipt.clientSubmissionId,
        expectedRevision: lookup.currentLeadRevision!, origin: c.draft.origin, destination: c.draft.destination,
        operator: c.draft.operator.trim(), departureTime: c.draft.time };
      await c.close(() => onFollowUp(context));
    } catch { if (alive.current) setFollowError('Could not load this route. Your contribution is saved. Try Add details again.'); }
    finally { followingRef.current = false; if (alive.current) setFollowing(false); }
  }
  const timeRef = useRef<TextInput>(null), operatorRef = useRef<TextInput>(null);
  const review = () => { const field = c.review(); if (field === 'origin' || field === 'destination') setPicker(field); else if (field === 'time') timeRef.current?.focus(); else if (field) operatorRef.current?.focus(); };
  function update<K extends LeadField>(field: K, value: LeadDraft[K]) { c.change({ ...c.draft, [field]: value }); }
  const button = c.authExpired ? 'Sign in to check saved receipt' : c.pending ? 'Check and retry' : c.owner ? 'Save contribution' : 'Sign in to save';
  const reviewing = c.reviewing || !!c.pending;
  const footer = c.receipt ? <>{onFollowUp && owner ? <CaptureButton title="Add details" busy={following} onPress={() => void followUp()} /> : null}<CaptureButton title="Add another route" secondary={!!onFollowUp} disabled={following} onPress={c.another} /><CaptureButton title="Done" secondary disabled={following} onPress={() => void c.close(onClose)} /></> :
    c.resume ? <><CaptureButton title="Resume draft" disabled={c.busy} onPress={c.resumeDraft} />{!c.resume.pending ? <CaptureButton title="Discard unsent draft" secondary disabled={c.busy} onPress={() => void c.discard()} /> : null}</> :
    c.ready ? <><CaptureButton title={reviewing ? button : 'Review route'} busy={c.busy} disabled={reviewing && !c.enabled && !c.pending} onPress={reviewing ? () => void c.submit() : review} />{reviewing && !c.pending ? <CaptureButton title="Edit answers" secondary disabled={c.busy} onPress={c.edit} /> : null}</> : null;
  return <>
    <CaptureFrame title={c.receipt ? 'Contribution saved' : reviewing ? 'Review route' : 'Add a bus route'} onClose={() => void c.close(onClose)} busy={c.busy || following} footer={footer} phase={c.receipt ? 'saved' : reviewing ? 'review' : c.resume ? 'resume' : 'edit'}>
      {c.receipt ? <SavedMessage reference={c.receipt.clientSubmissionId} /> : c.resume ? <><Text style={s.label}>You have a saved draft</Text><Text style={s.note}>{c.resume.pending ? 'A previous save was not confirmed. Resume to check its receipt.' : 'Resume your answers and review them before saving.'}</Text></> : !c.ready ? <ActivityIndicator accessibilityLabel="Loading saved draft" /> : <>
        <View style={s.group}>
          {reviewing ? <><ReviewRow label="Departure city" value={c.draft.origin?.name ?? ''} /><ReviewRow label="Departure time" value={c.draft.time} /><ReviewRow label="Destination city" value={c.draft.destination?.name ?? ''} /><ReviewRow label="Bus operator" value={c.draft.operator.trim()} /></> : <>
            <CityField label="Departure city *" city={c.draft.origin} hint={prefill?.originQuery} disabled={c.locked} error={c.errors.origin} onPress={() => setPicker('origin')} />
            <Field label="Departure time (24-hour) *" error={c.errors.time}><CaptureInput ref={timeRef} accessibilityLabel="Departure time in 24-hour format" editable={!c.locked} value={c.draft.time} onChangeText={value => update('time', value)} maxLength={5} placeholder="HH:MM" /></Field>
            <CityField label="Destination city *" city={c.draft.destination} hint={prefill?.destinationQuery} disabled={c.locked} error={c.errors.destination} onPress={() => setPicker('destination')} />
            <Field label="Bus operator *" error={c.errors.operator}><CaptureInput ref={operatorRef} accessibilityLabel="Bus operator name" editable={!c.locked} value={c.draft.operator} onChangeText={value => update('operator', value)} maxLength={120} placeholder="Bus company name" /></Field>
          </>}
        </View>
        {reviewing ? <CaptureStatus capture={c} /> : null}
      </>}
      {followError ? <Text accessibilityRole="alert" style={s.error}>{followError}</Text> : null}
      <CaptureMessages message={c.message} storageError={c.storageError} />
      {!reviewing && !c.pending && !c.receipt && !c.resume && !c.busy ? <CaptureButton title="More route details" secondary onPress={() => void c.close(openFullForm)} /> : null}
    </CaptureFrame>
    {picker ? <CityPicker initialQuery={picker === 'origin' ? prefill?.originQuery : prefill?.destinationQuery} title={picker === 'origin' ? 'Departure city' : 'Destination city'} close={() => setPicker(null)} select={(city: V2City) => { update(picker, city); setPicker(null); }} /> : null}
  </>;
}
