import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {useInfiniteQuery} from '@tanstack/react-query';
import {listV2PlaceReports,listV2OwnPlaceReports,placeV2Safety,type V2PlaceReport} from '@workspace/api-client-react';
import {useAuth} from '@/lib/auth';
import {useBlockedContributors} from '@/hooks/useBlockedContributors';
import {publicSafetyHeaders} from '@/lib/use-public-routes';
import {boundedRequest} from '@/lib/use-capture';
import {Feather} from '@/components/VectorIcon';
import {CaptureButton,Choices,captureStyles as s} from './CapturePrimitives';
import {fareDate} from './FareReports';

type Reason='inaccurate'|'spam'|'offensive'|'unsafe'|'other'|'';
const basis:Record<V2PlaceReport['basis'],string>={travelled:'Travelled',saw_operating:'Saw it operating',observed_sign:'Saw a sign',operator_statement:'Operator statement',heard_from_other:'Heard from someone',unprovided:'Not provided',legacy_import:'Imported report'};
export function PlaceReports({subjectId,ownSubmissionId,onBusy,onChanged,disabled=false}:{subjectId:string;ownSubmissionId?:string;onBusy(value:boolean):void;onChanged():void;disabled?:boolean}){
 const auth=useAuth(),owner=auth.user?.id??null,safety=useBlockedContributors(),own=!!ownSubmissionId;
 const identity=subjectId+'|'+(ownSubmissionId??'public')+'|'+owner+'|'+JSON.stringify([...safety.blockedContributorIds].sort());
 const live=useRef(identity);live.current=identity;const alive=useRef(true),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState<Reason>(''),[message,setMessage]=useState('');
 const current=()=>alive.current&&live.current===identity;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onBusy(false);};},[]);
 useEffect(()=>{setExpanded(null);setSelected(null);setReason('');setMessage('');},[identity]);
 const query=useInfiniteQuery({queryKey:['route-place-reports',identity],enabled:!auth.isLoading&&safety.isReady&&(!own||!!owner),initialPageParam:undefined as string|undefined,
  queryFn:({pageParam,signal})=>boundedRequest(inner=>ownSubmissionId?listV2OwnPlaceReports(ownSubmissionId,pageParam?{cursor:pageParam}:{},{signal:inner,headers:{'X-Mabhazi-Account':owner??''}}):listV2PlaceReports(subjectId,pageParam?{cursor:pageParam}:{},{signal:inner,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}),signal),
  getNextPageParam:last=>last.nextCursor,retry:false,staleTime:0,refetchOnMount:'always',refetchOnReconnect:false,refetchOnWindowFocus:false});
 async function action(id:string,action:'report'|'block'){
  if(!owner||own||busy||disabled||!safety.isReady)return;setBusy(true);onBusy(true);setMessage('');
  try{await boundedRequest(signal=>placeV2Safety(subjectId,id,{action,...(action==='report'&&reason?{reason}:{})},{signal,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}));
   if(!current())return;if(action==='block'){onChanged();return;}setSelected(null);setReason('');setMessage('Location report received.');
  }catch(error){if(current())setMessage((error as {data?:{error?:string}}).data?.error??'The safety action could not be confirmed. Try again.');}
  finally{if(current()){setBusy(false);onBusy(false);}}
 }
 const refreshing=query.isFetching&&!query.isFetchingNextPage,pages=query.isError||refreshing?undefined:query.data?.pages,items=pages?.flatMap(page=>page.items)??[],first=pages?.[0],locked=busy||disabled;
 return <View>
  {!own?<Text accessibilityRole="header" style={p.heading}>Pickup &amp; drop-off</Text>:null}
  {query.isPending||refreshing?<View style={p.state}><ActivityIndicator accessibilityLabel="Loading location reports" color="#62758B"/></View>:null}
  {query.isError?<View style={p.state}><Text accessibilityRole="alert" style={s.error}>Location reports could not load.</Text><CaptureButton title="Try location reports again" secondary disabled={locked||query.isFetching} onPress={()=>void query.refetch()}/></View>:null}
  {first&&!items.length&&!first.hasPendingReports&&!first.hasHiddenResults?<Text style={p.empty}>{own?'No saved locations available.':'No location reports available.'}</Text>:null}
  {items.map((place,index)=><View key={place.id} style={index?p.separated:undefined}>
   <Pressable accessibilityRole="button" accessibilityLabel={`Location details · ${place.kind==='pickup'?'Pickup':'Drop-off'} · ${place.name}`} accessibilityState={{expanded:expanded===place.id,disabled:locked}} aria-expanded={expanded===place.id} disabled={locked} onPress={()=>setExpanded(expanded===place.id?null:place.id)} style={p.row}>
    <View style={{flex:1,gap:6}}><Text style={p.endpoint}>{place.kind==='pickup'?'Pickup':'Drop-off'} · {place.city.name}</Text><Text style={p.name}>{place.name}</Text>
     {place.instructions?<Text style={p.note}>{place.instructions}</Text>:null}
     {place.status==='needs_review'?<Text style={p.review}>Needs review</Text>:null}
    </View><Feather name={expanded===place.id?'chevron-up':'chevron-down'} size={17} color="#7D8C9D"/>
   </Pressable>
   {expanded===place.id?<View style={p.details}>
    <Detail label={own?'Saved':'Report received'} value={fareDate(String(place.receivedAt))}/>
    <Detail label="Observed" value={fareDate(place.observedDate)}/><Detail label={own?"How you know":"How they know"} value={basis[place.basis]}/>
    {place.freshness==='recheck_due'?<Text style={p.review}>An update is needed.</Text>:null}
    {owner&&!own?<View style={p.actions}><CaptureButton title="Report this location" secondary disabled={locked} onPress={()=>{setSelected(selected===place.id?null:place.id);setReason('');setMessage('');}}/>
     {selected===place.id?<><Choices<Reason> label="Location report reason" value={reason} options={[[ 'inaccurate','Incorrect details' ],['spam','Spam'],['offensive','Offensive content'],['unsafe','Unsafe content'],['other','Other']]} onChange={setReason}/><CaptureButton title="Send location report" disabled={locked||!reason} onPress={()=>void action(place.id,'report')}/></>:null}
     {place.canBlock?<CaptureButton title="Hide this location contributor" secondary disabled={locked} onPress={()=>void action(place.id,'block')}/>:null}
    </View>:null}
   </View>:null}
  </View>)}
  {first?.hasPendingReports?<Text style={p.stateText}>Some locations are still being checked.</Text>:null}
  {first?.hasHiddenResults?<Text style={p.stateText}>Some locations are hidden by your settings.</Text>:null}
  {query.hasNextPage?<CaptureButton title="More location reports" secondary disabled={locked||query.isFetching} onPress={()=>void query.fetchNextPage()}/>:null}
  {message?<Text accessibilityRole="alert" style={p.stateText}>{message}</Text>:null}
 </View>;
}
function Detail({label,value}:{label:string;value:string}){return <View style={p.detailRow}><Text style={p.note}>{label}</Text><Text style={[p.note,{textAlign:'right',flexShrink:1}]}>{value}</Text></View>;}
const p=StyleSheet.create({heading:{fontSize:19,lineHeight:26,fontWeight:'600',letterSpacing:-0.3,color:'#172D46',marginBottom:8},
 row:{minHeight:88,paddingVertical:17,flexDirection:'row',alignItems:'center',gap:10},endpoint:{fontSize:14,lineHeight:21,color:'#617186'},name:{fontSize:20,lineHeight:27,fontWeight:'600',letterSpacing:-0.3,color:'#172D46'},note:{fontSize:14,lineHeight:21,color:'#617186'},
 separated:{borderTopWidth:1,borderTopColor:'#DFE5ED'},details:{paddingBottom:18,gap:12},detailRow:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:16},actions:{gap:2,paddingTop:4},review:{fontSize:14,lineHeight:21,color:'#A15425'},state:{paddingVertical:18,gap:8},stateText:{fontSize:14,lineHeight:21,color:'#617186',paddingVertical:16},empty:{fontSize:14,lineHeight:21,color:'#617186',paddingBottom:16}});
