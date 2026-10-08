import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { getTableName } from "drizzle-orm";
import { derivedTables } from "./schema/derivedDecisions";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; corridor: string };
const key = "a".repeat(64);
const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
export function registerDerivedTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_derived");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_derived"); await q("RELEASE SAVEPOINT invalid_derived"); }
  }
  async function lead(owner = context().user) {
    const id = randomUUID(), contribution = randomUUID();
    await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')", [id]);
    await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)`, [contribution, owner, key, id]);
    await q(`INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id)
      VALUES($1,$2,28800,'Decision fixture',$3)`, [id, context().corridor, contribution]);
    const observation = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key)
      VALUES($1,$2,'departure.reported','{"time":"08:00","basis":"scheduled"}',$3,$3) RETURNING id`, [contribution, id, key])).rows[0].id as string;
    return { id, contribution, observation };
  }
  type Lead = Awaited<ReturnType<typeof lead>>;
  async function state(id: string) { return (await q("SELECT revision,input_generation FROM v2_subjects WHERE id=$1", [id])).rows[0]; }
  async function field(f: Lead, options: { previous?: string; revision?: number; generation?: number; expected?: number; selected?: unknown; field?: string; scope?: unknown; scopeKey?: string; review?: string; evidence?: string[] } = {}) {
    const id = randomUUID(), s = await state(f.id);
    const value = options.selected === undefined ? { time: "08:00", basis: "scheduled" } : options.selected;
    await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'field')", [id]);
    await q(`INSERT INTO v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,selected_value,
      support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest,previous_decision_id,reviewer_decision_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'none','unknown',$11,ARRAY['reported_evidence'],'evidence/1',$12,$13,$14)`,
    [id, f.id, options.field ?? "departure.reported", options.scopeKey ?? key, options.scope ?? {}, options.revision ?? 1, options.expected ?? s.revision,
      options.generation ?? s.input_generation, value, value === null ? "unknown" : "reported", value === null ? "withheld" : "provisional", digest(), options.previous ?? null, options.review ?? null]);
    for (const evidence of options.evidence ?? (value === null ? [] : [f.observation])) await q("INSERT INTO v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code) VALUES($1,$2,'supporting','reported_evidence')", [id, evidence]);
    return id;
  }
  async function candidate(a: Lead, b: Lead, relation = "same_corridor", withEvidence = true) {
    const id = (await q(`INSERT INTO v2_association_candidates(from_subject_id,from_kind,to_subject_id,to_kind,relation,evidence_digest,reason_codes,rule_version,source_revision,target_revision)
      VALUES($1,'lead',$2,'lead',$3,$4,ARRAY['directed_corridor'],'association/1',$5,$6) RETURNING id`, [a.id, b.id, relation, digest(), (await state(a.id)).revision, (await state(b.id)).revision])).rows[0].id as string;
    if (withEvidence) await q("INSERT INTO v2_candidate_evidence VALUES($1,$2)", [id, a.observation]);
    return id;
  }
  async function association(c: string, options: { action?: string; previous?: string; review?: string; expectedFrom?: number; expectedTo?: number; expectedCandidate?: number } = {}) {
    const id = randomUUID(), row = (await q("SELECT * FROM v2_association_candidates WHERE id=$1", [c])).rows[0];
    await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'association')", [id]);
    await q(`INSERT INTO v2_association_decisions(id,candidate_id,action,previous_decision_id,actor_kind,reviewer_decision_id,reason_code,policy_version,expected_from_revision,expected_to_revision,expected_candidate_revision)
      VALUES($1,$2,$3,$4,$5,$6,'reviewed_relationship','association/1',$7,$8,$9)`, [id, c, options.action ?? "accept", options.previous ?? null,
      options.review ? "reviewer" : "system", options.review ?? null, options.expectedFrom ?? (await state(row.from_subject_id)).revision,
      options.expectedTo ?? (await state(row.to_subject_id)).revision, options.expectedCandidate ?? row.revision]);
    return id;
  }
  async function review(f: Lead, kind = "identity") {
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture_grant') ON CONFLICT DO NOTHING", [context().other]);
    const caseId = (await q("SELECT v2_open_review_case($1,$2,$3,$4,$5) id", [context().other, f.id, kind, kind === "identity" ? null : "departure.reported", kind === "identity" ? null : key])).rows[0].id as string;
    const id = (await q("SELECT v2_record_review($1,$2,1,$3,'accept','evidence_reviewed',NULL,$4,'review/1',NULL) id", [context().other, caseId, (await state(f.id)).revision, [f.observation]])).rows[0].id as string;
    return { id, caseId };
  }
  const applyField = (id: string) => q("SELECT v2_apply_field_decision($1)", [id]);
  const applyAssociation = (id: string) => q("SELECT v2_apply_association_decision($1)", [id]);

  test("derived: field and association registries require actual matching subtypes", async () => {
    await q("SET CONSTRAINTS ALL IMMEDIATE");
    for (const kind of ["field", "association"]) await invalid(() => q("INSERT INTO v2_decision_ids(kind) VALUES($1)", [kind]));
    await q("SET CONSTRAINTS ALL DEFERRED");
    const f = await lead(); const id = await field(f);
    await invalid(async () => { await q("UPDATE v2_field_decisions SET decision_kind='review' WHERE id=$1", [id]); await q("SET CONSTRAINTS ALL IMMEDIATE"); });
  });
  test("derived: candidates reject self links, unsupported kind pairs and incomplete segment bounds", async () => {
    const a = await lead(), b = await lead();
    await invalid(() => candidate(a, a));
    for (const relation of ["same_pattern", "same_service", "contains_segment", "made_up"]) await invalid(() => candidate(a, b, relation));
    const id = await candidate(a, b);
    await invalid(() => q("UPDATE v2_association_candidates SET to_subject_id=$1 WHERE id=$2", [randomUUID(), id]));
    await invalid(() => q("UPDATE v2_association_candidates SET reason_codes=ARRAY[NULL] WHERE id=$1", [id]));
    await invalid(() => q("INSERT INTO v2_association_candidates SELECT gen_random_uuid(),from_subject_id,from_kind,to_subject_id,to_kind,relation,evidence_digest,reason_codes,rule_version,source_revision,target_revision,segment_start,segment_end,state,revision,evidence_erased,last_decision_id,created_at FROM v2_association_candidates WHERE id=$1", [id]), ["23505"]);
  });
  test("derived: candidate evidence belongs to an endpoint and seals at first decision", async () => {
    const a = await lead(), b = await lead(), unrelated = await lead(); const c = await candidate(a, b);
    await invalid(() => q("INSERT INTO v2_candidate_evidence VALUES($1,$2)", [c, unrelated.observation]));
    await association(c, { action: "defer" });
    await invalid(() => q("INSERT INTO v2_candidate_evidence VALUES($1,$2)", [c, b.observation]));
  });
  test("derived: initial field registry cannot attach lead-only facts to another subtype", async () => {
    const a = await lead(), operator = randomUUID();
    await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'operator')", [operator]);
    await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Fixture operator')", [operator]);
    await invalid(() => field({ ...a, id: operator }, { selected: null }), ["23503"]);
  });
  test("derived: selected values require exact live evidence and scope, not just a matching hash", async () => {
    const a = await lead(), b = await lead();
    for (const options of [{ evidence: [] }, { evidence: [b.observation] }, { selected: { time: "09:00", basis: "scheduled" } }, { scope: { different: true } }]) {
      await invalid(async () => { const d = await field(a, options); await applyField(d); });
    }
    await q("UPDATE v2_observation_states SET status='hidden' WHERE observation_id=$1", [a.observation]);
    await invalid(async () => { const d = await field(a); await applyField(d); });
  });
  test("derived: provisional field selection is idempotent, snapshots transport and does not invent freshness", async () => {
    const a = await lead(); const d = await field(a); await applyField(d); await applyField(d);
    await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.deepEqual(await state(a.id), { revision: "2", input_generation: "1" });
    const row = (await q("SELECT support_status,freshness,publication FROM v2_field_decisions WHERE id=$1", [d])).rows[0];
    assert.deepEqual(row, { support_status: "reported", freshness: "unknown", publication: "provisional" });
    const history = (await q("SELECT snapshot,decision_id FROM v2_subject_revisions WHERE subject_id=$1", [a.id])).rows;
    assert.equal(history.length, 1); assert.equal(history[0].decision_id, d);
    assert.equal(history[0].snapshot.kind, "lead"); assert.equal(history[0].snapshot.data.initial_contribution_id, undefined);
  });
  test("derived: unknown stays absent and incomplete policy cannot claim corroboration or publication", async () => {
    const a = await lead(); const d = await field(a, { selected: null }); await applyField(d);
    assert.equal((await q("SELECT selected_value FROM v2_field_decisions WHERE id=$1", [d])).rows[0].selected_value, null);
    // Exercise INSERT constraints, not the separate append-only UPDATE guard.
    const columns = "id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest";
    await invalid(() => q(`INSERT INTO v2_field_decisions(${columns}) VALUES(gen_random_uuid(),$1,'departure.reported',$2,'{}',1,1,1,'corroborated','none','current','selected',ARRAY['unsupported_claim'],'evidence/1',$2)`, [a.id, digest()]));
  });
  test("derived: field revisions have contiguous, same-subject and same-field lineage", async () => {
    const a = await lead(), b = await lead(); const d = await field(a);
    await invalid(async () => { await field(a, { previous: d, revision: 3 }); await q("SET CONSTRAINTS ALL IMMEDIATE"); });
    await invalid(() => field(b, { previous: d, revision: 2 }), ["23503"]);
    await invalid(() => field(a, { previous: d, revision: 2, field: "operator.reported", selected: null }), ["23503"]);
    await applyField(d); const next = await field(a, { previous: d, revision: 2 }); await applyField(next);
    assert.equal((await q("SELECT field_decision_id FROM v2_current_fields WHERE subject_id=$1", [a.id])).rows[0].field_decision_id, next);
  });
  test("derived: stale input generation rejects application and newer input clears stale pointers", async () => {
    const a = await lead(); const d = await field(a);
    await q("UPDATE v2_subjects SET input_generation=input_generation+1 WHERE id=$1", [a.id]);
    await invalid(() => applyField(d), ["40001"]);
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE subject_id=$1", [a.id])).rows[0].count, "0");
    const next = await field(a, { previous: d, revision: 2 }); await applyField(next);
    await q("UPDATE v2_subjects SET input_generation=input_generation+1 WHERE id=$1", [a.id]);
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE subject_id=$1", [a.id])).rows[0].count, "0");
  });
  test("derived: withdrawing support invalidates immediately without erasing historical facts", async () => {
    const a = await lead(); const d = await field(a); await applyField(d);
    await q("UPDATE v2_observation_states SET status='withdrawn' WHERE observation_id=$1", [a.observation]);
    assert.deepEqual((await q("SELECT invalidated,erased,selected_value IS NULL AS cleared FROM v2_field_decisions WHERE id=$1", [d])).rows[0], { invalidated: true, erased: false, cleared: false });
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE subject_id=$1", [a.id])).rows[0].count, "0");
    await invalid(() => applyField(d));
  });
  test("derived: deleting evidence clears all dependent decision copies and safe history origins", async () => {
    const a = await lead(); const d = await field(a); await applyField(d);
    const next = await field(a, { previous: d, revision: 2 }); await applyField(next);
    await q("DELETE FROM v2_observations WHERE id=$1", [a.observation]); await q("SET CONSTRAINTS ALL IMMEDIATE");
    const rows = (await q("SELECT invalidated,erased,selected_value,scope,input_digest FROM v2_field_decisions WHERE subject_id=$1", [a.id])).rows;
    assert.equal(rows.length, 2); for (const row of rows) assert.deepEqual(row, { invalidated: true, erased: true, selected_value: null, scope: null, input_digest: null });
    assert.ok((await q("SELECT observation_id,erased FROM v2_field_decision_evidence WHERE field_decision_id=ANY($1::uuid[])", [[d, next]])).rows.every(r => r.observation_id === null && r.erased));
    assert.ok((await q("SELECT origin_kind,snapshot,decision_id FROM v2_subject_revisions WHERE subject_id=$1", [a.id])).rows.every(r => r.origin_kind === "erased" && r.snapshot === null && r.decision_id === null));
  });
  test("derived: account erasure through restricted backend preserves another account's selected field", async () => {
    const a = await lead(), b = await lead(context().other); const d = await field(a), kept = await field(b);
    await applyField(d); await applyField(kept);
    await q("SET LOCAL ROLE mabhazi_api"); await q("DELETE FROM users WHERE id=$1", [context().user]); await q("SET CONSTRAINTS ALL IMMEDIATE"); await q("RESET ROLE");
    assert.equal((await q("SELECT erased FROM v2_field_decisions WHERE id=$1", [d])).rows[0].erased, true);
    assert.equal((await q("SELECT field_decision_id FROM v2_current_fields WHERE subject_id=$1", [b.id])).rows[0].field_decision_id, kept);
  });
  test("derived: contribution snapshots are typed, correctly attributed and redact on deletion", async () => {
    const a = await lead(), b = await lead();
    const sql = `INSERT INTO v2_subject_revisions(subject_id,subject_kind,revision,snapshot,origin_kind,initial_contribution_id)
      VALUES($1,'lead',1,public.v2_transport_snapshot($1),'contribution',$2)`;
    await invalid(() => q(sql, [a.id, b.contribution]));
    await q(sql, [a.id, a.contribution]);
    await invalid(() => q("UPDATE v2_subject_revisions SET snapshot='{}' WHERE subject_id=$1", [a.id]));
    await q("DELETE FROM v2_contributions WHERE id=$1", [a.contribution]); await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.deepEqual((await q("SELECT origin_kind,initial_contribution_id,snapshot FROM v2_subject_revisions WHERE subject_id=$1", [a.id])).rows[0], { origin_kind: "erased", initial_contribution_id: null, snapshot: null });
  });
  test("derived: same-corridor grouping is reversible and never changes original observation targets", async () => {
    const a = await lead(), b = await lead(); const c = await candidate(a, b); const d = await association(c);
    await applyAssociation(d); await applyAssociation(d);
    assert.equal((await q("SELECT original_subject_id FROM v2_observations WHERE id=$1", [a.observation])).rows[0].original_subject_id, a.id);
    assert.equal((await q("SELECT count(*) FROM v2_association_links WHERE candidate_id=$1", [c])).rows[0].count, "1");
    assert.equal((await q("SELECT count(*) FROM v2_subject_revisions WHERE decision_id=$1", [d])).rows[0].count, "2");
    const reversed = await association(c, { action: "reverse", previous: d }); await applyAssociation(reversed);
    assert.equal((await q("SELECT count(*) FROM v2_association_links WHERE candidate_id=$1", [c])).rows[0].count, "0");
    assert.equal((await q("SELECT count(*) FROM v2_association_decisions WHERE candidate_id=$1", [c])).rows[0].count, "2");
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("derived: known different corridors and stale candidates cannot be accepted", async () => {
    const a = await lead(), b = await lead(); const c = await candidate(a, b);
    const reversed = (await q("INSERT INTO v2_corridors(origin_city_id,destination_city_id) SELECT destination_city_id,origin_city_id FROM v2_corridors WHERE id=$1 RETURNING id", [context().corridor])).rows[0].id;
    await q("UPDATE v2_leads SET corridor_id=$1 WHERE subject_id=$2", [reversed, b.id]);
    const d = await association(c); await invalid(() => applyAssociation(d));
    await q("UPDATE v2_subjects SET revision=revision+1 WHERE id=$1", [a.id]);
    await invalid(() => applyAssociation(d), ["40001"]);
  });
  test("derived: system cannot approve identity; reviewed association requires the matching identity case", async () => {
    const a = await lead(), b = await lead(); const c = await candidate(a, b, "duplicate_of");
    await invalid(async () => { const d = await association(c); await applyAssociation(d); }, ["42501"]);
    const r = await review(a, "correction");
    await invalid(async () => { const d = await association(c, { review: r.id }); await applyAssociation(d); });
    const c2 = await candidate(a, b, "duplicate_of", false);
    await q("INSERT INTO v2_candidate_evidence VALUES($1,$2)", [c2, a.observation]);
    const identity = await review(a); const d = await association(c2, { review: identity.id }); await applyAssociation(d);
    assert.equal((await q("SELECT decision_id FROM v2_association_links WHERE candidate_id=$1", [c2])).rows[0].decision_id, d);
  });
  test("derived: review reversal invalidates dependent fields before background recomputation", async () => {
    const a = await lead(); const r = await review(a, "conflict"); const d = await field(a, { review: r.id }); await applyField(d);
    await q("SELECT v2_record_review($1,$2,2,$3,'reverse','incorrect_interpretation',NULL,ARRAY[]::uuid[],'review/1',$4)", [context().other, r.caseId, (await state(a.id)).revision, r.id]);
    assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1", [d])).rows[0].invalidated, true);
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE subject_id=$1", [a.id])).rows[0].count, "0");
    await q("DELETE FROM v2_observations WHERE id=$1", [a.observation]);
    assert.equal((await q("SELECT erased FROM v2_field_decisions WHERE id=$1", [d])).rows[0].erased, true);
  });
  test("derived: a review cannot equate services of different known operators", async () => {
    const a = await lead(), b = await lead();
    for (const f of [a, b]) {
      const operator = randomUUID();
      await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'operator')", [operator]);
      await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Distinct operator')", [operator]);
      await q("UPDATE v2_leads SET operator_name=NULL,operator_subject_id=$1 WHERE subject_id=$2", [operator, f.id]);
    }
    const c = await candidate(a, b, "duplicate_of"); const r = await review(a); const d = await association(c, { review: r.id });
    await invalid(() => applyAssociation(d));
  });
  test("derived: active links cannot survive a candidate becoming obsolete", async () => {
    const a = await lead(), b = await lead(); const c = await candidate(a, b); const d = await association(c); await applyAssociation(d);
    await invalid(async () => { await q("UPDATE v2_association_candidates SET state='obsolete' WHERE id=$1", [c]); await q("SET CONSTRAINTS ALL IMMEDIATE"); });
  });
  test("derived: association evidence erasure removes links, redacts digest and retains decision tombstones", async () => {
    const a = await lead(), b = await lead(); const c = await candidate(a, b); const d = await association(c); await applyAssociation(d);
    await q("DELETE FROM v2_observations WHERE id=$1", [a.observation]); await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.deepEqual((await q("SELECT state,evidence_digest,evidence_erased FROM v2_association_candidates WHERE id=$1", [c])).rows[0], { state: "obsolete", evidence_digest: null, evidence_erased: true });
    assert.deepEqual((await q("SELECT invalidated,erased FROM v2_association_decisions WHERE id=$1", [d])).rows[0], { invalidated: true, erased: true });
    assert.equal((await q("SELECT count(*) FROM v2_association_links WHERE candidate_id=$1", [c])).rows[0].count, "0");
  });
  test("derived: backend reads storage but all processing writers await authenticated worker integration", async () => {
    const a = await lead(); const d = await field(a);
    for (const role of ["anon", "authenticated", "mabhazi_api"]) {
      await q(`SET LOCAL ROLE ${role}`);
      for (const t of derivedTables.map(getTableName)) {
        if (role === "mabhazi_api") await q(`SELECT * FROM ${t}`);
        else await invalid(() => q(`SELECT * FROM ${t}`), ["42501"]);
        await invalid(() => q(`DELETE FROM ${t}`), ["42501"]);
      }
      await invalid(() => applyField(d), ["42501"]); await invalid(() => applyAssociation(d), ["42501"]);
      await q("RESET ROLE");
    }
  });
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) test(`derived: competing field effects reject a stale subject at ${isolation}`, { timeout: 20_000 }, async () => {
    const a = await lead(); const first = await field(a); const second = await field(a, { field: "operator.reported", selected: null });
    await q("COMMIT");
    const left = new pg.Client({ connectionString: context().connectionString }), right = new pg.Client({ connectionString: context().connectionString });
    await left.connect(); await right.connect();
    try {
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query("SET LOCAL statement_timeout='5s'"); await right.query("SELECT revision FROM v2_subjects WHERE id=$1", [a.id]);
      await left.query("SELECT v2_apply_field_decision($1)", [first]);
      const result = right.query("SELECT v2_apply_field_decision($1)", [second]).then(() => "unexpected_success", (e: { code: string }) => e.code);
      await left.query("COMMIT"); assert.equal(await result, "40001"); await right.query("ROLLBACK");
      assert.deepEqual((await q("SELECT field_decision_id FROM v2_current_fields WHERE subject_id=$1", [a.id])).rows, [{ field_decision_id: first }]);
    } finally { await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end(); await q("BEGIN"); }
  });
}
