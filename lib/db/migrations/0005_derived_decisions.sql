-- Concrete decision subtypes and internal projections. No public writer or
-- confidence engine is enabled here. Owner-only apply primitives are exercised
-- in isolated tests; worker authorization/lease checks precede later grants.
CREATE FUNCTION public.v2_reason_codes_valid(codes text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(cardinality(codes)>0 AND NOT EXISTS
   (SELECT 1 FROM unnest(codes) c WHERE c IS NULL OR c !~ '^[a-z][a-z0-9_]{0,63}$'),false);
$$;
CREATE FUNCTION public.v2_relation_types_valid(relation text,source_kind text,target_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(CASE relation
   WHEN 'same_corridor' THEN source_kind IN ('lead','pattern') AND target_kind IN ('lead','pattern')
   WHEN 'same_pattern' THEN source_kind='pattern' AND target_kind='pattern'
   WHEN 'same_service' THEN (source_kind IN ('lead','actual_journey','run') AND target_kind='run')
   WHEN 'duplicate_of' THEN source_kind=target_kind
   WHEN 'variant_of' THEN source_kind='pattern' AND target_kind='pattern'
   WHEN 'contains_segment' THEN source_kind='pattern' AND target_kind='pattern'
   WHEN 'correction_of' THEN source_kind=target_kind ELSE false END,false);
$$;

CREATE TABLE public.v2_association_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 from_subject_id uuid NOT NULL, from_kind text NOT NULL,
 to_subject_id uuid NOT NULL, to_kind text NOT NULL,
 relation text NOT NULL, evidence_digest text,
 reason_codes text[] NOT NULL CHECK(public.v2_reason_codes_valid(reason_codes)),
 rule_version text NOT NULL CHECK(length(btrim(rule_version)) BETWEEN 1 AND 64),
 source_revision bigint NOT NULL CHECK(source_revision>=1), target_revision bigint NOT NULL CHECK(target_revision>=1),
 segment_start integer, segment_end integer,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','decided','obsolete')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 evidence_erased boolean NOT NULL DEFAULT false,
 last_decision_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(from_subject_id<>to_subject_id),
 CHECK(public.v2_relation_types_valid(relation,from_kind,to_kind)),
 CHECK((relation='contains_segment' AND segment_start>=0 AND segment_end>segment_start AND num_nonnulls(segment_start,segment_end)=2)
   OR (relation<>'contains_segment' AND num_nonnulls(segment_start,segment_end)=0)),
 CHECK((NOT evidence_erased AND evidence_digest ~ '^[0-9a-f]{64}$' AND evidence_digest IS NOT NULL)
   OR (evidence_erased AND evidence_digest IS NULL AND state='obsolete')),
 UNIQUE(id,from_subject_id,to_subject_id,relation),
 FOREIGN KEY(from_subject_id,from_kind) REFERENCES public.v2_subjects(id,kind),
 FOREIGN KEY(to_subject_id,to_kind) REFERENCES public.v2_subjects(id,kind)
);
CREATE UNIQUE INDEX v2_candidate_effect_idx ON public.v2_association_candidates(from_subject_id,to_subject_id,relation,rule_version,evidence_digest) WHERE state<>'obsolete';
CREATE INDEX v2_candidate_target_idx ON public.v2_association_candidates(to_subject_id);
CREATE INDEX v2_candidate_queue_idx ON public.v2_association_candidates(state,created_at);
CREATE TABLE public.v2_candidate_evidence (
 candidate_id uuid NOT NULL REFERENCES public.v2_association_candidates(id),
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 PRIMARY KEY(candidate_id,observation_id)
);
CREATE INDEX v2_candidate_observation_idx ON public.v2_candidate_evidence(observation_id);

CREATE TABLE public.v2_association_decisions (
 id uuid PRIMARY KEY,
 decision_kind text NOT NULL DEFAULT 'association' CHECK(decision_kind='association'),
 candidate_id uuid NOT NULL REFERENCES public.v2_association_candidates(id),
 action text NOT NULL CHECK(action IN ('accept','reject','reverse','defer')),
 previous_decision_id uuid,
 actor_kind text NOT NULL CHECK(actor_kind IN ('system','reviewer')),
 reviewer_decision_id uuid REFERENCES public.v2_review_decisions(id),
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
 policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 64),
 expected_from_revision bigint NOT NULL CHECK(expected_from_revision>=1),
 expected_to_revision bigint NOT NULL CHECK(expected_to_revision>=1),
 expected_candidate_revision bigint NOT NULL CHECK(expected_candidate_revision>=1),
 invalidated boolean NOT NULL DEFAULT false, erased boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,candidate_id), UNIQUE(candidate_id,expected_candidate_revision),
 CHECK((actor_kind='reviewer')=(reviewer_decision_id IS NOT NULL)),
 CHECK(action<>'reverse' OR previous_decision_id IS NOT NULL),
 CHECK(previous_decision_id IS NULL OR previous_decision_id<>id), CHECK(NOT erased OR invalidated),
 FOREIGN KEY(id,decision_kind) REFERENCES public.v2_decision_ids(id,kind) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(previous_decision_id,candidate_id) REFERENCES public.v2_association_decisions(id,candidate_id)
);
CREATE INDEX v2_association_review_idx ON public.v2_association_decisions(reviewer_decision_id);
CREATE INDEX v2_association_previous_idx ON public.v2_association_decisions(previous_decision_id);
ALTER TABLE public.v2_association_candidates ADD CONSTRAINT v2_candidate_last_decision
 FOREIGN KEY(last_decision_id,id) REFERENCES public.v2_association_decisions(id,candidate_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_candidate_last_idx ON public.v2_association_candidates(last_decision_id);
CREATE TABLE public.v2_association_links (
 candidate_id uuid PRIMARY KEY,
 from_subject_id uuid NOT NULL, to_subject_id uuid NOT NULL, relation text NOT NULL,
 decision_id uuid NOT NULL UNIQUE,
 FOREIGN KEY(candidate_id,from_subject_id,to_subject_id,relation)
   REFERENCES public.v2_association_candidates(id,from_subject_id,to_subject_id,relation),
 FOREIGN KEY(decision_id,candidate_id) REFERENCES public.v2_association_decisions(id,candidate_id),
 UNIQUE(from_subject_id,to_subject_id,relation)
);
CREATE INDEX v2_association_link_target_idx ON public.v2_association_links(to_subject_id);

CREATE TABLE public.v2_field_decisions (
 id uuid PRIMARY KEY, decision_kind text NOT NULL DEFAULT 'field' CHECK(decision_kind='field'),
 subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
 field_key text NOT NULL CHECK(field_key IN ('operator.reported','departure.reported','boarding.pickup','alighting.dropoff','fare.paid','fare.quoted','fare.advertised')),
 scope_key text NOT NULL CHECK(scope_key ~ '^[0-9a-f]{64}$'), scope jsonb,
 revision bigint NOT NULL CHECK(revision>=1),
 expected_subject_revision bigint NOT NULL CHECK(expected_subject_revision>=1),
 input_generation bigint NOT NULL CHECK(input_generation>=1),
 selected_value jsonb,
 support_status text NOT NULL CHECK(support_status IN ('unknown','reported','corroborated')),
 dispute_status text NOT NULL CHECK(dispute_status IN ('none','open','resolved')),
 freshness text NOT NULL CHECK(freshness IN ('unknown','current','recheck_due','expired')),
 publication text NOT NULL CHECK(publication IN ('provisional','selected','withheld')),
 reason_codes text[] NOT NULL CHECK(public.v2_reason_codes_valid(reason_codes)),
 policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 64),
 input_digest text, assessed_at timestamptz NOT NULL DEFAULT now(), next_recheck_at timestamptz,
 reviewer_decision_id uuid REFERENCES public.v2_review_decisions(id), previous_decision_id uuid,
 invalidated boolean NOT NULL DEFAULT false, erased boolean NOT NULL DEFAULT false,
 UNIQUE(id,subject_id,field_key,scope_key), UNIQUE(subject_id,field_key,scope_key,revision),
 UNIQUE(subject_id,field_key,scope_key,policy_version,input_digest),
 CHECK((revision=1)=(previous_decision_id IS NULL)),
 CHECK(previous_decision_id IS NULL OR previous_decision_id<>id),
 CHECK(next_recheck_at IS NULL OR next_recheck_at>assessed_at),
 CHECK((erased AND invalidated AND selected_value IS NULL AND scope IS NULL AND input_digest IS NULL)
   OR (NOT erased AND jsonb_typeof(scope)='object' AND scope IS NOT NULL AND input_digest ~ '^[0-9a-f]{64}$' AND input_digest IS NOT NULL)),
 CHECK(erased OR ((support_status='unknown')=(selected_value IS NULL))),
 CHECK(selected_value IS NULL OR public.v2_intake_observation_valid(field_key,selected_value,scope) IS TRUE),
 CHECK(publication<>'selected' OR (selected_value IS NOT NULL AND dispute_status<>'open' AND freshness='current')),
 CHECK(dispute_status<>'resolved' OR reviewer_decision_id IS NOT NULL),
 -- Until source groups/freshness policy are implemented, storage cannot claim
 -- corroboration, currentness or a selected publication from an arbitrary row.
 CONSTRAINT v2_field_policy_ready CHECK(support_status IN ('unknown','reported') AND freshness='unknown' AND publication IN ('provisional','withheld')),
 FOREIGN KEY(id,decision_kind) REFERENCES public.v2_decision_ids(id,kind) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(previous_decision_id,subject_id,field_key,scope_key) REFERENCES public.v2_field_decisions(id,subject_id,field_key,scope_key)
);
CREATE INDEX v2_field_review_idx ON public.v2_field_decisions(reviewer_decision_id);
CREATE INDEX v2_field_previous_idx ON public.v2_field_decisions(previous_decision_id);
CREATE TABLE public.v2_field_decision_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 field_decision_id uuid NOT NULL REFERENCES public.v2_field_decisions(id),
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 disposition text NOT NULL CHECK(disposition IN ('supporting','conflicting','excluded')),
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
 erased boolean NOT NULL DEFAULT false,
 CHECK((observation_id IS NULL)=erased), UNIQUE(field_decision_id,observation_id)
);
CREATE INDEX v2_field_evidence_observation_idx ON public.v2_field_decision_evidence(observation_id);
CREATE TABLE public.v2_current_fields (
 subject_id uuid NOT NULL, field_key text NOT NULL, scope_key text NOT NULL,
 field_decision_id uuid NOT NULL UNIQUE, generation bigint NOT NULL CHECK(generation>=1),
 PRIMARY KEY(subject_id,field_key,scope_key),
 FOREIGN KEY(field_decision_id,subject_id,field_key,scope_key) REFERENCES public.v2_field_decisions(id,subject_id,field_key,scope_key)
);
CREATE TABLE public.v2_subject_revisions (
 subject_id uuid NOT NULL, subject_kind text NOT NULL, revision bigint NOT NULL CHECK(revision>=1),
 snapshot jsonb, origin_kind text NOT NULL CHECK(origin_kind IN ('decision','contribution','erased')),
 decision_id uuid, decision_kind text CHECK(decision_kind IN ('field','association')),
 initial_contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(subject_id,revision),
 FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind),
 FOREIGN KEY(decision_id,decision_kind) REFERENCES public.v2_decision_ids(id,kind),
 CHECK((origin_kind='erased' AND snapshot IS NULL AND num_nonnulls(decision_id,decision_kind,initial_contribution_id)=0)
   OR (origin_kind='decision' AND snapshot IS NOT NULL AND num_nonnulls(decision_id,decision_kind)=2 AND initial_contribution_id IS NULL)
   OR (origin_kind='contribution' AND snapshot IS NOT NULL AND decision_id IS NULL AND decision_kind IS NULL AND initial_contribution_id IS NOT NULL)),
 CHECK(snapshot IS NULL OR (jsonb_typeof(snapshot)='object' AND snapshot ?& ARRAY['kind','data'] AND snapshot-ARRAY['kind','data']='{}'::jsonb
   AND snapshot->>'kind'=subject_kind AND jsonb_typeof(snapshot->'data')='object'))
);
CREATE INDEX v2_subject_revision_decision_idx ON public.v2_subject_revisions(decision_id);
CREATE INDEX v2_subject_revision_contribution_idx ON public.v2_subject_revisions(initial_contribution_id);

