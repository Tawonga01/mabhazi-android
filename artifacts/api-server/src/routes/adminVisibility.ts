import {Router,type IRouter} from 'express';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {pool} from '@workspace/db';
import {validAdminId} from '../lib/adminEvidence';

// Mounted inside the existing named/account/origin guard. The SQL facade
// rechecks authority, source and revision under the same receipt lock.
const router:IRouter=Router();
type Proof={version:1;actor:string;routeId:string;revision:string;operation:'remove'|'restore';removalId:string|null;issuedAt:number;expiresAt:number};
const reasons={remove:['inaccurate','duplicate','spam','unsafe','other'],restore:['removal_reversed','record_rechecked']};
const domain='mabhazi-admin-visibility/1\0';
function secret(){const value=process.env.ADMIN_SECRET;if(!value||value.length<16)throw Error('admin_signing_unavailable');return value;}
export function createVisibilityPreview(value:Omit<Proof,'version'|'issuedAt'|'expiresAt'>,now=Date.now()){
 const body=Buffer.from(JSON.stringify({...value,version:1,issuedAt:now,expiresAt:now+300000})).toString('base64url');
 return body+'.'+createHmac('sha256',secret()).update(domain+body).digest('base64url');
}
function readPreview(token:unknown,actor:string):Proof|null{
 if(typeof token!=='string'||token.length>4000)return null;
 const [body,sig,...extra]=token.split('.');if(extra.length||!body||!/^[A-Za-z0-9_-]+$/.test(body)||!sig||!/^[A-Za-z0-9_-]{43}$/.test(sig))return null;
 const mac=createHmac('sha256',secret()).update(domain+body).digest(),given=Buffer.from(sig,'base64url');
 if(given.length!==mac.length||!timingSafeEqual(mac,given))return null;
 try{const p=JSON.parse(Buffer.from(body,'base64url').toString()) as Proof;
  if(!p||Object.keys(p).sort().join(',')!=='actor,expiresAt,issuedAt,operation,removalId,revision,routeId,version'||p.version!==1||p.actor!==actor
   ||!validAdminId(p.routeId)||typeof p.revision!=='string'||!/^[1-9][0-9]{0,15}$/.test(p.revision)||BigInt(p.revision)>9007199254740991n
   ||!['remove','restore'].includes(p.operation)||(p.operation==='remove'?p.removalId!==null:!validAdminId(p.removalId))
   ||!Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||p.expiresAt-p.issuedAt!==300000||p.issuedAt>Date.now()+30000)return null;
  return p;
 }catch{return null;}
}
export async function adminVisibilityEnabled(){
 if(process.env.NAMED_ADMIN_CONSOLE_ENABLED!=='true')return false;
 const {rows}=await pool.query(`SELECT CASE WHEN to_regprocedure('public.v2_api_admin_route_action(varchar,uuid,jsonb)') IS NULL THEN false
  ELSE has_function_privilege(current_user,'public.v2_api_admin_route_action(varchar,uuid,jsonb)','EXECUTE') END enabled`);
 return rows[0]?.enabled===true;
}
async function state(actor:string,id:string){
 const {rows}=await pool.query(`SELECT l.subject_id id,s.revision::text revision,s.lifecycle,l.attribution_erased,
  l.initial_contribution_id IS NOT NULL AND author.id IS NOT NULL source_available,
  origin.name origin,destination.name destination,coalesce(l.operator_name,op.display_name) operator,
  lpad((l.reported_departure_seconds/3600)::text,2,'0')||':'||lpad(((l.reported_departure_seconds%3600)/60)::text,2,'0') departure,
  EXISTS(SELECT 1 FROM public.v2_public_lead_reports p WHERE p.subject_id=l.subject_id) public_visible,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'reason',a.reason_code,'createdAt',a.created_at) ORDER BY a.created_at,a.id)
   FROM public.v2_admin_active_route_removals a WHERE a.route_subject_id=l.subject_id),'[]'::jsonb) removals,
  coalesce((SELECT jsonb_agg(x.receipt ORDER BY x.created_at DESC,x.id DESC) FROM
   (SELECT a.id,a.created_at,public.v2_api_admin_route_action_receipt($1,a.id) receipt FROM public.v2_admin_route_actions a
    WHERE a.route_subject_id=l.subject_id ORDER BY a.created_at DESC,a.id DESC LIMIT 20) x),'[]'::jsonb) history,
  (SELECT count(*)::integer FROM public.v2_question_tasks t WHERE t.subject_id=l.subject_id AND t.state='open') open_questions,
  (SELECT count(*)::integer FROM public.v2_actual_journeys a WHERE a.intended_subject_id=l.subject_id) linked_reports
  FROM public.v2_leads l JOIN public.v2_subjects s ON s.id=l.subject_id
  LEFT JOIN public.v2_contributions c ON c.id=l.initial_contribution_id AND c.original_subject_id=l.subject_id
  LEFT JOIN public.users author ON author.id=c.user_id
  LEFT JOIN public.v2_corridors corridor ON corridor.id=l.corridor_id
  LEFT JOIN public.cities origin ON origin.id=corridor.origin_city_id LEFT JOIN public.cities destination ON destination.id=corridor.destination_city_id
  LEFT JOIN public.v2_operators op ON op.subject_id=l.operator_subject_id
  WHERE l.subject_id=$2 AND l.intake_kind='community'
  AND EXISTS(SELECT 1 FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id WHERE r.user_id=$1
   AND r.role='administrator' AND r.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id))`,[actor,id]);
 return rows[0];
}
router.use(async(_req,res,next)=>{
 try{if(!await adminVisibilityEnabled()){res.status(503).json({code:'ADMIN_VISIBILITY_UNAVAILABLE',error:'Route removal and restoration are not available yet.'});return;}next();}
 catch{res.status(503).json({code:'ADMIN_UNAVAILABLE',error:'Route visibility could not be checked.'});}
});
router.get('/receipts/:requestId',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!validAdminId(req.params.requestId)||Object.keys(req.query).length){res.status(400).json({code:'INVALID_REQUEST',error:'Use the saved action reference.'});return;}
 try{const {rows}=await pool.query('SELECT public.v2_api_admin_route_action_receipt($1,$2) receipt',[req.user.id,req.params.requestId]);res.json(rows[0].receipt);}
 catch{res.status(503).json({code:'RECEIPT_UNAVAILABLE',error:'The receipt could not be checked. Keep this action and check again.'});}
});
router.get('/:routeId',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!validAdminId(req.params.routeId)||Object.keys(req.query).length){res.status(400).json({code:'INVALID_RECORD',error:'Choose a route from the catalogue.'});return;}
 try{const row=await state(req.user.id,req.params.routeId);if(!row){res.status(404).json({code:'RECORD_UNAVAILABLE',error:'This route is unavailable.'});return;}res.json(row);}
 catch{res.status(503).json({code:'ADMIN_UNAVAILABLE',error:'Route visibility could not be checked.'});}
});
router.post('/preview',async(req,res)=>{
 if(!req.isAuthenticated())return;const b=req.body as Record<string,unknown>;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['routeId','operation','removalId'].includes(k))
  ||!validAdminId(b.routeId)||!['remove','restore'].includes(String(b.operation))
  ||(b.operation==='restore'?!validAdminId(b.removalId):b.removalId!==undefined&&b.removalId!==null)||Object.keys(req.query).length){
  res.status(422).json({code:'INVALID_VISIBILITY',error:'Choose the route and the exact action.'});return;}
 try{const row=await state(req.user.id,b.routeId);
  if(!row||row.lifecycle!=='active'||row.attribution_erased||!row.source_available
   ||b.operation==='restore'&&!row.removals.some((r:{id:string})=>r.id===b.removalId)){
   res.status(409).json({code:'VISIBILITY_CHANGED',error:'This route or removal changed. Reopen its current state.'});return;}
  const operation=b.operation as 'remove'|'restore';
  res.json({route:row,operation,removalId:b.removalId??null,previewToken:createVisibilityPreview({actor:req.user.id,routeId:row.id,revision:row.revision,operation,removalId:(b.removalId as string)??null})});
 }catch{res.status(503).json({code:'PREVIEW_UNAVAILABLE',error:'The visibility preview could not load. Nothing changed.'});}
});
router.post('/actions',async(req,res)=>{
 if(!req.isAuthenticated())return;const b=req.body as Record<string,unknown>;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='clientRequestId,previewToken,reason'
  ||!validAdminId(b.clientRequestId)||typeof b.reason!=='string'||Object.keys(req.query).length){res.status(422).json({code:'INVALID_ACTION',error:'Review this action and choose a reason.'});return;}
 try{const p=readPreview(b.previewToken,req.user.id);
  if(!p){res.status(409).json({code:'PREVIEW_CHANGED',error:'The visibility preview is invalid. Reopen it.'});return;}
  if(!reasons[p.operation].includes(b.reason)){res.status(422).json({code:'INVALID_REASON',error:'Choose a reason for this action.'});return;}
  const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='15s'");
   const {rows}=await client.query('SELECT public.v2_api_admin_route_action($1,$2,$3) receipt',[req.user.id,b.clientRequestId,
    {routeId:p.routeId,revision:p.revision,operation:p.operation,removalId:p.removalId,reason:b.reason,expiresAt:p.expiresAt}]);
   await client.query('COMMIT');res.json(rows[0].receipt);
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
 }catch(err){const code=(err as Error).message;
  if(code==='v2_admin_required'){res.status(403).json({code:'ADMIN_REQUIRED',error:'Your administrative access changed.'});return;}
  if(code==='v2_admin_request_conflict'){res.status(409).json({code:'IDEMPOTENCY_CONFLICT',error:'This reference belongs to another action. Check its receipt.'});return;}
  if(code==='v2_admin_preview_expired'){res.status(409).json({code:'PREVIEW_EXPIRED',error:'The visibility preview expired. Reopen it before applying.'});return;}
  res.status(503).json({code:'SAVE_UNCONFIRMED',error:'The save could not be confirmed. Check the saved receipt before retrying.'});
 }
});
export default router;
