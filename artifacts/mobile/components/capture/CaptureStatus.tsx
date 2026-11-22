import React from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { TermsAcceptanceCard } from '@/components/TermsAcceptance';
import type { useCapture } from '@/lib/use-capture';
import { CaptureButton, CaptureHelp, captureStyles as s } from './CapturePrimitives';
export const draftNotice = Platform.OS === 'web' ? 'Drafts stay in this browser session only. Refreshing or closing the page loses unsent answers.' : 'Drafts are saved securely on this phone for up to 30 days. Sign-out removes them.';
type Status = Pick<ReturnType<typeof useCapture>, 'owner' | 'terms' | 'pending' | 'capabilityBusy' | 'enabled' | 'checkCapability' | 'message' | 'storageError'>;
export function CaptureStatus({ capture: c }: { capture: Status }) {
  return <>
    {c.owner ? !c.terms.isAccepted ? <TermsAcceptanceCard terms={c.terms} /> : null : Platform.OS === 'web' ? <Text style={s.note}>Allow the Google sign-in popup to keep your draft.</Text> : null}
    {c.pending ? <CaptureHelp label="Save details"><Text style={s.note}>Your answers are kept while we check the previous save.</Text><Text selectable style={s.note}>Reference: {c.pending.request.clientSubmissionId}</Text></CaptureHelp> : null}
    {c.capabilityBusy ? <ActivityIndicator accessibilityLabel="Checking contribution availability" /> : !c.enabled ? <><Text style={s.note}>Saving is unavailable. Your answers are kept.</Text><CaptureButton title="Try again" secondary onPress={c.checkCapability} /></> : null}
  </>;
}
export function CaptureMessages({ message, storageError }: { message: string; storageError: string }) { return <>{message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{message}</Text> : null}{storageError ? <Text accessibilityRole="alert" style={s.error}>{storageError}</Text> : null}</>; }
export function SavedMessage({ reference }: { reference: string }) { return <View style={s.group}><Text style={s.reviewValue}>Thanks for contributing.</Text><CaptureHelp label="View receipt"><Text style={s.note}>Received and awaiting processing.</Text><Text selectable style={s.note}>Reference: {reference}</Text></CaptureHelp></View>; }
