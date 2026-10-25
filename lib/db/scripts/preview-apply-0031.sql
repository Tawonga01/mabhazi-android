-- Mabhazi Preview ocwlqhlfavvuncfmzuqh only; action-time permission required.
-- Source0031 SHA256 f7d28f7057b51b8ebf5f8ea3542475621d7604b8f5a3cb978eca2af6e956ba0d. No new table or credential, evidence policy or publication changes.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $preview_assessment_0031$
DECLARE previous text;f record;p record;before_functions jsonb;after_functions jsonb;before_data jsonb;after_data jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM(VALUES
('0000_initial.sql','47816e783afdcbb778d16a4afbb23b2053ad5532fab1e06af7bbf9696115a38e'),
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
('0030_public_route_context.sql','b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36')
 ) expected(name,checksum) LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(31,32) THEN RAISE EXCEPTION 'assessment_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0031_assessment_worker.sql';
 IF previous IS NOT NULL AND previous<>'f7d28f7057b51b8ebf5f8ea3542475621d7604b8f5a3cb978eca2af6e956ba0d' THEN RAISE EXCEPTION 'assessment_preview_hash_changed';END IF;
 SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) INTO before_functions FROM pg_proc proc_snapshot WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_worker_assessment_scopes','v2_worker_assessment_scope_ready','v2_worker_claim_assess','v2_worker_heartbeat_assess','v2_worker_fail_assess','v2_worker_finish_assess','v2_worker_drain_assess','v2_worker_retry_assess','v2_worker_health');
 SELECT jsonb_build_array((SELECT count(*) FROM public.v2_contributions),(SELECT count(*) FROM public.v2_receipts),(SELECT count(*) FROM public.v2_observations),(SELECT count(*) FROM public.v2_jobs),(SELECT count(*) FROM public.v2_field_assessments),(SELECT count(*) FROM public.v2_field_decisions)) INTO before_data;
 IF previous IS NULL THEN
  IF (SELECT count(*) FROM mabhazi_migrations.applied)<>31 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_worker_assessment_scopes','v2_worker_assessment_scope_ready','v2_worker_claim_assess','v2_worker_heartbeat_assess','v2_worker_fail_assess','v2_worker_finish_assess','v2_worker_drain_assess','v2_worker_retry_assess')) THEN RAISE EXCEPTION 'assessment_partial_or_unrecorded';END IF;
  EXECUTE $source_assessment_0031$
-- Leased execution of the existing evidence/1 evaluator and field interpretation.
-- No evidence thresholds, public projection, canonical identity or timetable gate changes.
DO $prior_status$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_worker_status'::regclass AND conname='v2_worker_status_runner_key_check' AND contype='c' AND convalidated
 AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]|::text','','g')=$expected$CHECKrunner_key=ANYARRAY['normalise/1','association/1','pattern-association/1','actual-association/1']$expected$) THEN RAISE EXCEPTION 'assessment_prior_status_changed';END IF;
END;$prior_status$;
ALTER TABLE public.v2_worker_status DROP CONSTRAINT v2_worker_status_runner_key_check;
ALTER TABLE public.v2_worker_status ADD CONSTRAINT v2_worker_status_runner_key_check CHECK(runner_key IN('normalise/1','association/1','pattern-association/1','actual-association/1','assessment-worker/1'));

CREATE FUNCTION public.v2_worker_assessment_scopes(subject uuid)
RETURNS TABLE(field_key text,scope_key text,scope jsonb)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT DISTINCT o.field_key,o.scope_key,o.scope FROM public.v2_observations o
 WHERE public.v2_observation_subject(o.id)=subject
 UNION
 SELECT a.field_key,a.scope_key,a.scope FROM public.v2_current_assessments c
 JOIN public.v2_field_assessments a ON a.id=c.assessment_id
 WHERE c.subject_id=subject AND NOT a.erased;
$$;

