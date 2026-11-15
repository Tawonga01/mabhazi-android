import type {V2ReviewedTimetable} from '@workspace/api-client-react';
export const timetableClock=(seconds:number)=>String(Math.floor(seconds/3600)%24).padStart(2,'0')+':'+String(Math.floor(seconds/60)%60).padStart(2,'0');
export function timetableDays(t:V2ReviewedTimetable){const names=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];return t.calendar.weekdays===127?'Daily':names.filter((_,i)=>t.calendar.weekdays&(1<<i)).join(', ');}
export function timetableDuration(t?:V2ReviewedTimetable){if(!t||t.arrivalSeconds==null||t.arrivalSeconds<t.departureSeconds)return undefined;const minutes=Math.floor((t.arrivalSeconds-t.departureSeconds)/60),hours=Math.floor(minutes/60);return hours?hours+'h'+(minutes%60?' '+minutes%60+'m':''):minutes+'m';}
