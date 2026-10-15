-- Review storage and transactional primitives. The decision registry is extended
-- only when field/association tables exist; no unchecked future decision IDs.
CREATE TABLE public.v2_decision_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CONSTRAINT v2_decision_kind CHECK(kind='review'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,kind)
);
CREATE TABLE public.v2_review_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('reviewer','administrator')),
  granted_by_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK(revoked_at IS NULL OR revoked_at>=granted_at),
  CHECK(revoked_at IS NOT NULL OR revoked_by_user_id IS NULL)
);
CREATE UNIQUE INDEX v2_review_roles_active_idx ON public.v2_review_roles(user_id,role) WHERE revoked_at IS NULL;
CREATE INDEX v2_review_roles_grantor_idx ON public.v2_review_roles(granted_by_user_id);
CREATE INDEX v2_review_roles_revoker_idx ON public.v2_review_roles(revoked_by_user_id);
CREATE TABLE public.v2_role_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  role text NOT NULL CHECK(role IN ('reviewer','administrator')),
  action text NOT NULL CHECK(action IN ('grant','revoke')),
  actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX v2_role_events_target_idx ON public.v2_role_events(target_user_id,created_at);
CREATE INDEX v2_role_events_actor_idx ON public.v2_role_events(actor_user_id);

CREATE TABLE public.v2_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  subject_kind text NOT NULL,
  field_key text CHECK(field_key ~ '^[a-z_]+[.][a-z_]+$'),
  scope_key text CHECK(scope_key ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK(kind IN ('identity','correction','conflict','moderation','affiliation')),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_review','resolved','reopened','dismissed')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_decision_id uuid,
  CHECK(num_nonnulls(field_key,scope_key) IN (0,2)),
  CHECK(kind NOT IN ('correction','conflict') OR field_key IS NOT NULL),
  CHECK(kind<>'affiliation' OR subject_kind='operator'),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind)
);
CREATE INDEX v2_review_cases_subject_idx ON public.v2_review_cases(subject_id,subject_kind);
CREATE INDEX v2_review_cases_queue_idx ON public.v2_review_cases(kind,state,opened_at);
CREATE INDEX v2_review_cases_last_idx ON public.v2_review_cases(last_decision_id);

