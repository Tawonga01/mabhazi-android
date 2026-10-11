import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { getTableName } from "drizzle-orm";
import { promptTables } from "./schema/promptTasks";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const reserveSQL="SELECT v2_prompt_reserve($1,$2,$3,$4,$5,$6) id";
const hash="a".repeat(64);
export function registerPromptTests(context: () => Context) {
 let activeSubject: string;
 const q=(sql:string,values:unknown[]=[])=>context().db.query(sql,values);
 async function invalid(action:()=>Promise<unknown>,codes=["23514"]) {
  await q("SAVEPOINT invalid_prompt"); try { await assert.rejects(action,(e:unknown)=>{
   assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)),`${String(e.code)}: ${e.message}`); return true;
  }); } finally {await q("ROLLBACK TO SAVEPOINT invalid_prompt");await q("RELEASE SAVEPOINT invalid_prompt");}
 }
 async function lead(owner=context().user) {
  const id=randomUUID(),c=randomUUID();await q("SET CONSTRAINTS ALL DEFERRED");
  await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')",[id]);
  await q("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)",[c,owner,hash,id]);
  await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Synthetic prompt company',$3)",[id,context().corridor,c]); activeSubject=id; return id;
 }
 async function task(subject:string,question="pickup_place",field="boarding.pickup",scope:unknown={}) {
  const generation=(await q("SELECT input_generation FROM v2_subjects WHERE id=$1",[subject])).rows[0].input_generation;
  return (await q("SELECT v2_prompt_put_task($1,$2,$3,$4,$5) id",[subject,field,scope,question,generation])).rows[0].id as string;
 }
 async function fixture() {const subject=await lead();return {subject,task:await task(subject)};}
 async function reserve(contexts=["knows_route"],manual:string|null=null,owner=context().user,request=randomUUID(),surface="route_detail") {
  return (await q(reserveSQL,[owner,request,contexts,surface,manual,manual?(await q("SELECT subject_id FROM v2_question_tasks WHERE id=$1",[manual])).rows[0]?.subject_id:activeSubject])).rows[0].id as string|null;
 }
 async function event(invite:string,outcome="shown",owner=context().user,id=randomUUID(),zone="UTC",when:Date|null=null) {
  return (await q("SELECT v2_prompt_event($1,$2,$3,$4,$5,$6) id",[owner,invite,id,outcome,zone,when])).rows[0].id as string;
 }
 const read=async(i:string,owner=context().user)=>(await q("SELECT v2_prompt_read($1,$2) r",[owner,i])).rows[0].r;
 const eligible=async(t:string,contexts:string[],owner=context().user)=>(await q("SELECT v2_prompt_eligible($1,$2,$3) ok",[t,owner,contexts])).rows[0].ok;
 const resetSession=()=>q("UPDATE v2_prompt_sessions SET last_active_at=clock_timestamp()-interval '31 minutes' WHERE user_id=$1",[context().user]);
 async function answerReport(subject:string,owner=context().user,withReceipt=true,field="boarding.pickup",scope:unknown={}) {
  const c=randomUUID(),client=randomUUID();
  await q("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id,submitted_at) VALUES($1,$2,$3,'1.0','route_detail',$4,'{}',$5,clock_timestamp())",[c,owner,client,hash,subject]);
  const o=(await q("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key) VALUES($1,$2,$3,$4,$5,v2_assessment_hash($5),$6) RETURNING id",[c,subject,field,field==="departure.reported"?{time:"08:00",basis:"unspecified"}:{cityId:context().origin,name:"Synthetic boarding point"},scope,hash])).rows[0].id as string;
  if(withReceipt) await q("INSERT INTO v2_receipts(user_id,client_submission_id,contribution_id,semantic_hash,initial_response) VALUES($1,$2,$3,$4,'{\"status\":\"saved\"}')",[owner,client,c,hash]);
  return {c,o,client};
 }
 const answer=(i:string,o:string,id=randomUUID(),owner=context().user)=>q("SELECT v2_prompt_answer($1,$2,$3,$4) id",[owner,i,id,o]);
 test("prompts: nine reviewed definitions preserve the selected pilot policy",async()=>{
  const r=(await q("SELECT key,priority FROM v2_question_registry ORDER BY priority")).rows;
  assert.deepEqual(r.map(x=>x.key),["identify_service","clarify_time_basis","resolve_conflict_context","operating_days","pickup_place","fare_paid","fare_advertised","complete_pattern","confirm_current_fact"]);
  assert.deepEqual((await q("SELECT * FROM v2_prompt_policies")).rows[0],{version:"prompts/1",session_minutes:30,daily_cap:3,unopened_minutes:15,cooldown_hours:24,unknown_days:30,retention_days:90});
  await invalid(()=>q("UPDATE v2_prompt_policies SET daily_cap=50"));await invalid(()=>q("UPDATE v2_question_registry SET priority=1"));
 });
 test("prompts: typed tasks reject incompatible fields, forged priority, scope and stale generation",async()=>{
  const f=await fixture();await invalid(()=>task(f.subject,"pickup_place","fare.paid"));
  await invalid(()=>q("UPDATE v2_question_tasks SET priority=1 WHERE id=$1",[f.task]));
  await invalid(()=>q("UPDATE v2_question_tasks SET scope_key=$2 WHERE id=$1",[f.task,hash]));
  await invalid(()=>q("SELECT v2_prompt_put_task($1,'boarding.pickup','{}','pickup_place',999)",[f.subject]),["40001"]);
 });
 test("prompts: refreshing the same live task deduplicates; closed tasks cannot revive",async()=>{
  const f=await fixture();assert.equal(await task(f.subject),f.task);
  await q("UPDATE v2_question_tasks SET state='satisfied' WHERE id=$1",[f.task]);await invalid(()=>q("UPDATE v2_question_tasks SET state='open' WHERE id=$1",[f.task]));
  assert.notEqual(await task(f.subject),f.task);
 });
 test("prompts: a new user can volunteer route knowledge without contribution history",async()=>{
  const subject=await lead(context().other),t=await task(subject);assert.equal(await eligible(t,["knows_route"]),true);
  const i=await reserve();assert.ok(i);assert.equal((await read(i)).registryKey,"pickup_place");
  assert.equal((await q("SELECT count(*) FROM v2_contributions WHERE user_id=$1",[context().user])).rows[0].count,"0");
 });
 test("prompts: interest and paid alone never assert travel; own unresolved experience is required",async()=>{
  const subject=await lead(),t=await task(subject,"fare_paid","fare.paid");
  for(const c of [[],["knows_route"],["paid"],["travelled"],["viewed"],["saved"]])assert.equal(await eligible(t,c),false);
  assert.equal(await eligible(t,["paid","travelled"]),true);assert.equal(await eligible(t,["paid","travelled"],context().other),false);
  await invalid(()=>reserve(["viewed"]));await invalid(()=>reserve(["travelled","travelled"]));
 });
 test("prompts: unspecified-clock and stale/conflict questions require real evidence",async()=>{
  const subject=await lead(),t=await task(subject,"clarify_time_basis","departure.reported");
  assert.equal(await eligible(t,["knows_schedule"]),false);await answerReport(subject,context().user,true,"departure.reported");assert.equal(await eligible(t,["knows_schedule"]),true);
  const stale=await task(subject,"confirm_current_fact","boarding.pickup"),disputed=await task(subject,"resolve_conflict_context","boarding.pickup");
  assert.equal(await eligible(stale,["knows_route"]),false);assert.equal(await eligible(disputed,["knows_route","relevant_conflict"]),false);
 });
 test("prompts: deterministic priority chooses unresolved identity before a pickup gap",async()=>{
  const f=await fixture(),identity=await task(f.subject,"identify_service","operator.identity"),i=await reserve();assert.ok(i);assert.equal((await read(i)).taskId,identity);
  assert.equal((await q("SELECT count(*) FROM v2_prompt_events WHERE invitation_id=$1",[i])).rows[0].count,"0");
 });
 test("prompts: declared knowledge and task selection stay bound to the requested service",async()=>{
  const first=await fixture();await task(first.subject,"identify_service","operator.identity");const second=await fixture();
  const i=await reserve();assert.ok(i);assert.equal((await read(i)).subjectId,second.subject);
  await invalid(()=>q(reserveSQL,[context().user,randomUUID(),["knows_route"],"route_detail",null,null]));
 });
 test("prompts: one shared account session cannot be reset by new request IDs or screens",async()=>{
  await fixture();const first=await reserve();assert.ok(first);assert.equal(await reserve(),null);assert.equal(await reserve(["knows_route"],null,context().user,randomUUID(),"search_result"),null);
  const s=(await q("SELECT session_id FROM v2_prompt_sessions WHERE user_id=$1",[context().user])).rows[0].session_id;
  assert.equal((await q("SELECT v2_prompt_touch($1) id",[context().user])).rows[0].id,s);
 });
 test("prompts: a session ends at server inactivity and the rolling daily cap spans sessions",async()=>{
  await fixture();assert.ok(await reserve());await resetSession();assert.ok(await reserve());await resetSession();assert.ok(await reserve());await resetSession();assert.equal(await reserve(),null);
  await q("UPDATE v2_prompt_requests SET created_at=clock_timestamp()-interval '25 hours' WHERE user_id=$1",[context().user]);assert.ok(await reserve());
 });
 test("prompts: receipts make both offered and denied requests idempotent",async()=>{
  await fixture();const id=randomUUID();assert.equal(await reserve(["knows_route"],null,context().user,id),id);assert.equal(await reserve(["knows_route"],null,context().user,id),id);
  await invalid(()=>reserve(["at_stop"],null,context().user,id));await invalid(()=>reserve(["knows_route"],null,context().other,id));
  const denied=randomUUID();assert.equal(await reserve(["knows_route"],null,context().user,denied),null);await resetSession();assert.equal(await reserve(["knows_route"],null,context().user,denied),null);
 });
 test("prompts: explicit opt-out and disabled types suppress unsolicited invitations only",async()=>{
  const f=await fixture();await q("SELECT v2_prompt_set_preferences($1,1,false,'{}')",[context().user]);assert.equal(await reserve(),null);
  assert.ok(await reserve(["knows_route"],f.task));assert.equal((await q("SELECT invitations_enabled FROM v2_prompt_preferences WHERE user_id=$1",[context().user])).rows[0].invitations_enabled,false);
  await q("SELECT v2_prompt_set_preferences($1,2,true,ARRAY['pickup_place'])",[context().user]);assert.equal(await reserve(),null);
  await invalid(()=>q("SELECT v2_prompt_set_preferences($1,2,true,'{}')",[context().user]),["40001"]);await invalid(()=>q("SELECT v2_prompt_set_preferences($1,3,true,ARRAY['not_registered'])",[context().user]));
 });
 test("prompts: manual help is exempt from budgets without clearing account opt-out",async()=>{
  const f=await fixture();assert.ok(await reserve());for(let n=0;n<4;n++)assert.ok(await reserve(["knows_route"],f.task));
  assert.equal((await q("SELECT count(*) FROM v2_prompt_requests WHERE user_id=$1 AND consumed",[context().user])).rows[0].count,"1");
  await q("SELECT v2_prompt_set_preferences($1,1,false,'{}')",[context().user]);await resetSession();assert.equal(await reserve(["knows_route","new_experience"]),null);
 });
 test("prompts: skip/dismiss persist at least 24 hours across timezone and session changes",async()=>{
  const f=await fixture(),i=await reserve();assert.ok(i);await event(i,"skip",context().user,randomUUID(),"Pacific/Kiritimati");
  const until=(await q("SELECT dismissed_until,clock_timestamp()+interval '24 hours' expected FROM v2_prompt_preferences WHERE user_id=$1",[context().user])).rows[0];assert.ok(until.dismissed_until.getTime()>=until.expected.getTime()-1000);
  await resetSession();assert.equal(await reserve(),null);const manual=await reserve(["knows_route"],f.task);assert.ok(manual);await event(manual,"dismiss",context().user,randomUUID(),"America/Los_Angeles");
  assert.ok((await q("SELECT dismissed_until FROM v2_prompt_preferences WHERE user_id=$1",[context().user])).rows[0].dismissed_until>=until.dismissed_until);
  assert.equal((await q("SELECT count(*) FROM v2_observations o JOIN v2_contributions c ON c.id=o.contribution_id WHERE c.user_id=$1",[context().user])).rows[0].count,"0");
 });
 test("prompts: unknown suppresses only the exact fact for 30 days; explicit help can reopen",async()=>{
  const f=await fixture(),i=await reserve();assert.ok(i);await event(i,"unknown");await resetSession();assert.equal(await reserve(),null);
  const r=(await q("SELECT until_time>clock_timestamp()+interval '29 days' bounded FROM v2_prompt_suppressions WHERE user_id=$1",[context().user])).rows[0];assert.equal(r.bounded,true);
  assert.ok(await reserve(["knows_route"],f.task));assert.ok(await reserve(["knows_route","new_experience"]));
  const otherSubject=await lead(),otherTask=await task(otherSubject);assert.ok(await reserve(["knows_route"],otherTask));
 });
 test("prompts: shown/opened are explicit events, retries are stable, no phantom answer",async()=>{
  await fixture();const i=await reserve();assert.ok(i);const id=randomUUID();assert.equal(await event(i,"shown",context().user,id),id);assert.equal(await event(i,"shown",context().user,id),id);
  await invalid(()=>event(i,"opened",context().user,id));await event(i,"opened");assert.equal((await read(i)).status,"opened");
  assert.equal((await q("SELECT count(*) FROM v2_prompt_events WHERE invitation_id=$1 AND outcome='answered'",[i])).rows[0].count,"0");
  await invalid(()=>event(i,"answered"));await invalid(()=>event(i,"skip",context().other),["42501"]);assert.equal((await read(i,context().other)).status,"unavailable");
 });
 test("prompts: a terminal event cannot be contradicted or counted twice",async()=>{
  await fixture();const i=await reserve();assert.ok(i);await event(i,"dismiss");await invalid(()=>event(i,"unknown"));await invalid(()=>event(i,"dismiss"));await invalid(()=>q("UPDATE v2_prompt_events SET outcome='skip' WHERE invitation_id=$1",[i]));
 });
 test("prompts: late unopened invitation expires but still consumes its reservation",async()=>{
  await fixture();const i=await reserve();assert.ok(i);
  // Owner-only fixture ages immutable records; application roles cannot do this.
  await q("ALTER TABLE v2_prompt_invitations DISABLE TRIGGER v2_prompt_invitation_immutable");await q("UPDATE v2_prompt_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[i]);await q("ALTER TABLE v2_prompt_invitations ENABLE TRIGGER v2_prompt_invitation_immutable");
  assert.equal((await read(i)).status,"expired");await invalid(()=>event(i,"opened"));assert.equal(await reserve(),null);
 });
 test("prompts: generation invalidation prevents showing a stale task without a running worker",async()=>{
  const f=await fixture(),i=await reserve();assert.ok(i);await q("UPDATE v2_subjects SET input_generation=input_generation+1 WHERE id=$1",[f.subject]);
  assert.equal((await read(i)).status,"obsolete");assert.equal(await eligible(f.task,["knows_route"]),false);await invalid(()=>event(i,"opened"));assert.notEqual(await task(f.subject),f.task);
 });
 test("prompts: an answer requires an owned saved receipt and the exact field and scope",async()=>{
  const f=await fixture(),i=await reserve();assert.ok(i);const unsaved=await answerReport(f.subject,context().user,false);await invalid(()=>answer(i,unsaved.o));
  const foreign=await answerReport(f.subject,context().other);await invalid(()=>answer(i,foreign.o));
  const wrong=await answerReport(f.subject,context().user,true,"departure.reported");await invalid(()=>answer(i,wrong.o));
  const r=await answerReport(f.subject);const id=randomUUID();assert.equal((await answer(i,r.o,id)).rows[0].id,id);assert.equal((await answer(i,r.o,id)).rows[0].id,id);assert.equal((await read(i)).status,"answered");
 });
 test("prompts: compatible independent late answers survive task completion and another generation",async()=>{
  const f=await fixture(),i=await reserve();assert.ok(i);await q("UPDATE v2_question_tasks SET state='satisfied' WHERE id=$1",[f.task]);await q("UPDATE v2_subjects SET input_generation=input_generation+1 WHERE id=$1",[f.subject]);
  const r=await answerReport(f.subject);await answer(i,r.o);assert.equal((await read(i)).status,"answered");
 });
 test("prompts: changed service identity requires reconfirmation and preserves the saved evidence",async()=>{
  const f=await fixture(),i=await reserve();assert.ok(i);await q("UPDATE v2_leads SET operator_name='Different company' WHERE subject_id=$1",[f.subject]);const r=await answerReport(f.subject);
  assert.equal((await read(i)).status,"reconfirm_identity");await invalid(()=>answer(i,r.o),["40001"]);assert.equal((await q("SELECT count(*) FROM v2_receipts WHERE contribution_id=$1",[r.c])).rows[0].count,"1");
 });
 test("prompts: revoking invitations after reservation is enforced by the read/open gate",async()=>{
  await fixture();const i=await reserve();assert.ok(i);await q("SELECT v2_prompt_set_preferences($1,1,false,'{}')",[context().user]);assert.equal((await read(i)).status,"suppressed");await invalid(()=>event(i,"shown"));
 });
 test("prompts: erasing evidence removes task content but cannot refund another user's cap",async()=>{
  const f=await fixture(),r=await answerReport(f.subject),i=await reserve(["knows_route"],null,context().other);assert.ok(i);
  await q("DELETE FROM v2_contributions WHERE id=$1",[r.c]);assert.equal((await read(i,context().other)).status,"unavailable");
  const request=(await q("SELECT consumed,request_digest FROM v2_prompt_requests WHERE id=$1",[i])).rows[0];assert.deepEqual(request,{consumed:true,request_digest:null});
  await task(f.subject);assert.equal(await reserve(["knows_route"],null,context().other),null);await invalid(()=>reserve(["knows_route"],null,context().other,i));
 });
 test("prompts: deleting an account cascades every private prompt row and preserves another account",async()=>{
  const f=await fixture(),i=await reserve();assert.ok(i);await event(i,"unknown");const other=await reserve(["knows_route"],f.task,context().other);assert.ok(other);
  await q("DELETE FROM users WHERE id=$1",[context().user]);await q("SET CONSTRAINTS ALL IMMEDIATE");
  for(const table of ["v2_prompt_preferences","v2_prompt_suppressions","v2_prompt_sessions","v2_prompt_requests","v2_prompt_invitations","v2_prompt_events"])assert.equal((await q(`SELECT count(*) FROM ${table} WHERE user_id=$1`,[context().user])).rows[0].count,"0");
  assert.equal((await q("SELECT count(*) FROM v2_prompt_requests WHERE user_id=$1",[context().other])).rows[0].count,"1");await invalid(()=>reserve(),["42501"]);
 });
 test("prompts: retention aggregates exactly once without account or subject linkage",async()=>{
  await fixture();const i=await reserve();assert.ok(i);await event(i,"shown");await event(i,"opened");
  const before=(await q("SELECT COALESCE(sum(count),0)::text n FROM v2_prompt_metrics")).rows[0].n;
  await q("ALTER TABLE v2_prompt_invitations DISABLE TRIGGER v2_prompt_invitation_immutable");await q("UPDATE v2_prompt_invitations SET reserved_at=clock_timestamp()-interval '91 days' WHERE id=$1",[i]);await q("ALTER TABLE v2_prompt_invitations ENABLE TRIGGER v2_prompt_invitation_immutable");
  await q("UPDATE v2_prompt_requests SET created_at=clock_timestamp()-interval '91 days' WHERE id=$1",[i]);await q("SELECT v2_prompt_prune()");await q("SELECT v2_prompt_prune()");
  assert.equal(Number((await q("SELECT COALESCE(sum(count),0)::text n FROM v2_prompt_metrics")).rows[0].n)-Number(before),2);
  assert.equal((await q("SELECT count(*) FROM v2_prompt_requests WHERE id=$1",[i])).rows[0].count,"0");
  assert.deepEqual((await q("SELECT column_name FROM information_schema.columns WHERE table_name='v2_prompt_metrics' ORDER BY column_name")).rows.map(x=>x.column_name),["count","outcome","policy_version","registry_key"]);
 });
 test("prompts: inactive/deleting users and arbitrary timezones cannot create prompt state",async()=>{
  await fixture();await invalid(()=>reserve(["knows_route"],null,randomUUID()),["42501"]);const i=await reserve();assert.ok(i);await invalid(()=>event(i,"skip",context().user,randomUUID(),"invented/timezone"));
  await q("INSERT INTO auth_deletion_jobs(user_id) VALUES($1)",[context().user]);await invalid(()=>reserve(),["42501"]);assert.equal((await read(i)).status,"unavailable");
 });
 test("prompts: client roles are denied and backend has no raw writes or impersonation functions",async()=>{
  for(const table of promptTables.map(getTableName)) {
   const privileges=(await q("SELECT has_table_privilege('mabhazi_api',$1,'SELECT') read,has_table_privilege('mabhazi_api',$1,'INSERT,UPDATE,DELETE') write,has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') anon,has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') client",[table])).rows[0];
   assert.deepEqual(privileges,{read:true,write:false,anon:false,client:false});
  }
  const functions=(await q("SELECT oid::regprocedure::text name,has_function_privilege('mabhazi_api',oid,'EXECUTE') backend,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') client FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'v2_prompt_%'")).rows;
  assert.ok(functions.length>10);for(const f of functions)assert.deepEqual([f.backend,f.anon,f.client],[false,false,false],f.name);
 });
 for(const level of ["READ COMMITTED","REPEATABLE READ"]) test(`prompts: two-device reservation race is atomic at ${level}`,async()=>{
  await fixture();const owner=context().user;await q("COMMIT");const second=new pg.Client({connectionString:context().connectionString});await second.connect();
  try {
   await q(`BEGIN ISOLATION LEVEL ${level}`);await second.query(`BEGIN ISOLATION LEVEL ${level}`);await second.query("SELECT count(*) FROM v2_prompt_requests");
   const a=(await q(reserveSQL,[owner,randomUUID(),["knows_route"],"route_detail",null,activeSubject])).rows[0].id;assert.ok(a);
   let completed=false;const pending=second.query(reserveSQL,[owner,randomUUID(),["knows_route"],"search_result",null,activeSubject]).then(r=>({r,code:null as string|null}),e=>({r:null,code:String(e.code)})).finally(()=>{completed=true;});
   await new Promise(resolve=>setTimeout(resolve,75));assert.equal(completed,false);await q("COMMIT");const b=await pending;
   if(level==="REPEATABLE READ"){assert.equal(b.code,"40001");await second.query("ROLLBACK");}else{assert.equal(b.code,null);assert.equal(b.r!.rows[0].id,null);await second.query("COMMIT");}
   assert.equal((await q("SELECT count(*) FROM v2_prompt_requests WHERE user_id=$1 AND consumed",[owner])).rows[0].count,"1");
  }finally{await second.query("ROLLBACK");await second.end();await q("ROLLBACK");}
 });
}
