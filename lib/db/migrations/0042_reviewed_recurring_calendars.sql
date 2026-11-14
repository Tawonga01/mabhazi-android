-- Reviewed recurring-calendar writer prerequisite for administrative timetables.
-- No new public/backend permissions, no timetable publication and no inference.
-- Existing reviewed proposals, exact snapshots, epochs and reversal are reused.
CREATE OR REPLACE FUNCTION public.v2_edit_snapshot(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb; kind text; chosen_version integer;
BEGIN
 result:=public.v2_transport_snapshot(subject); kind:=result->>'kind';
 IF kind='pattern' THEN
  chosen_version:=(result->'data'->>'current_pattern_version')::integer;
  result:=result || jsonb_build_object('patternVersion',(SELECT to_jsonb(v) FROM public.v2_pattern_versions v WHERE pattern_subject_id=subject AND v.version=chosen_version),
   'patternStops',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY sequence) FROM public.v2_pattern_stops s WHERE pattern_subject_id=subject AND pattern_version=chosen_version),'[]'::jsonb));
 ELSIF kind='service_plan' THEN
  -- Include calendar contents, not just its UUID. A later metadata change must
  -- make the exact reviewed snapshot stale rather than change a live schedule.
  result:=result || jsonb_build_object('calendar',(SELECT to_jsonb(c) FROM public.v2_calendars c
   JOIN public.v2_service_plans p ON p.calendar_id=c.id WHERE p.subject_id=subject));
 ELSIF kind='run' THEN
  result:=result || jsonb_build_object('runStopTimes',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY pattern_sequence) FROM public.v2_run_stop_times t WHERE run_subject_id=subject),'[]'::jsonb));
 END IF;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.v2_edit_after(subject uuid,observation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb; data jsonb; o public.v2_observations; plan public.v2_service_plans; kind text; n integer; stops jsonb; meta jsonb; item jsonb; normalized public.v2_stops;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR o.original_subject_id IS DISTINCT FROM subject OR public.v2_observation_subject(observation) IS DISTINCT FROM subject THEN RAISE EXCEPTION 'v2_edit_observation_target_mismatch' USING ERRCODE='23514'; END IF;
 result:=public.v2_edit_snapshot(subject); data:=result->'data'; kind:=result->>'kind';
 IF kind='route' AND o.field_key='operator.identity' THEN
  IF NOT EXISTS(SELECT 1 FROM public.v2_operators p JOIN public.v2_subjects s ON s.id=p.subject_id AND s.lifecycle='active' WHERE p.subject_id=(o.value->>'id')::uuid) THEN
   RAISE EXCEPTION 'v2_edit_operator_inactive' USING ERRCODE='23514'; END IF;
  data:=data || jsonb_build_object('operator_subject_id',(o.value->>'id')::uuid);
 ELSIF kind='stop' AND o.field_key='stop.location' THEN
  -- No surveyed precision, parent hierarchy or invented exact coordinates.
  data:=data || jsonb_build_object('city_id',o.value->'cityId','name',o.value->'name','latitude',o.value->'latitude','longitude',o.value->'longitude','precision',o.value->'precision');
  SELECT * INTO normalized FROM jsonb_populate_record(NULL::public.v2_stops,data);
  data:=to_jsonb(normalized);
  IF normalized.latitude IS DISTINCT FROM (o.value->>'latitude')::numeric OR normalized.longitude IS DISTINCT FROM (o.value->>'longitude')::numeric THEN
   RAISE EXCEPTION 'v2_edit_coordinate_precision_loss' USING ERRCODE='23514'; END IF;
 ELSIF kind='service_plan' AND o.field_key='service.calendar' THEN
  -- This first writer accepts a bounded recurring calendar only. Explicit
  -- dates/exceptions remain represented as observations, never silently lost.
  IF NOT o.value ?& ARRAY['weekdays','startDate','endDate','timezone']
   OR o.value ?| ARRAY['dates','exceptions']
   OR NOT public.v2_calendar_observation_valid(o.value)
   OR NOT EXISTS(SELECT 1 FROM public.v2_timezones WHERE name=o.value->>'timezone')
   THEN RAISE EXCEPTION 'v2_edit_complete_recurring_calendar_required' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM public.v2_runs WHERE service_plan_subject_id=subject)
   THEN RAISE EXCEPTION 'v2_edit_calendar_existing_runs_require_review' USING ERRCODE='23514';END IF;
  SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=subject;
  IF (o.value->>'startDate')::date IS NULL OR (o.value->>'endDate')::date IS NULL
   OR (o.value->>'startDate')::date<(plan.effective_from)
   OR (o.value->>'endDate')::date>(plan.effective_to)
   OR (o.effective_from IS NOT NULL AND (o.value->>'startDate')::date<o.effective_from)
   OR (o.effective_to IS NOT NULL AND (o.value->>'endDate')::date>o.effective_to)
   THEN RAISE EXCEPTION 'v2_edit_calendar_validity_mismatch' USING ERRCODE='23514';END IF;
  SELECT sum(1 << ((day#>>'{}')::integer-1))::integer INTO n FROM jsonb_array_elements(o.value->'weekdays') day;
  -- Observation UUID gives deterministic identity through preview/retry;
  -- creating the row happens only when its exact reviewed edit is applied.
  meta:=jsonb_build_object('id',o.id,'timezone',o.value->>'timezone',
   'start_date',(o.value->>'startDate')::date,'end_date',(o.value->>'endDate')::date,
   'weekdays',n,'coverage','recurring','revision',1);
  IF EXISTS(SELECT 1 FROM public.v2_calendars c WHERE c.id=o.id AND to_jsonb(c)<>meta)
   THEN RAISE EXCEPTION 'v2_edit_calendar_identity_conflict' USING ERRCODE='23514';END IF;
  data:=data || jsonb_build_object('calendar_id',o.id,'timezone',o.value->>'timezone');
  result:=result || jsonb_build_object('calendar',meta);
 ELSIF kind='run' AND o.field_key IN('departure.scheduled','arrival.scheduled') THEN
  SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=(data->>'service_plan_subject_id')::uuid;
  IF (o.scope ? 'timezone' AND o.scope->>'timezone' IS DISTINCT FROM plan.timezone)
   OR (o.scope ? 'calendarId' AND (o.scope->>'calendarId')::uuid IS DISTINCT FROM plan.calendar_id)
   OR (o.scope ? 'serviceDate' AND ((data->>'validity_from')::date IS DISTINCT FROM (o.scope->>'serviceDate')::date OR (data->>'validity_to')::date IS DISTINCT FROM (o.scope->>'serviceDate')::date))
   OR (o.scope ? 'effectiveFrom' AND ((data->>'validity_from')::date IS NULL OR (data->>'validity_from')::date<(o.scope->>'effectiveFrom')::date))
  OR (o.scope ? 'effectiveTo' AND ((data->>'validity_to')::date IS NULL OR (data->>'validity_to')::date>(o.scope->>'effectiveTo')::date))
  OR (o.effective_from IS NOT NULL AND ((data->>'validity_from')::date IS NULL OR (data->>'validity_from')::date<o.effective_from))
  OR (o.effective_to IS NOT NULL AND ((data->>'validity_to')::date IS NULL OR (data->>'validity_to')::date>o.effective_to)) THEN
   RAISE EXCEPTION 'v2_edit_scheduled_scope_mismatch' USING ERRCODE='23514'; END IF;
  data:=data || jsonb_build_object(CASE o.field_key WHEN 'departure.scheduled' THEN 'departure_seconds' ELSE 'arrival_seconds' END,o.value->'seconds');
 ELSIF kind='pattern' AND o.field_key='pattern.stops' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e WHERE e->'place'->>'stopId' IS NULL) THEN
   RAISE EXCEPTION 'v2_edit_resolved_stops_required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e LEFT JOIN public.v2_subjects s ON s.id=(e->'place'->>'stopId')::uuid WHERE s.kind IS DISTINCT FROM 'stop' OR s.lifecycle<>'active') THEN
   RAISE EXCEPTION 'v2_edit_stop_inactive' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(max(version),0)+1 INTO n FROM public.v2_pattern_versions WHERE pattern_subject_id=subject;
  SELECT jsonb_agg(jsonb_build_object('pattern_subject_id',subject,'pattern_version',n,'sequence',ordinality-1,'stop_subject_id',(e->'place'->>'stopId')::uuid,'pickup',e->'pickup','dropoff',e->'dropoff') ORDER BY ordinality)
   INTO stops FROM jsonb_array_elements(o.value->'stops') WITH ORDINALITY a(e,ordinality);
  IF (SELECT jsonb_agg(e-ARRAY['pattern_version','pattern_subject_id']) FROM jsonb_array_elements(stops) e)
   IS NOT DISTINCT FROM (SELECT jsonb_agg(e-ARRAY['pattern_version','pattern_subject_id']) FROM jsonb_array_elements(result->'patternStops') e)
   AND o.value->'stopsComplete' IS NOT DISTINCT FROM result->'patternVersion'->'stops_complete' THEN
   RAISE EXCEPTION 'v2_edit_no_change' USING ERRCODE='23514'; END IF;
  meta:=result->'patternVersion' || jsonb_build_object('version',n,'stops_complete',o.value->'stopsComplete','sealed',true);
  data:=data || jsonb_build_object('current_pattern_version',n);
  result:=result || jsonb_build_object('patternVersion',meta,'patternStops',stops);
 ELSE RAISE EXCEPTION 'v2_edit_field_writer_not_available' USING ERRCODE='23514'; END IF;
 result:=result || jsonb_build_object('data',data);
 IF result=public.v2_edit_snapshot(subject) THEN RAISE EXCEPTION 'v2_edit_no_change' USING ERRCODE='23514'; END IF;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.v2_write_edit_snapshot(subject uuid,snapshot jsonb,edit uuid,review uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE data jsonb:=snapshot->'data'; kind text:=snapshot->>'kind'; meta jsonb; chosen_version integer; item jsonb;
BEGIN
 IF kind='route' THEN UPDATE public.v2_routes SET operator_subject_id=(data->>'operator_subject_id')::uuid WHERE subject_id=subject;
 ELSIF kind='stop' THEN UPDATE public.v2_stops SET city_id=(data->>'city_id')::integer,name=data->>'name',latitude=(data->>'latitude')::numeric,longitude=(data->>'longitude')::numeric,precision=data->>'precision' WHERE subject_id=subject;
 ELSIF kind='service_plan' THEN
  meta:=snapshot->'calendar';
  IF EXISTS(SELECT 1 FROM public.v2_runs WHERE service_plan_subject_id=subject)
   AND EXISTS(SELECT 1 FROM public.v2_review_decisions WHERE id=review AND action='accept')
   THEN RAISE EXCEPTION 'v2_edit_calendar_existing_runs_require_review' USING ERRCODE='23514';END IF;
  IF meta<>'null'::jsonb THEN
   IF meta IS NULL OR meta->>'id' IS DISTINCT FROM data->>'calendar_id'
    OR meta->>'timezone' IS DISTINCT FROM data->>'timezone' OR meta->>'coverage'<>'recurring'
    THEN RAISE EXCEPTION 'v2_edit_calendar_snapshot_invalid' USING ERRCODE='23514';END IF;
   INSERT INTO public.v2_calendars(id,timezone,start_date,end_date,weekdays,coverage,revision)
    VALUES((meta->>'id')::uuid,meta->>'timezone',(meta->>'start_date')::date,(meta->>'end_date')::date,
     (meta->>'weekdays')::integer,meta->>'coverage',(meta->>'revision')::bigint) ON CONFLICT(id) DO NOTHING;
   IF NOT EXISTS(SELECT 1 FROM public.v2_calendars c WHERE c.id=(meta->>'id')::uuid AND to_jsonb(c)=meta)
    THEN RAISE EXCEPTION 'v2_edit_calendar_snapshot_changed' USING ERRCODE='40001';END IF;
  ELSIF data->>'calendar_id' IS NOT NULL THEN RAISE EXCEPTION 'v2_edit_calendar_snapshot_invalid' USING ERRCODE='23514';END IF;
  UPDATE public.v2_service_plans SET calendar_id=(data->>'calendar_id')::uuid,timezone=data->>'timezone' WHERE subject_id=subject;
 ELSIF kind='run' THEN UPDATE public.v2_runs SET departure_seconds=(data->>'departure_seconds')::integer,arrival_seconds=(data->>'arrival_seconds')::integer WHERE subject_id=subject;
 ELSIF kind='pattern' THEN
  meta:=snapshot->'patternVersion'; chosen_version:=(meta->>'version')::integer;
  IF NOT EXISTS(SELECT 1 FROM public.v2_pattern_versions WHERE pattern_subject_id=subject AND v2_pattern_versions.version=chosen_version) THEN
   INSERT INTO public.v2_pattern_versions(pattern_subject_id,version,effective_from,effective_to,stops_complete)
   VALUES(subject,chosen_version,(meta->>'effective_from')::date,(meta->>'effective_to')::date,(meta->>'stops_complete')::boolean);
   FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'patternStops') LOOP
    INSERT INTO public.v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id,pickup,dropoff)
    VALUES(subject,chosen_version,(item->>'sequence')::integer,(item->>'stop_subject_id')::uuid,item->>'pickup',item->>'dropoff');
   END LOOP;
   UPDATE public.v2_pattern_versions SET sealed=true WHERE pattern_subject_id=subject AND v2_pattern_versions.version=chosen_version;
   INSERT INTO public.v2_pattern_version_origins VALUES(subject,chosen_version,edit,review);
  END IF;
  UPDATE public.v2_patterns SET current_pattern_version=chosen_version WHERE subject_id=subject;
 ELSE RAISE EXCEPTION 'v2_edit_writer_not_available' USING ERRCODE='23514'; END IF;
 -- Fail inside the mutation, even when the surrounding transaction deferred
 -- its constraints. Other deferred constraints still run normally at commit.
 IF kind='pattern' THEN PERFORM public.v2_assert_pattern(subject); END IF;
 IF kind='run' THEN PERFORM public.v2_assert_run(subject); END IF;
 IF public.v2_edit_snapshot(subject) IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'v2_edit_projection_does_not_match_approval' USING ERRCODE='23514'; END IF;
END; $$;

-- CREATE OR REPLACE preserves the original restrictive ACLs. Assert the three
-- raw helpers stay private even on installations with broader default grants.
DO $$ DECLARE r text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_edit_snapshot(uuid)','public.v2_edit_after(uuid,uuid)','public.v2_write_edit_snapshot(uuid,jsonb,uuid,uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
 END LOOP;
END;$$;
