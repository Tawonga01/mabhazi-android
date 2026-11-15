import {createHash} from 'node:crypto';
import {pool} from '@workspace/db';

// One registry feeds the queue, property columns and previews. An observation
// remains its own claim: two currencies/dates are never collapsed into a cell.
export const adminFields = {
  'route.origin':'Departure city','route.destination':'Destination city',
  'operator.reported':'Operator','operator.identity':'Operator identity',
  'departure.reported':'Departure time','departure.scheduled':'Scheduled departure',
  'departure.actual':'Actual departure','arrival.scheduled':'Scheduled arrival',
  'arrival.actual':'Actual arrival','service.calendar':'Operating days',
  'fare.paid':'Paid fare','fare.quoted':'Quoted fare','fare.advertised':'Advertised fare',
  'boarding.pickup':'Pickup','alighting.dropoff':'Drop-off','stop.location':'Place',
  'pattern.stops':'Stops','timetable.sign_presence':'Timetable sign',
} as const;
export type AdminField = keyof typeof adminFields;
export type AdminClaim = {
  id:string; routeId:string; subjectId:string; contributionId:string; observationId:string|null;
  field:string; label:string; value:unknown; scope:Record<string,unknown>;
  basis:string; submittedAt:string; observedFrom:string|null; observedTo:string|null;
  effectiveFrom:string|null; effectiveTo:string|null; subjectRevision:string;
  observationRevision:string|null; targetRevision:string|null; state:string;
  digest:string; review:'pending'|'approved'|'rejected'; reviewId:string|null;
  assessmentId:string|null; caseRevision:string; attention:string|null;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validAdminId=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
export const adminDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const date=(value:unknown):string|null=>value===null||value===undefined?null:value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);

// The active named role is fenced into the data statement as well as the route
// guard. Caller-supplied role/actor/claim values never supply authority.
const evidenceSql=`WITH authority AS MATERIALIZED (
 SELECT r.user_id FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id
 WHERE r.user_id=$1 AND r.role='administrator' AND r.revoked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id)
), roots AS MATERIALIZED (
 SELECT l.subject_id,l.initial_contribution_id,s.revision,s.lifecycle,c.submitted_at,c.payload,c.user_id
 FROM public.v2_leads l JOIN public.v2_subjects s ON s.id=l.subject_id AND s.kind='lead'
 JOIN public.v2_contributions c ON c.id=l.initial_contribution_id AND c.original_subject_id=l.subject_id
 JOIN public.users author ON author.id=c.user_id
 WHERE l.subject_id=ANY($2::uuid[]) AND l.intake_kind='community' AND NOT l.attribution_erased
 AND EXISTS(SELECT 1 FROM authority)
), claims AS (
 SELECT r.subject_id route_id,r.subject_id,r.initial_contribution_id contribution_id,
 NULL::uuid observation_id,'route.'||side.key field_key,
 jsonb_build_object('id',city.id,'name',city.name,'placeType',city.place_type) value,'{}'::jsonb scope,NULL::text scope_key,
 'unprovided'::text knowledge_basis,r.submitted_at,NULL::date observed_from,NULL::date observed_to,
 NULL::date effective_from,NULL::date effective_to,r.revision subject_revision,
 NULL::bigint observation_revision,NULL::bigint target_revision,CASE WHEN r.lifecycle='active' THEN 'active' ELSE 'unavailable' END status
 FROM roots r CROSS JOIN (VALUES('origin','originCityId'),('destination','destinationCityId')) side(key,path)
 JOIN public.cities city ON city.id=(r.payload#>>ARRAY['target','newLead',side.path])::integer
 UNION ALL
 SELECT r.subject_id,o.original_subject_id,o.contribution_id,o.id,o.field_key,o.value,o.scope,o.scope_key,
 o.knowledge_basis,o.submitted_at,o.observed_from,o.observed_to,o.effective_from,o.effective_to,
 s.revision,os.revision,t.revision,CASE WHEN r.lifecycle='active' AND s.lifecycle='active' AND t.assignment_id IS NULL THEN os.status ELSE 'unavailable' END
 FROM roots r JOIN public.v2_observations o ON
  o.original_subject_id=r.subject_id OR EXISTS(SELECT 1 FROM public.v2_actual_journeys a
   JOIN public.v2_contributions initial ON initial.id=a.initial_contribution_id AND initial.original_subject_id=a.subject_id
   WHERE a.subject_id=o.original_subject_id AND a.intended_subject_id=r.subject_id
   AND a.intended_subject_kind='lead' AND a.matched_run_subject_id IS NULL)
 JOIN public.v2_contributions c ON c.id=o.contribution_id AND c.original_subject_id=o.original_subject_id
 JOIN public.users author ON author.id=c.user_id
 JOIN public.v2_subjects s ON s.id=o.original_subject_id
 JOIN public.v2_observation_states os ON os.observation_id=o.id
 JOIN public.v2_observation_targets t ON t.observation_id=o.id
)
SELECT c.*,current_field.field_decision_id,
 CASE WHEN c.observation_id IS NOT NULL THEN public.v2_read_field(c.subject_id,c.field_key,c.scope_key) END field_read,
 d.assessment_id,d.invalidated,d.erased,d.review_blocked,d.dispute_status,d.next_recheck_at,
 coalesce(core_review.id,resolution.review_id) review_id,resolution.chosen_observation_id,resolution.erased resolution_erased,
 coalesce(core_review.action,review.action) action,coalesce(core_review.evidence_erased,review.evidence_erased,false) evidence_erased,
 coalesce(core_review.actor_erased,review.actor_erased,false) actor_erased,coalesce(core_case.state,review_case.state) case_state,
 coalesce(core_case.revision,review_case.revision,0)::text case_revision,
 core_thread.contribution_id=c.contribution_id core_binding_valid
 FROM claims c
 LEFT JOIN public.v2_current_fields current_field ON current_field.subject_id=c.subject_id
  AND current_field.field_key=c.field_key AND current_field.scope_key=c.scope_key
 LEFT JOIN public.v2_field_decisions d ON d.id=current_field.field_decision_id
 LEFT JOIN public.v2_field_review_threads thread ON thread.subject_id=c.subject_id AND thread.field_key=c.field_key
  AND thread.scope_key=c.scope_key
 LEFT JOIN public.v2_review_cases review_case ON review_case.id=thread.case_id
 LEFT JOIN public.v2_review_decisions review ON review.id=review_case.last_decision_id
 LEFT JOIN public.v2_field_resolutions resolution ON resolution.review_id=review.id
 LEFT JOIN public.v2_admin_core_threads core_thread ON core_thread.route_subject_id=c.route_id
  AND core_thread.field_key=c.field_key AND c.observation_id IS NULL
 LEFT JOIN public.v2_review_cases core_case ON core_case.id=core_thread.case_id
 LEFT JOIN public.v2_review_decisions core_review ON core_review.id=core_case.last_decision_id
 ORDER BY c.route_id,c.field_key,c.submitted_at,c.observation_id NULLS FIRST LIMIT 2001`;