ALTER TABLE public.v2_decision_ids DROP CONSTRAINT v2_decision_kind;
ALTER TABLE public.v2_decision_ids ADD CONSTRAINT v2_decision_kind CHECK(kind IN ('review','field','association'));
CREATE OR REPLACE FUNCTION public.v2_require_decision_subtype() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target uuid; registry_kind text; present boolean;
BEGIN
 target:=COALESCE(NEW.id,OLD.id);
 SELECT kind INTO registry_kind FROM public.v2_decision_ids WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 CASE registry_kind
 WHEN 'review' THEN SELECT EXISTS(SELECT 1 FROM public.v2_review_decisions WHERE id=target) INTO present;
 WHEN 'field' THEN SELECT EXISTS(SELECT 1 FROM public.v2_field_decisions WHERE id=target) INTO present;
 WHEN 'association' THEN SELECT EXISTS(SELECT 1 FROM public.v2_association_decisions WHERE id=target) INTO present;
 ELSE present:=false; END CASE;
 IF NOT present THEN RAISE EXCEPTION 'v2_decision_requires_subtype' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_field_subtype AFTER INSERT OR UPDATE OR DELETE ON public.v2_field_decisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_decision_subtype();
CREATE CONSTRAINT TRIGGER v2_association_subtype AFTER INSERT OR UPDATE OR DELETE ON public.v2_association_decisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_decision_subtype();

