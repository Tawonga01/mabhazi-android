-- Recheck repair: valid uppercase UUID text identifies the same stored subject.
-- Normalize typed projection only; retain declared observation JSON/history.
-- No old migration or immutable proposal rewrite, public grant or publication.
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
