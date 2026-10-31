import {fareDate} from './FareReports';
import {PlaceReports} from './PlaceReports';
import { ui } from '@/constants/ui';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { getV2OwnRoute, listV2OwnRoutes, type V2OwnRoute } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { boundedRequest } from '@/lib/use-capture';
import { usePlaceCaptureAvailable, usePlaceReportsAvailable, usePickupQuestionAvailable } from '@/lib/use-place-capture';
import type { OwnRouteContext } from '@/lib/actual-journey-model';
import { CaptureButton, CaptureFrame, CaptureHelp, captureStyles as s } from './CapturePrimitives';

/** Read-only history. Selecting a route rechecks ownership/current identity;
 * the actual form remains the sole writer of its encrypted account draft. */
export function OwnRoutes({ onClose, onFollowUp, onPlaces, onAddRoute }: { onClose(): void; onFollowUp(route: OwnRouteContext): void; onPlaces(route: OwnRouteContext, questionMode?: boolean): void; onAddRoute(): void }) {
  const auth = useAuth(), owner = auth.user?.id ?? null, placesEnabled = usePlaceCaptureAvailable(), placeReadEnabled=usePlaceReportsAvailable(), questionEnabled=usePickupQuestionAvailable();
  const actor = useRef(owner); actor.current = auth.user?.id ?? null;
  const alive = useRef(true), busyRef = useRef(false);
  const [routes, setRoutes] = useState<V2OwnRoute[]>([]), [cursor, setCursor] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [signIn, setSignIn] = useState(false);
  const active = () => alive.current && actor.current === owner;
  const headers = { 'X-Mabhazi-Account': owner ?? '' };
  async function load(more = false) {
    if (!owner || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await boundedRequest(signal => listV2OwnRoutes(more && cursor ? { cursor } : undefined, { signal, headers }));
      if (!active()) return;
      setRoutes(previous => more ? [...previous, ...result.routes.filter(row => !previous.some(old => old.clientSubmissionId === row.clientSubmissionId))] : result.routes);
      setCursor(result.nextCursor); setLoaded(true); setSignIn(false);
    } catch (cause) {
      if (active()) { setError('Your routes could not be loaded. Try again.'); setSignIn((cause as { status?: number }).status === 401); }
    } finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  async function select(key: string, places = false, question = false) {
    if (!owner || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const { route } = await boundedRequest(signal => getV2OwnRoute(key, { signal, headers }));
      if (!active()) return;
      setRoutes(previous => previous.map(row => row.clientSubmissionId === key ? route : row));
      if (route.clientSubmissionId !== key || route.availability !== 'active' || !Number.isSafeInteger(route.currentLeadRevision) || route.currentLeadRevision! < 1) {
        setError('Details are unavailable for this submitted route.'); return;
      }
      (places ? (context: OwnRouteContext) => onPlaces(context, question) : onFollowUp)({ ownerId: owner, subjectId: route.subjectId, clientSubmissionId: route.clientSubmissionId,
        expectedRevision: route.currentLeadRevision!, origin: route.origin, destination: route.destination,
        operator: route.operator, departureTime: route.departureTime });
    } catch (cause) {
      if (active()) { setError((cause as { status?: number }).status === 404 ? 'This submitted route is unavailable. Refresh your routes.' : 'Could not check this route. Try again.'); setSignIn((cause as { status?: number }).status === 401); }
    } finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  async function login() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await auth.login(); if (active()) { setSignIn(false); busyRef.current = false; await load(); } }
    catch { if (active()) setError('Sign-in did not finish. Try again.'); }
    finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  return <CaptureFrame title="My routes" onClose={onClose} closeLabel="Close your routes" footer={<CaptureButton title="Done" secondary onPress={onClose} />}>
    {!owner ? <><Text style={s.reviewValue}>Sign in to see your submitted routes.</Text><CaptureButton title="Sign in" busy={busy} onPress={() => void login()} /></> : <>
      <CaptureButton title="Refresh routes" secondary disabled={busy} onPress={() => void load()} />
      {busy ? <ActivityIndicator accessibilityLabel="Loading your routes" /> : null}
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      {signIn ? <CaptureButton title="Sign in again" busy={busy} onPress={() => void login()} /> : null}
      {loaded && !routes.length ? <><Text style={s.reviewValue}>No submitted routes yet.</Text><CaptureButton title="Add a route" disabled={busy} onPress={onAddRoute} /></> : null}
      {routes.map(route => <View key={route.clientSubmissionId} style={{paddingVertical:20,borderBottomWidth:1,borderColor:ui.color.border,gap:8}}>
        <Text style={s.reviewValue}>{route.origin.name} → {route.destination.name}</Text>
        <Text style={s.note}>{route.operator} · {route.departureTime}</Text>
        <Text style={s.note}>{route.availability === 'active' ? 'Submitted' : 'Unavailable'} · {fareDate(String(route.submittedAt))}</Text>
        {route.availability === 'active' && route.currentLeadRevision ? <CaptureButton title="Add details" secondary disabled={busy} onPress={() => void select(route.clientSubmissionId)} /> : null}
        {placeReadEnabled && route.availability === 'active' ? <CaptureHelp label="Your saved locations"><PlaceReports subjectId={route.subjectId} ownSubmissionId={route.clientSubmissionId} onBusy={()=>{}} onChanged={()=>void load()}/></CaptureHelp> : null}
        {questionEnabled && route.availability === 'active' && route.currentLeadRevision ? <CaptureButton title="Help with pickup" secondary disabled={busy} onPress={() => void select(route.clientSubmissionId, true, true)} /> : null}
        {placesEnabled && route.availability === 'active' && route.currentLeadRevision ? <CaptureButton title="Add pickup / drop-off" secondary disabled={busy} onPress={() => void select(route.clientSubmissionId, true)} /> : null}
      </View>)}
      {cursor ? <CaptureButton title="Load more routes" disabled={busy} onPress={() => void load(true)} /> : null}
      {loaded && routes.length ? <CaptureHelp label="About submitted routes"><Text style={s.note}>These are your saved route reports. Submitted does not mean reviewed or published.</Text></CaptureHelp> : null}
    </>}
  </CaptureFrame>;
}