CREATE FUNCTION public.v2_derived_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE removable text[];
BEGIN
 IF pg_trigger_depth()>1 AND TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='v2_field_decisions' THEN
     removable:=ARRAY['invalidated','erased','scope','selected_value','input_digest'];
     IF (NOT OLD.invalidated OR NEW.invalidated) AND (NOT OLD.erased OR NEW.erased)
       AND (NEW.erased OR (NEW.scope IS NOT DISTINCT FROM OLD.scope AND NEW.selected_value IS NOT DISTINCT FROM OLD.selected_value AND NEW.input_digest IS NOT DISTINCT FROM OLD.input_digest))
       AND to_jsonb(NEW)-removable=to_jsonb(OLD)-removable THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='v2_association_decisions' THEN
     IF (NOT OLD.invalidated OR NEW.invalidated) AND (NOT OLD.erased OR NEW.erased)
       AND to_jsonb(NEW)-ARRAY['invalidated','erased']=to_jsonb(OLD)-ARRAY['invalidated','erased'] THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='v2_field_decision_evidence' THEN
     IF NEW.observation_id IS NULL AND OLD.observation_id IS NOT NULL
       AND to_jsonb(NEW)-'observation_id'=to_jsonb(OLD)-'observation_id' THEN NEW.erased:=true; RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='v2_subject_revisions' THEN
     IF NEW.origin_kind='erased' AND NEW.snapshot IS NULL AND num_nonnulls(NEW.decision_id,NEW.decision_kind,NEW.initial_contribution_id)=0
       AND to_jsonb(NEW)-ARRAY['origin_kind','snapshot','decision_id','decision_kind','initial_contribution_id']=to_jsonb(OLD)-ARRAY['origin_kind','snapshot','decision_id','decision_kind','initial_contribution_id'] THEN RETURN NEW; END IF;
   END IF;
 ELSIF pg_trigger_depth()>1 AND TG_OP='DELETE' AND TG_TABLE_NAME='v2_candidate_evidence' THEN RETURN OLD;
 END IF;
 RAISE EXCEPTION 'v2_append_derived_history_instead' USING ERRCODE='23514';
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_field_decisions','v2_association_decisions','v2_field_decision_evidence','v2_candidate_evidence','v2_subject_revisions'] LOOP
   EXECUTE format('CREATE TRIGGER v2_derived_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_derived_immutable()',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.v2_transport_snapshot(subject uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE kind text; table_name text; data jsonb;
BEGIN
 SELECT s.kind INTO kind FROM public.v2_subjects s WHERE s.id=subject;
 table_name:=CASE kind WHEN 'lead' THEN 'v2_leads' WHEN 'operator' THEN 'v2_operators' WHEN 'route' THEN 'v2_routes'
   WHEN 'stop' THEN 'v2_stops' WHEN 'pattern' THEN 'v2_patterns' WHEN 'service_plan' THEN 'v2_service_plans'
   WHEN 'run' THEN 'v2_runs' WHEN 'actual_journey' THEN 'v2_actual_journeys' END;
 IF table_name IS NULL THEN RAISE EXCEPTION 'v2_snapshot_subject_missing' USING ERRCODE='23503'; END IF;
 EXECUTE format('SELECT to_jsonb(t)-ARRAY[''initial_contribution_id'',''original_origin_text'',''original_destination_text''] FROM public.%I t WHERE subject_id=$1',table_name) INTO data USING subject;
 IF data IS NULL THEN RAISE EXCEPTION 'v2_snapshot_subtype_missing' USING ERRCODE='23503'; END IF;
 RETURN jsonb_build_object('kind',kind,'data',data);
END; $$;
CREATE FUNCTION public.v2_validate_subject_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.revision IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=NEW.subject_id)
   OR NEW.snapshot IS DISTINCT FROM public.v2_transport_snapshot(NEW.subject_id) THEN
   RAISE EXCEPTION 'v2_snapshot_must_describe_current_projection' USING ERRCODE='23514'; END IF;
 IF NEW.origin_kind='contribution' THEN
   IF NOT EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=NEW.subject_id AND initial_contribution_id=NEW.initial_contribution_id)
      OR NEW.revision<>1 THEN RAISE EXCEPTION 'v2_initial_snapshot_origin_mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.origin_kind='decision' THEN
   IF NOT EXISTS(SELECT 1 FROM public.v2_field_decisions WHERE id=NEW.decision_id AND subject_id=NEW.subject_id AND NOT invalidated)
     AND NOT EXISTS(SELECT 1 FROM public.v2_association_decisions d JOIN public.v2_association_candidates c ON c.id=d.candidate_id
       WHERE d.id=NEW.decision_id AND NEW.subject_id IN (c.from_subject_id,c.to_subject_id) AND NOT d.invalidated) THEN
     RAISE EXCEPTION 'v2_snapshot_decision_subject_mismatch' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'v2_new_snapshot_requires_origin' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_snapshot_validate BEFORE INSERT ON public.v2_subject_revisions FOR EACH ROW EXECUTE FUNCTION public.v2_validate_subject_revision();