CREATE FUNCTION public.v2_worker_assessment_scope_ready(subject uuid,field text,scope_hash text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.v2_current_assessments c
 JOIN public.v2_field_assessments a ON a.id=c.assessment_id
 JOIN public.v2_subjects s ON s.id=a.subject_id
 JOIN public.v2_current_fields f ON f.subject_id=c.subject_id AND f.field_key=c.field_key AND f.scope_key=c.scope_key
 JOIN public.v2_field_decisions d ON d.id=f.field_decision_id AND d.assessment_id=a.id
 WHERE c.subject_id=subject AND c.field_key=field AND c.scope_key=scope_hash
 AND s.lifecycle='active' AND a.input_generation=s.input_generation AND d.input_generation=s.input_generation
 AND NOT a.invalidated AND NOT a.erased AND NOT d.invalidated AND NOT d.erased
 AND a.policy_version=(SELECT version FROM public.v2_evidence_policy_state WHERE id)
 AND a.source_graph_revision=(SELECT revision FROM public.v2_source_graph WHERE id)
 AND a.assessed_at<=statement_timestamp() AND (a.valid_until IS NULL OR a.valid_until>statement_timestamp())
 AND d.input_digest=public.v2_field_expected(a.id,d.resolution_id,d.review_blocked)->>'inputDigest');
$$;

CREATE FUNCTION public.v2_worker_claim_assess() RETURNS public.v2_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;scanned integer:=0;
BEGIN
 LOOP
  SELECT * INTO work FROM public.v2_jobs
   WHERE kind='assess' AND policy_version='evidence/1'
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

