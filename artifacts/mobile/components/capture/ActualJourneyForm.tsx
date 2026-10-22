import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { submitV2ActualJourney, type V2ActualJourneyRequest } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { actualDrafts } from '@/lib/lead-drafts';
import { actualErrors, emptyActualDraft, toggleActualFact, type ActualDraft, type ActualFact, type ClockDraft } from '@/lib/actual-journey-model';
import { prepareActual } from '@/lib/actual-journey-model';
import { useCapture, type CaptureOptions } from '@/lib/use-capture';
import { CaptureButton, CaptureFrame, CaptureInput, CityField, CityPicker, Choices, Field, ReviewRow, captureStyles as s } from './CapturePrimitives';
import { CaptureMessages, CaptureStatus, draftNotice, SavedMessage } from './CaptureStatus';
import { FocusedFareForm } from './FocusedFareForm';
const options: CaptureOptions<ActualDraft, V2ActualJourneyRequest> = {
  empty: emptyActualDraft, errors: actualErrors, prepare: prepareActual, store: actualDrafts,
  hasAnswers: d => d.facts.length > 0 || !!(d.serviceDate || d.timezone), capability: 'actualJourneyEnabled', submit: submitV2ActualJourney,
};
const facts: [ActualFact, string][] = [['departure', 'Actual departure'], ['arrival', 'Actual arrival'], ['fare', 'Fare'], ['operator', 'Operator'], ['place', 'Pickup / drop-off']];
export function ActualJourneyForm({ onClose }: { onClose(): void }) {
  const { user, isLoading } = useAuth();
  return isLoading ? <ActivityIndicator style={{ marginTop: 80 }} /> : <AccountJourney key={user?.id ?? 'guest'} owner={user?.id ?? null} onClose={onClose} />;
}
function AccountJourney({ owner, onClose }: { owner: string | null; onClose(): void }) {
  const c = useCapture(owner, options), d = c.draft;
  const [fareOpen, setFareOpen] = useState(false), [contextOpen, setContextOpen] = useState(false), [cityOpen, setCityOpen] = useState(false);
  const refs = useRef<Record<string, TextInput | null>>({});
  function toggle(f: ActualFact) { if (!c.locked) { c.change(toggleActualFact(d, f)); if (f === 'fare' && !d.facts.includes('fare')) setFareOpen(true); } }
  function update<K extends keyof ActualDraft>(key: K, value: ActualDraft[K]) { c.change({ ...d, [key]: value }); }
  function clock(f: 'departure' | 'arrival', key: keyof ClockDraft, value: string) { update(f, { ...d[f], [key]: value }); }
  function review() {
    const field = c.review();
    if (field?.startsWith('fare.')) setFareOpen(true);
    else if (field === 'place.city') setCityOpen(true);
    else if (field === 'serviceDate' || field === 'timezone') { setContextOpen(true); setTimeout(() => refs.current[field]?.focus(), 0); }
    else if (field) refs.current[field]?.focus();
  }
  const reviewing = c.reviewing || !!c.pending;
  if (fareOpen && !c.locked) return <FocusedFareForm value={d.fare} change={value => update('fare', value)} done={() => setFareOpen(false)} close={() => setFareOpen(false)} skip={() => { c.change(toggleActualFact(d, 'fare')); setFareOpen(false); }} />;
  const footer = c.receipt ? <><CaptureButton title="Report another journey" onPress={c.another} /><CaptureButton title="Done" secondary onPress={() => void c.close(onClose)} /></> : c.resume ? <>
    <CaptureButton title="Resume draft" onPress={c.resumeDraft} disabled={c.busy} />{!c.resume.pending ? <CaptureButton title="Discard unsent draft" secondary onPress={() => void c.discard()} disabled={c.busy} /> : null}
  </> : c.ready ? <><CaptureButton title={reviewing ? c.authExpired ? 'Sign in to check saved receipt' : c.pending ? 'Check and retry' : owner ? 'Save journey report' : 'Sign in to save' : 'Review journey'} busy={c.busy} disabled={reviewing && !c.enabled && !c.pending} onPress={reviewing ? () => void c.submit() : review} />{reviewing && !c.pending ? <CaptureButton title="Edit answers" secondary disabled={c.busy} onPress={c.edit} /> : null}</> : null;
  return <>
    <CaptureFrame title={c.receipt ? 'Journey report saved' : reviewing ? 'Review journey' : 'Report a journey'} onClose={() => void c.close(onClose)} busy={c.busy} footer={footer} phase={c.receipt ? 'saved' : reviewing ? 'review' : c.resume ? 'resume' : 'edit'}>
      {c.receipt ? <SavedMessage reference={c.receipt.clientSubmissionId} /> : c.resume ? <><Text style={s.label}>You have a saved journey draft</Text><Text style={s.note}>{c.resume.pending ? 'Resume to check the receipt for your previous save.' : 'Resume your answers, then review before saving.'}</Text></> : !c.ready ? <ActivityIndicator accessibilityLabel="Loading saved draft" /> : <>
        <Text style={s.note}>{reviewing ? 'Only the facts below will be sent. This independent report does not change a scheduled departure.' : 'Share what you observed. One useful fact is enough; leave the rest unknown.'}</Text>
        {reviewing ? <View style={s.group}>
          {(d.serviceDate || d.timezone) ? <ReviewRow label="Journey context only" value={`${d.serviceDate || 'Date unknown'} · ${d.timezone || 'Timezone unknown'}`} /> : null}
          {(['departure','arrival'] as const).filter(f => d.facts.includes(f)).map(f => <ReviewRow key={f} label={`Actual ${f}`} value={`${d[f].time} · ${d[f].date || 'Date unknown'} · ${d[f].zone || 'Timezone unknown'}`} />)}
          {d.facts.includes('operator') ? <ReviewRow label="Observed operator" value={d.operator.trim()} /> : null}
          {d.facts.includes('place') ? <ReviewRow label={d.place.kind === 'pickup' ? 'Pickup' : 'Drop-off'} value={`${d.place.name.trim()}, ${d.place.city?.name}${d.place.instructions.trim() ? '\n' + d.place.instructions.trim() : ''}`} /> : null}
          {d.facts.includes('fare') ? <><ReviewRow label={`${d.fare.basis} fare`} value={`${d.fare.currency} ${d.fare.amount} · ${d.fare.origin?.name} → ${d.fare.destination?.name}`} /><ReviewRow label="Fare conditions" value={`${d.fare.date || 'Date unknown'} · ${d.fare.passenger === 'other' ? d.fare.passengerLabel : d.fare.passenger} · ${d.fare.ticket === 'other' ? d.fare.ticketLabel : d.fare.ticket.replace('_', ' ')}`} /></> : null}
        </View> : <>
          <Field label="What can you report?" error={c.errors.facts}><View style={s.choices}>{facts.map(([key, label]) => <Pressable key={key} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: d.facts.includes(key), disabled: c.locked }} disabled={c.locked} style={[s.choice, d.facts.includes(key) && s.selected]} onPress={() => toggle(key)}><Text style={s.secondaryText}>{d.facts.includes(key) ? '✓ ' : '+ '}{label}</Text></Pressable>)}</View></Field>
          {(['departure','arrival'] as const).filter(f => d.facts.includes(f)).map(f => <View key={f} style={s.group}>
            <Field label={`Actual ${f} time *`} error={c.errors[`${f}.time`]}><CaptureInput ref={v => { refs.current[`${f}.time`] = v; }} accessibilityLabel={`Actual ${f} time`} value={d[f].time} onChangeText={v => clock(f, 'time', v)} placeholder="HH:MM" maxLength={5} /></Field>
            <Field label={`${f === 'departure' ? 'Departure' : 'Arrival'} date (optional)`} error={c.errors[`${f}.date`]}><CaptureInput ref={v => { refs.current[`${f}.date`] = v; }} accessibilityLabel={`${f} date`} value={d[f].date} onChangeText={v => clock(f, 'date', v)} placeholder="YYYY-MM-DD" maxLength={10} /></Field>
            <Field label="Timezone or UTC offset (optional)" error={c.errors[`${f}.zone`]}><CaptureInput ref={v => { refs.current[`${f}.zone`] = v; }} accessibilityLabel={`${f} timezone or offset`} value={d[f].zone} onChangeText={v => clock(f, 'zone', v)} placeholder="Africa/Harare or +02:00" maxLength={100} autoCapitalize="none" /></Field>
            <Text style={s.note}>Use the date and timezone of this actual {f}. Arrival may be on the following day. Unknown stays unknown.</Text>
            <CaptureButton title={`Remove actual ${f}`} secondary onPress={() => toggle(f)} />
          </View>)}
          {d.facts.includes('operator') ? <View style={s.group}><Field label="Observed operator *" error={c.errors.operator}><CaptureInput ref={v => { refs.current.operator = v; }} accessibilityLabel="Observed operator" value={d.operator} onChangeText={v => update('operator', v)} maxLength={120} placeholder="Bus company name" /></Field><CaptureButton title="Remove operator" secondary onPress={() => toggle('operator')} /></View> : null}
          {d.facts.includes('place') ? <View style={s.group}>
            <Choices label="Place kind" value={d.place.kind} options={[[ 'pickup', 'Pickup' ], ['dropoff', 'Drop-off']]} onChange={v => update('place', { ...d.place, kind: v })} error={c.errors['place.kind']} />
            <CityField label="Place city" city={d.place.city} onPress={() => setCityOpen(true)} error={c.errors['place.city']} />
            <Field label="Place name *" error={c.errors['place.name']}><CaptureInput ref={v => { refs.current['place.name'] = v; }} accessibilityLabel="Place name" value={d.place.name} onChangeText={v => update('place', { ...d.place, name: v })} maxLength={200} /></Field>
            <Field label="Finding the place (optional)" error={c.errors['place.instructions']}><CaptureInput ref={v => { refs.current['place.instructions'] = v; }} accessibilityLabel="Place instructions" value={d.place.instructions} onChangeText={v => update('place', { ...d.place, instructions: v })} maxLength={500} /></Field>
            <CaptureButton title="Remove place" secondary onPress={() => toggle('place')} />
          </View> : null}
          {d.facts.includes('fare') ? <View style={s.group}><Text style={s.label}>{d.fare.currency && d.fare.amount ? `${d.fare.currency} ${d.fare.amount}` : 'Fare draft'}</Text><CaptureButton title="Edit fare" secondary onPress={() => setFareOpen(true)} /><CaptureButton title="Remove fare" secondary onPress={() => toggle('fare')} /></View> : null}
          <CaptureButton title={contextOpen ? 'Hide journey context' : 'Add journey context (optional)'} secondary onPress={() => setContextOpen(v => !v)} />
          {contextOpen ? <View style={s.group}>
            <Field label="Journey date (optional)" error={c.errors.serviceDate}><CaptureInput ref={v => { refs.current.serviceDate = v; }} accessibilityLabel="Journey date" value={d.serviceDate} onChangeText={v => update('serviceDate', v)} placeholder="YYYY-MM-DD" maxLength={10} /></Field>
            <Field label="Journey timezone (optional)" error={c.errors.timezone}><CaptureInput ref={v => { refs.current.timezone = v; }} accessibilityLabel="Journey timezone" value={d.timezone} onChangeText={v => update('timezone', v)} placeholder="Africa/Harare" autoCapitalize="none" maxLength={100} /></Field>
            <Text style={s.note}>Context is separate from each actual time and fare. It will not fill their missing dates or timezones.</Text>
          </View> : null}
        </>}
        {reviewing ? <CaptureStatus capture={c} /> : null}<Text style={s.note}>{draftNotice}</Text>
      </>}
      <CaptureMessages message={c.message} storageError={c.storageError} />
    </CaptureFrame>
    {cityOpen ? <CityPicker title="Place city" close={() => setCityOpen(false)} select={city => { update('place', { ...d.place, city }); setCityOpen(false); }} /> : null}
  </>;
}
