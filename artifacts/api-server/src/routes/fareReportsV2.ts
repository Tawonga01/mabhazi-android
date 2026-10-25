import { Router,type IRouter } from 'express';
import { pool } from '@workspace/db';
import { ListV2FareReportsParams,ListV2FareReportsQueryParams,ListV2FareReportsResponse,FareV2SafetyBody,FareV2SafetyParams } from '@workspace/api-zod';
import { parseBlockedIds } from './routeSafetyV2';
import { isAllowedOrigin } from '../lib/origins';
const router:IRouter=Router();
export async function fareReportsEnabled(){
 if(process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED!=='true')return false;
 const result=await pool.query(`SELECT CASE WHEN to_regclass('public.v2_fare_report_context') IS NULL THEN false
  ELSE has_table_privilege(current_user,'public.v2_fare_report_context','SELECT') AND has_function_privilege(current_user,'public.v2_read_field(uuid,text,text)','EXECUTE') END enabled`);
 return result.rows[0]?.enabled===true;
}
router.use((req,res,next)=>{
 if(!/^\/subjects\/[^/]+\/fares(?:\/[^/]+\/safety)?$/.test(req.path)){next();return;}
 res.setHeader('Cache-Control','no-store');res.vary('X-Mabhazi-Blocked-Contributors');res.vary('Authorization');res.vary('Cookie');res.vary('X-Mabhazi-Account');
 const expected=req.get('X-Mabhazi-Account');
 if(expected!==undefined&&(!req.isAuthenticated()||expected!==req.user.id)){res.status(req.isAuthenticated()?409:401).json({code:req.isAuthenticated()?'ACCOUNT_CHANGED':'AUTH_REQUIRED',error:'Reopen this route with your current account.'});return;}
 const blocked=parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'));
 if(!blocked){res.status(400).json({code:'INVALID_SAFETY_CONTEXT',error:'Your hidden contributor settings could not be checked.'});return;}
 res.locals.fareBlocked=blocked;next();
});
// The reader is authoritative for time/policy/generation validity. An amount
// also needs membership in that exact decision, not merely an equal value.
const candidateMatch=`c.evidence_included AND c.field_read->>'status' IN('assessed','review_required')
 AND candidate->'value'=jsonb_set(c.original_value,'{amount}',to_jsonb(trim_scale((c.original_value->>'amount')::numeric)::text))`;
