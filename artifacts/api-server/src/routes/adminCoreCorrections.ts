import {Router,type IRouter} from 'express';
import {pool} from '@workspace/db';
import {validAdminId} from '../lib/adminEvidence';
import {parseCoreProposal,createCorePreview,readCorePreview} from '../lib/adminCore';

// Mounted within the existing named/account/origin/JSON guards. The write
// facade independently rechecks authority/revision/dependencies under its lock.
const router:IRouter=Router();
export async function adminCoreEnabled(){
 if(process.env.NAMED_ADMIN_CONSOLE_ENABLED!=='true'||process.env.NAMED_ADMIN_CORE_CORRECTIONS_ENABLED!=='true')return false;
 const {rows}=await pool.query(`SELECT CASE WHEN to_regprocedure('public.v2_api_admin_core_action(varchar,uuid,jsonb)') IS NULL THEN false
  ELSE has_function_privilege(current_user,'public.v2_api_admin_core_action(varchar,uuid,jsonb)','EXECUTE') END enabled`);
 return rows[0]?.enabled===true;
}
async function state(actor:string,id:string){
 const {rows}=await pool.query(`WITH root AS MATERIALIZED(
  SELECT l.*,s.revision,s.lifecycle,c.payload FROM public.v2_leads l JOIN public.v2_subjects s ON s.id=l.subject_id
  JOIN public.v2_contributions c ON c.id=l.initial_contribution_id AND c.original_subject_id=l.subject_id
  JOIN public.users author ON author.id=c.user_id
  WHERE l.subject_id=$2 AND l.intake_kind='community' AND NOT l.attribution_erased
  AND EXISTS(SELECT 1 FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id WHERE r.user_id=$1
   AND r.role='administrator' AND r.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id))
 ), original AS (
 SELECT r.*,jsonb_build_object('route.origin',jsonb_build_object('cityId',co.origin_city_id),
  'route.destination',jsonb_build_object('cityId',co.destination_city_id),
  'operator.reported',jsonb_build_object('name',coalesce(r.operator_name,op.display_name)),
  'departure.reported',(SELECT o.value FROM public.v2_observations o WHERE o.contribution_id=r.initial_contribution_id AND o.field_key='departure.reported')) fields
 FROM root r LEFT JOIN public.v2_corridors co ON co.id=r.corridor_id LEFT JOIN public.v2_operators op ON op.subject_id=r.operator_subject_id
 ) SELECT subject_id id,revision::text revision,lifecycle,fields original,
  fields||coalesce((SELECT jsonb_object_agg(a.field_key,a.proposed_value) FROM public.v2_admin_current_core a WHERE a.route_subject_id=r.subject_id),'{}'::jsonb) current,
  (SELECT count(*) FROM public.v2_actual_journeys a WHERE a.intended_subject_id=r.subject_id)
   +(SELECT count(*) FROM public.v2_observations o WHERE o.original_subject_id=r.subject_id AND (o.contribution_id IS DISTINCT FROM r.initial_contribution_id
    OR o.field_key NOT IN('operator.reported','departure.reported')))
   +(CASE WHEN r.operator_subject_id IS NULL THEN 0 ELSE 1 END)
   +(SELECT count(*) FROM public.v2_association_links a WHERE a.from_subject_id=r.subject_id OR a.to_subject_id=r.subject_id)
   +(SELECT count(*) FROM public.v2_observation_targets t JOIN public.v2_observations o ON o.id=t.observation_id WHERE o.original_subject_id=r.subject_id AND t.assignment_id IS NOT NULL) dependencies,
  coalesce((SELECT jsonb_agg(x.receipt ORDER BY x.position DESC) FROM (SELECT a.position,public.v2_api_admin_core_receipt($1,a.id) receipt
   FROM public.v2_admin_core_actions a WHERE a.route_subject_id=r.subject_id ORDER BY a.position DESC LIMIT 20) x),'[]'::jsonb) history,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name,c.id) FROM public.cities c
   WHERE c.id IN((r.fields->'route.origin'->>'cityId')::integer,(r.fields->'route.destination'->>'cityId')::integer)
    OR c.id IN(SELECT (a.proposed_value->>'cityId')::integer FROM public.v2_admin_current_core a WHERE a.route_subject_id=r.subject_id AND a.field_key IN('route.origin','route.destination'))),'[]'::jsonb) cities
 FROM original r`,[actor,id]);return rows[0];
}
router.use(async(_req,res,next)=>{try{if(!await adminCoreEnabled()){res.status(503).json({code:'CORE_CORRECTIONS_UNAVAILABLE',error:'Route corrections are not available yet.'});return;}next();}
 catch{res.status(503).json({code:'ADMIN_UNAVAILABLE',error:'Route corrections could not be checked.'});}});
