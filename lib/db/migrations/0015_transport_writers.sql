-- Exact observation-backed edits. Approval is bound to an immutable proposal;
-- a reviewed projection is still subject to separate publication/expiry rules.
CREATE TABLE public.v2_transport_edits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
 case_id uuid NOT NULL UNIQUE REFERENCES public.v2_review_cases(id), actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL, field_key text NOT NULL,
 expected_subject_revision bigint NOT NULL CHECK(expected_subject_revision>=1), expected_generation bigint NOT NULL CHECK(expected_generation>=1),
 observation_revision bigint, target_revision bigint, before_snapshot jsonb, after_snapshot jsonb, observation_scope jsonb,
 request_id uuid NOT NULL UNIQUE, request_digest text, erased boolean NOT NULL DEFAULT false,
 policy_version text NOT NULL DEFAULT 'transport-writers/1' CHECK(policy_version='transport-writers/1'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK((erased AND num_nonnulls(observation_id,observation_revision,target_revision,before_snapshot,after_snapshot,observation_scope,request_digest)=0)
  OR (NOT erased AND num_nonnulls(observation_id,observation_revision,target_revision,before_snapshot,after_snapshot,observation_scope)=6
   AND observation_revision>=1 AND target_revision>=1)), CHECK(request_digest IS NULL OR request_digest ~ '^[a-f0-9]{64}$')
);
CREATE INDEX v2_transport_edit_observation_idx ON public.v2_transport_edits(observation_id);
CREATE INDEX v2_transport_edit_subject_idx ON public.v2_transport_edits(subject_id);
CREATE INDEX v2_transport_edit_actor_idx ON public.v2_transport_edits(actor_user_id);
CREATE TABLE public.v2_transport_edit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), edit_id uuid NOT NULL REFERENCES public.v2_transport_edits(id),
 revision bigint NOT NULL CHECK(revision>=1), previous_event_id uuid REFERENCES public.v2_transport_edit_events(id),
 action text NOT NULL CHECK(action IN('apply','reverse','invalidate','erase')),
 actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL, review_id uuid REFERENCES public.v2_review_decisions(id),
 request_id uuid UNIQUE, request_digest text, cause_id uuid,
 resulting_revision bigint NOT NULL CHECK(resulting_revision>=1), resulting_generation bigint NOT NULL CHECK(resulting_generation>=1),
 projection_changed boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT statement_timestamp(), UNIQUE(edit_id,revision),
 CHECK(request_digest IS NULL OR request_digest ~ '^[a-f0-9]{64}$')
);
CREATE INDEX v2_transport_edit_event_review_idx ON public.v2_transport_edit_events(review_id);
CREATE INDEX v2_transport_edit_event_previous_idx ON public.v2_transport_edit_events(previous_event_id);
CREATE INDEX v2_transport_edit_event_actor_idx ON public.v2_transport_edit_events(actor_user_id);
CREATE TABLE public.v2_transport_edit_heads (
 subject_id uuid PRIMARY KEY REFERENCES public.v2_subjects(id), edit_id uuid NOT NULL REFERENCES public.v2_transport_edits(id),
 event_id uuid NOT NULL REFERENCES public.v2_transport_edit_events(id)
);
CREATE INDEX v2_transport_edit_head_edit_idx ON public.v2_transport_edit_heads(edit_id);
CREATE INDEX v2_transport_edit_head_event_idx ON public.v2_transport_edit_heads(event_id);
CREATE TABLE public.v2_pattern_version_origins (
 pattern_subject_id uuid NOT NULL, pattern_version integer NOT NULL, edit_id uuid NOT NULL REFERENCES public.v2_transport_edits(id),
 review_id uuid NOT NULL REFERENCES public.v2_review_decisions(id), PRIMARY KEY(pattern_subject_id,pattern_version),
 FOREIGN KEY(pattern_subject_id,pattern_version) REFERENCES public.v2_pattern_versions(pattern_subject_id,version)
);
CREATE INDEX v2_pattern_origin_edit_idx ON public.v2_pattern_version_origins(edit_id);
CREATE INDEX v2_pattern_origin_review_idx ON public.v2_pattern_version_origins(review_id);

