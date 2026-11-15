import React from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {ui} from '@/constants/ui';
import {useColors} from '@/hooks/useColors';
type Fact={freshness:'fresh'|'older'|'unknown';observedDate?:string|null};
export function factContext(fact:Fact){return fact.freshness==='fresh'?'approved, observed within 14 days':fact.freshness==='older'?'approved, observation at least 14 days old':'approved, observation date unknown';}
function Dot({fact}:{fact:Fact}){return <View accessible={false} style={[styles.freshness,{backgroundColor:fact.freshness==='fresh'?'#24844C':'#B17A0B'}]}/>;}
export function JourneySummaryCard({operator,departure,arrival,arrivalDay,duration,boarding,alighting,fare,pickup,dropoff,label,context,disabled,onPress}:{
 operator:string;departure:string;arrival?:string;arrivalDay?:number;duration?:string;boarding:string;alighting:string;
 fare?:Fact&{amount:string;currency:string};pickup?:Fact;dropoff?:Fact;
 label?:string;context:string;disabled?:boolean;onPress?:()=>void;
}){
 const colors=useColors(),identifier=operator.split(/\s+/).filter(Boolean).map(w=>w[0]).join('').slice(0,3).toUpperCase();
 return <Pressable accessibilityRole="button" accessibilityLabel={label??context} accessibilityHint={context} disabled={disabled||!onPress} onPress={onPress}
  style={({pressed})=>[styles.card,{backgroundColor:colors.card,borderColor:colors.border,opacity:pressed?.75:1}]}>
  <View style={styles.top}>
   <View style={styles.operator}><View style={[styles.identifier,{backgroundColor:colors.secondary}]}><Text style={[styles.initials,{color:colors.primary}]}>{identifier}</Text></View><Text numberOfLines={2} style={[styles.operatorName,{color:colors.mutedForeground}]}>{operator}</Text></View>
   {fare?<View style={styles.fare}><Dot fact={fare}/><Text style={[styles.price,{color:colors.foreground}]}>{fare.currency} {fare.amount}</Text></View>:null}
  </View>
  <View style={styles.journey}>
   <View style={styles.endpoint}><Text style={[styles.time,{color:colors.foreground}]}>{departure}</Text><View style={styles.place}>{pickup?<Dot fact={pickup}/>:null}<Text numberOfLines={2} style={[styles.stop,{color:colors.mutedForeground}]}>{boarding}</Text></View></View>
   <View accessible={false} style={styles.connection}>{duration?<Text style={[styles.duration,{color:colors.mutedForeground}]}>{duration}</Text>:null}<View style={styles.routeLine}><View style={[styles.endDot,{backgroundColor:colors.border}]}/><View style={[styles.line,{backgroundColor:colors.border}]}/><View style={[styles.endDot,{backgroundColor:colors.border}]}/></View></View>
   <View style={[styles.endpoint,styles.right]}><Text style={[styles.time,{color:colors.foreground}]}>{arrival??'—'}{arrivalDay?<Text style={styles.dayOffset}> +{arrivalDay}</Text>:null}</Text><View style={[styles.place,styles.placeRight]}>{dropoff?<Dot fact={dropoff}/>:null}<Text numberOfLines={2} style={[styles.stop,styles.rightText,{color:colors.mutedForeground}]}>{alighting}</Text></View></View>
  </View>
 </Pressable>;
}
const styles=StyleSheet.create({
 card:{marginHorizontal:16,marginBottom:12,borderWidth:1,borderRadius:ui.radius.group,padding:16,gap:22},
 top:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},
 operator:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:8},identifier:{paddingHorizontal:5,height:24,minWidth:26,borderRadius:5,alignItems:'center',justifyContent:'center'},
 initials:{fontFamily:ui.type.bold,fontSize:10},operatorName:{fontFamily:ui.type.medium,fontSize:13,flexShrink:1},
 fare:{flexDirection:'row',alignItems:'center',gap:6,flexShrink:0},price:{fontSize:18,fontFamily:ui.type.bold},
 journey:{flexDirection:'row',alignItems:'center',gap:12},endpoint:{flex:1,minWidth:0,gap:6},right:{alignItems:'flex-end'},time:{fontSize:28,fontFamily:ui.type.bold,fontVariant:['tabular-nums']},
 connection:{alignItems:'center',width:'20%',paddingBottom:25,gap:7},routeLine:{flexDirection:'row',alignItems:'center',width:'100%'},duration:{fontSize:11,fontFamily:ui.type.regular},dayOffset:{fontSize:12,fontFamily:ui.type.medium},line:{height:1,flex:1},endDot:{width:5,height:5,borderRadius:3},
 place:{flexDirection:'row',alignItems:'center',gap:5,minHeight:20},placeRight:{justifyContent:'flex-end'},stop:{fontSize:13,lineHeight:18,fontFamily:ui.type.regular,flexShrink:1},rightText:{textAlign:'right'},
 freshness:{width:6,height:6,borderRadius:3,flexShrink:0}
});
