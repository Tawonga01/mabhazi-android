import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Modal,Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {useQueryClient} from '@tanstack/react-query';
import {getV2PromptPreferences,setV2PromptPreferences,type V2PromptQuestionType} from '@workspace/api-client-react';
import {ui} from '@/constants/ui';
import {Feather} from '@/components/VectorIcon';
import {CaptureButton,CaptureFrame} from '@/components/capture/CapturePrimitives';
import {CaptureFrameContext,useCaptureEntry} from '@/lib/capture-context';
import {useAuth} from '@/lib/auth';
import {boundedRequest} from '@/lib/use-capture';
import {PromptSettingsSession,questionGroups,type PromptSettingsState} from '@/lib/prompt-controls-model';
import {usePromptActivity,usePromptControlsAvailable} from './PromptActivity';

const presentation={overlay:true,register:()=>()=>{}};
function ToggleRow({label,checked,disabled=false,onChange,master=false,last=false}:{label:string;checked:boolean;disabled?:boolean;onChange():void;master?:boolean;last?:boolean}){
 return <Pressable accessibilityRole="switch" accessibilityLabel={label} aria-checked={checked} accessibilityState={{checked,disabled}} disabled={disabled} onPress={onChange} style={[s.row,!last&&s.divider,disabled&&s.disabled]}>
  <Text style={[s.rowText,master&&s.masterText]}>{label}</Text>
  <View pointerEvents="none" style={[s.track,checked&&s.trackOn]}><View style={[s.thumb,checked&&s.thumbOn]}/></View>
 </Pressable>;
}
function PromptSettings({owner,visible,onClose}:{owner:string;visible:boolean;onClose():void}){
 const auth=useAuth(),actor=useRef<string|null>(owner);actor.current=auth.user?.id??null;
 const client=useQueryClient(),activity=usePromptActivity(),session=useRef<PromptSettingsSession|null>(null);
 const [state,setState]=useState<PromptSettingsState>({phase:'loading'});
 useEffect(()=>{
  let alive=true;
  const current=()=>alive&&actor.current===owner,headers={'X-Mabhazi-Account':owner};
  const controller=new PromptSettingsSession({
   read:signal=>client.fetchQuery({queryKey:['prompt-preferences',owner],staleTime:0,retry:false,
    queryFn:()=>boundedRequest(s=>getV2PromptPreferences({signal:s,headers}),signal)}),
   save:(body,signal)=>boundedRequest(s=>setV2PromptPreferences(body,{signal:s,headers}),signal),
  },current,next=>{if(current())setState(next);});
  session.current=controller;
  return ()=>{alive=false;controller.dispose();void client.cancelQueries({queryKey:['prompt-preferences',owner]});};
 },[owner,client]);
 useEffect(()=>{if(visible)void session.current?.open();},[visible,owner]);
 const busy=['saving','checking'].includes(state.phase),editable=['editing','saved'].includes(state.phase)&&!state.pending;
 const close=()=>{if(!busy)onClose();};
 const toggleType=(key:V2PromptQuestionType)=>{if(!state.choice)return;const disabled=new Set(state.choice.disabledTypes);disabled.has(key)?disabled.delete(key):disabled.add(key);session.current?.edit({...state.choice,disabledTypes:[...disabled]});};
 function footer(){
  if(state.phase==='loading')return null;
  if(state.phase==='auth')return <CaptureButton title="Sign in again" onPress={()=>{void auth.login().then(()=>session.current?.open()).catch(()=>{});}}/>;
  if(state.phase==='error')return <CaptureButton title="Try again" onPress={()=>{void session.current?.load();}}/>;
  if(state.phase==='conflict')return <CaptureButton title="Reload saved settings" onPress={()=>{void session.current?.load();}}/>;
  if(['unconfirmed','checking'].includes(state.phase))return <CaptureButton title="Check saved settings" busy={busy} onPress={()=>{void session.current?.check();}}/>;
  if(state.phase==='retry')return <CaptureButton title="Try saving again" onPress={()=>{void session.current?.save();}}/>;
  return <CaptureButton title={session.current?.dirty?'Save settings':'Done'} busy={busy} onPress={()=>{if(session.current?.dirty)void session.current.save();else close();}}/>;
 }
 return <Modal visible={visible&&actor.current===owner} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
  <SafeAreaProvider><View style={{flex:1}} onTouchStart={activity}><CaptureFrameContext.Provider value={presentation}>
   <CaptureFrame title="Contribution questions" closeLabel="Close question settings" onClose={close} busy={busy} footer={footer()}>
    {state.phase==='loading'?<ActivityIndicator accessibilityLabel="Loading question settings" color={ui.color.navy}/>:null}
    {state.message?<Text accessibilityRole={state.phase==='saved'?'text':'alert'} accessibilityLiveRegion="polite" style={[s.message,state.phase==='saved'?s.success:s.error]}>{state.message}</Text>:null}
    {state.choice&&!['loading','error','auth'].includes(state.phase)?<>
     <View style={s.group}><ToggleRow label="Optional questions" master last checked={state.choice.invitationsEnabled} disabled={!editable} onChange={()=>session.current?.edit({...state.choice!,invitationsEnabled:!state.choice!.invitationsEnabled})}/></View>
     <Text style={s.note}>Manual contributions are always available.</Text>
     {questionGroups.map(group=><View key={group.title} style={s.section}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{group.title}</Text>
      <View style={s.group}>{group.items.map(([key,label],index)=><ToggleRow key={key} label={label} checked={!state.choice!.disabledTypes.includes(key)} disabled={!editable||!state.choice!.invitationsEnabled} last={index===group.items.length-1} onChange={()=>toggleType(key)}/>)}</View>
     </View>)}
    </>:null}
   </CaptureFrame>
  </CaptureFrameContext.Provider></View></SafeAreaProvider>
 </Modal>;
}
export function PromptSettingsEntry(){
 const auth=useAuth(),owner=auth.user?.id??null,available=usePromptControlsAvailable(owner),capture=useCaptureEntry();
 const [visible,setVisible]=useState(false);
 if(!owner||!auth.isAuthenticated||!available)return null;
 return <>
  <Pressable accessibilityRole="button" accessibilityLabel="Contribution questions" disabled={capture.isOpen} onPress={()=>setVisible(true)} style={s.entry}>
   <Text style={s.entryText}>Contribution questions</Text><Feather name="chevron-right" size={20} color={ui.color.muted}/>
  </Pressable>
  <PromptSettings key={owner} owner={owner} visible={visible} onClose={()=>setVisible(false)}/>
 </>;
}
const s=StyleSheet.create({
 entry:{minHeight:64,flexDirection:'row',alignItems:'center',gap:12,padding:18,backgroundColor:ui.color.paper,borderRadius:ui.radius.group,borderWidth:1,borderColor:ui.color.border},
 entryText:{flex:1,fontFamily:ui.type.semibold,fontSize:17,color:ui.color.ink},
 group:{backgroundColor:ui.color.paper,borderWidth:1,borderColor:ui.color.border,borderRadius:ui.radius.group,overflow:'hidden'},
 row:{minHeight:60,flexDirection:'row',alignItems:'center',gap:16,paddingHorizontal:16,paddingVertical:14},
 divider:{borderBottomWidth:1,borderBottomColor:ui.color.soft},
 rowText:{flex:1,fontFamily:ui.type.regular,fontSize:16,lineHeight:23,color:ui.color.ink},masterText:{fontFamily:ui.type.semibold,fontSize:18,lineHeight:25},
 track:{width:48,height:28,borderRadius:14,backgroundColor:'#CFD7E2',padding:3},trackOn:{backgroundColor:ui.color.navy},
 thumb:{width:22,height:22,borderRadius:11,backgroundColor:ui.color.paper},thumbOn:{transform:[{translateX:20}]},
 disabled:{opacity:0.45},section:{gap:10},sectionTitle:{fontFamily:ui.type.semibold,fontSize:17,color:ui.color.ink},
 note:{fontFamily:ui.type.regular,fontSize:16,lineHeight:23,color:ui.color.muted},message:{fontFamily:ui.type.medium,fontSize:16,lineHeight:24},error:{color:ui.color.danger},success:{color:ui.color.ink},
});