const scopeKeys=['schemaVersion','segment','serviceDate','quotationDate','sourceDate','effectiveFrom','effectiveTo','passengerCategory','passengerLabel','ticketBasis','ticketLabel','paymentMethod','luggageIncluded','timeBasis'];
function safeScope(raw:Record<string,unknown>){return Object.fromEntries(scopeKeys.filter(key=>raw[key]!==null&&raw[key]!==undefined).map(key=>[key,raw[key]]));}
router.get('/subjects/:subjectId/fares',async(req,res)=>{
 const params=ListV2FareReportsParams.safeParse(req.params),query=ListV2FareReportsQueryParams.strict().safeParse(req.query);
 if(!params.success||!query.success||req.query.cursor!==undefined&&typeof req.query.cursor!=='string'){res.status(400).json({code:'INVALID_QUERY',error:'Reopen fare reports from this route.'});return;}
 try{
  if(!await fareReportsEnabled()){res.status(503).json({code:'CAPABILITY_UNAVAILABLE',error:'Fare reports are not available yet.'});return;}
  const result=await pool.query(`WITH root AS MATERIALIZED(SELECT * FROM public.v2_public_lead_reports p WHERE p.subject_id=$1
   AND NOT(p.author_user_id=ANY($2::varchar[])) AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=p.author_user_id)),
  contexts AS MATERIALIZED(SELECT c.* FROM public.v2_fare_report_context c JOIN root ON root.subject_id=c.route_subject_id),
  visible AS MATERIALIZED(SELECT c.* FROM contexts c WHERE NOT(c.fare_author_id=ANY($2::varchar[]))
   AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=c.fare_author_id)),
  eligible AS(SELECT c.*,candidate FROM visible c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.field_read->'candidates','[]'::jsonb)) candidate WHERE ${candidateMatch}),
  latest AS MATERIALIZED(SELECT DISTINCT ON(fare_author_id,field_key,scope_key,scope,original_value->>'currency') * FROM eligible
   ORDER BY fare_author_id,field_key,scope_key,scope,original_value->>'currency',submitted_at DESC,fare_ref DESC),
  page AS(SELECT * FROM latest WHERE $4::uuid IS NULL OR fare_ref>$4 ORDER BY fare_ref LIMIT 21)
  SELECT EXISTS(SELECT 1 FROM root) available,($4::uuid IS NULL OR EXISTS(SELECT 1 FROM latest WHERE fare_ref=$4)) cursor_valid,
   EXISTS(SELECT 1 FROM contexts c WHERE c.fare_author_id=ANY($2::varchar[]) OR EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=c.fare_author_id)) hidden,
   EXISTS(SELECT 1 FROM visible c WHERE c.field_read->>'status'='recheck_required' OR (jsonb_array_length(COALESCE(c.field_read->'candidates','[]'::jsonb))=0 AND (c.field_read->>'nextRecheckAt')::timestamptz>statement_timestamp())) pending,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',fare_ref,'kind',split_part(field_key,'.',2),'amount',candidate->'value'->>'amount','currency',candidate->'value'->>'currency',
    'scope',scope,'basis',knowledge_basis,'observedDate',observed_from,'receivedAt',submitted_at,'oldestEvidenceDate',candidate->>'oldestDate','newestEvidenceDate',candidate->>'newestDate',
    'status',CASE WHEN field_read->>'status'='review_required' OR field_read->>'dispute'='open' THEN 'needs_review' ELSE 'reported' END,
    'freshness',candidate->>'freshness','temporalClass',candidate->>'temporalClass','canBlock',$3::varchar IS NOT NULL AND $3<>fare_author_id) ORDER BY fare_ref) FROM page),'[]'::jsonb) items`,
   [params.data.subjectId,res.locals.fareBlocked,req.isAuthenticated()?req.user.id:null,query.data.cursor??null]);
  const value=result.rows[0];if(!value?.available){res.status(404).json({code:'SUBJECT_UNAVAILABLE',error:'This route is unavailable.'});return;}
  if(!value.cursor_valid){res.status(400).json({code:'INVALID_CURSOR',error:'Fare reports changed. Refresh this route.'});return;}
  const items=(value.items as Record<string,unknown>[]).slice(0,20).map(item=>({...item,id:item.id,scope:safeScope(item.scope as Record<string,unknown>)}));
  res.json(ListV2FareReportsResponse.parse({subjectId:params.data.subjectId,items,hasPendingReports:value.pending,hasHiddenResults:value.hidden,
   ...((value.items as unknown[]).length>20?{nextCursor:items.at(-1)?.id}:{})}));
 }catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'Fare reports could not load. Try again.'});}
});
router.post('/subjects/:subjectId/fares/:fareId/safety',async(req,res)=>{
 if(!req.isAuthenticated()){res.status(401).json({code:'AUTH_REQUIRED',error:'Sign in to report or hide a fare.'});return;}
 if(req.get('X-Mabhazi-Account')!==req.user.id){res.status(409).json({code:'ACCOUNT_CHANGED',error:'The active account changed. Reopen this route.'});return;}
 if(Object.keys(req.query).length){res.status(400).json({code:'INVALID_QUERY',error:'Reopen this safety control.'});return;}
 if(!req.is('application/json')){res.status(415).json({code:'JSON_REQUIRED',error:'Submit safety actions as JSON.'});return;}
 if(req.headers.origin&&!isAllowedOrigin(req.headers.origin)||!req.headers.authorization?.startsWith('Bearer ')&&!req.headers.origin){res.status(403).json({code:'ORIGIN_REJECTED',error:'The sign-in origin is not allowed.'});return;}
 const params=FareV2SafetyParams.safeParse(req.params),body=FareV2SafetyBody.strict().safeParse(req.body);
 if(!params.success||!body.success||body.data.action==='report'&&!body.data.reason||body.data.action==='block'&&body.data.reason){res.status(422).json({code:'INVALID_SAFETY_ACTION',error:'Choose a valid action and reason.'});return;}
 try{if(!await fareReportsEnabled()){res.status(503).json({code:'CAPABILITY_UNAVAILABLE',error:'Fare safety is not available yet.'});return;}
  const result=await pool.query('SELECT public.v2_api_fare_report_action($1,$2,$3,$4,$5,$6) result',[req.user.id,params.data.subjectId,params.data.fareId,body.data.action,body.data.reason??null,res.locals.fareBlocked]);res.json(result.rows[0].result);
 }catch(error){const message=(error as Error).message;if(message==='v2_fare_target_unavailable'){res.status(404).json({code:'TARGET_NOT_FOUND',error:'This fare report changed or is unavailable.'});return;}
  if(['v2_self_block_invalid','v2_block_limit'].includes(message)){res.status(422).json({code:'BLOCK_UNAVAILABLE',error:message==='v2_self_block_invalid'?'Your own reports cannot be blocked.':'Unblock a contributor before hiding another.'});return;}
  res.status(503).json({code:'SAVE_UNCONFIRMED',error:'The safety action could not be confirmed. Try again.'});}
});
export default router;
