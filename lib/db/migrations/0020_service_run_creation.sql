-- Reviewed declared-mode plans and scheduled-departure runs; no inferred calendar.
ALTER TABLE public.v2_transport_creations DROP CONSTRAINT v2_transport_creations_target_kind_check;
ALTER TABLE public.v2_transport_creations ADD CONSTRAINT v2_transport_creations_target_kind_check CHECK(target_kind IN('operator','stop','route','pattern','service_plan','run'));
ALTER TABLE public.v2_transport_creation_dependencies DROP CONSTRAINT v2_transport_creation_dependencies_subject_kind_check;
ALTER TABLE public.v2_transport_creation_dependencies ADD CONSTRAINT v2_transport_creation_dependencies_subject_kind_check CHECK(subject_kind IN('operator','route','stop','pattern','service_plan'));
CREATE OR REPLACE FUNCTION public.v2_creation_projection(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 result:=public.v2_transport_snapshot(subject);
 IF result->>'kind' IN('pattern','run') THEN RETURN public.v2_edit_snapshot(subject);END IF;
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_references(snapshot jsonb) RETURNS TABLE(subject_id uuid,subject_kind text) LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT (snapshot->'data'->>'operator_subject_id')::uuid,'operator'::text WHERE snapshot->>'kind'='route'
 UNION SELECT (snapshot->'data'->>'route_subject_id')::uuid,'route'::text WHERE snapshot->>'kind'='pattern'
 UNION SELECT r.operator_subject_id,'operator'::text FROM public.v2_routes r WHERE snapshot->>'kind'='pattern' AND r.subject_id=(snapshot->'data'->>'route_subject_id')::uuid
 UNION SELECT (e->>'stop_subject_id')::uuid,'stop'::text FROM jsonb_array_elements(COALESCE(snapshot->'patternStops','[]'::jsonb)) e WHERE snapshot->>'kind'='pattern'
 UNION SELECT (snapshot->'data'->>'pattern_subject_id')::uuid,'pattern'::text WHERE snapshot->>'kind'='service_plan'
 UNION SELECT (snapshot->'data'->>'service_plan_subject_id')::uuid,'service_plan'::text WHERE snapshot->>'kind'='run';
$$;

CREATE FUNCTION public.v2_creation_pattern_context(source uuid,pattern uuid) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p public.v2_patterns;s public.v2_subjects;source_operator uuid;parent_operator uuid;
BEGIN
 SELECT * INTO p FROM public.v2_patterns WHERE subject_id=pattern;SELECT * INTO s FROM public.v2_subjects WHERE id=source;
 IF p.subject_id IS NULL OR public.v2_read_created_subject(pattern)->>'status' IS DISTINCT FROM 'reviewed_origin'
 OR public.v2_subject_corridor(source) IS DISTINCT FROM p.corridor_id THEN RAISE EXCEPTION 'v2_creation_reviewed_pattern_context_required' USING ERRCODE='23514';END IF;
 source_operator:=public.v2_resolved_operator(source);parent_operator:=public.v2_resolved_operator(pattern);
 IF (source_operator IS NOT NULL AND source_operator IS DISTINCT FROM parent_operator)
 OR (source_operator IS NULL AND NOT EXISTS(SELECT 1 FROM public.v2_transport_creations c JOIN public.v2_transport_creation_origins o ON o.creation_id=c.id WHERE o.subject_id=pattern AND c.source_subject_id=source)) THEN RAISE EXCEPTION 'v2_creation_service_identity_context_required' USING ERRCODE='23514';END IF;
 IF s.kind='service_plan' AND NOT EXISTS(SELECT 1 FROM public.v2_service_plans sp WHERE sp.subject_id=source AND sp.pattern_subject_id=pattern AND sp.pattern_version=p.current_pattern_version) THEN RAISE EXCEPTION 'v2_creation_service_variant_context_mismatch' USING ERRCODE='23514';END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_desired_parent(observation uuid,kind text,target uuid,parent uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE o public.v2_observations;data jsonb;source_operator uuid;route_operator uuid;corridor uuid;stops jsonb;version jsonb;origin_city integer;destination_city integer;pat public.v2_patterns;pv public.v2_pattern_versions;plan public.v2_service_plans;lower_date date;upper_date date;service_date date;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR target IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;
 IF kind='operator' AND o.field_key='operator.reported' AND o.value ? 'name' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','operator','display_name',o.value->'name','country_code',NULL,'affiliation_status','unverified');
 ELSIF kind='stop' AND o.field_key IN('boarding.pickup','alighting.dropoff') AND o.value ?& ARRAY['cityId','name'] AND NOT o.value ? 'stopId' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','stop','city_id',o.value->'cityId','name',o.value->'name','parent_stop_id',NULL,'latitude',NULL,'longitude',NULL,'precision','named_place');
 ELSIF kind='route' AND o.field_key IN('operator.reported','operator.identity') AND o.value ? 'id' THEN
  IF public.v2_read_created_subject((o.value->>'id')::uuid)->>'status' IS DISTINCT FROM 'reviewed_origin' THEN RAISE EXCEPTION 'v2_creation_reviewed_operator_required' USING ERRCODE='23514';END IF;
  source_operator:=COALESCE(public.v2_resolved_operator(o.original_subject_id),(SELECT public.v2_resolved_operator(a.matched_run_subject_id) FROM public.v2_actual_journeys a WHERE a.subject_id=o.original_subject_id AND a.association_status='matched'));
  IF source_operator IS NOT NULL AND source_operator<>(o.value->>'id')::uuid THEN RAISE EXCEPTION 'v2_creation_source_operator_conflict' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','route','operator_subject_id',(o.value->>'id')::uuid,'public_name',NULL,'public_code',NULL);
 ELSIF kind='pattern' AND o.field_key='pattern.stops' AND parent IS NOT NULL THEN
  IF public.v2_read_created_subject(parent)->>'status' IS DISTINCT FROM 'reviewed_origin' OR NOT EXISTS(SELECT 1 FROM public.v2_routes WHERE subject_id=parent) THEN RAISE EXCEPTION 'v2_creation_reviewed_route_required' USING ERRCODE='23514';END IF;
  SELECT operator_subject_id INTO route_operator FROM public.v2_routes WHERE subject_id=parent;
  source_operator:=public.v2_resolved_operator(o.original_subject_id);corridor:=public.v2_subject_corridor(o.original_subject_id);
  IF corridor IS NULL OR (source_operator IS NOT NULL AND source_operator<>route_operator)
   OR (source_operator IS NULL AND NOT EXISTS(SELECT 1 FROM public.v2_transport_creations p JOIN public.v2_transport_creation_origins r ON r.creation_id=p.id WHERE r.subject_id=parent AND p.source_subject_id=o.original_subject_id)) THEN RAISE EXCEPTION 'v2_creation_pattern_identity_context_required' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e WHERE e->'place'->>'stopId' IS NULL OR public.v2_read_created_subject((e->'place'->>'stopId')::uuid)->>'status' IS DISTINCT FROM 'reviewed_origin'
   OR NOT EXISTS(SELECT 1 FROM public.v2_stops WHERE subject_id=(e->'place'->>'stopId')::uuid)) THEN RAISE EXCEPTION 'v2_creation_reviewed_stops_required' USING ERRCODE='23514';END IF;
  SELECT jsonb_agg(jsonb_build_object('pattern_subject_id',target,'pattern_version',1,'sequence',ordinality-1,'stop_subject_id',(e->'place'->>'stopId')::uuid,'pickup',e->'pickup','dropoff',e->'dropoff') ORDER BY ordinality)
   INTO stops FROM jsonb_array_elements(o.value->'stops') WITH ORDINALITY a(e,ordinality);
  SELECT origin_city_id,destination_city_id INTO origin_city,destination_city FROM public.v2_corridors WHERE id=corridor;
  IF (o.value->>'stopsComplete')::boolean AND ((SELECT city_id FROM public.v2_stops WHERE subject_id=(stops->0->>'stop_subject_id')::uuid) IS DISTINCT FROM origin_city
   OR (SELECT city_id FROM public.v2_stops WHERE subject_id=(stops->(jsonb_array_length(stops)-1)->>'stop_subject_id')::uuid) IS DISTINCT FROM destination_city) THEN RAISE EXCEPTION 'v2_creation_complete_pattern_endpoints_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','pattern','route_subject_id',parent,'corridor_id',corridor,'current_pattern_version',1,'current_version_sealed',true);
  version:=jsonb_build_object('pattern_subject_id',target,'version',1,'effective_from',o.effective_from,'effective_to',o.effective_to,'stops_complete',o.value->'stopsComplete','sealed',true);
  RETURN jsonb_build_object('kind','pattern','data',data,'patternVersion',version,'patternStops',stops);
 ELSIF kind='service_plan' AND o.field_key='service.mode' AND parent IS NOT NULL THEN
  PERFORM public.v2_creation_pattern_context(o.original_subject_id,parent);
  SELECT * INTO pat FROM public.v2_patterns WHERE subject_id=parent;
  SELECT v.* INTO pv FROM public.v2_pattern_versions v WHERE v.pattern_subject_id=parent AND v.version=pat.current_pattern_version AND v.sealed;
  IF pv.pattern_subject_id IS NULL THEN RAISE EXCEPTION 'v2_creation_sealed_pattern_required' USING ERRCODE='23514';END IF;
  lower_date:=o.effective_from;upper_date:=o.effective_to;
  IF lower_date>upper_date OR lower_date<pv.effective_from OR upper_date>pv.effective_to OR upper_date<pv.effective_from OR lower_date>pv.effective_to THEN RAISE EXCEPTION 'v2_creation_service_validity_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','service_plan','pattern_subject_id',parent,'pattern_version',pat.current_pattern_version,'pattern_sealed',true,'mode',o.value->'mode','calendar_id',NULL,'timezone',NULL,'effective_from',lower_date,'effective_to',upper_date,'boarding_instructions',NULL);
 ELSIF kind='run' AND o.field_key='departure.scheduled' AND parent IS NOT NULL THEN
  SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=parent;
  IF plan.subject_id IS NULL OR plan.mode<>'fixed_time' OR public.v2_read_created_subject(parent)->>'status' IS DISTINCT FROM 'reviewed_origin' THEN RAISE EXCEPTION 'v2_creation_reviewed_fixed_plan_required' USING ERRCODE='23514';END IF;
  PERFORM public.v2_creation_pattern_context(o.original_subject_id,plan.pattern_subject_id);
  IF EXISTS(SELECT 1 FROM public.v2_runs r WHERE r.subject_id=o.original_subject_id AND r.service_plan_subject_id<>parent) THEN RAISE EXCEPTION 'v2_creation_run_plan_context_mismatch' USING ERRCODE='23514';END IF;
  IF (o.scope->>'timezone' IS NOT NULL AND o.scope->>'timezone' IS DISTINCT FROM plan.timezone)
   OR (o.scope->>'calendarId' IS NOT NULL AND (o.scope->>'calendarId')::uuid IS DISTINCT FROM plan.calendar_id) THEN RAISE EXCEPTION 'v2_creation_run_temporal_context_mismatch' USING ERRCODE='23514';END IF;
  SELECT v.* INTO pv FROM public.v2_pattern_versions v WHERE v.pattern_subject_id=plan.pattern_subject_id AND v.version=plan.pattern_version AND v.sealed;
  IF pv.pattern_subject_id IS NULL THEN RAISE EXCEPTION 'v2_creation_sealed_pattern_required' USING ERRCODE='23514';END IF;
  lower_date:=greatest(o.effective_from,(o.scope->>'effectiveFrom')::date);
  upper_date:=least(o.effective_to,(o.scope->>'effectiveTo')::date);service_date:=(o.scope->>'serviceDate')::date;
  IF lower_date>upper_date OR service_date<lower_date OR service_date>upper_date THEN RAISE EXCEPTION 'v2_creation_service_validity_disjoint' USING ERRCODE='23514';END IF;
  IF service_date IS NOT NULL THEN lower_date:=service_date;upper_date:=service_date;END IF;
  IF (greatest(plan.effective_from,pv.effective_from) IS NOT NULL AND (lower_date IS NULL OR lower_date<greatest(plan.effective_from,pv.effective_from)))
   OR (least(plan.effective_to,pv.effective_to) IS NOT NULL AND (upper_date IS NULL OR upper_date>least(plan.effective_to,pv.effective_to))) THEN RAISE EXCEPTION 'v2_creation_run_parent_validity_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','run','service_plan_subject_id',parent,'plan_mode','fixed_time','pattern_subject_id',plan.pattern_subject_id,'pattern_version',plan.pattern_version,'departure_seconds',o.value->'seconds','arrival_seconds',NULL,'run_label',NULL,'validity_from',lower_date,'validity_to',upper_date);
  RETURN jsonb_build_object('kind','run','data',data,'runStopTimes','[]'::jsonb);
 ELSE RAISE EXCEPTION 'v2_creation_kind_or_named_evidence_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('kind',kind,'data',data);
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.v2_subjects;c public.v2_review_cases;
BEGIN
 SELECT * INTO s FROM public.v2_subjects WHERE id=NEW.source_subject_id;SELECT * INTO c FROM public.v2_review_cases WHERE id=NEW.case_id;
 IF NEW.erased OR NEW.actor_user_id IS NULL OR NEW.request_digest IS NULL OR s.lifecycle<>'active'
 OR EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=NEW.target_subject_id)
 OR s.revision IS DISTINCT FROM NEW.expected_source_revision OR s.input_generation IS DISTINCT FROM NEW.expected_generation
 OR c.subject_id IS DISTINCT FROM s.id OR c.kind<>'identity' OR c.candidate_id IS NOT NULL OR c.last_decision_id IS NOT NULL OR c.field_key IS NOT NULL OR c.scope_key IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.actor_user_id AND revoked_at IS NULL)
 OR NEW.field_key IS DISTINCT FROM (SELECT field_key FROM public.v2_observations WHERE id=NEW.observation_id)
 OR NEW.source_snapshot IS DISTINCT FROM public.v2_creation_source_snapshot(s.id)
 OR NEW.desired_snapshot IS DISTINCT FROM public.v2_creation_desired_parent(NEW.observation_id,NEW.target_kind,NEW.target_subject_id,CASE NEW.target_kind WHEN 'pattern' THEN (NEW.desired_snapshot->'data'->>'route_subject_id')::uuid WHEN 'service_plan' THEN (NEW.desired_snapshot->'data'->>'pattern_subject_id')::uuid WHEN 'run' THEN (NEW.desired_snapshot->'data'->>'service_plan_subject_id')::uuid END)
 OR NOT EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id JOIN public.v2_observation_targets ot ON ot.observation_id=o.id
 WHERE o.id=NEW.observation_id AND o.original_subject_id=s.id AND public.v2_observation_subject(o.id)=s.id AND os.status='active' AND os.revision=NEW.observation_revision AND ot.revision=NEW.target_revision) THEN
 RAISE EXCEPTION 'v2_creation_proposal_binding_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.v2_propose_transport_creation_context(actor varchar,source uuid,expected bigint,observation uuid,kind text,parent uuid,expected_parent bigint,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_transport_creations;digest text;result uuid;c uuid;target uuid:=gen_random_uuid();s public.v2_subjects;
