import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { RouteV2SafetyBody, RouteV2SafetyParams, ListV2RouteBlocksResponse, UnblockV2RouteReporterParams } from '@workspace/api-zod';
import { isAllowedOrigin } from '../lib/origins';
const router:IRouter=Router();
export function parseBlockedIds(raw:string|undefined):string[]|null{
 try{if(raw&&Buffer.byteLength(raw)>10000)return null;const value:unknown=raw===undefined?[]:JSON.parse(raw);
 if(!Array.isArray(value)||value.length>200||value.some(id=>typeof id!=='string'||!id.trim()||id.length>200||/[\u0000-\u001f\u007f-\u009f]/.test(id)))return null;return [...new Set(value)];}catch{return null;}
}
router.use((req,res,next)=>{
 if(!req.path.startsWith('/blocked-route-reporters')&&!/^\/subjects\/[^/]+\/safety$/.test(req.path)){next();return;}
 res.setHeader('Cache-Control','no-store');
 if(!req.isAuthenticated()){res.status(401).json({code:'AUTH_REQUIRED',error:'Sign in to manage route safety.'});return;}
 if(req.get('X-Mabhazi-Account')!==req.user.id){res.status(409).json({code:'ACCOUNT_CHANGED',error:'The active account changed. Reopen your safety settings.'});return;}
 if(Object.keys(req.query).length){res.status(400).json({code:'INVALID_QUERY',error:'Reopen this safety control.'});return;}
 if(req.method!=='GET'&&(req.headers.origin&&!isAllowedOrigin(req.headers.origin)||!req.headers.authorization?.startsWith('Bearer ')&&!req.headers.origin)){res.status(403).json({code:'ORIGIN_REJECTED',error:'The sign-in origin is not allowed.'});return;}next();
});
router.get('/blocked-route-reporters',async(req,res)=>{
 if(!req.isAuthenticated())return;
 try{const result=await pool.query('SELECT id,created_at AS "blockedAt" FROM public.v2_route_report_blocks WHERE blocker_id=$1 ORDER BY created_at DESC,id LIMIT 200',[req.user.id]);res.json(ListV2RouteBlocksResponse.parse({blocks:result.rows}));}
 catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'Your hidden route-report contributors could not load.'});}
});
router.delete('/blocked-route-reporters/:blockId',async(req,res)=>{
 if(!req.isAuthenticated())return;const parsed=UnblockV2RouteReporterParams.safeParse(req.params);
 if(!parsed.success){res.status(400).json({code:'INVALID_BLOCK',error:'Reopen your safety settings.'});return;}
 try{await pool.query('SELECT public.v2_api_unblock_route_report_author($1,$2)',[req.user.id,parsed.data.blockId]);res.json({status:'unblocked'});}
 catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'The unblock could not be confirmed. Refresh and try again.'});}
});
router.post('/subjects/:subjectId/safety',async(req,res)=>{
 if(!req.isAuthenticated())return;if(!req.is('application/json')){res.status(415).json({code:'JSON_REQUIRED',error:'Submit safety actions as JSON.'});return;}
 const params=RouteV2SafetyParams.safeParse(req.params),body=RouteV2SafetyBody.strict().safeParse(req.body);
 if(!params.success||!body.success||body.data.action==='report'&&!body.data.reason||body.data.action==='block'&&body.data.reason){res.status(422).json({code:'INVALID_SAFETY_ACTION',error:'Choose a valid safety action and reason.'});return;}
 try{const result=await pool.query('SELECT public.v2_api_route_report_action($1,$2,$3,$4) result',[req.user.id,params.data.subjectId,body.data.action,body.data.reason??null]);res.json(result.rows[0].result);}
 catch(error){const message=(error as Error).message;if(message==='v2_actual_target_unavailable'){res.status(404).json({code:'TARGET_NOT_FOUND',error:'This route is unavailable.'});return;}
 if(['v2_self_block_invalid','v2_block_limit'].includes(message)){res.status(422).json({code:'BLOCK_UNAVAILABLE',error:message==='v2_self_block_invalid'?'Your own reports cannot be blocked.':'Unblock a contributor before adding another block.'});return;}
 res.status(503).json({code:'SAVE_UNCONFIRMED',error:'The safety action could not be confirmed. Try again.'});}
});
export default router;