CREATE FUNCTION public.v2_worker_heartbeat_assess(job uuid,token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_jobs j SET lease_until=clock_timestamp()+interval '120 seconds'
 WHERE j.id=job AND j.kind='assess' AND j.policy_version='evidence/1' AND j.state='leased'
 AND j.lease_token=token AND j.lease_until>clock_timestamp()
 AND j.policy_version=(SELECT version FROM public.v2_evidence_policy_state WHERE id)
 AND EXISTS(SELECT 1 FROM public.v2_subjects s WHERE s.id=j.subject_id AND s.lifecycle='active' AND s.input_generation=j.requested_generation);
 RETURN FOUND;
END;$$;

CREATE FUNCTION public.v2_worker_fail_assess(job uuid,token uuid,error_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;delay_seconds double precision;
BEGIN
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='assess' AND policy_version='evidence/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'leased' OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN false;END IF;
 IF error_code IS NULL OR error_code NOT IN('processing_error','invalid_input','unsupported_subject','serialization_retry','deadlock_retry','statement_timeout') THEN error_code:='processing_error';END IF;
 delay_seconds:=LEAST(30*power(2,LEAST(work.attempt-1,7)),3600)*(1+random()*0.1);
 UPDATE public.v2_jobs SET state=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'pending' END,
  available_at=clock_timestamp()+make_interval(secs=>delay_seconds),lease_token=NULL,lease_until=NULL,last_error_code=error_code,
  completed_at=CASE WHEN attempt>=max_attempts THEN clock_timestamp() ELSE NULL END WHERE id=job;
 RETURN true;
END;$$;

CREATE FUNCTION public.v2_worker_finish_assess(job uuid,token uuid) RETURNS text
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
  VALUES('refresh_tasks',subject.id,subject.input_generation,'prompts/1',subject.id) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;
 RETURN 'done';
END;$$;

CREATE FUNCTION public.v2_worker_drain_assess(batch_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;result text;done_count integer:=0;superseded_count integer:=0;failure_count integer:=0;continued_count integer:=0;safe_code text;
BEGIN
 IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'worker_batch_invalid' USING ERRCODE='23514';END IF;
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 FOR n IN 1..batch_limit LOOP
  work:=public.v2_worker_claim_assess();IF work.id IS NULL THEN EXIT;END IF;
  BEGIN
   result:=public.v2_worker_finish_assess(work.id,work.lease_token);
   IF result='done' THEN done_count:=done_count+1;ELSIF result='superseded' THEN superseded_count:=superseded_count+1;
   ELSIF result='continued' THEN continued_count:=continued_count+1;END IF;
  EXCEPTION WHEN OTHERS THEN
   safe_code:=CASE SQLSTATE WHEN '40001' THEN 'serialization_retry' WHEN '40P01' THEN 'deadlock_retry' ELSE 'processing_error' END;
   PERFORM public.v2_worker_fail_assess(work.id,work.lease_token,safe_code);failure_count:=failure_count+1;
  END;
 END LOOP;
 INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts,last_continued)
 VALUES('assessment-worker/1',clock_timestamp(),done_count,superseded_count,failure_count,continued_count)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,
  last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts,last_continued=EXCLUDED.last_continued;
 RETURN jsonb_build_object('done',done_count,'superseded',superseded_count,'failedAttempts',failure_count,'continued',continued_count);
END;$$;

CREATE FUNCTION public.v2_worker_retry_assess(job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;subject public.v2_subjects;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job AND kind='assess' AND policy_version='evidence/1' FOR UPDATE;
 IF NOT FOUND OR work.state<>'failed' THEN RETURN false;END IF;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 IF subject.lifecycle<>'active' OR subject.input_generation<>work.requested_generation
  OR work.policy_version<>(SELECT version FROM public.v2_evidence_policy_state WHERE id) THEN RETURN false;END IF;
 UPDATE public.v2_jobs SET state='pending',max_attempts=attempt+8,available_at=clock_timestamp(),completed_at=NULL WHERE id=job;
 RETURN true;
END;$$;

DO $$ DECLARE r text;f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
 'v2_worker_assessment_scopes','v2_worker_assessment_scope_ready','v2_worker_claim_assess','v2_worker_heartbeat_assess',
 'v2_worker_fail_assess','v2_worker_finish_assess','v2_worker_drain_assess','v2_worker_retry_assess') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;
  END LOOP;
 END LOOP;
END;$$;
GRANT EXECUTE ON FUNCTION public.v2_worker_claim_assess(),public.v2_worker_heartbeat_assess(uuid,uuid),
 public.v2_worker_fail_assess(uuid,uuid,text),public.v2_worker_finish_assess(uuid,uuid),public.v2_worker_drain_assess(integer) TO mabhazi_api;

DO $assessment_health$ DECLARE stored text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO stored,secure,settings FROM pg_proc WHERE oid='public.v2_worker_health()'::regprocedure;
 IF encode(sha256(convert_to(replace(stored,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'4fab0627ad52bf411bdb1903655cf6c9a5fc89d39a4e0c026840532e639bdda8'
 OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'assessment_prior_health_changed';END IF;
END;$assessment_health$;
CREATE OR REPLACE FUNCTION public.v2_worker_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('normalise',public.v2_worker_stage_health('normalise','intake/1','normalise/1'),
  'associate',public.v2_worker_stage_health('associate','association/1','association/1'),
  'actual',public.v2_worker_stage_health('associate','actual-association/1','actual-association/1'),
  'pattern',public.v2_worker_stage_health('associate','pattern-association/1','pattern-association/1'),
  'assess',public.v2_worker_stage_health('assess','evidence/1','assessment-worker/1'),
  'failedJobs',COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,kind,policy_version,attempt,max_attempts,last_error_code,completed_at FROM public.v2_jobs
   WHERE ((kind='assess' AND policy_version='evidence/1') OR (kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1'))) AND state='failed' ORDER BY completed_at,id LIMIT 20) x),'[]'::jsonb),
  'otherPendingStages',(SELECT count(*) FROM public.v2_jobs WHERE state='pending'
   AND NOT ((kind='assess' AND policy_version='evidence/1') OR (kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1','actual-association/1')))));
$$;

$source_assessment_0031$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0031_assessment_worker.sql','f7d28f7057b51b8ebf5f8ea3542475621d7604b8f5a3cb978eca2af6e956ba0d');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_worker_status'::regclass AND conname='v2_worker_status_runner_key_check' AND contype='c' AND convalidated AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]|::text','','g')=$expected$CHECKrunner_key=ANYARRAY['normalise/1','association/1','pattern-association/1','actual-association/1','assessment-worker/1']$expected$) THEN RAISE EXCEPTION 'assessment_status_constraint_changed';END IF;
 FOR f IN SELECT * FROM jsonb_to_recordset($function_specs$[{"name":"v2_worker_assessment_scopes","signature":"public.v2_worker_assessment_scopes(uuid)","hash":"ad330fae0a76d5c666bc331c8f1ed1e263741580682077f591fc52399f14d0e3","definer":false,"lang":"sql","config":["search_path=pg_catalog"],"volatility":"s","result":"record","backend":false},{"name":"v2_worker_assessment_scope_ready","signature":"public.v2_worker_assessment_scope_ready(uuid,text,text)","hash":"455b52932b17ea41bf6c2145a72db4fff4c93bbbbfce388d21ea7525928a7733","definer":false,"lang":"sql","config":["search_path=pg_catalog"],"volatility":"s","result":"boolean","backend":false},{"name":"v2_worker_claim_assess","signature":"public.v2_worker_claim_assess()","hash":"41bf9f6ca6b203666ce185370cebfe0d267759bf1cec9c37ed7e2f71d96fcd63","definer":true,"lang":"plpgsql","config":["search_path=pg_catalog"],"volatility":"v","result":"public.v2_jobs","backend":true},{"name":"v2_worker_heartbeat_assess","signature":"public.v2_worker_heartbeat_assess(uuid,uuid)","hash":"d1248e1aa66da7d65572c74c99656002179df70d5d1ac467b72eda4c916ce5dc","definer":true,"lang":"plpgsql","config":["search_path=pg_catalog"],"volatility":"v","result":"boolean","backend":true},{"name":"v2_worker_fail_assess","signature":"public.v2_worker_fail_assess(uuid,uuid,text)","hash":"e8b8e9224d40224c7298f4afa2bf65911b2f906ff4fad6198df35354d7c83e9a","definer":true,"lang":"plpgsql","config":["search_path=pg_catalog"],"volatility":"v","result":"boolean","backend":true},{"name":"v2_worker_finish_assess","signature":"public.v2_worker_finish_assess(uuid,uuid)","hash":"2fab004e479daa92d28b096c7ecb5bd14a320c2d7a1106eb73dd5431bef2f128","definer":true,"lang":"plpgsql","config":["search_path=pg_catalog","TimeZone=UTC"],"volatility":"v","result":"text","backend":true},{"name":"v2_worker_drain_assess","signature":"public.v2_worker_drain_assess(integer)","hash":"5d351919325b5e88f4fbf88d26e1e9541ec50c8163059e635261ca111dc04044","definer":true,"lang":"plpgsql","config":["search_path=pg_catalog"],"volatility":"v","result":"jsonb","backend":true},{"name":"v2_worker_retry_assess","signature":"public.v2_worker_retry_assess(uuid)","hash":"21e4d58dc94fd82cc113696820233a7909a45bcd646ed36fd023c5ebe8eb9fc2","definer":true,"lang":"plpgsql","config":["search_path=pg_catalog"],"volatility":"v","result":"boolean","backend":false},{"name":"v2_worker_health","signature":"public.v2_worker_health()","hash":"ae199a642f16f43a2dc9b0c967b0e2e5c3ba134c1f57de607c72a1c79062565a","definer":true,"lang":"sql","config":["search_path=pg_catalog"],"volatility":"s","result":"jsonb","backend":true}]$function_specs$::jsonb) AS x(name text,signature text,hash text,definer boolean,lang text,config text[],volatility text,result text,backend boolean) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(f.signature);
  IF p.oid IS NULL OR p.prosecdef IS DISTINCT FROM f.definer OR p.proconfig IS DISTINCT FROM f.config
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=f.lang) OR p.provolatile::text<>f.volatility OR p.prorettype<>to_regtype(f.result)
   OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f.hash
   OR has_function_privilege('mabhazi_api',p.oid,'EXECUTE') IS DISTINCT FROM f.backend
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles role WHERE role.rolname IN('anon','authenticated') AND has_function_privilege(role.oid,p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'assessment_function_fence_changed: %',f.signature;END IF;
 END LOOP;
 SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) INTO after_functions FROM pg_proc proc_snapshot WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_worker_assessment_scopes','v2_worker_assessment_scope_ready','v2_worker_claim_assess','v2_worker_heartbeat_assess','v2_worker_fail_assess','v2_worker_finish_assess','v2_worker_drain_assess','v2_worker_retry_assess','v2_worker_health');
 SELECT jsonb_build_array((SELECT count(*) FROM public.v2_contributions),(SELECT count(*) FROM public.v2_receipts),(SELECT count(*) FROM public.v2_observations),(SELECT count(*) FROM public.v2_jobs),(SELECT count(*) FROM public.v2_field_assessments),(SELECT count(*) FROM public.v2_field_decisions)) INTO after_data;
 IF after_functions IS DISTINCT FROM before_functions OR after_data IS DISTINCT FROM before_data THEN RAISE EXCEPTION 'assessment_existing_state_changed';END IF;
 IF (SELECT count(*) FROM mabhazi_migrations.applied)<>32 THEN RAISE EXCEPTION 'assessment_ledger_changed';END IF;
END;$preview_assessment_0031$;
COMMIT;
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'ledgerEntries',(SELECT count(*) FROM mabhazi_migrations.applied),'migrationHash',(SELECT checksum FROM mabhazi_migrations.applied WHERE name='0031_assessment_worker.sql'),'newTables',0,'restrictedWorkerFunctions',5,'contributions',(SELECT count(*) FROM public.v2_contributions),'receipts',(SELECT count(*) FROM public.v2_receipts),'health',public.v2_worker_health())::text proof;
