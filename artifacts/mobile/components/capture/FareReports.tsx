import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {useInfiniteQuery} from '@tanstack/react-query';
import {fareV2Safety,listV2FareReports,type V2PublicFareReport} from '@workspace/api-client-react';
import {useAuth} from '@/lib/auth';
import {useBlockedContributors} from '@/hooks/useBlockedContributors';
import {publicSafetyHeaders} from '@/lib/use-public-routes';
import {boundedRequest} from '@/lib/use-capture';
import {CaptureButton,CaptureHelp,Choices,ReviewRow,captureStyles as s} from './CapturePrimitives';

// Date-only evidence must not move a day when the phone changes timezone.
export function fareDate(value:string|null|undefined){if(!value)return 'Date unknown';const [y,m,d]=value.slice(0,10).split('-').map(Number);return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${y}`;}
function caption(fare:V2PublicFareReport){const scope=fare.scope;return fare.kind==='paid'?`Paid · ${fareDate(scope.serviceDate)}`:fare.kind==='quoted'?`Quoted · ${fareDate(scope.quotationDate)}`:`Advertised · ${fareDate(scope.sourceDate)}`;}
const basisLabels:Record<V2PublicFareReport['basis'],string>={travelled:'Travelled',saw_operating:'Saw it operating',observed_sign:'Saw a sign',operator_statement:'Operator statement',heard_from_other:'Heard from someone',unprovided:'Not provided',legacy_import:'Imported report'};
function qualifier(fare:V2PublicFareReport){const scope=fare.scope;return [scope.passengerLabel??({adult:'Adult',child:'Child',concession:'Concession',other:'Other passenger',unknown:'Passenger unknown'}[scope.passengerCategory]),scope.ticketLabel??({one_way:'One way',return:'Return',other:'Other ticket',unknown:'Ticket unknown'}[scope.ticketBasis])].join(' · ');}
type Reason='inaccurate'|'spam'|'offensive'|'unsafe'|'other'|'';
export function FareReports({subjectId,onBusy,onChanged}:{subjectId:string;onBusy(value:boolean):void;onChanged():void}){
 const auth=useAuth(),owner=auth.user?.id??null,safety=useBlockedContributors();
 const identity=subjectId+'|'+owner+'|'+JSON.stringify([...safety.blockedContributorIds].sort()),live=useRef(identity);live.current=identity;
 const alive=useRef(true),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState<Reason>(''),[message,setMessage]=useState('');
 const current=()=>alive.current&&identity===live.current;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onBusy(false);};},[]);
 const query=useInfiniteQuery({queryKey:['public-fare-reports',identity],enabled:!auth.isLoading&&safety.isReady,initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>boundedRequest(inner=>listV2FareReports(subjectId,pageParam?{cursor:pageParam}:{},{signal:inner,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}),signal),
  getNextPageParam:last=>last.nextCursor,retry:false,staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:false,refetchOnReconnect:false});
 async function action(id:string,action:'report'|'block'){
  if(!owner||busy||!safety.isReady)return;setBusy(true);onBusy(true);setMessage('');
  try{await boundedRequest(signal=>fareV2Safety(subjectId,id,{action,...(action==='report'&&reason?{reason}:{})},{signal,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}));
   if(!current())return;if(action==='block'){onChanged();return;}setSelected(null);setReason('');setMessage('Fare report received.');
  }catch(error){if(current())setMessage((error as {data?:{error?:string}}).data?.error??'The safety action could not be confirmed. Try again.');}
  finally{if(current()){setBusy(false);onBusy(false);}}
 }
 const refreshing=query.isFetching&&!query.isFetchingNextPage, pages=query.isError||refreshing?undefined:query.data?.pages,items=pages?.flatMap(page=>page.items)??[],first=pages?.[0];
 return <View style={{gap:12}}><Text accessibilityRole="header" style={s.reviewValue}>Fare reports</Text>
  {query.isPending||refreshing?<ActivityIndicator accessibilityLabel="Loading fare reports"/>:null}
  {query.isError?<><Text accessibilityRole="alert" style={s.error}>Fare reports could not load.</Text><CaptureButton title="Try fare reports again" secondary disabled={busy||query.isFetching} onPress={()=>void query.refetch()}/></>:null}
  {first&&!items.length&&!first.hasPendingReports&&!first.hasHiddenResults?<Text style={s.note}>No fare reports yet.</Text>:null}
  {items.map(fare=><View key={fare.id} style={s.group}>
   <Text style={s.title}>{fare.currency} {fare.amount}</Text><Text style={s.reviewValue}>{caption(fare)}</Text>
   <Text style={s.reviewValue}>{qualifier(fare)}</Text><Text style={s.label}>{fare.status==='needs_review'?'Reported · Needs review':'Reported'}</Text>
   <CaptureHelp label={`Fare details · ${fare.currency} ${fare.amount}`}>
    <ReviewRow label="Passenger" value={fare.scope.passengerLabel??fare.scope.passengerCategory??'Unknown'}/><ReviewRow label="Ticket" value={fare.scope.ticketLabel??({'one_way':'One way','return':'Return','other':'Other','unknown':'Unknown'}[fare.scope.ticketBasis??'unknown'])}/>
    {fare.scope.paymentMethod?<ReviewRow label="Payment" value={fare.scope.paymentMethod}/>:null}
    {typeof fare.scope.luggageIncluded==='boolean'?<ReviewRow label="Luggage included" value={fare.scope.luggageIncluded?'Yes':'No'}/>:null}
    {fare.scope.effectiveFrom||fare.scope.effectiveTo?<ReviewRow label="Reported validity" value={`${fareDate(fare.scope.effectiveFrom)} – ${fareDate(fare.scope.effectiveTo)}`}/>:null}
    <ReviewRow label="How they know" value={basisLabels[fare.basis]}/><ReviewRow label="Observed" value={fareDate(fare.observedDate)}/><ReviewRow label="Received" value={fareDate(String(fare.receivedAt))}/>
    <Text style={s.note}>A dated report; the fare for your journey may differ.</Text>
    {fare.freshness==='recheck_due'?<Text style={s.note}>An update is needed.</Text>:null}
    {owner?<><CaptureButton title="Report this fare" secondary disabled={busy} onPress={()=>{setSelected(selected===fare.id?null:fare.id);setReason('');setMessage('');}}/>
     {selected===fare.id?<><Choices<Reason> label="Fare report reason" value={reason} options={[[ 'inaccurate','Incorrect details' ],['spam','Spam'],['offensive','Offensive content'],['unsafe','Unsafe content'],['other','Other']]} onChange={setReason}/><CaptureButton title="Send fare report" disabled={busy||!reason} onPress={()=>void action(fare.id,'report')}/></>:null}
     {fare.canBlock?<CaptureButton title="Hide this fare contributor" secondary disabled={busy} onPress={()=>void action(fare.id,'block')}/>:null}</>:null}
   </CaptureHelp>
  </View>)}
  {first?.hasPendingReports?<Text style={s.note}>Some reports are still being checked.</Text>:null}
  {first?.hasHiddenResults?<Text style={s.note}>Some reports are hidden by your settings.</Text>:null}
  {query.hasNextPage?<CaptureButton title="More fare reports" secondary disabled={busy||query.isFetching} onPress={()=>void query.fetchNextPage()}/>:null}
  {message?<Text accessibilityRole="alert" style={s.note}>{message}</Text>:null}
 </View>;
}