CREATE FUNCTION public.v2_validate_derived_evidence() RETURNS trigger
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
   WHERE e.field_decision_id=d.id AND (o.original_subject_id<>d.subject_id OR o.field_key<>d.field_key OR o.scope_key<>d.scope_key OR o.scope<>d.scope)) THEN
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
CREATE CONSTRAINT TRIGGER v2_field_evidence_valid AFTER INSERT OR UPDATE ON public.v2_field_decisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_validate_derived_evidence();
CREATE CONSTRAINT TRIGGER v2_field_evidence_valid AFTER INSERT OR UPDATE OR DELETE ON public.v2_field_decision_evidence
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_validate_derived_evidence();

CREATE FUNCTION public.v2_candidate_evidence_valid() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.v2_association_candidates c JOIN public.v2_observations o
   ON o.original_subject_id IN (c.from_subject_id,c.to_subject_id) WHERE c.id=NEW.candidate_id AND o.id=NEW.observation_id AND c.state='pending'
     AND NOT EXISTS(SELECT 1 FROM public.v2_association_decisions WHERE candidate_id=c.id)) THEN
   RAISE EXCEPTION 'v2_candidate_evidence_target_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_candidate_evidence_valid BEFORE INSERT ON public.v2_candidate_evidence FOR EACH ROW EXECUTE FUNCTION public.v2_candidate_evidence_valid();