router.get('/receipts/:requestId',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!validAdminId(req.params.requestId)||Object.keys(req.query).length){res.status(400).json({code:'INVALID_REQUEST',error:'Use the saved action reference.'});return;}
 try{const {rows}=await pool.query('SELECT public.v2_api_admin_core_receipt($1,$2) receipt',[req.user.id,req.params.requestId]);res.json(rows[0].receipt);}
 catch{res.status(503).json({code:'RECEIPT_UNAVAILABLE',error:'Keep the saved action and check its receipt again.'});}
});
router.get('/cities',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(Object.keys(req.query).some(k=>k!=='q')||typeof req.query.q!=='string'||req.query.q.trim().length<1||req.query.q.length>120){res.status(400).json({code:'INVALID_QUERY',error:'Type a city name.'});return;}
 try{const {rows}=await pool.query(`SELECT c.id,c.name FROM public.cities c WHERE strpos(lower(c.name),lower($1))>0
  AND EXISTS(SELECT 1 FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id WHERE r.user_id=$2 AND r.role='administrator'
   AND r.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id)) ORDER BY c.name,c.id LIMIT 30`,[req.query.q.trim(),req.user.id]);res.json({cities:rows});}
 catch{res.status(503).json({code:'CITIES_UNAVAILABLE',error:'City choices could not load.'});}
});
router.get('/:routeId',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!validAdminId(req.params.routeId)||Object.keys(req.query).length){res.status(400).json({code:'INVALID_RECORD',error:'Choose a route from the catalogue.'});return;}
 try{const row=await state(req.user.id,req.params.routeId);if(!row){res.status(404).json({code:'RECORD_UNAVAILABLE',error:'This route is unavailable.'});return;}res.json(row);}
 catch{res.status(503).json({code:'ADMIN_UNAVAILABLE',error:'Route corrections could not load.'});}
});
router.post('/preview',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const proposal=parseCoreProposal(req.body);
 if(!proposal||Object.keys(req.query).length){res.status(422).json({code:'INVALID_CORRECTION',error:'Check the property, source and reason.'});return;}
 try{const row=await state(req.user.id,proposal.routeId);
  if(!row||row.lifecycle!=='active'){res.status(409).json({code:'CORE_CHANGED',error:'This route is unavailable. Your proposal has not been applied.'});return;}
  if(Number(row.dependencies)>0){res.status(409).json({code:'IDENTITY_REVIEW_REQUIRED',error:'This route has linked evidence. Correcting its identity needs a separate review; your proposal stays saved.'});return;}
  if(proposal.operation==='correct'&&proposal.field.startsWith('route.')){
   const id=proposal.value!.cityId;
   const cities=await pool.query('SELECT id,name FROM public.cities WHERE id=$1',[id]);
   if(!cities.rows.length){res.status(422).json({code:'CITY_UNAVAILABLE',error:'Choose a registered city again.'});return;}
   if(row.current[proposal.field==='route.origin'?'route.destination':'route.origin']?.cityId===id){res.status(422).json({code:'SAME_CITY',error:'Departure and destination must be different.'});return;}
   row.cities=[...row.cities.filter((c:{id:number})=>c.id!==id),...cities.rows];
  }
  if(proposal.operation==='reverse'&&!row.history.some((a:{id:string;field:string;outcome:string})=>a.id===proposal.reversedActionId&&a.field===proposal.field&&a.outcome==='corrected')){
   res.status(409).json({code:'CORRECTION_CHANGED',error:'Reopen that correction from the route history.'});return;
  }
  res.json({route:row,proposal,previewToken:createCorePreview(proposal,req.user.id,row.revision,process.env.ADMIN_SECRET??''),
   effect:'Only this property changes. Original reports remain saved. Linked evidence is not reassigned.'});
 }catch{res.status(503).json({code:'PREVIEW_UNAVAILABLE',error:'The correction preview could not load. Your proposal has not been applied.'});}
});
router.post('/actions',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const b=req.body as Record<string,unknown>;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='clientRequestId,previewToken'
  ||!validAdminId(b.clientRequestId)||Object.keys(req.query).length){res.status(422).json({code:'INVALID_ACTION',error:'Review the correction first.'});return;}
 try{const p=readCorePreview(b.previewToken,req.user.id,process.env.ADMIN_SECRET??'');
  if(!p){res.status(409).json({code:'PREVIEW_CHANGED',error:'Reopen this correction preview.'});return;}
  const {version,actor,issuedAt,...input}=p;void version;void actor;void issuedAt;
  const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='15s'");
   const {rows}=await client.query('SELECT public.v2_api_admin_core_action($1,$2,$3) receipt',[req.user.id,b.clientRequestId,input]);
   await client.query('COMMIT');res.json(rows[0].receipt);
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
 }catch(err){const message=(err as Error).message;
  if(message==='v2_admin_required'){res.status(403).json({code:'ADMIN_REQUIRED',error:'Your administrative access changed.'});return;}
  if(message==='v2_admin_request_conflict'){res.status(409).json({code:'IDEMPOTENCY_CONFLICT',error:'This reference belongs to another action. Check its receipt.'});return;}
  if(message==='v2_admin_preview_expired'){res.status(409).json({code:'PREVIEW_EXPIRED',error:'Refresh this correction preview before applying.'});return;}
  if(['v2_admin_city_unavailable','v2_admin_same_city','v2_admin_core_invalid'].includes(message)){res.status(422).json({code:'INVALID_CORRECTION',error:'Check the city, clock, source and reason.'});return;}
  res.status(503).json({code:'SAVE_UNCONFIRMED',error:'The save could not be confirmed. Check its receipt before retrying.'});
 }
});
export default router;
