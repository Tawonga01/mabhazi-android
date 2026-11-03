import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { getV2PickupQuestion, recordV2PickupQuestionEvent, reserveV2PickupQuestion, type V2PickupQuestionEventRequest, type V2RouteObservationRequest } from '@workspace/api-client-react';
import { useAuth } from './auth';
import { boundedRequest, useCapture } from './use-capture';
import { publicSafetyHeaders } from './use-public-routes';
import { placeDrafts } from './lead-drafts';
import type { PlaceDraft } from './route-place-model';
import { acceptPickupQuestion, acknowledgePickupEvent, independentPlaces, queuePickupEvent, reservationFor } from './pickup-question-model';

type Capture = ReturnType<typeof useCapture<PlaceDraft, V2RouteObservationRequest>>;
export function usePickupQuestion(c: Capture, blocked: Set<string>, safetyReady: boolean) {
  const auth = useAuth(), owner = c.owner, actor = useRef(owner); actor.current = auth.user?.id ?? null;
  const mounted = useRef(true), busyRef = useRef(false), checked = useRef('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [checking, setChecking] = useState(false), [authNeeded, setAuthNeeded] = useState(false);
  const current = () => mounted.current && actor.current === owner;
  const d = c.draft, q = d.question;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(work: () => Promise<void>) {
    if (!current() || !owner || busyRef.current || c.busy || c.resume || c.pending || c.receipt || !safetyReady) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (cause) {
      if (current() && (cause as { status?: number }).status === 401) setAuthNeeded(true);
      if (current()) setError((cause as { status?: number }).status === 401 ? 'Sign in again to continue this question. Your draft is kept.' : 'This step could not be confirmed. Your answers and retry reference are kept.');
    } finally { busyRef.current = false; if (current()) setBusy(false); }
  }
  const headers = () => publicSafetyHeaders(owner, blocked);
  async function flush(start: PlaceDraft): Promise<PlaceDraft> {
    let next = start;
    for (const event of start.question?.events.filter(e => !e.sent) ?? []) {
      if (!current()) throw Error('ACCOUNT_CHANGED');
      const { sent, ...request } = event;
      await boundedRequest(signal => recordV2PickupQuestionEvent(next.question!.invitationId!, request, { signal, headers: headers() }));
      if (!current()) throw Error('ACCOUNT_CHANGED');
      next = acknowledgePickupEvent(next, event.clientEventId);
      if (!await c.checkpoint(next)) throw Error('DRAFT_NOT_STORED');
    }
    return next;
  }
  async function reserve() {
    await run(async () => {
      if (!q || !['setup','reserving'].includes(q.phase)) return;
      const frozen = { ...d, question: { ...q, phase: 'reserving' as const } };
      const request = reservationFor(frozen);
      if (!await c.checkpoint(frozen) || !current()) return;
      const state = await boundedRequest(signal => reserveV2PickupQuestion(request, { signal, headers: headers() }));
      if (!current()) return;
      await c.checkpoint(acceptPickupQuestion(frozen, state));
    });
  }
  async function feedback(outcome: V2PickupQuestionEventRequest['outcome']) {
    await run(async () => {
      if (!q?.invitationId) return;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const next = queuePickupEvent(d, outcome, Crypto.randomUUID(), timezone);
      if (!await c.checkpoint(next) || !current()) return;
      await flush(next);
    });
  }
  async function retryFeedback() { await run(async () => { await flush(d); }); }
  async function independent() {
    await run(async () => {
      // A terminal/unavailable question must not remove access to manual help.
      // No possibly committed answer can reach this path (run guards pending).
      const next = q?.phase === 'none' || q?.phase === 'ended' ? d : await flush(d);
      if (current()) await c.checkpoint(independentPlaces(next));
    });
  }
  async function login() { await run(async () => { if (!await c.checkpoint(d) || !current()) return; await auth.login(); if (current()) setAuthNeeded(false); }); }
  async function finish(onClose: () => void) {
    await run(async () => {
      const hasAnswers = [d.pickup,d.dropoff].some(a => !!(a.name || a.instructions || a.date || a.knowledge));
      if (!hasAnswers && !q?.events.some(e => !e.sent)) { await placeDrafts.remove(owner); if (current()) onClose(); }
      else await c.close(onClose);
    });
  }
  // This effect follows an actual offered render, not a reservation response.
  useEffect(() => {
    if (c.ready && !c.resume && !c.pending && !c.receipt && q?.phase === 'offered' && !q.events.some(e => e.outcome === 'shown') && !busyRef.current && !c.busy && safetyReady) void feedback('shown');
  }, [c.ready, c.resume, c.pending, c.receipt, c.busy, busy, q?.phase, q?.invitationId, safetyReady]);
  // A resumed invitation is checked without consuming a new invitation or key.
  useEffect(() => {
    if (!c.ready || c.resume || c.pending || c.receipt || !q?.invitationId || !safetyReady || checked.current === q.invitationId || busyRef.current) return;
    checked.current = q.invitationId;
    let alive = true; setChecking(true);
    void boundedRequest(signal => getV2PickupQuestion(q.invitationId!, { signal, headers: headers() })).then(state => {
      if (!alive || !current() || !['offered','answer'].includes(q.phase)) return;
      if (state.status === 'reconfirm_identity' || state.status === 'unavailable' || state.status === 'obsolete') {
        return c.checkpoint({ ...d, question: { ...q, phase: 'none', reason: state.status } });
      }
      if (['skip','dismiss','unknown','answered','suppressed'].includes(state.status)) return c.checkpoint({ ...d, question: { ...q, phase: 'ended', reason: state.status } });
      // Expiry does not erase a compatible independently supplied answer.
    }).catch(() => { if (alive && current()) setError('This question could not be checked. Your draft is kept.'); }).finally(() => { if (alive && current()) setChecking(false); });
    return () => { alive = false; };
  }, [c.ready, c.resume, c.pending, c.receipt, q?.invitationId, safetyReady, busy]);
  return { busy: busy || checking, error, reserve, feedback, retryFeedback, independent, finish, authNeeded, login, pendingFeedback: !!q?.events.some(e => !e.sent) };
}