CREATE TABLE public.v2_review_decisions (
  id uuid PRIMARY KEY,
  decision_kind text NOT NULL DEFAULT 'review' CHECK(decision_kind='review'),
  case_id uuid NOT NULL REFERENCES public.v2_review_cases(id),
  action text NOT NULL CHECK(action IN ('accept','reject','needs_context','hide','restore','reverse','verify_affiliation','revoke_affiliation')),
  expected_revision bigint NOT NULL CHECK(expected_revision>=1),
  expected_subject_revision bigint NOT NULL CHECK(expected_subject_revision>=1),
  reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  private_reason text CHECK(length(private_reason)<=4000),
  actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  actor_erased boolean NOT NULL DEFAULT false,
  evidence_erased boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverses_decision_id uuid,
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 64),
  UNIQUE(id,case_id),
  UNIQUE(case_id,expected_revision),
  CHECK((action='reverse')=(reverses_decision_id IS NOT NULL)),
  CHECK(reverses_decision_id IS NULL OR reverses_decision_id<>id),
  CHECK(actor_user_id IS NOT NULL OR actor_erased),
  CHECK(NOT (actor_erased OR evidence_erased) OR private_reason IS NULL),
  FOREIGN KEY(id,decision_kind) REFERENCES public.v2_decision_ids(id,kind) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(reverses_decision_id,case_id) REFERENCES public.v2_review_decisions(id,case_id)
);
CREATE INDEX v2_review_decisions_actor_idx ON public.v2_review_decisions(actor_user_id);
CREATE INDEX v2_review_decisions_reverse_idx ON public.v2_review_decisions(reverses_decision_id,case_id);
ALTER TABLE public.v2_review_cases ADD CONSTRAINT v2_review_last_decision
  FOREIGN KEY(last_decision_id,id) REFERENCES public.v2_review_decisions(id,case_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.v2_review_decision_evidence (
  decision_id uuid NOT NULL REFERENCES public.v2_review_decisions(id),
  observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
  PRIMARY KEY(decision_id,observation_id)
);
CREATE INDEX v2_review_evidence_observation_idx ON public.v2_review_decision_evidence(observation_id);

CREATE FUNCTION public.v2_require_decision_subtype() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target uuid; registry_kind text;
BEGIN
  target:=COALESCE(NEW.id,OLD.id);
  -- Registry identity is immutable; the shared guard already serializes writes.
  -- Deferred checks run after SECURITY DEFINER returns, under the caller's role.
  SELECT kind INTO registry_kind FROM public.v2_decision_ids WHERE id=target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF registry_kind='review' AND NOT EXISTS(SELECT 1 FROM public.v2_review_decisions WHERE id=target) THEN
    RAISE EXCEPTION 'v2_decision_requires_subtype' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_decision_subtype AFTER INSERT OR UPDATE ON public.v2_decision_ids
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_decision_subtype();
CREATE CONSTRAINT TRIGGER v2_review_subtype AFTER INSERT OR UPDATE OR DELETE ON public.v2_review_decisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_decision_subtype();

CREATE FUNCTION public.v2_review_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='v2_review_decisions' AND TG_OP='UPDATE' THEN
    -- FK account erasure always removes the author's private rationale too.
    IF pg_trigger_depth()>1 AND NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
      AND (to_jsonb(NEW)-'actor_user_id')=(to_jsonb(OLD)-'actor_user_id') THEN
      NEW.actor_erased:=true; NEW.private_reason:=NULL; RETURN NEW;
    END IF;
    -- Only the nested evidence-deletion trigger may redact decision content.
    IF pg_trigger_depth()>1 AND (NEW.evidence_erased OR NEW.evidence_erased=OLD.evidence_erased) AND NEW.private_reason IS NULL
      AND (to_jsonb(NEW)-ARRAY['evidence_erased','private_reason'])=(to_jsonb(OLD)-ARRAY['evidence_erased','private_reason']) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME='v2_review_decision_evidence' AND TG_OP='DELETE' AND pg_trigger_depth()>1 THEN
    RETURN OLD;
  ELSIF TG_TABLE_NAME='v2_role_events' AND TG_OP='UPDATE' THEN
    IF pg_trigger_depth()>1
      AND (NEW.target_user_id IS NOT DISTINCT FROM OLD.target_user_id OR NEW.target_user_id IS NULL)
      AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR NEW.actor_user_id IS NULL)
      AND (to_jsonb(NEW)-ARRAY['target_user_id','actor_user_id'])=(to_jsonb(OLD)-ARRAY['target_user_id','actor_user_id']) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'v2_append_review_history_instead' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_review_immutable BEFORE UPDATE OR DELETE ON public.v2_review_decisions
  FOR EACH ROW EXECUTE FUNCTION public.v2_review_immutable();
CREATE TRIGGER v2_decision_id_immutable BEFORE UPDATE OR DELETE ON public.v2_decision_ids
  FOR EACH ROW EXECUTE FUNCTION public.v2_review_immutable();
CREATE TRIGGER v2_role_event_immutable BEFORE UPDATE OR DELETE ON public.v2_role_events
  FOR EACH ROW EXECUTE FUNCTION public.v2_review_immutable();
CREATE TRIGGER v2_review_evidence_immutable BEFORE UPDATE OR DELETE ON public.v2_review_decision_evidence
  FOR EACH ROW EXECUTE FUNCTION public.v2_review_immutable();

CREATE FUNCTION public.v2_guard_role_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' THEN
    IF pg_trigger_depth()>1
      AND (NEW.granted_by_user_id IS NOT DISTINCT FROM OLD.granted_by_user_id OR NEW.granted_by_user_id IS NULL)
      AND (NEW.revoked_by_user_id IS NOT DISTINCT FROM OLD.revoked_by_user_id OR NEW.revoked_by_user_id IS NULL)
      AND (to_jsonb(NEW)-ARRAY['granted_by_user_id','revoked_by_user_id'])=(to_jsonb(OLD)-ARRAY['granted_by_user_id','revoked_by_user_id']) THEN RETURN NEW; END IF;
    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.revoked_by_user_id IS NOT NULL
      AND (to_jsonb(NEW)-ARRAY['revoked_at','revoked_by_user_id','reason_code'])=(to_jsonb(OLD)-ARRAY['revoked_at','revoked_by_user_id','reason_code']) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'v2_append_role_history_instead' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_role_history BEFORE UPDATE OR DELETE ON public.v2_review_roles
  FOR EACH ROW EXECUTE FUNCTION public.v2_guard_role_history();

