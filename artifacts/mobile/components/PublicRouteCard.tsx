import React from 'react';
import {Pressable,Text,View} from 'react-native';
import type {V2PublicLead} from '@workspace/api-client-react';
import {useColors} from '@/hooks/useColors';
export function PublicRouteCard({route,onPress,disabled}:{route:V2PublicLead;onPress():void;disabled:boolean}){
 const c=useColors();
 return <Pressable accessibilityRole="button" accessibilityLabel={'Open route report '+route.operatorReport.value+' '+route.reportedTime.value} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{backgroundColor:c.card,borderWidth:1,borderColor:c.border,borderRadius:18,padding:20,marginHorizontal:16,marginBottom:12,gap:12}}>
  <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}><Text style={{fontFamily:'Inter_600SemiBold',fontSize:14,color:c.mutedForeground}}>Route report</Text><Text style={{fontFamily:'Inter_600SemiBold',fontSize:14,color:c.accent}}>Details needed</Text></View>
  <Text style={{fontFamily:'Inter_700Bold',fontSize:18,color:c.foreground}}>{route.origin.name} → {route.destination.name}</Text>
  <Text style={{fontFamily:'Inter_500Medium',fontSize:16,color:c.foreground}}>{route.operatorReport.value}</Text>
  <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-end',gap:8}}><View><Text style={{fontFamily:'Inter_400Regular',fontSize:14,color:c.mutedForeground}}>Reported time</Text><Text style={{fontFamily:'Inter_700Bold',fontSize:26,color:c.foreground}}>{route.reportedTime.value}</Text></View><Text style={{fontFamily:'Inter_400Regular',fontSize:14,color:c.mutedForeground}}>Days not confirmed</Text></View>
 </Pressable>;
}
