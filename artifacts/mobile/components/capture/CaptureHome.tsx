import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { leadDrafts, actualDrafts } from '@/lib/lead-drafts';
import { MinimumLeadForm } from '@/components/MinimumLeadForm';
import { ActualJourneyForm } from './ActualJourneyForm';
import { CaptureFrame, CaptureButton, captureStyles as s } from './CapturePrimitives';
import { draftNotice } from './CaptureStatus';
export function CaptureHome({ openFullForm }: { openFullForm(): void }) {
  const [screen, setScreen] = useState<'home' | 'route' | 'journey'>('home'), [drafts, setDrafts] = useState({ route: false, journey: false }), [error, setError] = useState('');
  const { user } = useAuth(), owner = user?.id ?? null;
  useEffect(() => {
    let alive = true;
    setDrafts({ route: false, journey: false }); setError('');
    if (screen === 'home') void (async () => {
      try {
        const route = await leadDrafts.read(owner) ?? (owner ? await leadDrafts.read(null) : null);
        const journey = await actualDrafts.read(owner) ?? (owner ? await actualDrafts.read(null) : null);
        if (alive) setDrafts({ route: !!route, journey: !!journey });
      } catch { if (alive) setError('Saved drafts could not be checked. Open a form to try again.'); }
    })();
    return () => { alive = false; };
  }, [screen, owner]);
  if (screen === 'route') return <MinimumLeadForm openFullForm={openFullForm} onClose={() => setScreen('home')} />;
  if (screen === 'journey') return <ActualJourneyForm onClose={() => setScreen('home')} />;
  return <CaptureFrame title="Contribute">
    <Text style={s.note}>Help someone make their next journey.</Text>
    <View style={s.group}><Text style={s.title}>Know a bus route?</Text><Text style={s.note}>Departure city, departure time, destination and operator. No price needed.</Text><CaptureButton title={drafts.route ? 'Continue route draft' : 'Add a route'} onPress={() => setScreen('route')} /></View>
    <View style={s.group}><Text style={s.title}>Something to share?</Text><Text style={s.note}>Report an actual time, fare, operator or place. One useful fact is enough.</Text><CaptureButton title={drafts.journey ? 'Continue journey draft' : 'Report a journey'} onPress={() => setScreen('journey')} /></View>
    <CaptureButton title="Open existing full route form" secondary onPress={openFullForm} />
    <Text style={s.note}>{draftNotice}</Text>{error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </CaptureFrame>;
}