CREATE FUNCTION public.v2_candidate_content_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF to_jsonb(NEW)-ARRAY['state','revision','last_decision_id','evidence_erased','evidence_digest']
     <>to_jsonb(OLD)-ARRAY['state','revision','last_decision_id','evidence_erased','evidence_digest']
   OR (OLD.evidence_erased AND NOT NEW.evidence_erased)
   OR (NEW.evidence_digest IS DISTINCT FROM OLD.evidence_digest AND NOT (pg_trigger_depth()>1 AND NEW.evidence_erased AND NEW.evidence_digest IS NULL)) THEN
   RAISE EXCEPTION 'v2_candidate_content_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_candidate_content_immutable BEFORE UPDATE ON public.v2_association_candidates FOR EACH ROW EXECUTE FUNCTION public.v2_candidate_content_immutable();

CREATE FUNCTION public.v2_validate_current_decision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='v2_current_fields' THEN
   IF EXISTS(SELECT 1 FROM public.v2_current_fields f JOIN public.v2_field_decisions d ON d.id=f.field_decision_id
     JOIN public.v2_subjects s ON s.id=f.subject_id WHERE f.subject_id=NEW.subject_id AND f.field_key=NEW.field_key AND f.scope_key=NEW.scope_key
       AND (d.invalidated OR f.generation<>s.input_generation OR d.input_generation<>f.generation)) THEN
     RAISE EXCEPTION 'v2_current_field_stale' USING ERRCODE='23514'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM public.v2_association_links l JOIN public.v2_association_decisions d ON d.id=l.decision_id
     JOIN public.v2_association_candidates c ON c.id=l.candidate_id WHERE l.candidate_id=NEW.candidate_id
       AND (d.action<>'accept' OR d.invalidated OR c.last_decision_id<>d.id OR c.last_decision_id IS NULL OR c.state<>'decided')) THEN
     RAISE EXCEPTION 'v2_current_association_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_current_field_valid AFTER INSERT OR UPDATE ON public.v2_current_fields
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_validate_current_decision();
CREATE CONSTRAINT TRIGGER v2_current_association_valid AFTER INSERT OR UPDATE ON public.v2_association_links
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_validate_current_decision();

