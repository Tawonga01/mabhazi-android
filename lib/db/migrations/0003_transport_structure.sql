-- Structural transport storage only. Decision lineage/publication follow in later
-- WP02 migrations before any canonical writer or public v2 endpoint is enabled.
ALTER TABLE public.v2_subjects DROP CONSTRAINT v2_subject_kind;
ALTER TABLE public.v2_subjects ADD CONSTRAINT v2_subject_kind CHECK
  (kind IN ('lead','operator','route','stop','pattern','service_plan','run','actual_journey'));

-- A real row write serializes structural edits even at REPEATABLE READ (where
-- the loser must retry 40001). An advisory lock alone cannot refresh its snapshot.
-- Acquire this guard before subject locks in future reviewer/worker transactions.
CREATE TABLE public.v2_transport_guard (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  toggle boolean NOT NULL DEFAULT false
);
INSERT INTO public.v2_transport_guard DEFAULT VALUES;
CREATE FUNCTION public.v2_lock_transport() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'v2_transport_guard_missing'; END IF;
  RETURN NULL;
END;
$$;

CREATE TABLE public.v2_timezones (name text PRIMARY KEY);
INSERT INTO public.v2_timezones(name)
  SELECT name FROM pg_timezone_names WHERE name='UTC'
    OR (name LIKE '%/%' AND name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%');

CREATE TABLE public.v2_routes (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'route' CHECK(subject_kind='route'),
  operator_subject_id uuid NOT NULL REFERENCES public.v2_operators(subject_id),
  public_name text CHECK(length(btrim(public_name)) BETWEEN 1 AND 200),
  public_code text CHECK(length(btrim(public_code)) BETWEEN 1 AND 80),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_routes_operator_idx ON public.v2_routes(operator_subject_id);

CREATE TABLE public.v2_stops (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'stop' CHECK(subject_kind='stop'),
  city_id integer REFERENCES public.cities(id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
  parent_stop_id uuid REFERENCES public.v2_stops(subject_id),
  latitude numeric(9,6) CHECK(latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK(longitude BETWEEN -180 AND 180),
  precision text NOT NULL DEFAULT 'named_place' CHECK(precision IN ('named_place','approximate')),
  CHECK(num_nonnulls(latitude,longitude) IN (0,2)),
  CHECK(precision<>'approximate' OR latitude IS NOT NULL),
  CHECK(parent_stop_id IS NULL OR parent_stop_id<>subject_id),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind) DEFERRABLE INITIALLY DEFERRED
);
-- Surveyed precision requires a reviewed evidence FK in a subsequent migration.
CREATE INDEX v2_stops_city_idx ON public.v2_stops(city_id);
CREATE INDEX v2_stops_parent_idx ON public.v2_stops(parent_stop_id);

CREATE TABLE public.v2_patterns (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'pattern' CHECK(subject_kind='pattern'),
  route_subject_id uuid NOT NULL REFERENCES public.v2_routes(subject_id),
  corridor_id uuid NOT NULL REFERENCES public.v2_corridors(id),
  current_pattern_version integer NOT NULL CHECK(current_pattern_version>=1),
  current_version_sealed boolean NOT NULL DEFAULT true CHECK(current_version_sealed),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_patterns_route_idx ON public.v2_patterns(route_subject_id);
CREATE INDEX v2_patterns_corridor_idx ON public.v2_patterns(corridor_id);
CREATE TABLE public.v2_pattern_versions (
  pattern_subject_id uuid NOT NULL REFERENCES public.v2_patterns(subject_id),
  version integer NOT NULL CHECK(version>=1),
  effective_from date,
  effective_to date,
  stops_complete boolean NOT NULL DEFAULT false,
  sealed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(pattern_subject_id,version),
  UNIQUE(pattern_subject_id,version,sealed),
  CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to>=effective_from)
);
ALTER TABLE public.v2_patterns ADD CONSTRAINT v2_current_pattern_version
  FOREIGN KEY(subject_id,current_pattern_version,current_version_sealed)
  REFERENCES public.v2_pattern_versions(pattern_subject_id,version,sealed) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.v2_pattern_stops (
  pattern_subject_id uuid NOT NULL,
  pattern_version integer NOT NULL,
  sequence integer NOT NULL CHECK(sequence>=0),
  stop_subject_id uuid NOT NULL REFERENCES public.v2_stops(subject_id),
  pickup text NOT NULL DEFAULT 'unknown' CHECK(pickup IN ('allowed','forbidden','request','unknown')),
  dropoff text NOT NULL DEFAULT 'unknown' CHECK(dropoff IN ('allowed','forbidden','request','unknown')),
  PRIMARY KEY(pattern_subject_id,pattern_version,sequence),
  FOREIGN KEY(pattern_subject_id,pattern_version) REFERENCES public.v2_pattern_versions(pattern_subject_id,version)
);
CREATE INDEX v2_pattern_stops_stop_idx ON public.v2_pattern_stops(stop_subject_id);

CREATE TABLE public.v2_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timezone text NOT NULL REFERENCES public.v2_timezones(name),
  start_date date,
  end_date date,
  weekdays integer CHECK(weekdays BETWEEN 1 AND 127),
  coverage text NOT NULL CHECK(coverage IN ('recurring','explicit_dates')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
  CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date),
  CHECK(coverage<>'explicit_dates' OR weekdays IS NULL),
  UNIQUE(id,timezone)
);
CREATE INDEX v2_calendars_timezone_idx ON public.v2_calendars(timezone);
CREATE TABLE public.v2_calendar_exceptions (
  calendar_id uuid NOT NULL REFERENCES public.v2_calendars(id),
  service_date date NOT NULL,
  action text NOT NULL CHECK(action IN ('add','remove')),
  PRIMARY KEY(calendar_id,service_date)
);

CREATE TABLE public.v2_service_plans (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'service_plan' CHECK(subject_kind='service_plan'),
  pattern_subject_id uuid NOT NULL,
  pattern_version integer NOT NULL,
  pattern_sealed boolean NOT NULL DEFAULT true CHECK(pattern_sealed),
  mode text NOT NULL CHECK(mode IN ('fixed_time','frequency','when_full','on_demand','unknown')),
  calendar_id uuid REFERENCES public.v2_calendars(id),
  timezone text REFERENCES public.v2_timezones(name),
  effective_from date,
  effective_to date,
  boarding_instructions text CHECK(length(boarding_instructions)<=1000),
  CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to>=effective_from),
  UNIQUE(subject_id,mode),
  UNIQUE(subject_id,pattern_subject_id,pattern_version,mode),
  FOREIGN KEY(calendar_id,timezone) REFERENCES public.v2_calendars(id,timezone),
  FOREIGN KEY(pattern_subject_id,pattern_version,pattern_sealed)
    REFERENCES public.v2_pattern_versions(pattern_subject_id,version,sealed),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_service_plans_pattern_idx ON public.v2_service_plans(pattern_subject_id,pattern_version);
CREATE INDEX v2_service_plans_calendar_idx ON public.v2_service_plans(calendar_id,timezone);
CREATE INDEX v2_service_plans_timezone_idx ON public.v2_service_plans(timezone);

CREATE TABLE public.v2_runs (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'run' CHECK(subject_kind='run'),
  service_plan_subject_id uuid NOT NULL,
  plan_mode text NOT NULL DEFAULT 'fixed_time' CHECK(plan_mode='fixed_time'),
  pattern_subject_id uuid NOT NULL,
  pattern_version integer NOT NULL,
  departure_seconds integer NOT NULL CHECK(departure_seconds BETWEEN 0 AND 172799),
  arrival_seconds integer CHECK(arrival_seconds BETWEEN 0 AND 172799),
  run_label text CHECK(length(btrim(run_label)) BETWEEN 1 AND 120),
  validity_from date,
  validity_to date,
  CHECK(arrival_seconds IS NULL OR arrival_seconds>=departure_seconds),
  CHECK(validity_to IS NULL OR validity_from IS NULL OR validity_to>=validity_from),
  UNIQUE(subject_id,pattern_subject_id,pattern_version),
  FOREIGN KEY(service_plan_subject_id,pattern_subject_id,pattern_version,plan_mode)
    REFERENCES public.v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_runs_plan_idx ON public.v2_runs(service_plan_subject_id,pattern_subject_id,pattern_version,plan_mode);
CREATE TABLE public.v2_run_stop_times (
  run_subject_id uuid NOT NULL,
  pattern_subject_id uuid NOT NULL,
  pattern_version integer NOT NULL,
  pattern_sequence integer NOT NULL,
  arrival_seconds integer CHECK(arrival_seconds BETWEEN 0 AND 172799),
  departure_seconds integer CHECK(departure_seconds BETWEEN 0 AND 172799),
  PRIMARY KEY(run_subject_id,pattern_sequence),
  CHECK(arrival_seconds IS NULL OR departure_seconds IS NULL OR departure_seconds>=arrival_seconds),
  FOREIGN KEY(run_subject_id,pattern_subject_id,pattern_version)
    REFERENCES public.v2_runs(subject_id,pattern_subject_id,pattern_version),
  FOREIGN KEY(pattern_subject_id,pattern_version,pattern_sequence)
    REFERENCES public.v2_pattern_stops(pattern_subject_id,pattern_version,sequence)
);
CREATE INDEX v2_run_stop_times_pattern_idx ON public.v2_run_stop_times(pattern_subject_id,pattern_version,pattern_sequence);
CREATE TABLE public.v2_frequency_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_plan_subject_id uuid NOT NULL,
  plan_mode text NOT NULL DEFAULT 'frequency' CHECK(plan_mode='frequency'),
  start_seconds integer NOT NULL CHECK(start_seconds>=0),
  end_seconds integer NOT NULL CHECK(end_seconds<=172800),
  headway_seconds integer NOT NULL CHECK(headway_seconds>0),
  CHECK(start_seconds<end_seconds),
  FOREIGN KEY(service_plan_subject_id,plan_mode) REFERENCES public.v2_service_plans(subject_id,mode)
);
CREATE INDEX v2_frequency_windows_plan_idx ON public.v2_frequency_windows(service_plan_subject_id,plan_mode);
CREATE TABLE public.v2_availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_plan_subject_id uuid NOT NULL,
  plan_mode text NOT NULL CHECK(plan_mode IN ('when_full','on_demand')),
  start_seconds integer CHECK(start_seconds>=0),
  end_seconds integer CHECK(end_seconds<=172800),
  booking_note text CHECK(length(booking_note)<=1000),
  CHECK(num_nonnulls(start_seconds,end_seconds) IN (0,2)),
  CHECK(start_seconds IS NULL OR start_seconds<end_seconds),
  FOREIGN KEY(service_plan_subject_id,plan_mode) REFERENCES public.v2_service_plans(subject_id,mode)
);
CREATE INDEX v2_availability_windows_plan_idx ON public.v2_availability_windows(service_plan_subject_id,plan_mode);

CREATE TABLE public.v2_actual_journeys (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'actual_journey' CHECK(subject_kind='actual_journey'),
  reported_service_date date,
  timezone text REFERENCES public.v2_timezones(name),
  intended_subject_id uuid,
  intended_subject_kind text CHECK(intended_subject_kind IN ('lead','route','pattern','service_plan','run')),
  matched_run_subject_id uuid REFERENCES public.v2_runs(subject_id),
  association_status text NOT NULL DEFAULT 'unresolved' CHECK(association_status IN ('unresolved','matched')),
  CHECK(num_nonnulls(intended_subject_id,intended_subject_kind) IN (0,2)),
  CHECK((association_status='matched')=(matched_run_subject_id IS NOT NULL)),
  FOREIGN KEY(intended_subject_id,intended_subject_kind) REFERENCES public.v2_subjects(id,kind),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_actual_journeys_intended_idx ON public.v2_actual_journeys(intended_subject_id,intended_subject_kind);
CREATE INDEX v2_actual_journeys_run_idx ON public.v2_actual_journeys(matched_run_subject_id);
CREATE INDEX v2_actual_journeys_timezone_idx ON public.v2_actual_journeys(timezone);
CREATE TABLE public.v2_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_namespace text NOT NULL CHECK(length(btrim(source_namespace)) BETWEEN 1 AND 200),
  entity_kind text NOT NULL,
  external_id text NOT NULL CHECK(length(btrim(external_id)) BETWEEN 1 AND 200),
  subject_id uuid NOT NULL,
  import_version text NOT NULL CHECK(length(btrim(import_version)) BETWEEN 1 AND 64),
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY(subject_id,entity_kind) REFERENCES public.v2_subjects(id,kind)
);
CREATE UNIQUE INDEX v2_external_ids_active_key ON public.v2_external_ids(source_namespace,entity_kind,external_id) WHERE active;
CREATE INDEX v2_external_ids_subject_idx ON public.v2_external_ids(subject_id,entity_kind);
CREATE TABLE public.v2_legacy_links (
  legacy_journey_id integer NOT NULL REFERENCES public.journeys(id),
  subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
  mapping_state text NOT NULL DEFAULT 'unresolved' CHECK(mapping_state='unresolved'),
  import_version text NOT NULL CHECK(length(btrim(import_version)) BETWEEN 1 AND 64),
  PRIMARY KEY(legacy_journey_id,subject_id)
);
CREATE INDEX v2_legacy_links_subject_idx ON public.v2_legacy_links(subject_id);

CREATE OR REPLACE FUNCTION public.v2_require_intake_subtype() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target uuid; subject_kind text; subtype text; present boolean;
BEGIN
  IF TG_TABLE_NAME='v2_subjects' THEN target:=COALESCE(NEW.id,OLD.id);
  ELSE target:=COALESCE(NEW.subject_id,OLD.subject_id); END IF;
  SELECT kind INTO subject_kind FROM public.v2_subjects WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  subtype:=CASE subject_kind WHEN 'lead' THEN 'v2_leads' WHEN 'operator' THEN 'v2_operators'
    WHEN 'route' THEN 'v2_routes' WHEN 'stop' THEN 'v2_stops' WHEN 'pattern' THEN 'v2_patterns'
    WHEN 'service_plan' THEN 'v2_service_plans' WHEN 'run' THEN 'v2_runs' WHEN 'actual_journey' THEN 'v2_actual_journeys' END;
  IF subtype IS NULL THEN RAISE EXCEPTION 'v2_unknown_subject_kind' USING ERRCODE='23514'; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE subject_id=$1)',subtype) INTO present USING target;
  IF NOT present THEN RAISE EXCEPTION 'v2_subject_requires_subtype' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;

