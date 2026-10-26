import {PlaceReports} from './PlaceReports';
import {FareReports} from './FareReports';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Image,StyleSheet,Text,View} from 'react-native';
import {getV2Subject,routeV2Safety,type V2PublicLead} from '@workspace/api-client-react';
import {useAuth} from '@/lib/auth';
import {useBlockedContributors} from '@/hooks/useBlockedContributors';
import {publicSafetyHeaders} from '@/lib/use-public-routes';
import {boundedRequest} from '@/lib/use-capture';
import {usePlaceCaptureAvailable,usePlaceReportsAvailable} from '@/lib/use-place-capture';
import type {PublicRouteContext} from '@/lib/actual-journey-model';
import {CaptureButton,CaptureFrame,CaptureHelp,Choices,ReviewRow,captureStyles as s} from './CapturePrimitives';
export function PublicRouteDetail({subjectId,onClose,onContribute,onPlaces}:{subjectId:string;onClose():void;onContribute(route:PublicRouteContext,fare:boolean):void;onPlaces(route:PublicRouteContext):void}){
 const auth=useAuth(),owner=auth.user?.id??null,safety=useBlockedContributors(),placesEnabled=usePlaceCaptureAvailable(),placeReadEnabled=usePlaceReportsAvailable();
 const [route,setRoute]=useState<V2PublicLead|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[reportOpen,setReportOpen]=useState(false),[reason,setReason]=useState<'spam'|'inaccurate'|'offensive'|'unsafe'|'other'|''>(''),[message,setMessage]=useState('');
 const [placeBusy,setPlaceBusy]=useState(false),[fareBusy,setFareBusy]=useState(false),[loadedIdentity,setLoadedIdentity]=useState('');
 const mounted=useRef(true),actor=useRef(owner);actor.current=owner;
 const safetyKey=JSON.stringify([...safety.blockedContributorIds].sort());
 const identity=subjectId+'|'+owner+'|'+safetyKey,liveIdentity=useRef(identity);liveIdentity.current=identity;
 const current=()=>mounted.current&&actor.current===owner&&liveIdentity.current===identity;
 async function fresh(){return(await boundedRequest(signal=>getV2Subject(subjectId,{signal,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}))).subject;}
 useEffect(()=>{mounted.current=true;let alive=true;setRoute(null);setError('');
  if(!auth.isLoading&&safety.isReady){setBusy(true);void fresh().then(value=>{if(alive&&current()){setRoute(value);setLoadedIdentity(identity);}}).catch(()=>{if(alive&&current())setError('This route could not be loaded. Reopen Search or try again.');}).finally(()=>{if(alive&&current())setBusy(false);});}
  return()=>{alive=false;mounted.current=false;};
 },[subjectId,owner,auth.isLoading,safety.isReady,safetyKey,retry]);
 async function login(){setBusy(true);try{await auth.login();}catch{if(current())setMessage('Sign-in did not finish. Try again.');}finally{if(current())setBusy(false);}}
 async function contribute(fare:boolean,places=false){if(busy||!owner||!safety.isReady)return;setBusy(true);setMessage('');try{const value=await fresh();if(!current())return;
  if(!value.contributionTargetEligible){setMessage('Contributions for this route are not available yet.');return;}
  const context:PublicRouteContext={source:'public',ownerId:owner,subjectId:value.subjectId,expectedRevision:value.revision,origin:value.origin,destination:value.destination,operator:value.operatorReport.value,departureTime:value.reportedTime.value}; if(places)onPlaces(context);else onContribute(context,fare);
 }catch{if(current())setMessage('This route changed or is unavailable. Your other drafts are kept. Refresh Search.');}finally{if(current())setBusy(false);}}
 async function safetyAction(action:'report'|'block'){if(!owner||busy||!safety.isReady)return;setBusy(true);setMessage('');try{await boundedRequest(signal=>routeV2Safety(subjectId,{action,...(action==='report'&&reason?{reason}:{})},{signal,headers:{'X-Mabhazi-Account':owner}}));if(!current())return;if(action==='block')onClose();else{setReportOpen(false);setMessage('Report received.');}}
 catch(error){if(current())setMessage((error as {data?:{error?:string}}).data?.error??'The safety action could not be confirmed. Try again.');}finally{if(current())setBusy(false);}}
 const ready=!!route&&loadedIdentity===identity&&safety.isReady&&!auth.isLoading;
 return <CaptureFrame appearance="route" title="Route report" closeLabel="Close route report" onClose={onClose} busy={busy||fareBusy||placeBusy} footer={ready?<>{owner?<><CaptureButton title="Add fare" disabled={busy||fareBusy||placeBusy||!route?.contributionTargetEligible} onPress={()=>void contribute(true)}/><CaptureButton title="Report a journey" secondary onDark disabled={busy||fareBusy||placeBusy||!route?.contributionTargetEligible} onPress={()=>void contribute(false)}/></>:<CaptureButton title="Sign in to contribute" disabled={busy} onPress={()=>void login()}/>}</>:undefined}>
  {auth.isLoading||safety.isLoading||busy&&!route?<ActivityIndicator color="#FF9B45" accessibilityLabel="Loading route report"/>:null}
  {safety.error?<><Text accessibilityRole="alert" style={r.error}>Safety settings could not load.</Text><CaptureButton title="Try safety settings again" secondary onDark onPress={()=>void safety.retryBlockedContributors().catch(()=>undefined)}/></>:null}
  {error?<><Text accessibilityRole="alert" style={r.error}>{error}</Text><CaptureButton title="Try route again" secondary onDark disabled={busy} onPress={()=>setRetry(v=>v+1)}/></>:null}
  {ready&&route?<>
   <View style={r.context}>
    <Text style={r.route}>{route.origin.name} → {route.destination.name}</Text>
    <View style={r.service}><Image source={require('../../assets/images/departures-bus.png')} accessible={false} style={r.bus}/><View style={{flex:1,gap:5}}><Text style={r.operator}>{route.operatorReport.value}</Text><Text style={r.time}>{route.reportedTime.value}<Text> · </Text><Text>Days not confirmed</Text></Text></View></View>
   </View>
   <View style={r.reports}>
    {placeReadEnabled?<><PlaceReports key={'places'+identity} subjectId={route.subjectId} onBusy={setPlaceBusy} disabled={busy||fareBusy} onChanged={()=>setRetry(v=>v+1)}/><View style={[r.rule,{marginBottom:18}]}/></>:null}
    <FareReports key={identity} subjectId={route.subjectId} onBusy={setFareBusy} onChanged={()=>setRetry(v=>v+1)}/>
    {owner&&placesEnabled?<CaptureButton title="Add pickup / drop-off" secondary disabled={busy||fareBusy||placeBusy||!route.contributionTargetEligible} onPress={()=>void contribute(false,true)}/>:null}
    <View style={r.rule}/>
    <CaptureHelp label="About this route"><Text style={s.label}>Details needed</Text><Text style={s.note}>Community reports. A timetable and current fare have not been confirmed.</Text><ReviewRow label="Operator report received" value={String(route.operatorReport.submittedAt).slice(0,10)}/><ReviewRow label="Time report received" value={String(route.reportedTime.submittedAt).slice(0,10)}/></CaptureHelp>
    {owner?<CaptureHelp label="Report or hide"><CaptureButton title="Report this route" secondary disabled={busy} onPress={()=>setReportOpen(v=>!v)}/>{reportOpen?<><Choices<typeof reason> label="Report reason" value={reason} options={[[ 'inaccurate','Incorrect details' ],['spam','Spam'],['offensive','Offensive content'],['unsafe','Unsafe content'],['other','Other']]} onChange={setReason}/><CaptureButton title="Send route report" disabled={busy||!reason} onPress={()=>void safetyAction('report')}/></>:null}<CaptureButton title="Hide this contributor’s route reports" secondary disabled={busy} onPress={()=>void safetyAction('block')}/></CaptureHelp>:null}
   </View>
  </>:null}{message?<Text accessibilityRole="alert" style={r.message}>{message}</Text>:null}
 </CaptureFrame>;
}
const r=StyleSheet.create({
 context:{gap:22},route:{fontSize:28,lineHeight:35,fontWeight:'700',letterSpacing:-0.7,color:'#F4F6F9'},
 service:{flexDirection:'row',alignItems:'center',gap:13},bus:{width:27,height:30,tintColor:'#FF9B45'},operator:{fontSize:18,lineHeight:25,fontWeight:'600',color:'#F4F6F9'},time:{fontSize:14,lineHeight:21,color:'#B6C5D8'},
 reports:{borderRadius:24,backgroundColor:'#F4F6F9',padding:20,gap:2},rule:{height:1,backgroundColor:'#DFE5ED',marginTop:8},error:{fontSize:15,lineHeight:22,color:'#FFD1C2'},message:{fontSize:15,lineHeight:22,color:'#E0E9F3'}
});
