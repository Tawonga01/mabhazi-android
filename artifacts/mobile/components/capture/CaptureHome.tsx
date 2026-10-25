import { Feather } from '@/components/VectorIcon';
import { ui } from '@/constants/ui';
import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { leadDrafts, actualDrafts } from '@/lib/lead-drafts';
import { useCaptureEntry } from '@/lib/capture-context';
import { CaptureFrame, CaptureButton, CaptureHelp, captureStyles as s } from './CapturePrimitives';
import { draftNotice } from './CaptureStatus';
export function CaptureHome({ openFullForm }: { openFullForm(): void }) {
  const entry = useCaptureEntry();
  const [drafts, setDrafts] = useState({ route: false, journey: false }), [error, setError] = useState('');
  const { user } = useAuth(), owner = user?.id ?? null;
  useEffect(() => {
    let alive = true;
    setDrafts({ route: false, journey: false }); setError('');
    void (async () => {
      try {
        const route = await leadDrafts.read(owner) ?? (owner ? await leadDrafts.read(null) : null);
        const journey = await actualDrafts.read(owner) ?? (owner ? await actualDrafts.read(null) : null);
        if (alive) setDrafts({ route: !!route, journey: !!journey });
      } catch { if (alive) setError('Saved drafts could not be checked. Open a form to try again.'); }
    })();
    return () => { alive = false; };
  }, [entry.revision, owner]);
  const routeTitle = drafts.route ? 'Continue route draft' : 'Add a route';
  const journeyTitle = drafts.journey ? 'Continue journey draft' : 'Report a journey';
  return <CaptureFrame title="Contribute" appearance="entry">
    <View style={{gap:10,paddingBottom:8}}><Text accessibilityRole="header" style={{color:'#F3F6FA',fontFamily:ui.type.bold,fontSize:30,lineHeight:38}}>Share what you know.</Text></View>
    <View style={{backgroundColor:ui.color.surface,borderRadius:20,overflow:'hidden'}}>
      <Pressable accessibilityRole="button" accessibilityLabel={routeTitle} disabled={entry.isOpen} onPress={() => entry.open({kind:'route',entrySurface:'contribute_tab'})} style={{padding:20,minHeight:100,flexDirection:'row',alignItems:'center',gap:16}}>
        <View style={{width:48,height:48,borderRadius:16,backgroundColor:'#FFF0E0',alignItems:'center',justifyContent:'center'}}><Image source={require('../../assets/images/departures-bus.png')} style={{width:29,height:29,tintColor:'#A65A22'}} resizeMode="contain" accessible={false}/></View>
        <View style={{flex:1,gap:6}}><Text style={{fontFamily:ui.type.semibold,fontSize:19,color:ui.color.ink}}>{routeTitle}</Text><Text style={s.note}>{drafts.route?'Saved on this device':'Four essentials. No price needed.'}</Text></View><Feather name="chevron-right" size={20} color={ui.color.muted}/>
      </Pressable>
      <View style={{height:1,backgroundColor:ui.color.border,marginHorizontal:20}}/>
      <Pressable accessibilityRole="button" accessibilityLabel={journeyTitle} disabled={entry.isOpen} onPress={() => entry.open({kind:'journey',entrySurface:'contribute_tab'})} style={{padding:20,minHeight:100,flexDirection:'row',alignItems:'center',gap:16}}>
        <View style={{width:48,height:48,borderRadius:16,backgroundColor:ui.color.soft,alignItems:'center',justifyContent:'center'}}><Feather name="arrow-right" size={24} color={ui.color.navy}/></View>
        <View style={{flex:1,gap:6}}><Text style={{fontFamily:ui.type.semibold,fontSize:19,color:ui.color.ink}}>{journeyTitle}</Text><Text style={s.note}>{drafts.journey?'Saved on this device':'One detail is enough'}</Text></View><Feather name="chevron-right" size={20} color={ui.color.muted}/>
      </Pressable>
    </View>
    <CaptureButton title="My routes" secondary onDark disabled={entry.isOpen} onPress={() => entry.open({kind:'history'})}/>
    <CaptureButton title="Full route form" secondary onDark onPress={openFullForm}/>
    <View style={{backgroundColor:ui.color.surface,borderRadius:16,paddingHorizontal:16}}><CaptureHelp label="About drafts"><Text style={[s.note,{paddingBottom:16}]}>{draftNotice}</Text></CaptureHelp></View>
    {error?<Text accessibilityRole="alert" style={{...s.error,color:'#FFC6C6'}}>{error}</Text>:null}
  </CaptureFrame>;
}
