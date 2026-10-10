import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getTableName } from "drizzle-orm";
import pg from "pg";
import { evidenceAssessmentTables } from "./schema/evidenceAssessments";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
const at = "2026-10-02T12:00:00.000Z";
const assessSQL = "SELECT v2_assess_field($1,$2,$3,$4,$5,$6,$7,$8,$9) id";
type Options = { owner?: string; date?: string | null; sourceDate?: string | null; basis?: string; sources?: string[]; supersedes?: string; effectiveFrom?: string; effectiveTo?: string };
export function registerAssessmentTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  const hash = async (value: unknown) => (await q("SELECT v2_assessment_hash($1::jsonb) h", [JSON.stringify(value)])).rows[0].h as string;
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_assessment");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_assessment"); await q("RELEASE SAVEPOINT invalid_assessment"); }
  }
  async function subject(kind: string) {
    const id = randomUUID(); await q("INSERT INTO v2_subjects(id,kind) VALUES($1,$2)", [id, kind]); return id;
  }
  async function contribution(id: string, owner: string) {
    return (await q(`INSERT INTO v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,gen_random_uuid(),'1.0','contribute_tab',$2,'{}',$3) RETURNING id`, [owner, "a".repeat(64), id])).rows[0].id as string;
  }
  async function lead() {
    const id = await subject("lead"), c = await contribution(id, context().user);
    await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Assessment bus',$3)", [id, context().corridor, c]); return id;
  }
  async function source(owner = context().user, date: string | null = null, kind = "firsthand") {
    return (await q("INSERT INTO v2_sources(owner_user_id,kind,source_date) VALUES($1,$2,$3) RETURNING id", [owner, kind, date])).rows[0].id as string;
  }
  async function report(id: string, field: string, value: unknown, scope: unknown = {}, options: Options = {}) {
    const owner = options.owner ?? context().user, c = await contribution(id, owner);
    const observation = (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from,supersedes_id,effective_from,effective_to)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [c, id, field, value, scope, await hash(scope), await hash(value), options.basis ?? "observed_sign",
      options.date === undefined ? "2026-10-01" : options.date, options.supersedes ?? null, options.effectiveFrom ?? null, options.effectiveTo ?? null])).rows[0].id as string;
    const sources = options.sources ?? [await source(owner, options.sourceDate ?? null)];
    for (const s of sources) await q("INSERT INTO v2_observation_sources VALUES($1,$2,'direct')", [observation, s]);
    return { observation, sources, id, field, value, scope, owner };
  }
  const fareScope = (extra: Record<string, unknown> = {}) => ({ schemaVersion: "1.0", segment: { kind: "city_pair", originCityId: context().origin, destinationCityId: context().destination },
    passengerCategory: "adult", ticketBasis: "one_way", paymentMethod: "cash", luggageIncluded: true, timeBasis: "scheduled", quotationDate: "2026-10-01", ...extra });
  const fare = (amount = "25.00", currency = "USD") => ({ amount, currency });
  const evaluate = async (id: string, field: string, scope: unknown = {}, when = at) => (await q("SELECT v2_evaluate_assessment($1,$2,$3,$4,'evidence/1') r", [id, field, scope, when])).rows[0].r;
  async function args(id: string, field: string, scope: unknown = {}, when = at) {
    const s = (await q("SELECT revision,input_generation FROM v2_subjects WHERE id=$1", [id])).rows[0];
    return [id, field, await hash(scope), scope, s.revision, s.input_generation, (await q("SELECT revision FROM v2_source_graph WHERE id")).rows[0].revision, when, randomUUID()];
  }
  const record = async (id: string, field: string, scope: unknown = {}, when = at) => (await q(assessSQL, await args(id, field, scope, when))).rows[0].id as string;
  const read = async (id: string, field: string, scope: unknown = {}, when = at) => (await q("SELECT v2_read_assessment_at($1,$2,$3,$4) r", [id, field, await hash(scope), when])).rows[0].r;
  async function link(a: string, b: string) {
    await q("INSERT INTO v2_review_roles(user_id,role,reason_code) VALUES($1,'reviewer','fixture') ON CONFLICT DO NOTHING", [context().other]);
    const c = (await q("SELECT v2_open_source_case($1,$2,$3) id", [context().other, a, b])).rows[0].id;
    const d = (await q("SELECT v2_review_sources($1,$2,1,$3,'same_origin','source_inspected',NULL,$4,'source/1',NULL) id", [context().other, c, (await q("SELECT revision FROM v2_source_graph WHERE id")).rows[0].revision, randomUUID()])).rows[0].id;
    return { c, d };
  }
  async function transport() {
    const operator = await subject("operator"), route = await subject("route"), pattern = await subject("pattern"), stop = await subject("stop"), plan = await subject("service_plan"), run = await subject("run"), actual = await subject("actual_journey");
    await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Assessment operator')", [operator]);
    await q("INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)", [route, operator]);
    await q("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Assessment stop')", [stop]);
    await q("INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)", [pattern, route, context().corridor]);
    await q("INSERT INTO v2_pattern_versions(pattern_subject_id,version) VALUES($1,1)", [pattern]);
    await q("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,1,0,$2),($1,1,1,$2)", [pattern, stop]);
    await q("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1", [pattern]);
    await q("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$2,1,'fixed_time')", [plan, pattern]);
    await q("INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,28800)", [run, plan, pattern]);
    await q("INSERT INTO v2_actual_journeys(subject_id) VALUES($1)", [actual]);
    return { operator, route, pattern, stop, plan, run, actual };
  }
  test("assessment: no evidence remains unknown without a fabricated fare", async () => {
    const id = await lead(), result = await evaluate(id, "fare.quoted", fareScope());
    assert.deepEqual(result.candidates, []); assert.equal(result.dispute, "none");
    await record(id, "fare.quoted", fareScope()); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("assessment: minimal unprovided and undated facts remain reported", async () => {
    const id = await lead(); await report(id, "departure.reported", { time: "00:00", basis: "unspecified" }, {}, { date: null, basis: "unprovided", sources: [] });
    const r = await evaluate(id, "departure.reported");
    assert.equal(r.candidates[0].value.time, "00:00"); assert.equal(r.candidates[0].support, "reported");
    assert.equal(r.candidates[0].freshness, "unknown"); assert.equal(r.needsContext, true);
  });
  test("assessment: two dated accounts with disjoint origins corroborate one comparable value", async () => {
    const id = await lead(), scope = fareScope(); const a = await report(id, "fare.quoted", fare("25"), scope), b = await report(id, "fare.quoted", fare("25.00"), scope, { owner: context().other });
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].support, "corroborated"); assert.equal(r.candidates[0].contributors, 2);
    assert.deepEqual(r.candidates[0].witnesses, [a.observation, b.observation].sort());
    assert.equal(r.candidates[0].value.amount, "25");
    const assessment = await record(id, "fare.quoted", scope); assert.equal((await read(id, "fare.quoted", scope)).assessmentId, assessment);
  });
  test("assessment: repeated accounts, even with distinct documents, cannot create a witness pair", async () => {
    const id = await lead(), scope = fareScope();
    for (let i = 0; i < 3; i++) await report(id, "fare.quoted", fare(), scope);
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates[0].contributors, 1);
    assert.equal(r.candidates[0].support, "reported"); assert.deepEqual(r.candidates[0].witnesses, []);
  });
  test("assessment: latest eligible report wins within the same account and origin", async () => {
    const id = await lead(), scope = fareScope(), s = await source();
    await report(id, "fare.quoted", fare("10"), scope, { sources: [s], date: "2026-09-25" });
    await report(id, "fare.quoted", fare("20"), scope, { sources: [s], date: "2026-10-01" });
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates.length, 1); assert.equal(r.candidates[0].value.amount, "20");
    assert.ok(r.inputs.some((x: { reason: string }) => x.reason === "repeated_account_source"));
  });
  test("assessment: copied documents and overlapping compound citations cannot corroborate", async () => {
    const id = await lead(), scope = fareScope(), a = await source(), b = await source(), copied = await source(context().other);
    await link(b, copied); await report(id, "fare.quoted", fare(), scope, { sources: [a, b] });
    await report(id, "fare.quoted", fare(), scope, { sources: [copied], owner: context().other });
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates[0].contributors, 2); assert.equal(r.candidates[0].support, "reported");
  });
  test("assessment: unknown sources and hearsay cannot supply witnesses", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope);
    await report(id, "fare.quoted", fare(), scope, { owner: context().other, basis: "heard_from_other" });
    assert.equal((await evaluate(id, "fare.quoted", scope)).candidates[0].support, "reported");
    const unknown = await source(context().other, null, "unprovided");
    await report(id, "fare.quoted", fare(), scope, { owner: context().other, sources: [unknown] });
    assert.equal((await evaluate(id, "fare.quoted", scope)).candidates[0].support, "reported");
  });
  test("assessment: unknown fare qualifiers do not corroborate or falsely conflict", async () => {
    const id = await lead(), scope = fareScope({ passengerCategory: "unknown", paymentMethod: null });
    await report(id, "fare.quoted", fare("20"), scope); await report(id, "fare.quoted", fare("30"), scope, { owner: context().other });
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates.length, 2); assert.equal(r.dispute, "none"); assert.equal(r.needsContext, true);
  });
  test("assessment: current incompatible values open a dispute without averaging or choosing a winner", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare("20"), scope); await report(id, "fare.quoted", fare("30"), scope, { owner: context().other });
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.dispute, "open");
    assert.deepEqual(r.candidates.map((x: { value: { amount: string } }) => x.value.amount), ["20", "30"]); assert.equal(r.selectedValue, undefined);
  });
  test("assessment: currencies and fare conditions remain separate propositions", async () => {
    const id = await lead(), scope = fareScope(), child = fareScope({ passengerCategory: "child" });
    await report(id, "fare.quoted", fare("20", "USD"), scope); await report(id, "fare.quoted", fare("30", "ZAR"), scope, { owner: context().other });
    await report(id, "fare.quoted", fare("8"), child);
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates.length, 2); assert.equal(r.dispute, "none");
    assert.equal((await evaluate(id, "fare.quoted", child)).candidates[0].value.amount, "8");
  });
  test("assessment: explicit free remains a reported amount and not an unknown price", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare("0.00"), scope);
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates[0].value.amount, "0"); assert.equal(r.candidates[0].support, "reported");
  });
  test("assessment: old source dates dominate upload time and cannot be refreshed by a copied source", async () => {
    const id = await lead(), scope = fareScope(); const a = await source(context().user, "2026-07-01", "document"), b = await source(context().other, "2026-10-01", "document");
    await link(a, b); await report(id, "fare.quoted", fare(), scope, { owner: context().other, sources: [b] });
    const r = await evaluate(id, "fare.quoted", scope); assert.equal(r.candidates[0].freshness, "recheck_due"); assert.equal(r.candidates[0].oldestDate, "2026-07-01");
  });
  test("assessment: a fresh pickup report cannot refresh an old fare", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope, { sourceDate: "2026-07-01" });
    await record(id, "fare.quoted", scope); await report(id, "boarding.pickup", { cityId: context().origin, name: "Bus station" });
    assert.equal((await read(id, "fare.quoted", scope)).status, "recheck_required");
    assert.equal((await evaluate(id, "fare.quoted", scope)).candidates[0].freshness, "recheck_due");
  });
  test("assessment: paid fares and actual times remain historical rather than ongoing current claims", async () => {
    const t = await transport(), scope = fareScope({ quotationDate: null, serviceDate: "2020-01-01", timeBasis: "actual" });
    await report(t.actual, "fare.paid", fare(), scope, { basis: "travelled" });
    await report(t.actual, "departure.actual", { time: "08:20" }, { schemaVersion: "1.0", serviceDate: "2020-01-01", utcOffset: "+02:00" }, { basis: "travelled" });
    const r = await evaluate(t.actual, "fare.paid", scope); assert.equal(r.candidates[0].temporalClass, "historical"); assert.equal(r.candidates[0].freshness, "unknown");
    assert.equal(r.candidates[0].oldestDate, "2020-01-01"); assert.equal(r.candidates[0].support, "reported");
  });
  test("assessment: service-local expiry is inclusive and read-time expiry defeats a sleeping worker", async () => {
    const t = await transport(), scope = { schemaVersion: "1.0", serviceDate: "2026-10-02", timezone: "Africa/Harare" };
    await report(t.run, "departure.scheduled", { seconds: 90000 }, scope); const id = await record(t.run, "departure.scheduled", scope);
    const row = (await q("SELECT valid_until FROM v2_field_assessments WHERE id=$1", [id])).rows[0]; assert.equal(row.valid_until.toISOString(), "2026-10-02T22:00:00.000Z");
    assert.equal((await read(t.run, "departure.scheduled", scope, "2026-10-02T21:59:59Z")).status, "assessed");
    assert.deepEqual(await read(t.run, "departure.scheduled", scope, "2026-10-02T22:00:00Z"), { status: "recheck_required" });
    assert.ok((await q("SELECT available_at FROM v2_jobs WHERE trigger_id=$1", [id])).rows.some(r => r.available_at.toISOString() === "2026-10-02T22:00:00.000Z"));
  });
  test("assessment: end-of-day boundaries handle DST and conservative unknown zones", async () => {
    const r = (await q("SELECT v2_assessment_day_end('2026-03-28',0,'Europe/Berlin') a,v2_assessment_day_end('2026-03-29',0,'Europe/Berlin') b,v2_assessment_day_end('2026-10-01',0,NULL) c")).rows[0];
    assert.equal(r.a.toISOString(), "2026-03-28T23:00:00.000Z"); assert.equal(r.b.toISOString(), "2026-03-29T22:00:00.000Z"); assert.equal(r.c.toISOString(), "2026-10-01T10:00:00.000Z");
  });
  test("assessment: session timezone does not change output, input digest or retry identity", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope);
    const before = await evaluate(id, "fare.quoted", scope), values = await args(id, "fare.quoted", scope);
    const a = (await q(assessSQL, values)).rows[0].id;
    await q("SET LOCAL TIME ZONE 'Pacific/Auckland'");
    assert.deepEqual(await evaluate(id, "fare.quoted", scope), before); assert.equal((await q(assessSQL, values)).rows[0].id, a);
    await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("assessment: input identity is stable within a validity interval and includes scope and source revision", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope);
    const a = await record(id, "fare.quoted", scope), b = await record(id, "fare.quoted", scope, "2026-10-02T13:00:00Z");
    const rows = (await q("SELECT input_digest,assessed_at FROM v2_field_assessments WHERE id=ANY($1::uuid[]) ORDER BY revision", [[a, b]])).rows;
    assert.equal(rows[0].input_digest, rows[1].input_digest); assert.notEqual(rows[0].assessed_at.toISOString(), rows[1].assessed_at.toISOString());
    const result = await evaluate(id, "fare.quoted", scope);
    const digests = (await q(`SELECT v2_assessment_input_digest($1,'fare.quoted',$2,1,$3) a,
      v2_assessment_input_digest($1,'fare.quoted',$4,1,$3) b,v2_assessment_input_digest($1,'fare.quoted',$2,2,$3) c`,
      [id, scope, result, fareScope({ passengerCategory: "child" })])).rows[0];
    assert.notEqual(digests.a, digests.b); assert.notEqual(digests.a, digests.c);
  });
  test("assessment: expiry and not-yet-effective reports are excluded without inventing a replacement", async () => {
    const t = await transport(), scope = { schemaVersion: "1.0", effectiveFrom: "2026-10-05", effectiveTo: "2026-10-10", timezone: "Africa/Harare" };
    await report(t.run, "departure.scheduled", { seconds: 28800 }, scope);
    const before = await evaluate(t.run, "departure.scheduled", scope); assert.deepEqual(before.candidates, []); assert.equal(before.inputs[0].reason, "not_yet_effective");
    const after = await evaluate(t.run, "departure.scheduled", scope, "2026-10-11T12:00:00Z"); assert.deepEqual(after.candidates, []); assert.equal(after.inputs[0].reason, "expired");
  });
  test("assessment: unreviewed disruption expires after seven days and never becomes operating", async () => {
    const t = await transport(), scope = { schemaVersion: "1.0", effectiveFrom: "2026-09-01", effectiveTo: "2026-12-31", timezone: "Africa/Harare" };
    await report(t.plan, "service.operating_status", { status: "temporarily_suspended", basis: "observed_sign" }, scope, { date: "2026-09-20" });
    const r = await evaluate(t.plan, "service.operating_status", scope); assert.deepEqual(r.candidates, []); assert.equal(r.inputs[0].freshness, "expired");
  });
  test("assessment: a future evidence date cannot borrow an old source date to become admissible", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope, { date: "2026-10-03", sourceDate: "2026-10-01" });
    const r = await evaluate(id, "fare.quoted", scope); assert.deepEqual(r.candidates, []); assert.equal(r.inputs[0].reason, "future_or_invalid_date");
    assert.equal(new Date(r.nextChangeAt).toISOString(), "2026-10-03T12:00:00.000Z");
    assert.deepEqual((await evaluate(id, "fare.quoted", scope, "2026-10-03T11:59:59Z")).candidates, []);
    assert.equal((await evaluate(id, "fare.quoted", scope, "2026-10-03T12:00:00Z")).candidates[0].support, "reported");
  });
  test("assessment: reported lead clocks and unresolved pattern variants remain incomplete", async () => {
    const id = await lead(); await report(id, "departure.reported", { time: "08:00", basis: "scheduled" });
    await report(id, "departure.reported", { time: "14:00", basis: "scheduled" }, {}, { owner: context().other });
    const r = await evaluate(id, "departure.reported"); assert.equal(r.dispute, "none"); assert.equal(r.needsContext, true); assert.equal(r.candidates.length, 2);
  });
  test("assessment: withdrawal removes current results and exact retries do not resurrect them", async () => {
    const id = await lead(), scope = fareScope(), o = await report(id, "fare.quoted", fare(), scope), values = await args(id, "fare.quoted", scope);
    const a = (await q(assessSQL, values)).rows[0].id; assert.equal((await q(assessSQL, values)).rows[0].id, a);
    await q("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)", [context().user, o.observation, randomUUID()]);
    assert.equal((await read(id, "fare.quoted", scope)).status, "recheck_required"); assert.equal((await q(assessSQL, values)).rows[0].id, a);
    assert.equal((await read(id, "fare.quoted", scope)).status, "recheck_required"); assert.deepEqual((await evaluate(id, "fare.quoted", scope)).candidates, []);
    await invalid(() => q(assessSQL, values.map((v, i) => i === 3 ? {} : v)));
  });
  test("assessment: source regrouping invalidates old corroboration and recomputes reported", async () => {
    const id = await lead(), scope = fareScope(), a = await report(id, "fare.quoted", fare(), scope), b = await report(id, "fare.quoted", fare(), scope, { owner: context().other });
    await record(id, "fare.quoted", scope); await link(a.sources[0], b.sources[0]);
    assert.equal((await read(id, "fare.quoted", scope)).status, "recheck_required");
    assert.equal((await evaluate(id, "fare.quoted", scope)).candidates[0].support, "reported");
  });
  test("assessment: account erasure removes all copied outcomes, footprints and evidence identifiers", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope); await report(id, "fare.quoted", fare(), scope, { owner: context().other });
    const a = await record(id, "fare.quoted", scope);
    await q("SET LOCAL ROLE mabhazi_api"); await q("DELETE FROM users WHERE id=$1", [context().user]); await q("RESET ROLE");
    assert.deepEqual((await q("SELECT erased,result,scope,request_digest,input_digest FROM v2_field_assessments WHERE id=$1", [a])).rows[0], { erased: true, result: null, scope: null, request_digest: null, input_digest: null });
    assert.ok((await q("SELECT * FROM v2_assessment_inputs WHERE assessment_id=$1", [a])).rows.every(r => r.erased && r.observation_id === null && r.snapshot === null));
    assert.equal((await evaluate(id, "fare.quoted", scope)).candidates[0].contributors, 1); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("assessment: source-only deletion erases snapshots despite surviving reports", async () => {
    const id = await lead(), scope = fareScope(), o = await report(id, "fare.quoted", fare(), scope), a = await record(id, "fare.quoted", scope);
    await q("DELETE FROM v2_sources WHERE id=$1", [o.sources[0]]);
    assert.equal((await q("SELECT erased FROM v2_field_assessments WHERE id=$1", [a])).rows[0].erased, true);
    assert.equal((await q("SELECT count(*) FROM v2_observations WHERE id=$1", [o.observation])).rows[0].count, "1");
  });
  test("assessment: policies are immutable and activation invalidates the old result with durable work", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope); await record(id, "fare.quoted", scope);
    await invalid(() => q("UPDATE v2_evidence_policies SET schedule_days=1 WHERE version='evidence/1'"));
    await q("INSERT INTO v2_evidence_policies SELECT 'evidence/2',engine,10,place_days,operator_days,disruption_days,witness_count,now() FROM v2_evidence_policies WHERE version='evidence/1'");
    await q("UPDATE v2_evidence_policy_state SET version='evidence/2',revision=revision+1 WHERE id");
    assert.equal((await read(id, "fare.quoted", scope)).status, "recheck_required");
    assert.ok(Number((await q("SELECT count(*) FROM v2_jobs WHERE subject_id=$1 AND policy_version='evidence/2'", [id])).rows[0].count) > 0);
  });
  test("assessment: stale revisions, scope/hash mismatch and future assessment times reject", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope); const values = await args(id, "fare.quoted", scope);
    for (const index of [4, 5, 6]) await invalid(() => q(assessSQL, values.map((v, i) => i === index ? Number(v) + 1 : v)), ["40001"]);
    await invalid(() => q(assessSQL, values.map((v, i) => i === 2 ? "b".repeat(64) : v)));
    await invalid(() => q(assessSQL, values.map((v, i) => i === 7 ? "2099-01-01T00:00:00Z" : v)));
  });
  test("assessment: append-only histories and current pointers reject rewriting and stale reapplication", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope); const a = await record(id, "fare.quoted", scope);
    await invalid(() => q("UPDATE v2_field_assessments SET result='{}' WHERE id=$1", [a])); await invalid(() => q("DELETE FROM v2_field_assessments WHERE id=$1", [a]));
    await invalid(() => q("UPDATE v2_assessment_inputs SET snapshot='{}' WHERE assessment_id=$1", [a]));
    await report(id, "fare.quoted", fare("30"), scope, { owner: context().other });
    await invalid(async () => q("INSERT INTO v2_current_assessments VALUES($1,'fare.quoted',$2,$3)", [id, await hash(scope), a]));
  });
  test("assessment: immediate-mode callers can record complete validated input snapshots", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope); await q("SET CONSTRAINTS ALL IMMEDIATE");
    await record(id, "fare.quoted", scope); await q("SET CONSTRAINTS ALL IMMEDIATE");
  });
  test("assessment: a forged result cannot claim extra support even through an owner fixture", async () => {
    const id = await lead(), scope = fareScope(); await report(id, "fare.quoted", fare(), scope); const a = await record(id, "fare.quoted", scope);
    await invalid(() => q(`INSERT INTO v2_field_assessments(id,subject_id,field_key,scope_key,scope,revision,previous_id,subject_revision,input_generation,
      source_graph_revision,policy_version,request_id,request_digest,input_digest,assessed_at,valid_until,result)
      SELECT gen_random_uuid(),subject_id,field_key,scope_key,scope,revision+1,id,subject_revision,input_generation,
      source_graph_revision,policy_version,gen_random_uuid(),request_digest,input_digest,assessed_at,valid_until,
      jsonb_set(result,'{candidates,0,support}','"corroborated"') FROM v2_field_assessments WHERE id=$1`, [a]));
  });
  test("assessment: all 18 registered fields are evaluated without inventing unprovided qualifiers", async () => {
    const t = await transport(), id = await lead();
    const temporal = { schemaVersion: "1.0", serviceDate: "2026-10-02", timezone: "Africa/Harare" };
    const cases: Array<[string,string,unknown,unknown]> = [
      [id,"operator.reported",{name:"Assessment bus"},{}], [id,"departure.reported",{time:"08:00",basis:"unspecified"},{}],
      [t.route,"operator.identity",{id:t.operator},{}], [t.plan,"service.mode",{mode:"fixed_time"},{}],
      [t.plan,"service.calendar",{weekdays:[1,2,3],startDate:"2026-10-01",endDate:"2026-10-31",timezone:"Africa/Harare"},{}],
      [t.run,"departure.scheduled",{seconds:28800},temporal], [t.run,"arrival.scheduled",{seconds:90000},temporal],
      [t.actual,"departure.actual",{time:"08:00"},temporal], [t.actual,"arrival.actual",{time:"14:00"},temporal],
      [t.actual,"boarding.pickup",{stopId:t.stop},{}], [t.actual,"alighting.dropoff",{cityId:context().destination,name:"Terminus"},{}],
      [t.pattern,"pattern.stops",{stops:[{place:{stopId:t.stop},pickup:"allowed",dropoff:"allowed"},{place:{stopId:t.stop},pickup:"allowed",dropoff:"allowed"}],stopsComplete:true},{}],
      [t.stop,"stop.location",{cityId:context().origin,name:"Main stop",precision:"named_place"},{}],
      [t.actual,"fare.paid",fare(),fareScope({quotationDate:null,serviceDate:"2026-10-01",timeBasis:"actual"})],
      [id,"fare.quoted",fare(),fareScope()], [id,"fare.advertised",fare(),fareScope({quotationDate:null,effectiveFrom:"2026-10-01",effectiveTo:"2026-10-31"})],
      [t.plan,"service.operating_status",{status:"operating",basis:"observed_sign"},temporal],
      [t.stop,"timetable.sign_presence",{status:"not_seen",place:{stopId:t.stop}},temporal],
    ];
    for (const [target,field,value,scope] of cases) {
      await report(target,field,value,scope); const r = await evaluate(target,field,scope);
      assert.equal(r.inputs.length,1,field); assert.equal(r.candidates.length,1,field); await record(target,field,scope);
    }
  });
  test("assessment: backend reads current-time summaries but cannot write or supply a historical clock", async () => {
    const id = await lead(), scope = fareScope(); const values = await args(id, "fare.quoted", scope);
    for (const role of ["anon", "authenticated", "mabhazi_api"]) {
      await q(`SET LOCAL ROLE ${role}`);
      for (const table of evidenceAssessmentTables.map(getTableName)) {
        if (role === "mabhazi_api") await q(`SELECT * FROM ${table}`); else await invalid(() => q(`SELECT * FROM ${table}`), ["42501"]);
        await invalid(() => q(`DELETE FROM ${table}`), ["42501"]); await invalid(() => q(`TRUNCATE ${table}`), ["42501"]);
      }
      await invalid(() => q(assessSQL, values), ["42501"]); await invalid(() => q("SELECT v2_read_assessment_at($1,'fare.quoted',$2,$3)", [id, values[2], at]), ["42501"]);
      if (role === "mabhazi_api") await q("SELECT v2_read_assessment($1,'fare.quoted',$2)", [id, values[2]]);
      else await invalid(() => q("SELECT v2_read_assessment($1,'fare.quoted',$2)", [id, values[2]]), ["42501"]);
      await q("RESET ROLE");
    }
  });
  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) {
    test(`assessment: withdrawal rejects a concurrent assessment of stale evidence at ${isolation}`, { timeout: 20_000 }, async () => {
      const id = await lead(), scope = fareScope(), o = await report(id, "fare.quoted", fare(), scope), values = await args(id, "fare.quoted", scope); await q("COMMIT");
      const left = new pg.Client({ connectionString: context().connectionString }), right = new pg.Client({ connectionString: context().connectionString });
      await left.connect(); await right.connect();
      try {
        await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await right.query("SET LOCAL statement_timeout='5s'"); await right.query("SELECT input_generation FROM v2_subjects WHERE id=$1", [id]);
        await left.query("SELECT v2_withdraw_observation($1,$2,1,$3,NULL)", [context().user, o.observation, randomUUID()]);
        const result = right.query(assessSQL, values).then(() => "unexpected_success", (e: { code: string }) => e.code);
        await left.query("COMMIT"); assert.equal(await result, "40001"); await right.query("ROLLBACK");
      } finally { await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end(); await q("BEGIN"); }
    });
  }
}
