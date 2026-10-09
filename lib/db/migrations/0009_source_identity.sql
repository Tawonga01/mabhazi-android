-- Reviewed source identity is separate from transport identity. No automatic
-- grouping by text, fingerprint, account, citations, operator or URL fetching.
CREATE TABLE public.v2_source_graph (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1)
);
INSERT INTO public.v2_source_graph DEFAULT VALUES;
CREATE TABLE public.v2_source_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_a uuid REFERENCES public.v2_sources(id),
 source_b uuid REFERENCES public.v2_sources(id),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 last_decision_id uuid,
 erased boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_a,source_b),
 CHECK((NOT erased AND source_a IS NOT NULL AND source_b IS NOT NULL AND source_a<source_b)
   OR (erased AND source_a IS NULL AND source_b IS NULL AND last_decision_id IS NULL))
);
ALTER TABLE public.v2_decision_ids DROP CONSTRAINT v2_decision_kind;
ALTER TABLE public.v2_decision_ids ADD CONSTRAINT v2_decision_kind CHECK(kind IN ('review','field','association','source'));
CREATE TABLE public.v2_source_decisions (
 id uuid PRIMARY KEY,
 registry_kind text NOT NULL DEFAULT 'source' CHECK(registry_kind='source'),
 case_id uuid NOT NULL REFERENCES public.v2_source_cases(id),
 action text NOT NULL CHECK(action IN ('same_origin','suspected_same_origin','separate','reverse')),
 expected_revision bigint NOT NULL CHECK(expected_revision>=1),
 expected_graph_revision bigint NOT NULL CHECK(expected_graph_revision>=1),
 previous_decision_id uuid,
 reverses_decision_id uuid,
 actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 actor_erased boolean NOT NULL DEFAULT false,
 evidence_erased boolean NOT NULL DEFAULT false,
 request_id uuid NOT NULL,
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
 private_reason text CHECK(length(private_reason)<=4000),
 policy_version text NOT NULL CHECK(policy_version ~ '^[a-z][a-z0-9_/-]{0,63}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(id,registry_kind) REFERENCES public.v2_decision_ids(id,kind) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(id,case_id), UNIQUE(case_id,expected_revision), UNIQUE(actor_user_id,request_id),
 FOREIGN KEY(previous_decision_id,case_id) REFERENCES public.v2_source_decisions(id,case_id),
 FOREIGN KEY(reverses_decision_id,case_id) REFERENCES public.v2_source_decisions(id,case_id),
 CHECK((action='reverse')=(reverses_decision_id IS NOT NULL)),
 CHECK((actor_user_id IS NULL)=actor_erased),
 CHECK(NOT evidence_erased OR private_reason IS NULL)
);
ALTER TABLE public.v2_source_cases ADD CONSTRAINT v2_source_case_last
 FOREIGN KEY(last_decision_id,id) REFERENCES public.v2_source_decisions(id,case_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_source_case_b_idx ON public.v2_source_cases(source_b);
CREATE INDEX v2_source_decision_actor_idx ON public.v2_source_decisions(actor_user_id);
CREATE TABLE public.v2_source_relations (
 case_id uuid PRIMARY KEY REFERENCES public.v2_source_cases(id),
 source_a uuid NOT NULL REFERENCES public.v2_sources(id),
 source_b uuid NOT NULL REFERENCES public.v2_sources(id),
 decision_id uuid NOT NULL,
 relation text NOT NULL CHECK(relation IN ('same_origin','suspected_same_origin')),
 CHECK(source_a<source_b), UNIQUE(source_a,source_b),
 FOREIGN KEY(decision_id,case_id) REFERENCES public.v2_source_decisions(id,case_id)
);
CREATE INDEX v2_source_relation_b_idx ON public.v2_source_relations(source_b);

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
 WHEN 'source' THEN SELECT EXISTS(SELECT 1 FROM public.v2_source_decisions WHERE id=target) INTO present;
 ELSE present:=false; END CASE;
 IF NOT present THEN RAISE EXCEPTION 'v2_decision_requires_subtype' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_source_subtype AFTER INSERT OR UPDATE OR DELETE ON public.v2_source_decisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_decision_subtype();

-- UNION, not UNION ALL, terminates cycles. Each original source starts separate.
CREATE FUNCTION public.v2_source_component(seeds uuid[]) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH RECURSIVE members(id) AS (
   SELECT id FROM public.v2_sources WHERE id=ANY(seeds)
   UNION SELECT CASE WHEN r.source_a=m.id THEN r.source_b ELSE r.source_a END
   FROM members m JOIN public.v2_source_relations r ON (r.source_a=m.id OR r.source_b=m.id) AND r.relation='same_origin'
 ) SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[]) FROM members;
$$;
CREATE FUNCTION public.v2_source_footprint(observation uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('graphRevision',g.revision::text,
   'known',EXISTS(SELECT 1 FROM public.v2_observation_states WHERE observation_id=observation AND status='active')
     AND count(s.id)>0 AND COALESCE(bool_and(s.kind IN ('firsthand','document','operator_statement')),false),
   'sourceIds',COALESCE(jsonb_agg(s.id ORDER BY s.id) FILTER(WHERE s.id IS NOT NULL),'[]'::jsonb),
   'groups',COALESCE(jsonb_agg(DISTINCT (public.v2_source_component(ARRAY[s.id]))[1]) FILTER(WHERE s.id IS NOT NULL),'[]'::jsonb))
 FROM public.v2_source_graph g LEFT JOIN public.v2_observation_sources os ON os.observation_id=observation
 LEFT JOIN public.v2_sources s ON s.id=os.source_id GROUP BY g.revision;
$$;

-- Invoked from triggers: invalidation is synchronous; assessment is durable work.
-- Include whole components before a split and all historical destinations before
-- invalidation can revert an observation target. No private payload enters jobs.
CREATE FUNCTION public.v2_source_changed(seeds uuid[],extra_observations uuid[],erase boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE members uuid[]; observations uuid[]; candidates uuid[]; decisions uuid[]; subjects uuid[];
BEGIN
 members:=public.v2_source_component(seeds);
 SELECT array_agg(DISTINCT id) INTO observations FROM (
   SELECT observation_id id FROM public.v2_observation_sources WHERE source_id=ANY(members)
   UNION SELECT unnest(extra_observations)) q;
 SELECT array_agg(DISTINCT id) INTO subjects FROM (
   SELECT original_subject_id id FROM public.v2_observations WHERE id=ANY(observations)
   UNION SELECT public.v2_observation_subject(id) FROM public.v2_observations WHERE id=ANY(observations)
   UNION SELECT target_subject_id FROM public.v2_target_assignments WHERE observation_id=ANY(observations)) q;
 SELECT array_agg(DISTINCT candidate_id) INTO candidates FROM public.v2_candidate_evidence WHERE observation_id=ANY(observations);
 SELECT array_agg(DISTINCT id) INTO decisions FROM (
   SELECT field_decision_id id FROM public.v2_field_decision_evidence WHERE observation_id=ANY(observations)
   UNION SELECT id FROM public.v2_association_decisions WHERE candidate_id=ANY(candidates)) q;
 IF erase THEN
   -- Transport-review rationale can quote private source material even when the
   -- observation survives source-only deletion. Redact the whole quoting case.
   UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE case_id IN
     (SELECT d.case_id FROM public.v2_review_decisions d JOIN public.v2_review_decision_evidence e ON e.decision_id=d.id
       WHERE e.observation_id=ANY(observations));
   UPDATE public.v2_review_cases c SET state='reopened',revision=revision+1 WHERE EXISTS
     (SELECT 1 FROM public.v2_review_decisions d WHERE d.id=c.last_decision_id AND d.evidence_erased)
     AND c.id IN (SELECT d.case_id FROM public.v2_review_decisions d JOIN public.v2_review_decision_evidence e ON e.decision_id=d.id
       WHERE e.observation_id=ANY(observations));
 END IF;
 PERFORM public.v2_invalidate_derived(decisions,erase);
 UPDATE public.v2_association_candidates SET state='obsolete',evidence_erased=evidence_erased OR erase,
   evidence_digest=CASE WHEN erase THEN NULL ELSE evidence_digest END WHERE id=ANY(candidates);
 PERFORM public.v2_target_recompute_subjects(subjects,gen_random_uuid(),erase);
 UPDATE public.v2_source_graph SET revision=revision+1 WHERE id;
END; $$;

CREATE FUNCTION public.v2_source_decision_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF pg_trigger_depth()>1 AND TG_OP='UPDATE' THEN
   IF NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
     AND to_jsonb(NEW)-'actor_user_id'=to_jsonb(OLD)-'actor_user_id' THEN
     NEW.actor_erased:=true; NEW.private_reason:=NULL; RETURN NEW;
   END IF;
   IF (NOT OLD.evidence_erased OR NEW.evidence_erased) AND NEW.private_reason IS NULL
     AND to_jsonb(NEW)-ARRAY['evidence_erased','private_reason']=to_jsonb(OLD)-ARRAY['evidence_erased','private_reason'] THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'v2_source_history_immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_source_decision_immutable BEFORE UPDATE OR DELETE ON public.v2_source_decisions
 FOR EACH ROW EXECUTE FUNCTION public.v2_source_decision_immutable();

CREATE FUNCTION public.v2_validate_source_decision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.v2_source_cases; previous public.v2_source_decisions;
BEGIN
 SELECT * INTO c FROM public.v2_source_cases WHERE id=NEW.case_id FOR UPDATE;
 IF c.id IS NULL OR c.erased THEN RAISE EXCEPTION 'v2_source_evidence_missing' USING ERRCODE='23514'; END IF;
 IF NEW.expected_revision<>c.revision OR NEW.previous_decision_id IS DISTINCT FROM c.last_decision_id
   OR NEW.expected_graph_revision IS DISTINCT FROM (SELECT revision FROM public.v2_source_graph WHERE id) THEN
   RAISE EXCEPTION 'v2_source_revision_conflict' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.actor_user_id AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
 IF NEW.action='reverse' THEN
   SELECT * INTO previous FROM public.v2_source_decisions WHERE id=c.last_decision_id;
   IF previous.id IS DISTINCT FROM NEW.reverses_decision_id OR previous.action='reverse' OR previous.evidence_erased THEN
     RAISE EXCEPTION 'v2_reverse_current_source_decision_required' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.action='same_origin' AND EXISTS(SELECT 1 FROM public.v2_sources WHERE id IN(c.source_a,c.source_b) AND kind IN('unprovided','legacy_import')) THEN
   RAISE EXCEPTION 'v2_known_source_evidence_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_validate_source_decision BEFORE INSERT ON public.v2_source_decisions
 FOR EACH ROW EXECUTE FUNCTION public.v2_validate_source_decision();

CREATE FUNCTION public.v2_source_case_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d public.v2_source_decisions;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'v2_source_case_history_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.erased OR NEW.revision<>1 OR NEW.last_decision_id IS NOT NULL THEN RAISE EXCEPTION 'v2_source_case_baseline_required' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR OLD.erased OR NEW.revision<>OLD.revision+1 THEN
   RAISE EXCEPTION 'v2_source_case_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.erased AND pg_trigger_depth()>1 AND NEW.source_a IS NULL AND NEW.source_b IS NULL AND NEW.last_decision_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO d FROM public.v2_source_decisions WHERE id=NEW.last_decision_id AND case_id=NEW.id;
 IF NEW.source_a IS DISTINCT FROM OLD.source_a OR NEW.source_b IS DISTINCT FROM OLD.source_b
   OR d.id IS NULL OR d.expected_revision<>OLD.revision OR d.previous_decision_id IS DISTINCT FROM OLD.last_decision_id THEN
   RAISE EXCEPTION 'v2_source_case_requires_decision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_source_case_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_source_cases
 FOR EACH ROW EXECUTE FUNCTION public.v2_source_case_guard();
CREATE FUNCTION public.v2_project_source_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE members uuid[]; d public.v2_source_decisions;
BEGIN
 members:=public.v2_source_component(ARRAY[OLD.source_a,OLD.source_b]);
 DELETE FROM public.v2_source_relations WHERE case_id=NEW.id;
 SELECT * INTO d FROM public.v2_source_decisions WHERE id=NEW.last_decision_id;
 IF NOT NEW.erased AND d.action IN('same_origin','suspected_same_origin') THEN
   INSERT INTO public.v2_source_relations VALUES(NEW.id,NEW.source_a,NEW.source_b,d.id,d.action);
 END IF;
 PERFORM public.v2_source_changed(members,ARRAY[]::uuid[],NEW.erased);
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_project_source_case AFTER UPDATE ON public.v2_source_cases
 FOR EACH ROW EXECUTE FUNCTION public.v2_project_source_case();
CREATE FUNCTION public.v2_project_source_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_source_cases SET revision=revision+1,last_decision_id=NEW.id WHERE id=NEW.case_id;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_project_source_decision AFTER INSERT ON public.v2_source_decisions
 FOR EACH ROW EXECUTE FUNCTION public.v2_project_source_decision();

CREATE FUNCTION public.v2_source_relation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.v2_source_cases c JOIN public.v2_source_decisions d ON d.id=c.last_decision_id
   WHERE c.id=NEW.case_id AND NOT c.erased AND c.source_a=NEW.source_a AND c.source_b=NEW.source_b
     AND d.id=NEW.decision_id AND d.action=NEW.relation AND NOT d.evidence_erased) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'v2_source_relation_requires_current_review' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_source_relation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_source_relations
 FOR EACH ROW EXECUTE FUNCTION public.v2_source_relation_guard();

CREATE FUNCTION public.v2_open_source_case(actor varchar,source_one uuid,source_two uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
 IF source_one IS NULL OR source_two IS NULL OR source_one=source_two THEN
   RAISE EXCEPTION 'v2_distinct_source_pair_required' USING ERRCODE='23514'; END IF;
 SELECT id INTO result FROM public.v2_source_cases WHERE source_a=least(source_one,source_two) AND source_b=greatest(source_one,source_two);
 IF result IS NULL THEN
   INSERT INTO public.v2_source_cases(source_a,source_b) VALUES(least(source_one,source_two),greatest(source_one,source_two)) RETURNING id INTO result;
 END IF;
 RETURN result;
END; $$;
CREATE FUNCTION public.v2_review_sources(actor varchar,target_case uuid,expected bigint,expected_graph bigint,
 decision_action text,reason text,private_note text,request uuid,policy text,reverse_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.v2_source_cases; receipt public.v2_source_decisions; result uuid:=gen_random_uuid();
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'v2_source_actor_request_required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM public.v2_source_decisions WHERE actor_user_id=actor AND request_id=request;
 IF receipt.id IS NOT NULL THEN
   IF ROW(receipt.case_id,receipt.expected_revision,receipt.expected_graph_revision,receipt.action,receipt.reason_code,receipt.private_reason,receipt.policy_version,receipt.reverses_decision_id)
      IS DISTINCT FROM ROW(target_case,expected,expected_graph,decision_action,reason,private_note,policy,reverse_id) OR receipt.evidence_erased THEN
     RAISE EXCEPTION 'v2_source_request_conflict' USING ERRCODE='23514'; END IF;
   RETURN receipt.id;
 END IF;
 SELECT * INTO c FROM public.v2_source_cases WHERE id=target_case;
 INSERT INTO public.v2_decision_ids(id,kind) VALUES(result,'source');
 INSERT INTO public.v2_source_decisions(id,case_id,action,expected_revision,expected_graph_revision,previous_decision_id,reverses_decision_id,
   actor_user_id,request_id,reason_code,private_reason,policy_version)
 VALUES(result,target_case,decision_action,expected,expected_graph,c.last_decision_id,reverse_id,actor,request,reason,private_note,policy);
 RETURN result;
END; $$;

-- Redact a deleted source's case identities and all potentially quoting notes
-- in its connected component. Other independently evidenced edges can survive.
CREATE FUNCTION public.v2_erase_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE members uuid[];
BEGIN
 members:=public.v2_source_component(ARRAY[OLD.id]);
 UPDATE public.v2_source_decisions SET private_reason=NULL WHERE case_id IN
   (SELECT id FROM public.v2_source_cases WHERE source_a=ANY(members) OR source_b=ANY(members));
 UPDATE public.v2_source_decisions SET evidence_erased=true,private_reason=NULL WHERE case_id IN
   (SELECT id FROM public.v2_source_cases WHERE source_a=OLD.id OR source_b=OLD.id);
 PERFORM public.v2_source_changed(members,ARRAY[]::uuid[],true);
 UPDATE public.v2_source_cases SET erased=true,source_a=NULL,source_b=NULL,last_decision_id=NULL,revision=revision+1
   WHERE source_a=OLD.id OR source_b=OLD.id;
 RETURN OLD;
END; $$;
CREATE TRIGGER v2_erase_source BEFORE DELETE ON public.v2_sources FOR EACH ROW EXECUTE FUNCTION public.v2_erase_source();
CREATE FUNCTION public.v2_erase_source_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_source_decisions SET private_reason=NULL WHERE case_id IN
   (SELECT case_id FROM public.v2_source_decisions WHERE actor_user_id=OLD.id);
 -- Before observation/account cascades can hide the old component dependencies.
 DELETE FROM public.v2_sources WHERE owner_user_id=OLD.id;
 RETURN OLD;
END; $$;
CREATE TRIGGER v2_account_source_erasure BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.v2_erase_source_actor();

CREATE FUNCTION public.v2_source_citation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=OLD.source_id)
   OR NOT EXISTS(SELECT 1 FROM public.v2_observations WHERE id=OLD.observation_id)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'v2_append_corrected_observation_for_citation_change' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_source_citation_guard BEFORE UPDATE OR DELETE ON public.v2_observation_sources
 FOR EACH ROW EXECUTE FUNCTION public.v2_source_citation_guard();
CREATE FUNCTION public.v2_source_citation_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN PERFORM public.v2_source_changed(ARRAY[NEW.source_id],ARRAY[NEW.observation_id],false); RETURN NEW;
 ELSE PERFORM public.v2_source_changed(ARRAY[OLD.source_id],ARRAY[OLD.observation_id],true); RETURN OLD; END IF;
END; $$;
CREATE TRIGGER v2_source_citation_changed AFTER INSERT OR DELETE ON public.v2_observation_sources
 FOR EACH ROW EXECUTE FUNCTION public.v2_source_citation_changed();

DO $$ DECLARE t text; role_name text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_source_graph','v2_source_cases','v2_source_decisions','v2_source_relations'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
   END LOOP;
   EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
   EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['v2_source_graph','v2_source_cases','v2_source_decisions','v2_source_relations','v2_sources','v2_observation_sources'] LOOP
   EXECUTE format('CREATE TRIGGER v2_source_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND (p.proname LIKE 'v2_source_%' OR p.proname IN('v2_open_source_case','v2_review_sources','v2_erase_source','v2_erase_source_actor','v2_validate_source_decision','v2_project_source_case','v2_project_source_decision')) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
   END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_open_source_case(varchar,uuid,uuid),
 public.v2_review_sources(varchar,uuid,bigint,bigint,text,text,text,uuid,text,uuid),
 public.v2_source_footprint(uuid),public.v2_source_component(uuid[]) TO mabhazi_api;