CREATE FUNCTION public.v2_edit_snapshot(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb; kind text; chosen_version integer;
BEGIN
 result:=public.v2_transport_snapshot(subject); kind:=result->>'kind';
 IF kind='pattern' THEN
  chosen_version:=(result->'data'->>'current_pattern_version')::integer;
  result:=result || jsonb_build_object('patternVersion',(SELECT to_jsonb(v) FROM public.v2_pattern_versions v WHERE pattern_subject_id=subject AND v.version=chosen_version),
   'patternStops',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY sequence) FROM public.v2_pattern_stops s WHERE pattern_subject_id=subject AND pattern_version=chosen_version),'[]'::jsonb));
 ELSIF kind='run' THEN
  result:=result || jsonb_build_object('runStopTimes',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY pattern_sequence) FROM public.v2_run_stop_times t WHERE run_subject_id=subject),'[]'::jsonb));
 END IF;
 RETURN result;
END; $$;
CREATE FUNCTION public.v2_edit_after(subject uuid,observation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb; data jsonb; o public.v2_observations; plan public.v2_service_plans; kind text; n integer; stops jsonb; meta jsonb; item jsonb; normalized public.v2_stops;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR o.original_subject_id IS DISTINCT FROM subject OR public.v2_observation_subject(observation) IS DISTINCT FROM subject THEN RAISE EXCEPTION 'v2_edit_observation_target_mismatch' USING ERRCODE='23514'; END IF;
 result:=public.v2_edit_snapshot(subject); data:=result->'data'; kind:=result->>'kind';
 IF kind='route' AND o.field_key='operator.identity' THEN
  IF NOT EXISTS(SELECT 1 FROM public.v2_operators p JOIN public.v2_subjects s ON s.id=p.subject_id AND s.lifecycle='active' WHERE p.subject_id=(o.value->>'id')::uuid) THEN
   RAISE EXCEPTION 'v2_edit_operator_inactive' USING ERRCODE='23514'; END IF;
  data:=data || jsonb_build_object('operator_subject_id',o.value->'id');
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
   OR (o.scope ? 'effectiveTo' AND ((data->>'validity_to')::date IS NULL OR (data->>'validity_to')::date>(o.scope->>'effectiveTo')::date)) THEN
   RAISE EXCEPTION 'v2_edit_scheduled_scope_mismatch' USING ERRCODE='23514'; END IF;
  data:=data || jsonb_build_object(CASE o.field_key WHEN 'departure.scheduled' THEN 'departure_seconds' ELSE 'arrival_seconds' END,o.value->'seconds');
 ELSIF kind='pattern' AND o.field_key='pattern.stops' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e WHERE e->'place'->>'stopId' IS NULL) THEN
   RAISE EXCEPTION 'v2_edit_resolved_stops_required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e LEFT JOIN public.v2_subjects s ON s.id=(e->'place'->>'stopId')::uuid WHERE s.kind IS DISTINCT FROM 'stop' OR s.lifecycle<>'active') THEN
   RAISE EXCEPTION 'v2_edit_stop_inactive' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(max(version),0)+1 INTO n FROM public.v2_pattern_versions WHERE pattern_subject_id=subject;
  SELECT jsonb_agg(jsonb_build_object('pattern_subject_id',subject,'pattern_version',n,'sequence',ordinality-1,'stop_subject_id',e->'place'->'stopId','pickup',e->'pickup','dropoff',e->'dropoff') ORDER BY ordinality)
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
CREATE FUNCTION public.v2_edit_evidence_live(edit uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT NOT e.erased AND s.status='active' AND s.revision=e.observation_revision AND t.revision=e.target_revision
  AND public.v2_observation_subject(o.id)=e.subject_id FROM public.v2_transport_edits e
  JOIN public.v2_observations o ON o.id=e.observation_id JOIN public.v2_observation_states s ON s.observation_id=o.id
  JOIN public.v2_observation_targets t ON t.observation_id=o.id WHERE e.id=edit),false);
