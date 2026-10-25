DO $task_status$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_worker_status'::regclass AND conname='v2_worker_status_runner_key_check' AND contype='c' AND convalidated
 AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]|::text','','g')=$expected$CHECKrunner_key=ANYARRAY['normalise/1','association/1','pattern-association/1','actual-association/1','assessment-worker/1']$expected$)
 THEN RAISE EXCEPTION 'prompt_prior_status_changed';END IF;
END;$task_status$;
ALTER TABLE public.v2_worker_status DROP CONSTRAINT v2_worker_status_runner_key_check;
ALTER TABLE public.v2_worker_status ADD CONSTRAINT v2_worker_status_runner_key_check
 CHECK(runner_key IN('normalise/1','association/1','pattern-association/1','actual-association/1','assessment-worker/1','prompt-refresh/1'));

-- Durable prompts/1 task generation. No invitations, declarations or route facts
-- are created here. Existing registry, eligibility and suppression stay unchanged.
CREATE FUNCTION public.v2_worker_task_scopes(subject uuid)
RETURNS TABLE(registry_key text,field_key text,scope_key text,scope jsonb)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH scopes AS (
  SELECT o.field_key,o.scope_key,o.scope FROM public.v2_observations o WHERE public.v2_observation_subject(o.id)=subject
  UNION SELECT a.field_key,a.scope_key,a.scope FROM public.v2_current_assessments c
   JOIN public.v2_field_assessments a ON a.id=c.assessment_id WHERE c.subject_id=subject AND NOT a.erased
  UNION SELECT t.field_key,t.scope_key,t.scope FROM public.v2_question_tasks t
   WHERE t.subject_id=subject AND t.state IN('open','paused')
  UNION SELECT f,public.v2_assessment_hash('{}'::jsonb),'{}'::jsonb
   FROM unnest(ARRAY['operator.identity','departure.reported','service.calendar','boarding.pickup','pattern.stops']) f
 )
 SELECT DISTINCT r.key,x.field_key,x.scope_key,x.scope FROM scopes x
 JOIN public.v2_subjects s ON s.id=subject
 JOIN public.v2_question_registry r ON r.version='prompts/1' AND s.kind=ANY(r.target_kinds)
  AND ('*'=ANY(r.field_keys) OR x.field_key=ANY(r.field_keys))
 WHERE public.v2_observation_kind_valid(x.field_key,s.kind);
$$;

-- Actor-free question necessity only. The existing reservation/answer functions
-- still require explicit relevant declarations and check live account/context.
CREATE FUNCTION public.v2_worker_task_state(subject uuid,field text,scope jsonb,question text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE kind text;a jsonb;policy text;wanted boolean;has_current boolean;scope_hash text:=public.v2_assessment_hash(scope);
BEGIN
 SELECT s.kind INTO kind FROM public.v2_subjects s WHERE s.id=subject AND s.lifecycle='active';
 IF kind IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_question_registry r WHERE r.key=question AND r.version='prompts/1'
  AND kind=ANY(r.target_kinds) AND ('*'=ANY(r.field_keys) OR field=ANY(r.field_keys))) THEN RETURN jsonb_build_object('state','obsolete');END IF;
 IF kind='lead' AND question<>'identify_service' AND NOT EXISTS(SELECT 1 FROM public.v2_leads
  WHERE subject_id=subject AND corridor_id IS NOT NULL AND reported_departure_seconds IS NOT NULL
   AND num_nonnulls(operator_subject_id,operator_name)=1) THEN RETURN jsonb_build_object('state','obsolete');END IF;
 IF kind='actual_journey' AND NOT EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_observation_states st ON st.observation_id=o.id
  WHERE public.v2_observation_subject(o.id)=subject AND st.status='active') THEN RETURN jsonb_build_object('state','obsolete');END IF;
 IF question='identify_service' THEN
  wanted:=(kind='lead' AND EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=subject AND operator_subject_id IS NULL))
   OR (kind='actual_journey' AND EXISTS(SELECT 1 FROM public.v2_actual_journeys WHERE subject_id=subject AND association_status='unresolved'));
  RETURN jsonb_build_object('state',CASE WHEN wanted THEN 'open' ELSE 'satisfied' END);
 END IF;
 IF question='clarify_time_basis' THEN
  wanted:=EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_observation_states st ON st.observation_id=o.id
   WHERE public.v2_observation_subject(o.id)=subject AND st.status='active' AND o.field_key='departure.reported'
    AND o.scope_key=scope_hash AND o.value->>'basis'='unspecified');
  RETURN jsonb_build_object('state',CASE WHEN wanted THEN 'open' ELSE 'satisfied' END);
 END IF;
 -- This constant is solely a validator probe; no money value/currency is saved.
 IF field LIKE 'fare.%' AND public.v2_intake_observation_valid(field,'{"amount":"0","currency":"USD"}'::jsonb,scope) IS NOT TRUE
  THEN RETURN jsonb_build_object('state','obsolete');END IF;
 SELECT version INTO policy FROM public.v2_evidence_policy_state WHERE id;
 a:=public.v2_evaluate_assessment(subject,field,scope,statement_timestamp(),policy);
 has_current:=EXISTS(SELECT 1 FROM jsonb_array_elements(a->'candidates') x WHERE x->>'freshness'='current');
 IF question='resolve_conflict_context' THEN wanted:=a->>'dispute'='open';
 ELSIF question='confirm_current_fact' THEN wanted:=EXISTS(SELECT 1 FROM jsonb_array_elements(a->'inputs') x
  WHERE x->>'freshness' IN('recheck_due','expired') AND x->>'evidenceDate' IS NOT NULL
   AND x->>'reason' NOT IN('hidden','withdrawn','superseded','future_or_invalid_date','not_yet_effective'));
 ELSE wanted:=NOT has_current;
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN wanted THEN 'open' WHEN has_current THEN 'satisfied' ELSE 'obsolete' END,
  'nextChangeAt',a->'nextChangeAt');
