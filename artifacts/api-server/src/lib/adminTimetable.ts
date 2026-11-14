import {createHmac,timingSafeEqual} from 'node:crypto';

export type TimetableRow={departure:string;arrival:string|null;arrivalDay:0|1;fare:{amount:string;currency:string;kind:'advertised'|'quoted'}|null};
export type TimetableProposal={version:1;operator:string;originCityId:number;destinationCityId:number;
 pickup:string;dropoff:string|null;timezone:string;weekdays:number[];validFrom:string;validUntil:string;
 source:{kind:'published_timetable'|'operator_confirmation';reference:string;checkedOn:string};departures:TimetableRow[]};
export type TimetableIssue={field:string;message:string};
export type TimetableParse={proposal:TimetableProposal|null;issues:TimetableIssue[]};
const own=(p:Record<string,unknown>,keys:string[])=>Object.keys(p).sort().join(',')===keys.sort().join(',');
const object=(p:unknown):p is Record<string,unknown>=>!!p&&typeof p==='object'&&!Array.isArray(p);
const text=(p:unknown,max:number)=>typeof p==='string'&&p.length>0&&p===p.trim()&&p.length<=max&&!/[\u0000-\u001f\u007f]/.test(p);
const date=(p:unknown):p is string=>typeof p==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(p)&&p>='1900-01-01'&&p<='9999-12-31'&&Number.isFinite(Date.parse(p))&&new Date(p).toISOString().slice(0,10)===p;
const clock=(p:unknown):p is string=>typeof p==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(p);
const seconds=(p:string)=>Number(p.slice(0,2))*3600+Number(p.slice(3))*60;
const city=(p:unknown)=>typeof p==='number'&&Number.isSafeInteger(p)&&p>0&&p<=2147483647;
const domain='mabhazi-admin-timetable/1\0';

/** Strict private proposal, independent of public contribution/legacy DTOs. */
export function parseTimetableProposal(raw:unknown,now=Date.now()):TimetableParse{
 const issues:TimetableIssue[]=[];
 const fail=(field:string,message:string)=>issues.push({field,message});
 if(!object(raw)||!own(raw,['version','operator','originCityId','destinationCityId','pickup','dropoff','timezone','weekdays','validFrom','validUntil','source','departures'])||raw.version!==1)
  return{proposal:null,issues:[{field:'form',message:'Use the timetable entry form.'}]};
 if(!text(raw.operator,120))fail('operator','Enter the operator name.');
 if(!city(raw.originCityId))fail('originCityId','Choose a departure city.');
 if(!city(raw.destinationCityId))fail('destinationCityId','Choose a destination city.');
 if(city(raw.originCityId)&&raw.originCityId===raw.destinationCityId)fail('destinationCityId','Choose a different destination.');
 if(!text(raw.pickup,200))fail('pickup','Enter the known boarding place.');
 if(raw.dropoff!==null&&!text(raw.dropoff,200))fail('dropoff','Enter a drop-off name, or leave it blank.');
 let today:string|null=null;
 if(typeof raw.timezone!=='string'||raw.timezone.length>100)fail('timezone','Choose a timezone.');
 else try{
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:raw.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=fmt.formatToParts(now),part=(type:string)=>parts.find(p=>p.type===type)?.value;
  today=part('year')+'-'+part('month')+'-'+part('day');
  if(!raw.timezone.includes('/'))fail('timezone','Choose an IANA timezone, such as Africa/Harare.');
 }catch{fail('timezone','Choose a valid IANA timezone.');}
 if(!Array.isArray(raw.weekdays)||raw.weekdays.length<1||raw.weekdays.length>7||raw.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(raw.weekdays).size!==raw.weekdays.length)
  fail('weekdays','Select the operating days stated by the source.');
 if(!date(raw.validFrom))fail('validFrom','Enter the first applicable date.');
 if(!date(raw.validUntil))fail('validUntil','Enter the last applicable date.');
 if(date(raw.validFrom)&&date(raw.validUntil)&&raw.validUntil<raw.validFrom)fail('validUntil','The end date must follow the start date.');
 if(!object(raw.source)||!own(raw.source,['kind','reference','checkedOn'])||!['published_timetable','operator_confirmation'].includes(String(raw.source.kind)))fail('source','Choose the source of this timetable.');
 else{
  if(!text(raw.source.reference,1000))fail('source.reference','Enter a source reference you can check again.');
  if(!date(raw.source.checkedOn))fail('source.checkedOn','Enter the date you checked the information.');
  else if(today&&raw.source.checkedOn>today)fail('source.checkedOn','The information date cannot be in the future.');
 }
 if(!Array.isArray(raw.departures)||raw.departures.length<1||raw.departures.length>30)fail('departures','Add between 1 and 30 departures.');
 else{
  const seen=new Set<string>();
  raw.departures.forEach((row:unknown,i:number)=>{
   const key='departures.'+i;
   if(!object(row)||!own(row,['departure','arrival','arrivalDay','fare'])){fail(key,'Check this departure row.');return;}
   if(!clock(row.departure))fail(key+'.departure','Enter a clock departure time.');
   else if(seen.has(row.departure))fail(key+'.departure','This departure time is already in this timetable.');
   else seen.add(row.departure);
   if(row.arrivalDay!==0&&row.arrivalDay!==1)fail(key+'.arrivalDay','Choose same day or next day.');
   if(row.arrival===null){if(row.arrivalDay!==0)fail(key+'.arrivalDay','Clear the day offset when arrival is unknown.');}
   else if(!clock(row.arrival))fail(key+'.arrival','Enter an arrival time, or leave it blank.');
   else if(clock(row.departure)&&(row.arrivalDay===0||row.arrivalDay===1)&&seconds(row.arrival)+row.arrivalDay*86400<seconds(row.departure))
    fail(key+'.arrivalDay','Select next day if this arrival is after midnight.');
   if(row.fare!==null){
    if(!object(row.fare)||!own(row.fare,['amount','currency','kind']))fail(key+'.fare','Check the price and currency.');
    else{
     // This form captures an advertised whole-route fare, never a paid ticket.
     if(typeof row.fare.amount!=='string'||!/^\d{1,9}(\.\d{1,2})?$/.test(row.fare.amount)||Number(row.fare.amount)<=0)fail(key+'.fare.amount','Enter a positive price, or leave it blank.');
     if(!['USD','ZAR','ZMW','MWK','BWP','ZWG'].includes(String(row.fare.currency)))fail(key+'.fare.currency','Choose the price currency.');
     if(!['advertised','quoted'].includes(String(row.fare.kind)))fail(key+'.fare.kind','Choose advertised or quoted price.');
    }
   }
  });
 }
 if(issues.length)return{proposal:null,issues};
 const p=raw as unknown as TimetableProposal;
 return{proposal:{...p,weekdays:[...p.weekdays].sort((a,b)=>a-b),departures:[...p.departures].sort((a,b)=>a.departure.localeCompare(b.departure))},issues:[]};
}