$$;
CREATE FUNCTION public.v2_edit_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.v2_subjects; c public.v2_review_cases;
BEGIN
 SELECT * INTO s FROM public.v2_subjects WHERE id=NEW.subject_id;
 SELECT * INTO c FROM public.v2_review_cases WHERE id=NEW.case_id;
 IF NEW.erased OR NEW.actor_user_id IS NULL OR NEW.request_digest IS NULL OR s.lifecycle<>'active'
  OR s.revision IS DISTINCT FROM NEW.expected_subject_revision OR s.input_generation IS DISTINCT FROM NEW.expected_generation
  OR c.subject_id IS DISTINCT FROM s.id OR c.kind<>'identity' OR c.candidate_id IS NOT NULL OR c.last_decision_id IS NOT NULL OR c.field_key IS NOT NULL OR c.scope_key IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.actor_user_id AND revoked_at IS NULL)
  OR NEW.field_key IS DISTINCT FROM (SELECT field_key FROM public.v2_observations WHERE id=NEW.observation_id)
  OR NEW.before_snapshot IS DISTINCT FROM public.v2_edit_snapshot(s.id) OR NEW.after_snapshot IS DISTINCT FROM public.v2_edit_after(s.id,NEW.observation_id)
  OR NEW.observation_scope IS DISTINCT FROM (SELECT scope FROM public.v2_observations WHERE id=NEW.observation_id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_observation_states os JOIN public.v2_observation_targets ot USING(observation_id)
   WHERE os.observation_id=NEW.observation_id AND os.status='active' AND os.revision=NEW.observation_revision AND ot.revision=NEW.target_revision) THEN
  RAISE EXCEPTION 'v2_edit_proposal_binding_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_edit_validate BEFORE INSERT ON public.v2_transport_edits FOR EACH ROW EXECUTE FUNCTION public.v2_edit_validate();
