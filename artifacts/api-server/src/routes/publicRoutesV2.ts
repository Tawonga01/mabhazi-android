import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { parseBlockedIds } from './routeSafetyV2';
import { SearchV2RoutesQueryParams, SearchV2RoutesResponse, GetV2SubjectParams, GetV2SubjectResponse } from '@workspace/api-zod';

const router: IRouter = Router();
// This is the original, unselected report projection. Neither receipts nor
// legacy journeys supply public identity or authority to write to this target.
const eligible = 'FROM public.v2_public_lead_reports p WHERE true';
const columns = 'SELECT p.subject_id AS "subjectId",p.revision,p.origin,p.destination,p.operator_report AS "operatorReport",p.reported_time AS "reportedTime" ';
const safeProjection = (row: Record<string, unknown>) => ({...row, revision:Number(row.revision), kind:'lead', publicationStatus:'details_needed',
 timedDepartureEligible:false, contributionTargetEligible:true,
 missingDetails:['selected_fare','operating_days','boarding_location'] });
router.use((req,res,next) => {
 if(req.method!=='GET'||req.path!=='/search'&&!/^\/subjects\/[^/]+$/.test(req.path)){next();return;}
 res.setHeader('Cache-Control','no-store');res.vary('X-Mabhazi-Blocked-Contributors');res.vary('Authorization');res.vary('Cookie');
 if(process.env.CONTRIBUTION_MINIMUM_LEAD_ENABLED!=='true') {res.status(503).json({code:'CAPABILITY_UNAVAILABLE',error:'Route discovery is not available yet.'});return;}
 const expected=req.get('X-Mabhazi-Account');
 if(expected!==undefined&&(!req.isAuthenticated()||req.user.id!==expected)){res.status(req.isAuthenticated()?409:401).json({code:req.isAuthenticated()?'ACCOUNT_CHANGED':'AUTH_REQUIRED',error:'Reopen Search with your current account.'});return;}
 const ids=parseBlockedIds(req.get('X-Mabhazi-Blocked-Contributors'));
 if(!ids){res.status(400).json({code:'INVALID_SAFETY_CONTEXT',error:'Your hidden contributor settings could not be checked.'});return;}
 res.locals.blockedIds=ids;next();
});
router.get('/search',async(req,res)=>{
 const parsed=SearchV2RoutesQueryParams.strict().safeParse(req.query);
 if(!parsed.success || ['originCityId','destinationCityId','fromCity','toCity','cursor'].some(key=>req.query[key]!==undefined&&typeof req.query[key]!=='string')){
  res.status(400).json({code:'INVALID_QUERY',error:'Check your city search.'});return;
 }
 const {originCityId,destinationCityId,cursor}=parsed.data,fromCity=parsed.data.fromCity?.trim()??'',toCity=parsed.data.toCity?.trim()??'';
 if(originCityId!==undefined&&!Number.isInteger(originCityId)||destinationCityId!==undefined&&!Number.isInteger(destinationCityId)||originCityId!==undefined&&originCityId===destinationCityId||originCityId!==undefined&&fromCity||destinationCityId!==undefined&&toCity){res.status(400).json({code:'INVALID_QUERY',error:'Choose a city or enter a city name.'});return;}
 const values:unknown[]=[originCityId??null,destinationCityId??null,res.locals.blockedIds,req.isAuthenticated()?req.user.id:null,fromCity,toCity];
 const corridor=' AND ($1::integer IS NULL OR p.origin_city_id=$1) AND ($2::integer IS NULL OR p.destination_city_id=$2) AND strpos(lower(p.origin->>\'name\'),lower($5))>0 AND strpos(lower(p.destination->>\'name\'),lower($6))>0';
 const blocked='p.author_user_id=ANY($3::varchar[]) OR EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$4 AND b.blocked_user_id=p.author_user_id)';
 const allowed=' AND NOT('+blocked+')';
 try {
  const cities=await pool.query('SELECT id FROM public.cities WHERE id=ANY($1::integer[])',[[originCityId,destinationCityId].filter(id=>id!==undefined)]);
  if(cities.rows.length!==[originCityId,destinationCityId].filter(id=>id!==undefined).length){res.status(422).json({code:'CITY_UNAVAILABLE',error:'Choose the cities again.'});return;}
  if(cursor){
   const anchor=await pool.query('SELECT 1 '+eligible+corridor+allowed+' AND p.subject_id=$7',[...values,cursor]);
   if(!anchor.rows.length){res.status(400).json({code:'INVALID_CURSOR',error:'The results changed. Refresh your search.'});return;}
   values.push(cursor);
  }
  const result=await pool.query(columns+eligible+corridor+allowed+(cursor?' AND p.subject_id>$7::uuid':'')+' ORDER BY p.subject_id LIMIT 21',values);
  const hidden=await pool.query('SELECT EXISTS(SELECT 1 '+eligible+corridor+' AND ('+blocked+')) hidden',values.slice(0,6));
  const page=result.rows.slice(0,20);
  res.json(SearchV2RoutesResponse.parse({items:page.map(safeProjection),hasHiddenResults:hidden.rows[0]?.hidden===true,
   ...(result.rows.length>20?{nextCursor:page[page.length-1].subjectId}:{})}));
 }catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'Route results could not be loaded. Try again.'});}
});
router.get('/subjects/:subjectId',async(req,res)=>{
 const parsed=GetV2SubjectParams.safeParse(req.params);
 if(!parsed.success||Object.keys(req.query).length){res.status(400).json({code:'INVALID_SUBJECT',error:'Reopen this route from Search.'});return;}
 try{
  const result=await pool.query(columns+eligible+' AND p.subject_id=$1 AND NOT(p.author_user_id=ANY($2::varchar[])) AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=$3 AND b.blocked_user_id=p.author_user_id)',[parsed.data.subjectId,res.locals.blockedIds,req.isAuthenticated()?req.user.id:null]);
  if(!result.rows[0]){res.status(404).json({code:'SUBJECT_UNAVAILABLE',error:'This route is unavailable.'});return;}
  res.json(GetV2SubjectResponse.parse({subject:safeProjection(result.rows[0])}));
 }catch{res.status(503).json({code:'TEMPORARILY_UNAVAILABLE',error:'This route could not be checked. Try again.'});}
});
export default router;