CREATE FUNCTION public.v2_audit_role_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.v2_role_events(target_user_id,role,action,actor_user_id,reason_code)
      VALUES(NEW.user_id,NEW.role,'grant',NEW.granted_by_user_id,NEW.reason_code);
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    INSERT INTO public.v2_role_events(target_user_id,role,action,actor_user_id,reason_code)
      VALUES(NEW.user_id,NEW.role,'revoke',NEW.revoked_by_user_id,NEW.reason_code);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER v2_role_audit AFTER INSERT OR UPDATE ON public.v2_review_roles
  FOR EACH ROW EXECUTE FUNCTION public.v2_audit_role_change();

-- The backend supplies the authenticated actor, never a client-supplied role.
-- Bootstrap is an explicit owner-only INSERT, not a public self-promotion path.
CREATE FUNCTION public.v2_change_review_role(actor varchar,target varchar,desired_role text,operation text,reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE grant_id uuid;
BEGIN
  IF actor IS NULL OR target IS NULL OR actor=target OR desired_role IS NULL OR desired_role NOT IN ('reviewer','administrator')
     OR operation IS NULL OR operation NOT IN ('grant','revoke') OR reason IS NULL OR reason !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'v2_invalid_role_change' USING ERRCODE='23514'; END IF;
  -- Same account lock as deletion, stable account order, then structural guard.
  PERFORM pg_advisory_xact_lock(hashtext(least(actor,target)));
  PERFORM pg_advisory_xact_lock(hashtext(greatest(actor,target)));
  UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
  IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND role='administrator' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'v2_administrator_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=target) THEN
    RAISE EXCEPTION 'v2_role_target_missing' USING ERRCODE='23503'; END IF;
  SELECT id INTO grant_id FROM public.v2_review_roles WHERE user_id=target AND role=desired_role AND revoked_at IS NULL;
  IF operation='grant' THEN
    IF grant_id IS NOT NULL THEN RETURN grant_id; END IF;
    INSERT INTO public.v2_review_roles(user_id,role,granted_by_user_id,reason_code)
      VALUES(target,desired_role,actor,reason) RETURNING id INTO grant_id;
  ELSIF grant_id IS NOT NULL THEN
    UPDATE public.v2_review_roles SET revoked_at=now(),revoked_by_user_id=actor,reason_code=reason WHERE id=grant_id;
  END IF;
  RETURN grant_id;
END; $$;

-- Manual reviewer queue entry. Automatic/report-created cases are a later API/worker path.
CREATE FUNCTION public.v2_open_review_case(actor varchar,target_subject uuid,case_kind text,field text DEFAULT NULL,scope text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE case_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(actor));
  UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
  IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.v2_review_cases(subject_id,subject_kind,kind,field_key,scope_key)
    SELECT id,kind,case_kind,field,scope FROM public.v2_subjects WHERE id=target_subject RETURNING id INTO case_id;
  IF case_id IS NULL THEN RAISE EXCEPTION 'v2_review_subject_missing' USING ERRCODE='23503'; END IF;
  RETURN case_id;
END; $$;

CREATE FUNCTION public.v2_record_review(actor varchar,target_case uuid,expected bigint,expected_subject bigint,decision_action text,
  reason text,private_note text,evidence uuid[],policy text,reverse_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE review_case public.v2_review_cases; new_decision_id uuid; previous public.v2_review_decisions; observation_count integer; subject_revision bigint;
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN
    RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(actor));
  UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
  IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO review_case FROM public.v2_review_cases WHERE id=target_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'v2_review_case_missing' USING ERRCODE='23503'; END IF;
  IF expected IS NULL OR review_case.revision<>expected THEN
    RAISE EXCEPTION 'v2_review_revision_conflict' USING ERRCODE='40001'; END IF;
  SELECT revision INTO subject_revision FROM public.v2_subjects WHERE id=review_case.subject_id FOR UPDATE;
  IF expected_subject IS NULL OR subject_revision<>expected_subject THEN
    RAISE EXCEPTION 'v2_review_subject_revision_conflict' USING ERRCODE='40001'; END IF;
  IF decision_action IS NULL OR decision_action NOT IN ('accept','reject','needs_context','hide','restore','reverse','verify_affiliation','revoke_affiliation') THEN
    RAISE EXCEPTION 'v2_review_action_invalid' USING ERRCODE='23514'; END IF;
  -- Affiliation needs a claimed account/operator relationship and dedicated proof.
  -- A route report naming an operator cannot establish employment/authority.
  IF review_case.kind='affiliation' OR decision_action IN ('verify_affiliation','revoke_affiliation') THEN
    RAISE EXCEPTION 'v2_affiliation_workflow_not_available' USING ERRCODE='23514'; END IF;
  IF decision_action IN ('hide','restore') AND review_case.kind<>'moderation' THEN
    RAISE EXCEPTION 'v2_moderation_case_required' USING ERRCODE='23514'; END IF;
  IF review_case.kind='moderation' AND decision_action='accept' THEN
    RAISE EXCEPTION 'v2_explicit_moderation_action_required' USING ERRCODE='23514'; END IF;
  IF review_case.state IN ('resolved','dismissed') AND decision_action<>'reverse' THEN
    RAISE EXCEPTION 'v2_review_case_requires_reopening' USING ERRCODE='23514'; END IF;
  IF decision_action='reverse' THEN
    SELECT * INTO previous FROM public.v2_review_decisions WHERE id=reverse_id AND case_id=target_case;
    IF NOT FOUND OR review_case.last_decision_id IS DISTINCT FROM reverse_id OR previous.action IN ('reverse','needs_context') OR previous.evidence_erased THEN
      RAISE EXCEPTION 'v2_reverse_current_decision_required' USING ERRCODE='23514'; END IF;
    IF previous.action IN ('verify_affiliation','revoke_affiliation') AND NOT EXISTS
      (SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND role='administrator' AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'v2_affiliation_administrator_required' USING ERRCODE='42501'; END IF;
  ELSIF reverse_id IS NOT NULL THEN RAISE EXCEPTION 'v2_reverse_reference_unexpected' USING ERRCODE='23514'; END IF;
  -- Material affirmative decisions need at least one live, visible observation.
  IF decision_action IN ('accept','verify_affiliation','restore') AND COALESCE(cardinality(evidence),0)=0 THEN
    RAISE EXCEPTION 'v2_review_evidence_required' USING ERRCODE='23514'; END IF;
  IF evidence IS NOT NULL THEN
    SELECT count(*) INTO observation_count FROM public.v2_observations o
      JOIN public.v2_observation_states s ON s.observation_id=o.id
      WHERE o.id=ANY(evidence) AND (s.status='active' OR (decision_action='restore' AND s.status='hidden')) AND o.original_subject_id=review_case.subject_id
        AND (review_case.field_key IS NULL OR (o.field_key=review_case.field_key AND o.scope_key=review_case.scope_key));
    IF observation_count<>cardinality(evidence) THEN
      RAISE EXCEPTION 'v2_review_evidence_missing_hidden_or_duplicate' USING ERRCODE='23514'; END IF;
  END IF;
  new_decision_id:=gen_random_uuid();
  INSERT INTO public.v2_decision_ids(id,kind) VALUES(new_decision_id,'review');
  INSERT INTO public.v2_review_decisions(id,case_id,action,expected_revision,expected_subject_revision,reason_code,private_reason,actor_user_id,reverses_decision_id,policy_version)
    VALUES(new_decision_id,target_case,decision_action,expected,expected_subject,reason,private_note,actor,reverse_id,policy);
  INSERT INTO public.v2_review_decision_evidence(decision_id,observation_id)
    SELECT new_decision_id,unnest(COALESCE(evidence,ARRAY[]::uuid[]));
  UPDATE public.v2_review_cases SET revision=revision+1,last_decision_id=new_decision_id,
    state=CASE decision_action WHEN 'reverse' THEN 'reopened' WHEN 'needs_context' THEN 'open' ELSE 'resolved' END WHERE id=target_case;
  UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=review_case.subject_id;
  INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
    SELECT 'assess',id,input_generation,policy,new_decision_id FROM public.v2_subjects WHERE id=review_case.subject_id;
  RETURN new_decision_id;
END; $$;

-- This function runs inside the existing observation/account-deletion transaction.
-- Redact derived private material immediately; a later worker must not be needed
-- to make deleted evidence inaccessible. Registry/decision tombstones survive.
CREATE FUNCTION public.v2_erase_review_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected record; changed_cases uuid[];
BEGIN
  UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
  SELECT array_agg(DISTINCT d.case_id) INTO changed_cases FROM public.v2_review_decisions d
    JOIN public.v2_review_decision_evidence e ON e.decision_id=d.id WHERE e.observation_id=OLD.id;
  -- Later rationale in the same case can quote an earlier decision's evidence.
  -- Conservatively redact/invalidate the whole case, including reversal notes.
  UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE case_id=ANY(changed_cases);
  UPDATE public.v2_review_cases c SET state='reopened',revision=revision+1
    WHERE id=ANY(changed_cases) AND EXISTS(SELECT 1 FROM public.v2_review_decisions d WHERE d.id=c.last_decision_id AND d.evidence_erased);
  FOR affected IN SELECT DISTINCT subject_id FROM public.v2_review_cases WHERE id=ANY(changed_cases) ORDER BY subject_id LOOP
    UPDATE public.v2_subjects SET input_generation=input_generation+1,revision=revision+1 WHERE id=affected.subject_id;
    INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
      SELECT 'erase_recompute',id,input_generation,'review/1',OLD.id FROM public.v2_subjects WHERE id=affected.subject_id;
  END LOOP;
  RETURN OLD;
END; $$;
CREATE TRIGGER v2_erase_review_evidence BEFORE DELETE ON public.v2_observations
  FOR EACH ROW EXECUTE FUNCTION public.v2_erase_review_evidence();
CREATE TRIGGER v2_review_delete_lock BEFORE DELETE ON public.v2_observations
  FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport();
CREATE TRIGGER v2_review_delete_lock BEFORE DELETE ON public.v2_contributions
  FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport();

-- Extend, rather than edit, the shipped account-erasure migration: account lock,
-- then guard, then subject rows is the shared review/deletion lock order.
CREATE OR REPLACE FUNCTION public.v2_account_erasure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(OLD.id));
  UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
  -- Another reviewer can quote a preceding rationale. Remove private notes
  -- throughout any case authored by the erased account, but keep live evidence.
  UPDATE public.v2_review_decisions SET private_reason=NULL WHERE case_id IN
    (SELECT case_id FROM public.v2_review_decisions WHERE actor_user_id=OLD.id);
  FOR affected IN SELECT DISTINCT original_subject_id FROM public.v2_contributions
      WHERE user_id=OLD.id ORDER BY original_subject_id LOOP
    UPDATE public.v2_subjects SET input_generation=input_generation+1,revision=revision+1
      WHERE id=affected.original_subject_id;
    INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
      SELECT 'erase_recompute',id,input_generation,'evidence/1',gen_random_uuid()
      FROM public.v2_subjects WHERE id=affected.original_subject_id;
  END LOOP;
  RETURN OLD;
END; $$;

-- Registry rows/decisions/evidence/roles can be written only via constrained
-- primitives (or the DB owner for explicit bootstrap/migration). The HTTP layer
-- must bind actor to the authenticated account; this is not per-user SQL auth.
DO $$ DECLARE t text; role_name text; BEGIN
  FOREACH t IN ARRAY ARRAY['v2_decision_ids','v2_review_roles','v2_role_events','v2_review_cases','v2_review_decisions','v2_review_decision_evidence'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
    END LOOP;
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
    EXECUTE format('CREATE POLICY api_server_access ON public.%I FOR ALL TO mabhazi_api USING(true) WITH CHECK(true)',t);
    EXECUTE format('CREATE TRIGGER v2_review_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
  END LOOP;
END; $$;
-- Explicitly revoke inherited hosted function defaults too, not just PUBLIC.
DO $$ DECLARE f text; role_name text; BEGIN
  FOREACH f IN ARRAY ARRAY['v2_change_review_role(varchar,varchar,text,text,text)',
    'v2_open_review_case(varchar,uuid,text,text,text)',
    'v2_record_review(varchar,uuid,bigint,bigint,text,text,text,uuid[],text,uuid)',
    'v2_erase_review_evidence()', 'v2_account_erasure()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC',f);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I',f,role_name); END IF;
    END LOOP;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_change_review_role(varchar,varchar,text,text,text),
  public.v2_open_review_case(varchar,uuid,text,text,text),
  public.v2_record_review(varchar,uuid,bigint,bigint,text,text,text,uuid[],text,uuid) TO mabhazi_api;
