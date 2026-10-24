import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { SearchV2RoutesQueryParams, SearchV2RoutesResponse, GetV2SubjectParams, GetV2SubjectResponse } from '@workspace/api-zod';

const router: IRouter = Router();
// This is the original, unselected report projection. Neither receipts nor
// legacy journeys supply public identity or authority to write to this target.
const eligible = `FROM public.v2_leads l
 JOIN public.v2_subjects s ON s.id=l.subject_id AND s.kind='lead' AND s.lifecycle='active'
 JOIN public.v2_contributions c ON c.id=l.initial_contribution_id AND c.original_subject_id=l.subject_id
 JOIN public.users author ON author.id=c.user_id
 JOIN public.v2_corridors corridor ON corridor.id=l.corridor_id
 JOIN public.cities origin ON origin.id=corridor.origin_city_id
 JOIN public.cities destination ON destination.id=corridor.destination_city_id
 JOIN public.v2_observations op ON op.contribution_id=c.id AND op.original_subject_id=l.subject_id AND op.field_key='operator.reported'
 JOIN public.v2_observation_states op_state ON op_state.observation_id=op.id AND op_state.status='active'
 JOIN public.v2_observation_targets op_target ON op_target.observation_id=op.id AND op_target.assignment_id IS NULL
 JOIN public.v2_observations clock ON clock.contribution_id=c.id AND clock.original_subject_id=l.subject_id AND clock.field_key='departure.reported'
 JOIN public.v2_observation_states clock_state ON clock_state.observation_id=clock.id AND clock_state.status='active'
 JOIN public.v2_observation_targets clock_target ON clock_target.observation_id=clock.id AND clock_target.assignment_id IS NULL
 LEFT JOIN public.v2_operators operator ON operator.subject_id=l.operator_subject_id
 LEFT JOIN public.v2_subjects operator_subject ON operator_subject.id=operator.subject_id
 WHERE l.intake_kind='community' AND NOT l.attribution_erased
 AND (l.operator_subject_id IS NULL OR operator_subject.lifecycle='active')
 AND op.scope='{}'::jsonb AND clock.scope='{}'::jsonb
 AND op.value=CASE WHEN l.operator_name IS NOT NULL THEN jsonb_build_object('name',l.operator_name) ELSE jsonb_build_object('id',l.operator_subject_id) END
 AND l.reported_departure_seconds%60=0
 AND clock.value->>'time'=lpad((l.reported_departure_seconds/3600)::text,2,'0')||':'||lpad(((l.reported_departure_seconds%3600)/60)::text,2,'0')
 AND NOT EXISTS(SELECT 1 FROM public.v2_observations extra WHERE extra.contribution_id=c.id AND extra.field_key IN ('operator.reported','departure.reported') AND extra.id NOT IN(op.id,clock.id))
 AND NOT EXISTS(SELECT 1 FROM public.v2_current_fields current_field JOIN public.v2_field_decisions decision ON decision.id=current_field.field_decision_id
   WHERE current_field.subject_id=l.subject_id AND current_field.field_key IN('operator.reported','departure.reported')
   AND (decision.invalidated OR decision.erased OR decision.review_blocked OR decision.publication='withheld' OR decision.dispute_status='open'
     OR decision.selected_value IS DISTINCT FROM CASE current_field.field_key WHEN 'operator.reported' THEN op.value ELSE clock.value END))`;
const columns = `SELECT l.subject_id AS "subjectId",s.revision,
 jsonb_build_object('id',origin.id,'name',origin.name,'placeType',origin.place_type) AS origin,
 jsonb_build_object('id',destination.id,'name',destination.name,'placeType',destination.place_type) AS destination,
 jsonb_build_object('value',COALESCE(op.value->>'name',operator.display_name),'support','reported','freshness','unknown','submittedAt',op.submitted_at,
   'observedDate',op.observed_from) AS "operatorReport",
 jsonb_build_object('value',clock.value->>'time','basis',clock.value->>'basis','support','reported','freshness','unknown','submittedAt',clock.submitted_at,
   'observedDate',clock.observed_from) AS "reportedTime" `;
const safeProjection = (row: Record<string, unknown>) => ({...row, revision:Number(row.revision), kind:'lead', publicationStatus:'details_needed',
 timedDepartureEligible:false, contributionTargetEligible:false,
 missingDetails:['selected_fare','operating_days','boarding_location'] });
