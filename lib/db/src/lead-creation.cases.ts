import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const terms = "2026-09-12";
export function registerLeadCreationTests(context: () => Context) {
  const q = (sql: string, args: unknown[] = []) => context().db.query(sql,args);
  const body = (key: string = randomUUID()) => ({schemaVersion:"1.0",clientSubmissionId:key,entrySurface:"contribute_tab",target:{newLead:{originCityId:context().origin,destinationCityId:context().destination,departureTime:"08:00",operator:{name:"Reported bus"}}},observations:[] as unknown[]});
  const accept = (owner=context().user) => q("UPDATE users SET terms_accepted_version=$2,terms_accepted_at=statement_timestamp() WHERE id=$1",[owner,terms]);
  const submit = async (input: unknown,owner=context().user) => (await q("SELECT v2_submit_lead($1,$2,$3) result",[owner,terms,input])).rows[0].result;
  async function invalid(action: () => Promise<unknown>,codes=["23514"]) {
    await q("SAVEPOINT invalid_lead");
    try { await assert.rejects(action,(e:unknown)=>{assert.ok(e instanceof Error && "code" in e);assert.ok(codes.includes(String(e.code)),`${String(e.code)}: ${e.message}`);return true;}); }
    finally {await q("ROLLBACK TO SAVEPOINT invalid_lead");await q("RELEASE SAVEPOINT invalid_lead");}
  }
  const counts = async () => (await q(`SELECT (SELECT count(*) FROM v2_contributions) c,(SELECT count(*) FROM v2_subjects) s,
    (SELECT count(*) FROM v2_observations) o,(SELECT count(*) FROM v2_jobs) j,(SELECT count(*) FROM v2_subject_revisions) r,(SELECT count(*) FROM v2_receipts) receipts`)).rows[0];
  test("creation: four answers save two unreviewed facts, revision1 origin, receipt and final-generation job without fare or calendar",async()=>{
    await accept();const input=body(),result=await submit(input),id=result.subjectId;
    assert.deepEqual({...result,contributionId:"cid",subjectId:"sid",clientSubmissionId:"key"},{contributionId:"cid",subjectId:"sid",clientSubmissionId:"key",saveStatus:"saved",processingStatus:"queued",associationStatus:"unresolved",publicationStatus:"pending",replayed:false});
    const lead=(await q("SELECT * FROM v2_leads WHERE subject_id=$1",[id])).rows[0];assert.equal(lead.reported_departure_seconds,28800);assert.equal(lead.operator_name,"Reported bus");assert.equal(lead.operator_subject_id,null);
    const observations=(await q("SELECT * FROM v2_observations WHERE contribution_id=$1 ORDER BY field_key",[result.contributionId])).rows;
    assert.equal(observations.length,2);assert.equal(observations[0].field_key,"departure.reported");assert.equal(observations[0].value.basis,"unspecified");
    for(const o of observations){assert.equal(o.knowledge_basis,"unprovided");assert.equal(o.observed_from,null);assert.equal(o.effective_from,null);assert.equal((await q("SELECT v2_observation_subject($1) id",[o.id])).rows[0].id,id);assert.equal((await q("SELECT count(*) FROM v2_observation_events WHERE observation_id=$1 AND action='submit'",[o.id])).rows[0].count,"1");assert.equal((await q("SELECT scope_key=v2_assessment_hash(scope) AND value_key=v2_assessment_hash(value) valid FROM v2_observations WHERE id=$1",[o.id])).rows[0].valid,true);}
    const revision=(await q("SELECT * FROM v2_subject_revisions WHERE subject_id=$1",[id])).rows[0];assert.equal(revision.revision,"1");assert.equal(revision.origin_kind,"contribution");assert.equal(revision.initial_contribution_id,result.contributionId);assert.equal(revision.decision_id,null);assert.equal(revision.snapshot.data.initial_contribution_id,undefined);
    const job=(await q("SELECT j.*,s.input_generation FROM v2_jobs j JOIN v2_subjects s ON s.id=j.subject_id WHERE j.contribution_id=$1",[result.contributionId])).rows[0];assert.equal(job.kind,"normalise");assert.equal(job.requested_generation,job.input_generation);assert.equal(job.state,"pending");
    assert.equal((await q("SELECT v2_read_transport($1) result",[id])).rows[0].result.status,"unreviewed");await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  for(const missing of ["originCityId","destinationCityId","departureTime","operator"]) test(`creation: missing ${missing} leaves no writes`,async()=>{
    await accept();const input=body(),before=await counts();delete (input.target.newLead as Record<string,unknown>)[missing];await invalid(()=>submit(input));assert.deepEqual(await counts(),before);
  });
  for(const clock of ["24:00","8:00","Leaves when full","08:00:00"]) test(`creation: invalid clock ${clock} is not a schedule or midnight default`,async()=>{await accept();const input=body();input.target.newLead.departureTime=clock;await invalid(()=>submit(input));});
  test("creation: absent or outdated Terms and missing account cannot create a receipt",async()=>{
    const before=await counts();await invalid(()=>submit(body()),["42501"]);await q("UPDATE users SET terms_accepted_version='old',terms_accepted_at=now() WHERE id=$1",[context().user]);await invalid(()=>submit(body()),["42501"]);await invalid(()=>submit(body(),randomUUID()),["23503"]);assert.deepEqual(await counts(),before);
  });
  test("creation: strict public envelope rejects legacy bypass, actor, statuses and unknown context",async()=>{
    await accept();for(const extra of [{userId:context().other},{publicationStatus:"scheduled"},{sourceDescriptors:[]},{leadContext:{verified:true}},{leadContext:{knowledgeBasis:"legacy_import"}},{leadContext:{observedDate:null}},{target:{existing:{subjectId:randomUUID(),expectedRevision:1}}},{schemaVersion:"2.0"},{entrySurface:"legacy_import"}])await invalid(()=>submit({...body(),...extra}));
  });
  test("creation: distinct existing cities and active typed operator references are required",async()=>{
    await accept();const input=body();input.target.newLead.destinationCityId=context().origin;await invalid(()=>submit(input));input.target.newLead.destinationCityId=999999999;await invalid(()=>submit(input),["23503"]);
    const op=randomUUID();await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'operator')",[op]);await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Resolved name')",[op]);
    const selected={...body(),target:{newLead:{...body().target.newLead,operator:{id:op.toUpperCase()}}}};const r=await submit(selected);assert.equal((await q("SELECT operator_subject_id,operator_name FROM v2_leads WHERE subject_id=$1",[r.subjectId])).rows[0].operator_subject_id,op);
    await q("UPDATE v2_subjects SET lifecycle='retired' WHERE id=$1",[op]);await invalid(()=>submit({...selected,clientSubmissionId:randomUUID()}),["23503"]);
    assert.equal((await submit({...selected,target:{newLead:{...selected.target.newLead,operator:{id:op}}}})).replayed,true);
  });
  test("creation: name is exact reported text, never implicit operator identity",async()=>{
    await accept();const before=(await q("SELECT count(*) FROM v2_operators")).rows[0].count;const a=await submit(body()),b=await submit(body());assert.notEqual(a.subjectId,b.subjectId);assert.equal((await q("SELECT count(*) FROM v2_operators")).rows[0].count,before);
    for(const name of ["unknown","N/A","-"," bus ","bus\ncompany"]){const input=body();input.target.newLead.operator.name=name;await invalid(()=>submit(input));}
  });
  test("creation: declared core context dates and time basis are retained without calendar promotion",async()=>{
    await accept();const result=await submit({...body(),leadContext:{knowledgeBasis:"travelled",observedDate:"2026-10-01",timeBasis:"actual"}});
    const o=(await q("SELECT value,knowledge_basis,observed_from FROM v2_observations WHERE contribution_id=$1 AND field_key='departure.reported'",[result.contributionId])).rows[0];assert.equal(o.value.basis,"actual");assert.equal(o.knowledge_basis,"travelled");assert.ok(o.observed_from);assert.equal((await q("SELECT kind FROM v2_subjects WHERE id=$1",[result.subjectId])).rows[0].kind,"lead");
    await invalid(()=>submit({...body(),leadContext:{observedDate:"2026-02-30"}}));await invalid(()=>submit({...body(),leadContext:{observedDate:"9999-12-31"}}));
  });
  test("creation: optional explicit free fare survives with scope/date and canonical hash",async()=>{
    await accept();const input=body();input.observations=[{fieldKey:"fare.paid",value:{amount:"0",currency:"USD"},scope:{schemaVersion:"1.0",segment:{kind:"city_pair",originCityId:context().origin,destinationCityId:context().destination},serviceDate:"2026-10-01",passengerCategory:"adult",ticketBasis:"one_way"},knowledgeBasis:"travelled",observedDate:"2026-10-01"}];
    const result=await submit(input),o=(await q("SELECT * FROM v2_observations WHERE contribution_id=$1 AND field_key='fare.paid'",[result.contributionId])).rows[0];assert.deepEqual(o.value,{amount:"0",currency:"USD"});assert.equal(o.scope.serviceDate,"2026-10-01");await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("creation: an invalid optional fact rolls back lead, origin, core facts and job",async()=>{
    await accept();const input=body(),before=await counts();input.observations=[{fieldKey:"fare.paid",value:{amount:"5",currency:"USD"},scope:{}}];await invalid(()=>submit(input));assert.deepEqual(await counts(),before);const result=await submit({...input,observations:[]});assert.equal(result.replayed,false);
  });
  test("creation: duplicate core, extra optional keys, invalid dates and reserved import reject whole intake",async()=>{
    await accept();for(const item of [{fieldKey:"departure.reported",value:{time:"08:00",basis:"scheduled"},scope:{}},{fieldKey:"boarding.pickup",value:{cityId:context().origin,name:"Place"},scope:{},verified:true},{fieldKey:"boarding.pickup",value:{cityId:context().origin,name:"Place"},scope:{},knowledgeBasis:"legacy_import"},{fieldKey:"boarding.pickup",value:{cityId:context().origin,name:"Place"},scope:{},observedDateEnd:"2026-10-01"},{fieldKey:"boarding.pickup",value:{cityId:context().origin,name:"Place"},scope:{},observedDate:"2026-02-30"}]){const before=await counts();await invalid(()=>submit({...body(),observations:[item]}));assert.deepEqual(await counts(),before);}
  });
  test("creation: owned existing citations are kept private and other-account IDs reject atomically",async()=>{
    await accept();const owned=(await q("INSERT INTO v2_sources(owner_user_id,kind,private_reference) VALUES($1,'document','private://reported-proof') RETURNING id",[context().user])).rows[0].id;
    const foreign=(await q("INSERT INTO v2_sources(owner_user_id,kind) VALUES($1,'document') RETURNING id",[context().other])).rows[0].id;
    const item={fieldKey:"boarding.pickup",value:{cityId:context().origin,name:"Place"},scope:{},sources:[owned]};const result=await submit({...body(),observations:[item]});assert.ok(!JSON.stringify(result).includes("private://"));assert.equal((await q("SELECT count(*) FROM v2_observation_sources os JOIN v2_observations o ON o.id=os.observation_id WHERE o.contribution_id=$1",[result.contributionId])).rows[0].count,"1");
    const before=await counts();await invalid(()=>submit({...body(),observations:[{...item,sources:[foreign]}]}),["42501"]);await invalid(()=>submit({...body(),observations:[{...item,sources:[{kind:"document"}]}]}));assert.deepEqual(await counts(),before);
  });
  test("creation: size and observation limits reject without successful key reservation",async()=>{
    await accept();const before=await counts();await invalid(()=>submit({...body(),observations:Array(21).fill({})}));await invalid(()=>submit({...body(),leadContext:{knowledgeBasis:"x".repeat(65536)}}));assert.deepEqual(await counts(),before);
  });
  test("creation: default normalization/key order replay once, changed body conflicts",async()=>{
    await accept();const input=body(),first=await submit(input),before=await counts();const replay=await submit({...input,leadContext:{timeBasis:"unspecified",knowledgeBasis:"unprovided"}});assert.deepEqual(replay,{...first,replayed:true});assert.deepEqual(await counts(),before);input.target.newLead.departureTime="09:00";await invalid(()=>submit(input));assert.deepEqual(await counts(),before);
  });
  test("creation: same retry key remains account scoped without public reputation requirements",async()=>{
    await accept();await accept(context().other);const input=body(),a=await submit(input),b=await submit(input,context().other);assert.notEqual(a.contributionId,b.contributionId);assert.notEqual(a.subjectId,b.subjectId);
  });
  test("creation: withdrawal then retry never restores the observation or creates work",async()=>{
    await accept();const input=body(),r=await submit(input),o=(await q("SELECT id FROM v2_observations WHERE contribution_id=$1 LIMIT 1",[r.contributionId])).rows[0].id;
    await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)",[context().user,o,randomUUID()]);const before=await counts();assert.equal((await submit(input)).replayed,true);assert.equal((await q("SELECT status FROM v2_observation_states WHERE observation_id=$1",[o])).rows[0].status,"withdrawn");assert.deepEqual(await counts(),before);
  });
  test("creation: deleting core evidence redacts its origin copy without erasing another account's report",async()=>{
    await accept();await accept(context().other);const a=await submit(body()),b=await submit(body(),context().other);
    await q("DELETE FROM v2_observations WHERE contribution_id=$1 AND field_key='operator.reported'",[a.contributionId]);const snapshot=(await q("SELECT origin_kind,snapshot,initial_contribution_id FROM v2_subject_revisions WHERE subject_id=$1",[a.subjectId])).rows[0];assert.deepEqual(snapshot,{origin_kind:"erased",snapshot:null,initial_contribution_id:null});assert.equal((await q("SELECT origin_kind FROM v2_subject_revisions WHERE subject_id=$1",[b.subjectId])).rows[0].origin_kind,"contribution");await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("creation: account erasure removes private input/receipt/events and redacts origin, cancels original job",async()=>{
    await accept();const result=await submit(body());const originalJobs=(await q("SELECT id FROM v2_jobs WHERE subject_id=$1 AND kind='normalise'",[result.subjectId])).rows.map(r=>r.id);assert.ok(originalJobs.length>0);await q("DELETE FROM users WHERE id=$1",[context().user]);assert.equal((await q("SELECT count(*) FROM v2_receipts WHERE contribution_id=$1",[result.contributionId])).rows[0].count,"0");assert.equal((await q("SELECT count(*) FROM v2_observations WHERE contribution_id=$1",[result.contributionId])).rows[0].count,"0");assert.equal((await q("SELECT snapshot FROM v2_subject_revisions WHERE subject_id=$1",[result.subjectId])).rows[0].snapshot,null);const cancelled=(await q("SELECT id,state,contribution_id FROM v2_jobs WHERE id=ANY($1::uuid[])",[originalJobs])).rows;assert.equal(cancelled.length,originalJobs.length);assert.ok(cancelled.every(row=>row.state==="superseded"&&row.contribution_id===null),JSON.stringify(cancelled));assert.equal((await q("SELECT initial_contribution_id FROM v2_leads WHERE subject_id=$1",[result.subjectId])).rows[0].initial_contribution_id,null);await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("creation: caller rollback leaves no durable successful result",async()=>{
    await accept();const input=body(),before=await counts();await q("SAVEPOINT cancelled_intake");await submit(input);await q("ROLLBACK TO SAVEPOINT cancelled_intake");await q("RELEASE SAVEPOINT cancelled_intake");assert.deepEqual(await counts(),before);assert.equal((await submit(input)).replayed,false);
  });
  test("creation: assembly works with immediate constraints and backend/client roles cannot invoke owner writers",async()=>{
    await accept();await q("SET CONSTRAINTS ALL IMMEDIATE");await submit(body());for(const role of ["mabhazi_api","anon","authenticated"]){await q(`SET LOCAL ROLE ${role}`);await invalid(()=>submit(body()),["42501"]);await invalid(()=>q("SELECT v2_erase_lead_origin()"),["42501"]);await q("RESET ROLE");}
  });
  for(const isolation of ["READ COMMITTED","REPEATABLE READ"]) test(`creation: concurrent identical requests at ${isolation} commit one receipt or require serialization retry`,{timeout:20_000},async()=>{
    await accept();const input=body();await q("COMMIT");const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString});await left.connect();await right.connect();
    try{await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query("SET LOCAL statement_timeout='5s'");await right.query("SELECT count(*) FROM v2_receipts");const first=(await left.query("SELECT v2_submit_lead($1,$2,$3) r",[context().user,terms,input])).rows[0].r;
      const pending=right.query("SELECT v2_submit_lead($1,$2,$3) r",[context().user,terms,input]).then(r=>({result:r.rows[0].r,code:null}),e=>({result:null,code:e.code}));await left.query("COMMIT");const second=await pending;
      if(isolation==="READ COMMITTED"){assert.deepEqual(second.result,{...first,replayed:true});await right.query("COMMIT");}else{assert.equal(second.code,"40001");await right.query("ROLLBACK");assert.deepEqual((await right.query("SELECT v2_submit_lead($1,$2,$3) r",[context().user,terms,input])).rows[0].r,{...first,replayed:true});}
      assert.equal((await left.query("SELECT count(*) FROM v2_contributions WHERE user_id=$1 AND client_submission_id=$2",[context().user,input.clientSubmissionId])).rows[0].count,"1");
    }finally{await left.query("ROLLBACK");await right.query("ROLLBACK");await left.end();await right.end();await q("BEGIN");}
  });
}
