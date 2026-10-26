import {Router,type IRouter} from 'express';
import {pool} from '@workspace/db';
import {ListV2PlaceReportsParams,ListV2PlaceReportsQueryParams,ListV2PlaceReportsResponse,ListV2OwnPlaceReportsParams,PlaceV2SafetyBody,PlaceV2SafetyParams} from '@workspace/api-zod';
import {parseBlockedIds} from './routeSafetyV2';
import {isAllowedOrigin} from '../lib/origins';
const router:IRouter=Router();
export async function placeReportsEnabled(){
 if(process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED!=='true')return false;
 const {rows}=await pool.query(`SELECT CASE WHEN to_regclass('public.v2_place_report_context') IS NULL
  OR to_regprocedure('public.v2_api_place_report_action(varchar,uuid,uuid,text,text,varchar[])') IS NULL THEN false
  ELSE has_table_privilege(current_user,'public.v2_place_report_context','SELECT') AND has_function_privilege(current_user,'public.v2_api_place_report_action(varchar,uuid,uuid,text,text,varchar[])','EXECUTE') END enabled`);
 return rows[0]?.enabled===true;
}
router.use((req,res,next)=>{
 if(!/^\/(subjects\/[^/]+\/places(?:\/[^/]+\/safety)?|my-routes\/[^/]+\/places)$/.test(req.path)){next();return;}
 res.setHeader('Cache-Control','no-store');for(const name of ['Authorization','Cookie','X-Mabhazi-Account','X-Mabhazi-Blocked-Contributors'])res.vary(name);
 const expected=req.get('X-Mabhazi-Account');
 if(expected!==undefined&&(!req.isAuthenticated()||expected!==req.user.id)){res.status(req.isAuthenticated()?409:401).json({code:req.isAuthenticated()?'ACCOUNT_CHANGED':'AUTH_REQUIRED',error:'Reopen locations with your current account.'});return;}
 const blocked=parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'));
 if(!blocked){res.status(400).json({code:'INVALID_SAFETY_CONTEXT',error:'Your hidden contributor settings could not be checked.'});return;}
 res.locals.placeBlocked=blocked;next();
});
const membership=`c.evidence_included AND c.field_read->>'status' IN('assessed','review_required') AND candidate->'value'=c.original_value`;
for(const own of [false,true])router.get(own?'/my-routes/:clientSubmissionId/places':'/subjects/:subjectId/places',async(req,res)=>{
 if(own&&(!req.isAuthenticated()||req.get('X-Mabhazi-Account')!==req.user.id)){res.status(req.isAuthenticated()?409:401).json({code:req.isAuthenticated()?'ACCOUNT_CHANGED':'AUTH_REQUIRED',error:'Sign in to see your saved locations.'});return;}
 const params=own?ListV2OwnPlaceReportsParams.safeParse(req.params):ListV2PlaceReportsParams.safeParse(req.params),query=ListV2PlaceReportsQueryParams.strict().safeParse(req.query);
 if(!params.success||!query.success||req.query.cursor!==undefined&&typeof req.query.cursor!=='string'){res.status(400).json({code:'INVALID_QUERY',error:'Reopen locations from this route.'});return;}
 const root=own?`SELECT l.subject_id FROM public.v2_receipts r JOIN public.v2_contributions initial ON initial.id=r.contribution_id AND initial.user_id=r.user_id AND initial.client_submission_id=r.client_submission_id
  JOIN public.v2_leads l ON l.initial_contribution_id=initial.id AND l.subject_id=initial.original_subject_id JOIN public.v2_subjects s ON s.id=l.subject_id AND s.lifecycle='active'
  WHERE r.user_id=$3 AND r.client_submission_id=$1 AND l.intake_kind='community' AND NOT l.attribution_erased
   AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=$3)`:
 `SELECT p.subject_id FROM public.v2_public_lead_reports p WHERE p.subject_id=$1 AND NOT(p.author_user_id=ANY($2::varchar[])) AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=p.author_user_id)`;
 try{
  if(!await placeReportsEnabled()){res.status(503).json({code:'CAPABILITY_UNAVAILABLE',error:'Location reports are not available yet.'});return;}
  const {rows}=await pool.query(`WITH root AS MATERIALIZED(${root}),contexts AS MATERIALIZED(SELECT c.* FROM public.v2_place_report_context c JOIN root r ON r.subject_id=c.route_subject_id ${own?'WHERE c.place_author_id=$3':''}),
   visible AS MATERIALIZED(SELECT * FROM contexts c WHERE ${own?'true':`NOT(c.place_author_id=ANY($2::varchar[])) AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=c.place_author_id)`}),
   latest AS MATERIALIZED(SELECT DISTINCT ON(place_author_id,field_key) * FROM visible ORDER BY place_author_id,field_key,submitted_at DESC,place_ref DESC),
   eligible AS MATERIALIZED(SELECT c.*,candidate FROM latest c CROSS JOIN LATERAL jsonb_array_elements(${own?`jsonb_build_array(jsonb_build_object('value',c.original_value))`:`COALESCE(c.field_read->'candidates','[]'::jsonb)`}) candidate WHERE NOT c.is_hidden ${own?'':`AND ${membership}`}),
   page AS(SELECT * FROM eligible WHERE $4::uuid IS NULL OR place_ref>$4 ORDER BY place_ref LIMIT 21)
   SELECT (SELECT subject_id FROM root LIMIT 1) subject_id,($4::uuid IS NULL OR EXISTS(SELECT 1 FROM eligible WHERE place_ref=$4)) cursor_valid,
    EXISTS(SELECT 1 FROM contexts c WHERE NOT $5 AND (c.place_author_id=ANY($2::varchar[]) OR EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=c.place_author_id))) hidden,
    EXISTS(SELECT 1 FROM latest c WHERE NOT $5 AND NOT c.is_hidden AND (c.field_read->>'status'='recheck_required' OR (jsonb_array_length(COALESCE(c.field_read->'candidates','[]'::jsonb))=0 AND (c.field_read->>'nextRecheckAt')::timestamptz>statement_timestamp()))) pending,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',place_ref,'kind',CASE field_key WHEN 'boarding.pickup' THEN 'pickup' ELSE 'dropoff' END,
     'city',city,'name',original_value->>'name','instructions',original_value->>'instructions','basis',knowledge_basis,'observedDate',observed_from,'receivedAt',submitted_at,
     'status',CASE WHEN $5 THEN 'saved' WHEN field_read->>'status'='review_required' OR field_read->>'dispute'='open' THEN 'needs_review' ELSE 'reported' END,
     'freshness',CASE WHEN $5 THEN 'unknown' ELSE candidate->>'freshness' END,'canBlock',NOT $5 AND $3::varchar IS NOT NULL AND $3<>place_author_id) ORDER BY place_ref) FROM page),'[]'::jsonb) items`,
   [own?(params.data as {clientSubmissionId:string}).clientSubmissionId:(params.data as {subjectId:string}).subjectId,res.locals.placeBlocked,req.isAuthenticated()?req.user.id:null,query.data.cursor??null,own]);
  const value=rows[0];if(!value?.subject_id){res.status(404).json({code:'SUBJECT_UNAVAILABLE',error:'This route is unavailable.'});return;}
  if(!value.cursor_valid){res.status(400).json({code:'INVALID_CURSOR',error:'Location reports changed. Refresh this route.'});return;}
  const items=(value.items as Record<string,unknown>[]).slice(0,20);
  res.json(ListV2PlaceReportsResponse.parse({subjectId:value.subject_id,items,hasPendingReports:value.pending,hasHiddenResults:value.hidden,...((value.items as unknown[]).length>20?{nextCursor:items.at(-1)?.id}:{})}));
 }catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'Location reports could not load. Try again.'});}
});
router.post('/subjects/:subjectId/places/:placeId/safety',async(req,res)=>{
 if(!req.isAuthenticated()){res.status(401).json({code:'AUTH_REQUIRED',error:'Sign in to report or hide a location.'});return;}
 if(req.get('X-Mabhazi-Account')!==req.user.id){res.status(409).json({code:'ACCOUNT_CHANGED',error:'The active account changed. Reopen this route.'});return;}
 if(Object.keys(req.query).length){res.status(400).json({code:'INVALID_QUERY',error:'Reopen this safety control.'});return;}
 if(!req.is('application/json')){res.status(415).json({code:'JSON_REQUIRED',error:'Submit safety actions as JSON.'});return;}
 if(req.headers.origin&&!isAllowedOrigin(req.headers.origin)||!req.headers.authorization?.startsWith('Bearer ')&&!req.headers.origin){res.status(403).json({code:'ORIGIN_REJECTED',error:'The sign-in origin is not allowed.'});return;}
 const params=PlaceV2SafetyParams.safeParse(req.params),body=PlaceV2SafetyBody.strict().safeParse(req.body);
 if(!params.success||!body.success||body.data.action==='report'&&!body.data.reason||body.data.action==='block'&&body.data.reason){res.status(422).json({code:'INVALID_SAFETY_ACTION',error:'Choose a valid action and reason.'});return;}
 try{if(!await placeReportsEnabled()){res.status(503).json({code:'CAPABILITY_UNAVAILABLE',error:'Location safety is not available yet.'});return;}
  const {rows}=await pool.query('SELECT public.v2_api_place_report_action($1,$2,$3,$4,$5,$6) result',[req.user.id,params.data.subjectId,params.data.placeId,body.data.action,body.data.reason??null,res.locals.placeBlocked]);res.json(rows[0].result);
 }catch(error){const message=(error as Error).message;
  if(message==='v2_place_target_unavailable'){res.status(404).json({code:'TARGET_NOT_FOUND',error:'This location report changed or is unavailable.'});return;}
  if(['v2_self_block_invalid','v2_block_limit'].includes(message)){res.status(422).json({code:'BLOCK_UNAVAILABLE',error:message==='v2_self_block_invalid'?'Your own reports cannot be blocked.':'Unblock a contributor before hiding another.'});return;}
  res.status(503).json({code:'SAVE_UNCONFIRMED',error:'The safety action could not be confirmed. Try again.'});
 }
});
export default router;
