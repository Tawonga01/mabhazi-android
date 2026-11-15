import {Router,type IRouter,type Response} from 'express';
import {pool} from '@workspace/db';
import {GetV2PromptPreferencesResponse,SetV2PromptPreferencesBody,RecordV2PromptActivityBody,RecordV2PromptActivityResponse} from '@workspace/api-zod';
import {isAllowedOrigin} from '../lib/origins';

const router:IRouter=Router();
const fail=(res:Response,status:number,code:string,error:string)=>res.status(status).json({code,error});
export async function promptControlsEnabled(){
 const signatures=['public.v2_api_prompt_preferences_read(varchar)','public.v2_api_prompt_preferences_set(varchar,bigint,boolean,text[])','public.v2_api_prompt_activity(varchar)'];
 const {rows}=await pool.query("SELECT bool_and(CASE WHEN to_regprocedure(s) IS NULL THEN false ELSE has_function_privilege(current_user,s,'EXECUTE') END) ready FROM unnest($1::text[]) s",[signatures]);
 return rows[0]?.ready===true;
}
function failure(res:Response,error:unknown){
 const {message,code}=error as {message?:string;code?:string};
 if(message==='v2_prompt_account_unavailable')return fail(res,401,'AUTH_REQUIRED','Sign in again before continuing.');
 if(message==='v2_prompt_preferences_stale'||code==='40001')return fail(res,409,'PREFERENCES_CHANGED','Your settings changed. Reload them before saving again.');
 if(code==='23514')return fail(res,422,'INVALID_PROMPT_SETTINGS','Check your question settings.');
 return fail(res,503,'TEMPORARILY_UNAVAILABLE','Question settings could not be confirmed. Reload them before trying again.');
}
router.use((req,res,next)=>{
 if(!['/prompt-preferences','/prompt-activity'].includes(req.path)){next();return;}
 res.setHeader('Cache-Control','no-store');
 if(!req.isAuthenticated()){fail(res,401,'AUTH_REQUIRED','Sign in to manage your questions.');return;}
 if(req.get('X-Mabhazi-Account')!==req.user.id){fail(res,409,'ACCOUNT_CHANGED','The active account changed. Reopen your own settings.');return;}
 if(Object.keys(req.query).length){fail(res,400,'INVALID_QUERY','These controls do not accept query parameters.');return;}
 if(req.method==='POST'){
  if(!req.is('application/json')){fail(res,415,'JSON_REQUIRED','Send the request as JSON.');return;}
  if(req.headers.origin&&!isAllowedOrigin(req.headers.origin)||!req.headers.authorization?.startsWith('Bearer ')&&!req.headers.origin){fail(res,403,'ORIGIN_REJECTED','The sign-in origin is not allowed.');return;}
 }
 next();
});
// Opt-out and reads must remain usable even when contribution intake is paused.
router.get('/prompt-preferences',async(req,res)=>{
 if(!req.isAuthenticated())return;
 try{if(!await promptControlsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','Question settings are not available yet.');return;}
  const {rows}=await pool.query('SELECT public.v2_api_prompt_preferences_read($1) result',[req.user.id]);
  res.json(GetV2PromptPreferencesResponse.parse(rows[0]?.result));
 }catch(error){failure(res,error);}
});
router.post('/prompt-preferences',async(req,res)=>{
 if(!req.isAuthenticated())return;
 const parsed=SetV2PromptPreferencesBody.strict().safeParse(req.body);
 if(!parsed.success||!Number.isSafeInteger(parsed.data.expectedRevision)||new Set(parsed.data.disabledTypes).size!==parsed.data.disabledTypes.length){fail(res,422,'INVALID_PROMPT_SETTINGS','Check your question settings.');return;}
 try{if(!await promptControlsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','Question settings are not available yet.');return;}
  const b=parsed.data,{rows}=await pool.query('SELECT public.v2_api_prompt_preferences_set($1,$2,$3,$4::text[]) result',[req.user.id,b.expectedRevision,b.invitationsEnabled,b.disabledTypes]);
  res.json(GetV2PromptPreferencesResponse.parse(rows[0]?.result));
 }catch(error){failure(res,error);}
});
router.post('/prompt-activity',async(req,res)=>{
 if(!req.isAuthenticated())return;
 if(!RecordV2PromptActivityBody.strict().safeParse(req.body).success){fail(res,422,'INVALID_ACTIVITY','Only foreground activity can be recorded.');return;}
 try{if(!await promptControlsEnabled()){fail(res,503,'CAPABILITY_UNAVAILABLE','Question controls are not available yet.');return;}
  const {rows}=await pool.query('SELECT public.v2_api_prompt_activity($1) result',[req.user.id]);
  res.json(RecordV2PromptActivityResponse.parse(rows[0]?.result));
 }catch(error){failure(res,error);}
});
export default router;