BEGIN
 IF actor IS NULL OR request IS NULL OR expected IS NULL OR kind IS NULL THEN RAISE EXCEPTION 'v2_creation_request_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(CASE WHEN kind IN('pattern','service_plan','run') THEN jsonb_build_array(actor,source,expected,observation,kind,parent,expected_parent) ELSE jsonb_build_array(actor,source,expected,observation,kind) END);
 SELECT * INTO receipt FROM public.v2_transport_creations WHERE request_id=request;
 IF FOUND THEN IF receipt.erased OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_creation_request_conflict' USING ERRCODE='23514';END IF;RETURN receipt.id;END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=source FOR UPDATE;
 IF s.id IS NULL OR s.lifecycle<>'active' THEN RAISE EXCEPTION 'v2_creation_source_inactive' USING ERRCODE='23514';END IF;
 IF s.revision<>expected THEN RAISE EXCEPTION 'v2_creation_source_revision_conflict' USING ERRCODE='40001';END IF;
 IF kind IN('pattern','service_plan','run') AND (parent IS NULL OR expected_parent IS NULL OR expected_parent IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=parent)) THEN RAISE EXCEPTION 'v2_creation_parent_revision_conflict' USING ERRCODE='40001';END IF;
 c:=public.v2_open_review_case(actor,source,'identity',NULL,NULL);
 INSERT INTO public.v2_transport_creations(source_subject_id,target_subject_id,target_kind,case_id,actor_user_id,observation_id,field_key,expected_source_revision,expected_generation,
 observation_revision,target_revision,source_snapshot,desired_snapshot,request_id,request_digest)
 SELECT source,target,kind,c,actor,o.id,o.field_key,s.revision,s.input_generation,os.revision,ot.revision,public.v2_creation_source_snapshot(source),public.v2_creation_desired_parent(observation,kind,target,parent),request,digest
 FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id JOIN public.v2_observation_targets ot ON ot.observation_id=o.id WHERE o.id=observation RETURNING id INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION public.v2_propose_transport_creation(actor varchar,source uuid,expected bigint,observation uuid,kind text,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF kind IN('pattern','service_plan','run') THEN RAISE EXCEPTION 'v2_creation_parent_context_required' USING ERRCODE='23514';END IF;
 RETURN public.v2_propose_transport_creation_context(actor,source,expected,observation,kind,NULL,NULL,request);
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_event_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;previous public.v2_transport_creation_events;approval public.v2_transport_creation_events;r public.v2_review_decisions;s public.v2_subjects;item jsonb;meta jsonb;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=NEW.creation_id;
 SELECT * INTO previous FROM public.v2_transport_creation_events WHERE creation_id=p.id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(previous.revision,0)+1 OR NEW.previous_event_id IS DISTINCT FROM previous.id THEN RAISE EXCEPTION 'v2_creation_event_revision_conflict' USING ERRCODE='40001';END IF;
 NEW.projection_changed:=false;
 IF NEW.action='review' THEN
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.review_id;
 IF p.erased OR r.case_id IS DISTINCT FROM p.case_id OR r.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR NEW.actor_user_id IS NULL OR r.evidence_erased
 OR r.action NOT IN('accept','reject','needs_context','reverse') OR NOT EXISTS(SELECT 1 FROM public.v2_review_cases WHERE id=p.case_id AND last_decision_id=r.id)
 OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.actor_user_id AND revoked_at IS NULL) THEN RAISE EXCEPTION 'v2_creation_review_receipt_invalid' USING ERRCODE='23514';END IF;
 ELSIF NEW.action='apply' THEN
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.review_id;
 SELECT * INTO approval FROM public.v2_transport_creation_events WHERE creation_id=p.id AND action='review' AND review_id=r.id;
 SELECT * INTO s FROM public.v2_subjects WHERE id=p.source_subject_id FOR UPDATE;
 IF p.erased OR previous.action IS DISTINCT FROM 'review' OR EXISTS(SELECT 1 FROM public.v2_transport_creation_events WHERE creation_id=p.id AND action='apply')
 OR EXISTS(SELECT 1 FROM public.v2_transport_creations other JOIN public.v2_transport_creation_origins o ON o.creation_id=other.id WHERE other.observation_id=p.observation_id AND other.target_kind=p.target_kind)
 OR EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=p.target_subject_id) OR NOT public.v2_creation_evidence_live(p.id) OR s.lifecycle<>'active'
 OR approval.id IS NULL OR r.case_id IS DISTINCT FROM p.case_id OR r.action IS DISTINCT FROM 'accept' OR r.evidence_erased
 OR r.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR NEW.actor_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.actor_user_id AND revoked_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.v2_review_cases WHERE id=p.case_id AND last_decision_id=r.id AND state='resolved') THEN RAISE EXCEPTION 'v2_creation_current_approval_required' USING ERRCODE='23514';END IF;
 IF s.revision<>approval.source_revision OR s.input_generation<>approval.source_generation OR r.expected_subject_revision<>p.expected_source_revision
 OR public.v2_creation_source_snapshot(s.id) IS DISTINCT FROM p.source_snapshot OR NOT public.v2_creation_dependencies_live(p.id) THEN RAISE EXCEPTION 'v2_creation_apply_revision_conflict' USING ERRCODE='40001';END IF;
 SET CONSTRAINTS public.v2_subject_subtype DEFERRED;
 IF p.target_kind='pattern' THEN SET CONSTRAINTS public.v2_current_pattern_version DEFERRED;END IF;
 INSERT INTO public.v2_subjects(id,kind) VALUES(p.target_subject_id,p.target_kind);
 IF p.target_kind='operator' THEN INSERT INTO public.v2_operators(subject_id,display_name) VALUES(p.target_subject_id,p.desired_snapshot->'data'->>'display_name');
 ELSIF p.target_kind='stop' THEN INSERT INTO public.v2_stops(subject_id,city_id,name) VALUES(p.target_subject_id,(p.desired_snapshot->'data'->>'city_id')::integer,p.desired_snapshot->'data'->>'name');
 ELSIF p.target_kind='route' THEN INSERT INTO public.v2_routes(subject_id,operator_subject_id) VALUES(p.target_subject_id,(p.desired_snapshot->'data'->>'operator_subject_id')::uuid);
 ELSIF p.target_kind='service_plan' THEN
  INSERT INTO public.v2_service_plans(subject_id,pattern_subject_id,pattern_version,mode,effective_from,effective_to) VALUES(p.target_subject_id,(p.desired_snapshot->'data'->>'pattern_subject_id')::uuid,(p.desired_snapshot->'data'->>'pattern_version')::integer,p.desired_snapshot->'data'->>'mode',(p.desired_snapshot->'data'->>'effective_from')::date,(p.desired_snapshot->'data'->>'effective_to')::date);
 ELSIF p.target_kind='run' THEN
  INSERT INTO public.v2_runs(subject_id,service_plan_subject_id,pattern_subject_id,pattern_version,departure_seconds,validity_from,validity_to) VALUES(p.target_subject_id,(p.desired_snapshot->'data'->>'service_plan_subject_id')::uuid,(p.desired_snapshot->'data'->>'pattern_subject_id')::uuid,(p.desired_snapshot->'data'->>'pattern_version')::integer,(p.desired_snapshot->'data'->>'departure_seconds')::integer,(p.desired_snapshot->'data'->>'validity_from')::date,(p.desired_snapshot->'data'->>'validity_to')::date);
  PERFORM public.v2_assert_run(p.target_subject_id);
 ELSE
  meta:=p.desired_snapshot->'patternVersion';
  INSERT INTO public.v2_patterns(subject_id,route_subject_id,corridor_id,current_pattern_version) VALUES(p.target_subject_id,(p.desired_snapshot->'data'->>'route_subject_id')::uuid,(p.desired_snapshot->'data'->>'corridor_id')::uuid,1);
  INSERT INTO public.v2_pattern_versions(pattern_subject_id,version,effective_from,effective_to) VALUES(p.target_subject_id,1,(meta->>'effective_from')::date,(meta->>'effective_to')::date);
  FOR item IN SELECT value FROM jsonb_array_elements(p.desired_snapshot->'patternStops') LOOP
   INSERT INTO public.v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id,pickup,dropoff) VALUES(p.target_subject_id,1,(item->>'sequence')::integer,(item->>'stop_subject_id')::uuid,item->>'pickup',item->>'dropoff');
  END LOOP;
  UPDATE public.v2_pattern_versions SET sealed=true,stops_complete=(meta->>'stops_complete')::boolean WHERE pattern_subject_id=p.target_subject_id AND version=1;
  PERFORM public.v2_assert_pattern(p.target_subject_id);
  SET CONSTRAINTS public.v2_current_pattern_version IMMEDIATE;
 END IF;
 SET CONSTRAINTS public.v2_subject_subtype IMMEDIATE;
 IF public.v2_creation_projection(p.target_subject_id) IS DISTINCT FROM p.desired_snapshot THEN RAISE EXCEPTION 'v2_creation_projection_mismatch' USING ERRCODE='23514';END IF;
 NEW.projection_changed:=true;
 ELSIF NEW.action IN('reverse','invalidate','erase') THEN
 IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'v2_creation_invalidation_internal' USING ERRCODE='23514';END IF;
 IF NEW.action='reverse' THEN
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.review_id;
 IF r.case_id IS DISTINCT FROM p.case_id OR r.action IS DISTINCT FROM 'reverse' OR r.reverses_decision_id IS DISTINCT FROM (SELECT review_id FROM public.v2_transport_creation_events WHERE creation_id=p.id AND action='apply') THEN RAISE EXCEPTION 'v2_creation_reverse_review_required' USING ERRCODE='23514';END IF;
 END IF;
 ELSE RAISE EXCEPTION 'v2_creation_event_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=p.source_subject_id;NEW.source_revision:=s.revision;NEW.source_generation:=s.input_generation;RETURN NEW;
END;$$;

CREATE FUNCTION public.v2_propose_service_plan_creation(actor varchar,source uuid,expected bigint,observation uuid,pattern uuid,expected_pattern bigint,request uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.v2_propose_transport_creation_context(actor,source,expected,observation,'service_plan',pattern,expected_pattern,request);
$$;
CREATE FUNCTION public.v2_propose_run_creation(actor varchar,source uuid,expected bigint,observation uuid,plan uuid,expected_plan bigint,request uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.v2_propose_transport_creation_context(actor,source,expected,observation,'run',plan,expected_plan,request);
$$;
DO $$ DECLARE r text;f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'v2_creation_%' OR proname IN('v2_propose_transport_creation','v2_propose_transport_creation_context','v2_propose_service_plan_creation','v2_propose_run_creation')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;
