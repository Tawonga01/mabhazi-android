-- First executable stage. No association, confidence, publication or timetable promotion.
CREATE TABLE public.v2_normalised_leads (
 subject_id uuid PRIMARY KEY REFERENCES public.v2_subjects(id) ON DELETE CASCADE,
 contribution_id uuid NOT NULL REFERENCES public.v2_contributions(id) ON DELETE CASCADE,
 operator_observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 departure_observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 input_generation bigint NOT NULL CHECK(input_generation>=1),
 policy_version text NOT NULL CHECK(policy_version='normalise/1'),
 corridor_id uuid NOT NULL REFERENCES public.v2_corridors(id),
 operator_key text, operator_subject_id uuid REFERENCES public.v2_operators(subject_id),
 departure_seconds integer NOT NULL CHECK(departure_seconds BETWEEN 0 AND 86399),
 time_basis text NOT NULL CHECK(time_basis IN ('unspecified','scheduled','actual')),
 input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 normalised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(operator_key,operator_subject_id)=1),
 CHECK(operator_key IS NULL OR length(operator_key) BETWEEN 1 AND 120)
);
ALTER TABLE public.v2_normalised_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_normalised_leads FROM PUBLIC,mabhazi_api;
GRANT SELECT ON public.v2_normalised_leads TO mabhazi_api;
CREATE POLICY v2_normalised_leads_api ON public.v2_normalised_leads FOR SELECT TO mabhazi_api USING(true);

CREATE TABLE public.v2_worker_status (
 runner_key text PRIMARY KEY CHECK(runner_key='normalise/1'),
 last_completed_at timestamptz NOT NULL,
 last_done integer NOT NULL CHECK(last_done BETWEEN 0 AND 20),
 last_superseded integer NOT NULL CHECK(last_superseded BETWEEN 0 AND 20),
 last_failed_attempts integer NOT NULL CHECK(last_failed_attempts BETWEEN 0 AND 20)
);
ALTER TABLE public.v2_worker_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_worker_status FROM PUBLIC,mabhazi_api;
GRANT SELECT ON public.v2_worker_status TO mabhazi_api;
CREATE POLICY v2_worker_status_api ON public.v2_worker_status FOR SELECT TO mabhazi_api USING(true);

-- Keys are candidate hints, never authority for merging same-named operators.
CREATE FUNCTION public.v2_operator_search_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT lower(regexp_replace(btrim(value),'[[:space:]]+',' ','g'));
$$;
CREATE FUNCTION public.v2_invalidate_normalised_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='v2_subjects' THEN
  IF OLD.input_generation IS DISTINCT FROM NEW.input_generation OR OLD.lifecycle IS DISTINCT FROM NEW.lifecycle THEN
   DELETE FROM public.v2_normalised_leads WHERE subject_id=NEW.id;
   IF NEW.lifecycle='active' AND EXISTS(SELECT 1 FROM public.v2_jobs j WHERE j.subject_id=NEW.id AND j.kind='normalise' AND j.policy_version='intake/1')
    AND EXISTS(SELECT 1 FROM public.v2_leads l JOIN public.v2_contributions c ON c.id=l.initial_contribution_id
    WHERE l.subject_id=NEW.id AND l.intake_kind='community' AND NOT l.attribution_erased) THEN
    INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     VALUES('normalise',NEW.id,NEW.input_generation,'intake/1',NEW.id) ON CONFLICT DO NOTHING;
   END IF;
  END IF;
 ELSE
  DELETE FROM public.v2_normalised_leads WHERE operator_observation_id=NEW.observation_id OR departure_observation_id=NEW.observation_id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_normalised_generation AFTER UPDATE ON public.v2_subjects
 FOR EACH ROW EXECUTE FUNCTION public.v2_invalidate_normalised_lead();
CREATE TRIGGER v2_normalised_observation_state AFTER UPDATE ON public.v2_observation_states
 FOR EACH ROW EXECUTE FUNCTION public.v2_invalidate_normalised_lead();

