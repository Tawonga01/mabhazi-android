import { SubmitV2ActualJourneyBody } from '@workspace/api-zod';
import { saveIntake, type IntakePool } from './minimumLead';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Orval supplies the declared value rules. Reject unknown members before it can strip them. */
export function parseActualJourney(input: unknown) {
  const issues: {field: string; message: string}[] = [];
  function keys(value: unknown, allowed: string[], path: string) {
    if (!object(value)) return;
    for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push({field: path ? `${path}.${key}` : key, message:'This field is not supported.'});
  }
  keys(input,['schemaVersion','clientSubmissionId','entrySurface','target','observations','actualContext'],'');
  if (object(input)) {
    keys(input.target,['newActualJourney'],'target');
    const target=object(input.target) ? input.target.newActualJourney : undefined;
    keys(target,['reportedServiceDate','timezone','intendedSubject'],'target.newActualJourney');
    if (object(target)) {
      keys(target.intendedSubject,['id','kind','expectedRevision'],'target.newActualJourney.intendedSubject');
      if (object(target.intendedSubject) && !Number.isSafeInteger(target.intendedSubject.expectedRevision)) issues.push({field:'target.newActualJourney.intendedSubject.expectedRevision',message:'Choose the service again.'});
    }
    keys(input.actualContext,['knowledgeBasis','observedDate'],'actualContext');
    if (Array.isArray(input.observations)) input.observations.forEach((item,index) => {
      const path=`observations.${index}`;
      keys(item,['fieldKey','value','scope','knowledgeBasis','observedDate','observedDateEnd','effectiveFrom','effectiveTo','sources'],path);
      if (!object(item)) return;
      const field=item.fieldKey, value=item.value, scope=item.scope;
      if (field==='departure.actual' || field==='arrival.actual') {
        keys(value,['time'],`${path}.value`);keys(scope,['schemaVersion','serviceDate','timezone','utcOffset'],`${path}.scope`);
        if (object(scope) && scope.timezone!==undefined && scope.utcOffset!==undefined) issues.push({field:`${path}.scope`,message:'Use a timezone or a UTC offset, not both.'});
      } else if (field==='operator.reported') {
        keys(value,['name'],`${path}.value`);keys(scope,[],`${path}.scope`);
        if (object(value) && typeof value.name==='string' && (value.name.trim()!==value.name || /[\u0000-\u001f\u007f-\u009f]/.test(value.name) || ['unknown','n/a','-'].includes(value.name.toLowerCase()))) issues.push({field:`${path}.value.name`,message:'Enter the reported bus company name.'});
      } else if (field==='boarding.pickup' || field==='alighting.dropoff') {
        keys(value,['cityId','name','instructions'],`${path}.value`);keys(scope,[],`${path}.scope`);
        if (object(value) && !Number.isInteger(value.cityId)) issues.push({field:`${path}.value.cityId`,message:'Choose a city.'});
      } else if (typeof field==='string' && field.startsWith('fare.')) {
        keys(value,['amount','currency'],`${path}.value`);
        keys(scope,['schemaVersion','segment','serviceDate','quotationDate','sourceDate','effectiveFrom','effectiveTo','passengerCategory','passengerLabel','ticketBasis','ticketLabel','paymentMethod','luggageIncluded','timeBasis'],`${path}.scope`);
        if (object(scope)) {
          keys(scope.segment,['kind','originCityId','destinationCityId'],`${path}.scope.segment`);
          if (object(scope.segment) && (!Number.isInteger(scope.segment.originCityId) || !Number.isInteger(scope.segment.destinationCityId) || scope.segment.originCityId===scope.segment.destinationCityId)) issues.push({field:`${path}.scope.segment`,message:'Choose different departure and destination cities.'});
          for (const [kind,label] of [['passengerCategory','passengerLabel'],['ticketBasis','ticketLabel']]) if (scope[kind]==='other' && (typeof scope[label]!=='string' || !scope[label].trim())) issues.push({field:`${path}.scope.${label}`,message:'Describe this fare condition.'});
          if (field==='fare.paid' && scope.serviceDate===undefined) issues.push({field:`${path}.scope.serviceDate`,message:'Enter the travel date for a paid fare.'});
        }
      }
      if (Array.isArray(item.sources) && new Set(item.sources.map(id=>typeof id==='string'?id.toLowerCase():id)).size!==item.sources.length) issues.push({field:`${path}.sources`,message:'Cite each source once.'});
    });
  }
  const parsed=SubmitV2ActualJourneyBody.safeParse(input);
  if (!parsed.success) issues.push(...parsed.error.issues.map(i=>({field:i.path.join('.'),message:'Check this answer.'})));
  return parsed.success && !issues.length ? {success:true as const,data:parsed.data} : {success:false as const,fieldErrors:issues.slice(0,8)};
}
export function saveActualJourney(actor: string,input: unknown,database?: IntakePool,blocked: string[] = []) {
  const surface=(input as {entrySurface?:string}).entrySurface;
  return saveIntake(actor,input,surface==='search_result'||surface==='route_detail'?'v2_api_submit_public_actual_journey':'v2_api_submit_actual_journey',database,blocked);
}