END;$$;

CREATE FUNCTION public.v2_worker_finish_tasks(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE work public.v2_jobs;subject public.v2_subjects;item record;outcome jsonb;digest text;next_change timestamptz;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job FOR UPDATE;
 IF NOT FOUND OR work.kind<>'refresh_tasks' OR work.policy_version<>'prompts/1' OR work.state<>'leased'
  OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN 'lease_lost';END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation THEN
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  IF subject.lifecycle='active' THEN
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
    VALUES('refresh_tasks',subject.id,subject.input_generation,'prompts/1',work.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN 'superseded';
 END IF;
 FOR item IN SELECT x.* FROM public.v2_worker_task_scopes(subject.id) x
  WHERE NOT EXISTS(SELECT 1 FROM public.v2_job_effects e WHERE e.job_id=job AND e.stage='prompt-scope/1'
   AND e.input_digest=public.v2_assessment_hash(jsonb_build_array(x.registry_key,x.field_key,x.scope_key)))
  ORDER BY x.registry_key,x.field_key,x.scope_key LIMIT 10 LOOP
  outcome:=public.v2_worker_task_state(subject.id,item.field_key,item.scope,item.registry_key);
  IF outcome->>'state'='open' THEN
   PERFORM public.v2_prompt_put_task(subject.id,item.field_key,item.scope,item.registry_key,subject.input_generation);
  ELSE
   UPDATE public.v2_question_tasks SET state=outcome->>'state' WHERE subject_id=subject.id AND field_key=item.field_key
    AND scope_key=item.scope_key AND registry_key=item.registry_key AND state IN('open','paused');
  END IF;
  next_change:=(outcome->>'nextChangeAt')::timestamptz;
  IF next_change>clock_timestamp() THEN
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id,available_at)
    VALUES('refresh_tasks',subject.id,subject.input_generation,'prompts/1',work.id,next_change)
   ON CONFLICT(kind,subject_id,requested_generation,policy_version,trigger_id) DO UPDATE
    SET available_at=LEAST(v2_jobs.available_at,EXCLUDED.available_at) WHERE v2_jobs.state='pending';
  END IF;
  digest:=public.v2_assessment_hash(jsonb_build_array(item.registry_key,item.field_key,item.scope_key));
  INSERT INTO public.v2_job_effects(job_id,stage,input_digest,result_revision)
   VALUES(job,'prompt-scope/1',digest,subject.revision) ON CONFLICT DO NOTHING;
 END LOOP;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.v2_worker_task_scopes(subject.id) x WHERE NOT EXISTS
  (SELECT 1 FROM public.v2_job_effects e WHERE e.job_id=job AND e.stage='prompt-scope/1'
   AND e.input_digest=public.v2_assessment_hash(jsonb_build_array(x.registry_key,x.field_key,x.scope_key)))) THEN
  UPDATE public.v2_jobs SET state='pending',lease_token=NULL,lease_until=NULL,available_at=clock_timestamp(),
   max_attempts=max_attempts+1,last_error_code=NULL WHERE id=job;
  RETURN 'continued';
 END IF;
 INSERT INTO public.v2_job_effects(job_id,stage,input_digest,result_revision)
  VALUES(job,'prompt-refresh/1',public.v2_assessment_hash(jsonb_build_array('prompts/1',subject.id,subject.input_generation)),subject.revision) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;
 RETURN 'done';
