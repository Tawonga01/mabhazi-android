import React, { useRef, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { fareCurrencies, fareErrors, type FareDraft } from '@/lib/actual-journey-model';
import { CaptureFrame, CaptureButton, CaptureInput, CityField, CityPicker, Choices, Field, ReviewRow, captureStyles as s } from './CapturePrimitives';
export function FocusedFareForm({ value: f, change, done, close, skip }: { value: FareDraft; change(value: FareDraft): void; done(): void; close(): void; skip(): void }) {
  const [picker, setPicker] = useState<'origin' | 'destination' | null>(null), [errors, setErrors] = useState<Record<string, string>>({});
  const [conditions, setConditions] = useState(!!(f.passenger || f.ticket)), [preview, setPreview] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const refs = useRef<Record<string, TextInput | null>>({});
  function update<K extends keyof FareDraft>(key: K, value: FareDraft[K]) { change({ ...f, [key]: value }); setErrors({}); setPreview(false); }
  function review() {
    const e = fareErrors(f); setErrors(e);
    if (!Object.keys(e).length) { setPreview(true); return; }
    if (Object.keys(e).some(k => /passenger|ticket/.test(k))) setConditions(true);
    const key = Object.keys(e)[0].slice(5);
    if (key === 'origin' || key === 'destination') setPicker(key); else if (key === 'currency') setCurrencyOpen(true); else refs.current[key]?.focus();
  }
  const dateLabel = f.basis === 'paid' ? 'Travel date *' : f.basis === 'quoted' ? 'Quotation date (optional)' : 'Advert date (optional)';
  return <>
    <CaptureFrame title={preview ? 'Review fare' : 'Report a fare'} onClose={close} phase={preview ? 'preview' : 'edit'} footer={<>
      <CaptureButton title={preview ? 'Use this fare' : 'Preview fare'} onPress={preview ? done : review} />
      {preview ? <CaptureButton title="Edit fare" secondary onPress={() => setPreview(false)} /> : <CaptureButton title="Skip fare" secondary onPress={skip} />}
    </>}>
      <Text style={s.note}>{preview ? 'This fare will join your journey report. It saves only when you submit the whole report.' : 'Share the price you know. A free fare must be entered explicitly as 0.'}</Text>
      {preview ? <View style={s.group}>
        <ReviewRow label={`${f.basis} fare`} value={`${f.currency} ${f.amount}`} />
        <ReviewRow label="Segment" value={`${f.origin?.name} → ${f.destination?.name}`} />
        <ReviewRow label={dateLabel.replace(' *', '')} value={f.date || 'Unknown'} />
        <ReviewRow label="Passenger" value={f.passenger === 'other' ? f.passengerLabel : f.passenger} />
        <ReviewRow label="Ticket" value={f.ticket === 'other' ? f.ticketLabel : f.ticket.replace('_', ' ')} />
      </View> : <>
        <Field label="Fare amount *" error={errors['fare.amount']}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose fare currency" style={[s.input, { justifyContent: 'center', minHeight: 72 }]} onPress={() => setCurrencyOpen(true)}><Text style={s.label}>{f.currency || 'Currency'} ▾</Text></Pressable>
          <CaptureInput ref={v => { refs.current.amount = v; }} accessibilityLabel="Fare amount" value={f.amount} onChangeText={v => update('amount', v)} placeholder="—" keyboardType="decimal-pad" maxLength={13} style={{ flex: 1, minWidth: 0, fontSize: 34, minHeight: 72, fontWeight: '700' }} />
        </View></Field>
        {errors['fare.currency'] ? <Text accessibilityRole="alert" style={s.error}>{errors['fare.currency']}</Text> : null}
        <Choices label="Fare basis" value={f.basis} options={[[ 'paid', 'Paid' ], ['quoted', 'Quoted'], ['advertised', 'Advertised']]} onChange={v => { change({ ...f, basis: v, date: '' }); setErrors({}); }} error={errors['fare.basis']} />
        <View style={s.group}>
          <CityField label="Fare departure city" city={f.origin} onPress={() => setPicker('origin')} error={errors['fare.origin']} />
          <CityField label="Fare destination city" city={f.destination} onPress={() => setPicker('destination')} error={errors['fare.destination']} />
          {f.basis ? <Field label={dateLabel} error={errors['fare.date']} hint={f.basis === 'paid' ? 'The day you travelled at this fare.' : 'Leave blank if you do not know the date.'}><CaptureInput ref={v => { refs.current.date = v; }} accessibilityLabel="Fare date" value={f.date} onChangeText={v => update('date', v)} placeholder="YYYY-MM-DD" maxLength={10} /></Field> : null}
        </View>
        <CaptureButton title={conditions ? 'Hide fare conditions' : 'Fare conditions — choose passenger and ticket'} secondary onPress={() => setConditions(v => !v)} />
        <Text style={s.note}>Choose Unknown when a condition is not known. No adult or one-way fare is assumed.</Text>
        {conditions ? <View style={s.group}>
          <Choices label="Passenger" value={f.passenger} options={[[ 'adult', 'Adult' ], ['child', 'Child'], ['concession', 'Concession'], ['other', 'Other'], ['unknown', 'Unknown']]} onChange={v => { change({ ...f, passenger: v, passengerLabel: '' }); setErrors({}); }} error={errors['fare.passenger']} />
          {f.passenger === 'other' ? <Field label="Passenger description" error={errors['fare.passengerLabel']}><CaptureInput ref={v => { refs.current.passengerLabel = v; }} accessibilityLabel="Passenger description" value={f.passengerLabel} onChangeText={v => update('passengerLabel', v)} maxLength={120} /></Field> : null}
          <Choices label="Ticket" value={f.ticket} options={[[ 'one_way', 'One way' ], ['return', 'Return'], ['other', 'Other'], ['unknown', 'Unknown']]} onChange={v => { change({ ...f, ticket: v, ticketLabel: '' }); setErrors({}); }} error={errors['fare.ticket']} />
          {f.ticket === 'other' ? <Field label="Ticket description" error={errors['fare.ticketLabel']}><CaptureInput ref={v => { refs.current.ticketLabel = v; }} accessibilityLabel="Ticket description" value={f.ticketLabel} onChangeText={v => update('ticketLabel', v)} maxLength={120} /></Field> : null}
        </View> : null}
        {Object.keys(errors).length ? <Text accessibilityRole="alert" style={s.error}>Check the marked fare answers. Passenger and ticket choices are in Fare conditions.</Text> : null}
      </>}
    </CaptureFrame>
    {picker ? <CityPicker title={picker === 'origin' ? 'Fare departure city' : 'Fare destination city'} close={() => setPicker(null)} select={city => { update(picker, city); setPicker(null); }} /> : null}
    {currencyOpen ? <Modal visible transparent animationType="fade" onRequestClose={() => setCurrencyOpen(false)}><CaptureFrame title="Fare currency" onClose={() => setCurrencyOpen(false)}><Choices label="Currency" value={f.currency} options={fareCurrencies.map(v => [v, v] as const)} onChange={v => { update('currency', v); setCurrencyOpen(false); }} /></CaptureFrame></Modal> : null}
  </>;
}
