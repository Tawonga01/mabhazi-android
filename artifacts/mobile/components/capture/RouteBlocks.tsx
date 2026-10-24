import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {listV2RouteBlocks,unblockV2RouteReporter,type V2RouteBlock} from '@workspace/api-client-react';
import {useAuth} from '@/lib/auth';
import {boundedRequest} from '@/lib/use-capture';
import {CaptureButton,CaptureFrame,captureStyles as s} from './CapturePrimitives';
export function RouteBlocks({onClose}:{onClose():void}){
 const auth=useAuth(),owner=auth.user?.id??null,actor=useRef(owner),mounted=useRef(true);actor.current=owner;
 const [blocks,setBlocks]=useState<V2RouteBlock[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const current=()=>mounted.current&&actor.current===owner;
 useEffect(()=>{mounted.current=true;let alive=true;setBlocks([]);setError('');if(owner){setBusy(true);void boundedRequest(signal=>listV2RouteBlocks({signal,headers:{'X-Mabhazi-Account':owner}})).then(result=>{if(alive&&current())setBlocks(result.blocks);}).catch(()=>{if(alive&&current())setError('Hidden route-report contributors could not load.');}).finally(()=>{if(alive&&current())setBusy(false);});}return()=>{alive=false;mounted.current=false;};},[owner,reload]);
 async function unblock(id:string){if(!owner||busy)return;setBusy(true);setError('');try{await boundedRequest(signal=>unblockV2RouteReporter(id,{signal,headers:{'X-Mabhazi-Account':owner}}));if(current())setBlocks(rows=>rows.filter(row=>row.id!==id));}catch{if(current())setError('The unblock could not be confirmed. Refresh and try again.');}finally{if(current())setBusy(false);}}
 return <CaptureFrame title="Hidden route reports" onClose={onClose} busy={busy} footer={<CaptureButton title="Done" onPress={onClose} disabled={busy}/>}>
  {busy?<ActivityIndicator accessibilityLabel="Loading hidden contributors"/>:null}{!owner?<CaptureButton title="Sign in to manage blocks" onPress={()=>void auth.login().catch(()=>setError('Sign-in did not finish.'))}/>:null}
  <Text style={s.note}>These contributors’ route reports are hidden for your account.</Text>
  {error?<><Text accessibilityRole="alert" style={s.error}>{error}</Text><CaptureButton title="Refresh hidden contributors" secondary disabled={busy} onPress={()=>setReload(v=>v+1)}/></>:null}
  {owner&&!busy&&!error&&!blocks.length?<Text style={s.label}>No route-report contributors hidden.</Text>:null}
  {blocks.map((block,i)=><View key={block.id} style={s.group}><Text style={s.label}>Contributor {i+1}</Text><Text style={s.note}>Hidden {String(block.blockedAt).slice(0,10)}</Text><CaptureButton title={'Unblock contributor '+(i+1)} secondary disabled={busy} onPress={()=>void unblock(block.id)}/></View>)}
 </CaptureFrame>;
}