-- API role can inspect reference-only queue state but cannot bypass lease fencing.
REVOKE INSERT,UPDATE,DELETE ON public.v2_jobs,public.v2_job_effects FROM mabhazi_api;
DROP POLICY api_server_access ON public.v2_jobs;
DROP POLICY api_server_access ON public.v2_job_effects;
CREATE POLICY v2_jobs_api ON public.v2_jobs FOR SELECT TO mabhazi_api USING(true);
CREATE POLICY v2_job_effects_api ON public.v2_job_effects FOR SELECT TO mabhazi_api USING(true);
-- Existing backend deletion cascades must still cancel queue references after DML revocation.
ALTER FUNCTION public.v2_erase_contribution_lineage() SECURITY DEFINER;

CREATE FUNCTION public.v2_worker_claim_normalise() RETURNS public.v2_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; scanned integer:=0;
BEGIN
 LOOP
  SELECT * INTO work FROM public.v2_jobs
   WHERE kind='normalise' AND policy_version='intake/1'
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

CREATE FUNCTION public.v2_worker_heartbeat_normalise(job uuid,token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_jobs j SET lease_until=clock_timestamp()+interval '120 seconds'
  WHERE j.id=job AND j.kind='normalise' AND j.policy_version='intake/1' AND j.state='leased'
   AND j.lease_token=token AND j.lease_until>clock_timestamp()
   AND EXISTS(SELECT 1 FROM public.v2_subjects s WHERE s.id=j.subject_id AND s.lifecycle='active' AND s.input_generation=j.requested_generation);
 RETURN FOUND;
END; $$;

CREATE FUNCTION public.v2_worker_fail_normalise(job uuid,token uuid,error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; delay_seconds double precision;
BEGIN
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='normalise' AND policy_version='intake/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'leased' OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 IF error_code IS NULL OR error_code NOT IN ('processing_error','invalid_input','unsupported_subject','serialization_retry','deadlock_retry','statement_timeout') THEN error_code:='processing_error'; END IF;
 delay_seconds:=LEAST(30*power(2,LEAST(work.attempt-1,7)),3600)*(1+random()*0.1);
 UPDATE public.v2_jobs SET state=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'pending' END,
  available_at=clock_timestamp()+make_interval(secs=>delay_seconds),lease_token=NULL,lease_until=NULL,last_error_code=error_code,
  completed_at=CASE WHEN attempt>=max_attempts THEN clock_timestamp() ELSE NULL END WHERE id=job;
 RETURN true;
END; $$;

CREATE FUNCTION public.v2_worker_finish_normalise(job uuid,token uuid) RETURNS text
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
 IF subject.kind<>'lead' THEN RAISE EXCEPTION 'unsupported_subject' USING ERRCODE='23514'; END IF;
 SELECT * INTO lead FROM public.v2_leads WHERE subject_id=subject.id;
 IF lead.intake_kind<>'community' OR lead.initial_contribution_id IS NULL OR lead.attribution_erased THEN
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  RETURN 'superseded';
 END IF;
 SELECT o.* INTO operator_fact FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id
  WHERE o.contribution_id=lead.initial_contribution_id AND o.field_key='operator.reported' AND s.status='active'
   AND public.v2_observation_subject(o.id)=subject.id ORDER BY o.id LIMIT 1;
 SELECT o.* INTO departure_fact FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id
  WHERE o.contribution_id=lead.initial_contribution_id AND o.field_key='departure.reported' AND s.status='active'
   AND public.v2_observation_subject(o.id)=subject.id ORDER BY o.id LIMIT 1;
 IF operator_fact.id IS NULL OR departure_fact.id IS NULL THEN
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

-- Database scheduler can drain this bounded SQL-only stage independently of Render.
-- A crash rolls back the tick; external TS workers use separately committed leases.
CREATE FUNCTION public.v2_worker_drain_normalise(batch_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; result text; done_count integer:=0; superseded_count integer:=0; failure_count integer:=0; safe_code text;
BEGIN
 IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'worker_batch_invalid' USING ERRCODE='23514'; END IF;
 -- The whole SQL tick shares a transaction; take structural guard before any job.
 -- External workers commit their claim before opening an effect transaction.
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 FOR n IN 1..batch_limit LOOP
  work:=public.v2_worker_claim_normalise();
  IF work.id IS NULL THEN EXIT; END IF;
  BEGIN
   result:=public.v2_worker_finish_normalise(work.id,work.lease_token);
   IF result='done' THEN done_count:=done_count+1;
   ELSIF result='superseded' THEN superseded_count:=superseded_count+1; END IF;
  EXCEPTION WHEN OTHERS THEN
   safe_code:=CASE SQLSTATE WHEN '40001' THEN 'serialization_retry' WHEN '40P01' THEN 'deadlock_retry' ELSE 'processing_error' END;
   PERFORM public.v2_worker_fail_normalise(work.id,work.lease_token,safe_code); failure_count:=failure_count+1;
  END;
 END LOOP;
 INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts)
  VALUES('normalise/1',clock_timestamp(),done_count,superseded_count,failure_count)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,
  last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts;
 RETURN jsonb_build_object('done',done_count,'superseded',superseded_count,'failedAttempts',failure_count);
END; $$;

CREATE FUNCTION public.v2_worker_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('normalise',jsonb_build_object(
  'pending',(SELECT count(*) FROM public.v2_jobs WHERE kind='normalise' AND policy_version='intake/1' AND state='pending'),
  'leased',(SELECT count(*) FROM public.v2_jobs WHERE kind='normalise' AND policy_version='intake/1' AND state='leased'),
  'failed',(SELECT count(*) FROM public.v2_jobs WHERE kind='normalise' AND policy_version='intake/1' AND state='failed'),
  'expiredLeases',(SELECT count(*) FROM public.v2_jobs WHERE kind='normalise' AND policy_version='intake/1' AND state='leased' AND lease_until<=statement_timestamp()),
  'oldestDueAt',(SELECT min(available_at) FROM public.v2_jobs WHERE kind='normalise' AND policy_version='intake/1' AND state='pending' AND available_at<=statement_timestamp()),
  'lastCompletedAt',(SELECT last_completed_at FROM public.v2_worker_status WHERE runner_key='normalise/1')),
  'failedJobs',COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,attempt,max_attempts,last_error_code,completed_at FROM public.v2_jobs
   WHERE kind='normalise' AND policy_version='intake/1' AND state='failed' ORDER BY completed_at,id LIMIT 20) x),'[]'::jsonb),
  'otherPendingStages',(SELECT count(*) FROM public.v2_jobs WHERE kind<>'normalise' AND state='pending'));
