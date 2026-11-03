import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {useInfiniteQuery} from '@tanstack/react-query';
import {fareV2Safety,listV2FareReports,type V2PublicFareReport} from '@workspace/api-client-react';
import {useAuth} from '@/lib/auth';
import {useBlockedContributors} from '@/hooks/useBlockedContributors';
import {publicSafetyHeaders} from '@/lib/use-public-routes';
import {boundedRequest} from '@/lib/use-capture';
import {Feather} from '@/components/VectorIcon';
import {CaptureButton,Choices,captureStyles as s} from './CapturePrimitives';

// Date-only evidence must not move a day when the phone changes timezone.
export function fareDate(value:string|null|undefined){if(!value)return 'Date unknown';const [y,m,d]=value.slice(0,10).split('-').map(Number);return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${y}`;}
function caption(fare:V2PublicFareReport){const scope=fare.scope;return fare.kind==='paid'?`Paid · ${fareDate(scope.serviceDate)}`:fare.kind==='quoted'?`Quoted · ${fareDate(scope.quotationDate)}`:`Advertised · ${fareDate(scope.sourceDate)}`;}
const basisLabels:Record<V2PublicFareReport['basis'],string>={travelled:'Travelled',saw_operating:'Saw it operating',observed_sign:'Saw a sign',operator_statement:'Operator statement',heard_from_other:'Heard from someone',unprovided:'Not provided',legacy_import:'Imported report'};
function qualifier(fare:V2PublicFareReport){const scope=fare.scope;return [scope.passengerLabel??({adult:'Adult',child:'Child',concession:'Concession',other:'Other passenger',unknown:'Passenger unknown'}[scope.passengerCategory]),scope.ticketLabel??({one_way:'One way',return:'Return',other:'Other ticket',unknown:'Ticket unknown'}[scope.ticketBasis])].join(' · ');}
type Reason='inaccurate'|'spam'|'offensive'|'unsafe'|'other'|'';
export function FareReports({subjectId,onBusy,onChanged}:{subjectId:string;onBusy(value:boolean):void;onChanged():void}){
 const auth=useAuth(),owner=auth.user?.id??null,safety=useBlockedContributors();
 const identity=subjectId+'|'+owner+'|'+JSON.stringify([...safety.blockedContributorIds].sort()),live=useRef(identity);live.current=identity;
 const alive=useRef(true),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState<Reason>(''),[message,setMessage]=useState('');
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
 const empty=!!first&&!items.length&&!first.hasPendingReports&&!first.hasHiddenResults;
 return <View>
  <Text accessibilityRole="header" style={f.heading}>{empty?'Know the fare?':'Fare reports'}</Text>
  {query.isPending||refreshing?<View style={f.state}><ActivityIndicator accessibilityLabel="Loading fare reports" color="#62758B"/></View>:null}
  {query.isError?<View style={f.state}><Text accessibilityRole="alert" style={s.error}>Fare reports could not load.</Text><CaptureButton title="Try fare reports again" secondary disabled={busy||query.isFetching} onPress={()=>void query.refetch()}/></View>:null}
  {empty?<Text style={[f.note,{paddingBottom:16}]}>No fare reports yet.</Text>:null}
  {items.map((fare,index)=><View key={fare.id} style={index>0?f.separated:undefined}>
   <Pressable accessibilityRole="button" accessibilityLabel={`Fare details · ${fare.currency} ${fare.amount}`} accessibilityState={{expanded:expanded===fare.id,disabled:busy}} aria-expanded={expanded===fare.id} disabled={busy} onPress={()=>setExpanded(expanded===fare.id?null:fare.id)} style={f.row}>
    <View style={{flex:1,gap:6}}><View style={f.priceLine}><Text style={f.amount}>{fare.currency} {fare.amount}</Text><Text style={f.date}>{caption(fare)}</Text></View><Text style={f.note}>{qualifier(fare)}</Text>
     {fare.status==='needs_review'?<Text style={f.review}>Needs review</Text>:null}</View>
    <Feather name={expanded===fare.id?'chevron-up':'chevron-down'} size={17} color="#7D8C9D"/>
   </Pressable>
   {expanded===fare.id?<View style={f.details}>
    {fare.scope.paymentMethod?<Detail label="Payment" value={fare.scope.paymentMethod}/>:null}
    {typeof fare.scope.luggageIncluded==='boolean'?<Detail label="Luggage included" value={fare.scope.luggageIncluded?'Yes':'No'}/>:null}
    {fare.scope.effectiveFrom||fare.scope.effectiveTo?<Detail label="Reported validity" value={`${fareDate(fare.scope.effectiveFrom)} – ${fareDate(fare.scope.effectiveTo)}`}/>:null}
    <Detail label="How they know" value={basisLabels[fare.basis]}/>
    {fare.observedDate?<Detail label="Observed" value={fareDate(fare.observedDate)}/>:null}
    <Detail label="Received" value={fareDate(String(fare.receivedAt))}/>
    <Text style={f.note}>A dated report; the fare for your journey may differ.</Text>
    {fare.freshness==='recheck_due'?<Text style={f.review}>An update is needed.</Text>:null}
    {owner?<View style={f.actions}><CaptureButton title="Report this fare" secondary disabled={busy} onPress={()=>{setSelected(selected===fare.id?null:fare.id);setReason('');setMessage('');}}/>
     {selected===fare.id?<><Choices<Reason> label="Fare report reason" value={reason} options={[[ 'inaccurate','Incorrect details' ],['spam','Spam'],['offensive','Offensive content'],['unsafe','Unsafe content'],['other','Other']]} onChange={setReason}/><CaptureButton title="Send fare report" disabled={busy||!reason} onPress={()=>void action(fare.id,'report')}/></>:null}
     {fare.canBlock?<CaptureButton title="Hide this fare contributor" secondary disabled={busy} onPress={()=>void action(fare.id,'block')}/>:null}</View>:null}
   </View>:null}
  </View>)}
  {first?.hasPendingReports?<Text style={f.stateText}>Some reports are still being checked.</Text>:null}
  {first?.hasHiddenResults?<Text style={f.stateText}>Some reports are hidden by your settings.</Text>:null}
  {query.hasNextPage?<CaptureButton title="More fare reports" secondary disabled={busy||query.isFetching} onPress={()=>void query.fetchNextPage()}/>:null}
  {message?<Text accessibilityRole="alert" style={f.stateText}>{message}</Text>:null}
 </View>;
}
function Detail({label,value}:{label:string;value:string}){return <View style={f.detailRow}><Text style={f.detailLabel}>{label}</Text><Text style={f.detailValue}>{value}</Text></View>;}
const f=StyleSheet.create({
 heading:{fontSize:19,lineHeight:26,fontWeight:'600',letterSpacing:-0.3,color:'#172D46',marginBottom:8},
 row:{minHeight:88,paddingVertical:17,flexDirection:'row',alignItems:'center',gap:10},priceLine:{flexDirection:'row',alignItems:'baseline',justifyContent:'space-between',gap:10},amount:{fontSize:24,lineHeight:30,fontWeight:'600',letterSpacing:-0.7,color:'#172D46',flexShrink:1},date:{fontSize:13,lineHeight:19,color:'#617186',maxWidth:'52%',textAlign:'right'},note:{fontSize:14,lineHeight:21,color:'#617186'},
 separated:{borderTopWidth:1,borderTopColor:'#DFE5ED'},details:{paddingBottom:18,gap:12},detailRow:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:16},detailLabel:{fontSize:14,lineHeight:21,color:'#617186',flexShrink:1},detailValue:{fontSize:14,lineHeight:21,color:'#283D54',textAlign:'right',flexShrink:1},actions:{gap:2,paddingTop:4},review:{fontSize:14,lineHeight:21,color:'#A15425'},state:{paddingVertical:18,gap:8},stateText:{fontSize:14,lineHeight:21,color:'#617186',paddingVertical:16}
});
