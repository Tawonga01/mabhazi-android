import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { getV2Capabilities, listV2Cities, getV2LeadReceipt, submitV2Lead, type V2City, type V2LeadReceipt } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { leadDrafts } from '@/lib/lead-drafts';
import { emptyLeadDraft, draftErrors, prepareLead, recoverOrSubmit, type LeadDraft, type LeadField, type PendingLead } from '@/lib/minimum-lead-model';
import { TermsAcceptanceCard, useTermsAcceptance } from './TermsAcceptance';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';

async function boundedRequest<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try { return await request(controller.signal); } finally { clearTimeout(timer); }
}

function CityPicker({ title, close, select }: { title: string; close(): void; select(city: V2City): void }) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState(''), [cities, setCities] = useState<V2City[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(''); setCities([]);
    const timer = setTimeout(() => {
      listV2Cities({ q: search }, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) setCities(result.cities);
      }).catch(() => { if (!controller.signal.aborted) setError('City search could not load. Try again.'); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, retry]);
  return <Modal visible animationType="slide" onRequestClose={close}>
    <View style={[styles.page, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.row}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Pressable onPress={close} style={styles.secondary}><Text>Close</Text></Pressable></View>
      <TextInput autoFocus accessibilityLabel="Search cities" placeholder="Search a city" value={search} maxLength={80} onChangeText={setSearch} style={styles.input} />
      {busy ? <ActivityIndicator accessibilityLabel="Searching cities" /> : null}
      {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable style={styles.secondary} onPress={() => setRetry(value => value + 1)}><Text>Try city search again</Text></Pressable></> : null}
      {!busy && !error && !cities.length ? <Text style={styles.note}>No matching city. Try a different spelling.</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled">{cities.map(city => <Pressable key={city.id} style={styles.city} onPress={() => select(city)} accessibilityRole="button" accessibilityLabel={`${city.name}, ${city.placeType}`}>
        <Text style={styles.label}>{city.name}</Text><Text style={styles.note}>{city.placeType}</Text>
      </Pressable>)}</ScrollView>
    </View>
  </Modal>;
}

