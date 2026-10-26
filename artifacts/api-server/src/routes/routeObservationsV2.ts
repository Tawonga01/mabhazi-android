import { Router,type Response,type IRouter } from 'express';
import { pool } from '@workspace/db';
import { GetV2RouteContributionContextParams,GetV2RouteContributionContextResponse } from '@workspace/api-zod';
import { parseRouteObservations,saveRouteObservations } from '../lib/routeObservations';
import { parseBlockedIds } from './routeSafetyV2';
import { isAllowedOrigin } from '../lib/origins';
import { requireCurrentTerms } from '../middlewares/termsMiddleware';
import { CURRENT_TERMS_VERSION } from '../lib/terms';
const router:IRouter=Router();
const fail=(res:Response,status:number,code:string,error:string)=>res.status(status).json({error,code});
export async function routeObservationsEnabled(){
 if(process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED!=='true')return false;
 const signatures=['public.v2_api_route_contribution_context(varchar,uuid,varchar[])','public.v2_api_submit_route_observations(varchar,text,jsonb,varchar[])'];
 const {rows}=await pool.query("SELECT bool_and(CASE WHEN to_regprocedure(s) IS NULL THEN false ELSE has_function_privilege(current_user,s,'EXECUTE') END) ready FROM unnest($1::text[]) s",[signatures]);return rows[0]?.ready===true;
}
function failure(res:Response,error:unknown,write=false){
 const {message,code}=error as {message?:string;code?:string};
 if(message==='v2_intake_account_missing')return fail(res,401,'AUTH_REQUIRED','Sign in again before continuing.');
 if(message==='v2_intake_terms_required')return res.status(428).json({error:'Accept the current Terms before submitting.',code:'TERMS_ACCEPTANCE_REQUIRED',currentVersion:CURRENT_TERMS_VERSION});
 if(message==='v2_route_target_unavailable')return fail(res,404,'TARGET_NOT_FOUND','The selected route is not available. Keep your draft and choose again.');
 if(message==='v2_route_identity_changed')return fail(res,409,'TARGET_IDENTITY_CHANGED','The selected route changed. Review it before saving again.');
 if(message==='v2_intake_idempotency_conflict')return fail(res,409,'IDEMPOTENCY_CONFLICT','This reference was used for different answers. Check its receipt.');
 if(message==='v2_intake_source_forbidden')return fail(res,403,'FORBIDDEN','One selected source is not available to this account.');
 if(['23514','23503','22007','22008','22P02'].includes(code??''))return fail(res,422,'INVALID_CONTRIBUTION','Check the endpoint place, date and source.');
 return fail(res,503,write?'SAVE_UNCONFIRMED':'TEMPORARILY_UNAVAILABLE',write?'The save could not be confirmed. Keep your draft and check its receipt before retrying.':'Route context is temporarily unavailable.');
}
router.use(['/subjects/:subjectId/contribution-context','/route-observations'],(req,res,next)=>{
 res.setHeader('Cache-Control','no-store');if(!req.isAuthenticated()){fail(res,401,'AUTH_REQUIRED','Sign in before continuing.');return;}
 if(req.get('X-Mabhazi-Account')!==req.user.id){fail(res,409,'ACCOUNT_CHANGED','The active account changed. Reopen your own draft.');return;}next();
});
router.get('/subjects/:subjectId/contribution-context',async(req,res)=>{
 if(!req.isAuthenticated())return;const params=GetV2RouteContributionContextParams.safeParse(req.params);if(!params.success){fail(res,400,'INVALID_TARGET','Choose a route again.');return;}
 const blocked=parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'));if(!blocked){fail(res,400,'INVALID_SAFETY_CONTEXT','Your hidden contributor settings could not be checked.');return;}
 try{if(!await routeObservationsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','This contribution form is not available yet.');return;}
  const {rows}=await pool.query('SELECT public.v2_api_route_contribution_context($1,$2,$3::varchar[]) context',[req.user.id,params.data.subjectId,blocked]);res.json(GetV2RouteContributionContextResponse.parse(rows[0]?.context));
 }catch(error){failure(res,error);}
});
router.post('/route-observations',requireCurrentTerms,async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!req.is('application/json')){fail(res,415,'JSON_REQUIRED','Submit the contribution as JSON.');return;}
 if(req.headers.origin&&!isAllowedOrigin(req.headers.origin)||!req.headers.authorization?.startsWith('Bearer ')&&!req.headers.origin){fail(res,403,'ORIGIN_REJECTED','The sign-in origin is not allowed.');return;}
 const blocked=parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'));if(!blocked){fail(res,400,'INVALID_SAFETY_CONTEXT','Your hidden contributor settings could not be checked.');return;}
 try{if(!await routeObservationsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','This contribution form is not available yet.');return;}}catch(error){failure(res,error);return;}
 const parsed=parseRouteObservations(req.body);if(!parsed.success){res.status(422).json({error:'Check the route places.',code:'INVALID_CONTRIBUTION',fieldErrors:parsed.fieldErrors});return;}
 try{res.json(await saveRouteObservations(req.user.id,parsed.data,undefined,blocked));}catch(error){failure(res,error,true);}
});
export default router;
