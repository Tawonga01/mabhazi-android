CREATE FUNCTION public.v2_worker_stage_health(stage text,policy text,runner text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'pending',(SELECT count(*) FROM public.v2_jobs WHERE kind=stage AND policy_version=policy AND state='pending'),
  'leased',(SELECT count(*) FROM public.v2_jobs WHERE kind=stage AND policy_version=policy AND state='leased'),
  'failed',(SELECT count(*) FROM public.v2_jobs WHERE kind=stage AND policy_version=policy AND state='failed'),
  'expiredLeases',(SELECT count(*) FROM public.v2_jobs WHERE kind=stage AND policy_version=policy AND state='leased' AND lease_until<=statement_timestamp()),
  'oldestDueAt',(SELECT min(available_at) FROM public.v2_jobs WHERE kind=stage AND policy_version=policy AND state='pending' AND available_at<=statement_timestamp()),
  'lastCompletedAt',(SELECT last_completed_at FROM public.v2_worker_status WHERE runner_key=runner));
$$;

CREATE FUNCTION public.v2_worker_claim_associate() RETURNS public.v2_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; scanned integer:=0;
BEGIN
 LOOP
  SELECT * INTO work FROM public.v2_jobs
   WHERE kind='associate' AND policy_version='association/1'
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

CREATE FUNCTION public.v2_worker_heartbeat_associate(job uuid,token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_jobs j SET lease_until=clock_timestamp()+interval '120 seconds'
  WHERE j.id=job AND j.kind='associate' AND j.policy_version='association/1' AND j.state='leased'
   AND j.lease_token=token AND j.lease_until>clock_timestamp()
   AND EXISTS(SELECT 1 FROM public.v2_subjects s WHERE s.id=j.subject_id AND s.lifecycle='active' AND s.input_generation=j.requested_generation);
 RETURN FOUND;
END; $$;

CREATE FUNCTION public.v2_worker_fail_associate(job uuid,token uuid,error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; delay_seconds double precision;
BEGIN
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='associate' AND policy_version='association/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'leased' OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 IF error_code IS NULL OR error_code NOT IN ('processing_error','invalid_input','unsupported_subject','serialization_retry','deadlock_retry','statement_timeout') THEN error_code:='processing_error'; END IF;
 delay_seconds:=LEAST(30*power(2,LEAST(work.attempt-1,7)),3600)*(1+random()*0.1);
 UPDATE public.v2_jobs SET state=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'pending' END,
  available_at=clock_timestamp()+make_interval(secs=>delay_seconds),lease_token=NULL,lease_until=NULL,last_error_code=error_code,
  completed_at=CASE WHEN attempt>=max_attempts THEN clock_timestamp() ELSE NULL END WHERE id=job;
 RETURN true;
END; $$;

CREATE FUNCTION public.v2_worker_retry_associate(job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; subject public.v2_subjects;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='associate' AND policy_version='association/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'failed' THEN RETURN false; END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation THEN RETURN false; END IF;
 UPDATE public.v2_jobs SET state='pending',max_attempts=attempt+8,available_at=clock_timestamp(),completed_at=NULL WHERE id=job;
 RETURN true;
END; $$;

-- Lead candidate production only. Pending candidates are not accepted identities.
CREATE TABLE public.v2_association_catalog (
 corridor_id uuid PRIMARY KEY REFERENCES public.v2_corridors(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>=1)
);
CREATE TABLE public.v2_association_scans (
 job_id uuid PRIMARY KEY REFERENCES public.v2_jobs(id) ON DELETE CASCADE,
 subject_id uuid NOT NULL REFERENCES public.v2_normalised_leads(subject_id) ON DELETE CASCADE,
 source_revision bigint NOT NULL CHECK(source_revision>=1),
 catalog_revision bigint NOT NULL CHECK(catalog_revision>=1),
 input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 cursor_subject_id uuid,
 pages_completed integer NOT NULL DEFAULT 0 CHECK(pages_completed>=0)
);
CREATE INDEX v2_association_scans_subject_idx ON public.v2_association_scans(subject_id);
ALTER TABLE public.v2_association_candidates ADD COLUMN basis_digest text CHECK(basis_digest IS NULL OR basis_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE public.v2_association_candidates ADD CONSTRAINT v2_lead_candidate_basis CHECK(rule_version<>'lead-association/1' OR basis_digest IS NOT NULL OR evidence_erased);
CREATE OR REPLACE FUNCTION public.v2_candidate_content_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.evidence_erased THEN NEW.basis_digest:=NULL; END IF;
 IF to_jsonb(NEW)-ARRAY['state','revision','last_decision_id','evidence_erased','evidence_digest','basis_digest']
     <>to_jsonb(OLD)-ARRAY['state','revision','last_decision_id','evidence_erased','evidence_digest','basis_digest']
   OR (OLD.evidence_erased AND NOT NEW.evidence_erased)
   OR (NEW.evidence_digest IS DISTINCT FROM OLD.evidence_digest AND NOT (pg_trigger_depth()>1 AND NEW.evidence_erased AND NEW.evidence_digest IS NULL))
   OR (NEW.basis_digest IS DISTINCT FROM OLD.basis_digest AND NOT (pg_trigger_depth()>1 AND NEW.evidence_erased AND NEW.basis_digest IS NULL)) THEN
   RAISE EXCEPTION 'v2_candidate_content_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
ALTER TABLE public.v2_worker_status DROP CONSTRAINT v2_worker_status_runner_key_check;
ALTER TABLE public.v2_worker_status ADD CONSTRAINT v2_worker_status_runner_key_check CHECK(runner_key IN('normalise/1','association/1'));
ALTER TABLE public.v2_worker_status ADD COLUMN last_continued integer NOT NULL DEFAULT 0 CHECK(last_continued BETWEEN 0 AND 20);

-- Catalog epochs fence cursor pages against edits/additions between transactions.
-- Coalesce pending wakeups; a currently leased scan gets one following intent.
CREATE FUNCTION public.v2_wake_lead_association(corridors uuid[],excluded uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE corridor uuid; event uuid:=gen_random_uuid();
BEGIN
 FOR corridor IN SELECT DISTINCT c FROM unnest(corridors) c WHERE c IS NOT NULL ORDER BY c LOOP
  INSERT INTO public.v2_association_catalog VALUES(corridor,1)
   ON CONFLICT(corridor_id) DO UPDATE SET revision=public.v2_association_catalog.revision+1;
  INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
   SELECT 'associate',n.subject_id,s.input_generation,'association/1',event
    FROM public.v2_normalised_leads n JOIN public.v2_subjects s ON s.id=n.subject_id
    WHERE n.corridor_id=corridor AND s.lifecycle='active' AND n.input_generation=s.input_generation
     AND n.subject_id IS DISTINCT FROM excluded AND NOT EXISTS(SELECT 1 FROM public.v2_jobs j
      WHERE j.kind='associate' AND j.policy_version='association/1' AND j.subject_id=s.id
       AND j.requested_generation=s.input_generation AND j.state='pending') ON CONFLICT DO NOTHING;
 END LOOP;
END; $$;
CREATE FUNCTION public.v2_association_catalog_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row jsonb; new_row jsonb; corridors uuid[]:='{}'; excluded uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='v2_subjects' THEN
  IF NEW.input_generation=OLD.input_generation AND NEW.lifecycle=OLD.lifecycle THEN RETURN NEW; END IF;
  excluded:=NEW.id;
  UPDATE public.v2_association_candidates SET state='obsolete',revision=revision+1
   WHERE rule_version='lead-association/1' AND state='pending' AND last_decision_id IS NULL
    AND NEW.id IN(from_subject_id,to_subject_id);
  SELECT array_agg(corridor_id) INTO corridors FROM (
   SELECT corridor_id FROM public.v2_leads WHERE subject_id=NEW.id
   UNION SELECT corridor_id FROM public.v2_patterns WHERE subject_id=NEW.id
   UNION SELECT p.corridor_id FROM public.v2_runs r JOIN public.v2_patterns p ON p.subject_id=r.pattern_subject_id WHERE r.subject_id=NEW.id
  ) q;
 ELSIF TG_TABLE_NAME='v2_runs' THEN
  excluded:=COALESCE((new_row->>'subject_id')::uuid,(old_row->>'subject_id')::uuid);
  SELECT array_agg(corridor_id) INTO corridors FROM public.v2_patterns
   WHERE subject_id IN((new_row->>'pattern_subject_id')::uuid,(old_row->>'pattern_subject_id')::uuid);
 ELSE
  excluded:=COALESCE((new_row->>'subject_id')::uuid,(old_row->>'subject_id')::uuid);
  corridors:=ARRAY[(new_row->>'corridor_id')::uuid,(old_row->>'corridor_id')::uuid];
 END IF;
 PERFORM public.v2_wake_lead_association(corridors,excluded);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER v2_association_catalog_change AFTER INSERT OR UPDATE OR DELETE ON public.v2_normalised_leads FOR EACH ROW EXECUTE FUNCTION public.v2_association_catalog_change();
CREATE TRIGGER v2_association_catalog_change AFTER INSERT OR UPDATE OR DELETE ON public.v2_patterns FOR EACH ROW EXECUTE FUNCTION public.v2_association_catalog_change();
CREATE TRIGGER v2_association_catalog_change AFTER INSERT OR UPDATE OR DELETE ON public.v2_runs FOR EACH ROW EXECUTE FUNCTION public.v2_association_catalog_change();
CREATE TRIGGER v2_association_subject_change AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_association_catalog_change();
INSERT INTO public.v2_association_catalog(corridor_id,revision)
 SELECT DISTINCT corridor_id,1 FROM public.v2_normalised_leads ON CONFLICT DO NOTHING;

CREATE FUNCTION public.v2_worker_finish_associate(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; source public.v2_subjects; n public.v2_normalised_leads;
 scan public.v2_association_scans; epoch bigint; target record; target_subject public.v2_subjects;
 target_lead public.v2_normalised_leads; candidate_relation text; reasons text[]; target_operator uuid;
 candidate uuid; candidate_digest text; basis text; digest text; page_count integer:=0; last_target uuid;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job FOR UPDATE;
 IF NOT FOUND OR work.kind<>'associate' OR work.policy_version<>'association/1' OR work.state<>'leased'
  OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN 'lease_lost'; END IF;
 SELECT * INTO source FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 SELECT * INTO n FROM public.v2_normalised_leads WHERE subject_id=source.id;
 IF source.lifecycle<>'active' OR source.input_generation<>work.requested_generation
  OR n.subject_id IS NULL OR n.input_generation<>source.input_generation THEN
  DELETE FROM public.v2_association_scans WHERE job_id=job;
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  RETURN 'superseded';
 END IF;
 IF source.kind<>'lead' THEN RAISE EXCEPTION 'unsupported_subject' USING ERRCODE='23514'; END IF;
 SELECT revision INTO epoch FROM public.v2_association_catalog WHERE corridor_id=n.corridor_id;
 IF epoch IS NULL THEN RAISE EXCEPTION 'association_catalog_missing'; END IF;
 SELECT * INTO scan FROM public.v2_association_scans WHERE job_id=job;
 IF scan.job_id IS NULL OR scan.catalog_revision<>epoch OR scan.source_revision<>source.revision OR scan.input_digest<>n.input_digest THEN
  INSERT INTO public.v2_association_scans(job_id,subject_id,source_revision,catalog_revision,input_digest)
   VALUES(job,source.id,source.revision,epoch,n.input_digest)
  ON CONFLICT(job_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,catalog_revision=EXCLUDED.catalog_revision,
   input_digest=EXCLUDED.input_digest,cursor_subject_id=NULL,pages_completed=0 RETURNING * INTO scan;
 END IF;
 -- All candidates in one directed corridor; UUID cursor never caps total results.
 FOR target IN SELECT x.id,x.kind FROM (
  SELECT nl.subject_id id,'lead'::text kind FROM public.v2_normalised_leads nl JOIN public.v2_subjects s ON s.id=nl.subject_id
   WHERE nl.corridor_id=n.corridor_id AND nl.input_generation=s.input_generation AND s.lifecycle='active'
  UNION ALL SELECT p.subject_id,'pattern' FROM public.v2_patterns p JOIN public.v2_subjects s ON s.id=p.subject_id
   WHERE p.corridor_id=n.corridor_id AND s.lifecycle='active'
  UNION ALL SELECT r.subject_id,'run' FROM public.v2_runs r JOIN public.v2_patterns p ON p.subject_id=r.pattern_subject_id
   JOIN public.v2_subjects rs ON rs.id=r.subject_id JOIN public.v2_subjects ps ON ps.id=p.subject_id
   JOIN public.v2_subjects plans ON plans.id=r.service_plan_subject_id
   JOIN public.v2_routes route ON route.subject_id=p.route_subject_id
   JOIN public.v2_subjects routes ON routes.id=route.subject_id
   JOIN public.v2_subjects operators ON operators.id=route.operator_subject_id
   WHERE p.corridor_id=n.corridor_id AND rs.lifecycle='active' AND ps.lifecycle='active' AND plans.lifecycle='active'
    AND routes.lifecycle='active' AND operators.lifecycle='active'
 ) x WHERE x.id<>source.id AND (scan.cursor_subject_id IS NULL OR x.id>scan.cursor_subject_id) ORDER BY x.id LIMIT 50 LOOP
  page_count:=page_count+1;last_target:=target.id;
  SELECT * INTO target_subject FROM public.v2_subjects WHERE id=target.id;
  target_operator:=public.v2_resolved_operator(target.id);
  reasons:=ARRAY['directed_corridor_equal','identity_unresolved'];
  IF n.operator_subject_id IS NOT NULL AND target_operator IS NOT NULL THEN
   reasons:=array_append(reasons,CASE WHEN n.operator_subject_id=target_operator THEN 'known_operator_equal' ELSE 'known_operators_differ' END);
  ELSE reasons:=array_append(reasons,'operator_context_incomplete'); END IF;
  IF target.kind='run' THEN
   -- Unknown names never become resolved operators. Actual/unspecified clocks
   -- never become a planned departure. Unspecified basis remains review context.
   IF n.operator_subject_id IS NULL OR n.operator_subject_id IS DISTINCT FROM target_operator
    OR n.time_basis='actual' OR n.departure_seconds<>(SELECT departure_seconds FROM public.v2_runs WHERE subject_id=target.id) THEN CONTINUE; END IF;
   candidate_relation:='same_service';reasons:=reasons||ARRAY['departure_clock_equal','stop_context_incomplete','service_dates_unprovided','identity_review_required'];
   IF n.time_basis='unspecified' THEN reasons:=array_append(reasons,'time_basis_unspecified'); END IF;
  ELSE
   candidate_relation:='same_corridor';
   IF target.kind='lead' THEN reasons:=array_append(reasons,'corridor_grouping_only');
   ELSE reasons:=array_append(reasons,'pattern_identity_unresolved'); END IF;
  END IF;
  SELECT * INTO target_lead FROM public.v2_normalised_leads WHERE subject_id=target.id;
  -- Rejection persists across worker/derived-generation retries of identical
  -- evidence. Different original facts or structural context permit a new case.
  basis:=public.v2_assessment_hash(jsonb_build_object('policy','lead-association/1','relation',candidate_relation,
   'from',source.id,'corridor',n.corridor_id,'operator',n.operator_subject_id,'operatorKey',n.operator_key,
   'seconds',n.departure_seconds,'timeBasis',n.time_basis,'to',target.id,'snapshot',public.v2_transport_snapshot(target.id),
   'evidence',(SELECT jsonb_agg(jsonb_build_array(observation_id,revision) ORDER BY observation_id) FROM public.v2_observation_states
    WHERE observation_id=ANY(ARRAY[n.operator_observation_id,n.departure_observation_id,target_lead.operator_observation_id,target_lead.departure_observation_id]))));
  IF EXISTS(SELECT 1 FROM public.v2_association_candidates c JOIN public.v2_association_decisions d ON d.id=c.last_decision_id
   WHERE c.from_subject_id=source.id AND c.to_subject_id=target.id AND c.relation=candidate_relation AND c.rule_version='lead-association/1'
    AND c.basis_digest=basis AND d.action='reject' AND NOT d.invalidated AND NOT d.erased) THEN CONTINUE; END IF;
  candidate_digest:=public.v2_assessment_hash(jsonb_build_object('policy','lead-association/1','relation',candidate_relation,'basis',basis,
   'from',source.id,'fromRevision',source.revision,'fromGeneration',source.input_generation,'fromInput',n.input_digest,
   'to',target.id,'toRevision',target_subject.revision,'toGeneration',target_subject.input_generation,
   'toInput',target_lead.input_digest,'toSnapshot',public.v2_transport_snapshot(target.id),'reasons',reasons));
  candidate:=NULL;
  INSERT INTO public.v2_association_candidates(from_subject_id,from_kind,to_subject_id,to_kind,relation,evidence_digest,reason_codes,
   rule_version,source_revision,target_revision,basis_digest)
  VALUES(source.id,'lead',target.id,target.kind,candidate_relation,candidate_digest,reasons,'lead-association/1',source.revision,target_subject.revision,basis)
  ON CONFLICT DO NOTHING RETURNING id INTO candidate;
  IF candidate IS NOT NULL THEN
   INSERT INTO public.v2_candidate_evidence(candidate_id,observation_id)
    SELECT candidate,o.id FROM public.v2_observations o WHERE o.id=ANY(ARRAY[n.operator_observation_id,n.departure_observation_id,
     target_lead.operator_observation_id,target_lead.departure_observation_id]);
  END IF;
 END LOOP;
 UPDATE public.v2_association_scans SET cursor_subject_id=COALESCE(last_target,cursor_subject_id),pages_completed=pages_completed+1 WHERE job_id=job;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001'; END IF;
 IF page_count=50 THEN
  -- A successful page restores one attempt to the failure budget, retaining
  -- lifetime attempts. Large corridors cannot exhaust eight attempts by paging.
  UPDATE public.v2_jobs SET state='pending',lease_token=NULL,lease_until=NULL,available_at=clock_timestamp(),
   max_attempts=max_attempts+1,last_error_code=NULL WHERE id=job;
  RETURN 'continued';
 END IF;
 digest:=public.v2_assessment_hash(jsonb_build_object('policy','lead-association/1','generation',source.input_generation,
  'sourceRevision',source.revision,'input',n.input_digest,'catalogRevision',epoch));
 INSERT INTO public.v2_job_effects(job_id,stage,input_digest,result_revision) VALUES(job,'lead-association/1',digest,source.revision) ON CONFLICT DO NOTHING;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
  VALUES('assess',source.id,source.input_generation,'evidence/1',source.id) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001'; END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;
 RETURN 'done';
END; $$;

CREATE FUNCTION public.v2_worker_drain_associate(batch_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; result text; done_count integer:=0; superseded_count integer:=0; failure_count integer:=0; continued_count integer:=0; safe_code text;
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
  EXCEPTION WHEN OTHERS THEN
   safe_code:=CASE SQLSTATE WHEN '40001' THEN 'serialization_retry' WHEN '40P01' THEN 'deadlock_retry' ELSE 'processing_error' END;
   PERFORM public.v2_worker_fail_associate(work.id,work.lease_token,safe_code);failure_count:=failure_count+1;
  END;
 END LOOP;
 INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts,last_continued)
  VALUES('association/1',clock_timestamp(),done_count,superseded_count,failure_count,continued_count)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,
  last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts,last_continued=EXCLUDED.last_continued;
 RETURN jsonb_build_object('done',done_count,'superseded',superseded_count,'failedAttempts',failure_count,'continued',continued_count);
END; $$;

CREATE OR REPLACE FUNCTION public.v2_worker_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('normalise',public.v2_worker_stage_health('normalise','intake/1','normalise/1'),
  'associate',public.v2_worker_stage_health('associate','association/1','association/1'),
  'failedJobs',COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,kind,policy_version,attempt,max_attempts,last_error_code,completed_at FROM public.v2_jobs
   WHERE ((kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version='association/1')) AND state='failed' ORDER BY completed_at,id LIMIT 20) x),'[]'::jsonb),
  'otherPendingStages',(SELECT count(*) FROM public.v2_jobs WHERE state='pending'
   AND NOT ((kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version='association/1'))));
$$;

DO $$ DECLARE t text; r text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_association_catalog','v2_association_scans'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY v2_association_api ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('v2_wake_lead_association','v2_association_catalog_change','v2_worker_stage_health',
   'v2_worker_claim_associate','v2_worker_heartbeat_associate','v2_worker_fail_associate','v2_worker_retry_associate',
   'v2_worker_finish_associate','v2_worker_drain_associate') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r); END IF;
  END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_worker_claim_associate(),public.v2_worker_heartbeat_associate(uuid,uuid),
 public.v2_worker_fail_associate(uuid,uuid,text),public.v2_worker_finish_associate(uuid,uuid),public.v2_worker_drain_associate(integer) TO mabhazi_api;