END;$$;

CREATE FUNCTION public.v2_worker_claim_tasks() RETURNS public.v2_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;scanned integer:=0;
BEGIN
 LOOP
  SELECT * INTO work FROM public.v2_jobs
   WHERE kind='refresh_tasks' AND policy_version='prompts/1'
    AND ((state='pending' AND available_at<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp()))
   ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL;END IF;
  IF work.attempt>=work.max_attempts THEN
   UPDATE public.v2_jobs SET state='failed',lease_token=NULL,lease_until=NULL,last_error_code='lease_expired',completed_at=clock_timestamp() WHERE id=work.id;
   scanned:=scanned+1;IF scanned>=20 THEN RETURN NULL;END IF;CONTINUE;
  END IF;
  UPDATE public.v2_jobs SET state='leased',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',
   attempt=attempt+1,completed_at=NULL WHERE id=work.id RETURNING * INTO work;
  RETURN work;
 END LOOP;
END;$$;

CREATE FUNCTION public.v2_worker_heartbeat_tasks(job uuid,token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_jobs j SET lease_until=clock_timestamp()+interval '120 seconds'
 WHERE j.id=job AND j.kind='refresh_tasks' AND j.policy_version='prompts/1' AND j.state='leased'
 AND j.lease_token=token AND j.lease_until>clock_timestamp()
 AND j.policy_version='prompts/1'
 AND EXISTS(SELECT 1 FROM public.v2_subjects s WHERE s.id=j.subject_id AND s.lifecycle='active' AND s.input_generation=j.requested_generation);
 RETURN FOUND;
END;$$;

CREATE FUNCTION public.v2_worker_fail_tasks(job uuid,token uuid,error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;delay_seconds double precision;
BEGIN
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='refresh_tasks' AND policy_version='prompts/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'leased' OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN false;END IF;
 IF error_code IS NULL OR error_code NOT IN('processing_error','invalid_input','unsupported_subject','serialization_retry','deadlock_retry','statement_timeout') THEN error_code:='processing_error';END IF;
 delay_seconds:=LEAST(30*power(2,LEAST(work.attempt-1,7)),3600)*(1+random()*0.1);
 UPDATE public.v2_jobs SET state=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'pending' END,
  available_at=clock_timestamp()+make_interval(secs=>delay_seconds),lease_token=NULL,lease_until=NULL,last_error_code=error_code,
  completed_at=CASE WHEN attempt>=max_attempts THEN clock_timestamp() ELSE NULL END WHERE id=job;
 RETURN true;
END;$$;

CREATE FUNCTION public.v2_worker_drain_tasks(batch_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;result text;done_count integer:=0;superseded_count integer:=0;failure_count integer:=0;continued_count integer:=0;safe_code text;
BEGIN
 IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'worker_batch_invalid' USING ERRCODE='23514';END IF;
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 FOR n IN 1..batch_limit LOOP
  work:=public.v2_worker_claim_tasks();IF work.id IS NULL THEN EXIT;END IF;
  BEGIN
   result:=public.v2_worker_finish_tasks(work.id,work.lease_token);
   IF result='done' THEN done_count:=done_count+1;ELSIF result='superseded' THEN superseded_count:=superseded_count+1;
   ELSIF result='continued' THEN continued_count:=continued_count+1;END IF;
  EXCEPTION WHEN OTHERS THEN
   safe_code:=CASE SQLSTATE WHEN '40001' THEN 'serialization_retry' WHEN '40P01' THEN 'deadlock_retry' WHEN '57014' THEN 'statement_timeout' ELSE 'processing_error' END;
   PERFORM public.v2_worker_fail_tasks(work.id,work.lease_token,safe_code);failure_count:=failure_count+1;
  END;
 END LOOP;
 INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts,last_continued)
 VALUES('prompt-refresh/1',clock_timestamp(),done_count,superseded_count,failure_count,continued_count)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,
  last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts,last_continued=EXCLUDED.last_continued;
 RETURN jsonb_build_object('done',done_count,'superseded',superseded_count,'failedAttempts',failure_count,'continued',continued_count);
END;$$;

CREATE FUNCTION public.v2_worker_retry_tasks(job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;subject public.v2_subjects;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='refresh_tasks' AND policy_version='prompts/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'failed' THEN RETURN false;END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation
  OR work.policy_version<>'prompts/1' THEN RETURN false;END IF;
 UPDATE public.v2_jobs SET state='pending',max_attempts=attempt+8,available_at=clock_timestamp(),completed_at=NULL WHERE id=job;
 RETURN true;
END;$$;

-- A time-bound assessment can complete again at the same generation.
DO $prior_function$ DECLARE content text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO content,secure,settings FROM pg_proc WHERE oid='public.v2_worker_finish_assess(uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(content,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'2fab004e479daa92d28b096c7ecb5bd14a320c2d7a1106eb73dd5431bef2f128'
 OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]
 THEN RAISE EXCEPTION 'prompt_prior_function_changed';END IF;
END;$prior_function$;
CREATE OR REPLACE FUNCTION public.v2_worker_finish_assess(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE work public.v2_jobs;subject public.v2_subjects;item record;a public.v2_field_assessments;
 active_policy text;graph bigint;digest text;decision uuid;assessment_id uuid;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job FOR UPDATE;
 IF NOT FOUND OR work.kind<>'assess' OR work.policy_version<>'evidence/1' OR work.state<>'leased'
  OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN 'lease_lost';END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 SELECT version INTO active_policy FROM public.v2_evidence_policy_state WHERE id;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation OR active_policy<>work.policy_version THEN
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;
  IF subject.lifecycle='active' THEN
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
   VALUES('assess',subject.id,subject.input_generation,active_policy,subject.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN 'superseded';
 END IF;
 SELECT revision INTO graph FROM public.v2_source_graph WHERE id;
 -- Current pointers are the restart cursor: completed scopes are reused, never
 -- skipped solely because an earlier lease claimed to have visited them.
 FOR item IN SELECT x.* FROM public.v2_worker_assessment_scopes(subject.id) x
  WHERE NOT public.v2_worker_assessment_scope_ready(subject.id,x.field_key,x.scope_key)
  ORDER BY x.field_key,x.scope_key LIMIT 10 LOOP
  SELECT a0.* INTO a FROM public.v2_current_assessments c JOIN public.v2_field_assessments a0 ON a0.id=c.assessment_id
   WHERE c.subject_id=subject.id AND c.field_key=item.field_key AND c.scope_key=item.scope_key
   AND NOT a0.invalidated AND NOT a0.erased AND a0.input_generation=subject.input_generation
   AND a0.policy_version=active_policy AND a0.source_graph_revision=graph
   AND a0.assessed_at<=statement_timestamp() AND (a0.valid_until IS NULL OR a0.valid_until>statement_timestamp());
  IF NOT FOUND THEN
   SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id;
   assessment_id:=public.v2_assess_field(subject.id,item.field_key,item.scope_key,item.scope,
    subject.revision,subject.input_generation,graph,statement_timestamp(),gen_random_uuid());
   SELECT * INTO a FROM public.v2_field_assessments WHERE id=assessment_id;
  END IF;
  decision:=public.v2_process_field_assessment(a.id);
 END LOOP;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.v2_worker_assessment_scopes(subject.id) x
  WHERE NOT public.v2_worker_assessment_scope_ready(subject.id,x.field_key,x.scope_key)) THEN
  UPDATE public.v2_jobs SET state='pending',lease_token=NULL,lease_until=NULL,available_at=clock_timestamp(),
   max_attempts=max_attempts+1,last_error_code=NULL WHERE id=job;
  RETURN 'continued';
 END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id;
 digest:=public.v2_assessment_hash(jsonb_build_object('policy','assessment-worker/1','generation',subject.input_generation,
  'sourceGraphRevision',graph,'evidencePolicy',active_policy,'fields',(SELECT jsonb_agg(jsonb_build_array(c.field_key,c.scope_key,c.field_decision_id)
    ORDER BY c.field_key,c.scope_key) FROM public.v2_current_fields c WHERE c.subject_id=subject.id)));
 INSERT INTO public.v2_job_effects(job_id,stage,input_digest,result_revision) VALUES(job,'assessment-worker/1',digest,subject.revision) ON CONFLICT DO NOTHING;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
  VALUES('refresh_tasks',subject.id,subject.input_generation,'prompts/1',work.id) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;
 RETURN 'done';
END;$$;

DO $prior_function$ DECLARE content text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO content,secure,settings FROM pg_proc WHERE oid='public.v2_worker_health()'::regprocedure;
 IF encode(sha256(convert_to(replace(content,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'ae199a642f16f43a2dc9b0c967b0e2e5c3ba134c1f57de607c72a1c79062565a'
 OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 THEN RAISE EXCEPTION 'prompt_prior_function_changed';END IF;
END;$prior_function$;
CREATE OR REPLACE FUNCTION public.v2_worker_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('normalise',public.v2_worker_stage_health('normalise','intake/1','normalise/1'),
  'associate',public.v2_worker_stage_health('associate','association/1','association/1'),
  'actual',public.v2_worker_stage_health('associate','actual-association/1','actual-association/1'),
  'pattern',public.v2_worker_stage_health('associate','pattern-association/1','pattern-association/1'),
  'assess',public.v2_worker_stage_health('assess','evidence/1','assessment-worker/1'),
  'tasks',public.v2_worker_stage_health('refresh_tasks','prompts/1','prompt-refresh/1'),
  'failedJobs',COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,kind,policy_version,attempt,max_attempts,last_error_code,completed_at FROM public.v2_jobs
   WHERE ((kind='refresh_tasks' AND policy_version='prompts/1') OR (kind='assess' AND policy_version='evidence/1') OR (kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1'))) AND state='failed' ORDER BY completed_at,id LIMIT 20) x),'[]'::jsonb),
  'otherPendingStages',(SELECT count(*) FROM public.v2_jobs WHERE state='pending'
   AND NOT ((kind='refresh_tasks' AND policy_version='prompts/1') OR (kind='assess' AND policy_version='evidence/1') OR (kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1')))));
$$;

CREATE FUNCTION public.v2_worker_tasks_input_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.lifecycle='active' AND (NEW.input_generation<>OLD.input_generation OR NEW.lifecycle<>OLD.lifecycle)
 AND (EXISTS(SELECT 1 FROM public.v2_question_tasks WHERE subject_id=NEW.id)
  OR EXISTS(SELECT 1 FROM public.v2_jobs WHERE subject_id=NEW.id AND kind='refresh_tasks' AND policy_version='prompts/1')) THEN
  INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
   VALUES('refresh_tasks',NEW.id,NEW.input_generation,'prompts/1',NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER v2_worker_tasks_input_changed AFTER UPDATE ON public.v2_subjects
 FOR EACH ROW EXECUTE FUNCTION public.v2_worker_tasks_input_changed();

CREATE FUNCTION public.v2_prompt_erase_worker_cursor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM public.v2_job_effects e USING public.v2_jobs j WHERE j.id=e.job_id
  AND j.subject_id IN(OLD.original_subject_id,public.v2_observation_subject(OLD.id))
  AND e.stage IN('prompt-scope/1','prompt-refresh/1');
 RETURN OLD;
END;$$;
CREATE TRIGGER ab_v2_prompt_worker_cursor_erasure BEFORE DELETE ON public.v2_observations
 FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_erase_worker_cursor();

DO $task_access$ DECLARE r text;f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'v2_worker_task_scopes','v2_worker_task_state','v2_worker_claim_tasks','v2_worker_heartbeat_tasks','v2_worker_fail_tasks',
  'v2_worker_finish_tasks','v2_worker_drain_tasks','v2_worker_retry_tasks','v2_worker_tasks_input_changed','v2_prompt_erase_worker_cursor') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;
  END LOOP;
 END LOOP;
END;$task_access$;
GRANT EXECUTE ON FUNCTION public.v2_worker_claim_tasks(),public.v2_worker_heartbeat_tasks(uuid,uuid),
 public.v2_worker_fail_tasks(uuid,uuid,text),public.v2_worker_finish_tasks(uuid,uuid),public.v2_worker_drain_tasks(integer) TO mabhazi_api;

INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
 SELECT 'refresh_tasks',s.id,s.input_generation,'prompts/1',s.id FROM public.v2_subjects s
 WHERE s.lifecycle='active' AND (EXISTS(SELECT 1 FROM public.v2_current_assessments c WHERE c.subject_id=s.id)
  OR EXISTS(SELECT 1 FROM public.v2_question_tasks t WHERE t.subject_id=s.id))
 ON CONFLICT DO NOTHING;
