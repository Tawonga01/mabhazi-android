import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { CaptureEntryContext, CaptureFrameContext } from '@/lib/capture-context';
import type { CaptureRequest } from '@/lib/contribution-moments';
import { MinimumLeadForm } from '@/components/MinimumLeadForm';
import { ActualJourneyForm } from './ActualJourneyForm';

/** One manual capture at a time; tabs cannot run competing writers for the same draft. */
export function CaptureHost({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
            ? <MinimumLeadForm key={active.id} entrySurface={active.entrySurface} prefill={active.prefill} onClose={dismiss} openFullForm={openFullForm} />
            : <ActualJourneyForm key={active.id} onClose={dismiss} />}
        </CaptureFrameContext.Provider>
      </SafeAreaProvider>
    </Modal> : null}
  </CaptureEntryContext.Provider>;
}
