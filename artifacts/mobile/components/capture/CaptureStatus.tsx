import React from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { TermsAcceptanceCard } from '@/components/TermsAcceptance';
import type { useCapture } from '@/lib/use-capture';
import { CaptureButton, captureStyles as s } from './CapturePrimitives';
export const draftNotice = Platform.OS === 'web' ? 'Drafts stay in this browser session only. Refreshing or closing the page loses unsent answers.' : 'Drafts are saved securely on this phone for up to 30 days. Sign-out removes them.';
type Status = Pick<ReturnType<typeof useCapture>, 'owner' | 'terms' | 'pending' | 'capabilityBusy' | 'enabled' | 'checkCapability' | 'message' | 'storageError'>;
export function CaptureStatus({ capture: c }: { capture: Status }) {
  return <>
    {c.owner ? c.terms.isAccepted ? <Text style={s.note}>Current Terms accepted.</Text> : <TermsAcceptanceCard terms={c.terms} /> : <Text style={s.note}>Sign in with Google to save. Nothing submits automatically. On the web, allow the sign-in popup to keep your draft.</Text>}
    {c.pending ? <Text selectable style={s.note}>These answers are locked while a previous save is checked. Reference: {c.pending.request.clientSubmissionId}</Text> : null}
    {c.capabilityBusy ? <ActivityIndicator accessibilityLabel="Checking contribution availability" /> : !c.enabled ? <><Text style={s.note}>This form is not available on the server yet. Your answers are kept.</Text><CaptureButton title="Check availability again" secondary onPress={c.checkCapability} /></> : null}
  </>;
}
export function CaptureMessages({ message, storageError }: { message: string; storageError: string }) { return <>{message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{message}</Text> : null}{storageError ? <Text accessibilityRole="alert" style={s.error}>{storageError}</Text> : null}</>; }
export function SavedMessage({ reference }: { reference: string }) { return <View style={s.group}><Text style={s.note}>Your answers reached Mabhazi and are awaiting processing. This does not confirm a timetable or publish a route.</Text><Text selectable style={s.note}>Reference: {reference}</Text></View>; }