-- A sealed version is an immutable ordered structure. Create a new version to
-- change stops, permissions, completeness or validity; old plans retain theirs.
CREATE FUNCTION public.v2_protect_pattern_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='v2_pattern_versions' THEN
    IF OLD.sealed OR (TG_OP='UPDATE' AND
      (NEW.pattern_subject_id IS DISTINCT FROM OLD.pattern_subject_id OR NEW.version IS DISTINCT FROM OLD.version)) THEN
      RAISE EXCEPTION 'v2_create_new_pattern_version' USING ERRCODE='23514'; END IF;
  ELSE
    IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.v2_pattern_versions WHERE pattern_subject_id=OLD.pattern_subject_id AND version=OLD.pattern_version AND sealed) THEN
      RAISE EXCEPTION 'v2_create_new_pattern_version' USING ERRCODE='23514'; END IF;
    IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM public.v2_pattern_versions WHERE pattern_subject_id=NEW.pattern_subject_id AND version=NEW.pattern_version AND sealed) THEN
      RAISE EXCEPTION 'v2_create_new_pattern_version' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER v2_protect_pattern_version BEFORE UPDATE OR DELETE ON public.v2_pattern_versions
  FOR EACH ROW EXECUTE FUNCTION public.v2_protect_pattern_version();
