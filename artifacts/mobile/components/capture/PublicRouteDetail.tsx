import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text} from 'react-native';
import {getV2Subject,routeV2Safety,type V2PublicLead} from '@workspace/api-client-react';
import {useAuth} from '@/lib/auth';
import {useBlockedContributors} from '@/hooks/useBlockedContributors';
import {publicSafetyHeaders} from '@/lib/use-public-routes';
import {boundedRequest} from '@/lib/use-capture';
import type {PublicRouteContext} from '@/lib/actual-journey-model';
import {CaptureButton,CaptureFrame,CaptureHelp,Choices,ReviewRow,captureStyles as s} from './CapturePrimitives';
export function PublicRouteDetail({subjectId,onClose,onContribute}:{subjectId:string;onClose():void;onContribute(route:PublicRouteContext,fare:boolean):void}){
 const auth=useAuth(),owner=auth.user?.id??null,safety=useBlockedContributors();
 const [route,setRoute]=useState<V2PublicLead|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[reportOpen,setReportOpen]=useState(false),[reason,setReason]=useState<'spam'|'inaccurate'|'offensive'|'unsafe'|'other'|''>(''),[message,setMessage]=useState('');
 const mounted=useRef(true),actor=useRef(owner);actor.current=owner;
 const safetyKey=JSON.stringify([...safety.blockedContributorIds].sort());
 const identity=subjectId+'|'+owner+'|'+safetyKey,liveIdentity=useRef(identity);liveIdentity.current=identity;
 const current=()=>mounted.current&&actor.current===owner&&liveIdentity.current===identity;
 async function fresh(){return(await boundedRequest(signal=>getV2Subject(subjectId,{signal,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}))).subject;}
 useEffect(()=>{mounted.current=true;let alive=true;setRoute(null);setError('');
  if(!auth.isLoading&&safety.isReady){setBusy(true);void fresh().then(value=>{if(alive&&current())setRoute(value);}).catch(()=>{if(alive&&current())setError('This route could not be loaded. Reopen Search or try again.');}).finally(()=>{if(alive&&current())setBusy(false);});}
  return()=>{alive=false;mounted.current=false;};
 },[subjectId,owner,auth.isLoading,safety.isReady,safetyKey,retry]);
 async function login(){setBusy(true);try{await auth.login();}catch{if(current())setMessage('Sign-in did not finish. Try again.');}finally{if(current())setBusy(false);}}
 async function contribute(fare:boolean){if(busy||!owner||!safety.isReady)return;setBusy(true);setMessage('');try{const value=await fresh();if(!current())return;
  if(!value.contributionTargetEligible){setMessage('Contributions for this route are not available yet.');return;}
  onContribute({source:'public',ownerId:owner,subjectId:value.subjectId,expectedRevision:value.revision,origin:value.origin,destination:value.destination,operator:value.operatorReport.value,departureTime:value.reportedTime.value},fare);
 }catch{if(current())setMessage('This route changed or is unavailable. Your other drafts are kept. Refresh Search.');}finally{if(current())setBusy(false);}}
 async function safetyAction(action:'report'|'block'){if(!owner||busy||!safety.isReady)return;setBusy(true);setMessage('');try{await boundedRequest(signal=>routeV2Safety(subjectId,{action,...(action==='report'&&reason?{reason}:{})},{signal,headers:{'X-Mabhazi-Account':owner}}));if(!current())return;if(action==='block')onClose();else{setReportOpen(false);setMessage('Report received.');}}
 catch(error){if(current())setMessage((error as {data?:{error?:string}}).data?.error??'The safety action could not be confirmed. Try again.');}finally{if(current())setBusy(false);}}
 const ready=!!route&&safety.isReady&&!auth.isLoading;
 return <CaptureFrame title="Route report" closeLabel="Close route report" onClose={onClose} busy={busy} footer={ready?<>{owner?<><CaptureButton title="Add fare" disabled={busy||!route?.contributionTargetEligible} onPress={()=>void contribute(true)}/><CaptureButton title="Report a journey" secondary disabled={busy||!route?.contributionTargetEligible} onPress={()=>void contribute(false)}/></>:<CaptureButton title="Sign in to contribute" disabled={busy} onPress={()=>void login()}/>}</>:undefined}>
  {auth.isLoading||safety.isLoading||busy&&!route?<ActivityIndicator accessibilityLabel="Loading route report"/>:null}
  {safety.error?<><Text accessibilityRole="alert" style={s.error}>Safety settings could not load.</Text><CaptureButton title="Try safety settings again" onPress={()=>void safety.retryBlockedContributors().catch(()=>undefined)}/></>:null}
  {error?<><Text accessibilityRole="alert" style={s.error}>{error}</Text><CaptureButton title="Try route again" secondary disabled={busy} onPress={()=>setRetry(v=>v+1)}/></>:null}
  {ready&&route?<><Text style={s.title}>{route.origin.name} → {route.destination.name}</Text><Text style={s.reviewValue}>{route.operatorReport.value}</Text><Text style={s.label}>Details needed</Text><ReviewRow label="Reported time" value={route.reportedTime.value}/><Text style={s.note}>Days not confirmed</Text>
   <CaptureHelp label="About this report"><Text style={s.note}>This is a reported route. A timetable and fare have not been selected.</Text><ReviewRow label="Operator report received" value={String(route.operatorReport.submittedAt).slice(0,10)}/><ReviewRow label="Time report received" value={String(route.reportedTime.submittedAt).slice(0,10)}/><Text style={s.note}>Observation dates: {route.operatorReport.observedDate??'Unknown'} · {route.reportedTime.observedDate??'Unknown'}</Text></CaptureHelp>
   {owner?<CaptureHelp label="Report or hide"><CaptureButton title="Report this route" secondary disabled={busy} onPress={()=>setReportOpen(v=>!v)}/>{reportOpen?<><Choices label="Report reason" value={reason} options={[[ 'inaccurate','Incorrect details' ],['spam','Spam'],['offensive','Offensive content'],['unsafe','Unsafe content'],['other','Other']]} onChange={setReason}/><CaptureButton title="Send route report" disabled={busy||!reason} onPress={()=>void safetyAction('report')}/></>:null}<CaptureButton title="Hide this contributor’s route reports" secondary disabled={busy} onPress={()=>void safetyAction('block')}/></CaptureHelp>:null}
  </>:null}{message?<Text accessibilityRole="alert" style={s.note}>{message}</Text>:null}
 </CaptureFrame>;
}
