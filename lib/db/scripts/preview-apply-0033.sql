-- Mabhazi Preview ocwlqhlfavvuncfmzuqh only. Fresh action-time approval required.
-- Source0033 SHA256 abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896; five fenced worker permissions; no new tables or client access.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $preview_tasks_0033$
DECLARE previous text;f jsonb;p record;before_functions jsonb;after_functions jsonb;before_data jsonb;after_data jsonb;old_jobs jsonb;retained_jobs jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM(VALUES ('0000_initial.sql','47816e783afdcbb778d16a4afbb23b2053ad5532fab1e06af7bbf9696115a38e'),
('0001_api_role.sql','1a4e952d4a7179075825ab142a38a751cc58a7919e3cf8b981ead546108283e4'),
('0002_contribution_intake.sql','b6a8edf014efd7f71531f21205f23c49f1bb0166b43374538a748074f0db25b8'),
('0003_transport_structure.sql','7bd24b0451546a40be14f6b8aef127c99c52eba710a812ee4f9e8feaae46b811'),
('0004_review_decisions.sql','d22083cdab91f0dc04b46016ebd200a3a3b0ead7229ba981452d27f5f7ba9a5a'),
('0005_derived_decisions.sql','62a6d76851d50cfab7754051618a4ac98c056e36a129629190140a107701442f'),
('0006_observation_registry.sql','ac310e0a630f58ac09b7bf254c1c8a4afefcd9bc8a6114e6cf89f72d4dfc353f'),
('0007_observation_events.sql','b47f0267431ac955faf6ad31981ed7b0133d5d63704b6a27a62c10330b814b21'),
('0008_observation_targets.sql','1cfb37200fa370708b9cb22fb46fc41a3704c40636028f84dc61da41bacf598e'),
('0009_source_identity.sql','e47a6b7e48bad9a7a2989da14c37a78d20f449c8680f09c439acd159d716190e'),
('0010_evidence_assessments.sql','0ccce5368dbf67f14facbc675943c8e094fe37b4dc57b32a770633be81c0dff2'),
('0011_field_resolution.sql','f086418f2525b85004d9a05da3b3169e2c1d2afe709e0c43b146a23002d1e572'),
('0012_affiliation_issuers.sql','e31320e5eff22ae28d159d5cb6ae95aee7b8aad9b5672d3f7e414fa1f12a1d17'),
('0013_prompt_tasks.sql','ab2446b8b4f161bb8bb8b39216f41fb12afd8738256fcd8ce0518171cf0a9b2e'),
('0014_transport_propagation.sql','44ff4ec120e21b61c128ef1ceabce3544f6cfad46ea6182315ea53e3c8ab1073'),
('0015_transport_writers.sql','6abb4def1d7b30854efe5f0a0371d3c278032f4e03f93b0c27d498b03281bea6'),
('0016_lead_creation.sql','748a3f024dedbd96dadef972a00af01d354cdf5a09711526a2ad228ebfa400e0'),
('0017_transport_uuid_normalization.sql','846f54fbcfa6446f94e08bdc5306e3cd895256da78d4dff87b40eedd2ed0b96e'),
('0018_transport_creation.sql','2b762ee0c3b9c5dab2ccf4f25286df25c4f5c3fdec31f3fe599157f4dce1d1d2'),
('0019_route_pattern_creation.sql','27fe4e63f14d665e5406296a44e693bc637b0c306c19efcb9778bc317f9d08ab'),
('0020_service_run_creation.sql','d25bd19870fe1307e5b00f75a98a3cccdc1317abedfb02c503109019f965dacd'),
('0021_actual_journey_intake.sql','2d5461ea7563dcbbb9b00a9aeac31e7994d0e9305583c251ad301acf25a696e9'),
('0022_minimum_lead_api.sql','e74223a70810dc43e0a416b26bf5698368872209fe51bde0a083341a2d95ab9e'),
('0023_normalise_worker.sql','8ab0d9f3db1d4ef2dd9e1d1dca00e26f715be963e364e08753e27a2c6cd61ae6'),
('0024_lead_association_worker.sql','7b889f2489bc07974ba34e929fbd207be77c1a446e11b381db4b9b09ec74e68d'),
('0025_pattern_association_worker.sql','388ba5d4a602d834d8fd8bcbe684b0180f6f98ab2f0f5e75e355fe99ea65eefe'),
('0026_identity_lookup.sql','9f5ab9ce65f9911c11ae866d79e88c56b693dc71780f02faf9941197e42ede32'),
('0027_journey_processing.sql','48106d054caadd7d97805b7143b69e08f0311b6153645fcbf9b5ce53cd2173a2'),
('0028_actual_journey_api.sql','7ab8860ddb09de0cf68ce64c0be883f3718184c4f0a68cff768ae0dce75fe705'),
('0029_empty_search_minimum.sql','7537057d3167b540df14c14c52adeda006079d366669bbb257f4d533a1227762'),
('0030_public_route_context.sql','b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36'),
('0031_assessment_worker.sql','ae4a5a5017046775147eaf562c90f234e23c47f28e90f11edd81ff94f7c60000'),
('0032_public_fare_reports.sql','b8b9d1d0d8136d9c477c3890bdfd52b93be1f81c2fce208978eeb2e05fb15f47')) expected(name,checksum)
  LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(33,34) THEN RAISE EXCEPTION 'prompt_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0033_prompt_refresh_worker.sql';
 IF previous IS NOT NULL AND previous<>'abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896' THEN RAISE EXCEPTION 'prompt_preview_hash_changed';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname NOT IN('v2_worker_task_scopes','v2_worker_task_state','v2_worker_finish_tasks','v2_worker_claim_tasks','v2_worker_heartbeat_tasks','v2_worker_fail_tasks','v2_worker_drain_tasks','v2_worker_retry_tasks','v2_worker_finish_assess','v2_worker_health','v2_worker_tasks_input_changed','v2_prompt_erase_worker_cursor')) INTO before_functions;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_actual_journeys x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_sources x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_assessments x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_decisions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_current_fields x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_refs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_hides x)) INTO before_data;
 SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) INTO old_jobs FROM public.v2_jobs j;
 IF previous IS NULL THEN
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_worker_task_scopes','v2_worker_task_state','v2_worker_finish_tasks','v2_worker_claim_tasks','v2_worker_heartbeat_tasks','v2_worker_fail_tasks','v2_worker_drain_tasks','v2_worker_retry_tasks','v2_worker_tasks_input_changed','v2_prompt_erase_worker_cursor'))
   OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN('v2_worker_tasks_input_changed','ab_v2_prompt_worker_cursor_erasure'))
   THEN RAISE EXCEPTION 'prompt_partial_or_unrecorded';END IF;
  EXECUTE $source_tasks_0033$
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
 AND NOT EXISTS(SELECT 1 FROM public.v2_jobs j WHERE j.subject_id=s.id AND j.kind='refresh_tasks'
  AND j.policy_version='prompts/1' AND j.requested_generation=s.input_generation AND j.state IN('pending','leased','failed'))
 ON CONFLICT DO NOTHING;

