import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { getTableName } from "drizzle-orm";
import { affiliationIssuerTables } from "./schema/affiliationIssuers";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const reviewSQL = "SELECT v2_review_affiliation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id";
const issuerSQL = "SELECT v2_record_source_issuer($1,$2,$3,$4,$5,$6,$7) id";
const key = "a".repeat(64);
export function registerAffiliationTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_affiliation");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_affiliation"); await q("RELEASE SAVEPOINT invalid_affiliation"); }
  }
  async function operator() {
    const id = randomUUID(); await q("SET CONSTRAINTS ALL DEFERRED");
    await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'operator')", [id]);
    await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Synthetic company')", [id]); return id;
  }
  async function claim(op: string, who = context().user, request = randomUUID()) {
    return (await q("SELECT v2_claim_affiliation($1,$2,'operations representative',$3) id", [who, op, request])).rows[0].id as string;
  }
  async function dates() {
    return (await q("SELECT statement_timestamp()-interval '1 day' observed,statement_timestamp()+interval '90 days' expires,statement_timestamp()+interval '30 days' until_time")).rows[0] as { observed: Date; expires: Date; until_time: Date };
  }
  async function proof(c: string, owner = context().user) {
    const t = await dates(), request = randomUUID();
    const values = [owner,c,"authorization_document",t.observed,t.expires,"private://synthetic/affiliation",request];
    const id = (await q("SELECT v2_add_affiliation_proof($1,$2,$3,$4,$5,$6,$7) id",values)).rows[0].id as string;
    return { id, values, ...t };
  }
  async function fixture() {
    const op = await operator(), c = await claim(op), p = await proof(c);
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','fixture') ON CONFLICT DO NOTHING",[context().other]);
    return { op, c, p };
  }
  async function reviewArgs(c: string, proofs: string[], operation = "verify_affiliation", until: Date | null = null, reverse: string | null = null) {
    const r = (await q("SELECT r.revision,s.revision subject_revision FROM v2_affiliation_claims c JOIN v2_review_cases r ON r.id=c.case_id JOIN v2_subjects s ON s.id=c.operator_subject_id WHERE c.id=$1",[c])).rows[0];
    return [context().other,c,r.revision,r.subject_revision,operation,proofs,until,"proof_inspected","Synthetic private rationale",randomUUID(),reverse];
  }
  async function review(f: Awaited<ReturnType<typeof fixture>>, operation = "verify_affiliation", reverse: string | null = null) {
    return (await q(reviewSQL,await reviewArgs(f.c,operation==="verify_affiliation"?[f.p.id]:[],operation,operation==="verify_affiliation"?f.p.until_time:null,reverse))).rows[0].id as string;
  }
  const read = async(c: string) => (await q("SELECT v2_read_affiliation($1) r",[c])).rows[0].r;
  const readIssuer = async(s: string) => (await q("SELECT v2_read_source_issuer($1) r",[s])).rows[0].r;
  async function source(owner = context().user, kind = "operator_statement") {
    return (await q("INSERT INTO v2_sources(owner_user_id,kind,private_reference) VALUES($1,$2,'private://synthetic/source') RETURNING id",[owner,kind])).rows[0].id as string;
  }
  async function issuer(s: string, op: string | null, affiliation: string | null, expected = 0, operation = "claim", request = randomUUID()) {
    return (await q(issuerSQL,[context().user,s,expected,operation,op,affiliation,request])).rows[0].id as string;
  }
  async function report(s: string) {
    const id=randomUUID(),contribution=randomUUID(); await q("SET CONSTRAINTS ALL DEFERRED");
    await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')",[id]);
    await q("INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)",[contribution,context().user,key,id]);
    await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Synthetic company',$3)",[id,context().corridor,contribution]);
    const o=(await q("INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key) VALUES($1,$2,'departure.reported','{\"time\":\"08:00\",\"basis\":\"scheduled\"}',$3,$3) RETURNING id",[contribution,id,key])).rows[0].id as string;
    await q("INSERT INTO v2_observation_sources(observation_id,source_id) VALUES($1,$2)",[o,s]); return { id,o };
  }
  test("affiliation: a claim grants no role, company badge or source confidence",async()=>{
    const op=await operator(),c=await claim(op);assert.equal((await read(c)).status,"pending");
    assert.equal((await q("SELECT count(*) FROM v2_review_roles WHERE user_id=$1",[context().user])).rows[0].count,"0");
    assert.equal((await q("SELECT affiliation_status FROM v2_operators WHERE subject_id=$1",[op])).rows[0].affiliation_status,"unverified");
    await invalid(()=>q("UPDATE v2_operators SET affiliation_status='verified' WHERE subject_id=$1",[op]));
  });
  test("affiliation: exact claim retry is stable and duplicate account/operator claims reject",async()=>{
    const op=await operator(),r=randomUUID(),c=await claim(op,context().user,r);assert.equal(await claim(op,context().user,r),c);
    await invalid(()=>q("SELECT v2_claim_affiliation($1,$2,'driver',$3)",[context().user,op,r]));
    await invalid(()=>claim(op),["23505"]);await invalid(()=>claim(randomUUID()),["23503"]);
  });
  test("affiliation: proof is dedicated, dated, bounded and tied to its claimant or administrator",async()=>{
    const op=await operator(),c=await claim(op),t=await dates();
    const add=(owner:string,kind:string,observed:Date,expires:Date)=>q("SELECT v2_add_affiliation_proof($1,$2,$3,$4,$5,'private://proof',$6)",[owner,c,kind,observed,expires,randomUUID()]);
    await invalid(()=>add(context().other,"authorization_document",t.observed,t.expires));
    await invalid(()=>add(context().user,"route_report",t.observed,t.expires));
    await invalid(()=>add(context().user,"authorization_document",t.expires,new Date(t.expires.getTime()+86400000)));
    await invalid(()=>add(context().user,"authorization_document",t.observed,new Date(t.observed.getTime()+181*86400000)));
  });
  test("affiliation: reviewers and self-reviewing administrators cannot approve",async()=>{
    const f=await fixture(),args=await reviewArgs(f.c,[f.p.id],"verify_affiliation",f.p.until_time);
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'administrator','fixture')",[context().user]);
    await invalid(()=>q(reviewSQL,args.map((v,i)=>i===0?context().user:v)),["42501"]);
    const reviewer=randomUUID();await q("INSERT INTO users(id) VALUES($1)",[reviewer]);await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture')",[reviewer]);
    await invalid(()=>q(reviewSQL,args.map((v,i)=>i===0?reviewer:v)),["42501"]);
  });
  test("affiliation: verification requires exact nonduplicate proof and cannot outlive it",async()=>{
    const f=await fixture(),otherClaim=await claim(await operator()),foreign=await proof(otherClaim);
    for(const ids of [[],[foreign.id],[f.p.id,f.p.id],[randomUUID()]]) await invalid(async()=>q(reviewSQL,await reviewArgs(f.c,ids,"verify_affiliation",f.p.until_time)));
    await invalid(async()=>q(reviewSQL,await reviewArgs(f.c,[f.p.id],"verify_affiliation",new Date(f.p.expires.getTime()+1))));
  });
  test("affiliation: verified relationship has a deadline and public read omits private identity",async()=>{
    const f=await fixture(),d=await review(f),r=await read(f.c);assert.equal(r.status,"verified_affiliation");assert.equal(Date.parse(r.validUntil),f.p.until_time.getTime());
    const serial=JSON.stringify(r);for(const secret of [context().user,context().other,f.p.id,"private://","rationale"])assert.ok(!serial.includes(secret));
    const job=(await q("SELECT available_at FROM v2_jobs WHERE trigger_id=$1 AND kind='assess'",[d])).rows[0];assert.equal(job.available_at.getTime(),f.p.until_time.getTime());
    assert.equal((await q("SELECT v2_read_affiliation_at($1,$2) r",[f.c,f.p.until_time])).rows[0].r.status,"recheck_required");
  });
  test("affiliation: revocation and reversing revocation never revive an older approval",async()=>{
    const f=await fixture(),approved=await review(f),revoked=await review(f,"revoke_affiliation");assert.equal((await read(f.c)).status,"revoked");
    await invalid(()=>review(f,"reverse",approved));await review(f,"reverse",revoked);assert.equal((await read(f.c)).status,"pending");
  });
  test("affiliation: exact review retries are receipts after revoke and changed payload rejects",async()=>{
    const f=await fixture(),args=await reviewArgs(f.c,[f.p.id],"verify_affiliation",f.p.until_time),d=(await q(reviewSQL,args)).rows[0].id;
    assert.equal((await q(reviewSQL,args)).rows[0].id,d);await review(f,"revoke_affiliation");assert.equal((await q(reviewSQL,args)).rows[0].id,d);assert.equal((await read(f.c)).status,"revoked");
    await invalid(()=>q(reviewSQL,args.map((v,i)=>i===8?"changed":v)));
  });
  test("affiliation: stale case or operator revision cannot overwrite a review",async()=>{
    const f=await fixture(),args=await reviewArgs(f.c,[f.p.id],"verify_affiliation",f.p.until_time);await review(f);
    await invalid(()=>q(reviewSQL,args),["40001"]);
    const fresh=await reviewArgs(f.c,[],"revoke_affiliation");await invalid(()=>q(reviewSQL,fresh.map((v,i)=>i===3?1:v)),["40001"]);
  });
  test("affiliation: raw history edits and late proof attachment reject",async()=>{
    const f=await fixture(),d=await review(f),p=await proof(f.c);
    await invalid(()=>q("UPDATE v2_affiliation_claims SET claimed_role='director' WHERE id=$1",[f.c]));
    await invalid(()=>q("UPDATE v2_affiliation_proofs SET private_reference='replacement' WHERE id=$1",[f.p.id]));
    await invalid(()=>q("UPDATE v2_affiliation_resolutions SET valid_until=valid_until+interval '1 day' WHERE review_id=$1",[d]));
    await invalid(()=>q("INSERT INTO v2_affiliation_resolution_proofs(review_id,proof_id) VALUES($1,$2)",[d,p.id]));
  });
  test("affiliation: erased proof receipts cannot be replayed into new proof",async()=>{
    const f=await fixture();assert.equal((await q("SELECT v2_add_affiliation_proof($1,$2,$3,$4,$5,$6,$7) id",f.p.values)).rows[0].id,f.p.id);
    await q("SELECT v2_erase_affiliation_proof($1,$2)",[context().user,f.p.id]);
    await invalid(()=>q("SELECT v2_add_affiliation_proof($1,$2,$3,$4,$5,$6,$7)",f.p.values));
    const p=(await q("SELECT * FROM v2_affiliation_proofs WHERE id=$1",[f.p.id])).rows[0];assert.equal(p.erased,true);assert.equal(p.owner_user_id,null);assert.equal(p.private_reference,null);assert.equal(p.request_digest,null);
  });
  test("issuer: a source owner can name an issuer without gaining affiliation",async()=>{
    const s=await source(),op=await operator();await issuer(s,op,null);assert.deepEqual(await readIssuer(s),{operatorId:op,status:"issuer_claimed",validUntil:null});
    await invalid(()=>q(issuerSQL,[context().other,s,1,"claim",op,null,randomUUID()]),["42501"]);
    await invalid(async()=>issuer(await source(context().user,"hearsay"),op,null),["42501"]);
  });
  test("issuer: affiliation binds the exact submitting account and named company",async()=>{
    const f=await fixture(),d=await review(f),s=await source();await issuer(s,f.op,d);assert.equal((await readIssuer(s)).status,"affiliated_submitter");
    await invalid(async()=>issuer(await source(),await operator(),d));
    const another=await source(context().other);await invalid(()=>q(issuerSQL,[context().other,another,0,"claim",f.op,d,randomUUID()]));
    assert.equal((await q("SELECT v2_read_source_issuer_at($1,$2) r",[s,f.p.until_time])).rows[0].r.status,"issuer_claimed");
  });
  test("issuer: issuer correction and withdrawal append history and retries never restore it",async()=>{
    const s=await source(),op=await operator(),r=randomUUID(),d=await issuer(s,op,null,0,"claim",r);
    await issuer(s,null,null,1,"withdraw");assert.equal((await readIssuer(s)).status,"unknown");assert.equal(await issuer(s,op,null,0,"claim",r),d);assert.equal((await readIssuer(s)).status,"unknown");
    await invalid(()=>issuer(s,op,null,0),["40001"]);await invalid(()=>q("UPDATE v2_source_issuers SET revision=revision+1 WHERE source_id=$1",[s]));
    await issuer(s,await operator(),null,2);assert.equal((await q("SELECT count(*) FROM v2_source_issuer_events WHERE source_id=$1",[s])).rows[0].count,"3");
  });
  test("issuer: same company never automatically merges independent source records",async()=>{
    const op=await operator(),a=await source(),b=await source();await issuer(a,op,null);await issuer(b,op,null);
    assert.deepEqual((await q("SELECT v2_source_component(ARRAY[$1::uuid]) ids",[a])).rows[0].ids,[a]);
    assert.equal((await q("SELECT count(*) FROM v2_source_relations")).rows[0].count,"0");
  });
  test("issuer: revocation invalidates dependent assessments and late citations schedule expiry",async()=>{
    const f=await fixture(),d=await review(f),s=await source(),event=await issuer(s,f.op,d),r=await report(s);
    const before=(await q("SELECT * FROM v2_subjects WHERE id=$1",[r.id])).rows[0],graph=(await q("SELECT revision FROM v2_source_graph WHERE id")).rows[0].revision;
    const assessment=(await q("SELECT v2_assess_field($1,'departure.reported',$2,'{}',$3,$4,$5,statement_timestamp(),gen_random_uuid()) id",[r.id,key,before.revision,before.input_generation,graph])).rows[0].id;
    assert.equal((await q("SELECT count(*) FROM v2_jobs WHERE subject_id=$1 AND trigger_id=$2 AND available_at=$3",[r.id,event,f.p.until_time])).rows[0].count,"1");
    await review(f,"revoke_affiliation");assert.equal((await readIssuer(s)).status,"issuer_claimed");
    assert.equal((await q("SELECT invalidated FROM v2_field_assessments WHERE id=$1",[assessment])).rows[0].invalidated,true);
    assert.ok(BigInt((await q("SELECT input_generation FROM v2_subjects WHERE id=$1",[r.id])).rows[0].input_generation)>BigInt(before.input_generation));
  });
  test("issuer: renewed affiliation does not silently renew an older source binding",async()=>{
    const f=await fixture(),old=await review(f),s=await source();await issuer(s,f.op,old);const renewed=await review(f);
    assert.equal((await readIssuer(s)).status,"issuer_claimed");await invalid(async()=>issuer(await source(),f.op,old));
    await issuer(s,f.op,renewed,1);assert.equal((await readIssuer(s)).status,"affiliated_submitter");
  });
  test("affiliation: proof erasure clears dependent receipts, bound identifiers and quoting notes",async()=>{
    const f=await fixture(),d=await review(f),s=await source();await issuer(s,f.op,d);await report(s);
    await q("SELECT v2_erase_affiliation_proof($1,$2)",[context().user,f.p.id]);assert.equal((await read(f.c)).status,"recheck_required");assert.equal((await readIssuer(s)).status,"issuer_claimed");
    assert.deepEqual((await q("SELECT request_digest,evidence_erased FROM v2_affiliation_resolutions WHERE review_id=$1",[d])).rows[0],{request_digest:null,evidence_erased:true});
    assert.equal((await q("SELECT proof_id FROM v2_affiliation_resolution_proofs WHERE review_id=$1",[d])).rows[0].proof_id,null);
    assert.equal((await q("SELECT private_reason FROM v2_review_decisions WHERE id=$1",[d])).rows[0].private_reason,null);
    const event=(await q("SELECT * FROM v2_source_issuer_events WHERE source_id=$1",[s])).rows[0];assert.equal(event.affiliation_review_id,null);assert.equal(event.request_digest,null);
  });
  test("affiliation: deleting claimant erases dedicated proof and issuer identities but preserves another claim",async()=>{
    const f=await fixture(),d=await review(f),s=await source();await issuer(s,f.op,d);const survivor=await claim(f.op,context().other);
    await q("DELETE FROM users WHERE id=$1",[context().user]);await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await read(f.c)).status,"erased");assert.equal((await read(survivor)).status,"pending");
    const c=(await q("SELECT * FROM v2_affiliation_claims WHERE id=$1",[f.c])).rows[0];assert.equal(c.claimant_user_id,null);assert.equal(c.claimed_role,null);assert.equal(c.request_digest,null);
    const e=(await q("SELECT * FROM v2_source_issuer_events WHERE request_id IS NOT NULL")).rows[0];assert.equal(e.source_id,null);assert.equal(e.operator_subject_id,null);assert.equal(e.actor_user_id,null);assert.equal(e.request_digest,null);
  });
  test("affiliation: deleting reviewer preserves claimant-owned proof while redacting private retry fingerprints",async()=>{
    const f=await fixture(),d=await review(f);await q("DELETE FROM users WHERE id=$1",[context().other]);await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await read(f.c)).status,"verified_affiliation");
    assert.equal((await q("SELECT erased FROM v2_affiliation_proofs WHERE id=$1",[f.p.id])).rows[0].erased,false);
    assert.equal((await q("SELECT request_digest FROM v2_affiliation_resolutions WHERE review_id=$1",[d])).rows[0].request_digest,null);
  });
  test("issuer: deleting a source erases its event identities without erasing independent affiliation proof",async()=>{
    const f=await fixture(),d=await review(f),s=await source(),e=await issuer(s,f.op,d);await q("DELETE FROM v2_sources WHERE id=$1",[s]);
    assert.equal((await readIssuer(s)).status,"unknown");assert.equal((await read(f.c)).status,"verified_affiliation");
    const row=(await q("SELECT * FROM v2_source_issuer_events WHERE id=$1",[e])).rows[0];for(const field of ["source_id","operator_subject_id","affiliation_review_id","actor_user_id","request_digest"])assert.equal(row[field],null);
    await invalid(()=>issuer(s,f.op,d,0,"claim",row.request_id));
  });
  test("affiliation: immediate constraints permit complete verified proof snapshots",async()=>{
    const f=await fixture();await q("SET CONSTRAINTS ALL IMMEDIATE");const d=await review(f);await q("SET CONSTRAINTS ALL IMMEDIATE");assert.equal((await read(f.c)).status,"verified_affiliation");
    await review(f,"reverse",d);await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("affiliation: app roles cannot write proof or call privileged writers and historical clocks",async()=>{
    const f=await fixture();await q("SET LOCAL ROLE mabhazi_api");
    for(const table of affiliationIssuerTables.map(getTableName)) {assert.equal((await q("SELECT has_table_privilege(current_user,$1,'INSERT') p",[table])).rows[0].p,false);}
    await invalid(()=>q("SELECT v2_claim_affiliation($1,$2,'staff',gen_random_uuid())",[context().user,f.op]),["42501"]);
    await invalid(()=>q("SELECT v2_read_affiliation_at($1,statement_timestamp())",[f.c]),["42501"]);
    assert.equal((await read(f.c)).status,"pending");await q("RESET ROLE");
    await q("SET LOCAL ROLE authenticated");await invalid(()=>q("SELECT * FROM v2_affiliation_proofs"),["42501"]);await q("RESET ROLE");
  });
  for(const isolation of ["READ COMMITTED","REPEATABLE READ"]) {
    test(`affiliation: concurrent administrators cannot overwrite at ${isolation}`,{timeout:20000},async()=>{
      const f=await fixture(),args=await reviewArgs(f.c,[f.p.id],"verify_affiliation",f.p.until_time);await q("COMMIT");
      const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString});await left.connect();await right.connect();
      try {await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query("SET LOCAL statement_timeout='5s'");
        await right.query("SELECT revision FROM v2_subjects WHERE id=$1",[f.op]);await left.query(reviewSQL,args);
        const competing=right.query(reviewSQL,args.map((v,i)=>i===9?randomUUID():v)).then(()=>"unexpected_success",(e:{code:string})=>e.code);
        await left.query("COMMIT");assert.equal(await competing,"40001");await right.query("ROLLBACK");
      } finally {await left.query("ROLLBACK");await right.query("ROLLBACK");await left.end();await right.end();await q("BEGIN");}
    });
    test(`affiliation: proof erasure racing review never commits obsolete authority at ${isolation}`,{timeout:20000},async()=>{
      const f=await fixture(),args=await reviewArgs(f.c,[f.p.id],"verify_affiliation",f.p.until_time);await q("COMMIT");
      const left=new pg.Client({connectionString:context().connectionString}),right=new pg.Client({connectionString:context().connectionString});await left.connect();await right.connect();
      try {await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);await right.query("SET LOCAL statement_timeout='5s'");
        await right.query("SELECT id FROM v2_affiliation_proofs WHERE id=$1",[f.p.id]);await left.query("SELECT v2_erase_affiliation_proof($1,$2)",[context().user,f.p.id]);
        const competing=right.query(reviewSQL,args).then(()=>"unexpected_success",(e:{code:string})=>e.code);
        await left.query("COMMIT");assert.equal(await competing,"40001");await right.query("ROLLBACK");
      } finally {await left.query("ROLLBACK");await right.query("ROLLBACK");await left.end();await right.end();await q("BEGIN");}
    });
  }
}
