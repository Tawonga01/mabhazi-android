-- Reviewed named identity creation, not association/affiliation/publication.
CREATE TABLE public.v2_transport_creations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
 target_subject_id uuid NOT NULL UNIQUE,target_kind text NOT NULL CHECK(target_kind IN('operator','stop')),
 case_id uuid NOT NULL UNIQUE REFERENCES public.v2_review_cases(id),actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,field_key text NOT NULL,
 expected_source_revision bigint NOT NULL CHECK(expected_source_revision>=1),expected_generation bigint NOT NULL CHECK(expected_generation>=1),
 observation_revision bigint,target_revision bigint,source_snapshot jsonb,desired_snapshot jsonb,
 request_id uuid NOT NULL UNIQUE,request_digest text,erased boolean NOT NULL DEFAULT false,
 policy_version text NOT NULL DEFAULT 'transport-creation/1' CHECK(policy_version='transport-creation/1'),created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK(target_subject_id<>source_subject_id),
 CHECK((erased AND num_nonnulls(observation_id,observation_revision,target_revision,source_snapshot,desired_snapshot,request_digest)=0)
 OR (NOT erased AND num_nonnulls(observation_id,observation_revision,target_revision,source_snapshot,desired_snapshot)=5 AND observation_revision>=1 AND target_revision>=1)),
 CHECK(request_digest IS NULL OR request_digest ~ '^[0-9a-f]{64}$')
);
CREATE INDEX v2_creation_source_idx ON public.v2_transport_creations(source_subject_id);
CREATE INDEX v2_creation_observation_idx ON public.v2_transport_creations(observation_id);
CREATE INDEX v2_creation_actor_idx ON public.v2_transport_creations(actor_user_id);
CREATE TABLE public.v2_transport_creation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),creation_id uuid NOT NULL REFERENCES public.v2_transport_creations(id),
 revision bigint NOT NULL CHECK(revision>=1),previous_event_id uuid REFERENCES public.v2_transport_creation_events(id),
 action text NOT NULL CHECK(action IN('review','apply','reverse','invalidate','erase')),actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 review_id uuid REFERENCES public.v2_review_decisions(id),request_id uuid UNIQUE,request_digest text,cause_id uuid,
 source_revision bigint NOT NULL CHECK(source_revision>=1),source_generation bigint NOT NULL CHECK(source_generation>=1),
 projection_changed boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),UNIQUE(creation_id,revision),
 CHECK(request_digest IS NULL OR request_digest ~ '^[0-9a-f]{64}$')
);
CREATE INDEX v2_creation_event_previous_idx ON public.v2_transport_creation_events(previous_event_id);
CREATE INDEX v2_creation_event_review_idx ON public.v2_transport_creation_events(review_id);
CREATE INDEX v2_creation_event_actor_idx ON public.v2_transport_creation_events(actor_user_id);
CREATE TABLE public.v2_transport_creation_origins (
 subject_id uuid PRIMARY KEY REFERENCES public.v2_subjects(id),creation_id uuid NOT NULL UNIQUE REFERENCES public.v2_transport_creations(id),
 event_id uuid NOT NULL UNIQUE REFERENCES public.v2_transport_creation_events(id),review_id uuid NOT NULL REFERENCES public.v2_review_decisions(id),
 initial_revision bigint NOT NULL CHECK(initial_revision=1),initial_generation bigint NOT NULL CHECK(initial_generation=1),
 snapshot jsonb,erased boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),CHECK(erased=(snapshot IS NULL))
);
CREATE INDEX v2_creation_origin_review_idx ON public.v2_transport_creation_origins(review_id);
CREATE TABLE public.v2_transport_creation_heads (
 subject_id uuid PRIMARY KEY REFERENCES public.v2_subjects(id),creation_id uuid NOT NULL UNIQUE REFERENCES public.v2_transport_creations(id),
 event_id uuid NOT NULL REFERENCES public.v2_transport_creation_events(id)
);
CREATE INDEX v2_creation_head_event_idx ON public.v2_transport_creation_heads(event_id);
-- Value-free source identity; expected epoch carries structural concurrency.
CREATE FUNCTION public.v2_creation_source_snapshot(subject uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('subjectId',id,'kind',kind) FROM public.v2_subjects WHERE id=subject;
$$;
CREATE FUNCTION public.v2_creation_desired(observation uuid,kind text,target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE o public.v2_observations;data jsonb;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR target IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;
 IF kind='operator' AND o.field_key='operator.reported' AND o.value ? 'name' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','operator','display_name',o.value->'name','country_code',NULL,'affiliation_status','unverified');
 ELSIF kind='stop' AND o.field_key IN('boarding.pickup','alighting.dropoff') AND o.value ?& ARRAY['cityId','name'] AND NOT o.value ? 'stopId' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','stop','city_id',o.value->'cityId','name',o.value->'name','parent_stop_id',NULL,'latitude',NULL,'longitude',NULL,'precision','named_place');
 ELSE RAISE EXCEPTION 'v2_creation_kind_or_named_evidence_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('kind',kind,'data',data);
END;$$;
CREATE FUNCTION public.v2_creation_evidence_live(creation uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT NOT p.erased AND s.status='active' AND s.revision=p.observation_revision AND t.revision=p.target_revision
 AND o.original_subject_id=p.source_subject_id AND public.v2_observation_subject(o.id)=p.source_subject_id
 FROM public.v2_transport_creations p JOIN public.v2_observations o ON o.id=p.observation_id
 JOIN public.v2_observation_states s ON s.observation_id=o.id JOIN public.v2_observation_targets t ON t.observation_id=o.id WHERE p.id=creation),false);
$$;
CREATE FUNCTION public.v2_creation_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
 OR NEW.desired_snapshot IS DISTINCT FROM public.v2_creation_desired(NEW.observation_id,NEW.target_kind,NEW.target_subject_id)
 OR NOT EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id JOIN public.v2_observation_targets ot ON ot.observation_id=o.id
 WHERE o.id=NEW.observation_id AND o.original_subject_id=s.id AND public.v2_observation_subject(o.id)=s.id AND os.status='active' AND os.revision=NEW.observation_revision AND ot.revision=NEW.target_revision) THEN
 RAISE EXCEPTION 'v2_creation_proposal_binding_invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER v2_creation_validate BEFORE INSERT ON public.v2_transport_creations FOR EACH ROW EXECUTE FUNCTION public.v2_creation_validate();
