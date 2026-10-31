// The user explicitly selected Zimbabwe time for existing legacy timetables.
// This is a compatibility interpretation, not canonical publication of a report.
export const legacyScheduleTimezone = 'Africa/Harare';
const dayNames = ['sun','mon','tue','wed','thu','fri','sat'];
type Schedule = {date:string} | {days:Set<number>};
function schedule(value:string):Schedule|null {
 const text=value.trim().toLowerCase();
 if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
  const time=Date.parse(text+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text?{date:text}:null;
 }
 if (['daily','every day'].includes(text)) return {days:new Set([0,1,2,3,4,5,6])};
 if (text==='weekdays') return {days:new Set([1,2,3,4,5])};
 if (text==='weekends') return {days:new Set([0,6])};
 const words=text.split(/[\s,;/|]+/).filter(Boolean), days=new Set<number>();
 for(const word of words){const full=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];const day=dayNames.indexOf(word.length===3?word:'');const index=day<0?full.indexOf(word):day;if(index<0)return null;days.add(index);}
 return days.size?{days}:null;
}
function localDate(now:number):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:legacyScheduleTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
 const part=(name:string)=>parts.find(p=>p.type===name)!.value;
 return part('year')+'-'+part('month')+'-'+part('day');
}
// Africa/Harare has no daylight transitions. Derive and validate the offset
// through the server's timezone database rather than the phone's locale/clock.
function instant(date:string,clock:string):number|null {
 const guess=Date.parse(date+'T'+clock.slice(0,5)+':00Z');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:legacyScheduleTimezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
 const p=(type:string)=>Number(parts.find(x=>x.type===type)!.value);
 const offset=Date.UTC(p('year'),p('month')-1,p('day'),p('hour'),p('minute'),p('second'))-guess;
 const result=guess-offset;
 return Number.isFinite(result)?result:null;
}
export function nextLegacyDeparture(clock:string|null|undefined,operatingDays:string|null|undefined,now:number):string|null {
 if(!Number.isFinite(now)||!clock||!/^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(clock)||!operatingDays)return null;
 // Seconds must be preserved, including a precise departure near midnight.
 const seconds=clock.length===8?Number(clock.slice(6)):0;
 const rule=schedule(operatingDays);if(!rule)return null;
 const today=localDate(now),base=Date.parse(today+'T00:00:00Z');
 const dates='date' in rule?[rule.date]:Array.from({length:8},(_,i)=>new Date(base+i*86400000).toISOString().slice(0,10)).filter(d=>rule.days.has(new Date(d+'T00:00:00Z').getUTCDay()));
 for(const date of dates){const departure=instant(date,clock);if(departure!==null&&departure+seconds*1000>now)return new Date(departure+seconds*1000).toISOString();}
 return null;
}
