import {Router,type IRouter} from 'express';
import {pool} from '@workspace/db';
import {getOrigin} from '../lib/auth';
import {validAdminId,readAdminClaims} from '../lib/adminEvidence';
import {readReviewPreview,createReviewPreview,type AdminReviewItem} from '../lib/adminReviewToken';

// Mounted only after the named console guard. Each SQL facade checks current
// named authority again under the transport lock, including receipt replay.
const router:IRouter=Router();
const reasons=new Set(['reports_reviewed','evidence_checked','operator_checked','decision_incorrect','evidence_changed']);
export async function adminActionsEnabled(){
 if(process.env.NAMED_ADMIN_CONSOLE_ENABLED!=='true')return false;
 const {rows}=await pool.query(`SELECT CASE WHEN to_regprocedure('public.v2_api_admin_property_batch(varchar,uuid,jsonb)') IS NULL THEN false
  ELSE has_function_privilege(current_user,'public.v2_api_admin_property_batch(varchar,uuid,jsonb)','EXECUTE') END enabled`);
 return rows[0]?.enabled===true;
}
router.use((req,res,next)=>{
 res.setHeader('Cache-Control','private, no-store');res.vary('Cookie');res.vary('Authorization');
 if(!req.isAuthenticated()){res.status(401).json({code:'AUTH_REQUIRED',error:'Sign in to administration.'});return;}
 if(req.get('X-Mabhazi-Account')!==undefined&&req.get('X-Mabhazi-Account')!==req.user.id){res.status(409).json({code:'ACCOUNT_CHANGED',error:'Reopen the dashboard with your current account.'});return;}
 if(req.method==='POST'){
  if(req.get('X-Mabhazi-Account')!==req.user.id){res.status(409).json({code:'ACCOUNT_CHANGED',error:'Reopen the dashboard with your current account.'});return;}
  if(!req.is('application/json')){res.status(415).json({code:'JSON_REQUIRED',error:'Submit the action as JSON.'});return;}
  if(req.headers.origin!==getOrigin(req)){res.status(403).json({code:'ORIGIN_REJECTED',error:'Reopen the private workspace.'});return;}
 }
 next();
});
router.get('/receipts/:requestId',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!validAdminId(req.params.requestId)||Object.keys(req.query).length){res.status(400).json({code:'INVALID_REQUEST',error:'Use a saved action reference.'});return;}
 try{
  const {rows}=await pool.query('SELECT public.v2_api_admin_batch_receipt($1,$2) receipt',[req.user.id,req.params.requestId]);res.json(rows[0].receipt);
 }catch(error){const denied=(error as Error).message==='v2_admin_required';res.status(denied?403:503).json({code:denied?'ADMIN_REQUIRED':'RECEIPT_UNAVAILABLE',error:denied?'Administrative access is required.':'The receipt could not be checked. Keep this action and check again.'});}
});
router.get('/history',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const cursor=req.query.cursor;
 if(Object.keys(req.query).some(k=>k!=='cursor')||cursor!==undefined&&!validAdminId(cursor)){
  res.status(400).json({code:'INVALID_CURSOR',error:'Reopen review history.'});return;
 }
 try{
  const {rows}=await pool.query(`SELECT b.id FROM public.v2_admin_batches b WHERE
   ($1::uuid IS NULL OR (b.created_at,b.id)<(SELECT created_at,id FROM public.v2_admin_batches WHERE id=$1))
   AND EXISTS(SELECT 1 FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id WHERE r.user_id=$2 AND r.role='administrator'
    AND r.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id))
   ORDER BY b.created_at DESC,b.id DESC LIMIT 21`,[cursor??null,req.user.id]);
  const receipts=[];for(const row of rows.slice(0,20)){
   const r=await pool.query('SELECT public.v2_api_admin_batch_receipt($1,$2) receipt',[req.user.id,row.id]);receipts.push(r.rows[0].receipt);
  }
  res.json({batches:receipts,...(rows.length>20?{nextCursor:rows[19].id}:{})});
 }catch{res.status(503).json({code:'HISTORY_UNAVAILABLE',error:'Review history could not be checked.'});}
});
router.post('/reverse-preview',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const body=req.body as Record<string,unknown>;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['batchId','reviewIds'].includes(k))
  ||!validAdminId(body.batchId)||body.reviewIds!==undefined&&(!Array.isArray(body.reviewIds)||!body.reviewIds.length
   ||body.reviewIds.length>2000||!body.reviewIds.every(validAdminId)||new Set(body.reviewIds).size!==body.reviewIds.length)||Object.keys(req.query).length){
  res.status(422).json({code:'INVALID_REVERSAL',error:'Choose the decisions to reverse from history.'});return;
 }
 try{
  const {rows}=await pool.query('SELECT public.v2_api_admin_batch_receipt($1,$2) receipt',[req.user.id,body.batchId]);
  const receipt=rows[0].receipt;
  if(receipt.found===false||receipt.operation!=='approve'){res.status(404).json({code:'BATCH_UNAVAILABLE',error:'This approval batch is unavailable.'});return;}
  const approved=receipt.items.filter((i:Record<string,unknown>)=>i.outcome==='approved'&&i.reviewId);
  if(body.reviewIds&&(body.reviewIds as string[]).some(id=>!approved.some((i:Record<string,unknown>)=>i.reviewId===id))){res.status(422).json({code:'INVALID_REVERSAL',error:'Choose decisions from this batch.'});return;}
  const selected=approved.filter((i:Record<string,unknown>)=>!body.reviewIds||(body.reviewIds as string[]).includes(i.reviewId as string));
  const ids=[...new Set(selected.map((i:Record<string,unknown>)=>i.routeId as string))];
  const data=ids.length?await readAdminClaims(req.user.id,ids as string[]):{claims:[]};
  const held=[],items:AdminReviewItem[]=[];
  for(const original of selected){
   const c=data.claims.find(c=>c.routeId===original.routeId&&c.field===original.fieldKey&&c.observationId===original.observationId);
   if(!c||original.detail==='erased'||c.state!=='active'){held.push({...original,reason:'Source unavailable'});continue;}
   if(c.reviewId!==original.reviewId){held.push({...original,reason:'Newer decision retained'});continue;}
   items.push({routeId:c.routeId,subjectId:c.subjectId,contributionId:c.contributionId,observationId:c.observationId,fieldKey:c.field,
    subjectRevision:c.subjectRevision,observationRevision:c.observationRevision,targetRevision:c.targetRevision,assessmentId:c.assessmentId,
    caseRevision:c.caseRevision,reviewId:original.reviewId});
  }
  const writable=await adminActionsEnabled();
  res.json({operation:'reverse',ready:items.length,held,claims:data.claims.filter(c=>items.some(i=>i.routeId===c.routeId&&i.fieldKey===c.field&&i.observationId===c.observationId)),writable,
   ...(writable&&items.length?{previewToken:createReviewPreview(req.user.id,'reverse',items,process.env.ADMIN_SECRET??'')}:{})});
 }catch{res.status(503).json({code:'PREVIEW_UNAVAILABLE',error:'The reversal preview could not load. Your decisions have not changed.'});}
});
router.post('/actions',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const body=req.body as Record<string,unknown>;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='clientRequestId,previewToken,reason'
  ||!validAdminId(body.clientRequestId)||typeof body.reason!=='string'||!reasons.has(body.reason)||Object.keys(req.query).length){
  res.status(422).json({code:'INVALID_ACTION',error:'Review this selection and choose a reason.'});return;
 }
 try{
  if(!await adminActionsEnabled()){res.status(503).json({code:'ADMIN_ACTIONS_UNAVAILABLE',error:'Review actions are not available yet.'});return;}
  const preview=readReviewPreview(body.previewToken,req.user.id,process.env.ADMIN_SECRET??'');
  if(!preview){res.status(409).json({code:'PREVIEW_CHANGED',error:'The review preview is invalid. Refresh this selection.'});return;}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='15s'");
   const {rows}=await client.query('SELECT public.v2_api_admin_property_batch($1,$2,$3) receipt',
    [req.user.id,body.clientRequestId,{operation:preview.value.operation,reason:body.reason,items:preview.value.items,expiresAt:preview.value.expiresAt}]);
   await client.query('COMMIT');res.json(rows[0].receipt);
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }catch(error){
  const message=(error as Error).message;
  if(message==='v2_admin_required'){res.status(403).json({code:'ADMIN_REQUIRED',error:'Your administrative access changed.'});return;}
  if(message==='v2_admin_request_conflict'){res.status(409).json({code:'IDEMPOTENCY_CONFLICT',error:'This reference belongs to a different action. Check its receipt.'});return;}
  if(message==='v2_admin_preview_expired'){res.status(409).json({code:'PREVIEW_EXPIRED',error:'The review preview expired. Refresh it before applying.'});return;}
  res.status(503).json({code:'SAVE_UNCONFIRMED',error:'The save could not be confirmed. Keep this action and check its receipt before retrying.'});
 }
});
export default router;