CREATE FUNCTION public.v2_propose_transport_creation(actor varchar,source uuid,expected bigint,observation uuid,kind text,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_transport_creations;digest text;result uuid;c uuid;target uuid:=gen_random_uuid();s public.v2_subjects;
BEGIN
 IF actor IS NULL OR request IS NULL OR expected IS NULL OR kind IS NULL THEN RAISE EXCEPTION 'v2_creation_request_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,source,expected,observation,kind));
 SELECT * INTO receipt FROM public.v2_transport_creations WHERE request_id=request;
 IF FOUND THEN IF receipt.erased OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_creation_request_conflict' USING ERRCODE='23514';END IF;RETURN receipt.id;END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=source FOR UPDATE;
 IF s.id IS NULL OR s.lifecycle<>'active' THEN RAISE EXCEPTION 'v2_creation_source_inactive' USING ERRCODE='23514';END IF;
 IF s.revision<>expected THEN RAISE EXCEPTION 'v2_creation_source_revision_conflict' USING ERRCODE='40001';END IF;
 c:=public.v2_open_review_case(actor,source,'identity',NULL,NULL);
 INSERT INTO public.v2_transport_creations(source_subject_id,target_subject_id,target_kind,case_id,actor_user_id,observation_id,field_key,expected_source_revision,expected_generation,
 observation_revision,target_revision,source_snapshot,desired_snapshot,request_id,request_digest)
 SELECT source,target,kind,c,actor,o.id,o.field_key,s.revision,s.input_generation,os.revision,ot.revision,public.v2_creation_source_snapshot(source),public.v2_creation_desired(observation,kind,target),request,digest
 FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id JOIN public.v2_observation_targets ot ON ot.observation_id=o.id WHERE o.id=observation RETURNING id INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;RETURN result;
END;$$;
CREATE FUNCTION public.v2_creation_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;r public.v2_review_decisions;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE case_id=NEW.id;IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.subject_id<>p.source_subject_id OR NEW.kind<>'identity' OR NEW.candidate_id IS NOT NULL OR NEW.field_key IS NOT NULL OR NEW.scope_key IS NOT NULL THEN RAISE EXCEPTION 'v2_creation_case_binding_immutable' USING ERRCODE='23514';END IF;
 IF NEW.last_decision_id IS DISTINCT FROM OLD.last_decision_id THEN
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.last_decision_id;
 IF r.action='accept' AND (r.expected_subject_revision<>p.expected_source_revision OR p.expected_generation IS DISTINCT FROM (SELECT input_generation FROM public.v2_subjects WHERE id=p.source_subject_id)
 OR p.source_snapshot IS DISTINCT FROM public.v2_creation_source_snapshot(p.source_subject_id) OR NOT public.v2_creation_evidence_live(p.id)
 OR (SELECT array_agg(observation_id ORDER BY observation_id) FROM public.v2_review_decision_evidence WHERE decision_id=r.id) IS DISTINCT FROM ARRAY[p.observation_id]) THEN
 RAISE EXCEPTION 'v2_creation_approval_stale_or_different_evidence' USING ERRCODE='40001';END IF;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_creation_case_guard BEFORE UPDATE ON public.v2_review_cases FOR EACH ROW EXECUTE FUNCTION public.v2_creation_case_guard();
CREATE FUNCTION public.v2_review_transport_creation(actor varchar,creation uuid,expected_case bigint,expected_source bigint,operation text,reason text,note text,request uuid,reverse_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;receipt public.v2_transport_creation_events;previous public.v2_transport_creation_events;digest text;result uuid;
BEGIN
 IF actor IS NULL OR request IS NULL OR operation IS NULL OR operation NOT IN('accept','reject','needs_context','reverse') THEN RAISE EXCEPTION 'v2_creation_review_request_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,creation,expected_case,expected_source,operation,reason,note,reverse_id));
 SELECT * INTO receipt FROM public.v2_transport_creation_events WHERE request_id=request;
 IF FOUND THEN IF receipt.action<>'review' OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_creation_review_request_conflict' USING ERRCODE='23514';END IF;RETURN receipt.review_id;END IF;
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=creation;
 IF p.id IS NULL OR p.erased THEN RAISE EXCEPTION 'v2_creation_proposal_missing' USING ERRCODE='23514';END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid DEFERRED;
 result:=public.v2_record_review(actor,p.case_id,expected_case,expected_source,operation,reason,note,CASE WHEN operation='reverse' THEN ARRAY[]::uuid[] ELSE ARRAY[p.observation_id] END,'review/1',reverse_id);
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid IMMEDIATE;
 SELECT * INTO previous FROM public.v2_transport_creation_events WHERE creation_id=creation ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.v2_transport_creation_events(creation_id,revision,previous_event_id,action,actor_user_id,review_id,request_id,request_digest,source_revision,source_generation,projection_changed)
 VALUES(creation,COALESCE(previous.revision,0)+1,previous.id,'review',actor,result,request,digest,1,1,false);RETURN result;
END;$$;
CREATE FUNCTION public.v2_creation_event_validate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;previous public.v2_transport_creation_events;approval public.v2_transport_creation_events;r public.v2_review_decisions;s public.v2_subjects;
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
 OR public.v2_creation_source_snapshot(s.id) IS DISTINCT FROM p.source_snapshot THEN RAISE EXCEPTION 'v2_creation_apply_revision_conflict' USING ERRCODE='40001';END IF;
 SET CONSTRAINTS public.v2_subject_subtype DEFERRED;
 INSERT INTO public.v2_subjects(id,kind) VALUES(p.target_subject_id,p.target_kind);
 IF p.target_kind='operator' THEN INSERT INTO public.v2_operators(subject_id,display_name) VALUES(p.target_subject_id,p.desired_snapshot->'data'->>'display_name');
 ELSE INSERT INTO public.v2_stops(subject_id,city_id,name) VALUES(p.target_subject_id,(p.desired_snapshot->'data'->>'city_id')::integer,p.desired_snapshot->'data'->>'name');END IF;
 SET CONSTRAINTS public.v2_subject_subtype IMMEDIATE;
 IF public.v2_transport_snapshot(p.target_subject_id) IS DISTINCT FROM p.desired_snapshot THEN RAISE EXCEPTION 'v2_creation_projection_mismatch' USING ERRCODE='23514';END IF;
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
CREATE TRIGGER v2_creation_event_validate BEFORE INSERT ON public.v2_transport_creation_events FOR EACH ROW EXECUTE FUNCTION public.v2_creation_event_validate();
CREATE FUNCTION public.v2_creation_origin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_transport_creations p JOIN public.v2_transport_creation_events e ON e.creation_id=p.id
 WHERE p.id=NEW.creation_id AND p.target_subject_id=NEW.subject_id AND e.id=NEW.event_id AND e.action='apply' AND e.review_id=NEW.review_id AND NOT p.erased
 AND NEW.snapshot=p.desired_snapshot AND NEW.snapshot=public.v2_transport_snapshot(NEW.subject_id)
 AND EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=NEW.subject_id AND revision=1 AND input_generation=1)) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_creation_origin_requires_application' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_creation_origin_guard BEFORE INSERT ON public.v2_transport_creation_origins FOR EACH ROW EXECUTE FUNCTION public.v2_creation_origin_guard();
