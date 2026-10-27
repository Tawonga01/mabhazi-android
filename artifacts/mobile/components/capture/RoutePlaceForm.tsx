import * as Crypto from 'expo-crypto';
import { newPickupQuestion, type PickupDeclaration } from '@/lib/pickup-question-model';
import { usePickupQuestion } from '@/lib/use-pickup-question';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from 'react-native';
import { getV2RouteContributionContext, getV2PickupQuestion, submitV2PickupQuestionAnswer, submitV2RouteObservations, type V2RouteObservationRequest } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import type { CaptureRouteContext } from '@/lib/actual-journey-model';
import { knowledgeChoices } from '@/lib/actual-journey-model';
import { placeDrafts } from '@/lib/lead-drafts';
import { readBlockedContributors } from '@/hooks/blockedContributorStorage';
import { useBlockedContributors } from '@/hooks/useBlockedContributors';
import { publicSafetyHeaders } from '@/lib/use-public-routes';
import { boundedRequest, useCapture, type CaptureOptions } from '@/lib/use-capture';
import { emptyPlaceDraft, placeErrors, preparePlaces, togglePlace, type PlaceDraft, type PlaceKind } from '@/lib/route-place-model';
import { CaptureButton, CaptureFrame, CaptureHelp, CaptureInput, Choices, Field, ReviewRow, captureStyles as s } from './CapturePrimitives';
import { CaptureMessages, CaptureStatus, SavedMessage } from './CaptureStatus';
const options: CaptureOptions<PlaceDraft, V2RouteObservationRequest> = {
  empty: emptyPlaceDraft, errors: placeErrors, prepare: preparePlaces, store: placeDrafts,
  hasAnswers: d => !!d.route || d.selected.some(k => !!(d[k].name || d[k].instructions || d[k].date || d[k].knowledge)),
  capability: 'routeObservationsEnabled',
  submit: async (request, opts, draft) => {
    const options = { ...opts, headers: publicSafetyHeaders(opts.headers['X-Mabhazi-Account'], new Set((await readBlockedContributors()).map(x => x.id))) };
    return draft.question?.invitationId ? submitV2PickupQuestionAnswer(draft.question.invitationId, request, options) : submitV2RouteObservations(request, options);
  },
  recovered: (draft, opts) => draft.question?.invitationId ? getV2PickupQuestion(draft.question.invitationId, opts) : Promise.resolve(),
};
export function RoutePlaceForm({ onClose, route, questionMode = false, entrySurface = 'contribute_tab' }: { onClose(): void; route?: CaptureRouteContext; questionMode?: boolean; entrySurface?: PlaceDraft['entrySurface'] }) {
  const auth = useAuth();
  return auth.isLoading ? <ActivityIndicator /> : <AccountPlace key={auth.user?.id ?? 'guest'} owner={auth.user?.id ?? null} route={route} questionMode={questionMode} entrySurface={entrySurface} onClose={onClose} />;
}
function AccountPlace({ owner, route, questionMode, entrySurface, onClose }: { owner: string | null; route?: CaptureRouteContext; questionMode: boolean; entrySurface: PlaceDraft['entrySurface']; onClose(): void }) {
  const c = useCapture(owner, options), d = c.draft, safety = useBlockedContributors();
  const question = usePickupQuestion(c, safety.blockedContributorIds, safety.isReady), q = d.question;
  const locked = c.locked || question.busy, questionStep = !!q && q.phase !== 'answer';
  const actor = useRef(owner); actor.current = owner;
  const refs = useRef<Record<string, TextInput | null>>({}), [contextBusy, setContextBusy] = useState(false), [contextError, setContextError] = useState(''), [retry, setRetry] = useState(0), [details, setDetails] = useState(false);
  const contextSubject = d.needsContextRefresh ? d.route?.subjectId : !d.route && route?.ownerId === owner ? route.subjectId : undefined;
  useEffect(() => {
    if (!c.ready || c.resume || c.pending || c.receipt || !c.enabled || !owner || !contextSubject || !safety.isReady) return;
    let alive = true; const controller = new AbortController(); setContextBusy(true); setContextError('');
    void boundedRequest(signal => getV2RouteContributionContext(contextSubject, { signal, headers: publicSafetyHeaders(owner, safety.blockedContributorIds) }), controller.signal).then(value => {
      if (alive && actor.current === owner) {
        const next = { ...d, route: { ...value, ownerId: owner }, entrySurface: d.route ? d.entrySurface : entrySurface, needsContextRefresh: false };
        c.change(questionMode && !d.route ? { ...next, question: newPickupQuestion(next, Crypto.randomUUID()) } : next);
      }
    }).catch(() => { if (alive && actor.current === owner) setContextError('This route could not be checked. Your answers are kept.'); }).finally(() => { if (alive) setContextBusy(false); });
    return () => { alive = false; controller.abort(); };
  }, [c.ready, c.resume, c.pending, c.receipt, c.enabled, owner, contextSubject, safety.isReady, retry]);
  const reviewing = c.reviewing || !!c.pending;
  function review() { const field = c.review(); if (field?.endsWith('.date') || field?.endsWith('.instructions')) setDetails(true); if (field) setTimeout(() => refs.current[field]?.focus(), 0); }
  function answer(kind: PlaceKind, key: 'name' | 'instructions' | 'date' | 'knowledge', value: string) { c.change({ ...d, [kind]: { ...d[kind], [key]: value } }); }
  const questionFooter = q?.phase === 'setup' || q?.phase === 'reserving' ? <><CaptureButton title={q.phase === 'reserving' ? 'Check pickup question' : 'Continue'} disabled={!q.declaration || contextBusy || !safety.isReady} busy={c.busy || question.busy} onPress={() => void question.reserve()} /><CaptureButton title="Add a location instead" secondary disabled={c.busy || question.busy} onPress={() => void question.independent()} /></> : q?.phase === 'offered' ? <><CaptureButton title="Add pickup" disabled={question.pendingFeedback} busy={c.busy || question.busy} onPress={() => void question.feedback('opened')} /><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><CaptureButton title="I don’t know" secondary disabled={locked || question.pendingFeedback} onPress={() => void question.feedback('unknown')} /><CaptureButton title="Not now" secondary disabled={locked || question.pendingFeedback} onPress={() => void question.feedback('dismiss')} /></View></> : <><CaptureButton title="Done" busy={c.busy || question.busy} onPress={() => void question.finish(onClose)} /><CaptureButton title="Add a location instead" secondary disabled={locked} onPress={() => void question.independent()} /></>;
  const questionBody = q?.phase === 'setup' || q?.phase === 'reserving' ? <Choices<'' | PickupDeclaration> label="Your connection to this route" value={q.declaration} options={[[ 'knows_route', 'I know this route' ], [ 'at_stop', 'I’m at the stop' ], [ 'travelled', 'I’ve travelled on it' ]]} disabled={locked || q.phase === 'reserving'} onChange={value => c.change({ ...d, question: { ...q, declaration: value } })} /> : q?.phase === 'offered' ? <Text style={{ ...s.reviewValue, fontSize: 22, lineHeight: 30 }}>Where does this bus pick up in {d.route?.origin.name}?</Text> : <View style={{ gap: 12 }}><Text style={s.reviewValue}>{q?.phase === 'ended' ? 'Question closed.' : q?.reason === 'reconfirm_identity' ? 'This route has changed.' : 'No pickup question right now.'}</Text>{d.pickup.name.trim() ? <Text style={s.note}>Your unsent location answers are kept.</Text> : null}</View>;
  const footer = c.receipt ? <CaptureButton title="Done" onPress={() => void c.close(onClose)} /> : c.resume ? <><CaptureButton title="Resume draft" disabled={c.busy} onPress={c.resumeDraft} />{!c.resume.pending ? <CaptureButton title="Discard unsent draft" secondary disabled={c.busy} onPress={() => void c.discard()} /> : null}</> : c.targetProblem && d.route ? <CaptureButton title="Check changed route" busy={c.busy} onPress={() => void c.changeRejectedTarget({ ...d, question: undefined, needsContextRefresh: true }, 'Your location answers are kept. Check the refreshed route, then review before saving.')} /> : questionStep ? questionFooter : c.ready ? <><CaptureButton title={reviewing ? c.authExpired ? 'Sign in to check saved receipt' : c.pending ? 'Check and retry' : owner ? q ? 'Save pickup' : 'Save locations' : 'Sign in to save' : q ? 'Review pickup' : 'Review locations'} busy={c.busy || question.busy} disabled={contextBusy || question.pendingFeedback || !safety.isReady || !d.route || d.needsContextRefresh || reviewing && !c.enabled && !c.pending} onPress={reviewing ? () => void c.submit() : review} />{reviewing && !c.pending ? <CaptureButton title="Edit answers" secondary disabled={c.busy || question.busy} onPress={c.edit} /> : null}</> : undefined;
  return <CaptureFrame title={c.receipt ? 'Locations saved' : reviewing ? 'Review locations' : q ? 'Help with pickup' : 'Pickup or drop-off'} onClose={() => void c.close(onClose)} busy={c.busy || question.busy} footer={footer} phase={c.receipt ? 'saved' : c.resume ? 'resume' : reviewing ? 'review' : q?.phase ?? 'edit'}>
    {c.receipt ? <SavedMessage reference={c.receipt.clientSubmissionId} /> : c.resume ? <><Text style={s.reviewValue}>Your location draft is kept.</Text><Text style={s.note}>{c.resume.pending ? 'Check the previous save before sending anything again.' : 'Resume with its original route and answers.'}</Text></> : !c.ready ? <ActivityIndicator accessibilityLabel="Loading location draft" /> : <>
      {d.route ? <View style={{ gap: 14 }}><Text style={{ fontSize: 24, lineHeight: 31, fontWeight: '700', color: '#172D46' }}>{d.route.origin.name} → {d.route.destination.name}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Image source={require('../../assets/images/departures-bus.png')} accessible={false} style={{ width: 26, height: 29, tintColor: '#B3632C' }} /><Text style={[s.reviewValue, { flex: 1, fontSize: 16 }]}>{d.route.operatorName} · {d.route.departureTime}</Text></View></View> : null}
      {contextBusy ? <ActivityIndicator accessibilityLabel="Checking route for locations" /> : null}
      {contextError ? <><Text accessibilityRole="alert" style={s.error}>{contextError}</Text><CaptureButton title="Try route again" secondary onPress={() => setRetry(v => v + 1)} /></> : null}
      {safety.error ? <><Text accessibilityRole="alert" style={s.error}>Safety settings could not load.</Text><CaptureButton title="Try safety settings again" secondary onPress={() => void safety.retryBlockedContributors().catch(() => undefined)} /></> : null}
      {!d.route && !contextBusy && !contextError && !route ? <Text style={s.reviewValue}>Choose a route from Search or My routes.</Text> : null}
      {questionStep ? questionBody : reviewing ? <View style={s.group}>{d.selected.map(k => <React.Fragment key={k}><ReviewRow label={`${k === 'pickup' ? 'Pickup' : 'Drop-off'} in ${k === 'pickup' ? d.route?.origin.name : d.route?.destination.name}`} value={d[k].name.trim()} />{d[k].instructions.trim() ? <Text style={s.note}>{d[k].instructions.trim()}</Text> : null}{d[k].date ? <ReviewRow label="Observed" value={d[k].date} /> : null}{d[k].knowledge ? <Text style={s.note}>{knowledgeChoices.find(x => x[0] === d[k].knowledge)?.[1]}</Text> : null}</React.Fragment>)}</View> : d.route && !d.needsContextRefresh ? <>
        {!q ? <View style={s.choices}>{(['pickup','dropoff'] as const).map(k => <Pressable key={k} accessibilityRole="checkbox" accessibilityLabel={k === 'pickup' ? 'Pickup location' : 'Drop-off location'} aria-checked={d.selected.includes(k)} accessibilityState={{ checked: d.selected.includes(k), disabled: locked }} disabled={locked} onPress={() => c.change(togglePlace(d, k))} style={[s.choice, { flex: 1, alignItems: 'center' }, d.selected.includes(k) && s.selected]}><Text style={s.secondaryText}>{d.selected.includes(k) ? '✓ ' : '+ '}{k === 'pickup' ? 'Pickup' : 'Drop-off'}</Text></Pressable>)}</View> : null}
        {c.errors.question ? <Text accessibilityRole="alert" style={s.error}>{c.errors.question}</Text> : null}
        {c.errors.selected ? <Text accessibilityRole="alert" style={s.error}>{c.errors.selected}</Text> : null}
        {d.selected.map(k => <View key={k} style={s.group}><Field label={`${k === 'pickup' ? 'Pickup' : 'Drop-off'} in ${k === 'pickup' ? d.route!.origin.name : d.route!.destination.name}`} error={c.errors[k + '.name']}><CaptureInput ref={v => { refs.current[k + '.name'] = v; }} accessibilityLabel={k === 'pickup' ? 'Pickup place name' : 'Drop-off place name'} value={d[k].name} onChangeText={v => answer(k, 'name', v)} maxLength={200} editable={!locked} placeholder="Station, rank or landmark" /></Field>
          {details ? <><Field label="Directions (optional)" error={c.errors[k + '.instructions']}><CaptureInput ref={v => { refs.current[k + '.instructions'] = v; }} accessibilityLabel={k + ' directions'} value={d[k].instructions} onChangeText={v => answer(k, 'instructions', v)} maxLength={500} multiline editable={!locked} /></Field><Field label="Observed date (optional)" error={c.errors[k + '.date']}><CaptureInput ref={v => { refs.current[k + '.date'] = v; }} accessibilityLabel={k + ' observation date'} value={d[k].date} onChangeText={v => answer(k, 'date', v)} placeholder="YYYY-MM-DD" maxLength={10} editable={!locked} /></Field><Choices label={`${k === 'pickup' ? 'Pickup' : 'Drop-off'} knowledge`} value={d[k].knowledge} options={knowledgeChoices} onChange={v => answer(k, 'knowledge', v)} disabled={locked} /></> : null}
        </View>)}
        {q ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><CaptureButton title="I don’t know" secondary disabled={locked || !!c.pending || question.pendingFeedback} onPress={() => void question.feedback('unknown')} /><CaptureButton title="Skip question" secondary disabled={locked || !!c.pending || question.pendingFeedback} onPress={() => void question.feedback('skip')} /></View> : null}
        <CaptureButton title={details ? 'Hide optional details' : 'Add directions or date'} secondary disabled={locked} onPress={() => setDetails(v => !v)} />
      </> : null}
      {reviewing || !c.enabled ? <CaptureStatus capture={c} /> : null}
    </>}
    {question.authNeeded ? <CaptureButton title="Sign in again" secondary disabled={c.busy || question.busy} onPress={() => void question.login()} /> : null}
    {question.error ? <Text accessibilityRole="alert" style={s.error}>{question.error}</Text> : null}
    {question.pendingFeedback && !question.busy ? <CaptureButton title="Retry question step" secondary onPress={() => void question.retryFeedback()} /> : null}
    <CaptureMessages message={c.message} storageError={c.storageError} />
    {!c.receipt && !c.resume && !reviewing && !questionStep ? <CaptureHelp label="About location reports"><Text style={s.note}>Report a place you know. You do not need to have travelled. Locations are saved as reports, awaiting processing.</Text></CaptureHelp> : null}
  </CaptureFrame>;
}
