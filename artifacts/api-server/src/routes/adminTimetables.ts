import {Router,type IRouter} from 'express';
import {pool} from '@workspace/db';
import {validAdminId} from '../lib/adminEvidence';
import {parseTimetableProposal,createTimetablePreview,readTimetablePreview} from '../lib/adminTimetable';

// Private namespace only. adminConsole applies fresh named authority, account,
// origin and JSON guards before this router. Each SQL facade rechecks authority
// under the transport guard. Ordinary app/legacy-secret sessions cannot opt in.
const router:IRouter=Router();
export async function adminTimetablesEnabled(){
 if(process.env.NAMED_ADMIN_CONSOLE_ENABLED!=='true'||process.env.NAMED_ADMIN_TIMETABLES_ENABLED!=='true')return false;
 const {rows}=await pool.query(`SELECT bool_and(CASE WHEN to_regprocedure(f) IS NULL THEN false
  ELSE has_function_privilege(current_user,f,'EXECUTE') END) enabled FROM unnest(ARRAY[
  'public.v2_api_admin_timetable_preview(varchar,jsonb)',
  'public.v2_api_admin_timetable_action(varchar,uuid,jsonb)',
  'public.v2_api_admin_timetable_receipt(varchar,uuid)',
  'public.v2_api_admin_timetable_operators(varchar,text)']) f`);
 return rows[0]?.enabled===true;
}
router.use(async(_req,res,next)=>{
 try{if(!await adminTimetablesEnabled()){res.status(503).json({code:'TIMETABLES_UNAVAILABLE',error:'Timetable entry is not available yet. Your draft stays saved.'});return;}next();}
 catch{res.status(503).json({code:'ADMIN_UNAVAILABLE',error:'Timetable entry could not be checked. Your draft stays saved.'});}
});
// Check the current named session/account before unlocking a local draft. An
// old browser tab must not expose another account's draft after sign-in changes.
router.get('/state',(_req,res)=>{res.json({available:true});});
router.get('/operators',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const q=req.query.q;
 if(Object.keys(req.query).join(',')!=='q'||typeof q!=='string'||!q.trim()||q.length>120){res.status(400).json({code:'INVALID_QUERY',error:'Type an operator name.'});return;}
 try{const {rows}=await pool.query('SELECT public.v2_api_admin_timetable_operators($1,$2) operators',[req.user.id,q.trim()]);res.json({operators:rows[0].operators});}
 catch{res.status(503).json({code:'OPERATORS_UNAVAILABLE',error:'Operator choices could not load. Your draft stays saved.'});}
});
router.get('/cities',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const q=req.query.q;
 if(Object.keys(req.query).join(',')!=='q'||typeof q!=='string'||!q.trim()||q.length>120){res.status(400).json({code:'INVALID_QUERY',error:'Type a city name.'});return;}
 try{
  const {rows}=await pool.query(`SELECT c.id,c.name FROM public.cities c WHERE strpos(lower(c.name),lower($1))>0
   AND EXISTS(SELECT 1 FROM public.v2_review_roles r JOIN public.users u ON u.id=r.user_id WHERE r.user_id=$2
    AND r.role='administrator' AND r.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=r.user_id))
   ORDER BY c.name,c.id LIMIT 30`,[q.trim(),req.user.id]);res.json({cities:rows});
 }catch{res.status(503).json({code:'CITIES_UNAVAILABLE',error:'City choices could not load. Your draft stays saved.'});}
});
router.post('/preview',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const parsed=parseTimetableProposal(req.body);
 if(!parsed.proposal||Object.keys(req.query).length){res.status(422).json({code:'INVALID_TIMETABLE',error:parsed.issues[0]?.message||'Check this timetable.',issues:parsed.issues});return;}
 try{
  const p=parsed.proposal,{rows}=await pool.query('SELECT public.v2_api_admin_timetable_preview($1,$2) preview',[req.user.id,p]);
  const state=rows[0]?.preview;
  if(!state||typeof state.stateDigest!=='string'||!/^[a-f0-9]{64}$/.test(state.stateDigest)||!Array.isArray(state.duplicates)||!state.cities){throw Error('timetable_state_invalid');}
  res.json({proposal:p,cities:state.cities,duplicates:state.duplicates,operatorOptions:state.operatorOptions??[],writable:state.duplicates.length===0,
   previewToken:createTimetablePreview(p,req.user.id,state.stateDigest,process.env.ADMIN_SECRET??'')});
 }catch(err){
  if((err as Error).message==='v2_admin_required'){res.status(403).json({code:'ADMIN_REQUIRED',error:'Your administrative access changed.'});return;}
  if(['v2_timetable_operator_changed','v2_timetable_preview_changed'].includes((err as Error).message)){res.status(409).json({code:'PREVIEW_CHANGED',error:'The operator or timetable changed. Review the saved draft again.'});return;}
  if(['v2_timetable_proposal_invalid','v2_timetable_city_unavailable'].includes((err as Error).message)){res.status(422).json({code:'INVALID_TIMETABLE',error:'Check the timetable and selected cities.'});return;}
  res.status(503).json({code:'PREVIEW_UNAVAILABLE',error:'The timetable review could not load. No departures were published.'});
 }
});
router.get('/receipts/:requestId',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!validAdminId(req.params.requestId)||Object.keys(req.query).length){res.status(400).json({code:'INVALID_REQUEST',error:'Use the saved action reference.'});return;}
 try{const {rows}=await pool.query('SELECT public.v2_api_admin_timetable_receipt($1,$2) receipt',[req.user.id,req.params.requestId]);res.json(rows[0].receipt);}
 catch{res.status(503).json({code:'RECEIPT_UNAVAILABLE',error:'Keep the saved action and check its receipt again.'});}
});
router.post('/actions',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const b=req.body as Record<string,unknown>;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='clientRequestId,previewToken'||!validAdminId(b.clientRequestId)||Object.keys(req.query).length){
  res.status(422).json({code:'INVALID_ACTION',error:'Review this timetable first.'});return;
 }
 const proof=readTimetablePreview(b.previewToken,req.user.id,process.env.ADMIN_SECRET??'');
 if(!proof){res.status(409).json({code:'PREVIEW_CHANGED',error:'Reopen the timetable review. Keep any saved action until its receipt is checked.'});return;}
 const {version,actor,issuedAt,...input}=proof;void version;void actor;void issuedAt;
 try{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='30s'");
   const {rows}=await client.query('SELECT public.v2_api_admin_timetable_action($1,$2,$3) receipt',[req.user.id,b.clientRequestId,input]);
   await client.query('COMMIT');res.json(rows[0].receipt);
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
 }catch(err){
  const message=(err as Error).message;
  if(message==='v2_admin_required'){res.status(403).json({code:'ADMIN_REQUIRED',error:'Your administrative access changed.'});return;}
  if(message==='v2_admin_request_conflict'){res.status(409).json({code:'IDEMPOTENCY_CONFLICT',error:'This reference belongs to a different action. Check its receipt.'});return;}
  if(['v2_timetable_operator_changed','v2_timetable_preview_changed'].includes(message)){res.status(409).json({code:'PREVIEW_CHANGED',error:'The timetable changed. Check the receipt, then reopen the review.'});return;}
  if(['v2_timetable_proposal_invalid','v2_timetable_city_unavailable','v2_timetable_action_invalid'].includes(message)){res.status(422).json({code:'INVALID_TIMETABLE',error:'The timetable could not be applied. Check the saved draft.'});return;}
  if(message==='v2_admin_preview_expired'){res.status(409).json({code:'PREVIEW_EXPIRED',error:'Refresh the timetable review before applying.'});return;}
  res.status(503).json({code:'SAVE_UNCONFIRMED',error:'The save could not be confirmed. Check its receipt before retrying.'});
 }
});
export default router;
