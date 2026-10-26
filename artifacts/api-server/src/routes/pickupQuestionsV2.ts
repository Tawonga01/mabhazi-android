import {Router,type IRouter,type Response} from 'express';
import {pool} from '@workspace/db';
import {ReserveV2PickupQuestionBody,GetV2PickupQuestionParams,GetV2PickupQuestionResponse,RecordV2PickupQuestionEventBody} from '@workspace/api-zod';
import {parseRouteObservations} from '../lib/routeObservations';
import {saveIntake} from '../lib/minimumLead';
import {parseBlockedIds} from './routeSafetyV2';
import {isAllowedOrigin} from '../lib/origins';
import {requireCurrentTerms} from '../middlewares/termsMiddleware';
import {CURRENT_TERMS_VERSION} from '../lib/terms';

const router:IRouter=Router();
const fail=(res:Response,status:number,code:string,error:string)=>res.status(status).json({code,error});
export async function pickupQuestionsEnabled(){
 if(process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED!=='true')return false;
 const signatures=['public.v2_api_pickup_question_read(varchar,uuid,varchar[])','public.v2_api_pickup_question_reserve(varchar,uuid,uuid,text[],text,varchar[])','public.v2_api_pickup_question_event(varchar,uuid,uuid,text,text,varchar[])','public.v2_api_submit_pickup_question_answer(varchar,text,jsonb,varchar[],uuid)'];
 const {rows}=await pool.query("SELECT bool_and(CASE WHEN to_regprocedure(s) IS NULL THEN false ELSE has_function_privilege(current_user,s,'EXECUTE') END) ready FROM unnest($1::text[]) s",[signatures]);
 return rows[0]?.ready===true;
}
function failure(res:Response,error:unknown,write=false){
 const {message,code}=error as {message?:string;code?:string};
 if(message==='v2_prompt_account_unavailable'||message==='v2_intake_account_missing')return fail(res,401,'AUTH_REQUIRED','Sign in again before continuing.');
 if(message==='v2_intake_terms_required')return res.status(428).json({code:'TERMS_ACCEPTANCE_REQUIRED',error:'Accept the current Terms before saving.',currentVersion:CURRENT_TERMS_VERSION});
 if(message==='v2_route_target_unavailable'||message==='v2_prompt_invitation_unavailable')return fail(res,404,'QUESTION_UNAVAILABLE','This question is no longer available. Your draft is kept.');
 if(message==='v2_route_identity_changed'||message==='v2_prompt_identity_reconfirmation_required')return fail(res,409,'TARGET_IDENTITY_CHANGED','The route changed. Review it before saving again.');
 if(['v2_intake_idempotency_conflict','v2_prompt_request_conflict','v2_prompt_event_conflict','v2_prompt_independent_receipt_conflict'].includes(message??''))return fail(res,409,'IDEMPOTENCY_CONFLICT','This reference was used for different answers. Check its saved result.');
 if(['v2_prompt_no_longer_offered','v2_prompt_event_already_recorded','v2_prompt_invitation_expired'].includes(message??''))return fail(res,409,'QUESTION_CHANGED','This question changed. Your draft is kept.');
 if(message==='v2_intake_source_forbidden')return fail(res,403,'FORBIDDEN','One selected source is not available to this account.');
 if(['23514','23503','22007','22008','22P02'].includes(code??''))return fail(res,422,'INVALID_QUESTION_REQUEST','Check the question, route and answers.');
 return fail(res,503,write?'SAVE_UNCONFIRMED':'TEMPORARILY_UNAVAILABLE',write?'Saving could not be confirmed. Check the receipt before retrying.':'Questions are temporarily unavailable.');
}
router.use((req,res,next)=>{
 if(!/^\/pickup-questions(?:\/[^/]+(?:\/(?:events|answers))?)?$/.test(req.path)){next();return;}
 res.setHeader('Cache-Control','no-store');
 if(!req.isAuthenticated()){fail(res,401,'AUTH_REQUIRED','Sign in before continuing.');return;}
 if(req.get('X-Mabhazi-Account')!==req.user.id){fail(res,409,'ACCOUNT_CHANGED','The active account changed. Reopen your own draft.');return;}
 if(!parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'))){fail(res,400,'INVALID_SAFETY_CONTEXT','Your hidden contributor settings could not be checked.');return;}
 if(req.method==='POST'){
  if(!req.is('application/json')){fail(res,415,'JSON_REQUIRED','Send the request as JSON.');return;}
  if(req.headers.origin&&!isAllowedOrigin(req.headers.origin)||!req.headers.authorization?.startsWith('Bearer ')&&!req.headers.origin){fail(res,403,'ORIGIN_REJECTED','The sign-in origin is not allowed.');return;}
 }
 next();
});
router.post('/pickup-questions',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const parsed=ReserveV2PickupQuestionBody.strict().safeParse(req.body);
 if(!parsed.success||new Set(parsed.success?parsed.data.declaredContext:[]).size!==(parsed.success?parsed.data.declaredContext.length:0)){fail(res,422,'INVALID_QUESTION_REQUEST','Declare how you know this route.');return;}
 try{if(!await pickupQuestionsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','Pickup questions are not available yet.');return;}
  const b=parsed.data,{rows}=await pool.query('SELECT public.v2_api_pickup_question_reserve($1,$2,$3,$4::text[],$5,$6::varchar[]) result',[req.user.id,b.clientRequestId,b.subjectId,b.declaredContext,b.entrySurface,parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'))]);
  res.json(GetV2PickupQuestionResponse.parse(rows[0]?.result));
 }catch(error){failure(res,error);}
});
router.get('/pickup-questions/:invitationId',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const parsed=GetV2PickupQuestionParams.safeParse(req.params);if(!parsed.success){fail(res,400,'INVALID_REQUEST_ID','Choose the question again.');return;}
 try{if(!await pickupQuestionsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','Pickup questions are not available yet.');return;}
  const {rows}=await pool.query('SELECT public.v2_api_pickup_question_read($1,$2,$3::varchar[]) result',[req.user.id,parsed.data.invitationId,parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'))]);res.json(GetV2PickupQuestionResponse.parse(rows[0]?.result));
 }catch(error){failure(res,error);}
});
router.post('/pickup-questions/:invitationId/events',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const params=GetV2PickupQuestionParams.safeParse(req.params),body=RecordV2PickupQuestionEventBody.strict().safeParse(req.body);
 if(!params.success||!body.success){fail(res,422,'INVALID_QUESTION_REQUEST','Check the question feedback.');return;}
 try{if(!await pickupQuestionsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','Pickup questions are not available yet.');return;}
  const {rows}=await pool.query('SELECT public.v2_api_pickup_question_event($1,$2,$3,$4,$5,$6::varchar[]) result',[req.user.id,params.data.invitationId,body.data.clientEventId,body.data.outcome,body.data.timezone,parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'))]);res.json(rows[0]?.result);
 }catch(error){failure(res,error);}
});
router.post('/pickup-questions/:invitationId/answers',requireCurrentTerms,async(req,res)=>{
 if(!req.isAuthenticated())return;
 const params=GetV2PickupQuestionParams.safeParse(req.params),body=parseRouteObservations(req.body);
 if(!params.success||!body.success){res.status(422).json({code:'INVALID_CONTRIBUTION',error:'Check the pickup answer.',...(!body.success?{fieldErrors:body.fieldErrors}:{})});return;}
 try{if(!await pickupQuestionsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','Pickup questions are not available yet.');return;}
  res.json(await saveIntake(req.user.id,body.data,'v2_api_submit_pickup_question_answer',undefined,parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'))??[],params.data.invitationId));
 }catch(error){failure(res,error,true);}
});
export default router;