export function MinimumLeadForm({ openFullForm }: { openFullForm(): void }) {
  const { user, isLoading, login } = useAuth();
  // Remount the account-owned state; late network/storage callbacks check actor too.
  return isLoading ? <ActivityIndicator style={{ marginTop: 80 }} /> :
    <AccountLeadForm key={user?.id ?? 'guest'} owner={user?.id ?? null} login={login} openFullForm={openFullForm} />;
}
function AccountLeadForm({ owner, login, openFullForm }: { owner: string | null; login(): Promise<void>; openFullForm(): void }) {
  const auth = useAuth(), terms = useTermsAcceptance(), insets = useSafeAreaInsets();
  const actor = useRef(owner); actor.current = auth.user?.id ?? null;
  const mounted = useRef(true), active = () => mounted.current && actor.current === owner;
  const [draft, setDraft] = useState<LeadDraft>(emptyLeadDraft), [ready, setReady] = useState(false);
  const [resume, setResume] = useState<{ draft: LeadDraft; pending?: PendingLead } | null>(null);
  const [pending, setPending] = useState<PendingLead | undefined>();
  const [errors, setErrors] = useState<Partial<Record<LeadField, string>>>({});
  const [message, setMessage] = useState(''), [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [receipt, setReceipt] = useState<V2LeadReceipt | null>(null);
  const [picker, setPicker] = useState<'origin' | 'destination' | null>(null);
  const [enabled, setEnabled] = useState(false), [capabilityBusy, setCapabilityBusy] = useState(true);
  const timeRef = useRef<TextInput>(null), operatorRef = useRef<TextInput>(null);
  async function checkCapability() {
    setCapabilityBusy(true);
    try { const result = await getV2Capabilities(); if (active()) setEnabled(result.minimumLeadEnabled); }
    catch { if (active()) setEnabled(false); }
    finally { if (active()) setCapabilityBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    checkCapability();
    (async () => {
      try {
        const owned = await leadDrafts.read(owner), guest = owner && !owned ? await leadDrafts.read(null) : null;
        if (!active()) return;
        const stored = owned ?? guest;
        if (stored) setResume({ draft: stored.draft, pending: owned?.pending });
      } catch { if (active()) setStorageError('Your saved draft could not be read. Keep this screen open while entering answers.'); }
      finally { if (active()) setReady(true); }
    })();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!ready || resume || receipt || busy) return;
    leadDrafts.write({ version: 1, owner, updatedAt: Date.now(), draft, ...(pending ? { pending } : {}) })
      .then(() => { if (active()) setStorageError(''); })
      .catch(() => { if (active()) setStorageError('This draft could not be saved securely. Keep this screen open; submission needs a securely saved retry reference.'); });
  }, [draft, pending, ready, resume, receipt, busy]);

  function update<K extends LeadField>(field: K, value: LeadDraft[K]) {
    if (pending || busy) return;
    setDraft(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined })); setMessage('');
  }
  async function submit() {
    if (busyRef.current || !ready || resume) return;
    const validation = draftErrors(draft); setErrors(validation);
    if (Object.keys(validation).length && !pending) {
      setMessage('Check the marked answers.');
      if (validation.origin) setPicker('origin'); else if (validation.destination) setPicker('destination');
      else if (validation.time) timeRef.current?.focus(); else operatorRef.current?.focus();
      return;
    }
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      if (authExpired) { await login(); if (active()) { setAuthExpired(false); setMessage('Sign-in completed. Tap Check and retry to continue.'); } return; }
      if (!owner) { await login(); if (active()) setMessage('Review your answers after sign-in, then tap Save.'); return; }
      // A pending request may already be committed. Check it before any Terms gate.
      if (!pending && !await terms.requireAcceptance()) { if (active()) setMessage('Accept the current Terms, then tap Save. Your answers are kept.'); return; }
      if (!active()) return;
      const frozen = pending ?? { actor: owner, request: prepareLead(draft, Crypto.randomUUID()) };
      // Persist the exact key and answers before anything can reach the server.
      await leadDrafts.write({ version: 1, owner, updatedAt: Date.now(), draft, pending: frozen });
      if (!active()) return;
      setPending(frozen);
      const headers = { 'X-Mabhazi-Account': owner };
      const result = await recoverOrSubmit(frozen, {
        lookup: key => boundedRequest(signal => getV2LeadReceipt(key, { signal, headers })),
        submit: input => boundedRequest(signal => submitV2Lead(input, { signal, headers })),
      }, () => mounted.current ? actor.current : null);
      if (!active()) return;
      setReceipt(result); setPending(undefined);
      // Failure to clear local storage must not negate an already confirmed save.
      try { await leadDrafts.remove(owner); await leadDrafts.remove(null); }
      catch { if (active()) setStorageError('Saved online. Local draft cleanup will be retried when you sign out.'); }
    } catch (error) {
      if (!active()) return;
      const problem = error as { status?: number; data?: { error?: string; code?: string } };
      if (problem.status === 428) { await terms.refetch(); setMessage('Accept the current Terms, then check and retry. Your answers and reference are kept.'); }
      else if (problem.status === 401) { setAuthExpired(true); setMessage('Sign in again with this account to check the saved receipt. Your answers are kept.'); }
      else if (problem.status === 422) {
        // Definitive validation rejection: no save occurred; allow corrections.
        setPending(undefined); setMessage(problem.data?.error ?? 'Check the selected cities, clock time and operator.');
      } else if (problem.data?.code === 'ACCOUNT_CHANGED') setMessage('The active account changed. Reopen your own draft before continuing.');
      else if (problem.status === 409) setMessage('This reference has different saved answers. Check the receipt before starting another entry.');
      else setMessage('Save not confirmed. Keep this draft and use Check and retry; it checks for a saved receipt before sending the same answers.');
    } finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  const locked = !!pending || busy;
  return <View style={styles.container}>
    <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.page, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
      <Text accessibilityRole="header" style={styles.title}>Add a bus route</Text>
      <Text style={styles.note}>Four answers are enough. Price, arrival time and operating days can stay unknown.</Text>
      <Text style={styles.note}>{Platform.OS === 'web' ? 'Drafts stay in this browser session only. Closing or refreshing the page loses unsent answers.' : 'Drafts are saved securely on this phone for up to 30 days. Sign-out removes them.'}</Text>
      {resume ? <View style={styles.card}><Text style={styles.label}>You have a saved draft</Text><Text style={styles.note}>{resume.pending ? 'A previous save was not confirmed. Resume to check its receipt.' : 'Resume your answers and review them before saving.'}</Text>
        <Pressable style={styles.button} onPress={() => { setDraft(resume.draft); setPending(resume.pending); setResume(null); }}><Text style={styles.buttonText}>Resume draft</Text></Pressable>
        {!resume.pending ? <Pressable style={styles.secondary} onPress={async () => { try { await leadDrafts.remove(owner); if (owner) await leadDrafts.remove(null); if (active()) setResume(null); } catch { if (active()) setStorageError('The saved draft could not be removed. Try again.'); } }}><Text>Discard unsent draft</Text></Pressable> : null}
      </View> : null}
      {receipt ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>Contribution saved</Text>
        <Text style={styles.note}>Your answers reached Mabhazi. They are awaiting processing. This does not confirm a timetable or publish the route.</Text>
        <Text selectable style={styles.note}>Reference: {receipt.clientSubmissionId}</Text>
        <Pressable style={styles.button} onPress={() => { setReceipt(null); setDraft(emptyLeadDraft()); setErrors({}); setMessage(''); }}><Text style={styles.buttonText}>Add another route</Text></Pressable>
      </View> : !resume && ready ? <>
        <Text style={styles.label}>Departure city *</Text>
        <Pressable disabled={locked} style={styles.input} accessibilityRole="button" accessibilityLabel="Choose departure city" onPress={() => setPicker('origin')}><Text>{draft.origin?.name ?? 'Choose a city'}</Text></Pressable>
        {errors.origin ? <Text style={styles.error}>{errors.origin}</Text> : null}
        <Text style={styles.label}>Destination city *</Text>
        <Pressable disabled={locked} style={styles.input} accessibilityRole="button" accessibilityLabel="Choose destination city" onPress={() => setPicker('destination')}><Text>{draft.destination?.name ?? 'Choose a city'}</Text></Pressable>
        {errors.destination ? <Text style={styles.error}>{errors.destination}</Text> : null}
        <Text style={styles.label}>Departure time *</Text>
        <TextInput ref={timeRef} accessibilityLabel="Departure time in 24-hour format" editable={!locked} value={draft.time} onChangeText={value => update('time', value)} maxLength={5} placeholder="HH:MM" autoCorrect={false} style={styles.input} />
        <Text style={styles.note}>24-hour time, for example 08:30. Enter midnight as 00:00.</Text>
        {errors.time ? <Text style={styles.error}>{errors.time}</Text> : null}
        <Text style={styles.label}>Bus operator *</Text>
        <TextInput ref={operatorRef} accessibilityLabel="Bus operator name" editable={!locked} value={draft.operator} onChangeText={value => update('operator', value)} maxLength={120} placeholder="Bus company name" style={styles.input} />
        {errors.operator ? <Text style={styles.error}>{errors.operator}</Text> : null}
        {owner ? terms.isAccepted ? <Text style={styles.note}>Current Terms accepted.</Text> : <TermsAcceptanceCard terms={terms} /> : <Text style={styles.note}>Sign in with Google to save. Nothing submits automatically. On the web, allow the sign-in popup to keep your draft.</Text>}
        {pending ? <Text style={styles.note}>These answers are locked while a previous save is checked. Reference: {pending.request.clientSubmissionId}</Text> : null}
        {capabilityBusy ? <ActivityIndicator accessibilityLabel="Checking contribution availability" /> : !enabled ? <View><Text style={styles.note}>The new form is not available on this server yet. Your answers are kept.</Text><Pressable style={styles.secondary} onPress={checkCapability}><Text>Check availability again</Text></Pressable></View> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: (!enabled && !pending) || busy }} disabled={(!enabled && !pending) || busy} style={[styles.button, ((!enabled && !pending) || busy) && styles.disabled]} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{authExpired ? 'Sign in to check saved receipt' : pending ? 'Check and retry' : owner ? 'Save contribution' : 'Sign in to save'}</Text>}
        </Pressable>
      </> : !ready ? <ActivityIndicator accessibilityLabel="Loading saved draft" /> : null}
      {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
      {storageError ? <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text> : null}
      {!pending && !receipt && !resume && !busy ? <Pressable style={styles.secondary} onPress={openFullForm}><Text>Open existing full route form</Text></Pressable> : null}
    </KeyboardAwareScrollViewCompat>
    {picker ? <CityPicker title={picker === 'origin' ? 'Departure city' : 'Destination city'} close={() => setPicker(null)} select={city => { update(picker, city); setPicker(null); }} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' }, page: { padding: 20, gap: 12, flexGrow: 1 },
  title: { fontSize: 25, fontWeight: '700', color: '#1E3A5F' }, label: { fontSize: 16, fontWeight: '600', color: '#172A40', marginTop: 10 },
  note: { fontSize: 15, lineHeight: 22, color: '#475569' }, input: { backgroundColor: '#fff', borderColor: '#64748B', borderWidth: 1, borderRadius: 12, padding: 15, minHeight: 52, fontSize: 17, color: '#172A40' },
  error: { fontSize: 15, lineHeight: 22, color: '#9F1239' }, button: { backgroundColor: '#1E3A5F', padding: 16, minHeight: 52, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' }, secondary: { padding: 14, minHeight: 48, alignItems: 'center' }, disabled: { opacity: 0.5 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  city: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#CBD5E1', minHeight: 60 },
});
