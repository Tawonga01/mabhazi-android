import { SubmitV2RouteObservationsBody } from '@workspace/api-zod';
import { saveIntake, type IntakePool } from './minimumLead';

const raw=SubmitV2RouteObservationsBody;
const date=(value:string)=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)&&value>='0001-01-01'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
// Object strictness is enforced recursively before generated Orval schemas can
// strip members. The generated schemas continue to validate all declared values.
export function parseRouteObservations(input:unknown){
 const errors:{field:string;message:string}[]=[];
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const keys=(v:unknown,allowed:string[],at:string)=>{if(object(v))for(const k of Object.keys(v))if(!allowed.includes(k))errors.push({field:at?`${at}.${k}`:k,message:'This field is not supported.'});};
 keys(input,['schemaVersion','clientSubmissionId','entrySurface','target','observations'],'');
 if(object(input)){
  keys(input.target,['existing'],'target');const target=object(input.target)?input.target.existing:undefined;
  keys(target,['subjectId','expectedRevision','identityKey'],'target.existing');
  if(object(target)&&!Number.isSafeInteger(target.expectedRevision))errors.push({field:'target.existing.expectedRevision',message:'Choose the route again.'});
  const fields=new Set();if(Array.isArray(input.observations))input.observations.forEach((item,i)=>{
   const p=`observations.${i}`;keys(item,['fieldKey','value','scope','knowledgeBasis','observedDate','sources'],p);if(!object(item))return;
   keys(item.value,['cityId','name','instructions'],`${p}.value`);keys(item.scope,[],`${p}.scope`);
   if(fields.has(item.fieldKey))errors.push({field:`${p}.fieldKey`,message:'Report each place once.'});fields.add(item.fieldKey);
   if(object(item.value)){
    if(!Number.isInteger(item.value.cityId))errors.push({field:`${p}.value.cityId`,message:'Choose the endpoint city.'});
    if(typeof item.value.name==='string'&&(item.value.name.trim()!==item.value.name||/[\u0000-\u001f\u007f-\u009f]/.test(item.value.name)))errors.push({field:`${p}.value.name`,message:'Enter a named pickup or drop-off place.'});
   }
   if(item.observedDate!==undefined&&(typeof item.observedDate!=='string'||!date(item.observedDate)))errors.push({field:`${p}.observedDate`,message:'Enter a real date.'});
   if(Array.isArray(item.sources)&&new Set(item.sources.map(x=>typeof x==='string'?x.toLowerCase():x)).size!==item.sources.length)errors.push({field:`${p}.sources`,message:'Cite each source once.'});
  });
 }
 const parsed=raw.safeParse(input);if(!parsed.success)errors.push(...parsed.error.issues.map(i=>({field:i.path.join('.'),message:'Check this answer.'})));
 return parsed.success&&!errors.length?{success:true as const,data:parsed.data}:{success:false as const,fieldErrors:errors.slice(0,8)};
}
export function saveRouteObservations(actor:string,input:unknown,database?:IntakePool,blocked:string[]=[]){return saveIntake(actor,input,'v2_api_submit_route_observations',database,blocked);}
