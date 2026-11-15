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

export type ReviewedTimetable={runId:string;departureSeconds:number;arrivalSeconds:number|null;calendar:{timezone:string;weekdays:number;validFrom:string;validUntil:string}};
/** Resolve explicit local service time by round-trip. Gaps/folds are held rather
 * than choosing a DST offset the source never supplied. Server time owns this. */
export function nextTimetableDeparture(t:ReviewedTimetable,now:number):string|null{
 if(!Number.isFinite(now)||!Number.isInteger(t.departureSeconds)||t.departureSeconds<0||t.departureSeconds>=86400||!t.calendar||
 !Number.isInteger(t.calendar.weekdays)||t.calendar.weekdays<1||t.calendar.weekdays>127)return null;
 const c=t.calendar;
 const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 try{
  if(!date(c.validFrom)||!date(c.validUntil)||c.validFrom>c.validUntil)return null;
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:c.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const local=(ms:number)=>{const p=Object.fromEntries(format.formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);};
  const localNow=local(now),today=new Date(localNow).toISOString().slice(0,10),start=today<c.validFrom?c.validFrom:today;
  for(let i=0;i<8;i++){
   const day=Date.parse(start+'T00:00:00Z')+i*86400000,ymd=new Date(day).toISOString().slice(0,10);
   if(ymd>c.validUntil)return null;
   const isoDay=(new Date(day).getUTCDay()+6)%7;
   if(!(c.weekdays&(1<<isoDay)))continue;
   const target=day+t.departureSeconds*1000,offsets=new Set<number>();
   for(let h=-36;h<=36;h+=6){const sample=target+h*3600000;offsets.add(local(sample)-sample);}
   const matches=[...offsets].map(offset=>target-offset).filter(ms=>local(ms)===target).sort((a,b)=>a-b);
   if(matches.length!==1){if(matches.length&&matches.every(ms=>ms<now)||!matches.length&&target<localNow)continue;return null;}
   if(matches[0]>=now)return new Date(matches[0]).toISOString();
  }
 }catch{/* invalid timezone/date */}
 return null;
}
