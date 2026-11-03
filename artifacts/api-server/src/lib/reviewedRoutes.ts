import {pool} from '@workspace/db';
export const reviewedRoutesHeader='X-Mabhazi-Route-Display';
export const reviewedRoutesVersion='reviewed-core/1';
export async function reviewedRoutesAvailable(){
 const {rows}=await pool.query(`SELECT CASE WHEN to_regclass('public.v2_public_reviewed_lead_reports') IS NULL THEN false
  ELSE has_table_privilege(current_user,'public.v2_public_reviewed_lead_reports','SELECT') END available`);
 return rows[0]?.available===true;
}
