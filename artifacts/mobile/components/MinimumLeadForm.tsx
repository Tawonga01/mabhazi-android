import React, { useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { submitV2Lead, type V2City, type V2MinimumLeadRequest } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { leadDrafts } from '@/lib/lead-drafts';
import { emptyLeadDraft, draftErrors, prepareLead, type LeadDraft, type LeadField } from '@/lib/minimum-lead-model';
import { useCapture, type CaptureOptions } from '@/lib/use-capture';
import { CaptureFrame, CaptureButton, CaptureInput, CityField, CityPicker, Field, ReviewRow, captureStyles as s } from './capture/CapturePrimitives';
import { CaptureStatus, CaptureMessages, SavedMessage, draftNotice } from './capture/CaptureStatus';
const options: CaptureOptions<LeadDraft, V2MinimumLeadRequest> = {
  empty: emptyLeadDraft, errors: draftErrors, prepare: prepareLead, store: leadDrafts,
  hasAnswers: d => !!(d.origin || d.destination || d.time || d.operator), capability: 'minimumLeadEnabled', submit: submitV2Lead,
};
export function MinimumLeadForm({ openFullForm, onClose }: { openFullForm(): void; onClose(): void }) {
  const { user, isLoading } = useAuth();
  return isLoading ? <ActivityIndicator style={{ marginTop: 80 }} /> : <AccountLeadForm key={user?.id ?? 'guest'} owner={user?.id ?? null} openFullForm={openFullForm} onClose={onClose} />;
}
function AccountLeadForm({ owner, openFullForm, onClose }: { owner: string | null; openFullForm(): void; onClose(): void }) {
  const c = useCapture(owner, options), [picker, setPicker] = useState<'origin' | 'destination' | null>(null);
  const timeRef = useRef<TextInput>(null), operatorRef = useRef<TextInput>(null);
  const review = () => { const field = c.review(); if (field === 'origin' || field === 'destination') setPicker(field); else if (field === 'time') timeRef.current?.focus(); else if (field) operatorRef.current?.focus(); };
  function update<K extends LeadField>(field: K, value: LeadDraft[K]) { c.change({ ...c.draft, [field]: value }); }
  const button = c.authExpired ? 'Sign in to check saved receipt' : c.pending ? 'Check and retry' : c.owner ? 'Save contribution' : 'Sign in to save';
  const reviewing = c.reviewing || !!c.pending;
  const footer = c.receipt ? <><CaptureButton title="Add another route" onPress={c.another} /><CaptureButton title="Done" secondary onPress={() => void c.close(onClose)} /></> :
    c.resume ? <><CaptureButton title="Resume draft" disabled={c.busy} onPress={c.resumeDraft} />{!c.resume.pending ? <CaptureButton title="Discard unsent draft" secondary disabled={c.busy} onPress={() => void c.discard()} /> : null}</> :
    c.ready ? <><CaptureButton title={reviewing ? button : 'Review route'} busy={c.busy} disabled={reviewing && !c.enabled && !c.pending} onPress={reviewing ? () => void c.submit() : review} />{reviewing && !c.pending ? <CaptureButton title="Edit answers" secondary disabled={c.busy} onPress={c.edit} /> : null}</> : null;
  return <>
    <CaptureFrame title={c.receipt ? 'Contribution saved' : reviewing ? 'Review route' : 'Add a bus route'} onClose={() => void c.close(onClose)} busy={c.busy} footer={footer} phase={c.receipt ? 'saved' : reviewing ? 'review' : c.resume ? 'resume' : 'edit'}>
      {c.receipt ? <SavedMessage reference={c.receipt.clientSubmissionId} /> : c.resume ? <><Text style={s.label}>You have a saved draft</Text><Text style={s.note}>{c.resume.pending ? 'A previous save was not confirmed. Resume to check its receipt.' : 'Resume your answers and review them before saving.'}</Text></> : !c.ready ? <ActivityIndicator accessibilityLabel="Loading saved draft" /> : <>
        <Text style={s.note}>{reviewing ? 'Check the four answers before sending. Fare and operating days remain unknown.' : 'Four answers are enough. Price, arrival time and operating days can stay unknown.'}</Text>
        <View style={s.group}>
          {reviewing ? <><ReviewRow label="Departure city" value={c.draft.origin?.name ?? ''} /><ReviewRow label="Departure time" value={c.draft.time} /><ReviewRow label="Destination city" value={c.draft.destination?.name ?? ''} /><ReviewRow label="Bus operator" value={c.draft.operator.trim()} /></> : <>
            <CityField label="Departure city *" city={c.draft.origin} disabled={c.locked} error={c.errors.origin} onPress={() => setPicker('origin')} />
            <Field label="Departure time *" error={c.errors.time} hint="24-hour time. Enter midnight explicitly as 00:00."><CaptureInput ref={timeRef} accessibilityLabel="Departure time in 24-hour format" editable={!c.locked} value={c.draft.time} onChangeText={value => update('time', value)} maxLength={5} placeholder="HH:MM" /></Field>
            <CityField label="Destination city *" city={c.draft.destination} disabled={c.locked} error={c.errors.destination} onPress={() => setPicker('destination')} />
            <Field label="Bus operator *" error={c.errors.operator}><CaptureInput ref={operatorRef} accessibilityLabel="Bus operator name" editable={!c.locked} value={c.draft.operator} onChangeText={value => update('operator', value)} maxLength={120} placeholder="Bus company name" /></Field>
          </>}
        </View>
        {reviewing ? <CaptureStatus capture={c} /> : <Text style={s.note}>Know more? You can use the full route form from the contribution menu.</Text>}
        <Text style={s.note}>{draftNotice}</Text>
      </>}
      <CaptureMessages message={c.message} storageError={c.storageError} />
      {!c.pending && !c.receipt && !c.resume && !c.busy ? <CaptureButton title="Open existing full route form" secondary onPress={() => void c.close(openFullForm)} /> : null}
    </CaptureFrame>
    {picker ? <CityPicker title={picker === 'origin' ? 'Departure city' : 'Destination city'} close={() => setPicker(null)} select={(city: V2City) => { update(picker, city); setPicker(null); }} /> : null}
  </>;
}
