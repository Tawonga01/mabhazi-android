import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { getV2Capabilities, getV2LeadReceipt, type V2LeadReceipt } from '@workspace/api-client-react';
import { useAuth } from './auth';
import { recoverOrSubmit, type PendingLead } from './minimum-lead-model';
import type { SecureDraftRecord } from './secure-draft-store';
import { useTermsAcceptance } from '@/components/TermsAcceptance';

export async function boundedRequest<T>(request: (signal: AbortSignal) => Promise<T>, parent?:AbortSignal): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  const abort=()=>controller.abort();parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)controller.abort();
  try { return await request(controller.signal); } finally { clearTimeout(timer);parent?.removeEventListener('abort',abort); }
}
interface CaptureStore<D, R> {
  read(owner: string | null): Promise<SecureDraftRecord<D, R> | null>;
  write(record: SecureDraftRecord<D, R>): Promise<void>;
  remove(owner: string | null): Promise<void>;
}
export interface CaptureOptions<D, R> {
  empty(): D; errors(draft: D): Record<string, string>; prepare(draft: D, key: string): R;
  hasAnswers(draft: D): boolean; store: CaptureStore<D, R>;
  capability: 'minimumLeadEnabled' | 'actualJourneyEnabled';
  submit(request: R, options: { signal: AbortSignal; headers: Record<string, string> }): Promise<V2LeadReceipt>;
}
/** Shared explicit review/submit lifecycle; no autosubmit on login, resume or Terms. */
export function useCapture<D, R extends { clientSubmissionId: string }>(owner: string | null, options: CaptureOptions<D, R>) {
  const auth = useAuth(), terms = useTermsAcceptance();
  const actor = useRef(owner); actor.current = auth.user?.id ?? null;
  const mounted = useRef(true), active = () => mounted.current && actor.current === owner;
  const [draft, setDraft] = useState<D>(options.empty), updatedAt = useRef(Date.now());
  const [ready, setReady] = useState(false), [resume, setResume] = useState<SecureDraftRecord<D, R> | null>(null);
  const [pending, setPending] = useState<PendingLead<R> | undefined>(), [receipt, setReceipt] = useState<V2LeadReceipt | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({}), [message, setMessage] = useState(''), [storageError, setStorageError] = useState('');
  const [targetProblem, setTargetProblem] = useState(false);
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [reviewing, setReviewing] = useState(false), [authExpired, setAuthExpired] = useState(false);
  const [enabled, setEnabled] = useState(false), [capabilityBusy, setCapabilityBusy] = useState(true);
  async function checkCapability() {
    setCapabilityBusy(true);
    try { const result = await boundedRequest(signal => getV2Capabilities({ signal })); if (active()) setEnabled(result[options.capability] === true); }
    catch { if (active()) setEnabled(false); }
    finally { if (active()) setCapabilityBusy(false); }
  }
  useEffect(() => {
    mounted.current = true; void checkCapability();
    void (async () => {
      try {
        const owned = await options.store.read(owner), guest = owner && !owned ? await options.store.read(null) : null;
        if (active() && (owned || guest)) setResume(owned ?? guest);
      } catch { if (active()) setStorageError('Your saved draft could not be read. Keep this screen open while entering answers.'); }
      finally { if (active()) setReady(true); }
    })();
    return () => { mounted.current = false; };
  }, []);
  const record = (frozen = pending): SecureDraftRecord<D, R> => ({ version: 1, owner, updatedAt: updatedAt.current, draft, ...(frozen ? { pending: frozen } : {}) });
  useEffect(() => {
    if (!ready || resume || receipt || busy) return;
    const persist = options.hasAnswers(draft) ? options.store.write(record()) : options.store.remove(owner);
    void persist.then(() => { if (active()) setStorageError(''); })
      .catch(() => { if (active()) setStorageError('This draft could not be saved securely. Keep this screen open; Save needs a securely stored retry reference.'); });
  }, [draft, pending, ready, resume, receipt, busy]);
  function change(next: D) {
    if (pending || busy) return;
    updatedAt.current = Date.now(); setDraft(next); setErrors({}); setMessage(''); setReviewing(false);
  }
  function review() {
    const validation = options.errors(draft); setErrors(validation);
    if (Object.keys(validation).length) { setMessage('Check the marked answers.'); return Object.keys(validation)[0]; }
    setReviewing(true); setMessage(''); return null;
  }
  async function close(done: () => void) {
    if (busyRef.current || !ready) return;
    busyRef.current = true; setBusy(true);
    try {
      if (!resume && !receipt) { if (options.hasAnswers(draft)) await options.store.write(record()); else await options.store.remove(owner); }
      if (active()) done();
    }
    catch { if (active()) setStorageError('Could not keep this draft securely. Please keep the form open and try again.'); }
    finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  async function submit() {
    if (busyRef.current || !ready || resume || receipt || (!reviewing && !pending)) return;
    if (!pending && Object.keys(options.errors(draft)).length) { review(); return; }
    busyRef.current = true; setBusy(true); setMessage('');
    let frozenStored = !!pending, signingIn = false;
    try {
      if (!owner || authExpired) {
        await options.store.write(record()); // Flush before a browser or native auth transition.
        if (!active()) return;
        signingIn = true; await auth.login();
        if (active()) { setAuthExpired(false); setMessage('Review your answers after sign-in, then tap Save. Nothing submits automatically.'); }
        return;
      }
      // A lost response may already have committed: receipt lookup precedes Terms.
      if (!pending && !await terms.requireAcceptance()) { if (active()) setMessage('Accept the current Terms, then tap Save. Your answers are kept.'); return; }
      if (!active()) return;
      const frozen = pending ?? { actor: owner, request: options.prepare(draft, Crypto.randomUUID()) };
      await options.store.write(record(frozen));
      frozenStored = true;
      if (!active()) return;
      setPending(frozen);
      const headers = { 'X-Mabhazi-Account': owner };
      const result = await recoverOrSubmit(frozen, {
        lookup: key => boundedRequest(signal => getV2LeadReceipt(key, { signal, headers })),
        submit: request => boundedRequest(signal => options.submit(request, { signal, headers })),
      }, () => mounted.current ? actor.current : null);
      if (!active()) return;
      setReceipt(result); setPending(undefined);
      try { await options.store.remove(owner); await options.store.remove(null); }
      catch { if (active()) setStorageError('Saved online. Local draft cleanup will be retried when you sign out.'); }
    } catch (error) {
      if (!active()) return;
      const problem = error as { status?: number; message?: string; data?: { error?: string; code?: string } };
      if (signingIn) setMessage('Sign-in did not finish. Your draft is kept. Try signing in again. Nothing was submitted automatically.');
      else if (!frozenStored && !problem.status) setMessage('A secure retry reference could not be saved. Nothing was sent. Keep this form open and try Save again.');
      else if (problem.status === 428) { await terms.refetch(); if (active()) setMessage('Accept the current Terms, then check and retry. Your answers and reference are kept.'); }
      else if (problem.status === 401) { setAuthExpired(true); setMessage('Sign in again with this account to check its saved receipt. Your answers are kept.'); }
      else if (problem.status === 422) { setPending(undefined); setReviewing(false); setMessage(problem.data?.error ?? 'The server rejected these answers. Review and correct them.'); }
      else if (problem.data?.code === 'ACCOUNT_CHANGED' || problem.message === 'ACCOUNT_CHANGED') setMessage('The active account changed. Reopen your own draft before continuing.');
      else if (problem.data?.code === 'TARGET_NOT_FOUND' || problem.data?.code === 'TARGET_IDENTITY_CHANGED') { setTargetProblem(true); setMessage('The selected route changed or is unavailable. Your report is kept.'); }
      else if (problem.status === 409) setMessage('This reference has different saved answers. Keep this reference and check its receipt before starting another entry.');
      else setMessage('Save not confirmed. Keep this draft and use Check and retry; it checks for a saved receipt before sending the same answers.');
    } finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  async function resumeDraft() {
    if (!resume || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      // Explicit adoption writes the account copy before removing a guest copy.
      if (owner && resume.owner === null) {
        await options.store.write({ ...resume, owner });
        if (!active()) return;
        await options.store.remove(null);
      }
      if (!active()) return;
      updatedAt.current = resume.updatedAt; setDraft(resume.draft); setPending(resume.pending); setResume(null); setReviewing(!!resume.pending);
    } catch { if (active()) setStorageError('Could not resume securely. Your saved draft is kept; try again.'); }
    finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  async function discard() {
    if (!resume || resume.pending || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await options.store.remove(owner); if (owner) await options.store.remove(null); if (active()) { setResume(null); updatedAt.current = Date.now(); } }
    catch { if (active()) setStorageError('The saved draft could not be removed. Try again.'); }
    finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  // Explicit recovery only after a definitive target rejection. Never edit a
  // possibly committed request: privately look up its receipt first.
  async function changeRejectedTarget(nextDraft: D) {
    if (!targetProblem || !pending || busyRef.current || !owner) return;
    busyRef.current = true; setBusy(true);
    try {
      const lookup = await boundedRequest(signal => getV2LeadReceipt(pending.request.clientSubmissionId, { signal, headers: { 'X-Mabhazi-Account': owner } }));
      if (!active()) return;
      if (lookup.found) {
        const saved = await recoverOrSubmit(pending, { lookup: async () => lookup, submit: async () => { throw new Error('RECEIPT_EXPECTED'); } }, () => mounted.current ? actor.current : null);
        if (!active()) return;
        setReceipt(saved); setPending(undefined); setTargetProblem(false); setMessage('');
        try { await options.store.remove(owner); await options.store.remove(null); }
        catch { if (active()) setStorageError('Saved online. Local draft cleanup will be retried when you sign out.'); }
        return;
      }
      if (lookup.found !== false) throw new Error('RECEIPT_UNCONFIRMED');
      const time = Date.now();
      await options.store.write({ version: 1, owner, updatedAt: time, draft: nextDraft });
      if (!active()) return;
      updatedAt.current = time; setDraft(nextDraft); setPending(undefined); setReviewing(false); setTargetProblem(false);
      setMessage('Kept as an independent report. Review your answers before saving.'); setStorageError('');
    } catch { if (active()) setMessage('Could not check the previous save. Your original report and reference are kept. Try again.'); }
    finally { busyRef.current = false; if (active()) setBusy(false); }
  }
  function another() { setTargetProblem(false); updatedAt.current = Date.now(); setReceipt(null); setDraft(options.empty()); setErrors({}); setMessage(''); setStorageError(''); setReviewing(false); }
  return { draft, change, errors, review, reviewing, edit: () => { if (!pending && !busy) setReviewing(false); }, submit, close, ready, resume, resumeDraft, discard,
    receipt, another, pending, targetProblem, changeRejectedTarget, busy, locked: !!pending || busy, enabled, capabilityBusy, checkCapability, terms, owner, authExpired, message, storageError };
}
