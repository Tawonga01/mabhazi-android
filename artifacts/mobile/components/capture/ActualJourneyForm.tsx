import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { submitV2ActualJourney, type V2ActualJourneyRequest } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { actualDrafts } from '@/lib/lead-drafts';
import { readBlockedContributors } from '@/hooks/blockedContributorStorage';
import { actualErrors, emptyActualDraft, resetActualDraft, toggleActualFact, knowledgeChoices, type ActualDraft, type ActualFact, type ClockDraft, type CaptureRouteContext } from '@/lib/actual-journey-model';
import { prepareActual } from '@/lib/actual-journey-model';
import { useCapture, type CaptureOptions } from '@/lib/use-capture';
import { CaptureButton, CaptureFrame, CaptureHelp, CaptureInput, CityField, CityPicker, Choices, Field, ReviewRow, captureStyles as s } from './CapturePrimitives';
import { CaptureMessages, CaptureStatus, SavedMessage } from './CaptureStatus';
import { FocusedFareForm } from './FocusedFareForm';
const options: CaptureOptions<ActualDraft, V2ActualJourneyRequest> = {
  empty: emptyActualDraft, errors: actualErrors, prepare: prepareActual, store: actualDrafts,
  hasAnswers: d => d.facts.length > 0 || !!(d.route || d.serviceDate || d.timezone || d.knowledgeBasis), capability: 'actualJourneyEnabled', submit: async (request,opts) => {
    const isPublic=['search_result','route_detail'].includes(request.entrySurface);
    const headers=isPublic?{...opts.headers,'X-Mabhazi-Blocked-Contributors':JSON.stringify((await readBlockedContributors()).map(x=>x.id))}:opts.headers;
    return submitV2ActualJourney(request,{...opts,headers});
  },
};
const facts: [ActualFact, string][] = [['departure', 'Actual departure'], ['arrival', 'Actual arrival'], ['fare', 'Fare'], ['operator', 'Operator'], ['place', 'Pickup / drop-off']];
export function ActualJourneyForm({ onClose, route, entrySurface, initialFact }: { onClose(): void; route?: CaptureRouteContext; entrySurface?: ActualDraft['entrySurface']; initialFact?: 'fare' }) {
  const { user, isLoading } = useAuth();
  return isLoading ? <ActivityIndicator style={{ marginTop: 80 }} /> : <AccountJourney key={user?.id ?? 'guest'} owner={user?.id ?? null} route={route} entrySurface={entrySurface} initialFact={initialFact} onClose={onClose} />;
}
function AccountJourney({ owner, onClose, route, entrySurface, initialFact }: { owner: string | null; onClose(): void; route?: CaptureRouteContext; entrySurface?: ActualDraft['entrySurface']; initialFact?: 'fare' }) {
  const seeded = useMemo(() => ({ ...options, empty: () => ({ ...emptyActualDraft(),
    ...(route && owner === route.ownerId ? { route, entrySurface: route.source==='public' ? entrySurface??'route_detail' as const : 'own_contribution' as const, ...(initialFact==='fare'?{facts:['fare' as const],fare:{...emptyActualDraft().fare,origin:route.origin,destination:route.destination}}:{}) } : {}),
  }) }), [owner, route, entrySurface, initialFact]);
  const c = useCapture(owner, seeded), d = c.draft;
  const [fareOpen, setFareOpen] = useState(false), [contextOpen, setContextOpen] = useState(false), [cityOpen, setCityOpen] = useState(false);
  const seededFare=useRef(false);
  useEffect(()=>{if(c.ready&&!seededFare.current){seededFare.current=true;if(!c.resume&&!c.pending&&route?.source==='public'&&initialFact==='fare'&&d.route?.subjectId===route.subjectId)setFareOpen(true);}},[c.ready,c.resume,c.pending,route,initialFact,d.route]);
  const refs = useRef<Record<string, TextInput | null>>({});
  function toggle(f: ActualFact) { if (!c.locked) { c.change(toggleActualFact(d, f)); if (f === 'fare' && !d.facts.includes('fare')) setFareOpen(true); } }
  function update<K extends keyof ActualDraft>(key: K, value: ActualDraft[K]) { c.change({ ...d, [key]: value }); }
  function clock(f: 'departure' | 'arrival', key: keyof ClockDraft, value: string) { update(f, { ...d[f], [key]: value }); }
  function review() {
    const field = c.review();
    if (field?.startsWith('fare.')) setFareOpen(true);
    else if (field === 'place.city') setCityOpen(true);
    else if (field === 'serviceDate' || field === 'timezone' || field === 'knowledgeBasis') { setContextOpen(true); setTimeout(() => refs.current[field]?.focus(), 0); }
    else if (field) refs.current[field]?.focus();
  }
  const reviewing = c.reviewing || !!c.pending;
  if (fareOpen && !c.locked) return <FocusedFareForm value={d.fare} change={value => update('fare', value)} done={() => setFareOpen(false)} close={() => setFareOpen(false)} skip={() => { c.change(toggleActualFact(d, 'fare')); setFareOpen(false); }} />;
  const footer = c.receipt ? <><CaptureButton title="Report another journey" onPress={() => { const next = resetActualDraft(d); c.another(); c.change(next); }} /><CaptureButton title="Done" secondary onPress={() => void c.close(onClose)} /></> : c.resume ? <>
    <CaptureButton title="Resume draft" onPress={c.resumeDraft} disabled={c.busy} />{!c.resume.pending ? <CaptureButton title="Discard unsent draft" secondary onPress={() => void c.discard()} disabled={c.busy} /> : null}
  </> : c.ready ? <><CaptureButton title={reviewing ? c.authExpired ? 'Sign in to check saved receipt' : c.pending ? 'Check and retry' : owner ? 'Save journey report' : 'Sign in to save' : 'Review journey'} busy={c.busy} disabled={reviewing && !c.enabled && !c.pending} onPress={reviewing ? () => void c.submit() : review} />{reviewing && !c.pending ? <CaptureButton title="Edit answers" secondary disabled={c.busy} onPress={c.edit} /> : null}</> : null;
  return <>
    <CaptureFrame title={c.receipt ? 'Journey report saved' : reviewing ? 'Review journey' : 'Report a journey'} onClose={() => void c.close(onClose)} busy={c.busy} footer={footer} phase={c.receipt ? 'saved' : reviewing ? 'review' : c.resume ? 'resume' : 'edit'}>
      {c.receipt ? <SavedMessage reference={c.receipt.clientSubmissionId} /> : c.resume ? <><Text style={s.label}>You have a saved journey draft</Text><Text style={s.note}>{c.resume.pending ? 'Resume to check the receipt for your previous save.' : 'Resume your answers, then review before saving.'}</Text></> : !c.ready ? <ActivityIndicator accessibilityLabel="Loading saved draft" /> : <>
        {d.route ? <View style={s.group}><Text style={s.label}>{d.route.source==='public'?'Selected route report':'Your submitted route'}</Text><Text style={s.reviewValue}>{d.route.origin.name} → {d.route.destination.name}</Text><Text style={s.note}>{d.route.operator} · {d.route.departureTime}</Text></View> : route && owner === route.ownerId ? <Text style={s.label}>Independent report</Text> : null}
        {reviewing ? <View style={s.group}>
          {(d.serviceDate || d.timezone || d.knowledgeBasis) ? <ReviewRow label="Journey context only" value={`${d.serviceDate || 'Date unknown'} · ${d.timezone || 'Timezone unknown'} · ${knowledgeChoices.find(([key]) => key === d.knowledgeBasis)?.[1] ?? 'Knowledge basis not provided'}`} /> : null}
          {(['departure','arrival'] as const).filter(f => d.facts.includes(f)).map(f => <ReviewRow key={f} label={`Actual ${f}`} value={`${d[f].time} · ${d[f].date || 'Date unknown'} · ${d[f].zone || 'Timezone unknown'}`} />)}
          {d.facts.includes('operator') ? <ReviewRow label="Observed operator" value={`${d.operator.trim()} · ${d.operatorDate || 'Observation date unknown'}`} /> : null}
          {d.facts.includes('place') ? <ReviewRow label={d.place.kind === 'pickup' ? 'Pickup' : 'Drop-off'} value={`${d.place.name.trim()}, ${d.place.city?.name} · ${d.place.date || 'Observation date unknown'}${d.place.instructions.trim() ? '\n' + d.place.instructions.trim() : ''}`} /> : null}
          {d.facts.includes('fare') ? <><ReviewRow label={`${d.fare.basis} fare`} value={`${d.fare.currency} ${d.fare.amount} · ${d.fare.origin?.name} → ${d.fare.destination?.name}`} /><ReviewRow label="Fare conditions" value={`${d.fare.date || 'Date unknown'} · ${d.fare.passenger === 'other' ? d.fare.passengerLabel : d.fare.passenger} · ${d.fare.ticket === 'other' ? d.fare.ticketLabel : d.fare.ticket.replace('_', ' ')}`} /></> : null}
        </View> : <>
          <Field label="What can you report?" error={c.errors.facts}><View style={s.choices}>{facts.map(([key, label]) => <Pressable key={key} accessibilityRole="checkbox" accessibilityLabel={label} aria-checked={d.facts.includes(key)} accessibilityState={{ checked: d.facts.includes(key), disabled: c.locked }} disabled={c.locked} style={[s.choice, d.facts.includes(key) && s.selected]} onPress={() => toggle(key)}><Text style={s.secondaryText}>{d.facts.includes(key) ? '✓ ' : '+ '}{label}</Text></Pressable>)}</View></Field>
          {(['departure','arrival'] as const).filter(f => d.facts.includes(f)).map(f => <View key={f} style={s.group}>
            <Field label={`Actual ${f} time *`} error={c.errors[`${f}.time`]}><CaptureInput ref={v => { refs.current[`${f}.time`] = v; }} accessibilityLabel={`Actual ${f} time`} value={d[f].time} onChangeText={v => clock(f, 'time', v)} placeholder="HH:MM" maxLength={5} /></Field>
            <Field label={`${f === 'departure' ? 'Departure' : 'Arrival'} date (optional)`} error={c.errors[`${f}.date`]}><CaptureInput ref={v => { refs.current[`${f}.date`] = v; }} accessibilityLabel={`${f} date`} value={d[f].date} onChangeText={v => clock(f, 'date', v)} placeholder="YYYY-MM-DD" maxLength={10} /></Field>
            <Field label="Timezone or UTC offset (optional)" error={c.errors[`${f}.zone`]}><CaptureInput ref={v => { refs.current[`${f}.zone`] = v; }} accessibilityLabel={`${f} timezone or offset`} value={d[f].zone} onChangeText={v => clock(f, 'zone', v)} placeholder="Africa/Harare or +02:00" maxLength={100} autoCapitalize="none" /></Field>
            <CaptureHelp label="Date and timezone help"><Text style={s.note}>Use the local date and timezone of this {f}. Arrival may be the following day. Leave unknown details blank.</Text></CaptureHelp>
            <CaptureButton title={`Remove actual ${f}`} secondary onPress={() => toggle(f)} />
          </View>)}
          {d.facts.includes('operator') ? <View style={s.group}><Field label="Observed operator *" error={c.errors.operator}><CaptureInput ref={v => { refs.current.operator = v; }} accessibilityLabel="Observed operator" value={d.operator} onChangeText={v => update('operator', v)} maxLength={120} placeholder="Bus company name" /></Field><Field label="Operator observation date (optional)" error={c.errors.operatorDate}><CaptureInput ref={v => { refs.current.operatorDate = v; }} accessibilityLabel="Operator observation date" value={d.operatorDate} onChangeText={v => update('operatorDate', v)} placeholder="YYYY-MM-DD" maxLength={10} /></Field><CaptureButton title="Remove operator" secondary onPress={() => toggle('operator')} /></View> : null}
          {d.facts.includes('place') ? <View style={s.group}>
            <Choices label="Place kind" value={d.place.kind} options={[[ 'pickup', 'Pickup' ], ['dropoff', 'Drop-off']]} onChange={v => update('place', { ...d.place, kind: v })} error={c.errors['place.kind']} />
            <CityField label="Place city" city={d.place.city} onPress={() => setCityOpen(true)} error={c.errors['place.city']} />
            <Field label="Place name *" error={c.errors['place.name']}><CaptureInput ref={v => { refs.current['place.name'] = v; }} accessibilityLabel="Place name" value={d.place.name} onChangeText={v => update('place', { ...d.place, name: v })} maxLength={200} /></Field>
            <Field label="Finding the place (optional)" error={c.errors['place.instructions']}><CaptureInput ref={v => { refs.current['place.instructions'] = v; }} accessibilityLabel="Place instructions" value={d.place.instructions} onChangeText={v => update('place', { ...d.place, instructions: v })} maxLength={500} /></Field>
            <Field label="Place observation date (optional)" error={c.errors['place.date']}><CaptureInput ref={v => { refs.current['place.date'] = v; }} accessibilityLabel="Place observation date" value={d.place.date} onChangeText={v => update('place', { ...d.place, date: v })} placeholder="YYYY-MM-DD" maxLength={10} /></Field><CaptureButton title="Remove place" secondary onPress={() => toggle('place')} />
          </View> : null}
          {d.facts.includes('fare') ? <View style={s.group}><Text style={s.label}>{d.fare.currency && d.fare.amount ? `${d.fare.currency} ${d.fare.amount}` : 'Fare draft'}</Text><CaptureButton title="Edit fare" secondary onPress={() => setFareOpen(true)} /><CaptureButton title="Remove fare" secondary onPress={() => toggle('fare')} /></View> : null}
          <CaptureButton title={contextOpen ? 'Hide journey context' : 'Add journey context (optional)'} secondary onPress={() => setContextOpen(v => !v)} />
          {contextOpen ? <View style={s.group}>
            <Field label="Journey date (optional)" error={c.errors.serviceDate}><CaptureInput ref={v => { refs.current.serviceDate = v; }} accessibilityLabel="Journey date" value={d.serviceDate} onChangeText={v => update('serviceDate', v)} placeholder="YYYY-MM-DD" maxLength={10} /></Field>
            <Field label="Journey timezone (optional)" error={c.errors.timezone}><CaptureInput ref={v => { refs.current.timezone = v; }} accessibilityLabel="Journey timezone" value={d.timezone} onChangeText={v => update('timezone', v)} placeholder="Africa/Harare" autoCapitalize="none" maxLength={100} /></Field>
            <Choices label="How you know (optional)" value={d.knowledgeBasis} options={knowledgeChoices} onChange={v => update('knowledgeBasis', v)} error={c.errors.knowledgeBasis} />
            <CaptureHelp label="Journey context help"><Text style={s.note}>These details describe the journey. Add a date to each time or fare separately when you know it.</Text></CaptureHelp>
          </View> : null}
        </>}
        {reviewing ? <CaptureStatus capture={c} /> : null}
      </>}
      {c.targetProblem && d.route ? <CaptureButton title="Keep as independent report" secondary disabled={c.busy} onPress={() => { const { route: omitted, ...independent } = d; void c.changeRejectedTarget({...independent,...(omitted?.source==='public'?{entrySurface:'contribute_tab' as const}:{})}); }} /> : null}
      <CaptureMessages message={c.message} storageError={c.storageError} />
    </CaptureFrame>
    {cityOpen ? <CityPicker title="Place city" close={() => setCityOpen(false)} select={city => { update('place', { ...d.place, city }); setCityOpen(false); }} /> : null}
  </>;
}