CREATE FUNCTION public.v2_apply_field_decision(decision uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d public.v2_field_decisions; subject public.v2_subjects;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO d FROM public.v2_field_decisions WHERE id=decision;
 IF NOT FOUND OR d.invalidated THEN RAISE EXCEPTION 'v2_field_decision_unavailable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_current_fields WHERE field_decision_id=decision) THEN RETURN; END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=d.subject_id FOR UPDATE;
 IF subject.revision<>d.expected_subject_revision OR subject.input_generation<>d.input_generation
   OR EXISTS(SELECT 1 FROM public.v2_field_decisions WHERE subject_id=d.subject_id AND field_key=d.field_key AND scope_key=d.scope_key AND revision>d.revision) THEN
   RAISE EXCEPTION 'v2_field_input_revision_conflict' USING ERRCODE='40001'; END IF;
 SET CONSTRAINTS public.v2_field_evidence_valid IMMEDIATE;
 SET CONSTRAINTS public.v2_field_evidence_valid DEFERRED;
 INSERT INTO public.v2_current_fields VALUES(d.subject_id,d.field_key,d.scope_key,d.id,d.input_generation)
   ON CONFLICT(subject_id,field_key,scope_key) DO UPDATE SET field_decision_id=excluded.field_decision_id,generation=excluded.generation;
 UPDATE public.v2_subjects SET revision=revision+1 WHERE id=d.subject_id;
 INSERT INTO public.v2_subject_revisions(subject_id,subject_kind,revision,snapshot,origin_kind,decision_id,decision_kind)
   SELECT id,kind,revision,public.v2_transport_snapshot(id),'decision',d.id,'field' FROM public.v2_subjects WHERE id=d.subject_id;
END; $$;

CREATE FUNCTION public.v2_apply_association_decision(decision uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d public.v2_association_decisions; c public.v2_association_candidates; r public.v2_review_decisions; review_subject uuid;
 source public.v2_subjects; target public.v2_subjects; source_corridor uuid; target_corridor uuid; s record;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO d FROM public.v2_association_decisions WHERE id=decision;
 IF NOT FOUND OR d.invalidated THEN RAISE EXCEPTION 'v2_association_decision_unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM public.v2_association_candidates WHERE id=d.candidate_id FOR UPDATE;
 IF c.last_decision_id=d.id THEN RETURN; END IF;
 PERFORM 1 FROM public.v2_subjects WHERE id IN (c.from_subject_id,c.to_subject_id) ORDER BY id FOR UPDATE;
 SELECT * INTO source FROM public.v2_subjects WHERE id=c.from_subject_id;
 SELECT * INTO target FROM public.v2_subjects WHERE id=c.to_subject_id;
 IF c.state='obsolete' OR c.revision<>d.expected_candidate_revision OR source.revision<>d.expected_from_revision OR target.revision<>d.expected_to_revision
   OR c.last_decision_id IS DISTINCT FROM d.previous_decision_id THEN
   RAISE EXCEPTION 'v2_association_input_revision_conflict' USING ERRCODE='40001'; END IF;
 IF d.actor_kind='system' AND d.action IN ('accept','reverse') AND c.relation<>'same_corridor' THEN
   RAISE EXCEPTION 'v2_identity_requires_review' USING ERRCODE='42501'; END IF;
 IF d.actor_kind='reviewer' THEN
   SELECT * INTO r FROM public.v2_review_decisions WHERE id=d.reviewer_decision_id;
   SELECT subject_id INTO review_subject FROM public.v2_review_cases WHERE id=r.case_id AND last_decision_id=r.id AND kind='identity';
   IF r.evidence_erased OR review_subject IS NULL OR review_subject NOT IN (c.from_subject_id,c.to_subject_id)
     OR (d.action='accept' AND r.action<>'accept') OR (d.action='reverse' AND r.action<>'reverse')
     OR (d.action='reject' AND r.action<>'reject') OR (d.action='defer' AND r.action<>'needs_context') THEN
     RAISE EXCEPTION 'v2_association_review_mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF d.action='accept' THEN
   IF c.state<>'pending' THEN RAISE EXCEPTION 'v2_candidate_requires_reopening' USING ERRCODE='23514'; END IF;
   IF (c.source_revision<>source.revision AND NOT COALESCE(review_subject=source.id AND r.expected_subject_revision=c.source_revision AND source.revision=r.expected_subject_revision+1,false))
     OR (c.target_revision<>target.revision AND NOT COALESCE(review_subject=target.id AND r.expected_subject_revision=c.target_revision AND target.revision=r.expected_subject_revision+1,false)) THEN
     RAISE EXCEPTION 'v2_candidate_evidence_stale' USING ERRCODE='40001'; END IF;
   IF c.relation='same_corridor' THEN
     SELECT corridor_id INTO source_corridor FROM (SELECT subject_id,corridor_id FROM public.v2_leads UNION ALL SELECT subject_id,corridor_id FROM public.v2_patterns) q WHERE subject_id=source.id;
     SELECT corridor_id INTO target_corridor FROM (SELECT subject_id,corridor_id FROM public.v2_leads UNION ALL SELECT subject_id,corridor_id FROM public.v2_patterns) q WHERE subject_id=target.id;
     IF source_corridor IS NULL OR source_corridor IS DISTINCT FROM target_corridor THEN RAISE EXCEPTION 'v2_corridor_mismatch' USING ERRCODE='23514'; END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM public.v2_candidate_evidence e JOIN public.v2_observation_states o ON o.observation_id=e.observation_id WHERE e.candidate_id=c.id AND o.status='active') THEN
     RAISE EXCEPTION 'v2_association_live_evidence_required' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM public.v2_candidate_evidence e JOIN public.v2_observation_states o ON o.observation_id=e.observation_id WHERE e.candidate_id=c.id AND o.status<>'active') THEN
     RAISE EXCEPTION 'v2_candidate_evidence_inactive' USING ERRCODE='23514'; END IF;
   IF d.actor_kind='reviewer' AND EXISTS(SELECT 1 FROM public.v2_candidate_evidence e WHERE e.candidate_id=c.id
     AND NOT EXISTS(SELECT 1 FROM public.v2_review_decision_evidence re WHERE re.decision_id=r.id AND re.observation_id=e.observation_id)) THEN
     RAISE EXCEPTION 'v2_candidate_evidence_not_reviewed' USING ERRCODE='23514'; END IF;
   IF c.relation='contains_segment' AND NOT EXISTS(SELECT 1 FROM public.v2_patterns p JOIN public.v2_pattern_stops s
     ON s.pattern_subject_id=p.subject_id AND s.pattern_version=p.current_pattern_version
     WHERE p.subject_id=c.from_subject_id GROUP BY p.subject_id HAVING min(s.sequence)<=c.segment_start AND max(s.sequence)>=c.segment_end) THEN
     RAISE EXCEPTION 'v2_segment_out_of_bounds' USING ERRCODE='23514'; END IF;
   INSERT INTO public.v2_association_links VALUES(c.id,c.from_subject_id,c.to_subject_id,c.relation,d.id);
 ELSIF d.action='reverse' THEN
   IF NOT EXISTS(SELECT 1 FROM public.v2_association_decisions WHERE id=d.previous_decision_id AND action='accept')
     OR (d.actor_kind='reviewer' AND r.reverses_decision_id IS DISTINCT FROM (SELECT reviewer_decision_id FROM public.v2_association_decisions WHERE id=d.previous_decision_id)) THEN
     RAISE EXCEPTION 'v2_reverse_accepted_association_required' USING ERRCODE='23514'; END IF;
   DELETE FROM public.v2_association_links WHERE candidate_id=c.id AND decision_id=d.previous_decision_id;
 END IF;
 UPDATE public.v2_association_candidates SET last_decision_id=d.id,revision=revision+1,
   state=CASE WHEN d.action IN ('reverse','defer') THEN 'pending' ELSE 'decided' END WHERE id=c.id;
 FOR s IN UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1
   WHERE id IN (c.from_subject_id,c.to_subject_id) RETURNING * LOOP
   INSERT INTO public.v2_subject_revisions(subject_id,subject_kind,revision,snapshot,origin_kind,decision_id,decision_kind)
     VALUES(s.id,s.kind,s.revision,public.v2_transport_snapshot(s.id),'decision',d.id,'association');
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     VALUES('assess',s.id,s.input_generation,d.policy_version,d.id);
 END LOOP;