$$;

-- Explicit owner operation, preserving lifetime attempt count and stale-job fencing.
CREATE FUNCTION public.v2_worker_retry_normalise(job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs; subject public.v2_subjects;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='normalise' AND policy_version='intake/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'failed' THEN RETURN false; END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation THEN RETURN false; END IF;
 UPDATE public.v2_jobs SET state='pending',max_attempts=attempt+8,available_at=clock_timestamp(),completed_at=NULL WHERE id=job;
 RETURN true;
END; $$;

-- All helpers deny hosted clients/default grants; only narrow worker facades to API.
DO $$ DECLARE r text; f record; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.v2_normalised_leads,public.v2_worker_status FROM %I',r);
  END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('v2_operator_search_key','v2_invalidate_normalised_lead','v2_worker_claim_normalise','v2_worker_heartbeat_normalise',
   'v2_worker_fail_normalise','v2_worker_finish_normalise','v2_worker_drain_normalise','v2_worker_retry_normalise','v2_worker_health') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r); END IF;
  END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_worker_claim_normalise(),public.v2_worker_heartbeat_normalise(uuid,uuid),
 public.v2_worker_fail_normalise(uuid,uuid,text),public.v2_worker_finish_normalise(uuid,uuid),public.v2_worker_drain_normalise(integer),public.v2_worker_health() TO mabhazi_api;
