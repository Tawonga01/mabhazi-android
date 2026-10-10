import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

type Context = { db: pg.Client; connectionString: string; origin: number; destination: number; corridor: string };

/** Uses the storage suite's disposable database and per-case rollback hooks. */
export function registerTransportTests(context: () => Context) {
  const query = (sql: string, values: unknown[] = []) => context().db.query(sql, values);
  async function reject(sql: string, values: unknown[] = [], codes = ["23514"]) {
    await query("SAVEPOINT transport_reject");
    try {
      await assert.rejects(query(sql, values), (error: unknown) => {
        assert.ok(error instanceof Error && "code" in error);
        assert.ok(codes.includes(String(error.code)), `${String(error.code)}: ${error.message}`); return true;
      });
    } finally { await query("ROLLBACK TO SAVEPOINT transport_reject"); await query("RELEASE SAVEPOINT transport_reject"); }
  }
  async function subject(kind: string) {
    const id = randomUUID(); await query("INSERT INTO v2_subjects(id,kind) VALUES($1,$2)", [id, kind]); return id;
  }
  async function stop(city: number | null = null) {
    const id = await subject("stop");
    await query("INSERT INTO v2_stops(subject_id,city_id,name) VALUES($1,$2,'Synthetic stop')", [id, city]); return id;
  }
  async function operator() {
    const id = await subject("operator"); await query("INSERT INTO v2_operators(subject_id,display_name) VALUES($1,'Same printed name')", [id]); return id;
  }
  async function route(operatorId = "") {
    const owner = operatorId || await operator(); const id = await subject("route");
    await query("INSERT INTO v2_routes(subject_id,operator_subject_id) VALUES($1,$2)", [id, owner]); return id;
  }
  async function pattern(options: { routeId?: string; stops?: string[]; complete?: boolean; seal?: boolean; corridorId?: string } = {}) {
    const { origin, destination, corridor } = context();
    const r = options.routeId || await route(); const id = await subject("pattern");
    const stops = options.stops || [await stop(origin), await stop(destination)];
    await query("INSERT INTO v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES($1,$2,$3,1)", [id, r, options.corridorId || corridor]);
    await query("INSERT INTO v2_pattern_versions(pattern_subject_id,version,stops_complete) VALUES($1,1,$2)", [id, options.complete ?? true]);
    for (let seq = 0; seq < stops.length; seq++) await query("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,1,$2,$3)", [id, seq, stops[seq]]);
    if (options.seal !== false) await query("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1", [id]);
    return { id, routeId: r, stops, version: 1 };
  }
  async function plan(patternId: string, mode = "fixed_time", version = 1) {
    const id = await subject("service_plan");
    await query("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$2,$3,$4)", [id, patternId, version, mode]); return id;
  }
  async function run(patternId: string, planId: string, departure = 8 * 3600, arrival: number | null = null, version = 1) {
    const id = await subject("run");
    await query(`INSERT INTO v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds,arrival_seconds)
      VALUES($1,$2,$3,$4,$5,$6)`, [id, planId, patternId, version, departure, arrival]); return id;
  }
  async function atStop(runId: string, patternId: string, seq: number, arrival: number | null, departure: number | null) {
    await query(`INSERT INTO v2_run_stop_times(run_subject_id,pattern_subject_id,pattern_version,pattern_sequence,arrival_seconds,departure_seconds)
      VALUES($1,$2,1,$3,$4,$5)`, [runId, patternId, seq, arrival, departure]);
  }

  test("transport: equal company names, direct/stopping variants and different departures stay separate", async () => {
    const a = await pattern(); const b = await pattern();
    const intermediate = await stop();
    const variant = await pattern({ routeId: a.routeId, stops: [a.stops[0]!, intermediate, a.stops[1]!] });
    const p = await plan(a.id); const morning = await run(a.id, p, 7 * 3600); const afternoon = await run(a.id, p, 14 * 3600);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.notEqual(a.routeId, b.routeId); assert.notEqual(a.id, variant.id); assert.notEqual(morning, afternoon);
    assert.equal((await query("SELECT count(*) FROM v2_operators")).rows[0].count, "2");
    assert.equal((await query("SELECT count(*) FROM v2_patterns")).rows[0].count, "3");
  });

  test("transport: every new registry kind requires its matching subtype", async () => {
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const kind of ["route", "stop", "pattern", "service_plan", "run", "actual_journey"]) {
      await reject("INSERT INTO v2_subjects(kind) VALUES($1)", [kind]);
    }
  });

  test("transport: sealed pattern history cannot be rewritten and plans keep their version", async () => {
    const a = await pattern(); const p = await plan(a.id); await query("SET CONSTRAINTS ALL IMMEDIATE");
    await reject("UPDATE v2_pattern_stops SET pickup='allowed' WHERE pattern_subject_id=$1", [a.id]);
    await reject("DELETE FROM v2_pattern_stops WHERE pattern_subject_id=$1", [a.id]);
    await reject("UPDATE v2_pattern_versions SET sealed=false WHERE pattern_subject_id=$1", [a.id]);
    await reject("INSERT INTO v2_pattern_stops VALUES($1,1,3,$2,'allowed','allowed')", [a.id, a.stops[0]]);
    await query("INSERT INTO v2_pattern_versions(pattern_subject_id,version) VALUES($1,2)", [a.id]);
    await query("INSERT INTO v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id) VALUES($1,2,0,$2)", [a.id, a.stops[0]]);
    await query("UPDATE v2_pattern_versions SET sealed=true WHERE pattern_subject_id=$1 AND version=2", [a.id]);
    await query("UPDATE v2_patterns SET current_pattern_version=2 WHERE subject_id=$1", [a.id]);
    assert.equal((await query("SELECT pattern_version FROM v2_service_plans WHERE subject_id=$1", [p])).rows[0].pattern_version, 1);
    assert.equal((await query("SELECT pickup FROM v2_pattern_stops WHERE pattern_subject_id=$1 AND pattern_version=2", [a.id])).rows[0].pickup, "unknown");
  });

  test("transport: incomplete patterns may be partial and repeated stop visits have distinct sequences", async () => {
    const s = await stop(context().origin);
    const partial = await pattern({ stops: [s], complete: false });
    const repeated = await pattern({ stops: [s, s], complete: false });
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await query("SELECT count(*) FROM v2_pattern_stops WHERE pattern_subject_id=$1", [repeated.id])).rows[0].count, "2");
    assert.equal((await query("SELECT stops_complete FROM v2_pattern_versions WHERE pattern_subject_id=$1", [partial.id])).rows[0].stops_complete, false);
  });

  test("transport: current patterns and plans cannot point at an unsealed draft", async () => {
    const a = await pattern({ seal: false });
    await reject("SET CONSTRAINTS ALL IMMEDIATE", [], ["23503"]);
    const id = await subject("service_plan");
    await reject("INSERT INTO v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode) VALUES($1,$2,1,'fixed_time')", [id, a.id], ["23503"]);
  });

  test("transport: known complete endpoints preserve corridor direction under later edits", async () => {
    const a = await pattern(); await query("SET CONSTRAINTS ALL IMMEDIATE");
    const reverse = (await query("INSERT INTO v2_corridors(origin_city_id,destination_city_id) VALUES($1,$2) RETURNING id", [context().destination, context().origin])).rows[0].id;
    await reject("UPDATE v2_patterns SET corridor_id=$1 WHERE subject_id=$2", [reverse, a.id]);
    await reject("UPDATE v2_stops SET city_id=$1 WHERE subject_id=$2", [context().destination, a.stops[0]]);
    await reject("UPDATE v2_corridors SET origin_city_id=$1,destination_city_id=$2 WHERE id=$3", [context().destination, context().origin, context().corridor], ["23505"]);
    await query("SET CONSTRAINTS ALL DEFERRED");
    const opposite = await pattern({ corridorId: reverse, stops: [a.stops[1]!, a.stops[0]!] });
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.notEqual(opposite.id, a.id);
  });

  test("transport: stop parents reject cycles and coordinates require a valid pair", async () => {
    const a = await stop(); const b = await stop(); const c = await stop(); await query("SET CONSTRAINTS ALL IMMEDIATE");
    await query("UPDATE v2_stops SET parent_stop_id=$1 WHERE subject_id=$2", [a, b]);
    await query("UPDATE v2_stops SET parent_stop_id=$1 WHERE subject_id=$2", [b, c]);
    await reject("UPDATE v2_stops SET parent_stop_id=$1 WHERE subject_id=$2", [c, a]);
    await reject("UPDATE v2_stops SET latitude=10 WHERE subject_id=$1", [a]);
    await reject("UPDATE v2_stops SET latitude=91,longitude=10 WHERE subject_id=$1", [a]);
    await reject("UPDATE v2_stops SET precision='surveyed' WHERE subject_id=$1", [a]);
    await query("UPDATE v2_stops SET latitude=-17.825,longitude=31.033,precision='approximate' WHERE subject_id=$1", [a]);
  });

  test("transport: calendar dates, exceptions and named timezones retain explicit unknowns", async () => {
    const id = (await query("INSERT INTO v2_calendars(timezone,coverage) VALUES('Africa/Harare','recurring') RETURNING id")).rows[0].id;
    assert.equal((await query("SELECT weekdays FROM v2_calendars WHERE id=$1", [id])).rows[0].weekdays, null);
    await reject("UPDATE v2_calendars SET weekdays=0 WHERE id=$1", [id]);
    await reject("UPDATE v2_calendars SET start_date='2026-10-10',end_date='2026-10-01' WHERE id=$1", [id]);
    await reject("UPDATE v2_calendars SET timezone='invented/city' WHERE id=$1", [id], ["23503"]);
    await query("INSERT INTO v2_calendar_exceptions VALUES($1,'2026-10-12','add')", [id]);
    await reject("INSERT INTO v2_calendar_exceptions VALUES($1,'2026-10-12','remove')", [id], ["23505"]);
    await query("UPDATE v2_calendars SET coverage='explicit_dates' WHERE id=$1", [id]);
    await reject("UPDATE v2_calendars SET weekdays=127 WHERE id=$1", [id]);
  });

  test("transport: plan/calendar timezone consistency holds from both sides", async () => {
    const a = await pattern(); const p = await plan(a.id);
    const calendar = (await query("INSERT INTO v2_calendars(timezone,coverage,weekdays) VALUES('Africa/Harare','recurring',31) RETURNING id")).rows[0].id;
    await query("UPDATE v2_service_plans SET calendar_id=$1,timezone='Africa/Harare' WHERE subject_id=$2", [calendar, p]);
    await reject("UPDATE v2_service_plans SET timezone='Europe/Berlin' WHERE subject_id=$1", [p], ["23503"]);
    await reject("UPDATE v2_calendars SET timezone='Europe/Berlin' WHERE id=$1", [calendar], ["23503"]);
    await query("UPDATE v2_service_plans SET timezone=NULL WHERE subject_id=$1", [p]);
    assert.equal((await query("SELECT timezone FROM v2_service_plans WHERE subject_id=$1", [p])).rows[0].timezone, null);
  });

  test("transport: scheduled runs require fixed mode and the parent's exact pattern version", async () => {
    const a = await pattern(); const b = await pattern(); const p = await plan(a.id); const r = await run(a.id, p);
    const freq = await plan(a.id, "frequency"); await query("SET CONSTRAINTS ALL IMMEDIATE");
    await reject("UPDATE v2_runs SET service_plan_subject_id=$1 WHERE subject_id=$2", [freq, r], ["23503"]);
    await reject("UPDATE v2_runs SET pattern_subject_id=$1 WHERE subject_id=$2", [b.id, r], ["23503"]);
    await reject("UPDATE v2_service_plans SET mode='frequency' WHERE subject_id=$1", [p], ["23503"]);
  });

  test("transport: overnight seconds and unknown intermediate times remain intact", async () => {
    const s = await stop(); const a = await pattern({ stops: [await stop(context().origin), s, await stop(context().destination)] });
    const p = await plan(a.id); const r = await run(a.id, p, 84600, 90900);
    await atStop(r, a.id, 0, null, 84600); await atStop(r, a.id, 1, null, null); await atStop(r, a.id, 2, 90900, null);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await query("SELECT arrival_seconds FROM v2_runs WHERE subject_id=$1", [r])).rows[0].arrival_seconds, 90900);
    assert.deepEqual((await query("SELECT arrival_seconds,departure_seconds FROM v2_run_stop_times WHERE run_subject_id=$1 AND pattern_sequence=1", [r])).rows[0], { arrival_seconds: null, departure_seconds: null });
    await reject("UPDATE v2_runs SET arrival_seconds=4500 WHERE subject_id=$1", [r]);
    await reject("UPDATE v2_runs SET arrival_seconds=172800 WHERE subject_id=$1", [r]);
  });

  test("transport: stop times reject missing sequences, backward time and parent bound changes", async () => {
    const a = await pattern({ stops: [await stop(context().origin), await stop(), await stop(context().destination)] });
    const p = await plan(a.id); const r = await run(a.id, p, 3600, 10800);
    await atStop(r, a.id, 0, null, 3600); await atStop(r, a.id, 1, 7200, 7300); await atStop(r, a.id, 2, 10800, null);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    await reject("UPDATE v2_run_stop_times SET arrival_seconds=7000 WHERE run_subject_id=$1 AND pattern_sequence=2", [r]);
    await reject("UPDATE v2_runs SET arrival_seconds=8000 WHERE subject_id=$1", [r]);
    await reject("UPDATE v2_run_stop_times SET pattern_sequence=999 WHERE run_subject_id=$1 AND pattern_sequence=2", [r], ["23503"]);
  });

  test("transport: frequency and availability windows cannot masquerade as another mode", async () => {
    const a = await pattern(); const fixed = await plan(a.id); const freq = await plan(a.id, "frequency");
    const full = await plan(a.id, "when_full"); const demand = await plan(a.id, "on_demand"); const unknown = await plan(a.id, "unknown");
    await query("INSERT INTO v2_frequency_windows(service_plan_subject_id,start_seconds,end_seconds,headway_seconds) VALUES($1,3600,7200,600)", [freq]);
    await reject("INSERT INTO v2_frequency_windows(service_plan_subject_id,start_seconds,end_seconds,headway_seconds) VALUES($1,3600,7200,600)", [fixed], ["23503"]);
    await reject("UPDATE v2_frequency_windows SET headway_seconds=0 WHERE service_plan_subject_id=$1", [freq]);
    await query("INSERT INTO v2_availability_windows(service_plan_subject_id,plan_mode) VALUES($1,'when_full'),($2,'on_demand')", [full, demand]);
    await reject("UPDATE v2_availability_windows SET start_seconds=3600 WHERE service_plan_subject_id=$1", [full]);
    await reject("UPDATE v2_availability_windows SET service_plan_subject_id=$1 WHERE service_plan_subject_id=$2", [unknown, full], ["23503"]);
    await reject("UPDATE v2_service_plans SET mode='fixed_time' WHERE subject_id=$1", [freq], ["23503"]);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    assert.equal((await query("SELECT count(*) FROM v2_runs")).rows[0].count, "0");
  });

  test("transport: external identities are namespaced, typed and unique only while active", async () => {
    const a = await route(); const b = await route();
    await query("INSERT INTO v2_external_ids(source_namespace,entity_kind,external_id,subject_id,import_version) VALUES('source-a','route','42',$1,'v1'),('source-b','route','42',$2,'v1')", [a, b]);
    await reject("INSERT INTO v2_external_ids(source_namespace,entity_kind,external_id,subject_id,import_version) VALUES('source-a','route','42',$1,'v2')", [b], ["23505"]);
    await reject("UPDATE v2_external_ids SET entity_kind='run' WHERE subject_id=$1", [a], ["23503"]);
    await query("UPDATE v2_external_ids SET active=false WHERE source_namespace='source-a'");
    await query("INSERT INTO v2_external_ids(source_namespace,entity_kind,external_id,subject_id,import_version) VALUES('source-a','route','42',$1,'v2')", [b]);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
  });

  test("transport: actual journey context and legacy links do not grant reviewed identity", async () => {
    const a = await pattern(); const p = await plan(a.id); const r = await run(a.id, p); const actual = await subject("actual_journey");
    await query("INSERT INTO v2_actual_journeys(subject_id,intended_subject_id,intended_subject_kind) VALUES($1,$2,'run')", [actual, r]);
    await reject("UPDATE v2_actual_journeys SET association_status='matched' WHERE subject_id=$1", [actual]);
    await reject("UPDATE v2_actual_journeys SET intended_subject_kind='route' WHERE subject_id=$1", [actual], ["23503"]);
    const legacy = (await query("SELECT id FROM journeys LIMIT 1")).rows[0].id;
    await query("INSERT INTO v2_legacy_links(legacy_journey_id,subject_id,import_version) VALUES($1,$2,'fixture/1')", [legacy, actual]);
    await reject("UPDATE v2_legacy_links SET mapping_state='reviewed' WHERE legacy_journey_id=$1", [legacy]);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
  });

  test("transport: backend can write through RLS but cannot replace timezone reference data or remove the guard", async () => {
    await query("SET LOCAL ROLE mabhazi_api");
    const a = await pattern(); const p = await plan(a.id); await run(a.id, p);
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    await reject("INSERT INTO v2_timezones VALUES('fake/zone')", [], ["42501"]);
    await reject("DELETE FROM v2_transport_guard", [], ["42501"]);
    await query("RESET ROLE");
  });

  for (const isolation of ["READ COMMITTED", "REPEATABLE READ"]) test(`transport: overlapping stop-parent edits cannot commit a cycle at ${isolation}`, { timeout: 20_000 }, async () => {
    // The main fixture holds the transport guard. Release its rollback-only rows
    // before exercising two committed transactions in this disposable database.
    await query("ROLLBACK");
    const a = randomUUID(), b = randomUUID();
    await query("BEGIN");
    await query("INSERT INTO v2_subjects(id,kind) VALUES($1,'stop'),($2,'stop')", [a, b]);
    await query("INSERT INTO v2_stops(subject_id,name) VALUES($1,'Concurrent A'),($2,'Concurrent B')", [a, b]);
    await query("COMMIT");
    const left = new pg.Client({ connectionString: context().connectionString });
    const right = new pg.Client({ connectionString: context().connectionString });
    await left.connect(); await right.connect();
    try {
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`); await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query("SET LOCAL statement_timeout='5s'");
      await right.query("SELECT * FROM v2_stops WHERE subject_id=$1", [b]); // Fix right's snapshot before left changes it.
      await left.query("UPDATE v2_stops SET parent_stop_id=$1 WHERE subject_id=$2", [b, a]);
      const outcome = right.query("UPDATE v2_stops SET parent_stop_id=$1 WHERE subject_id=$2", [a, b]).then(() => "updated", (e: { code: string }) => e.code);
      await left.query("COMMIT");
      if (isolation === "REPEATABLE READ") {
        assert.equal(await outcome, "40001");
        await right.query("ROLLBACK");
        await right.query("BEGIN");
        await right.query("UPDATE v2_stops SET parent_stop_id=$1 WHERE subject_id=$2", [a, b]);
      } else assert.equal(await outcome, "updated");
      await assert.rejects(right.query("COMMIT"), (e: unknown) => e instanceof Error && "code" in e && e.code === "23514");
    } finally {
      await left.query("ROLLBACK"); await right.query("ROLLBACK"); await left.end(); await right.end();
      await query("BEGIN"); await query("UPDATE v2_stops SET parent_stop_id=NULL WHERE subject_id=ANY($1::uuid[])", [[a, b]]);
      await query("DELETE FROM v2_stops WHERE subject_id=ANY($1::uuid[])", [[a, b]]);
      await query("DELETE FROM v2_subjects WHERE id=ANY($1::uuid[])", [[a, b]]); await query("COMMIT");
      await query("BEGIN"); // Match the shared afterEach rollback hook.
    }
  });
}