END; $$;

-- Invalidation is synchronous. No stale value/link waits for a running worker.
CREATE FUNCTION public.v2_invalidate_derived(seed uuid[],erase boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[]; subjects uuid[]; item uuid; event uuid:=gen_random_uuid();
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 WITH RECURSIVE edges(child,parent) AS (
   SELECT id,previous_decision_id FROM public.v2_field_decisions UNION ALL SELECT id,reviewer_decision_id FROM public.v2_field_decisions
   UNION ALL SELECT id,previous_decision_id FROM public.v2_association_decisions UNION ALL SELECT id,reviewer_decision_id FROM public.v2_association_decisions
 ), affected(id) AS (SELECT unnest(seed) UNION SELECT e.child FROM edges e JOIN affected a ON e.parent=a.id)
 SELECT array_agg(id) INTO ids FROM affected WHERE id IN
   (SELECT id FROM public.v2_field_decisions WHERE NOT invalidated OR (erase AND NOT erased)
    UNION SELECT id FROM public.v2_association_decisions WHERE NOT invalidated OR (erase AND NOT erased));
 IF ids IS NULL THEN RETURN; END IF;
 SELECT array_agg(DISTINCT id) INTO subjects FROM (
   SELECT subject_id id FROM public.v2_field_decisions WHERE id=ANY(ids)
   UNION SELECT c.from_subject_id FROM public.v2_association_candidates c JOIN public.v2_association_decisions d ON d.candidate_id=c.id WHERE d.id=ANY(ids)
   UNION SELECT c.to_subject_id FROM public.v2_association_candidates c JOIN public.v2_association_decisions d ON d.candidate_id=c.id WHERE d.id=ANY(ids)
 ) q;
 UPDATE public.v2_field_decisions SET invalidated=true,erased=erased OR erase,
   scope=CASE WHEN erase THEN NULL ELSE scope END,selected_value=CASE WHEN erase THEN NULL ELSE selected_value END,input_digest=CASE WHEN erase THEN NULL ELSE input_digest END WHERE id=ANY(ids);
 UPDATE public.v2_association_decisions SET invalidated=true,erased=erased OR erase WHERE id=ANY(ids);
 DELETE FROM public.v2_current_fields WHERE field_decision_id=ANY(ids);
 DELETE FROM public.v2_association_links WHERE decision_id=ANY(ids);
 IF erase THEN
   UPDATE public.v2_subject_revisions SET origin_kind='erased',snapshot=NULL,decision_id=NULL,decision_kind=NULL,initial_contribution_id=NULL WHERE subject_id=ANY(subjects);
 END IF;
 FOREACH item IN ARRAY subjects LOOP
   UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=item;
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     SELECT CASE WHEN erase THEN 'erase_recompute' ELSE 'assess' END,id,input_generation,'derived/1',event FROM public.v2_subjects WHERE id=item;
 END LOOP;
END; $$;

CREATE FUNCTION public.v2_derived_observation_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observation uuid; decisions uuid[]; candidates uuid[]; erase boolean;
BEGIN
 erase:=TG_TABLE_NAME='v2_observations';
 IF erase THEN observation:=OLD.id;
 ELSE
   IF NEW.status='active' OR NEW.status=OLD.status THEN RETURN NEW; END IF;
   observation:=NEW.observation_id;
 END IF;
 SELECT array_agg(candidate_id) INTO candidates FROM public.v2_candidate_evidence WHERE observation_id=observation;
 SELECT array_agg(id) INTO decisions FROM (
   SELECT field_decision_id id FROM public.v2_field_decision_evidence WHERE observation_id=observation
   UNION SELECT id FROM public.v2_association_decisions WHERE candidate_id=ANY(candidates)
 ) q;
 PERFORM public.v2_invalidate_derived(decisions,erase);
 UPDATE public.v2_association_candidates SET state='obsolete',evidence_erased=evidence_erased OR erase,
   evidence_digest=CASE WHEN erase THEN NULL ELSE evidence_digest END WHERE id=ANY(candidates);
 IF erase THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER v2_derived_observation_erasure BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_derived_observation_change();
CREATE TRIGGER v2_derived_observation_state AFTER UPDATE ON public.v2_observation_states FOR EACH ROW EXECUTE FUNCTION public.v2_derived_observation_change();
CREATE TRIGGER v2_derived_state_lock BEFORE INSERT OR UPDATE OR DELETE ON public.v2_observation_states FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport();

CREATE FUNCTION public.v2_derived_review_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.action='reverse' THEN PERFORM public.v2_invalidate_derived(ARRAY[NEW.reverses_decision_id],false);
 ELSIF TG_OP='UPDATE' AND NEW.evidence_erased AND NOT OLD.evidence_erased THEN PERFORM public.v2_invalidate_derived(ARRAY[NEW.id],true); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_derived_review_change AFTER INSERT OR UPDATE ON public.v2_review_decisions FOR EACH ROW EXECUTE FUNCTION public.v2_derived_review_change();
CREATE FUNCTION public.v2_clear_stale_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.input_generation<>OLD.input_generation THEN DELETE FROM public.v2_current_fields WHERE subject_id=NEW.id AND generation<>NEW.input_generation; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_clear_stale_fields AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_clear_stale_fields();
CREATE FUNCTION public.v2_erase_subject_snapshots() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_subject_revisions SET origin_kind='erased',snapshot=NULL,decision_id=NULL,decision_kind=NULL,initial_contribution_id=NULL WHERE subject_id=OLD.original_subject_id;
 RETURN OLD;
END; $$;
CREATE TRIGGER v2_erase_subject_snapshots BEFORE DELETE ON public.v2_contributions FOR EACH ROW EXECUTE FUNCTION public.v2_erase_subject_snapshots();

DO $$ DECLARE t text; role_name text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_association_candidates','v2_candidate_evidence','v2_association_decisions','v2_association_links',
   'v2_field_decisions','v2_field_decision_evidence','v2_current_fields','v2_subject_revisions'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
   END LOOP;
   EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
   EXECUTE format('CREATE POLICY api_server_access ON public.%I FOR ALL TO mabhazi_api USING(true) WITH CHECK(true)',t);
   EXECUTE format('CREATE TRIGGER v2_derived_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 -- All new processing helpers are owner-only until the actual worker path is
 -- implemented, with lease/actor authorization. Trigger helpers remain usable.
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
   'v2_apply_field_decision','v2_apply_association_decision','v2_invalidate_derived','v2_transport_snapshot',
   'v2_derived_observation_change','v2_derived_review_change','v2_clear_stale_fields','v2_erase_subject_snapshots') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
   END LOOP;
 END LOOP;
END; $$;
