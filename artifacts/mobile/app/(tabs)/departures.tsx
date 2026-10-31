import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getV2DepartureBoard, type V2DepartureEntry } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { useBlockedContributors } from '@/hooks/useBlockedContributors';
import { useCaptureEntry } from '@/lib/capture-context';
import { publicSafetyHeaders } from '@/lib/use-public-routes';
import { boundedRequest } from '@/lib/use-capture';
import { Feather } from '@/components/VectorIcon';
import { CaptureButton, CaptureInput, CapturePickerModal, captureStyles } from '@/components/capture/CapturePrimitives';
import { ui } from '@/constants/ui';
import { departureClock, departureCountdown } from '@/lib/departure-board-model';

export default function DeparturesScreen() {
  const auth=useAuth(), owner=auth.user?.id??null, safety=useBlockedContributors(), capture=useCaptureEntry(), insets=useSafeAreaInsets();
  const [originKey,setOriginKey]=useState<string|undefined>(),[pickerOpen,setPickerOpen]=useState(false),[search,setSearch]=useState('');
  const [focused,setFocused]=useState(true),[active,setActive]=useState(AppState.currentState!=='background'&&AppState.currentState!=='inactive'),[,tick]=useState(0);
  useFocusEffect(useCallback(()=>{setFocused(true);return()=>setFocused(false);},[]));
  useEffect(()=>{const subscription=AppState.addEventListener('change',state=>setActive(state==='active'));return()=>subscription.remove();},[]);
  const safetyKey=JSON.stringify([...safety.blockedContributorIds].sort());
  const ready=!auth.isLoading&&safety.isReady;
  const query=useQuery({queryKey:['departure-board',owner,safetyKey,originKey],enabled:ready&&focused&&active,
    queryFn:({signal})=>boundedRequest(inner=>getV2DepartureBoard(originKey?{originKey}:{},{signal:inner,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}),signal),
    retry:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:true});
  useEffect(()=>{if(!ready||!focused||!active)return;const timer=setInterval(()=>void query.refetch(),60000);return()=>clearInterval(timer);},[ready,focused,active,query.refetch]);
  useEffect(()=>{if(!focused||!active)return;const timer=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(timer);},[focused,active]);
  // Anchor to the actual server instant and a monotonic duration. A phone set
  // to another timezone or an incorrect wall clock cannot move the departure.
  const anchor=useMemo(()=>({server:Date.parse(query.data?.generatedAt??''),elapsed:performance.now()}),[query.data]);
  const now=anchor.server+Math.max(0,performance.now()-anchor.elapsed);
  // A stale/failed response never becomes an empty board or another city.
  const data=!ready||query.isError?undefined:query.data;
  const selected=data?.origins.find(c=>c.key===data.selectedOriginKey);
  const origins=data?.origins??[], items=data?.entries??[], busy=!ready||!data&&query.isFetching;
  const countdown=(item:V2DepartureEntry)=>item.countdownEligible?departureCountdown(item.nextDepartureAt,now):null;
  const nextKey=items.find(item=>countdown(item)!==null)?.key;
  const filtered=origins.filter(c=>c.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  function openPicker(){setSearch('');setPickerOpen(true);}
  function closePicker(){Keyboard.dismiss();setPickerOpen(false);}
  function openRoute(row:V2DepartureEntry){
    if(row.kind==='community'&&row.subjectId)capture.open({kind:'public_route',subjectId:row.subjectId});
    else if(row.kind==='legacy'&&row.journeyId)router.push({pathname:'/journey/[id]',params:{id:String(row.journeyId)}});
  }
  return <View style={s.screen}>
    <View style={[s.header,{paddingTop:(Platform.OS==='web'?67:insets.top)+12}]}>
      <View style={{flex:1,gap:4}}><Text style={s.kicker}>Departures from</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose departure city" accessibilityState={{disabled:busy||!origins.length}} disabled={busy||!origins.length} onPress={openPicker} style={s.cityButton}>
          <Text style={s.city} numberOfLines={2}>{selected?.name??(busy?'Loading cities…':'Choose a city')}</Text><Feather name="chevron-down" size={22} color="#DDE7F1"/>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh departure board" disabled={busy||query.isFetching} onPress={()=>void query.refetch()} style={s.refresh}><View style={[s.dot,{backgroundColor:nextKey?'#4DE097':'#B6C5D8'}]}/><Text style={s.schedule}>{nextKey?'Schedule':'Reports'}</Text></Pressable>
    </View>
    {selected&&items.length?<View style={s.boardHead}><View style={s.columns}><Text style={[s.column,s.timeColumn]}>TIME</Text><Text style={[s.column,s.destinationColumn]}>DESTINATION</Text><Text style={[s.column,s.operatorColumn]}>OPERATOR</Text><Text style={[s.column,s.inColumn,{textAlign:'right'}]}>IN</Text></View></View>:null}
    {safety.error?<State title="Safety settings could not load."><CaptureButton title="Try safety settings again" secondary onPress={()=>void safety.retryBlockedContributors().catch(()=>undefined)}/></State>:
      busy?<View style={s.state}><ActivityIndicator color="#24476A" accessibilityLabel="Loading departure board"/></View>:
      query.isError?<State title="The departure board could not load."><CaptureButton title="Try departure board again" secondary onPress={()=>void query.refetch()}/></State>:
      data?.selectionUnavailable?<State title="This city's routes are no longer available."><CaptureButton title="Choose another city" secondary onPress={openPicker}/></State>:
      !items.length?<State title={data?.hasHiddenRoutes?'Routes are hidden by your settings.':'No routes available yet.'}>{!data?.hasHiddenRoutes?<CaptureButton title="Add a route" onPress={()=>capture.open({kind:'route',entrySurface:'contribute_tab'})}/>:null}</State>:
      <FlatList data={items} keyExtractor={row=>row.key} contentContainerStyle={{paddingBottom:insets.bottom+(Platform.OS==='web'?100:20)}}
        renderItem={({item,index})=><Pressable accessibilityRole="button" accessibilityLabel={'Open departure report '+(item.operator??'operator unknown')+' '+(item.reportedTime??'time unknown')} onPress={()=>openRoute(item)} style={[s.row,{backgroundColor:item.key===nextKey?'#E4E9EE':index%2?'#FFFFFF':'#F1F4F8'},item.key===nextKey&&s.nextRow]}>
          <Text style={[s.timeColumn,s.time]}>{departureClock(item.reportedTime)}</Text>
          <View style={[s.destinationColumn,{gap:6}]}><Text style={s.destination}>{item.destination}</Text>{item.kind==='community'?<Text style={s.note}>Details needed</Text>:!countdown(item)?<Text style={s.note}>{item.scheduledDays??'Days not confirmed'}</Text>:null}</View>
          <View style={[s.operatorColumn,{gap:6}]}><Text style={s.operator}>{item.operator??'Operator unknown'}</Text>{item.pickupPoint?<View style={s.pickup}><Feather name="map-pin" size={13} color="#74808E"/><Text style={s.pickupText} numberOfLines={1}>{item.pickupPoint}</Text></View>:null}</View>
          <View style={s.inColumn}>{countdown(item)?<View accessibilityLabel={'Departs in '+countdown(item)} style={[s.badge,item.key===nextKey?s.nextBadge:s.laterBadge]}><Text style={[s.countdown,item.key===nextKey&&s.nextCountdown]}>{countdown(item)}</Text></View>:<Text accessibilityLabel="Departure countdown unavailable" style={s.unavailable}>—</Text>}<Feather name="chevron-right" size={16} color="#AEB9C5"/></View>
        </Pressable>}/>
    }
    {data?.hasHiddenRoutes&&items.length?<Text style={s.hidden}>Some routes are hidden by your settings.</Text>:null}
    {pickerOpen?<CapturePickerModal title="Departure city" closeLabel="Close departure cities" onClose={closePicker} input={<CaptureInput accessibilityLabel="Search available departure cities" placeholder="Search available cities" value={search} onChangeText={setSearch} maxLength={80} autoFocus returnKeyType="search"/>}>
      {!filtered.length?<Text style={captureStyles.note}>No available city matches.</Text>:null}
      {filtered.map(city=><Pressable accessibilityRole="button" accessibilityLabel={'Departures from '+city.name} accessibilityState={{selected:city.key===data?.selectedOriginKey}} key={city.key} onPress={()=>{closePicker();setOriginKey(city.key);}} style={s.cityChoice}>
        <View style={{flex:1,gap:5}}><Text style={captureStyles.reviewValue}>{city.name}</Text>{origins.filter(c=>c.name.toLocaleLowerCase()===city.name.toLocaleLowerCase()).length>1?<Text style={captureStyles.note}>{city.hasCommunityReports?'Route reports':'Reported schedules'}</Text>:null}</View>{city.key===data?.selectedOriginKey?<Feather name="check" size={20} color="#24476A"/>:null}
      </Pressable>)}
    </CapturePickerModal>:null}
  </View>;
}
function State({title,children}:{title:string;children?:React.ReactNode}){return <View style={s.state}><Text accessibilityRole="alert" style={s.stateTitle}>{title}</Text>{children}</View>;}
const s=StyleSheet.create({
 screen:{flex:1,backgroundColor:'#F1F4F8'},header:{backgroundColor:'#203D60',paddingHorizontal:18,paddingBottom:18,flexDirection:'row',alignItems:'flex-end',gap:12},
 kicker:{fontFamily:ui.type.regular,fontSize:14,lineHeight:21,color:'#BAC8D8'},cityButton:{minHeight:44,flexDirection:'row',alignItems:'center',gap:12},city:{fontFamily:ui.type.bold,fontSize:28,lineHeight:35,color:'#FFFFFF',flexShrink:1},
 refresh:{minHeight:44,borderRadius:24,paddingHorizontal:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,backgroundColor:'#FFFFFF18'},dot:{height:7,width:7,borderRadius:4},schedule:{fontFamily:ui.type.semibold,fontSize:14,lineHeight:21,color:'#FFFFFF'},
 boardHead:{backgroundColor:'#FFFFFF',borderBottomWidth:1,borderColor:'#D0D9E4'},columns:{flexDirection:'row',alignItems:'center',paddingHorizontal:14,paddingVertical:10,gap:8},column:{fontFamily:ui.type.semibold,fontSize:11,lineHeight:17,letterSpacing:0.6,color:'#6C7B8C'},
 timeColumn:{width:76,flexShrink:0},destinationColumn:{flex:1.12,minWidth:0},operatorColumn:{flex:1,minWidth:0},inColumn:{width:64,alignItems:'flex-end',gap:6,flexShrink:0},
 row:{minHeight:90,paddingVertical:15,paddingHorizontal:14,borderBottomWidth:1,borderColor:'#CCD6E1',flexDirection:'row',alignItems:'center',gap:8},
 nextRow:{borderLeftWidth:3,borderLeftColor:'#FF7B18',paddingLeft:11},time:{fontFamily:ui.type.bold,fontSize:17,lineHeight:24,color:'#111D2D'},destination:{fontFamily:ui.type.semibold,fontSize:17,lineHeight:24,color:'#111D2D'},operator:{fontFamily:ui.type.medium,fontSize:15,lineHeight:21,color:'#111D2D'},
 note:{fontFamily:ui.type.regular,fontSize:14,lineHeight:20,color:'#6C7B8C'},pickup:{flexDirection:'row',alignItems:'center',gap:3},pickupText:{fontFamily:ui.type.regular,fontSize:14,lineHeight:20,color:'#74808E',flexShrink:1},
 badge:{minHeight:34,borderRadius:10,paddingHorizontal:7,paddingVertical:7,alignItems:'center',justifyContent:'center',maxWidth:64},nextBadge:{backgroundColor:'#FF7B18'},laterBadge:{backgroundColor:'#EDF0FA'},countdown:{fontFamily:ui.type.semibold,fontSize:14,lineHeight:18,color:'#111D2D'},nextCountdown:{color:'#FFFFFF'},unavailable:{fontFamily:ui.type.regular,fontSize:17,lineHeight:24,color:'#6C7B8C'},
 state:{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:16},stateTitle:{fontFamily:ui.type.medium,fontSize:18,lineHeight:26,textAlign:'center',color:'#172D46'},hidden:{paddingHorizontal:18,paddingVertical:12,fontSize:14,lineHeight:21,color:'#617186'},cityChoice:{minHeight:56,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,borderBottomWidth:1,borderColor:'#DFE5ED'}
});
