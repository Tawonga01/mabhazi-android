-- Explicit, reversible observation identity. No generic graph traversal or
-- public reassignment writer. Original reports and their field meanings survive.
CREATE TABLE public.v2_target_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 target_subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
 association_decision_id uuid NOT NULL REFERENCES public.v2_association_decisions(id),
 revision bigint NOT NULL CHECK(revision>=2),
 expected_observation_revision bigint NOT NULL CHECK(expected_observation_revision>=1),
 expected_original_revision bigint NOT NULL CHECK(expected_original_revision>=1),
 expected_target_revision bigint NOT NULL CHECK(expected_target_revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,observation_id), UNIQUE(observation_id,revision), UNIQUE(observation_id,association_decision_id)
);
CREATE INDEX v2_target_assignment_subject_idx ON public.v2_target_assignments(target_subject_id);
CREATE INDEX v2_target_assignment_decision_idx ON public.v2_target_assignments(association_decision_id);
CREATE TABLE public.v2_target_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>=1),
 action text NOT NULL CHECK(action IN ('baseline','assign','invalidate')),
 assignment_id uuid, previous_event_id uuid,
 cause_association_decision_id uuid REFERENCES public.v2_association_decisions(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,observation_id), UNIQUE(id,observation_id,revision), UNIQUE(observation_id,revision),
 CHECK((revision=1)=(action='baseline')),
 CHECK((revision=1)=(previous_event_id IS NULL)),
 CHECK(action<>'baseline' OR (assignment_id IS NULL AND cause_association_decision_id IS NULL)),
 CHECK(action<>'assign' OR (assignment_id IS NOT NULL AND cause_association_decision_id IS NOT NULL)),
 CHECK(action<>'invalidate' OR cause_association_decision_id IS NOT NULL),
 FOREIGN KEY(assignment_id,observation_id) REFERENCES public.v2_target_assignments(id,observation_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(previous_event_id,observation_id) REFERENCES public.v2_target_events(id,observation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_target_event_assignment_idx ON public.v2_target_events(assignment_id);
CREATE INDEX v2_target_event_previous_idx ON public.v2_target_events(previous_event_id);
CREATE INDEX v2_target_event_cause_idx ON public.v2_target_events(cause_association_decision_id);
CREATE TABLE public.v2_observation_targets (
 observation_id uuid PRIMARY KEY REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>=1),
 assignment_id uuid, latest_event_id uuid NOT NULL,
 FOREIGN KEY(assignment_id,observation_id) REFERENCES public.v2_target_assignments(id,observation_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(latest_event_id,observation_id,revision) REFERENCES public.v2_target_events(id,observation_id,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_observation_target_assignment_idx ON public.v2_observation_targets(assignment_id);

CREATE FUNCTION public.v2_target_assignment_valid(assignment uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.v2_target_assignments a
 JOIN public.v2_observations o ON o.id=a.observation_id
 JOIN public.v2_observation_states os ON os.observation_id=o.id AND os.status='active'
 JOIN public.v2_association_decisions d ON d.id=a.association_decision_id AND d.action='accept' AND NOT d.invalidated
 JOIN public.v2_association_links l ON l.decision_id=d.id
 JOIN public.v2_association_candidates c ON c.id=d.candidate_id AND c.last_decision_id=d.id AND c.state='decided' AND NOT c.evidence_erased
 JOIN public.v2_review_decisions r ON r.id=d.reviewer_decision_id AND r.action='accept' AND NOT r.evidence_erased
 JOIN public.v2_review_cases rc ON rc.id=r.case_id AND rc.last_decision_id=r.id AND rc.kind='identity' AND rc.candidate_id=c.id AND rc.state='resolved'
 JOIN public.v2_subjects s ON s.id=a.target_subject_id AND s.lifecycle='active'
 WHERE a.id=assignment AND c.from_subject_id=o.original_subject_id AND c.to_subject_id=a.target_subject_id
 AND c.relation IN ('same_service','same_pattern','duplicate_of')
 AND public.v2_observation_kind_valid(o.field_key,s.kind)
 AND EXISTS(SELECT 1 FROM public.v2_candidate_evidence e WHERE e.candidate_id=c.id AND e.observation_id=o.id)
 AND EXISTS(SELECT 1 FROM public.v2_review_decision_evidence e WHERE e.decision_id=r.id AND e.observation_id=o.id));
$$;
CREATE FUNCTION public.v2_observation_subject(observation uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(a.target_subject_id,o.original_subject_id) FROM public.v2_observations o
 LEFT JOIN public.v2_observation_targets t ON t.observation_id=o.id
 LEFT JOIN public.v2_target_assignments a ON a.id=t.assignment_id WHERE o.id=observation;
$$;
CREATE FUNCTION public.v2_target_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.v2_observations WHERE id=OLD.observation_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'v2_target_history_immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_target_history_immutable BEFORE UPDATE OR DELETE ON public.v2_target_assignments
 FOR EACH ROW EXECUTE FUNCTION public.v2_target_history_immutable();
CREATE TRIGGER v2_target_history_immutable BEFORE UPDATE OR DELETE ON public.v2_target_events
 FOR EACH ROW EXECUTE FUNCTION public.v2_target_history_immutable();

CREATE FUNCTION public.v2_validate_target_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o public.v2_observations; t public.v2_observation_targets; c public.v2_association_candidates;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=NEW.observation_id;
 SELECT * INTO t FROM public.v2_observation_targets WHERE observation_id=o.id FOR UPDATE;
 IF t.revision IS NULL OR NEW.revision<>t.revision+1
   OR NEW.expected_observation_revision IS DISTINCT FROM (SELECT revision FROM public.v2_observation_states WHERE observation_id=o.id)
   OR NEW.expected_original_revision IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=o.original_subject_id)
   OR NEW.expected_target_revision IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=NEW.target_subject_id) THEN
   RAISE EXCEPTION 'v2_target_revision_conflict' USING ERRCODE='40001'; END IF;
 SELECT ca.* INTO c FROM public.v2_association_decisions d JOIN public.v2_association_candidates ca ON ca.id=d.candidate_id
   WHERE d.id=NEW.association_decision_id;
 IF c.from_subject_id IS DISTINCT FROM o.original_subject_id OR c.to_subject_id IS DISTINCT FROM NEW.target_subject_id THEN
   RAISE EXCEPTION 'v2_target_requires_original_endpoint' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_validate_target_assignment BEFORE INSERT ON public.v2_target_assignments
 FOR EACH ROW EXECUTE FUNCTION public.v2_validate_target_assignment();
CREATE FUNCTION public.v2_validate_target_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t public.v2_observation_targets; a public.v2_target_assignments; fallback uuid; old_decision uuid;
BEGIN
 SELECT * INTO t FROM public.v2_observation_targets WHERE observation_id=NEW.observation_id FOR UPDATE;
 IF NEW.action='baseline' THEN
   IF t.observation_id IS NOT NULL THEN RAISE EXCEPTION 'v2_target_baseline_exists' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF t.observation_id IS NULL OR NEW.revision<>t.revision+1 OR NEW.previous_event_id IS DISTINCT FROM t.latest_event_id THEN
   RAISE EXCEPTION 'v2_target_event_lineage_conflict' USING ERRCODE='40001'; END IF;
 IF NEW.action='assign' THEN
   SELECT * INTO a FROM public.v2_target_assignments WHERE id=NEW.assignment_id;
   IF a.observation_id IS DISTINCT FROM NEW.observation_id OR a.revision<>NEW.revision
     OR NEW.cause_association_decision_id IS DISTINCT FROM a.association_decision_id
     OR NOT public.v2_target_assignment_valid(a.id) THEN
     RAISE EXCEPTION 'v2_target_requires_reviewed_identity_evidence' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT association_decision_id INTO old_decision FROM public.v2_target_assignments WHERE id=t.assignment_id;
   SELECT id INTO fallback FROM public.v2_target_assignments WHERE observation_id=NEW.observation_id AND public.v2_target_assignment_valid(id) ORDER BY revision DESC LIMIT 1;
   IF t.assignment_id IS NULL OR public.v2_target_assignment_valid(t.assignment_id)
     OR NEW.assignment_id IS DISTINCT FROM fallback OR NEW.cause_association_decision_id IS DISTINCT FROM old_decision THEN
     RAISE EXCEPTION 'v2_target_invalidation_mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_validate_target_event BEFORE INSERT ON public.v2_target_events
 FOR EACH ROW EXECUTE FUNCTION public.v2_validate_target_event();
CREATE FUNCTION public.v2_guard_observation_target() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e public.v2_target_events;
BEGIN
 IF TG_OP='DELETE' THEN
   IF NOT EXISTS(SELECT 1 FROM public.v2_observations WHERE id=OLD.observation_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'v2_target_projection_delete_forbidden' USING ERRCODE='23514';
 END IF;
 SELECT * INTO e FROM public.v2_target_events WHERE id=NEW.latest_event_id;
 IF e.observation_id IS DISTINCT FROM NEW.observation_id OR e.revision IS DISTINCT FROM NEW.revision
   OR e.assignment_id IS DISTINCT FROM NEW.assignment_id
   OR (TG_OP='INSERT' AND e.action<>'baseline')
   OR (TG_OP='UPDATE' AND (NEW.observation_id<>OLD.observation_id OR NEW.revision<>OLD.revision+1 OR e.previous_event_id IS DISTINCT FROM OLD.latest_event_id)) THEN
   RAISE EXCEPTION 'v2_target_projection_requires_event' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_guard_observation_target BEFORE INSERT OR UPDATE OR DELETE ON public.v2_observation_targets
 FOR EACH ROW EXECUTE FUNCTION public.v2_guard_observation_target();

CREATE FUNCTION public.v2_target_recompute_subjects(subjects uuid[],event uuid,erase boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s record;
BEGIN
 IF erase THEN
   UPDATE public.v2_subject_revisions SET origin_kind='erased',snapshot=NULL,decision_id=NULL,decision_kind=NULL,initial_contribution_id=NULL
     WHERE subject_id=ANY(subjects);
 END IF;
 FOR s IN UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=ANY(subjects) RETURNING id,input_generation LOOP
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     VALUES(CASE WHEN erase THEN 'erase_recompute' ELSE 'assess' END,s.id,s.input_generation,'observation-targets/1',event);
 END LOOP;
END; $$;
CREATE FUNCTION public.v2_project_target_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_subject uuid; new_subject uuid; original uuid; fields uuid[];
BEGIN
 IF NEW.action='baseline' THEN
   INSERT INTO public.v2_observation_targets VALUES(NEW.observation_id,1,NULL,NEW.id);
   RETURN NEW;
 END IF;
 old_subject:=public.v2_observation_subject(NEW.observation_id);
 SELECT original_subject_id INTO original FROM public.v2_observations WHERE id=NEW.observation_id;
 UPDATE public.v2_observation_targets SET revision=NEW.revision,assignment_id=NEW.assignment_id,latest_event_id=NEW.id WHERE observation_id=NEW.observation_id;
 new_subject:=public.v2_observation_subject(NEW.observation_id);
 -- Invalidate even when two decisions choose the same target: provenance changed.
 SELECT array_agg(field_decision_id) INTO fields FROM public.v2_field_decision_evidence WHERE observation_id=NEW.observation_id;
 PERFORM public.v2_invalidate_derived(fields,false);
 PERFORM public.v2_target_recompute_subjects(ARRAY[original,old_subject,new_subject],NEW.id,false);
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_project_target_event AFTER INSERT ON public.v2_target_events
 FOR EACH ROW EXECUTE FUNCTION public.v2_project_target_event();
CREATE FUNCTION public.v2_project_target_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.v2_target_events(observation_id,revision,action,assignment_id,previous_event_id,cause_association_decision_id)
   SELECT NEW.observation_id,NEW.revision,'assign',NEW.id,latest_event_id,NEW.association_decision_id
   FROM public.v2_observation_targets WHERE observation_id=NEW.observation_id;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_project_target_assignment AFTER INSERT ON public.v2_target_assignments
 FOR EACH ROW EXECUTE FUNCTION public.v2_project_target_assignment();

CREATE FUNCTION public.v2_resolve_observation_target(observation uuid,decision uuid,expected_target_state bigint,
 expected_observation bigint,expected_original bigint,expected_destination bigint) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a public.v2_target_assignments; destination uuid;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF num_nulls(observation,decision,expected_target_state,expected_observation,expected_original,expected_destination)>0 THEN
   RAISE EXCEPTION 'v2_target_request_invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM public.v2_target_assignments WHERE observation_id=observation AND association_decision_id=decision;
 IF FOUND THEN
   IF a.revision<>expected_target_state+1 OR a.expected_observation_revision<>expected_observation
     OR a.expected_original_revision<>expected_original OR a.expected_target_revision<>expected_destination THEN
     RAISE EXCEPTION 'v2_target_request_conflict' USING ERRCODE='23514'; END IF;
   RETURN a.id; -- Receipt only: replay never reinstates an invalidated assignment.
 END IF;
 SELECT c.to_subject_id INTO destination FROM public.v2_association_decisions d JOIN public.v2_association_candidates c ON c.id=d.candidate_id WHERE d.id=decision;
 IF destination IS NULL THEN RAISE EXCEPTION 'v2_target_decision_missing' USING ERRCODE='23503'; END IF;
 INSERT INTO public.v2_target_assignments(observation_id,target_subject_id,association_decision_id,revision,expected_observation_revision,expected_original_revision,expected_target_revision)
 VALUES(observation,destination,decision,expected_target_state+1,expected_observation,expected_original,expected_destination) RETURNING id INTO a.id;
 RETURN a.id;
END; $$;
CREATE FUNCTION public.v2_refresh_observation_target(observation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.v2_observation_targets; fallback uuid; cause uuid;
BEGIN
 SELECT * INTO t FROM public.v2_observation_targets WHERE observation_id=observation FOR UPDATE;
 IF t.assignment_id IS NULL OR public.v2_target_assignment_valid(t.assignment_id) THEN RETURN; END IF;
 SELECT id INTO fallback FROM public.v2_target_assignments WHERE observation_id=observation AND public.v2_target_assignment_valid(id) ORDER BY revision DESC LIMIT 1;
 SELECT association_decision_id INTO cause FROM public.v2_target_assignments WHERE id=t.assignment_id;
 INSERT INTO public.v2_target_events(observation_id,revision,action,assignment_id,previous_event_id,cause_association_decision_id)
   VALUES(observation,t.revision+1,'invalidate',fallback,t.latest_event_id,cause);
END; $$;
CREATE FUNCTION public.v2_refresh_targets_for_association() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 FOR item IN SELECT DISTINCT observation_id FROM public.v2_target_assignments WHERE association_decision_id=OLD.decision_id ORDER BY observation_id LOOP
   PERFORM public.v2_refresh_observation_target(item.observation_id);
 END LOOP;
 RETURN NULL;
END; $$;
CREATE TRIGGER v2_refresh_targets_for_association AFTER DELETE OR UPDATE ON public.v2_association_links
 FOR EACH ROW EXECUTE FUNCTION public.v2_refresh_targets_for_association();
CREATE FUNCTION public.v2_refresh_targets_for_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 IF NEW.last_decision_id IS NOT DISTINCT FROM OLD.last_decision_id THEN RETURN NEW; END IF;
 FOR item IN SELECT DISTINCT a.observation_id FROM public.v2_target_assignments a JOIN public.v2_association_decisions d ON d.id=a.association_decision_id
   JOIN public.v2_review_decisions r ON r.id=d.reviewer_decision_id WHERE r.case_id=NEW.id ORDER BY a.observation_id LOOP
   PERFORM public.v2_refresh_observation_target(item.observation_id);
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_refresh_targets_for_review AFTER UPDATE ON public.v2_review_cases
 FOR EACH ROW EXECUTE FUNCTION public.v2_refresh_targets_for_review();
CREATE FUNCTION public.v2_target_subject_retired() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 IF NEW.lifecycle=OLD.lifecycle THEN RETURN NEW; END IF;
 IF NEW.lifecycle='retired' THEN
   FOR item IN SELECT DISTINCT observation_id FROM public.v2_target_assignments WHERE target_subject_id=NEW.id ORDER BY observation_id LOOP
     PERFORM public.v2_refresh_observation_target(item.observation_id);
   END LOOP;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_target_subject_retired AFTER UPDATE ON public.v2_subjects
 FOR EACH ROW EXECUTE FUNCTION public.v2_target_subject_retired();

CREATE FUNCTION public.v2_target_observation_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observation uuid; subjects uuid[]; event uuid; erase boolean;
BEGIN
 IF TG_OP='INSERT' THEN
   INSERT INTO public.v2_target_events(observation_id,revision,action) VALUES(NEW.id,1,'baseline');
   RETURN NEW;
 END IF;
 erase:=TG_TABLE_NAME='v2_observations';
 IF erase THEN observation:=OLD.id; event:=gen_random_uuid();
 ELSE
   IF NEW.status=OLD.status THEN RETURN NEW; END IF;
   observation:=NEW.observation_id; event:=NEW.latest_event_id;
   PERFORM public.v2_refresh_observation_target(observation);
 END IF;
 SELECT array_agg(DISTINCT target_subject_id) INTO subjects FROM public.v2_target_assignments WHERE observation_id=observation;
 PERFORM public.v2_target_recompute_subjects(subjects,event,erase);
 IF erase THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER v2_target_observation_insert AFTER INSERT ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_target_observation_change();
CREATE TRIGGER v2_target_observation_erasure BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_target_observation_change();
CREATE TRIGGER v2_target_observation_state AFTER UPDATE ON public.v2_observation_states FOR EACH ROW EXECUTE FUNCTION public.v2_target_observation_change();

-- Projection completeness/validity is checked at commit as well as in writers.
CREATE FUNCTION public.v2_check_observation_target() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observation uuid; t public.v2_observation_targets;
BEGIN
 IF TG_TABLE_NAME='v2_observations' THEN observation:=COALESCE(NEW.id,OLD.id);
 ELSE observation:=COALESCE(NEW.observation_id,OLD.observation_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_observations WHERE id=observation) THEN RETURN NULL; END IF;
 SELECT * INTO t FROM public.v2_observation_targets WHERE observation_id=observation;
 IF t.observation_id IS NULL OR (t.assignment_id IS NOT NULL AND NOT public.v2_target_assignment_valid(t.assignment_id)) THEN
   RAISE EXCEPTION 'v2_observation_target_invalid' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_check_observation_target AFTER INSERT OR UPDATE ON public.v2_observations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_check_observation_target();
CREATE CONSTRAINT TRIGGER v2_check_observation_target AFTER INSERT OR UPDATE OR DELETE ON public.v2_observation_targets
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_check_observation_target();

DO $$ DECLARE t text; role_name text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_target_assignments','v2_target_events','v2_observation_targets'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name); END IF;
   END LOOP;
   EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
   EXECUTE format('CREATE POLICY api_server_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
   EXECUTE format('CREATE TRIGGER v2_target_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
   'v2_target_assignment_valid','v2_observation_subject','v2_target_history_immutable','v2_validate_target_assignment','v2_validate_target_event',
   'v2_guard_observation_target','v2_target_recompute_subjects','v2_project_target_event','v2_project_target_assignment',
   'v2_resolve_observation_target','v2_refresh_observation_target','v2_refresh_targets_for_association','v2_refresh_targets_for_review',
   'v2_target_subject_retired','v2_target_observation_change','v2_check_observation_target') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
   END LOOP;
 END LOOP;
END; $$;

-- Existing observations remain at their declared origin. Never infer a target
-- from an old relationship or replay historical matching decisions on upgrade.
INSERT INTO public.v2_target_events(observation_id,revision,action) SELECT id,1,'baseline' FROM public.v2_observations;

-- A fact is assessed against its explicit effective target, never both origins.
CREATE OR REPLACE FUNCTION public.v2_validate_derived_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d public.v2_field_decisions; candidate public.v2_association_candidates; previous bigint;
BEGIN
 IF TG_TABLE_NAME='v2_field_decisions' THEN
   SELECT * INTO d FROM public.v2_field_decisions WHERE id=NEW.id;
 ELSE SELECT * INTO d FROM public.v2_field_decisions WHERE id=COALESCE(NEW.field_decision_id,OLD.field_decision_id); END IF;
 IF d.id IS NULL OR d.invalidated THEN RETURN NULL; END IF;
 IF d.previous_decision_id IS NOT NULL THEN
   SELECT revision INTO previous FROM public.v2_field_decisions WHERE id=d.previous_decision_id;
   IF previous<>d.revision-1 THEN RAISE EXCEPTION 'v2_field_revision_gap' USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.v2_field_decision_evidence e JOIN public.v2_observations o ON o.id=e.observation_id
   WHERE e.field_decision_id=d.id AND (public.v2_observation_subject(o.id)<>d.subject_id OR o.field_key<>d.field_key OR o.scope_key<>d.scope_key OR o.scope<>d.scope)) THEN
   RAISE EXCEPTION 'v2_field_evidence_scope_mismatch' USING ERRCODE='23514'; END IF;
 IF d.selected_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.v2_field_decision_evidence e
   JOIN public.v2_observations o ON o.id=e.observation_id JOIN public.v2_observation_states s ON s.observation_id=o.id
   WHERE e.field_decision_id=d.id AND e.disposition='supporting' AND s.status='active' AND o.value=d.selected_value) THEN
   RAISE EXCEPTION 'v2_selected_value_requires_live_evidence' USING ERRCODE='23514'; END IF;
 IF d.reviewer_decision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.v2_review_decisions r JOIN public.v2_review_cases c ON c.id=r.case_id
   WHERE r.id=d.reviewer_decision_id AND NOT r.evidence_erased AND r.action='accept' AND c.last_decision_id=r.id AND c.state='resolved'
     AND c.kind IN ('correction','conflict') AND c.subject_id=d.subject_id AND c.field_key=d.field_key AND c.scope_key=d.scope_key) THEN
   RAISE EXCEPTION 'v2_field_review_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
