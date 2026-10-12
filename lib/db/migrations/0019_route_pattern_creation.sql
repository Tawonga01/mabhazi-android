-- Reviewed route/pattern creation, retaining original reports and prior origins.
ALTER TABLE public.v2_transport_creations DROP CONSTRAINT v2_transport_creations_target_kind_check;
ALTER TABLE public.v2_transport_creations ADD CONSTRAINT v2_transport_creations_target_kind_check CHECK(target_kind IN('operator','stop','route','pattern'));
CREATE TABLE public.v2_transport_creation_dependencies (
 creation_id uuid NOT NULL REFERENCES public.v2_transport_creations(id),subject_id uuid NOT NULL,
 subject_kind text NOT NULL CHECK(subject_kind IN('operator','route','stop')),subject_revision bigint NOT NULL CHECK(subject_revision>=1),input_generation bigint NOT NULL CHECK(input_generation>=1),
 origin_creation_id uuid NOT NULL REFERENCES public.v2_transport_creations(id),origin_event_id uuid NOT NULL REFERENCES public.v2_transport_creation_events(id),
 PRIMARY KEY(creation_id,subject_id),FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind)
);
CREATE INDEX v2_creation_dependency_subject_idx ON public.v2_transport_creation_dependencies(subject_id);
CREATE INDEX v2_creation_dependency_origin_idx ON public.v2_transport_creation_dependencies(origin_creation_id);
CREATE INDEX v2_creation_dependency_event_idx ON public.v2_transport_creation_dependencies(origin_event_id);
CREATE TABLE public.v2_pattern_creation_origins (
 pattern_subject_id uuid NOT NULL,pattern_version integer NOT NULL CHECK(pattern_version=1),
 creation_id uuid NOT NULL UNIQUE REFERENCES public.v2_transport_creations(id),event_id uuid NOT NULL REFERENCES public.v2_transport_creation_events(id),review_id uuid NOT NULL REFERENCES public.v2_review_decisions(id),
 PRIMARY KEY(pattern_subject_id,pattern_version),FOREIGN KEY(pattern_subject_id,pattern_version) REFERENCES public.v2_pattern_versions(pattern_subject_id,version)
);
CREATE INDEX v2_pattern_creation_event_idx ON public.v2_pattern_creation_origins(event_id);
CREATE INDEX v2_pattern_creation_review_idx ON public.v2_pattern_creation_origins(review_id);
CREATE FUNCTION public.v2_creation_projection(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 result:=public.v2_transport_snapshot(subject);
 IF result->>'kind'='pattern' THEN RETURN public.v2_edit_snapshot(subject);END IF;
 RETURN result;
END;$$;
CREATE FUNCTION public.v2_creation_references(snapshot jsonb) RETURNS TABLE(subject_id uuid,subject_kind text) LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT (snapshot->'data'->>'operator_subject_id')::uuid,'operator'::text WHERE snapshot->>'kind'='route'
 UNION SELECT (snapshot->'data'->>'route_subject_id')::uuid,'route'::text WHERE snapshot->>'kind'='pattern'
 UNION SELECT r.operator_subject_id,'operator'::text FROM public.v2_routes r WHERE snapshot->>'kind'='pattern' AND r.subject_id=(snapshot->'data'->>'route_subject_id')::uuid
 UNION SELECT (e->>'stop_subject_id')::uuid,'stop'::text FROM jsonb_array_elements(COALESCE(snapshot->'patternStops','[]'::jsonb)) e WHERE snapshot->>'kind'='pattern';
$$;
CREATE FUNCTION public.v2_creation_dependencies_live(creation uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;needed integer;actual integer;d record;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=creation;
 IF NOT FOUND OR p.erased THEN RETURN false;END IF;
 SELECT count(*) INTO needed FROM public.v2_creation_references(p.desired_snapshot);
 SELECT count(*) INTO actual FROM public.v2_transport_creation_dependencies WHERE creation_id=p.id;
 IF needed<>actual THEN RETURN false;END IF;
 FOR d IN SELECT dep.*,s.revision live_revision,s.input_generation live_generation,s.lifecycle,o.creation_id live_origin,o.event_id live_event
 FROM public.v2_transport_creation_dependencies dep JOIN public.v2_subjects s ON s.id=dep.subject_id AND s.kind=dep.subject_kind
 JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE dep.creation_id=p.id LOOP
  IF d.subject_revision<>d.live_revision OR d.input_generation<>d.live_generation OR d.lifecycle<>'active'
   OR d.origin_creation_id<>d.live_origin OR d.origin_event_id<>d.live_event
   OR NOT EXISTS(SELECT 1 FROM public.v2_creation_references(p.desired_snapshot) ref WHERE ref.subject_id=d.subject_id AND ref.subject_kind=d.subject_kind)
   OR public.v2_read_created_subject(d.subject_id)->>'status' IS DISTINCT FROM 'reviewed_origin' THEN RETURN false;END IF;
 END LOOP;
 RETURN actual=(SELECT count(*) FROM public.v2_transport_creation_dependencies dep JOIN public.v2_subjects s ON s.id=dep.subject_id AND s.kind=dep.subject_kind JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE dep.creation_id=p.id);
END;$$;
CREATE FUNCTION public.v2_creation_desired_parent(observation uuid,kind text,target uuid,parent uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE o public.v2_observations;data jsonb;source_operator uuid;route_operator uuid;corridor uuid;stops jsonb;version jsonb;origin_city integer;destination_city integer;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR target IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;
 IF kind='operator' AND o.field_key='operator.reported' AND o.value ? 'name' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','operator','display_name',o.value->'name','country_code',NULL,'affiliation_status','unverified');
 ELSIF kind='stop' AND o.field_key IN('boarding.pickup','alighting.dropoff') AND o.value ?& ARRAY['cityId','name'] AND NOT o.value ? 'stopId' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','stop','city_id',o.value->'cityId','name',o.value->'name','parent_stop_id',NULL,'latitude',NULL,'longitude',NULL,'precision','named_place');
 ELSIF kind='route' AND o.field_key IN('operator.reported','operator.identity') AND o.value ? 'id' THEN
  IF public.v2_read_created_subject((o.value->>'id')::uuid)->>'status' IS DISTINCT FROM 'reviewed_origin' THEN RAISE EXCEPTION 'v2_creation_reviewed_operator_required' USING ERRCODE='23514';END IF;
  source_operator:=public.v2_resolved_operator(o.original_subject_id);
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
 ELSE RAISE EXCEPTION 'v2_creation_kind_or_named_evidence_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('kind',kind,'data',data);
END;$$;
CREATE OR REPLACE FUNCTION public.v2_creation_desired(observation uuid,kind text,target uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT public.v2_creation_desired_parent(observation,kind,target,NULL);
$$;
CREATE FUNCTION public.v2_creation_dependency_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_transport_creations p
  CROSS JOIN LATERAL public.v2_creation_references(p.desired_snapshot) ref JOIN public.v2_subjects s ON s.id=ref.subject_id AND s.kind=ref.subject_kind
  JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE p.id=NEW.creation_id AND ref.subject_id=NEW.subject_id AND ref.subject_kind=NEW.subject_kind
  AND s.revision=NEW.subject_revision AND s.input_generation=NEW.input_generation AND o.creation_id=NEW.origin_creation_id AND o.event_id=NEW.origin_event_id
  AND public.v2_read_created_subject(s.id)->>'status'='reviewed_origin') THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_creation_dependency_immutable_or_invalid' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_creation_dependency_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_transport_creation_dependencies FOR EACH ROW EXECUTE FUNCTION public.v2_creation_dependency_guard();
CREATE FUNCTION public.v2_creation_capture_dependencies() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.v2_transport_creation_dependencies(creation_id,subject_id,subject_kind,subject_revision,input_generation,origin_creation_id,origin_event_id)
 SELECT NEW.id,s.id,s.kind,s.revision,s.input_generation,o.creation_id,o.event_id FROM public.v2_creation_references(NEW.desired_snapshot) ref
 JOIN public.v2_subjects s ON s.id=ref.subject_id AND s.kind=ref.subject_kind JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id;
 IF NOT public.v2_creation_dependencies_live(NEW.id) THEN RAISE EXCEPTION 'v2_creation_parent_context_invalid' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_creation_capture_dependencies AFTER INSERT ON public.v2_transport_creations FOR EACH ROW EXECUTE FUNCTION public.v2_creation_capture_dependencies();

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
 OR NEW.desired_snapshot IS DISTINCT FROM public.v2_creation_desired_parent(NEW.observation_id,NEW.target_kind,NEW.target_subject_id,CASE WHEN NEW.target_kind='pattern' THEN (NEW.desired_snapshot->'data'->>'route_subject_id')::uuid END)
 OR NOT EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id JOIN public.v2_observation_targets ot ON ot.observation_id=o.id
 WHERE o.id=NEW.observation_id AND o.original_subject_id=s.id AND public.v2_observation_subject(o.id)=s.id AND os.status='active' AND os.revision=NEW.observation_revision AND ot.revision=NEW.target_revision) THEN
 RAISE EXCEPTION 'v2_creation_proposal_binding_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE FUNCTION public.v2_propose_transport_creation_context(actor varchar,source uuid,expected bigint,observation uuid,kind text,parent uuid,expected_parent bigint,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_transport_creations;digest text;result uuid;c uuid;target uuid:=gen_random_uuid();s public.v2_subjects;
BEGIN
 IF actor IS NULL OR request IS NULL OR expected IS NULL OR kind IS NULL THEN RAISE EXCEPTION 'v2_creation_request_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(CASE WHEN kind='pattern' THEN jsonb_build_array(actor,source,expected,observation,kind,parent,expected_parent) ELSE jsonb_build_array(actor,source,expected,observation,kind) END);
 SELECT * INTO receipt FROM public.v2_transport_creations WHERE request_id=request;
 IF FOUND THEN IF receipt.erased OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_creation_request_conflict' USING ERRCODE='23514';END IF;RETURN receipt.id;END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=source FOR UPDATE;
 IF s.id IS NULL OR s.lifecycle<>'active' THEN RAISE EXCEPTION 'v2_creation_source_inactive' USING ERRCODE='23514';END IF;
 IF s.revision<>expected THEN RAISE EXCEPTION 'v2_creation_source_revision_conflict' USING ERRCODE='40001';END IF;
 IF kind='pattern' AND (parent IS NULL OR expected_parent IS NULL OR expected_parent IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=parent)) THEN RAISE EXCEPTION 'v2_creation_parent_revision_conflict' USING ERRCODE='40001';END IF;
 c:=public.v2_open_review_case(actor,source,'identity',NULL,NULL);
 INSERT INTO public.v2_transport_creations(source_subject_id,target_subject_id,target_kind,case_id,actor_user_id,observation_id,field_key,expected_source_revision,expected_generation,
 observation_revision,target_revision,source_snapshot,desired_snapshot,request_id,request_digest)
 SELECT source,target,kind,c,actor,o.id,o.field_key,s.revision,s.input_generation,os.revision,ot.revision,public.v2_creation_source_snapshot(source),public.v2_creation_desired_parent(observation,kind,target,parent),request,digest
 FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id JOIN public.v2_observation_targets ot ON ot.observation_id=o.id WHERE o.id=observation RETURNING id INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.v2_propose_transport_creation(actor varchar,source uuid,expected bigint,observation uuid,kind text,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF kind='pattern' THEN RAISE EXCEPTION 'v2_creation_pattern_context_required' USING ERRCODE='23514';END IF;
 RETURN public.v2_propose_transport_creation_context(actor,source,expected,observation,kind,NULL,NULL,request);
END;$$;
CREATE FUNCTION public.v2_propose_pattern_creation(actor varchar,source uuid,expected bigint,observation uuid,route uuid,expected_route bigint,request uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.v2_propose_transport_creation_context(actor,source,expected,observation,'pattern',route,expected_route,request);
$$;
CREATE OR REPLACE FUNCTION public.v2_creation_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;r public.v2_review_decisions;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE case_id=NEW.id;IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.subject_id<>p.source_subject_id OR NEW.kind<>'identity' OR NEW.candidate_id IS NOT NULL OR NEW.field_key IS NOT NULL OR NEW.scope_key IS NOT NULL THEN RAISE EXCEPTION 'v2_creation_case_binding_immutable' USING ERRCODE='23514';END IF;
 IF NEW.last_decision_id IS DISTINCT FROM OLD.last_decision_id THEN
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.last_decision_id;
 IF r.action='accept' AND (r.expected_subject_revision<>p.expected_source_revision OR p.expected_generation IS DISTINCT FROM (SELECT input_generation FROM public.v2_subjects WHERE id=p.source_subject_id)
 OR p.source_snapshot IS DISTINCT FROM public.v2_creation_source_snapshot(p.source_subject_id) OR NOT public.v2_creation_evidence_live(p.id) OR NOT public.v2_creation_dependencies_live(p.id)
 OR (SELECT array_agg(observation_id ORDER BY observation_id) FROM public.v2_review_decision_evidence WHERE decision_id=r.id) IS DISTINCT FROM ARRAY[p.observation_id]) THEN
 RAISE EXCEPTION 'v2_creation_approval_stale_or_different_evidence' USING ERRCODE='40001';END IF;END IF;RETURN NEW;
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
CREATE OR REPLACE FUNCTION public.v2_creation_origin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_transport_creations p JOIN public.v2_transport_creation_events e ON e.creation_id=p.id
 WHERE p.id=NEW.creation_id AND p.target_subject_id=NEW.subject_id AND e.id=NEW.event_id AND e.action='apply' AND e.review_id=NEW.review_id AND NOT p.erased
 AND NEW.snapshot=p.desired_snapshot AND NEW.snapshot=public.v2_creation_projection(NEW.subject_id)
 AND EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=NEW.subject_id AND revision=1 AND input_generation=1)) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_creation_origin_requires_application' USING ERRCODE='23514';
END;$$;
CREATE OR REPLACE FUNCTION public.v2_creation_project_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=NEW.creation_id;IF NEW.action='review' THEN RETURN NEW;END IF;
 IF NEW.action='apply' THEN
 INSERT INTO public.v2_transport_creation_origins(subject_id,creation_id,event_id,review_id,initial_revision,initial_generation,snapshot) VALUES(p.target_subject_id,p.id,NEW.id,NEW.review_id,1,1,p.desired_snapshot);
 INSERT INTO public.v2_transport_creation_heads(subject_id,creation_id,event_id) VALUES(p.target_subject_id,p.id,NEW.id);
 IF p.target_kind='pattern' THEN INSERT INTO public.v2_pattern_creation_origins(pattern_subject_id,pattern_version,creation_id,event_id,review_id) VALUES(p.target_subject_id,1,p.id,NEW.id,NEW.review_id);END IF;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('assess',p.target_subject_id,1,'transport-creation/1',NEW.id);
 ELSE DELETE FROM public.v2_transport_creation_heads WHERE creation_id=p.id;END IF;RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.v2_read_created_subject(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;origin public.v2_transport_creation_origins;state text;o public.v2_observations;
BEGIN
 SELECT lifecycle INTO state FROM public.v2_subjects WHERE id=subject;IF NOT FOUND THEN RETURN NULL;END IF;
 IF state='retired' THEN RETURN jsonb_build_object('status','retired','snapshot',NULL);END IF;
 SELECT * INTO origin FROM public.v2_transport_creation_origins WHERE subject_id=subject;SELECT * INTO p FROM public.v2_transport_creations WHERE id=origin.creation_id;
 IF origin.creation_id IS NOT NULL AND NOT origin.erased AND public.v2_creation_evidence_live(p.id)
 AND origin.snapshot=public.v2_creation_projection(subject) AND public.v2_creation_dependencies_live(p.id) AND EXISTS(SELECT 1 FROM public.v2_transport_creation_heads WHERE subject_id=subject AND creation_id=p.id)
 AND EXISTS(SELECT 1 FROM public.v2_review_decisions r JOIN public.v2_review_cases c ON c.id=r.case_id WHERE r.id=origin.review_id AND r.action='accept' AND NOT r.evidence_erased AND c.last_decision_id=r.id AND c.state='resolved') THEN
 SELECT * INTO o FROM public.v2_observations WHERE id=p.observation_id;
 RETURN jsonb_build_object('status','reviewed_origin','fieldKey',p.field_key,'scope',o.scope,'observedFrom',o.observed_from,'observedTo',o.observed_to,'effectiveFrom',o.effective_from,'effectiveTo',o.effective_to,'snapshot',origin.snapshot);
 END IF;RETURN jsonb_build_object('status',CASE WHEN origin.creation_id IS NULL THEN 'unreviewed' ELSE 'stale' END,'snapshot',NULL);
END;$$;
CREATE FUNCTION public.v2_pattern_creation_origin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_transport_creations p JOIN public.v2_transport_creation_events e ON e.creation_id=p.id JOIN public.v2_pattern_versions v ON v.pattern_subject_id=p.target_subject_id AND v.version=1 AND v.sealed
 WHERE p.id=NEW.creation_id AND p.target_kind='pattern' AND p.target_subject_id=NEW.pattern_subject_id AND e.id=NEW.event_id AND e.action='apply' AND e.review_id=NEW.review_id AND NOT p.erased) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_pattern_creation_origin_immutable_or_invalid' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_pattern_creation_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_pattern_creation_origins FOR EACH ROW EXECUTE FUNCTION public.v2_pattern_creation_origin_guard();
DO $$ DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_transport_creation_dependencies','v2_pattern_creation_origins'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);END IF;END LOOP;
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_creation_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'v2_creation_%' OR proname IN('v2_propose_transport_creation','v2_propose_transport_creation_context','v2_propose_pattern_creation','v2_pattern_creation_origin_guard')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;