CREATE FUNCTION public.v2_creation_project_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=NEW.creation_id;IF NEW.action='review' THEN RETURN NEW;END IF;
 IF NEW.action='apply' THEN
 INSERT INTO public.v2_transport_creation_origins(subject_id,creation_id,event_id,review_id,initial_revision,initial_generation,snapshot) VALUES(p.target_subject_id,p.id,NEW.id,NEW.review_id,1,1,p.desired_snapshot);
 INSERT INTO public.v2_transport_creation_heads(subject_id,creation_id,event_id) VALUES(p.target_subject_id,p.id,NEW.id);
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('assess',p.target_subject_id,1,'transport-creation/1',NEW.id);
 ELSE DELETE FROM public.v2_transport_creation_heads WHERE creation_id=p.id;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_creation_project_event AFTER INSERT ON public.v2_transport_creation_events FOR EACH ROW EXECUTE FUNCTION public.v2_creation_project_event();
CREATE FUNCTION public.v2_creation_head_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF EXISTS(SELECT 1 FROM public.v2_transport_creation_events e JOIN public.v2_transport_creations p ON p.id=e.creation_id WHERE e.id=NEW.event_id AND p.id=NEW.creation_id AND p.target_subject_id=NEW.subject_id AND e.action='apply' AND NOT p.erased) THEN RETURN NEW;END IF;
 END IF;RAISE EXCEPTION 'v2_creation_head_internal' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_creation_head_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_transport_creation_heads FOR EACH ROW EXECUTE FUNCTION public.v2_creation_head_guard();
