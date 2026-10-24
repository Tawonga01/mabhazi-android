import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useAuth } from '@/lib/auth';
import type { OwnRouteContext } from '@/lib/actual-journey-model';
import { useRouter } from 'expo-router';
import { CaptureEntryContext, CaptureFrameContext } from '@/lib/capture-context';
import type { CaptureRequest } from '@/lib/contribution-moments';
import { MinimumLeadForm } from '@/components/MinimumLeadForm';
import { ActualJourneyForm } from './ActualJourneyForm';
import { OwnRoutes } from './OwnRoutes';

/** One manual capture at a time; tabs cannot run competing writers for the same draft. */
export function CaptureHost({ children }: { children: React.ReactNode }) {
  const router = useRouter(), auth = useAuth();
  const [active, setActive] = useState<(CaptureRequest & { id: string }) | null>(null);
  const [revision, setRevision] = useState(0), occupied = useRef(false);
  const frame = useRef<{ close: (() => void) | undefined; busy: boolean } | null>(null);
  const open = useCallback((request: CaptureRequest) => {
    if (occupied.current) return false;
    occupied.current = true;
    setActive({ ...request, id: Crypto.randomUUID() });
    return true;
  }, []);
  const dismiss = useCallback(() => {
    frame.current = null; occupied.current = false; setActive(null); setRevision(value => value + 1);
  }, []);
  const register = useCallback((close: (() => void) | undefined, busy: boolean) => {
    const current = { close, busy }; frame.current = current;
    return () => { if (frame.current === current) frame.current = null; };
  }, []);
  const presentation = useMemo(() => ({ overlay: true, register }), [register]);
  const entry = useMemo(() => ({ open, isOpen: !!active, revision }), [open, active, revision]);
  function followUp(route: OwnRouteContext) {
    if (!active || !['route','history'].includes(active.kind) || auth.user?.id !== route.ownerId) return;
    frame.current = null;
    setActive({ kind: 'journey', entrySurface: 'own_contribution', route, id: Crypto.randomUUID() });
  }
  function openFullForm() {
    const prefill = active?.kind === 'route' ? active.prefill : undefined;
    dismiss();
    router.navigate({ pathname: '/contribute', params: {
      full: '1', fromCity: prefill?.origin?.name ?? prefill?.originQuery ?? '',
      toCity: prefill?.destination?.name ?? prefill?.destinationQuery ?? '',
    } });
  }
  return <CaptureEntryContext.Provider value={entry}>
    {children}
    {active ? <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent
      onRequestClose={() => { if (frame.current && !frame.current.busy) frame.current.close?.(); }}>
      <SafeAreaProvider>
        <CaptureFrameContext.Provider value={presentation}>
          {active.kind === 'route'
            ? <MinimumLeadForm key={active.id} entrySurface={active.entrySurface} prefill={active.prefill} onFollowUp={followUp} onClose={dismiss} openFullForm={openFullForm} />
            : active.kind === 'history'
              ? <OwnRoutes key={active.id + (auth.user?.id ?? 'guest')} onClose={dismiss} onFollowUp={followUp} onAddRoute={() => { frame.current = null; setActive({ kind: 'route', entrySurface: 'contribute_tab', id: Crypto.randomUUID() }); }} />
              : <ActualJourneyForm key={active.id} route={active.route} onClose={dismiss} />}
        </CaptureFrameContext.Provider>
      </SafeAreaProvider>
    </Modal> : null}
  </CaptureEntryContext.Provider>;
}
