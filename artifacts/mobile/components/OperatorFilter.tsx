import React,{useState} from 'react';
import {View,Text,Pressable,ScrollView,StyleSheet} from 'react-native';
import {Feather} from '@/components/VectorIcon';
import {ui} from '@/constants/ui';
import {useColors} from '@/hooks/useColors';
export function OperatorFilter({operators,value,onChange}:{operators:string[];value:string|null;onChange:(value:string|null)=>void}){
 const colors=useColors(),[open,setOpen]=useState(false);
 return <View style={styles.container}><Text style={[styles.label,{color:colors.mutedForeground}]}>FILTER BY OPERATOR</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={`Filter by operator: ${value??'All operators'}`} accessibilityState={{expanded:open}}
   onPress={()=>setOpen(!open)} style={[styles.button,{borderColor:colors.border,backgroundColor:colors.card}]}>
   <Text numberOfLines={1} style={[styles.value,{color:colors.foreground}]}>{value??'All operators'}</Text><Feather name={open?'chevron-up':'chevron-down'} size={15} color={colors.mutedForeground}/></Pressable>
  {open?<ScrollView style={[styles.menu,{borderColor:colors.border,backgroundColor:colors.card}]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
   {[null,...operators].map(op=><Pressable key={op??'all'} accessibilityRole="button" accessibilityLabel={op??'All operators'} accessibilityState={{selected:op===value}}
    onPress={()=>{onChange(op);setOpen(false);}} style={[styles.option,{backgroundColor:op===value?colors.secondary:colors.card}]}>
    <Text style={[styles.optionText,{color:colors.foreground}]}>{op??'All operators'}</Text>{op===value?<Feather name="check" size={16} color={colors.primary}/>:null}
   </Pressable>)}</ScrollView>:null}
 </View>;
}
const styles=StyleSheet.create({container:{alignItems:'center',marginHorizontal:16,marginBottom:22,gap:8},label:{fontFamily:ui.type.medium,fontSize:11,letterSpacing:1},button:{borderWidth:1,borderRadius:ui.radius.control,paddingHorizontal:16,minHeight:44,minWidth:176,maxWidth:'100%',flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:18},value:{fontFamily:ui.type.semibold,fontSize:14,flexShrink:1},menu:{borderWidth:1,borderRadius:ui.radius.control,maxHeight:240,width:'100%'},option:{minHeight:48,paddingHorizontal:16,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},optionText:{fontFamily:ui.type.regular,fontSize:15,flexShrink:1}});