CREATE TRIGGER v2_protect_pattern_stops BEFORE INSERT OR UPDATE OR DELETE ON public.v2_pattern_stops
  FOR EACH ROW EXECUTE FUNCTION public.v2_protect_pattern_version();

CREATE FUNCTION public.v2_assert_pattern(target uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.v2_pattern_versions v
    JOIN public.v2_patterns p ON p.subject_id=v.pattern_subject_id
    JOIN public.v2_corridors c ON c.id=p.corridor_id
    LEFT JOIN LATERAL (SELECT s.city_id FROM public.v2_pattern_stops ps JOIN public.v2_stops s ON s.subject_id=ps.stop_subject_id
      WHERE ps.pattern_subject_id=v.pattern_subject_id AND ps.pattern_version=v.version ORDER BY ps.sequence LIMIT 1) first_stop ON true
    LEFT JOIN LATERAL (SELECT s.city_id FROM public.v2_pattern_stops ps JOIN public.v2_stops s ON s.subject_id=ps.stop_subject_id
      WHERE ps.pattern_subject_id=v.pattern_subject_id AND ps.pattern_version=v.version ORDER BY ps.sequence DESC LIMIT 1) last_stop ON true
    WHERE v.pattern_subject_id=target AND v.stops_complete AND
      ((SELECT count(*) FROM public.v2_pattern_stops ps WHERE ps.pattern_subject_id=target AND ps.pattern_version=v.version)<2
       OR first_stop.city_id<>c.origin_city_id OR last_stop.city_id<>c.destination_city_id)) THEN
    RAISE EXCEPTION 'v2_complete_pattern_endpoints_mismatch' USING ERRCODE='23514';
  END IF;