CREATE FUNCTION public.v2_apply_transport_creation(actor varchar,creation uuid,review uuid,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_transport_creation_events;digest text;result uuid;previous public.v2_transport_creation_events;
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'v2_creation_apply_request_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,creation,review));SELECT * INTO receipt FROM public.v2_transport_creation_events WHERE request_id=request;
 IF FOUND THEN IF receipt.action<>'apply' OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_creation_apply_request_conflict' USING ERRCODE='23514';END IF;RETURN receipt.id;END IF;
 SELECT * INTO previous FROM public.v2_transport_creation_events WHERE creation_id=creation ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.v2_transport_creation_events(creation_id,revision,previous_event_id,action,actor_user_id,review_id,request_id,request_digest,source_revision,source_generation,projection_changed)
 VALUES(creation,COALESCE(previous.revision,0)+1,previous.id,'apply',actor,review,request,digest,1,1,false) RETURNING id INTO result;RETURN result;
END;$$;
CREATE FUNCTION public.v2_creation_append(creation uuid,operation text,cause uuid,review uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous public.v2_transport_creation_events;
BEGIN
 SELECT * INTO previous FROM public.v2_transport_creation_events WHERE creation_id=creation ORDER BY revision DESC LIMIT 1;
 IF previous.action=operation AND operation IN('invalidate','erase') THEN RETURN;END IF;
 INSERT INTO public.v2_transport_creation_events(creation_id,revision,previous_event_id,action,cause_id,review_id,source_revision,source_generation,projection_changed)
 VALUES(creation,COALESCE(previous.revision,0)+1,previous.id,operation,cause,review,1,1,false);
END;$$;
CREATE FUNCTION public.v2_creation_structure_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE creation uuid;
BEGIN
 SELECT creation_id INTO creation FROM public.v2_transport_creation_heads WHERE subject_id=NEW.subject_id;
 IF creation IS NOT NULL THEN PERFORM public.v2_creation_append(creation,'invalidate',NEW.change_id);END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_creation_structure_changed AFTER INSERT ON public.v2_transport_change_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_creation_structure_changed();
CREATE FUNCTION public.v2_creation_support_changed(creation uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target uuid;affected uuid[];item record;cause uuid:=gen_random_uuid();
BEGIN
 SELECT target_subject_id INTO target FROM public.v2_transport_creations WHERE id=creation;
 IF NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=target) THEN RETURN;END IF;
 affected:=public.v2_transport_dependents(ARRAY[target]);PERFORM 1 FROM public.v2_subjects WHERE id=ANY(affected) ORDER BY id FOR UPDATE;
 -- Lost creation support is not an identity reassignment: preserve newly reviewed links.
 PERFORM public.v2_invalidate_derived(ARRAY(SELECT id FROM public.v2_field_decisions WHERE subject_id=ANY(affected)),false);
 PERFORM public.v2_target_recompute_subjects(affected,cause,false);
 FOR item IN SELECT creation_id FROM public.v2_transport_creation_heads WHERE subject_id=ANY(affected) ORDER BY subject_id LOOP PERFORM public.v2_creation_append(item.creation_id,'invalidate',cause);END LOOP;
 FOR item IN SELECT edit_id FROM public.v2_transport_edit_heads WHERE subject_id=ANY(affected) ORDER BY subject_id LOOP PERFORM public.v2_append_edit_invalidation(item.edit_id,'invalidate',cause);END LOOP;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) SELECT 'refresh_tasks',id,input_generation,'prompts/1',cause FROM public.v2_subjects WHERE id=ANY(affected);
END;$$;
CREATE FUNCTION public.v2_creation_review_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;r public.v2_review_decisions;applied public.v2_transport_creation_events;
BEGIN
 IF NEW.last_decision_id IS NOT DISTINCT FROM OLD.last_decision_id AND NEW.state=OLD.state THEN RETURN NEW;END IF;
 SELECT * INTO p FROM public.v2_transport_creations WHERE case_id=NEW.id;IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT * INTO applied FROM public.v2_transport_creation_events WHERE creation_id=p.id AND action='apply';IF applied.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.last_decision_id;
 IF NEW.last_decision_id IS DISTINCT FROM OLD.last_decision_id AND r.action='reverse' AND r.reverses_decision_id=applied.review_id THEN
 PERFORM public.v2_creation_append(p.id,'reverse',r.id,r.id);PERFORM public.v2_creation_support_changed(p.id);
 ELSIF NEW.state<>'resolved' OR NEW.last_decision_id IS DISTINCT FROM applied.review_id THEN PERFORM public.v2_creation_support_changed(p.id);END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_creation_review_changed AFTER UPDATE ON public.v2_review_cases FOR EACH ROW EXECUTE FUNCTION public.v2_creation_review_changed();
CREATE FUNCTION public.v2_creation_observation_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p record;item record;observation uuid;affected uuid[];erase boolean;
BEGIN
 erase:=TG_TABLE_NAME='v2_observations';
 IF erase THEN observation:=OLD.id;ELSE IF NEW.revision=OLD.revision THEN RETURN NEW;END IF;observation:=NEW.observation_id;END IF;
 FOR p IN SELECT id,target_subject_id FROM public.v2_transport_creations WHERE observation_id=observation ORDER BY target_subject_id,id LOOP
 IF EXISTS(SELECT 1 FROM public.v2_transport_creation_origins WHERE creation_id=p.id) THEN PERFORM public.v2_creation_support_changed(p.id);END IF;
 IF erase THEN
 affected:=public.v2_transport_dependents(ARRAY[p.target_subject_id]);
 -- Later edit/revision snapshots may inherit the erased original name/location.
 FOR item IN SELECT id FROM public.v2_transport_edits WHERE subject_id=ANY(affected) ORDER BY subject_id,id LOOP
 UPDATE public.v2_transport_edits SET erased=true,observation_id=NULL,observation_revision=NULL,target_revision=NULL,before_snapshot=NULL,after_snapshot=NULL,observation_scope=NULL,request_digest=NULL WHERE id=item.id;
 UPDATE public.v2_transport_edit_events SET request_digest=NULL WHERE edit_id=item.id;PERFORM public.v2_append_edit_invalidation(item.id,'erase',NULL);
 END LOOP;
 UPDATE public.v2_subject_revisions SET origin_kind='erased',snapshot=NULL,decision_id=NULL,decision_kind=NULL,initial_contribution_id=NULL WHERE subject_id=ANY(affected);
 UPDATE public.v2_transport_creation_origins SET snapshot=NULL,erased=true WHERE creation_id=p.id;
 UPDATE public.v2_transport_creations SET erased=true,observation_id=NULL,observation_revision=NULL,target_revision=NULL,source_snapshot=NULL,desired_snapshot=NULL,request_digest=NULL WHERE id=p.id;
 UPDATE public.v2_transport_creation_events SET request_digest=NULL WHERE creation_id=p.id;PERFORM public.v2_creation_append(p.id,'erase',NULL);
 END IF;END LOOP;RETURN COALESCE(NEW,OLD);
END;$$;
CREATE TRIGGER v2_creation_observation_changed AFTER UPDATE ON public.v2_observation_states FOR EACH ROW EXECUTE FUNCTION public.v2_creation_observation_changed();
CREATE TRIGGER v2_creation_target_changed AFTER UPDATE ON public.v2_observation_targets FOR EACH ROW EXECUTE FUNCTION public.v2_creation_observation_changed();
CREATE TRIGGER aa_v2_creation_observation_erased BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_creation_observation_changed();
CREATE FUNCTION public.v2_creation_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
 IF TG_TABLE_NAME='v2_transport_creations' THEN
 IF NEW.erased AND num_nonnulls(NEW.observation_id,NEW.observation_revision,NEW.target_revision,NEW.source_snapshot,NEW.desired_snapshot,NEW.request_digest)=0
 AND to_jsonb(NEW)-ARRAY['erased','observation_id','observation_revision','target_revision','source_snapshot','desired_snapshot','request_digest']=to_jsonb(OLD)-ARRAY['erased','observation_id','observation_revision','target_revision','source_snapshot','desired_snapshot','request_digest'] THEN RETURN NEW;END IF;
 IF NEW.actor_user_id IS NULL THEN NEW.request_digest:=NULL;
 IF to_jsonb(NEW)-ARRAY['actor_user_id','request_digest']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest'] THEN RETURN NEW;END IF;END IF;
 ELSIF TG_TABLE_NAME='v2_transport_creation_events' THEN
 IF NEW.actor_user_id IS NULL THEN NEW.request_digest:=NULL;END IF;
 IF NEW.request_digest IS NULL AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id=OLD.actor_user_id) AND to_jsonb(NEW)-ARRAY['actor_user_id','request_digest']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest'] THEN RETURN NEW;END IF;
 ELSIF TG_TABLE_NAME='v2_transport_creation_origins' THEN
 IF NEW.erased AND NEW.snapshot IS NULL AND to_jsonb(NEW)-ARRAY['erased','snapshot']=to_jsonb(OLD)-ARRAY['erased','snapshot'] THEN RETURN NEW;END IF;
 END IF;END IF;RAISE EXCEPTION 'v2_creation_history_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_creation_history_guard BEFORE UPDATE OR DELETE ON public.v2_transport_creations FOR EACH ROW EXECUTE FUNCTION public.v2_creation_history_guard();