CREATE FUNCTION public.v2_propose_transport_edit(actor varchar,subject uuid,expected bigint,observation uuid,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_transport_edits; digest text; result uuid; c uuid; s public.v2_subjects;
BEGIN
 IF actor IS NULL OR request IS NULL OR expected IS NULL THEN RAISE EXCEPTION 'v2_edit_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,subject,expected,observation));
 SELECT * INTO receipt FROM public.v2_transport_edits WHERE request_id=request;
 IF FOUND THEN IF receipt.erased OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_edit_request_conflict' USING ERRCODE='23514'; END IF; RETURN receipt.id; END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=subject FOR UPDATE;
 IF s.id IS NULL OR s.lifecycle<>'active' THEN RAISE EXCEPTION 'v2_edit_subject_inactive' USING ERRCODE='23514'; END IF;
 IF s.revision<>expected THEN RAISE EXCEPTION 'v2_edit_subject_revision_conflict' USING ERRCODE='40001'; END IF;
 c:=public.v2_open_review_case(actor,subject,'identity',NULL,NULL);
 INSERT INTO public.v2_transport_edits(subject_id,case_id,actor_user_id,observation_id,field_key,expected_subject_revision,expected_generation,
  observation_revision,target_revision,before_snapshot,after_snapshot,observation_scope,request_id,request_digest)
 SELECT subject,c,actor,o.id,o.field_key,s.revision,s.input_generation,os.revision,ot.revision,public.v2_edit_snapshot(subject),public.v2_edit_after(subject,observation),o.scope,request,digest
 FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id JOIN public.v2_observation_targets ot ON ot.observation_id=o.id WHERE o.id=observation RETURNING id INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'v2_edit_observation_missing' USING ERRCODE='23503'; END IF;
 RETURN result;
END; $$;
CREATE FUNCTION public.v2_edit_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e public.v2_transport_edits; r public.v2_review_decisions;
BEGIN
 SELECT * INTO e FROM public.v2_transport_edits WHERE case_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.subject_id<>e.subject_id OR NEW.kind<>'identity' OR NEW.candidate_id IS NOT NULL OR NEW.field_key IS NOT NULL OR NEW.scope_key IS NOT NULL THEN
  RAISE EXCEPTION 'v2_edit_case_binding_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.last_decision_id IS DISTINCT FROM OLD.last_decision_id THEN
  SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.last_decision_id;
  IF r.action='accept' THEN
   IF r.expected_subject_revision<>e.expected_subject_revision OR e.before_snapshot IS DISTINCT FROM public.v2_edit_snapshot(e.subject_id)
    OR NOT public.v2_edit_evidence_live(e.id) OR (SELECT array_agg(observation_id ORDER BY observation_id) FROM public.v2_review_decision_evidence WHERE decision_id=r.id) IS DISTINCT FROM ARRAY[e.observation_id] THEN
    RAISE EXCEPTION 'v2_edit_approval_stale_or_different_evidence' USING ERRCODE='40001'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_edit_case_guard BEFORE UPDATE ON public.v2_review_cases FOR EACH ROW EXECUTE FUNCTION public.v2_edit_case_guard();

CREATE FUNCTION public.v2_write_edit_snapshot(subject uuid,snapshot jsonb,edit uuid,review uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE data jsonb:=snapshot->'data'; kind text:=snapshot->>'kind'; meta jsonb; chosen_version integer; item jsonb;
BEGIN
 IF kind='route' THEN UPDATE public.v2_routes SET operator_subject_id=(data->>'operator_subject_id')::uuid WHERE subject_id=subject;
 ELSIF kind='stop' THEN UPDATE public.v2_stops SET city_id=(data->>'city_id')::integer,name=data->>'name',latitude=(data->>'latitude')::numeric,longitude=(data->>'longitude')::numeric,precision=data->>'precision' WHERE subject_id=subject;
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
CREATE FUNCTION public.v2_edit_event_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e public.v2_transport_edits; previous public.v2_transport_edit_events; r public.v2_review_decisions; s public.v2_subjects; current_edit uuid;
BEGIN
 SELECT * INTO e FROM public.v2_transport_edits WHERE id=NEW.edit_id;
 SELECT * INTO previous FROM public.v2_transport_edit_events WHERE edit_id=e.id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(previous.revision,0)+1 OR NEW.previous_event_id IS DISTINCT FROM previous.id THEN RAISE EXCEPTION 'v2_edit_event_revision_conflict' USING ERRCODE='40001'; END IF;
 NEW.projection_changed:=false;
 IF NEW.action='apply' THEN
  SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.review_id;
  SELECT * INTO s FROM public.v2_subjects WHERE id=e.subject_id FOR UPDATE;
  IF e.erased OR previous.id IS NOT NULL OR NOT public.v2_edit_evidence_live(e.id) OR s.lifecycle<>'active'
   OR r.case_id IS DISTINCT FROM e.case_id OR r.action IS DISTINCT FROM 'accept' OR r.evidence_erased
   OR r.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR NEW.actor_user_id IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.actor_user_id AND revoked_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM public.v2_review_cases WHERE id=e.case_id AND last_decision_id=r.id AND state='resolved') THEN
   RAISE EXCEPTION 'v2_edit_current_approval_required' USING ERRCODE='23514'; END IF;
  IF s.revision<>e.expected_subject_revision+1 OR s.input_generation<>e.expected_generation+1 OR r.expected_subject_revision<>e.expected_subject_revision
   OR public.v2_edit_snapshot(e.subject_id) IS DISTINCT FROM e.before_snapshot THEN RAISE EXCEPTION 'v2_edit_apply_revision_conflict' USING ERRCODE='40001'; END IF;
  PERFORM public.v2_write_edit_snapshot(e.subject_id,e.after_snapshot,e.id,r.id); NEW.projection_changed:=true;
 ELSIF NEW.action='reverse' THEN
  SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.review_id;
  IF pg_trigger_depth()<2 OR r.case_id IS DISTINCT FROM e.case_id OR r.action IS DISTINCT FROM 'reverse'
   OR r.reverses_decision_id IS DISTINCT FROM (SELECT review_id FROM public.v2_transport_edit_events WHERE edit_id=e.id AND action='apply') THEN
   RAISE EXCEPTION 'v2_edit_reverse_review_required' USING ERRCODE='23514'; END IF;
  SELECT edit_id INTO current_edit FROM public.v2_transport_edit_heads WHERE subject_id=e.subject_id;
  -- Reverse only the still-current projection. Never overwrite a newer edit or
  -- reactivate an earlier approval after a parent/evidence change.
  IF NOT e.erased AND current_edit=e.id AND public.v2_edit_snapshot(e.subject_id)=e.after_snapshot THEN
   DELETE FROM public.v2_transport_edit_heads WHERE subject_id=e.subject_id;
   PERFORM public.v2_write_edit_snapshot(e.subject_id,e.before_snapshot,e.id,r.id); NEW.projection_changed:=true;
  END IF;
 ELSIF NEW.action IN('invalidate','erase') THEN
  IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'v2_edit_invalidation_internal' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'v2_edit_event_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=e.subject_id;
 NEW.resulting_revision:=s.revision;NEW.resulting_generation:=s.input_generation;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_edit_event_validate BEFORE INSERT ON public.v2_transport_edit_events FOR EACH ROW EXECUTE FUNCTION public.v2_edit_event_validate();
CREATE FUNCTION public.v2_edit_project_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.action='apply' THEN
  INSERT INTO public.v2_transport_edit_heads(subject_id,edit_id,event_id) SELECT subject_id,NEW.edit_id,NEW.id FROM public.v2_transport_edits WHERE id=NEW.edit_id
   ON CONFLICT(subject_id) DO UPDATE SET edit_id=EXCLUDED.edit_id,event_id=EXCLUDED.event_id;
 ELSE DELETE FROM public.v2_transport_edit_heads WHERE edit_id=NEW.edit_id; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_edit_project_event AFTER INSERT ON public.v2_transport_edit_events FOR EACH ROW EXECUTE FUNCTION public.v2_edit_project_event();
CREATE FUNCTION public.v2_edit_head_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF EXISTS(SELECT 1 FROM public.v2_transport_edit_events v JOIN public.v2_transport_edits e ON e.id=v.edit_id WHERE v.id=NEW.event_id AND e.id=NEW.edit_id AND e.subject_id=NEW.subject_id AND v.action='apply' AND NOT e.erased) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'v2_edit_head_internal' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_edit_head_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_transport_edit_heads FOR EACH ROW EXECUTE FUNCTION public.v2_edit_head_guard();
CREATE FUNCTION public.v2_apply_transport_edit(actor varchar,edit uuid,review uuid,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_transport_edit_events; digest text; result uuid;
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'v2_edit_apply_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,edit,review));
 SELECT * INTO receipt FROM public.v2_transport_edit_events WHERE request_id=request;
 IF FOUND THEN IF receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_edit_apply_request_conflict' USING ERRCODE='23514'; END IF; RETURN receipt.id; END IF;
 INSERT INTO public.v2_transport_edit_events(edit_id,revision,action,actor_user_id,review_id,request_id,request_digest,resulting_revision,resulting_generation,projection_changed)
 VALUES(edit,1,'apply',actor,review,request,digest,1,1,false) RETURNING id INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION public.v2_append_edit_invalidation(edit uuid,operation text,cause uuid,review uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous public.v2_transport_edit_events;
BEGIN
 SELECT * INTO previous FROM public.v2_transport_edit_events WHERE edit_id=edit ORDER BY revision DESC LIMIT 1;
 IF previous.action=operation AND operation IN('invalidate','erase') THEN RETURN; END IF;
 INSERT INTO public.v2_transport_edit_events(edit_id,revision,previous_event_id,action,cause_id,review_id,resulting_revision,resulting_generation,projection_changed)
 VALUES(edit,COALESCE(previous.revision,0)+1,previous.id,operation,cause,review,1,1,false);
END; $$;
CREATE FUNCTION public.v2_edit_structure_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE edit uuid;
BEGIN
 SELECT edit_id INTO edit FROM public.v2_transport_edit_heads WHERE subject_id=NEW.subject_id;
 IF edit IS NOT NULL THEN PERFORM public.v2_append_edit_invalidation(edit,'invalidate',NEW.change_id); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_edit_structure_changed AFTER INSERT ON public.v2_transport_change_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_edit_structure_changed();
CREATE FUNCTION public.v2_edit_review_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.v2_transport_edits; r public.v2_review_decisions; applied public.v2_transport_edit_events;
BEGIN
 IF NEW.last_decision_id IS NOT DISTINCT FROM OLD.last_decision_id AND NEW.state=OLD.state THEN RETURN NEW; END IF;
 SELECT * INTO e FROM public.v2_transport_edits WHERE case_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.last_decision_id;
 SELECT * INTO applied FROM public.v2_transport_edit_events WHERE edit_id=e.id AND action='apply';
 IF applied.id IS NULL THEN RETURN NEW; END IF;
 IF r.action='reverse' AND r.reverses_decision_id=applied.review_id THEN
  PERFORM public.v2_append_edit_invalidation(e.id,'reverse',r.id,r.id);
 ELSIF NEW.state<>'resolved' OR NEW.last_decision_id IS DISTINCT FROM applied.review_id THEN
  PERFORM public.v2_transport_propagate(ARRAY[e.subject_id],'v2_transport_edits','UPDATE',ARRAY['review_authority'],NULL);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_edit_review_changed AFTER UPDATE ON public.v2_review_cases FOR EACH ROW EXECUTE FUNCTION public.v2_edit_review_changed();
CREATE FUNCTION public.v2_edit_observation_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e record; observation uuid; erase boolean;
BEGIN
 erase:=TG_TABLE_NAME='v2_observations';
 IF erase THEN observation:=OLD.id;
 ELSE IF NEW.revision=OLD.revision THEN RETURN NEW; END IF; observation:=NEW.observation_id; END IF;
 IF erase THEN
  -- Later full snapshots may copy an earlier edited value in their before or
  -- unchanged after data. Redact all edit snapshots for the affected subject,
  -- while retaining its independently owned observations for fresh review.
  FOR e IN SELECT id,subject_id FROM public.v2_transport_edits WHERE subject_id IN(SELECT subject_id FROM public.v2_transport_edits WHERE observation_id=observation) ORDER BY subject_id,id LOOP
   IF EXISTS(SELECT 1 FROM public.v2_transport_edit_heads WHERE subject_id=e.subject_id) THEN
    PERFORM public.v2_transport_propagate(ARRAY[e.subject_id],'v2_transport_edits','UPDATE',ARRAY['supporting_observation'],NULL);
   END IF;
   UPDATE public.v2_transport_edits SET erased=true,observation_id=NULL,observation_revision=NULL,target_revision=NULL,before_snapshot=NULL,after_snapshot=NULL,observation_scope=NULL,request_digest=NULL WHERE id=e.id;
   UPDATE public.v2_transport_edit_events SET request_digest=NULL WHERE edit_id=e.id;
   PERFORM public.v2_append_edit_invalidation(e.id,'erase',NULL);
  END LOOP;
 ELSE
  FOR e IN SELECT p.id,p.subject_id FROM public.v2_transport_edits p JOIN public.v2_transport_edit_heads h ON h.edit_id=p.id WHERE p.observation_id=observation ORDER BY p.subject_id,p.id LOOP
   PERFORM public.v2_transport_propagate(ARRAY[e.subject_id],'v2_transport_edits','UPDATE',ARRAY['supporting_observation'],NULL);
  END LOOP;
 END IF;
 RETURN COALESCE(NEW,OLD);
END; $$;
CREATE TRIGGER v2_edit_observation_changed AFTER UPDATE ON public.v2_observation_states FOR EACH ROW EXECUTE FUNCTION public.v2_edit_observation_changed();
CREATE TRIGGER v2_edit_target_changed AFTER UPDATE ON public.v2_observation_targets FOR EACH ROW EXECUTE FUNCTION public.v2_edit_observation_changed();
CREATE TRIGGER aa_v2_edit_observation_erased BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_edit_observation_changed();

CREATE FUNCTION public.v2_edit_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
  IF TG_TABLE_NAME='v2_transport_edits' THEN
   IF NEW.erased AND num_nonnulls(NEW.observation_id,NEW.observation_revision,NEW.target_revision,NEW.before_snapshot,NEW.after_snapshot,NEW.observation_scope,NEW.request_digest)=0
    AND to_jsonb(NEW)-ARRAY['erased','observation_id','observation_revision','target_revision','before_snapshot','after_snapshot','observation_scope','request_digest']=to_jsonb(OLD)-ARRAY['erased','observation_id','observation_revision','target_revision','before_snapshot','after_snapshot','observation_scope','request_digest'] THEN RETURN NEW; END IF;
   IF NEW.actor_user_id IS NULL THEN NEW.request_digest:=NULL;
    IF to_jsonb(NEW)-ARRAY['actor_user_id','request_digest']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest'] THEN RETURN NEW; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='v2_transport_edit_events' THEN
   IF NEW.actor_user_id IS NULL THEN NEW.request_digest:=NULL; END IF;
   IF NEW.request_digest IS NULL AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id=OLD.actor_user_id)
    AND to_jsonb(NEW)-ARRAY['actor_user_id','request_digest']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest'] THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'v2_edit_history_immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_edit_history_guard BEFORE UPDATE OR DELETE ON public.v2_transport_edits FOR EACH ROW EXECUTE FUNCTION public.v2_edit_history_guard();
CREATE TRIGGER v2_edit_history_guard BEFORE UPDATE OR DELETE ON public.v2_transport_edit_events FOR EACH ROW EXECUTE FUNCTION public.v2_edit_history_guard();
CREATE TRIGGER v2_edit_history_guard BEFORE UPDATE OR DELETE ON public.v2_pattern_version_origins FOR EACH ROW EXECUTE FUNCTION public.v2_edit_history_guard();
CREATE FUNCTION public.v2_edit_origin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_transport_edits e JOIN public.v2_review_cases c ON c.id=e.case_id AND c.last_decision_id=NEW.review_id
  WHERE e.id=NEW.edit_id AND e.subject_id=NEW.pattern_subject_id AND NOT e.erased AND (e.after_snapshot->'patternVersion'->>'version')::integer=NEW.pattern_version) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'v2_pattern_origin_requires_approved_edit' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_edit_origin_guard BEFORE INSERT ON public.v2_pattern_version_origins FOR EACH ROW EXECUTE FUNCTION public.v2_edit_origin_guard();
CREATE FUNCTION public.v2_read_transport(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.v2_transport_edits; h public.v2_transport_edit_heads; state text; kind text;
BEGIN
 SELECT lifecycle,s.kind INTO state,kind FROM public.v2_subjects s WHERE id=subject;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF state='retired' THEN RETURN jsonb_build_object('status','retired','snapshot',NULL); END IF;
 SELECT * INTO h FROM public.v2_transport_edit_heads WHERE subject_id=subject;
 SELECT * INTO e FROM public.v2_transport_edits WHERE id=h.edit_id;
 IF e.id IS NOT NULL AND public.v2_edit_evidence_live(e.id) AND public.v2_edit_snapshot(subject)=e.after_snapshot
  AND EXISTS(SELECT 1 FROM public.v2_transport_edit_events v JOIN public.v2_review_decisions r ON r.id=v.review_id JOIN public.v2_review_cases c ON c.id=r.case_id
   WHERE v.id=h.event_id AND v.action='apply' AND r.action='accept' AND NOT r.evidence_erased AND c.last_decision_id=r.id AND c.state='resolved') THEN
  RETURN jsonb_build_object('status','reviewed','snapshot',e.after_snapshot);
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN EXISTS(SELECT 1 FROM public.v2_transport_edit_events v JOIN public.v2_transport_edits p ON p.id=v.edit_id WHERE p.subject_id=subject AND v.action='apply') THEN 'stale' ELSE 'unreviewed' END,'snapshot',NULL);
END; $$;
DO $$ DECLARE t text; r text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_transport_edits','v2_transport_edit_events','v2_transport_edit_heads','v2_pattern_version_origins'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF; END LOOP;
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_edit_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'v2_edit_%' OR proname IN('v2_propose_transport_edit','v2_apply_transport_edit','v2_write_edit_snapshot','v2_append_edit_invalidation','v2_read_transport')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r); END IF; END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.v2_read_transport(uuid) TO mabhazi_api;
END; $$;