END;
$$;
CREATE FUNCTION public.v2_assert_run(target uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM (
    SELECT t.*,r.departure_seconds AS run_departure,r.arrival_seconds AS run_arrival,
      (SELECT min(ps.sequence) FROM public.v2_pattern_stops ps WHERE ps.pattern_subject_id=t.pattern_subject_id AND ps.pattern_version=t.pattern_version) AS first_sequence,
      max(greatest(t.arrival_seconds,t.departure_seconds)) OVER
        (ORDER BY t.pattern_sequence ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_time
    FROM public.v2_run_stop_times t JOIN public.v2_runs r ON r.subject_id=t.run_subject_id WHERE t.run_subject_id=target
  ) times WHERE least(arrival_seconds,departure_seconds)<previous_time
    OR departure_seconds<run_departure
    OR (arrival_seconds<run_departure AND pattern_sequence<>first_sequence)
    OR greatest(arrival_seconds,departure_seconds)>run_arrival) THEN
    RAISE EXCEPTION 'v2_run_times_out_of_order_or_bounds' USING ERRCODE='23514';
  END IF;
END;
$$;
CREATE FUNCTION public.v2_validate_transport() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target uuid; related record;
BEGIN
  IF TG_TABLE_NAME='v2_stops' THEN
    target:=COALESCE(NEW.subject_id,OLD.subject_id);
    IF EXISTS(WITH RECURSIVE ancestors(id,parent,path,cycle) AS (
      SELECT subject_id,parent_stop_id,ARRAY[subject_id],false FROM public.v2_stops WHERE subject_id=target
      UNION ALL SELECT s.subject_id,s.parent_stop_id,a.path||s.subject_id,s.subject_id=ANY(a.path)
        FROM public.v2_stops s JOIN ancestors a ON s.subject_id=a.parent WHERE NOT a.cycle
    ) SELECT 1 FROM ancestors WHERE cycle) THEN
      RAISE EXCEPTION 'v2_stop_parent_cycle' USING ERRCODE='23514'; END IF;
    FOR related IN SELECT DISTINCT pattern_subject_id AS id FROM public.v2_pattern_stops WHERE stop_subject_id=target LOOP
      PERFORM public.v2_assert_pattern(related.id); END LOOP;
  ELSIF TG_TABLE_NAME='v2_corridors' THEN
    FOR related IN SELECT subject_id AS id FROM public.v2_patterns WHERE corridor_id=COALESCE(NEW.id,OLD.id) LOOP
      PERFORM public.v2_assert_pattern(related.id); END LOOP;
  ELSIF TG_TABLE_NAME='v2_patterns' THEN
    PERFORM public.v2_assert_pattern(COALESCE(NEW.subject_id,OLD.subject_id));
  ELSIF TG_TABLE_NAME IN ('v2_pattern_versions','v2_pattern_stops') THEN
    IF TG_OP<>'INSERT' THEN PERFORM public.v2_assert_pattern(OLD.pattern_subject_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM public.v2_assert_pattern(NEW.pattern_subject_id); END IF;
  ELSIF TG_TABLE_NAME='v2_runs' THEN
    PERFORM public.v2_assert_run(COALESCE(NEW.subject_id,OLD.subject_id));
  ELSIF TG_TABLE_NAME='v2_run_stop_times' THEN
    IF TG_OP<>'INSERT' THEN PERFORM public.v2_assert_run(OLD.run_subject_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM public.v2_assert_run(NEW.run_subject_id); END IF;
  END IF;
  RETURN NULL;
END;
$$;

DO $$ DECLARE t text; role_name text; BEGIN
  FOREACH t IN ARRAY ARRAY['v2_routes','v2_stops','v2_patterns','v2_service_plans','v2_runs','v2_actual_journeys'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER v2_subtype AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_intake_subtype()',t);
    EXECUTE format('CREATE TRIGGER v2_identity BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_forbid_subtype_identity_change()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['v2_stops','v2_corridors','v2_patterns','v2_pattern_versions','v2_pattern_stops','v2_runs','v2_run_stop_times'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER v2_transport_integrity AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_validate_transport()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['v2_routes','v2_stops','v2_corridors','v2_patterns','v2_pattern_versions','v2_pattern_stops',
      'v2_calendars','v2_calendar_exceptions','v2_service_plans','v2_runs','v2_run_stop_times',
      'v2_frequency_windows','v2_availability_windows','v2_actual_journeys','v2_external_ids','v2_legacy_links'] LOOP
    EXECUTE format('CREATE TRIGGER v2_transport_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['v2_transport_guard','v2_timezones','v2_routes','v2_stops','v2_patterns','v2_pattern_versions','v2_pattern_stops',
      'v2_calendars','v2_calendar_exceptions','v2_service_plans','v2_runs','v2_run_stop_times',
      'v2_frequency_windows','v2_availability_windows','v2_actual_journeys','v2_external_ids','v2_legacy_links'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
    END LOOP;
    IF t='v2_timezones' THEN EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
    ELSIF t='v2_transport_guard' THEN EXECUTE format('GRANT SELECT,UPDATE ON public.%I TO mabhazi_api',t);
    ELSE EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO mabhazi_api',t); END IF;
    EXECUTE format('CREATE POLICY api_server_access ON public.%I FOR ALL TO mabhazi_api USING(true) WITH CHECK(true)',t);
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.v2_assert_pattern(uuid),public.v2_assert_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v2_assert_pattern(uuid),public.v2_assert_run(uuid) TO mabhazi_api;