$source_tasks_0033$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0033_prompt_refresh_worker.sql','abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896');
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements($function_specs$[{"name":"v2_worker_task_scopes","signature":"public.v2_worker_task_scopes(uuid)","hash":"0d79eddc26956211181467ca1f82a44011ddb9fab3a18feb85fad34c42d67be2","definer":false,"language":"sql","volatility":"s","config":["search_path=pg_catalog"],"result":"record","set":true,"backend":false},{"name":"v2_worker_task_state","signature":"public.v2_worker_task_state(uuid,text,jsonb,text)","hash":"1e002fecd941639a6f2507ce0b9d3f0279682c87d351aa42b66e8ba735093612","definer":false,"language":"plpgsql","volatility":"s","config":["search_path=pg_catalog","TimeZone=UTC"],"result":"jsonb","set":false,"backend":false},{"name":"v2_worker_finish_tasks","signature":"public.v2_worker_finish_tasks(uuid,uuid)","hash":"958bf1832ae28e3d67b6d771e52516d335045f83e709ea8ac2fceb4b797bd1bd","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog","TimeZone=UTC"],"result":"text","set":false,"backend":true},{"name":"v2_worker_claim_tasks","signature":"public.v2_worker_claim_tasks()","hash":"87d20e5b3833845819e9fc7dd1d9d18c2f8cdc259d15de666a1b7af6701bcae1","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"public.v2_jobs","set":false,"backend":true},{"name":"v2_worker_heartbeat_tasks","signature":"public.v2_worker_heartbeat_tasks(uuid,uuid)","hash":"ae9957bffc9dbf5edfe77bcbe0c8894d0984d98862b6547a96d214364ea20c11","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"boolean","set":false,"backend":true},{"name":"v2_worker_fail_tasks","signature":"public.v2_worker_fail_tasks(uuid,uuid,text)","hash":"c9ed61a061afb5a3128b9a0d7a067fb83990bee5b0c14dca84630e70e3af47c4","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"boolean","set":false,"backend":true},{"name":"v2_worker_drain_tasks","signature":"public.v2_worker_drain_tasks(integer)","hash":"07deedf7588d2923e9ae82acd092311fcbe569256fa5ae6197f519b93af0f23b","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"jsonb","set":false,"backend":true},{"name":"v2_worker_retry_tasks","signature":"public.v2_worker_retry_tasks(uuid)","hash":"25af5531ced910de4b8f0dba1eb04939bc4daa9b4840e0a9cdc4874ae01d3f3d","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"boolean","set":false,"backend":false},{"name":"v2_worker_finish_assess","signature":"public.v2_worker_finish_assess(uuid,uuid)","hash":"4cf1e91e788589cfb4d15e927bc1b2cd55b3d6a66b9f0f47e63e9059ffad7a4b","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog","TimeZone=UTC"],"result":"text","set":false,"backend":true},{"name":"v2_worker_health","signature":"public.v2_worker_health()","hash":"a089f35e5b8bca93b7e9818b02a5089fe3f326514f09bc680eedfff855c81d32","definer":true,"language":"sql","volatility":"s","config":["search_path=pg_catalog"],"result":"jsonb","set":false,"backend":true},{"name":"v2_worker_tasks_input_changed","signature":"public.v2_worker_tasks_input_changed()","hash":"14a04ba3fba1309bb5b5785f67ba97ab6e170b6d75a7d57b9889b4036d9597a9","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"trigger","set":false,"backend":false},{"name":"v2_prompt_erase_worker_cursor","signature":"public.v2_prompt_erase_worker_cursor()","hash":"873566f2a1a0082a22229f6041907608db9a9ca134026989d8d4508998c14a65","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"trigger","set":false,"backend":false}]$function_specs$::jsonb) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(f->>'signature');
  IF p.oid IS NULL OR p.prosecdef IS DISTINCT FROM (f->>'definer')::boolean
   OR to_jsonb(p.proconfig) IS DISTINCT FROM f->'config' OR p.provolatile<>(f->>'volatility')::"char"
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=f->>'language') OR p.prorettype<>to_regtype(f->>'result')
   OR p.proretset IS DISTINCT FROM (f->>'set')::boolean
   OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f->>'hash'
   OR has_function_privilege('mabhazi_api',p.oid,'EXECUTE') IS DISTINCT FROM (f->>'backend')::boolean
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,p.oid,'EXECUTE'))
   THEN RAISE EXCEPTION 'prompt_function_fence_changed: %',f->>'signature';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_worker_status'::regclass
  AND conname='v2_worker_status_runner_key_check' AND contype='c' AND convalidated
  AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]|::text','','g')=$expected$CHECKrunner_key=ANYARRAY['normalise/1','association/1','pattern-association/1','actual-association/1','assessment-worker/1','prompt-refresh/1']$expected$)
  THEN RAISE EXCEPTION 'prompt_worker_status_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.v2_subjects'::regclass AND tgname='v2_worker_tasks_input_changed'
   AND tgenabled='O' AND tgtype=17 AND tgfoid='public.v2_worker_tasks_input_changed()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.v2_observations'::regclass AND tgname='ab_v2_prompt_worker_cursor_erasure'
   AND tgenabled='O' AND tgtype=11 AND tgfoid='public.v2_prompt_erase_worker_cursor()'::regprocedure)
  THEN RAISE EXCEPTION 'prompt_worker_trigger_changed';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname NOT IN('v2_worker_task_scopes','v2_worker_task_state','v2_worker_finish_tasks','v2_worker_claim_tasks','v2_worker_heartbeat_tasks','v2_worker_fail_tasks','v2_worker_drain_tasks','v2_worker_retry_tasks','v2_worker_finish_assess','v2_worker_health','v2_worker_tasks_input_changed','v2_prompt_erase_worker_cursor')) INTO after_functions;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_actual_journeys x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_sources x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_assessments x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_decisions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_current_fields x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_refs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_hides x)) INTO after_data;
 SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) INTO retained_jobs FROM public.v2_jobs j
  WHERE j.id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(old_jobs) x);
 IF before_functions IS DISTINCT FROM after_functions OR before_data IS DISTINCT FROM after_data OR old_jobs IS DISTINCT FROM retained_jobs
  THEN RAISE EXCEPTION 'prompt_existing_state_changed';END IF;
 IF (SELECT count(*) FROM mabhazi_migrations.applied)<>34 THEN RAISE EXCEPTION 'prompt_ledger_changed';END IF;
END;$preview_tasks_0033$;
COMMIT;
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'ledgerEntries',(SELECT count(*) FROM mabhazi_migrations.applied),
 'migrationHash',(SELECT checksum FROM mabhazi_migrations.applied WHERE name='0033_prompt_refresh_worker.sql'),
 'contributions',(SELECT count(*) FROM public.v2_contributions),'receipts',(SELECT count(*) FROM public.v2_receipts),
 'observations',(SELECT count(*) FROM public.v2_observations),'tasks',(SELECT count(*) FROM public.v2_question_tasks))::text proof;
