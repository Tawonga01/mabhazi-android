import {timetableClock,timetableDuration} from '@/lib/reviewed-timetable-model';
import React from 'react';
import type {V2PublicLead} from '@workspace/api-client-react';
import {JourneySummaryCard,factContext} from './JourneySummaryCard';

export function PublicRouteCard({route,onPress,disabled}:{route:V2PublicLead;onPress:()=>void;disabled?:boolean}){
 const {fare,pickup,dropoff}=route.cardDetails??{};
 const scope=fare?.scope??{},fareContext=fare?[
  fare.kind,fare.currency,fare.amount,factContext(fare),fare.observedDate,
  scope.passengerCategory,scope.passengerLabel,scope.ticketBasis,scope.ticketLabel,
  scope.paymentMethod,scope.luggageIncluded===undefined?null:scope.luggageIncluded?'luggage included':'luggage extra',
  scope.serviceDate,scope.quotationDate,scope.sourceDate,scope.effectiveFrom,scope.effectiveTo
 ].filter(value=>value!==undefined&&value!==null).join(', '):'No approved fare';
 return <JourneySummaryCard operator={route.operatorReport.value} departure={route.reportedTime.value}
  arrival={route.timetable?.arrivalSeconds!=null?timetableClock(route.timetable.arrivalSeconds):undefined} arrivalDay={route.timetable?.arrivalSeconds!=null?Math.floor(route.timetable.arrivalSeconds/86400):undefined} duration={timetableDuration(route.timetable)}
  boarding={pickup?.name??route.origin.name} alighting={dropoff?.name??route.destination.name}
  fare={fare} pickup={pickup} dropoff={dropoff} disabled={disabled} onPress={onPress}
  label={`Open route report ${route.operatorReport.value} ${route.reportedTime.value}`}
  context={['View route: '+route.origin.name+' to '+route.destination.name,route.operatorReport.value,
   (route.timetable?'Scheduled departure ':'Reported departure ')+route.reportedTime.value,route.timetable?.arrivalSeconds!=null?'Scheduled arrival '+timetableClock(route.timetable.arrivalSeconds)+(route.timetable.arrivalSeconds>=86400?' the next day':''):'Arrival time unknown',fareContext,
   pickup?'Pickup '+pickup.name+', '+factContext(pickup):'Pickup not approved',
   dropoff?'Drop-off '+dropoff.name+', '+factContext(dropoff):'Drop-off not approved'
  ].join('. ')}/>;
}
