-- A value-free marker survives parent erasure while the replacement exists.
-- An erased predecessor must not turn its replacement into an invented intake root.
CREATE TABLE public.v2_intake_correction_members (
 observation_id uuid PRIMARY KEY REFERENCES public.v2_observations(id) ON DELETE CASCADE
);
INSERT INTO public.v2_intake_correction_members SELECT id FROM public.v2_observations WHERE supersedes_id IS NOT NULL;
CREATE FUNCTION public.v2_mark_intake_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.supersedes_id IS NOT NULL THEN INSERT INTO public.v2_intake_correction_members VALUES(NEW.id);END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_mark_intake_correction AFTER INSERT ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_mark_intake_correction();
-- Current descendants of the bounded original intake facts, never a copied birth value.
CREATE FUNCTION public.v2_current_intake_evidence(subject uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH RECURSIVE origin AS (
  SELECT initial_contribution_id id FROM public.v2_leads WHERE subject_id=subject AND NOT attribution_erased
  UNION ALL SELECT initial_contribution_id FROM public.v2_actual_journeys WHERE subject_id=subject
 ), chain(id,path) AS (
  SELECT o.id,ARRAY[o.id] FROM public.v2_observations o JOIN origin i ON i.id=o.contribution_id
   WHERE o.original_subject_id=subject AND o.supersedes_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.v2_intake_correction_members m WHERE m.observation_id=o.id)
  UNION ALL SELECT o.id,c.path||o.id FROM chain c JOIN public.v2_observations o ON o.supersedes_id=c.id
   WHERE o.original_subject_id=subject AND NOT o.id=ANY(c.path)
 ) SELECT COALESCE(array_agg(DISTINCT c.id ORDER BY c.id),'{}'::uuid[]) FROM chain c
 JOIN public.v2_observation_states s ON s.observation_id=c.id AND s.status='active'
 WHERE public.v2_observation_subject(c.id)=subject;
$$;

CREATE TABLE public.v2_normalised_actuals (
 subject_id uuid PRIMARY KEY REFERENCES public.v2_subjects(id) ON DELETE CASCADE,
 contribution_id uuid NOT NULL REFERENCES public.v2_contributions(id) ON DELETE CASCADE,
 input_generation bigint NOT NULL CHECK(input_generation>=1),
 intended_subject_id uuid REFERENCES public.v2_subjects(id),
 input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 normalised_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX v2_normalised_actuals_intended_idx ON public.v2_normalised_actuals(intended_subject_id);
CREATE TABLE public.v2_actual_input_evidence (
 subject_id uuid NOT NULL REFERENCES public.v2_normalised_actuals(subject_id) ON DELETE CASCADE,
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 state_revision bigint NOT NULL CHECK(state_revision>=1),PRIMARY KEY(subject_id,observation_id)
);
CREATE INDEX v2_actual_input_observation_idx ON public.v2_actual_input_evidence(observation_id);
CREATE TABLE public.v2_actual_catalog (
 intended_subject_id uuid PRIMARY KEY REFERENCES public.v2_subjects(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>=1)
);
CREATE TABLE public.v2_actual_scans (
 job_id uuid PRIMARY KEY REFERENCES public.v2_jobs(id) ON DELETE CASCADE,
 subject_id uuid NOT NULL REFERENCES public.v2_normalised_actuals(subject_id) ON DELETE CASCADE,
 source_revision bigint NOT NULL CHECK(source_revision>=1),catalog_revision bigint NOT NULL CHECK(catalog_revision>=0),
 input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 cursor_subject_id uuid,pages_completed integer NOT NULL DEFAULT 0 CHECK(pages_completed>=0)
);
CREATE INDEX v2_actual_scans_subject_idx ON public.v2_actual_scans(subject_id);
ALTER TABLE public.v2_association_candidates ADD CONSTRAINT v2_actual_candidate_basis
 CHECK(rule_version<>'actual-association/1' OR basis_digest IS NOT NULL OR evidence_erased);
ALTER TABLE public.v2_worker_status DROP CONSTRAINT v2_worker_status_runner_key_check;
ALTER TABLE public.v2_worker_status ADD CONSTRAINT v2_worker_status_runner_key_check
 CHECK(runner_key IN('normalise/1','association/1','pattern-association/1','actual-association/1'));

-- Explicit structural ancestry, without active-status filtering, also finds retired dependencies.
CREATE FUNCTION public.v2_journey_parent_ids(subject uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[subject,r.pattern_subject_id,r.service_plan_subject_id,
  sp.pattern_subject_id,p.route_subject_id,route.operator_subject_id]) x WHERE x IS NOT NULL ORDER BY x)
 FROM (SELECT subject id) base LEFT JOIN public.v2_runs r ON r.subject_id=base.id
 LEFT JOIN public.v2_service_plans sp ON sp.subject_id=COALESCE(r.service_plan_subject_id,base.id)
 LEFT JOIN public.v2_patterns p ON p.subject_id=COALESCE(r.pattern_subject_id,sp.pattern_subject_id,base.id)
 LEFT JOIN public.v2_routes route ON route.subject_id=COALESCE(p.route_subject_id,base.id);