CREATE TRIGGER v2_creation_history_guard BEFORE UPDATE OR DELETE ON public.v2_transport_creation_events FOR EACH ROW EXECUTE FUNCTION public.v2_creation_history_guard();
CREATE TRIGGER v2_creation_history_guard BEFORE UPDATE OR DELETE ON public.v2_transport_creation_origins FOR EACH ROW EXECUTE FUNCTION public.v2_creation_history_guard();
CREATE FUNCTION public.v2_read_created_subject(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;origin public.v2_transport_creation_origins;state text;o public.v2_observations;
BEGIN
 SELECT lifecycle INTO state FROM public.v2_subjects WHERE id=subject;IF NOT FOUND THEN RETURN NULL;END IF;
 IF state='retired' THEN RETURN jsonb_build_object('status','retired','snapshot',NULL);END IF;
 SELECT * INTO origin FROM public.v2_transport_creation_origins WHERE subject_id=subject;SELECT * INTO p FROM public.v2_transport_creations WHERE id=origin.creation_id;
 IF origin.creation_id IS NOT NULL AND NOT origin.erased AND public.v2_creation_evidence_live(p.id)
 AND origin.snapshot=public.v2_transport_snapshot(subject) AND EXISTS(SELECT 1 FROM public.v2_transport_creation_heads WHERE subject_id=subject AND creation_id=p.id)
 AND EXISTS(SELECT 1 FROM public.v2_review_decisions r JOIN public.v2_review_cases c ON c.id=r.case_id WHERE r.id=origin.review_id AND r.action='accept' AND NOT r.evidence_erased AND c.last_decision_id=r.id AND c.state='resolved') THEN
 SELECT * INTO o FROM public.v2_observations WHERE id=p.observation_id;
 RETURN jsonb_build_object('status','reviewed_origin','fieldKey',p.field_key,'scope',o.scope,'observedFrom',o.observed_from,'observedTo',o.observed_to,'effectiveFrom',o.effective_from,'effectiveTo',o.effective_to,'snapshot',origin.snapshot);
 END IF;RETURN jsonb_build_object('status',CASE WHEN origin.creation_id IS NULL THEN 'unreviewed' ELSE 'stale' END,'snapshot',NULL);
END;$$;
DO $$ DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_transport_creations','v2_transport_creation_events','v2_transport_creation_origins','v2_transport_creation_heads'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);END IF;END LOOP;
 EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
 EXECUTE format('CREATE TRIGGER v2_creation_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'v2_creation_%' OR proname IN('v2_propose_transport_creation','v2_review_transport_creation','v2_apply_transport_creation','v2_read_created_subject')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;GRANT EXECUTE ON FUNCTION public.v2_read_created_subject(uuid) TO mabhazi_api;
END;$$;

-- Historical origin edges remain dependencies after authority loss.
CREATE OR REPLACE FUNCTION public.v2_transport_dependents(roots uuid[]) RETURNS uuid[] LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH RECURSIVE edges(parent,child) AS (
  SELECT operator_subject_id,subject_id FROM public.v2_leads WHERE operator_subject_id IS NOT NULL
  UNION SELECT operator_subject_id,subject_id FROM public.v2_routes
  UNION SELECT route_subject_id,subject_id FROM public.v2_patterns
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_service_plans
  UNION SELECT service_plan_subject_id,subject_id FROM public.v2_runs
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_runs
  UNION SELECT parent_stop_id,subject_id FROM public.v2_stops WHERE parent_stop_id IS NOT NULL
  UNION SELECT ps.stop_subject_id,ps.pattern_subject_id FROM public.v2_pattern_stops ps JOIN public.v2_pattern_versions pv ON pv.pattern_subject_id=ps.pattern_subject_id AND pv.version=ps.pattern_version WHERE pv.sealed
  UNION SELECT intended_subject_id,subject_id FROM public.v2_actual_journeys WHERE intended_subject_id IS NOT NULL
  UNION SELECT matched_run_subject_id,subject_id FROM public.v2_actual_journeys WHERE matched_run_subject_id IS NOT NULL
  UNION SELECT x.ref_id,o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT x.ref_id,public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT p.source_subject_id,p.target_subject_id FROM public.v2_transport_creations p JOIN public.v2_transport_creation_origins o ON o.creation_id=p.id
  UNION SELECT from_subject_id,to_subject_id FROM public.v2_association_links
  UNION SELECT to_subject_id,from_subject_id FROM public.v2_association_links
 ), reached(id) AS (SELECT unnest(roots) UNION SELECT e.child FROM edges e JOIN reached r ON r.id=e.parent)
 SELECT COALESCE(array_agg(s.id ORDER BY s.id),'{}'::uuid[]) FROM reached r JOIN public.v2_subjects s ON s.id=r.id;
$$;

-- Scoped final-state checks also cover existing reviewed edit operations.
CREATE OR REPLACE FUNCTION public.v2_review_transport_edit(actor varchar,edit uuid,expected_case bigint,expected_subject bigint,operation text,reason text,note text,request uuid,reverse_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.v2_transport_edits; receipt public.v2_transport_edit_events; previous public.v2_transport_edit_events; digest text; result uuid;
BEGIN
 IF actor IS NULL OR request IS NULL OR operation IS NULL OR operation NOT IN('accept','reject','needs_context','reverse') THEN RAISE EXCEPTION 'v2_edit_review_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,edit,expected_case,expected_subject,operation,reason,note,reverse_id));
 SELECT * INTO receipt FROM public.v2_transport_edit_events WHERE request_id=request;
 IF FOUND THEN IF receipt.action<>'review' OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_edit_review_request_conflict' USING ERRCODE='23514'; END IF;RETURN receipt.review_id;END IF;
 SELECT * INTO e FROM public.v2_transport_edits WHERE id=edit;
 IF e.id IS NULL OR e.erased THEN RAISE EXCEPTION 'v2_edit_review_proposal_missing' USING ERRCODE='23514'; END IF;
 -- The registry is completed by the matching subtype inside this operation.
 -- Recheck just these constraints immediately, including for callers that had
 -- all constraints immediate; leave unrelated deferral choices unchanged.
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid DEFERRED;
 result:=public.v2_record_review(actor,e.case_id,expected_case,expected_subject,operation,reason,note,CASE WHEN operation='reverse' THEN ARRAY[]::uuid[] ELSE ARRAY[e.observation_id] END,'review/1',reverse_id);
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid IMMEDIATE;
 SELECT * INTO previous FROM public.v2_transport_edit_events WHERE edit_id=edit ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.v2_transport_edit_events(edit_id,revision,previous_event_id,action,actor_user_id,review_id,request_id,request_digest,resulting_revision,resulting_generation,projection_changed)
 VALUES(edit,COALESCE(previous.revision,0)+1,previous.id,'review',actor,result,request,digest,1,1,false);
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.v2_apply_transport_edit(actor varchar,edit uuid,review uuid,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_transport_edit_events; digest text; result uuid; previous public.v2_transport_edit_events;
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'v2_edit_apply_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,edit,review));
 SELECT * INTO receipt FROM public.v2_transport_edit_events WHERE request_id=request;
 IF FOUND THEN IF receipt.action<>'apply' OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_edit_apply_request_conflict' USING ERRCODE='23514'; END IF; RETURN receipt.id; END IF;
 SET CONSTRAINTS public.v2_current_field_valid,public.v2_current_association_valid DEFERRED;
 SELECT * INTO previous FROM public.v2_transport_edit_events WHERE edit_id=edit ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.v2_transport_edit_events(edit_id,revision,previous_event_id,action,actor_user_id,review_id,request_id,request_digest,resulting_revision,resulting_generation,projection_changed)
 VALUES(edit,COALESCE(previous.revision,0)+1,previous.id,'apply',actor,review,request,digest,1,1,false) RETURNING id INTO result;
 SET CONSTRAINTS public.v2_current_field_valid,public.v2_current_association_valid IMMEDIATE;
 RETURN result;
END; $$;
