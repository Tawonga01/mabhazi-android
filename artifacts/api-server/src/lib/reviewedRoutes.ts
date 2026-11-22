import {pool} from '@workspace/db';
export const reviewedRoutesHeader='X-Mabhazi-Route-Display';
export const reviewedRoutesVersion='reviewed-core/1';
export async function reviewedRoutesAvailable(){
 const {rows}=await pool.query(`SELECT CASE WHEN to_regclass('public.v2_public_reviewed_lead_reports') IS NULL THEN false
  ELSE has_table_privilege(current_user,'public.v2_public_reviewed_lead_reports','SELECT') END available`);
 return rows[0]?.available===true;
}

export const timetableRoutesVersion='reviewed-timetable/1';
export const validRouteDisplay=(value:string|undefined)=>value===undefined||value===reviewedRoutesVersion||value===timetableRoutesVersion;
export const modernRouteDisplay=(value:string|undefined)=>value===reviewedRoutesVersion||value===timetableRoutesVersion;
export async function timetableRoutesAvailable(){
 if(process.env.REVIEWED_TIMETABLES_ENABLED!=='true')return false;
 const {rows}=await pool.query(`SELECT
 coalesce((SELECT bool_and(CASE WHEN to_regclass(t) IS NULL THEN false ELSE has_table_privilege(current_user,t,'SELECT') END)
 FROM unnest(ARRAY['public.v2_public_supported_route_reports','public.v2_public_contributable_route_reports']) t),false)
 AND coalesce((SELECT bool_and(CASE WHEN to_regprocedure(f) IS NULL THEN false ELSE has_function_privilege(current_user,f,'EXECUTE') END)
 FROM unnest(ARRAY['public.v2_api_public_timetable_reports()','public.v2_api_timetable_card_claims(uuid[])','public.v2_api_timetable_report_claims(uuid[])',
 'public.v2_api_route_contribution_context(varchar,uuid,varchar[])','public.v2_api_submit_public_actual_journey(varchar,text,jsonb,varchar[])',
 'public.v2_api_submit_route_observations(varchar,text,jsonb,varchar[])','public.v2_api_route_report_action(varchar,uuid,text,text)',
 'public.v2_api_fare_report_action(varchar,uuid,uuid,text,text,varchar[])','public.v2_api_place_report_action(varchar,uuid,uuid,text,text,varchar[])']) f),false) available`);
 return rows[0]?.available===true;
}
