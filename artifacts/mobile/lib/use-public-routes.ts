import { useInfiniteQuery } from '@tanstack/react-query';
import { searchV2Routes, type SearchV2RoutesParams } from '@workspace/api-client-react';
export function publicSafetyHeaders(owner:string|null,blocked:ReadonlySet<string>){return {'X-Mabhazi-Blocked-Contributors':JSON.stringify([...blocked].sort()),...(owner?{'X-Mabhazi-Account':owner}:{})};}
export function usePublicRoutes(params:SearchV2RoutesParams,enabled:boolean,owner:string|null,blocked:ReadonlySet<string>,revision:number){
 const safety=JSON.stringify([...blocked].sort());
 return useInfiniteQuery({queryKey:['public-route-reports',owner,params,safety,revision],enabled,
  initialPageParam:undefined as string|undefined,
  queryFn:async({pageParam,signal})=>{const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();const timer=setTimeout(abort,15000);
   try{return await searchV2Routes({...params,...(pageParam?{cursor:pageParam}:{})},{signal:controller.signal,headers:publicSafetyHeaders(owner,blocked)});}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}},
  getNextPageParam:last=>last.nextCursor,staleTime:0,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false});
}
