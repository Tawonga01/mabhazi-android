import {pool} from '@workspace/db';

// Only a current accepted resolution's chosen original is eligible. Equal,
// pending reports cannot refresh an approved value's observation date.
export const approvedCardSql=`WITH roots AS MATERIALIZED(
 SELECT p.subject_id FROM public.v2_public_reviewed_lead_reports p
 JOIN jsonb_to_recordset($1::jsonb) expected(id uuid,revision bigint)
 ON expected.id=p.subject_id AND expected.revision=p.revision
 WHERE jsonb_array_length(p.core_corrections)=0 AND NOT(p.author_user_id=ANY($2::varchar[]))
 AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=p.author_user_id)
), claims AS MATERIALIZED(
 SELECT c.route_subject_id,c.actual_subject_id subject_id,c.observation_id,c.field_key,c.scope_key,c.scope,c.original_value,
 c.fare_ref ref,c.fare_author_id author,c.observed_from::text observed_date,c.field_read,c.evidence_included
 FROM public.v2_fare_report_context c JOIN roots r ON r.subject_id=c.route_subject_id
 UNION ALL
 SELECT c.route_subject_id,c.route_subject_id,c.observation_id,c.field_key,o.scope_key,'{}'::jsonb,c.original_value,
 c.place_ref,c.place_author_id,c.observed_from::text,c.field_read,c.evidence_included
 FROM roots r CROSS JOIN LATERAL public.v2_api_place_report_context(r.subject_id) c
 JOIN public.v2_observations o ON o.id=c.observation_id WHERE NOT c.is_hidden
), approved AS(
 SELECT c.* FROM claims c
 JOIN public.v2_current_fields f ON f.subject_id=c.subject_id AND f.field_key=c.field_key AND f.scope_key=c.scope_key
 JOIN public.v2_field_decisions d ON d.id=f.field_decision_id
 JOIN public.v2_field_resolutions resolution ON resolution.review_id=d.resolution_id AND NOT resolution.erased AND NOT resolution.receipt_redacted
 AND resolution.chosen_observation_id=c.observation_id
 JOIN public.v2_review_decisions review ON review.id=resolution.review_id AND review.action='accept' AND NOT review.evidence_erased
 JOIN public.v2_review_cases review_case ON review_case.id=review.case_id AND review_case.state='resolved' AND review_case.last_decision_id=review.id
 WHERE c.evidence_included AND c.field_read->>'status'='assessed' AND c.field_read->>'reviewed'='true'
 AND c.field_read->>'dispute'<>'open'
 AND c.field_read->'value'=CASE WHEN c.field_key LIKE 'fare.%'
 THEN jsonb_set(c.original_value,'{amount}',to_jsonb(trim_scale((c.original_value->>'amount')::numeric)::text)) ELSE c.original_value END
 AND NOT(c.author=ANY($2::varchar[]))
 AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=c.author)
)
SELECT route_subject_id,field_key,ref,field_read->'value' original_value,scope,observed_date,
 to_char(statement_timestamp() AT TIME ZONE 'Africa/Harare','YYYY-MM-DD') as_of FROM approved
 ORDER BY route_subject_id,field_key,ref`;

const scopeKeys=['schemaVersion','segment','serviceDate','quotationDate','sourceDate','effectiveFrom','effectiveTo','passengerCategory','passengerLabel','ticketBasis','ticketLabel','paymentMethod','luggageIncluded','timeBasis'];
export function cardFreshness(observed:string|null,asOf:string):'fresh'|'older'|'unknown' {
 if(!observed||!/^\d{4}-\d{2}-\d{2}$/.test(observed))return 'unknown';
 const age=(Date.parse(asOf+'T00:00:00Z')-Date.parse(observed+'T00:00:00Z'))/86400000;
 return Number.isFinite(age)&&age>=0?(age<14?'fresh':'older'):'unknown';
}
type Claim={route_subject_id:string;field_key:string;ref:string;original_value:Record<string,unknown>;scope:Record<string,unknown>;observed_date:string|null;as_of:string};
export function projectApprovedCards(rows:Claim[]){
 const result=new Map<string,Record<string,unknown>>();
 for(const id of new Set(rows.map(r=>r.route_subject_id))){
  const details:Record<string,unknown>={};
  for(const [key,fields] of Object.entries({fare:['fare.paid','fare.quoted','fare.advertised'],pickup:['boarding.pickup'],dropoff:['alighting.dropoff']})){
   const matches=rows.filter(r=>r.route_subject_id===id&&fields.includes(r.field_key));
   // A single compact price must never silently choose a currency, date,
   // passenger, ticket basis or a competing approved report.
   if(matches.length!==1)continue;
   const c=matches[0]!,scope=Object.fromEntries(scopeKeys.filter(k=>c.scope[k]!=null).map(k=>[k,c.scope[k]]));
   const observedDate=c.observed_date??(key==='fare'?
    (c.scope[c.field_key==='fare.paid'?'serviceDate':c.field_key==='fare.quoted'?'quotationDate':'sourceDate'] as string|undefined)??null:null);
   const common={id:c.ref,observedDate,freshness:cardFreshness(observedDate,c.as_of)};
   if(key==='fare')details.fare={...common,kind:c.field_key.split('.')[1],amount:String(c.original_value.amount),currency:c.original_value.currency,scope};
   else details[key]={...common,name:c.original_value.name};
  }
  if(Object.keys(details).length)result.set(id,details);
 }
 return result;
}
export async function readApprovedCards(routes:{subjectId:string;revision:unknown}[],blocked:string[],owner:string|null){
 if(!routes.length)return new Map<string,Record<string,unknown>>();
 if(routes.length>20)throw Error('card_page_too_large');
 const {rows}=await pool.query(approvedCardSql,[JSON.stringify(routes.map(r=>({id:r.subjectId,revision:Number(r.revision)}))),blocked,owner]);
 return projectApprovedCards(rows);
}