export type TimetableProof={version:1;actor:string;proposal:TimetableProposal;stateDigest:string;issuedAt:number;expiresAt:number};
export function createTimetablePreview(proposal:TimetableProposal,actor:string,stateDigest:string,secret:string,now=Date.now()){
 if(secret.length<16||!actor||!/^[a-f0-9]{64}$/.test(stateDigest)||!parseTimetableProposal(proposal,now).proposal)throw Error('timetable_preview_invalid');
 const body=Buffer.from(JSON.stringify({version:1,actor,proposal,stateDigest,issuedAt:now,expiresAt:now+300000} satisfies TimetableProof)).toString('base64url');
 return body+'.'+createHmac('sha256',secret).update(domain+body).digest('base64url');
}
export function readTimetablePreview(token:unknown,actor:string,secret:string,now=Date.now()):TimetableProof|null{
 if(typeof token!=='string'||token.length>40000||secret.length<16)return null;
 const [body,sig,...rest]=token.split('.');
 if(rest.length||!body||!/^[A-Za-z0-9_-]+$/.test(body)||!sig||!/^[A-Za-z0-9_-]{43}$/.test(sig))return null;
 const mac=createHmac('sha256',secret).update(domain+body).digest(),given=Buffer.from(sig,'base64url');
 if(mac.length!==given.length||!timingSafeEqual(mac,given))return null;
 try{
  const p=JSON.parse(Buffer.from(body,'base64url').toString()) as TimetableProof;
  if(!object(p)||!own(p,['version','actor','proposal','stateDigest','issuedAt','expiresAt'])||p.version!==1||p.actor!==actor
   ||!Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||p.issuedAt>now+30000||p.expiresAt-p.issuedAt!==300000
   ||!/^[a-f0-9]{64}$/.test(p.stateDigest)||!parseTimetableProposal(p.proposal,now).proposal)return null;
  // Like other admin commands, expiry is checked by the database AFTER replay.
  return p;
 }catch{return null;}
}