export async function readAdminClaims(actor:string,routeIds:string[]):Promise<{claims:AdminClaim[];routes:string[]}> {
  if(!routeIds.length||routeIds.length>100||new Set(routeIds).size!==routeIds.length||!routeIds.every(validAdminId))
    throw new Error('admin_selection_invalid');
  const {rows}=await pool.query(evidenceSql,[actor,routeIds]);
  if(rows.length>2000)throw new Error('admin_selection_too_large');
  const claims:AdminClaim[]=rows.map(r=>{
    const field=r.field_key,live=r.status==='active',core=field.startsWith('route.');
    const reviewed=r.case_state==='resolved'&&!r.evidence_erased&&!r.resolution_erased&&r.review_id;
    const review=reviewed&&r.action==='accept'&&(core?r.core_binding_valid:r.chosen_observation_id===r.observation_id)?'approved':
      reviewed&&r.action==='reject'?'rejected':'pending';
    // The endpoint adapter reviews the immutable initial contribution. Other
    // claims use the existing field assessment; no synthetic observations.
    const attention=!live?'Evidence is '+r.status:core?null:
      !r.assessment_id?'Awaiting evidence processing':r.invalidated||r.erased?'Assessment changed':
      !['assessed','review_required'].includes(r.field_read?.status)?'Assessment needs refreshing':r.review_blocked?'Review is already open':
      r.dispute_status==='open'?'Conflicting evidence':r.next_recheck_at&&new Date(r.next_recheck_at).getTime()<=Date.now()?'Assessment needs refreshing':null;
    const claim={id:r.observation_id??r.route_id+':'+field,routeId:r.route_id,subjectId:r.subject_id,
      contributionId:r.contribution_id,observationId:r.observation_id,field,label:adminFields[field as AdminField]??field,
      value:r.value,scope:r.scope,basis:r.knowledge_basis,submittedAt:new Date(r.submitted_at).toISOString(),
      observedFrom:date(r.observed_from),observedTo:date(r.observed_to),effectiveFrom:date(r.effective_from),effectiveTo:date(r.effective_to),
      subjectRevision:String(r.subject_revision),observationRevision:r.observation_revision===null?null:String(r.observation_revision),
      targetRevision:r.target_revision===null?null:String(r.target_revision),state:r.status,review,
      reviewId:reviewed?r.review_id:null,assessmentId:r.assessment_id,caseRevision:String(r.case_revision),attention};
    return {...claim,digest:adminDigest(claim)} as AdminClaim;
  });
  return {claims,routes:[...new Set(claims.map(c=>c.routeId))]};
}

export function parseAdminSelection(value:unknown):{routeIds:string[];fields:AdminField[]}|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const input=value as Record<string,unknown>;
  if(Object.keys(input).sort().join(',')!=='fields,routeIds'||!Array.isArray(input.routeIds)||!Array.isArray(input.fields))return null;
  if(!input.routeIds.length||input.routeIds.length>100||!input.routeIds.every(validAdminId)||new Set(input.routeIds).size!==input.routeIds.length)return null;
  if(!input.fields.length||input.fields.length>Object.keys(adminFields).length||input.fields.some(f=>typeof f!=='string'||!Object.hasOwn(adminFields,f))||new Set(input.fields).size!==input.fields.length)return null;
  return {routeIds:input.routeIds,fields:input.fields as AdminField[]};
}