router.use((req,res,next) => {
 if(req.path!=='/search'&&!req.path.startsWith('/subjects/')){next();return;}
 res.setHeader('Cache-Control','no-store');res.vary('X-Mabhazi-Blocked-Contributors');
 if(process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED!=='true') {res.status(503).json({code:'CAPABILITY_UNAVAILABLE',error:'Route discovery is not available yet.'});return;}
 const raw=req.get('X-Mabhazi-Blocked-Contributors');
 try {
  const ids:unknown=raw===undefined?[]:JSON.parse(raw);
  if(raw && Buffer.byteLength(raw)>10000 || !Array.isArray(ids) || ids.length>200 || ids.some(id=>typeof id!=='string'||!id.trim()||id.length>200||/[\u0000-\u001f\u007f-\u009f]/.test(id))) throw Error('Invalid safety context');
  res.locals.blockedIds=[...new Set(ids)];next();
 } catch {res.status(400).json({code:'INVALID_SAFETY_CONTEXT',error:'Your hidden contributor settings could not be checked.'});}
});
router.get('/search',async(req,res)=>{
 const parsed=SearchV2RoutesQueryParams.strict().safeParse(req.query);
 if(!parsed.success || ['originCityId','destinationCityId','cursor'].some(key=>req.query[key]!==undefined&&typeof req.query[key]!=='string') ||
  !Number.isInteger(parsed.data.originCityId)||!Number.isInteger(parsed.data.destinationCityId)||parsed.data.originCityId===parsed.data.destinationCityId) {
  res.status(400).json({code:'INVALID_QUERY',error:'Choose different departure and destination cities.'});return;
 }
 const {originCityId,destinationCityId,cursor}=parsed.data;
 const values:unknown[]=[originCityId,destinationCityId,res.locals.blockedIds];
 const corridor=' AND corridor.origin_city_id=$1 AND corridor.destination_city_id=$2';
 const allowed=' AND NOT(c.user_id=ANY($3::varchar[]))';
 try {
  const cities=await pool.query('SELECT id FROM public.cities WHERE id=ANY($1::integer[])',[[originCityId,destinationCityId]]);
  if(cities.rows.length!==2){res.status(422).json({code:'CITY_UNAVAILABLE',error:'Choose the cities again.'});return;}
  if(cursor){
   const anchor=await pool.query('SELECT 1 '+eligible+corridor+allowed+' AND l.subject_id=$4',[...values,cursor]);
   if(!anchor.rows.length){res.status(400).json({code:'INVALID_CURSOR',error:'The results changed. Refresh your search.'});return;}
   values.push(cursor);
  }
  const result=await pool.query(columns+eligible+corridor+allowed+(cursor?' AND l.subject_id>$4::uuid':'')+' ORDER BY l.subject_id LIMIT 21',values);
  const hidden=await pool.query('SELECT EXISTS(SELECT 1 '+eligible+corridor+' AND c.user_id=ANY($3::varchar[])) hidden',values.slice(0,3));
  const page=result.rows.slice(0,20);
  res.json(SearchV2RoutesResponse.parse({items:page.map(safeProjection),hasHiddenResults:hidden.rows[0]?.hidden===true,
   ...(result.rows.length>20?{nextCursor:page[page.length-1].subjectId}:{})}));
 }catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'Route results could not be loaded. Try again.'});}
});
router.get('/subjects/:subjectId',async(req,res)=>{
 const parsed=GetV2SubjectParams.safeParse(req.params);
 if(!parsed.success||Object.keys(req.query).length){res.status(400).json({code:'INVALID_SUBJECT',error:'Reopen this route from Search.'});return;}
 try{
  const result=await pool.query(columns+eligible+' AND l.subject_id=$1 AND NOT(c.user_id=ANY($2::varchar[]))',[parsed.data.subjectId,res.locals.blockedIds]);
  if(!result.rows[0]){res.status(404).json({code:'SUBJECT_UNAVAILABLE',error:'This route is unavailable.'});return;}
  res.json(GetV2SubjectResponse.parse({subject:safeProjection(result.rows[0])}));
 }catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'This route could not be checked. Try again.'});}
});
export default router;
