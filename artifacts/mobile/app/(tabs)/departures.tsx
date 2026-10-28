import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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

export default function DeparturesScreen() {
  const auth=useAuth(), owner=auth.user?.id??null, safety=useBlockedContributors(), capture=useCaptureEntry(), insets=useSafeAreaInsets();
  const [originKey,setOriginKey]=useState<string|undefined>(),[pickerOpen,setPickerOpen]=useState(false),[search,setSearch]=useState('');
  const safetyKey=JSON.stringify([...safety.blockedContributorIds].sort());
  const ready=!auth.isLoading&&safety.isReady;
  const query=useQuery({queryKey:['departure-board',owner,safetyKey,originKey],enabled:ready,
    queryFn:({signal})=>boundedRequest(inner=>getV2DepartureBoard(originKey?{originKey}:{},{signal:inner,headers:publicSafetyHeaders(owner,safety.blockedContributorIds)}),signal),
    retry:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:true});
  const refresh=useRef(query.refetch);refresh.current=query.refetch;
  const visited=useRef(false);
  useFocusEffect(useCallback(()=>{if(!ready)return;if(visited.current)void refresh.current();else visited.current=true;},[ready,owner,safetyKey]));
  // A stale/failed response never becomes an empty board or another city.
  const data=!ready||query.isError||query.isFetching?undefined:query.data;
  const selected=data?.origins.find(c=>c.key===data.selectedOriginKey);
  const origins=data?.origins??[], items=data?.entries??[], busy=!ready||query.isFetching;
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
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh departure board" disabled={busy} onPress={()=>void query.refetch()} style={s.refresh}><Feather name="rotate-ccw" size={20} color="#DDE7F1"/></Pressable>
    </View>
    {selected&&items.length?<View style={s.boardHead}><Text style={s.reported}>Reported times</Text><View style={s.columns}><Text style={[s.column,{width:64}]}>TIME</Text><Text style={[s.column,{flex:1}]}>DESTINATION</Text><Text style={[s.column,{width:104}]}>OPERATOR</Text></View></View>:null}
    {safety.error?<State title="Safety settings could not load."><CaptureButton title="Try safety settings again" secondary onPress={()=>void safety.retryBlockedContributors().catch(()=>undefined)}/></State>:
      busy?<View style={s.state}><ActivityIndicator color="#24476A" accessibilityLabel="Loading departure board"/></View>:
      query.isError?<State title="The departure board could not load."><CaptureButton title="Try departure board again" secondary onPress={()=>void query.refetch()}/></State>:
      data?.selectionUnavailable?<State title="This city's routes are no longer available."><CaptureButton title="Choose another city" secondary onPress={openPicker}/></State>:
      !items.length?<State title={data?.hasHiddenRoutes?'Routes are hidden by your settings.':'No routes available yet.'}>{!data?.hasHiddenRoutes?<CaptureButton title="Add a route" onPress={()=>capture.open({kind:'route',entrySurface:'contribute_tab'})}/>:null}</State>:
      <FlatList data={items} keyExtractor={row=>row.key} contentContainerStyle={{paddingBottom:insets.bottom+(Platform.OS==='web'?100:20)}}
        renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={'Open departure report '+(item.operator??'operator unknown')+' '+(item.reportedTime??'time unknown')} onPress={()=>openRoute(item)} style={s.row}>
          <Text style={s.time}>{item.reportedTime??'—'}</Text>
          <View style={{flex:1,gap:6}}><Text style={s.destination}>{item.destination}</Text><Text style={s.note}>{item.kind==='community'?'Details needed':item.scheduledDays?'Reported · '+item.scheduledDays:'Days not confirmed'}</Text></View>
          <View style={{width:104,gap:6,alignItems:'flex-start'}}><Text style={s.operator}>{item.operator??'Operator unknown'}</Text><Feather name="chevron-right" size={16} color="#7D8C9D"/></View>
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
 screen:{flex:1,backgroundColor:'#F4F6F9'},header:{backgroundColor:'#102744',paddingHorizontal:20,paddingBottom:20,flexDirection:'row',alignItems:'flex-end',gap:12},
 kicker:{fontFamily:ui.type.regular,fontSize:14,lineHeight:21,color:'#B6C5D8'},cityButton:{minHeight:44,flexDirection:'row',alignItems:'center',gap:12},city:{fontFamily:ui.type.bold,fontSize:28,lineHeight:35,color:'#F4F6F9',flexShrink:1},refresh:{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center'},
 boardHead:{backgroundColor:'#FFF',borderBottomWidth:1,borderColor:'#DFE5ED'},reported:{fontFamily:ui.type.regular,fontSize:14,lineHeight:21,color:'#617186',paddingHorizontal:18,paddingTop:14,paddingBottom:8},columns:{flexDirection:'row',paddingHorizontal:18,paddingBottom:12,gap:12},column:{fontFamily:ui.type.semibold,fontSize:12,lineHeight:18,letterSpacing:0.8,color:'#617186'},
 row:{minHeight:98,paddingVertical:18,paddingHorizontal:18,borderBottomWidth:1,borderColor:'#DFE5ED',flexDirection:'row',alignItems:'flex-start',gap:12},time:{width:64,fontFamily:ui.type.semibold,fontSize:20,lineHeight:27,color:'#172D46'},destination:{fontFamily:ui.type.semibold,fontSize:19,lineHeight:26,color:'#172D46'},operator:{fontFamily:ui.type.medium,fontSize:15,lineHeight:22,color:'#172D46'},note:{fontFamily:ui.type.regular,fontSize:14,lineHeight:21,color:'#617186'},state:{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:16},stateTitle:{fontFamily:ui.type.medium,fontSize:18,lineHeight:26,textAlign:'center',color:'#172D46'},hidden:{paddingHorizontal:18,paddingVertical:12,fontSize:14,lineHeight:21,color:'#617186'},cityChoice:{minHeight:56,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,borderBottomWidth:1,borderColor:'#DFE5ED'}
});
