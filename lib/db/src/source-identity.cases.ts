import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getTableName } from "drizzle-orm";
import pg from "pg";
import { sourceIdentityTables } from "./schema/sourceIdentity";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const key = "a".repeat(64);
const reviewSQL = "SELECT v2_review_sources($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id";
export function registerSourceIdentityTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_source");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_source"); await q("RELEASE SAVEPOINT invalid_source"); }
  }
  const graph = async () => (await q("SELECT revision FROM v2_source_graph WHERE id")).rows[0].revision as string;
  const footprint = async (observation: string) => (await q("SELECT v2_source_footprint($1) f", [observation])).rows[0].f as { known: boolean; graphRevision: string; groups: string[]; sourceIds: string[] };
  const component = async (id: string) => (await q("SELECT v2_source_component(ARRAY[$1::uuid]) ids", [id])).rows[0].ids as string[];
  async function source(owner = context().user, kind = "document", fingerprint: string | null = null) {
    return (await q("INSERT INTO v2_sources(owner_user_id,kind,private_reference,normalised_document_fingerprint) VALUES($1,$2,'private://synthetic/source',$3) RETURNING id", [owner, kind, fingerprint])).rows[0].id as string;
  }
  async function report(sources: string[] = [], owner = context().user) {
    const subject = randomUUID(), contribution = randomUUID();
    await q("INSERT INTO v2_subjects(id,kind) VALUES($1,'lead')", [subject]);
    await q(`INSERT INTO v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,$2,gen_random_uuid(),'1.0','contribute_tab',$3,'{}',$4)`, [contribution, owner, key, subject]);
    await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Source fixture',$3)", [subject, context().corridor, contribution]);
    const observation = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope_key,value_key)
      VALUES($1,$2,'departure.reported','{"time":"08:00","basis":"scheduled"}',$3,$3) RETURNING id`, [contribution, subject, key])).rows[0].id as string;
    for (const s of sources) await q("INSERT INTO v2_observation_sources(observation_id,source_id) VALUES($1,$2)", [observation, s]);
    return { subject, observation, contribution };
  }
  async function open(a: string, b: string) {
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING", [context().other]);
    return (await q("SELECT v2_open_source_case($1,$2,$3) id", [context().other, a, b])).rows[0].id as string;
  }
  async function args(caseId: string, action = "same_origin", reverse: string | null = null) {
    return [context().other, caseId, (await q("SELECT revision FROM v2_source_cases WHERE id=$1", [caseId])).rows[0].revision, await graph(), action,
      "sources_inspected", "Synthetic review of both immutable source records", randomUUID(), "source/1", reverse];
  }
  async function review(caseId: string, action = "same_origin", reverse: string | null = null) {
    return (await q(reviewSQL, await args(caseId, action, reverse))).rows[0].id as string;
  }
  async function select(r: Awaited<ReturnType<typeof report>>) {
    const id = randomUUID(), s = (await q("SELECT * FROM v2_subjects WHERE id=$1", [r.subject])).rows[0];
    await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'field')", [id]);
    await q(`INSERT INTO v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,selected_value,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest)
      VALUES($1,$2,'departure.reported',$3,'{}',1,$4,$5,'{"time":"08:00","basis":"scheduled"}','reported','none','unknown','provisional',ARRAY['reported_evidence'],'evidence/1',$3)`, [id, r.subject, key, s.revision, s.input_generation]);
    await q("INSERT INTO v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code) VALUES($1,$2,'supporting','reported_evidence')", [id, r.observation]);
    await q("SELECT v2_apply_field_decision($1)", [id]); return id;
  }
  test("sources: equal fingerprints, locators, accounts and dates never automatically merge", async () => {
    const a = await source(context().user, "document", key), b = await source(context().user, "document", key);
    assert.deepEqual(await component(a), [a]); assert.deepEqual(await component(b), [b]);
    assert.equal((await q("SELECT count(*) FROM v2_source_relations")).rows[0].count, "0");
  });
  test("sources: one canonical pair case, no self-pair or nonexistent evidence", async () => {
    const a = await source(), b = await source(); const c = await open(a, b);
    assert.equal(await open(b, a), c); await invalid(() => open(a, a));
    await invalid(() => open(a, randomUUID()), ["23503"]);
    assert.deepEqual((await q("SELECT source_a,source_b FROM v2_source_cases WHERE id=$1", [c])).rows[0], { source_a: [a, b].sort()[0], source_b: [a, b].sort()[1] });
  });
  test("sources: suspected relations are visible review candidates without grouping", async () => {
    const a = await source(), b = await source(); const c = await open(a, b); const d = await review(c, "suspected_same_origin");
    assert.deepEqual(await component(a), [a]);
    assert.equal((await q("SELECT decision_id FROM v2_source_relations WHERE case_id=$1", [c])).rows[0].decision_id, d);
    await review(c); assert.deepEqual(await component(a), [a, b].sort()); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("sources: compound citations produce a set of origins, not a union edge", async () => {
    const a = await source(), b = await source(), r = await report([a, b]), s = await report([b]);
    assert.deepEqual((await footprint(r.observation)).groups, [a, b].sort());
    assert.ok((await footprint(r.observation)).groups.includes((await footprint(s.observation)).groups[0]));
    assert.equal((await footprint(r.observation)).known, true); assert.deepEqual(await component(a), [a]);
  });
  test("sources: copied documents across accounts share one deterministic group", async () => {
    const a = await source(), b = await source(context().other), r = await report([a]), s = await report([b], context().other);
    await review(await open(a, b));
    assert.deepEqual((await footprint(r.observation)).groups, [[a, b].sort()[0]]);
    assert.deepEqual((await footprint(s.observation)).groups, (await footprint(r.observation)).groups);
    assert.deepEqual((await footprint(r.observation)).sourceIds, [a]);
  });
  test("sources: transitive cycles terminate and reversal splits only the removed edge", async () => {
    const a = await source(), b = await source(), c = await source(); const ab = await open(a, b), bc = await open(b, c), ac = await open(a, c);
    const dab = await review(ab), dbc = await review(bc); await review(ac);
    assert.deepEqual(await component(a), [a, b, c].sort());
    await review(ab, "reverse", dab); assert.deepEqual(await component(a), [a, b, c].sort());
    await review(bc, "reverse", dbc); assert.deepEqual(await component(a), [a, c].sort()); assert.deepEqual(await component(b), [b]);
  });
  test("sources: reversing the latest decision never silently revives an older confirmation", async () => {
    const a = await source(), b = await source(), c = await open(a, b); const old = await review(c); const separated = await review(c, "separate");
    await invalid(() => review(c, "reverse", old)); await review(c, "reverse", separated);
    assert.deepEqual(await component(a), [a]);
    await invalid(async () => review(c, "reverse", (await q("SELECT last_decision_id FROM v2_source_cases WHERE id=$1", [c])).rows[0].last_decision_id));
  });
  test("sources: exact request retries return receipts without reinstating reversed effects", async () => {
    const a = await source(), b = await source(), c = await open(a, b), values = await args(c);
    const d = (await q(reviewSQL, values)).rows[0].id; const version = await graph();
    assert.equal((await q(reviewSQL, values)).rows[0].id, d); assert.equal(await graph(), version);
    await review(c, "reverse", d); assert.equal((await q(reviewSQL, values)).rows[0].id, d); assert.deepEqual(await component(a), [a]);
    await invalid(() => q(reviewSQL, values.map((v, i) => i === 4 ? "separate" : v)));
  });
  test("sources: stale case and graph revisions reject rather than overwriting new context", async () => {
    const a = await source(), b = await source(), c = await open(a, b), values = await args(c);
    for (const index of [2, 3]) await invalid(() => q(reviewSQL, values.map((v, i) => i === index ? Number(v) + 1 : v)), ["40001"]);
    await report([a]); await invalid(() => q(reviewSQL, values), ["40001"]);
  });
  test("sources: no evidence, hearsay, legacy and inactive observations cannot claim a known footprint", async () => {
    assert.equal((await footprint((await report()).observation)).known, false);
    const known = await source();
    for (const kind of ["hearsay", "unprovided", "legacy_import"]) {
      const unknown = await source(context().user, kind); const r = await report([known, unknown]);
      assert.equal((await footprint(r.observation)).known, false);
    }
    const r = await report([known]); await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)", [context().user, r.observation, randomUUID()]);
    assert.equal((await footprint(r.observation)).known, false);
  });
  test("sources: unprovided and imported records cannot manufacture confirmed origin edges", async () => {
    const a = await source();
    for (const kind of ["unprovided", "legacy_import"]) { const b = await source(context().user, kind), c = await open(a, b); await invalid(() => review(c)); }
  });
  test("sources: source decisions and pair identity cannot be rewritten or deleted", async () => {
    const a = await source(), b = await source(), c = await open(a, b), d = await review(c);
    await invalid(() => q("UPDATE v2_source_decisions SET action='separate' WHERE id=$1", [d]));
    await invalid(() => q("DELETE FROM v2_source_decisions WHERE id=$1", [d]));
    await invalid(() => q("UPDATE v2_source_cases SET source_b=gen_random_uuid(),revision=revision+1 WHERE id=$1", [c]));
    await invalid(() => q("DELETE FROM v2_source_cases WHERE id=$1", [c]));
    await invalid(() => q("UPDATE v2_source_relations SET relation='suspected_same_origin' WHERE case_id=$1", [c]));
    await invalid(() => q("DELETE FROM v2_source_relations WHERE case_id=$1", [c]));
  });
  test("sources: citations require ownership and corrections preserve citation history", async () => {
    const a = await source(), b = await source(context().other), r = await report([a]);
    await invalid(() => q("INSERT INTO v2_observation_sources VALUES($1,$2,'cites')", [r.observation, b]));
    await invalid(() => q("DELETE FROM v2_observation_sources WHERE observation_id=$1", [r.observation]));
    await invalid(() => q("UPDATE v2_observation_sources SET relation='cites' WHERE observation_id=$1", [r.observation]));
    await invalid(() => q("INSERT INTO v2_observation_sources VALUES($1,$2,'cites')", [r.observation, a]), ["23505"]);
    assert.deepEqual((await footprint(r.observation)).sourceIds, [a]);
  });
  test("sources: confirmation and split invalidate selections throughout the old component", async () => {
    const a = await source(), b = await source(), c = await source(); await review(await open(a, b));
    const r = await report([a]), s = await report([b]), t = await report([c]); const fields = [await select(r), await select(s), await select(t)];
    const bc = await open(b, c), d = await review(bc);
    assert.equal((await q("SELECT count(*) FROM v2_field_decisions WHERE id=ANY($1::uuid[]) AND invalidated", [fields])).rows[0].count, "3");
    const before = (await q("SELECT input_generation FROM v2_subjects WHERE id=$1", [r.subject])).rows[0].input_generation;
    await review(bc, "reverse", d);
    assert.ok(BigInt((await q("SELECT input_generation FROM v2_subjects WHERE id=$1", [r.subject])).rows[0].input_generation) > BigInt(before));
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE subject_id=ANY($1::uuid[])", [[r.subject, s.subject, t.subject]])).rows[0].count, "0");
  });
  test("sources: adding a citation invalidates the old selection and advances graph version", async () => {
    const a = await source(), r = await report(), field = await select(r), version = await graph();
    await q("INSERT INTO v2_observation_sources VALUES($1,$2,'direct')", [r.observation, a]);
    assert.equal((await q("SELECT invalidated FROM v2_field_decisions WHERE id=$1", [field])).rows[0].invalidated, true);
    assert.ok(BigInt(await graph()) > BigInt(version));
  });
  test("sources: account erasure removes pair identities and copied facts synchronously", async () => {
    const a = await source(), b = await source(context().other), c = await open(a, b); const d = await review(c);
    const r = await report([a]), s = await report([b], context().other), unrelated = await report([], context().other);
    const erased = await select(s), kept = await select(unrelated);
    await q("SET LOCAL ROLE mabhazi_api"); await q("DELETE FROM users WHERE id=$1", [context().user]); await q("SET CONSTRAINTS ALL IMMEDIATE"); await q("RESET ROLE");
    assert.deepEqual((await q("SELECT source_a,source_b,erased,last_decision_id FROM v2_source_cases WHERE id=$1", [c])).rows[0], { source_a: null, source_b: null, erased: true, last_decision_id: null });
    assert.deepEqual((await q("SELECT evidence_erased,private_reason FROM v2_source_decisions WHERE id=$1", [d])).rows[0], { evidence_erased: true, private_reason: null });
    assert.equal((await q("SELECT count(*) FROM v2_sources WHERE id=$1", [a])).rows[0].count, "0");
    assert.equal((await q("SELECT count(*) FROM v2_observation_sources WHERE observation_id=$1", [r.observation])).rows[0].count, "0");
    assert.deepEqual((await q("SELECT erased,scope,selected_value FROM v2_field_decisions WHERE id=$1", [erased])).rows[0], { erased: true, scope: null, selected_value: null });
    assert.ok((await q("SELECT snapshot FROM v2_subject_revisions WHERE subject_id=$1", [s.subject])).rows.every(row => row.snapshot === null));
    assert.equal((await q("SELECT field_decision_id FROM v2_current_fields WHERE subject_id=$1", [unrelated.subject])).rows[0].field_decision_id, kept);
    assert.deepEqual(await component(b), [b]);
  });
  test("sources: reviewer deletion anonymizes audit and notes without losing independent source evidence", async () => {
    const a = await source(), b = await source(), c = await open(a, b), d = await review(c);
    await q("DELETE FROM users WHERE id=$1", [context().other]); await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.deepEqual((await q("SELECT actor_user_id,actor_erased,private_reason,evidence_erased FROM v2_source_decisions WHERE id=$1", [d])).rows[0], { actor_user_id: null, actor_erased: true, private_reason: null, evidence_erased: false });
    assert.deepEqual(await component(a), [a, b].sort());
  });
  test("sources: source deletion preserves other independently reviewed edges", async () => {
    const a = await source(), b = await source(context().other), c = await source(context().other);
    await review(await open(a, b)); await review(await open(b, c)); await q("DELETE FROM v2_sources WHERE id=$1", [a]);
    assert.deepEqual(await component(b), [b, c].sort()); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("sources: backend primitives require real roles; client roles and raw writes are denied", async () => {
    const a = await source(), b = await source(); await invalid(() => q("SELECT v2_open_source_case($1,$2,$3)", [context().user, a, b]), ["42501"]);
    const c = await open(a, b), values = await args(c);
    for (const role of ["anon", "authenticated", "mabhazi_api"]) {
      await q(`SET LOCAL ROLE ${role}`);
      for (const table of sourceIdentityTables.map(getTableName)) {
        if (role === "mabhazi_api") await q(`SELECT * FROM ${table}`); else await invalid(() => q(`SELECT * FROM ${table}`), ["42501"]);
        await invalid(() => q(`DELETE FROM ${table}`), ["42501"]); await invalid(() => q(`TRUNCATE ${table}`), ["42501"]);
      }
      await invalid(() => q("SELECT v2_source_changed(ARRAY[$1::uuid],ARRAY[]::uuid[],false)", [a]), ["42501"]);
      if (role === "mabhazi_api") { await q(reviewSQL, values); await q("SELECT v2_source_footprint(gen_random_uuid())"); }
      else await invalid(() => q(reviewSQL, values), ["42501"]);
      await q("RESET ROLE");
    }
  });
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) {
    for (const race of ["review", "erasure"]) test(`sources: competing ${race} cannot apply stale source context at ${isolation}`, { timeout: 20_000 }, async () => {
      const a = await source(), b = await source(), c = await open(a, b), leftArgs = await args(c), rightArgs = await args(c, "separate"); await q("COMMIT");
      const left = new pg.Client({ connectionString: context().connectionString }), right = new pg.Client({ connectionString: context().connectionString });
      await left.connect(); await right.connect();
      try {
        await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await right.query("SET LOCAL statement_timeout='5s'"); await right.query("SELECT revision FROM v2_source_graph WHERE id");
        if (race === "review") await left.query(reviewSQL, leftArgs); else await left.query("DELETE FROM v2_sources WHERE id=$1", [a]);
        const result = right.query(reviewSQL, rightArgs).then(() => "unexpected_success", (e: { code: string }) => e.code);
        await left.query("COMMIT"); assert.ok(["40001", ...(race === "erasure" ? ["23514"] : [])].includes(await result)); await right.query("ROLLBACK");
        assert.equal((await q("SELECT count(*) FROM v2_source_decisions WHERE case_id=$1", [c])).rows[0].count, race === "review" ? "1" : "0");
      } finally { await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end(); await q("BEGIN"); }
    });
  }
}
