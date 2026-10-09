import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

type Context = { db: pg.Client; connectionString: string; user: string; other: string; origin: number; destination: number; corridor: string };
type Fact = { field: string; value: Record<string, unknown>; scope: Record<string, unknown>; kinds: string[] };
const hash = "a".repeat(64);
export function registerObservationRegistryTests(context: () => Context) {
  const q = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function invalid(action: () => Promise<unknown>, codes = ["23514"]) {
    await q("SAVEPOINT invalid_registry");
    try { await assert.rejects(action, (e: unknown) => {
      assert.ok(e instanceof Error && "code" in e); assert.ok(codes.includes(String(e.code)), `${String(e.code)}: ${e.message}`); return true;
    }); } finally { await q("ROLLBACK TO SAVEPOINT invalid_registry"); await q("RELEASE SAVEPOINT invalid_registry"); }
  }
  async function subject(kind: string) {
    return (await q("INSERT INTO v2_subjects(kind) VALUES($1) RETURNING id", [kind])).rows[0].id as string;
  }
  async function contribution(id: string, owner = context().user) {
    return (await q(`INSERT INTO v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
      VALUES($1,gen_random_uuid(),'1.0','route_detail',$2,'{}',$3) RETURNING id`, [owner, hash, id])).rows[0].id as string;
  }
  async function fixture() {
    const ids: Record<string, string> = {};
    for (const kind of ["lead", "operator", "route", "stop", "pattern", "service_plan", "run", "actual_journey"]) ids[kind] = await subject(kind);
    const c = await contribution(ids.lead!);
    await q("INSERT INTO v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_name,initial_contribution_id) VALUES($1,$2,28800,'Registry fixture',$3)", [ids.lead, context().corridor, c]);
    await q("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Registry fixture')", [ids.operator]);
    await q("INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)", [ids.route, ids.operator]);
    await q("INSERT INTO v2_stops(subject_id,city_id,name) VALUES($1,$2,'Fixture origin')", [ids.stop, context().origin]);
    const end = await subject("stop");
    await q("INSERT INTO v2_stops(subject_id,city_id,name) VALUES($1,$2,'Fixture destination')", [end, context().destination]);
    await q("INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)", [ids.pattern, ids.route, context().corridor]);
    await q("INSERT INTO v2_pattern_versions(pattern_subject_id,version) VALUES($1,1)", [ids.pattern]);
    await q("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,1,0,$2),($1,1,1,$3)", [ids.pattern, ids.stop, end]);
    await q("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1", [ids.pattern]);
    await q("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$2,1,'fixed_time')", [ids.service_plan, ids.pattern]);
    await q("INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds) VALUES($1,$2,$3,1,28800)", [ids.run, ids.service_plan, ids.pattern]);
    await q("INSERT INTO v2_actual_journeys(subject_id) VALUES($1)", [ids.actual_journey]);
    const calendar = (await q("INSERT INTO v2_calendars(timezone,coverage) VALUES('Africa/Harare','recurring') RETURNING id")).rows[0].id as string;
    return { ids, end, calendar };
  }
  function facts(f: Awaited<ReturnType<typeof fixture>>): Fact[] {
    const place = { cityId: context().origin, name: "Named boarding place" };
    const timeScope = { schemaVersion: "1.0", timezone: "Africa/Harare", calendarId: f.calendar };
    const fareScope = { schemaVersion: "1.0", segment: { kind: "stop_pair", fromStopId: f.ids.stop, toStopId: f.end }, passengerCategory: "adult", ticketBasis: "one_way", serviceDate: "2026-10-01" };
    return [
      { field: "operator.reported", value: { name: "Printed operator name" }, scope: {}, kinds: ["lead", "actual_journey"] },
      { field: "departure.reported", value: { time: "08:00", basis: "unspecified" }, scope: {}, kinds: ["lead"] },
      { field: "operator.identity", value: { id: f.ids.operator }, scope: {}, kinds: ["route", "lead", "actual_journey"] },
      { field: "service.mode", value: { mode: "when_full" }, scope: {}, kinds: ["lead", "service_plan"] },
      { field: "service.calendar", value: { weekdays: [1, 3, 5], startDate: "2026-10-01", endDate: "2026-12-31", timezone: "Africa/Harare", exceptions: [{ date: "2026-12-25", action: "remove" }] }, scope: {}, kinds: ["service_plan", "lead"] },
      ...["departure.scheduled", "arrival.scheduled"].map(field => ({ field, value: { seconds: 90000 }, scope: timeScope, kinds: ["run", "lead"] })),
      ...["departure.actual", "arrival.actual"].map(field => ({ field, value: { time: "08:20" }, scope: { schemaVersion: "1.0", serviceDate: "2026-10-01", utcOffset: "+02:00" }, kinds: ["actual_journey"] })),
      { field: "boarding.pickup", value: { stopId: f.ids.stop, instructions: "Near the shop" }, scope: {}, kinds: ["lead", "pattern", "actual_journey"] },
      { field: "alighting.dropoff", value: place, scope: {}, kinds: ["lead", "pattern", "actual_journey"] },
      { field: "pattern.stops", value: { stops: [{ place: { stopId: f.ids.stop }, pickup: "unknown", dropoff: "unknown" }, { place, pickup: "allowed", dropoff: "forbidden" }], stopsComplete: false }, scope: {}, kinds: ["pattern", "lead"] },
      { field: "stop.location", value: { ...place, latitude: -17.825, longitude: 31.033, precision: "approximate" }, scope: {}, kinds: ["stop"] },
      ...["fare.paid", "fare.quoted", "fare.advertised"].map(field => ({ field, value: { amount: "0.00", currency: "ZWG" }, scope: fareScope, kinds: ["lead", "pattern", "run", "actual_journey"] })),
      { field: "service.operating_status", value: { status: "temporarily_suspended", basis: "operator_statement" }, scope: { schemaVersion: "1.0", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-03" }, kinds: ["lead", "service_plan", "run"] },
      { field: "timetable.sign_presence", value: { status: "not_seen", place: { stopId: f.ids.stop } }, scope: { schemaVersion: "1.0", serviceDate: "2026-10-01" }, kinds: ["stop", "lead"] },
    ];
  }
  async function observe(id: string, f: Fact, owner = context().user, supersedes: string | null = null) {
    return (await q(`INSERT INTO v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,supersedes_id)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7) RETURNING id`, [await contribution(id, owner), id, f.field, f.value, f.scope, hash, supersedes])).rows[0].id as string;
  }
  async function fieldDecision(id: string, f: Fact, observation: string | null) {
    const decision = randomUUID(), state = (await q("SELECT revision,input_generation FROM v2_subjects WHERE id=$1", [id])).rows[0];
    await q("INSERT INTO v2_decision_ids(id,kind) VALUES($1,'field')", [decision]);
    await q(`INSERT INTO v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,selected_value,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,'none','unknown','provisional',ARRAY['reported_evidence'],'evidence/1',$4)`,
    [decision, id, f.field, hash, f.scope, state.revision, state.input_generation, observation ? f.value : null, observation ? "reported" : "unknown"]);
    if (observation) await q("INSERT INTO v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code) VALUES($1,$2,'supporting','reported_evidence')", [decision, observation]);
    return decision;
  }

  test("registry: all 18 fields enforce their complete subject-kind matrix for observations and decisions", async () => {
    const f = await fixture(); const entries = facts(f); assert.equal(entries.length, 18);
    for (const fact of entries) for (const [kind, id] of Object.entries(f.ids)) {
      if (fact.kinds.includes(kind)) {
        const obs = await observe(id, fact); const decision = await fieldDecision(id, fact, obs);
        await q("SELECT v2_apply_field_decision($1)", [decision]);
      } else {
        await invalid(() => observe(id, fact)); await invalid(() => fieldDecision(id, fact, null));
      }
    }
    await q("SET CONSTRAINTS ALL IMMEDIATE");
    const original = (await q("SELECT reported_departure_seconds,resolved_status FROM v2_leads WHERE subject_id=$1", [f.ids.lead])).rows[0];
    assert.deepEqual(original, { reported_departure_seconds: 28800, resolved_status: "unresolved" });
    assert.equal((await q("SELECT count(*) FROM v2_field_decisions WHERE subject_id=ANY($1::uuid[]) AND (freshness<>'unknown' OR publication<>'provisional')", [Object.values(f.ids)])).rows[0].count, "0");
  });
  test("registry: unknown fields, extra keys, primitive values and incompatible shapes reject", async () => {
    const f = await fixture();
    for (const fact of facts(f)) {
      for (const value of [null, [], "text", 1, {}, { ...fact.value, invented: true }]) {
        assert.equal((await q("SELECT v2_intake_observation_valid($1,$2,$3) valid", [fact.field, JSON.stringify(value), fact.scope])).rows[0].valid, false, fact.field);
      }
      await invalid(() => observe(f.ids[fact.kinds[0]!]!, { ...fact, scope: { ...fact.scope, invented: true } }));
    }
    await invalid(() => observe(f.ids.lead!, { field: "new.arbitrary", value: {}, scope: {}, kinds: [] }));
    await invalid(() => fieldDecision(f.ids.lead!, { field: "new.arbitrary", value: {}, scope: {}, kinds: [] }, null));
  });
  test("registry: calendar reports allow incomplete coverage without inferring recurring days", async () => {
    const f = await fixture(), base = facts(f).find(x => x.field === "service.calendar")!;
    for (const value of [{ weekdays: [2] }, { dates: ["2026-10-02", "2026-10-04"] }, { startDate: "2026-10-01", timezone: null }, { exceptions: [{ date: "2026-10-03", action: "add" }] }]) await observe(f.ids.service_plan!, { ...base, value });
    assert.equal((await q("SELECT calendar_id FROM v2_service_plans WHERE subject_id=$1", [f.ids.service_plan])).rows[0].calendar_id, null);
    for (const value of [{ weekdays: [1, 1] }, { weekdays: [3, 1] }, { weekdays: [0] }, { weekdays: ["1"] }, { weekdays: [1], dates: ["2026-10-02"] }, { dates: ["2026-02-30"] }, { dates: ["2026-10-02", "2026-10-02"] }, { startDate: "2026-10-03", endDate: "2026-10-01" }, { weekdays: [], timezone: "Africa/Harare" }, { exceptions: [{ date: "2026-10-01", action: "add" }, { date: "2026-10-01", action: "remove" }] }]) await invalid(() => observe(f.ids.lead!, { ...base, value }));
  });
  test("registry: scheduled service days may exceed 24h but actual clocks cannot", async () => {
    const f = await fixture(), scheduled = facts(f).find(x => x.field === "departure.scheduled")!, actual = facts(f).find(x => x.field === "departure.actual")!;
    for (const seconds of [0, 86400, 172799]) await observe(f.ids.run!, { ...scheduled, value: { seconds } });
    for (const seconds of [-1, 172800, 1.5, "28800"]) await invalid(() => observe(f.ids.run!, { ...scheduled, value: { seconds } }));
    for (const time of ["24:00", "25:10", "8:20", "08:60"]) await invalid(() => observe(f.ids.actual_journey!, { ...actual, value: { time } }));
    const id = await observe(f.ids.actual_journey!, { ...actual, scope: { schemaVersion: "1.0", serviceDate: null, timezone: null } });
    assert.deepEqual((await q("SELECT scope,observed_from FROM v2_observations WHERE id=$1", [id])).rows[0], { scope: { schemaVersion: "1.0", serviceDate: null, timezone: null }, observed_from: null });
  });
  test("registry: temporal scopes reject bad dates, impossible offsets and ambiguous timezone inputs", async () => {
    const f = await fixture(), actual = facts(f).find(x => x.field === "arrival.actual")!;
    for (const scope of [{ serviceDate: "2026-02-30" }, { serviceDate: "today" }, { utcOffset: "+14:30" }, { utcOffset: "02:00" }, { utcOffset: "+02:00", timezone: "Africa/Harare" }, { calendarId: f.calendar }, { effectiveFrom: "2026-01-01" }]) await invalid(() => observe(f.ids.actual_journey!, { ...actual, scope: { schemaVersion: "1.0", ...scope } }));
    await invalid(() => observe(f.ids.actual_journey!, { ...actual, scope: { schemaVersion: "1.0", timezone: "Invented/Zone" } }), ["23503"]);
  });
  test("registry: calendar and timezone references survive parent edits and reject mismatches", async () => {
    const f = await fixture(), scheduled = facts(f).find(x => x.field === "arrival.scheduled")!;
    const obs = await observe(f.ids.run!, scheduled); await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await q("SELECT count(*) FROM v2_observation_refs WHERE observation_id=$1", [obs])).rows[0].count, "2");
    await invalid(() => q("UPDATE v2_calendars SET timezone='UTC' WHERE id=$1", [f.calendar]), ["23503"]);
    await invalid(() => observe(f.ids.run!, { ...scheduled, scope: { ...scheduled.scope, timezone: "UTC" } }), ["23503"]);
    await invalid(() => observe(f.ids.run!, { ...scheduled, scope: { ...scheduled.scope, calendarId: randomUUID() } }), ["23503"]);
  });
  test("registry: nested stops and named cities require actual transport references", async () => {
    const f = await fixture(), pattern = facts(f).find(x => x.field === "pattern.stops")!, fare = facts(f).find(x => x.field === "fare.paid")!;
    await invalid(() => observe(f.ids.pattern!, { ...pattern, value: { stops: [{ place: { stopId: f.ids.operator }, pickup: "allowed", dropoff: "unknown" }], stopsComplete: false } }), ["23503"]);
    await invalid(() => observe(f.ids.lead!, { ...fare, scope: { ...fare.scope, segment: { kind: "stop_pair", fromStopId: f.ids.stop, toStopId: randomUUID() } } }), ["23503"]);
    await invalid(() => observe(f.ids.route!, { field: "operator.identity", value: { id: f.ids.stop }, scope: {}, kinds: [] }), ["23503"]);
    await invalid(() => observe(f.ids.stop!, { field: "stop.location", value: { cityId: 999999999, name: "Nowhere", precision: "named_place" }, scope: {}, kinds: [] }), ["23503"]);
  });
  test("registry: partial and repeated stop visits retain order and explicit completeness", async () => {
    const f = await fixture(), base = facts(f).find(x => x.field === "pattern.stops")!;
    const stop = { place: { stopId: f.ids.stop }, pickup: "unknown", dropoff: "unknown" };
    const obs = await observe(f.ids.pattern!, { ...base, value: { stops: [stop, stop], stopsComplete: false } });
    assert.deepEqual((await q("SELECT path FROM v2_observation_refs WHERE observation_id=$1 ORDER BY path", [obs])).rows.map(x => x.path), ["value.stops.0.place.stopId", "value.stops.1.place.stopId"]);
    for (const value of [{ stops: [stop], stopsComplete: true }, { stops: [stop] }, { stops: [], stopsComplete: false }, { stops: [{ ...stop, pickup: "sometimes" }], stopsComplete: false }]) await invalid(() => observe(f.ids.pattern!, { ...base, value }));
  });
  test("registry: coordinates cannot invent surveyed precision or accept half a coordinate pair", async () => {
    const f = await fixture(), base = facts(f).find(x => x.field === "stop.location")!;
    for (const value of [{ ...base.value, precision: "surveyed" }, { ...base.value, latitude: 91 }, { ...base.value, longitude: -181 }, { ...base.value, latitude: "-17.8" }, { ...base.value, longitude: null }, { cityId: context().origin, name: "Place", precision: "approximate" }]) await invalid(() => observe(f.ids.stop!, { ...base, value }));
    await observe(f.ids.stop!, { ...base, value: { cityId: context().origin, name: "Place", precision: "named_place" } });
  });
  test("registry: official currency precision rejects unknown codes and never rounds fare values", async () => {
    const f = await fixture(), fare = facts(f).find(x => x.field === "fare.paid")!;
    const reference = JSON.parse(await readFile(new URL("../reference/iso4217-2026-10-09.json", import.meta.url), "utf8")) as { minorUnits: Record<string, number> };
    for (const [code, units] of Object.entries(reference.minorUnits)) assert.equal((await q("SELECT v2_currency_minor_units($1) n", [code])).rows[0].n, units);
    for (const [amount, currency] of [["1.01", "USD"], ["0.00", "ZWG"], ["100", "JPY"], ["1.25", "KWD"]]) await observe(f.ids.lead!, { ...fare, value: { amount, currency } });
    for (const [amount, currency] of [["1.1", "JPY"], ["1.234", "KWD"], ["1.01", "ZZZ"], ["1.00", "XXX"], ["1.00", "XAU"], ["1.00", "usd"], ["-1.00", "USD"], ["10000000000", "USD"]]) await invalid(() => observe(f.ids.lead!, { ...fare, value: { amount, currency } }));
  });
  test("registry: fare qualifiers preserve explicit free, directed segments and dated experience", async () => {
    const f = await fixture(), fare = facts(f).find(x => x.field === "fare.paid")!;
    for (const scope of [{ ...fare.scope, serviceDate: null }, { ...fare.scope, segment: { kind: "stop_pair", fromStopId: f.ids.stop, toStopId: f.ids.stop } }, { ...fare.scope, passengerCategory: "other" }, { ...fare.scope, quotationDate: "2026-02-30" }]) await invalid(() => observe(f.ids.lead!, { ...fare, scope }));
    const obs = await observe(f.ids.actual_journey!, { ...fare, scope: { ...fare.scope, passengerCategory: "other", passengerLabel: "Student", quotationDate: "2026-09-30", sourceDate: null } });
    assert.equal((await q("SELECT value->>'amount' amount FROM v2_observations WHERE id=$1", [obs])).rows[0].amount, "0.00");
  });
  test("registry: operating reports need a basis and bounded applicability; missing signs do not delete timetables", async () => {
    const f = await fixture(), status = facts(f).find(x => x.field === "service.operating_status")!, sign = facts(f).find(x => x.field === "timetable.sign_presence")!;
    for (const scope of [{ schemaVersion: "1.0" }, { schemaVersion: "1.0", effectiveFrom: "2026-10-01" }, { schemaVersion: "1.0", effectiveFrom: "2026-10-03", effectiveTo: "2026-10-01" }]) await invalid(() => observe(f.ids.run!, { ...status, scope }));
    await invalid(() => observe(f.ids.run!, { ...status, value: { status: "not_operating" } }));
    await observe(f.ids.stop!, sign);
    assert.equal((await q("SELECT departure_seconds FROM v2_runs WHERE subject_id=$1", [f.ids.run])).rows[0].departure_seconds, 28800);
  });
  test("registry: generated references cannot be edited, removed, moved or added independently", async () => {
    const f = await fixture(), base = facts(f).find(x => x.field === "boarding.pickup")!;
    const obs = await observe(f.ids.lead!, base); await q("SET CONSTRAINTS ALL IMMEDIATE");
    await invalid(() => q("UPDATE v2_observation_refs SET stop_id=$1 WHERE observation_id=$2", [f.end, obs]));
    await invalid(() => q("DELETE FROM v2_observation_refs WHERE observation_id=$1", [obs]));
    await invalid(() => q("INSERT INTO v2_observation_refs(observation_id,path,stop_id) VALUES($1,'made.up',$2)", [obs, f.end]));
  });
  test("registry: expanded fields retain immutable content and same-owner correction lineage", async () => {
    const f = await fixture(), base = facts(f).find(x => x.field === "arrival.actual")!;
    const obs = await observe(f.ids.actual_journey!, base);
    const next = await observe(f.ids.actual_journey!, { ...base, value: { time: "09:00" } }, context().user, obs);
    await invalid(() => observe(f.ids.actual_journey!, base, context().other, obs));
    await invalid(() => q("UPDATE v2_observations SET value='{" + '"time":"10:00"' + "}' WHERE id=$1", [obs]));
    await q("DELETE FROM v2_observations WHERE id=$1", [obs]);
    assert.equal((await q("SELECT supersedes_id FROM v2_observations WHERE id=$1", [next])).rows[0].supersedes_id, null);
  });
  test("registry: erasure removes nested projections and copied decisions on every target kind", async () => {
    const f = await fixture(); const decisions: string[] = [], observations: string[] = [];
    for (const fact of facts(f)) {
      const id = f.ids[fact.kinds[0]!]!, obs = await observe(id, fact); observations.push(obs);
      const d = await fieldDecision(id, fact, obs); decisions.push(d); await q("SELECT v2_apply_field_decision($1)", [d]);
    }
    const keep = await observe(f.ids.actual_journey!, facts(f).find(x => x.field === "arrival.actual")!, context().other);
    await q("DELETE FROM users WHERE id=$1", [context().user]); await q("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await q("SELECT count(*) FROM v2_observation_refs WHERE observation_id=ANY($1::uuid[])", [observations])).rows[0].count, "0");
    for (const row of (await q("SELECT erased,selected_value,scope,input_digest FROM v2_field_decisions WHERE id=ANY($1::uuid[])", [decisions])).rows) assert.deepEqual(row, { erased: true, selected_value: null, scope: null, input_digest: null });
    assert.equal((await q("SELECT count(*) FROM v2_current_fields WHERE field_decision_id=ANY($1::uuid[])", [decisions])).rows[0].count, "0");
    assert.equal((await q("SELECT count(*) FROM v2_observations WHERE id=$1", [keep])).rows[0].count, "1");
  });
  test("registry: backend can submit validated observations but cannot forge reference projections", async () => {
    const f = await fixture(), base = facts(f).find(x => x.field === "pattern.stops")!;
    await q("SET LOCAL ROLE mabhazi_api");
    const obs = await observe(f.ids.pattern!, base);
    assert.equal((await q("SELECT count(*) FROM v2_observation_refs WHERE observation_id=$1", [obs])).rows[0].count, "2");
    await invalid(() => q("DELETE FROM v2_observation_refs WHERE observation_id=$1", [obs]), ["42501"]);
    await q("SET CONSTRAINTS ALL IMMEDIATE"); await q("RESET ROLE");
    for (const role of ["anon", "authenticated"]) {
      await q(`SET LOCAL ROLE ${role}`);
      await invalid(() => q("SELECT * FROM v2_observation_refs"), ["42501"]);
      await invalid(() => q("SELECT v2_currency_minor_units('USD')"), ["42501"]);
      await q("RESET ROLE");
    }
  });
}
