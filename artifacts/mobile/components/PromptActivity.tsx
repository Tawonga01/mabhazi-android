import React,{createContext,useCallback,useContext,useEffect,useRef} from 'react';
import {AppState,View} from 'react-native';
import {usePathname} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {getV2Capabilities,recordV2PromptActivity} from '@workspace/api-client-react';
import {useAuth} from '@/lib/auth';
import {boundedRequest} from '@/lib/use-capture';
import {ForegroundActivityGate} from '@/lib/prompt-controls-model';

const ActivityContext=createContext<()=>void>(()=>{});
export const usePromptActivity=()=>useContext(ActivityContext);
export function usePromptControlsAvailable(owner:string|null){
 const query=useQuery({queryKey:['prompt-controls-capability',owner],enabled:!!owner,
  queryFn:({signal})=>boundedRequest(s=>getV2Capabilities({signal:s}),signal),staleTime:60000,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false});
 return !!owner&&query.data?.promptControlsEnabled===true;
}
export function PromptActivityBoundary({children}:{children:React.ReactNode}){
 const auth=useAuth(),owner=auth.isAuthenticated?auth.user?.id??null:null,path=usePathname();
 const enabled=usePromptControlsAvailable(owner),gate=useRef(new ForegroundActivityGate()),foreground=useRef(AppState.currentState==='active');
 const latest=useRef({owner,enabled});latest.current={owner,enabled};
 const interact=useCallback(()=>{
  const current=latest.current;gate.current.context(current.owner,foreground.current,current.enabled);
  void gate.current.interact(Date.now(),(actor,signal)=>boundedRequest(s=>recordV2PromptActivity({}, {signal:s,headers:{'X-Mabhazi-Account':actor}}),signal));
 },[]);
 useEffect(()=>{
  gate.current.context(owner,foreground.current,enabled);
  if(foreground.current)interact();
 },[owner,enabled,path,interact]);
 useEffect(()=>{
  const subscription=AppState.addEventListener('change',state=>{
   foreground.current=state==='active';const current=latest.current;gate.current.context(current.owner,foreground.current,current.enabled);
   if(foreground.current)interact();
  });
  return ()=>{subscription.remove();gate.current.dispose();};
 },[interact]);
 return <ActivityContext.Provider value={interact}><View style={{flex:1}} onTouchStart={interact}>{children}</View></ActivityContext.Provider>;
}
