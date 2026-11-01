import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import type pg from 'pg';
type Context={db:pg.Client;user:string;other:string};
export function registerAdminBootstrapTests(context:()=>Context){
 const q=(sql:string,values:unknown[]=[])=>context().db.query(sql,values);
 async function fixture(){
  await q("UPDATE v2_review_roles SET revoked_at=clock_timestamp(),revoked_by_user_id=$1 WHERE role='administrator' AND revoked_at IS NULL",[context().other]);
  await q('CREATE SCHEMA IF NOT EXISTS auth');
  await q('CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,raw_app_meta_data jsonb)');
  await q("INSERT INTO auth.users(id,email_confirmed_at,raw_app_meta_data) VALUES($1,now(),'{\"providers\":[\"google\"]}')",[context().user]);
  await q("SELECT set_config('mabhazi.bootstrap_user',$1,true)",[context().user]);
  return readFile(new URL('../scripts/preview-first-admin.sql',import.meta.url),'utf8');
 }
 async function invalid(sql:string,message:string){await q('SAVEPOINT invalid_bootstrap');try{await assert.rejects(q(sql),new RegExp(message));}finally{await q('ROLLBACK TO SAVEPOINT invalid_bootstrap');await q('RELEASE SAVEPOINT invalid_bootstrap');}}
 test('admin bootstrap: first verified named owner is auditable and exact replay grants only once',async()=>{
  const sql=await fixture();await q(sql);await q(sql);
  assert.equal((await q("SELECT count(*) FROM v2_review_roles WHERE user_id=$1 AND role='administrator' AND revoked_at IS NULL",[context().user])).rows[0].count,'1');
  assert.equal((await q("SELECT count(*) FROM v2_role_events WHERE target_user_id=$1 AND action='grant' AND reason_code='owner_approved_dashboard'",[context().user])).rows[0].count,'1');
  assert.equal((await q("SELECT count(*) FROM v2_review_roles WHERE user_id=$1 AND revoked_at IS NULL",[context().other])).rows[0].count,'0');
 });
 test('admin bootstrap: unverified identity, another administrator and backend self-promotion fail closed',async()=>{
  const sql=await fixture();await q('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[context().user]);
  await invalid(sql,'admin_bootstrap_verified_account_required');await q('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[context().user]);
  await q("UPDATE auth.users SET raw_app_meta_data='{\"providers\":[\"email\"]}' WHERE id=$1",[context().user]);
  await invalid(sql,'admin_bootstrap_verified_account_required');await q("UPDATE auth.users SET raw_app_meta_data='{\"providers\":[\"google\"]}' WHERE id=$1",[context().user]);
  await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','fixture')",[context().other]);
  await invalid(sql,'admin_bootstrap_already_configured');
  await q('SET LOCAL ROLE mabhazi_api');await invalid(sql,'admin_bootstrap_owner_only');await q('RESET ROLE');
  assert.equal((await q("SELECT count(*) FROM v2_review_roles WHERE user_id=$1 AND role='administrator' AND revoked_at IS NULL",[context().user])).rows[0].count,'0');
 });
}