$$;
CREATE FUNCTION public.v2_actual_run_context(actual uuid,run uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('intended',a.intended_subject_id,'intendedKind',a.intended_subject_kind,
  'declaredDate',a.reported_service_date,'declaredZone',a.timezone,
  'target',r.subject_id,'parents',(SELECT jsonb_agg(jsonb_build_array(s.id,public.v2_transport_snapshot(s.id)) ORDER BY s.id)
    FROM public.v2_subjects s WHERE s.id=ANY(public.v2_journey_parent_ids(r.subject_id))),
  'proof',(SELECT jsonb_agg(jsonb_build_array(o.id,s.revision) ORDER BY o.id) FROM public.v2_observations o
    JOIN public.v2_observation_states s ON s.observation_id=o.id WHERE o.id=ANY(public.v2_current_intake_evidence(actual))))
 FROM public.v2_actual_journeys a JOIN public.v2_subjects own ON own.id=a.subject_id AND own.lifecycle='active'
 JOIN public.v2_runs r ON r.subject_id=run JOIN public.v2_patterns p ON p.subject_id=r.pattern_subject_id
 JOIN public.v2_service_plans sp ON sp.subject_id=r.service_plan_subject_id AND sp.pattern_subject_id=p.subject_id
 JOIN public.v2_routes route ON route.subject_id=p.route_subject_id
 WHERE a.subject_id=actual AND a.initial_contribution_id IS NOT NULL
  AND cardinality(public.v2_current_intake_evidence(actual))>0
  AND ((a.intended_subject_kind='run' AND a.intended_subject_id=r.subject_id)
    OR (a.intended_subject_kind='service_plan' AND a.intended_subject_id=sp.subject_id)
    OR (a.intended_subject_kind='pattern' AND a.intended_subject_id=p.subject_id)
    OR (a.intended_subject_kind='route' AND a.intended_subject_id=route.subject_id))
  AND NOT EXISTS(SELECT 1 FROM public.v2_subjects s WHERE s.id=ANY(public.v2_journey_parent_ids(run)) AND s.lifecycle<>'active')
  AND NOT EXISTS(SELECT 1 FROM public.v2_observations o WHERE o.id=ANY(public.v2_current_intake_evidence(actual))
    AND ((o.field_key='operator.reported' AND o.operator_ref IS NOT NULL AND o.operator_ref<>route.operator_subject_id)
      OR (o.field_key='operator.identity' AND (o.value->>'id')::uuid<>route.operator_subject_id)))
  AND (a.matched_run_subject_id IS NULL OR public.v2_resolved_operator(a.matched_run_subject_id)=route.operator_subject_id);
$$;

CREATE FUNCTION public.v2_wake_actual_work(intended uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;event uuid:=gen_random_uuid();
BEGIN
 FOR target IN SELECT DISTINCT i FROM unnest(intended) i WHERE i IS NOT NULL ORDER BY i LOOP
  INSERT INTO public.v2_actual_catalog VALUES(target,1)
   ON CONFLICT(intended_subject_id) DO UPDATE SET revision=public.v2_actual_catalog.revision+1;
 END LOOP;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
 SELECT 'associate',n.subject_id,s.input_generation,'actual-association/1',event
 FROM public.v2_normalised_actuals n JOIN public.v2_subjects s ON s.id=n.subject_id AND s.lifecycle='active'
 WHERE n.intended_subject_id=ANY(intended) AND n.input_generation=s.input_generation
  AND NOT EXISTS(SELECT 1 FROM public.v2_jobs j WHERE j.subject_id=s.id AND j.kind='associate'
   AND j.policy_version='actual-association/1' AND j.requested_generation=s.input_generation AND j.state='pending') ON CONFLICT DO NOTHING;
END; $$;

CREATE FUNCTION public.v2_actual_work_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[]:='{}';old_row jsonb;new_row jsonb;target uuid;parent uuid;erased_proofs uuid[];
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD);END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW);END IF;
 IF TG_TABLE_NAME='v2_subjects' THEN
  IF NEW.input_generation=OLD.input_generation AND NEW.lifecycle=OLD.lifecycle THEN RETURN NEW;END IF;
  IF NEW.kind='actual_journey' THEN
   DELETE FROM public.v2_normalised_actuals WHERE subject_id=NEW.id;
   IF NEW.lifecycle='active' AND EXISTS(SELECT 1 FROM public.v2_actual_journeys a JOIN public.v2_contributions c
     ON c.id=a.initial_contribution_id WHERE a.subject_id=NEW.id)
    AND EXISTS(SELECT 1 FROM public.v2_jobs j WHERE j.subject_id=NEW.id AND j.kind='normalise' AND j.policy_version='intake/1') THEN
    INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     VALUES('normalise',NEW.id,NEW.input_generation,'intake/1',NEW.id) ON CONFLICT DO NOTHING;
   END IF;
  END IF;
  UPDATE public.v2_association_candidates SET state='obsolete',revision=revision+1
   WHERE rule_version='actual-association/1' AND state='pending' AND last_decision_id IS NULL
    AND NEW.id IN(from_subject_id,to_subject_id)
    AND NOT public.v2_candidate_review_increment(id,NEW.id,OLD.revision,NEW.revision,OLD.input_generation,NEW.input_generation);
  ids:=public.v2_journey_parent_ids(NEW.id);
 ELSIF TG_TABLE_NAME='v2_observation_states' THEN
  DELETE FROM public.v2_normalised_actuals WHERE subject_id IN(
   SELECT subject_id FROM public.v2_actual_input_evidence WHERE observation_id=NEW.observation_id);
  RETURN NEW;
 ELSIF TG_TABLE_NAME='v2_observations' THEN
  -- Erasing any correction ancestor breaks the chain; invalidate copied digests before FK cleanup.
  WITH RECURSIVE descendants(id) AS (SELECT OLD.id UNION SELECT o.id FROM descendants d
   JOIN public.v2_observations o ON o.supersedes_id=d.id WHERE o.original_subject_id=OLD.original_subject_id)
  SELECT array_agg(id) INTO erased_proofs FROM descendants;
  DELETE FROM public.v2_normalised_actuals WHERE subject_id IN(SELECT subject_id FROM public.v2_actual_input_evidence WHERE observation_id=ANY(erased_proofs));
  DELETE FROM public.v2_normalised_leads WHERE operator_observation_id=ANY(erased_proofs) OR departure_observation_id=ANY(erased_proofs);
  UPDATE public.v2_association_candidates SET evidence_erased=true,evidence_digest=NULL,basis_digest=NULL,
   state='obsolete',revision=revision+1 WHERE rule_version IN('actual-association/1','lead-association/1') AND NOT evidence_erased
    AND id IN(SELECT candidate_id FROM public.v2_candidate_evidence WHERE observation_id=ANY(erased_proofs));
  RETURN OLD;
 ELSE
  target:=COALESCE((new_row->>'subject_id')::uuid,(old_row->>'subject_id')::uuid);
  ids:=public.v2_journey_parent_ids(target);
  FOREACH parent IN ARRAY ARRAY[(old_row->>'pattern_subject_id')::uuid,(new_row->>'pattern_subject_id')::uuid,
   (old_row->>'service_plan_subject_id')::uuid,(new_row->>'service_plan_subject_id')::uuid,
   (old_row->>'route_subject_id')::uuid,(new_row->>'route_subject_id')::uuid,
   (old_row->>'operator_subject_id')::uuid,(new_row->>'operator_subject_id')::uuid] LOOP
   IF parent IS NOT NULL THEN ids:=ids||public.v2_journey_parent_ids(parent);END IF;
  END LOOP;
 END IF;
 PERFORM public.v2_wake_actual_work(ids);
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END; $$;
CREATE TRIGGER v2_actual_work_change AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_actual_work_change();
CREATE TRIGGER v2_actual_input_state AFTER UPDATE ON public.v2_observation_states FOR EACH ROW EXECUTE FUNCTION public.v2_actual_work_change();
CREATE TRIGGER v2_actual_input_erasure BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_actual_work_change();
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_runs','v2_patterns','v2_service_plans','v2_routes'] LOOP
  EXECUTE format('CREATE TRIGGER v2_actual_work_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_actual_work_change()',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.v2_worker_finish_actual_normalise(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;source public.v2_subjects;actual public.v2_actual_journeys;proof uuid[];digest text;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job FOR UPDATE;
 IF NOT FOUND OR work.kind<>'normalise' OR work.policy_version<>'intake/1' OR work.state<>'leased'
  OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN 'lease_lost';END IF;
 SELECT * INTO source FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF source.kind<>'actual_journey' THEN RAISE EXCEPTION 'unsupported_subject' USING ERRCODE='23514';END IF;
 IF source.lifecycle<>'active' OR source.input_generation<>work.requested_generation THEN
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  RETURN 'superseded';END IF;
 SELECT * INTO actual FROM public.v2_actual_journeys WHERE subject_id=source.id;
 proof:=public.v2_current_intake_evidence(source.id);
 IF actual.initial_contribution_id IS NULL OR cardinality(proof)=0 THEN
  DELETE FROM public.v2_normalised_actuals WHERE subject_id=source.id;
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  RETURN 'superseded';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_object('policy','actual-normalise/1','generation',source.input_generation,
  'intended',actual.intended_subject_id,'headerDate',actual.reported_service_date,'headerZone',actual.timezone,
  'proof',(SELECT jsonb_agg(jsonb_build_array(observation_id,revision) ORDER BY observation_id) FROM public.v2_observation_states WHERE observation_id=ANY(proof))));
 INSERT INTO public.v2_normalised_actuals(subject_id,contribution_id,input_generation,intended_subject_id,input_digest)
 VALUES(source.id,actual.initial_contribution_id,source.input_generation,actual.intended_subject_id,digest)
 ON CONFLICT(subject_id) DO UPDATE SET contribution_id=EXCLUDED.contribution_id,input_generation=EXCLUDED.input_generation,
  intended_subject_id=EXCLUDED.intended_subject_id,input_digest=EXCLUDED.input_digest,normalised_at=clock_timestamp();
 DELETE FROM public.v2_actual_input_evidence WHERE subject_id=source.id;
 INSERT INTO public.v2_actual_input_evidence SELECT source.id,observation_id,revision FROM public.v2_observation_states WHERE observation_id=ANY(proof);
 INSERT INTO public.v2_job_effects VALUES(job,'actual-normalise/1',digest,source.revision,clock_timestamp()) ON CONFLICT DO NOTHING;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
  VALUES('associate',source.id,source.input_generation,'actual-association/1',source.id) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;
 RETURN 'done';
END; $$;

CREATE FUNCTION public.v2_worker_finish_actual(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;source public.v2_subjects;n public.v2_normalised_actuals;scan public.v2_actual_scans;
 epoch bigint;target record;context jsonb;basis text;digest text;candidate uuid;proof uuid[];pages integer:=0;last_target uuid;reasons text[];
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job FOR UPDATE;
 IF NOT FOUND OR work.kind<>'associate' OR work.policy_version<>'actual-association/1' OR work.state<>'leased'
  OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN 'lease_lost';END IF;
 SELECT * INTO source FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 SELECT * INTO n FROM public.v2_normalised_actuals WHERE subject_id=source.id;
 IF source.kind<>'actual_journey' OR source.lifecycle<>'active' OR source.input_generation<>work.requested_generation
  OR n.subject_id IS NULL OR n.input_generation<>source.input_generation THEN
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  RETURN 'superseded';END IF;
 proof:=public.v2_current_intake_evidence(source.id);
 IF cardinality(proof)=0 THEN RAISE EXCEPTION 'actual_input_inactive' USING ERRCODE='40001';END IF;
 SELECT revision INTO epoch FROM public.v2_actual_catalog WHERE intended_subject_id=n.intended_subject_id;epoch:=COALESCE(epoch,0);
 SELECT * INTO scan FROM public.v2_actual_scans WHERE job_id=job;
 IF scan.job_id IS NULL OR scan.catalog_revision<>epoch OR scan.source_revision<>source.revision OR scan.input_digest<>n.input_digest THEN
  INSERT INTO public.v2_actual_scans(job_id,subject_id,source_revision,catalog_revision,input_digest)
   VALUES(job,source.id,source.revision,epoch,n.input_digest)
   ON CONFLICT(job_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,catalog_revision=EXCLUDED.catalog_revision,
    input_digest=EXCLUDED.input_digest,cursor_subject_id=NULL,pages_completed=0;
  SELECT * INTO scan FROM public.v2_actual_scans WHERE job_id=job;
 END IF;
 FOR target IN SELECT r.subject_id id,s.revision,s.input_generation FROM public.v2_runs r
  JOIN public.v2_subjects s ON s.id=r.subject_id
  JOIN public.v2_patterns p ON p.subject_id=r.pattern_subject_id
  WHERE n.intended_subject_id IN(r.subject_id,r.service_plan_subject_id,r.pattern_subject_id,p.route_subject_id)
   AND (scan.cursor_subject_id IS NULL OR r.subject_id>scan.cursor_subject_id) ORDER BY r.subject_id LIMIT 50 LOOP
  pages:=pages+1;last_target:=target.id;context:=public.v2_actual_run_context(source.id,target.id);
  IF context IS NULL THEN CONTINUE;END IF;
  reasons:=ARRAY['declared_service_context','actual_schedule_distinct','identity_review_required','no_recurrence_inferred'];
  IF context->>'intendedKind'<>'run' THEN reasons:=array_append(reasons,'intended_parent_not_a_run');END IF;
  IF context->>'declaredDate' IS NULL THEN reasons:=array_append(reasons,'service_date_unprovided');END IF;
  basis:=public.v2_assessment_hash(jsonb_build_object('policy','actual-association/1','source',source.id,'context',context));
  IF EXISTS(SELECT 1 FROM public.v2_association_candidates c JOIN public.v2_association_decisions d ON d.id=c.last_decision_id
   WHERE c.from_subject_id=source.id AND c.to_subject_id=target.id AND c.rule_version='actual-association/1'
    AND c.basis_digest=basis AND NOT d.invalidated AND NOT d.erased AND d.action IN('accept','reject')) THEN CONTINUE;END IF;
  digest:=public.v2_assessment_hash(jsonb_build_object('basis',basis,'sourceRevision',source.revision,'sourceGeneration',source.input_generation,
   'targetRevision',target.revision,'targetGeneration',target.input_generation));
  candidate:=NULL;
  INSERT INTO public.v2_association_candidates(from_subject_id,from_kind,to_subject_id,to_kind,relation,evidence_digest,reason_codes,
   rule_version,source_revision,target_revision,basis_digest)
  VALUES(source.id,'actual_journey',target.id,'run','same_service',digest,reasons,'actual-association/1',source.revision,target.revision,basis)
   ON CONFLICT DO NOTHING RETURNING id INTO candidate;
  IF candidate IS NOT NULL THEN INSERT INTO public.v2_candidate_evidence SELECT candidate,i FROM unnest(proof) i;END IF;
 END LOOP;
 UPDATE public.v2_actual_scans SET cursor_subject_id=COALESCE(last_target,cursor_subject_id),pages_completed=pages_completed+1 WHERE job_id=job;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 IF pages=50 THEN
  UPDATE public.v2_jobs SET state='pending',lease_token=NULL,lease_until=NULL,available_at=clock_timestamp(),max_attempts=max_attempts+1,last_error_code=NULL WHERE id=job;
  RETURN 'continued';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_object('policy','actual-association/1','input',n.input_digest,'catalog',epoch,'generation',source.input_generation));
 INSERT INTO public.v2_job_effects VALUES(job,'actual-association/1',digest,source.revision,clock_timestamp()) ON CONFLICT DO NOTHING;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
  VALUES('assess',source.id,source.input_generation,'evidence/1',source.id) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;
 RETURN 'done';
END; $$;

CREATE FUNCTION public.v2_generated_actual_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.v2_association_candidates;context jsonb;
BEGIN
 SELECT * INTO c FROM public.v2_association_candidates WHERE id=NEW.candidate_id;
 IF c.rule_version<>'actual-association/1' THEN RETURN NEW;END IF;
 context:=public.v2_actual_run_context(c.from_subject_id,c.to_subject_id);
 IF context IS NULL OR c.basis_digest IS DISTINCT FROM public.v2_assessment_hash(
  jsonb_build_object('policy','actual-association/1','source',c.from_subject_id,'context',context)) THEN
  RAISE EXCEPTION 'actual_relation_context_changed' USING ERRCODE='40001';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_generated_actual_link_guard BEFORE INSERT ON public.v2_association_links FOR EACH ROW EXECUTE FUNCTION public.v2_generated_actual_link_guard();

DO $$ DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_intake_correction_members','v2_normalised_actuals','v2_actual_input_evidence','v2_actual_catalog','v2_actual_scans'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY v2_actual_api ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_actual_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;
  END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('v2_mark_intake_correction','v2_current_intake_evidence','v2_journey_parent_ids','v2_actual_run_context','v2_wake_actual_work','v2_actual_work_change',
   'v2_worker_finish_actual_normalise','v2_worker_finish_actual','v2_generated_actual_link_guard') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;
  END LOOP;
 END LOOP;
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_finish_normalise(uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'1f814c4041c92fed1cea77ce6bda0aaa381a80b842d4416b86961e233a1f7c59'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_finish_normalise(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; subject public.v2_subjects; lead public.v2_leads;
 operator_fact public.v2_observations; departure_fact public.v2_observations;
 operator_revision bigint; departure_revision bigint; operator_key text; digest text; seconds integer;
BEGIN
 -- Same structural order as all reviewed writers/erasure before job + subject locks.
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job FOR UPDATE;
 IF NOT FOUND OR work.kind<>'normalise' OR work.policy_version<>'intake/1' OR work.state<>'leased'
  OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN 'lease_lost'; END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation THEN
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  IF subject.lifecycle='active' THEN
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
    VALUES('normalise',subject.id,subject.input_generation,'intake/1',subject.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN 'superseded';
 END IF;
 IF subject.kind='actual_journey' THEN RETURN public.v2_worker_finish_actual_normalise(job,token);END IF;
 IF subject.kind<>'lead' THEN RAISE EXCEPTION 'unsupported_subject' USING ERRCODE='23514'; END IF;
 SELECT * INTO lead FROM public.v2_leads WHERE subject_id=subject.id;
 IF lead.intake_kind<>'community' OR lead.initial_contribution_id IS NULL OR lead.attribution_erased THEN
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  RETURN 'superseded';
 END IF;
 SELECT o.* INTO operator_fact FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id
  WHERE o.id=ANY(public.v2_current_intake_evidence(subject.id)) AND o.field_key='operator.reported' AND s.status='active'
   AND public.v2_observation_subject(o.id)=subject.id ORDER BY o.id LIMIT 1;
 SELECT o.* INTO departure_fact FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id
  WHERE o.id=ANY(public.v2_current_intake_evidence(subject.id)) AND o.field_key='departure.reported' AND s.status='active'
   AND public.v2_observation_subject(o.id)=subject.id ORDER BY o.id LIMIT 1;
 IF operator_fact.id IS NULL OR departure_fact.id IS NULL OR EXISTS(SELECT 1 FROM public.v2_observations o WHERE o.id=ANY(public.v2_current_intake_evidence(subject.id)) AND o.field_key IN('operator.reported','departure.reported') GROUP BY o.field_key HAVING count(*)>1) THEN
  DELETE FROM public.v2_normalised_leads WHERE subject_id=subject.id;
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  RETURN 'superseded';
 END IF;
 operator_key:=public.v2_operator_search_key(operator_fact.value->>'name');
 seconds:=substring(departure_fact.value->>'time',1,2)::integer*3600+substring(departure_fact.value->>'time',4,2)::integer*60;
 SELECT revision INTO operator_revision FROM public.v2_observation_states WHERE observation_id=operator_fact.id;
 SELECT revision INTO departure_revision FROM public.v2_observation_states WHERE observation_id=departure_fact.id;
 digest:=public.v2_assessment_hash(jsonb_build_object('policy','normalise/1','generation',subject.input_generation,'corridor',lead.corridor_id,
  'operatorObservation',operator_fact.id,'operatorRevision',operator_revision,'operatorKey',operator_key,'operatorId',operator_fact.operator_ref,
  'departureObservation',departure_fact.id,'departureRevision',departure_revision,'seconds',seconds,'basis',departure_fact.value->>'basis'));
 INSERT INTO public.v2_normalised_leads(subject_id,contribution_id,operator_observation_id,departure_observation_id,input_generation,policy_version,
  corridor_id,operator_key,operator_subject_id,departure_seconds,time_basis,input_digest)
 VALUES(subject.id,lead.initial_contribution_id,operator_fact.id,departure_fact.id,subject.input_generation,'normalise/1',lead.corridor_id,
  operator_key,operator_fact.operator_ref,seconds,departure_fact.value->>'basis',digest)
 ON CONFLICT(subject_id) DO UPDATE SET contribution_id=EXCLUDED.contribution_id,operator_observation_id=EXCLUDED.operator_observation_id,
  departure_observation_id=EXCLUDED.departure_observation_id,input_generation=EXCLUDED.input_generation,policy_version=EXCLUDED.policy_version,
  corridor_id=EXCLUDED.corridor_id,operator_key=EXCLUDED.operator_key,operator_subject_id=EXCLUDED.operator_subject_id,
  departure_seconds=EXCLUDED.departure_seconds,time_basis=EXCLUDED.time_basis,input_digest=EXCLUDED.input_digest,normalised_at=clock_timestamp();
 INSERT INTO public.v2_job_effects(job_id,stage,input_digest,result_revision) VALUES(job,'normalise/1',digest,subject.revision) ON CONFLICT DO NOTHING;
 -- One next-stage intent per subject/generation/policy, even when triggers differ.
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
  VALUES('associate',subject.id,subject.input_generation,'association/1',subject.id) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001'; END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;
 RETURN 'done';
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_claim_associate()'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'33a06b31c09214dceebcf313d772ca2266fbdb0de633563f1b63904b2ed6a704'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_claim_associate() RETURNS public.v2_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; scanned integer:=0;
BEGIN
 LOOP
  SELECT * INTO work FROM public.v2_jobs
   WHERE kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1')
    AND ((state='pending' AND available_at<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp()))
   ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF work.attempt>=work.max_attempts THEN
   UPDATE public.v2_jobs SET state='failed',lease_token=NULL,lease_until=NULL,last_error_code='lease_expired',completed_at=clock_timestamp() WHERE id=work.id;
   scanned:=scanned+1;
   IF scanned>=20 THEN RETURN NULL; END IF;
   CONTINUE;
  END IF;
  UPDATE public.v2_jobs SET state='leased',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',
   attempt=attempt+1,completed_at=NULL WHERE id=work.id RETURNING * INTO work;
  RETURN work;
 END LOOP;
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_heartbeat_associate(uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'f450df69316d92a60bd5afabfa53d98588500f5cd2cfa015d7f8a4b2ae51b5f4'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_heartbeat_associate(job uuid,token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_jobs j SET lease_until=clock_timestamp()+interval '120 seconds'
  WHERE j.id=job AND j.kind='associate' AND j.policy_version IN('association/1','pattern-association/1','actual-association/1') AND j.state='leased'
   AND j.lease_token=token AND j.lease_until>clock_timestamp()
   AND EXISTS(SELECT 1 FROM public.v2_subjects s WHERE s.id=j.subject_id AND s.lifecycle='active' AND s.input_generation=j.requested_generation);
 RETURN FOUND;
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_fail_associate(uuid,uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'d28c37dde521d064806ad01b73fb0117444d5b7aa804d084096598dcbc1411f9'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_fail_associate(job uuid,token uuid,error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; delay_seconds double precision;
BEGIN
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1') FOR UPDATE;
 IF NOT FOUND OR work.state<>'leased' OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 IF error_code IS NULL OR error_code NOT IN ('processing_error','invalid_input','unsupported_subject','serialization_retry','deadlock_retry','statement_timeout') THEN error_code:='processing_error'; END IF;
 delay_seconds:=LEAST(30*power(2,LEAST(work.attempt-1,7)),3600)*(1+random()*0.1);
 UPDATE public.v2_jobs SET state=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'pending' END,
  available_at=clock_timestamp()+make_interval(secs=>delay_seconds),lease_token=NULL,lease_until=NULL,last_error_code=error_code,
  completed_at=CASE WHEN attempt>=max_attempts THEN clock_timestamp() ELSE NULL END WHERE id=job;
 RETURN true;
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_retry_associate(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'931da5df881938b789e9734fafa9ac0033def7a58e11a35b0e7bca50ee6bbe9d'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_retry_associate(job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; subject public.v2_subjects;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1') FOR UPDATE;
 IF NOT FOUND OR work.state<>'failed' THEN RETURN false; END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation THEN RETURN false; END IF;
 UPDATE public.v2_jobs SET state='pending',max_attempts=attempt+8,available_at=clock_timestamp(),completed_at=NULL WHERE id=job;
 RETURN true;
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_finish_associate(uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'e206a086a7f0fa4a52f5a7cad211f3a1bb37c3b82301b25aa80a82b49fb40c22'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_finish_associate(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy text;
BEGIN
 SELECT policy_version INTO policy FROM public.v2_jobs WHERE id=job AND kind='associate';
 IF policy='association/1' THEN RETURN public.v2_worker_finish_lead(job,token);
 ELSIF policy='pattern-association/1' THEN RETURN public.v2_worker_finish_pattern(job,token);
 ELSIF policy='actual-association/1' THEN RETURN public.v2_worker_finish_actual(job,token);END IF;
 RETURN 'lease_lost';
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_drain_associate(integer)'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'871a10d34ceaf24267e26e3389bfd0ecd9e8495280895f458660adc9e0f3caa2'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_drain_associate(batch_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; result text; done_count integer:=0; superseded_count integer:=0; failure_count integer:=0; continued_count integer:=0; safe_code text;pattern_done integer:=0;pattern_superseded integer:=0;pattern_failed integer:=0;pattern_continued integer:=0;actual_done integer:=0;actual_superseded integer:=0;actual_failed integer:=0;actual_continued integer:=0;
BEGIN
 IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'worker_batch_invalid' USING ERRCODE='23514'; END IF;
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 FOR n IN 1..batch_limit LOOP
  work:=public.v2_worker_claim_associate();
  IF work.id IS NULL THEN EXIT; END IF;
  BEGIN
   result:=public.v2_worker_finish_associate(work.id,work.lease_token);
   IF result='done' THEN done_count:=done_count+1;
   ELSIF result='superseded' THEN superseded_count:=superseded_count+1;
   ELSIF result='continued' THEN continued_count:=continued_count+1; END IF;
   IF work.policy_version='actual-association/1' THEN
    IF result='done' THEN actual_done:=actual_done+1;ELSIF result='superseded' THEN actual_superseded:=actual_superseded+1;ELSIF result='continued' THEN actual_continued:=actual_continued+1;END IF;
   END IF;
   IF work.policy_version='pattern-association/1' THEN
    IF result='done' THEN pattern_done:=pattern_done+1;ELSIF result='superseded' THEN pattern_superseded:=pattern_superseded+1;ELSIF result='continued' THEN pattern_continued:=pattern_continued+1;END IF;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   safe_code:=CASE SQLSTATE WHEN '40001' THEN 'serialization_retry' WHEN '40P01' THEN 'deadlock_retry' ELSE 'processing_error' END;
   PERFORM public.v2_worker_fail_associate(work.id,work.lease_token,safe_code);failure_count:=failure_count+1;
   IF work.policy_version='pattern-association/1' THEN pattern_failed:=pattern_failed+1;END IF;
   IF work.policy_version='actual-association/1' THEN actual_failed:=actual_failed+1;END IF;
  END;
 END LOOP;
 INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts,last_continued)
  VALUES('association/1',clock_timestamp(),done_count,superseded_count,failure_count,continued_count)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,
  last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts,last_continued=EXCLUDED.last_continued;
 INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts,last_continued)
  VALUES('pattern-association/1',clock_timestamp(),pattern_done,pattern_superseded,pattern_failed,pattern_continued)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts,last_continued=EXCLUDED.last_continued;
 INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts,last_continued)
  VALUES('actual-association/1',clock_timestamp(),actual_done,actual_superseded,actual_failed,actual_continued)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts,last_continued=EXCLUDED.last_continued;
 RETURN jsonb_build_object('done',done_count,'superseded',superseded_count,'failedAttempts',failure_count,'continued',continued_count);
END; $$;

DO $journey_verified$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_health()'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'6882602a75401cfe9f3a3a78dc970a47335b374dedbae1eb1a1f781fc56faba0'
  OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION 'journey_prior_function_changed';END IF;
END;$journey_verified$;
CREATE OR REPLACE FUNCTION public.v2_worker_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('normalise',public.v2_worker_stage_health('normalise','intake/1','normalise/1'),
  'associate',public.v2_worker_stage_health('associate','association/1','association/1'),
  'actual',public.v2_worker_stage_health('associate','actual-association/1','actual-association/1'),
  'pattern',public.v2_worker_stage_health('associate','pattern-association/1','pattern-association/1'),
  'failedJobs',COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,kind,policy_version,attempt,max_attempts,last_error_code,completed_at FROM public.v2_jobs
   WHERE ((kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1'))) AND state='failed' ORDER BY completed_at,id LIMIT 20) x),'[]'::jsonb),
  'otherPendingStages',(SELECT count(*) FROM public.v2_jobs WHERE state='pending'
   AND NOT ((kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1')))));
$$;
