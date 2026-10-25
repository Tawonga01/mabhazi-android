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


-- Legacy invalidation producers retain their own operation policies. Any later
-- generation change on an already assessed subject also needs current evidence
-- recomputation, without waiting for a manual enqueue or consuming unknown work.
CREATE FUNCTION public.v2_worker_assessment_input_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.lifecycle='active' AND (NEW.input_generation<>OLD.input_generation OR NEW.lifecycle<>OLD.lifecycle)
  AND EXISTS(SELECT 1 FROM public.v2_field_assessments WHERE subject_id=NEW.id) THEN
  INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
   SELECT 'assess',NEW.id,NEW.input_generation,(SELECT version FROM public.v2_evidence_policy_state WHERE id),NEW.id
   WHERE NOT EXISTS(SELECT 1 FROM public.v2_jobs j WHERE j.subject_id=NEW.id AND j.kind='assess' AND j.requested_generation=NEW.input_generation
    AND j.policy_version=(SELECT version FROM public.v2_evidence_policy_state WHERE id) AND j.state IN('pending','leased')) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER v2_worker_assessment_input_changed AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_worker_assessment_input_changed();
REVOKE ALL ON FUNCTION public.v2_worker_assessment_input_changed() FROM PUBLIC,mabhazi_api;
DO $wake_permissions$ DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_worker_assessment_input_changed() FROM %I',r);END IF;
 END LOOP;
END;$wake_permissions$;

-- Currency is part of a fare proposition. One-account repetition suppression
-- must not discard another currency; this repairs the existing documented rule.
DO $prior_evaluator$ DECLARE body text;secure boolean;settings text[];BEGIN
 SELECT prosrc,prosecdef,proconfig INTO body,secure,settings FROM pg_proc WHERE oid='public.v2_evaluate_assessment_excluding(uuid,text,jsonb,timestamptz,text,uuid[])'::regprocedure;
 IF encode(sha256(convert_to(replace(body,chr(13)||chr(10),chr(10)),'UTF8')),'hex')<>'4957b956e325dc822cb45a7187feb65c621116bb65934bb090ff6dec5dab78c6' OR secure IS DISTINCT FROM false OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'assessment_prior_evaluator_changed';END IF;
END;$prior_evaluator$;
CREATE OR REPLACE FUNCTION public.v2_evaluate_assessment_excluding(subject uuid,field text,scope jsonb,as_of timestamptz,policy text,excluded uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 WITH rows AS MATERIALIZED (
   SELECT observation_id,owner_id,value,evidence_date,freshness,temporal_class,complete_scope,basis_eligible,known_source,source_groups,
     admissible AND NOT(observation_id=ANY(excluded)) admissible,
     CASE WHEN observation_id=ANY(excluded) THEN 'review_excluded' ELSE reason END reason,next_change,state_revision,target_revision
   FROM public.v2_assessment_rows(subject,field,scope,as_of,policy)),
 ranked AS (
   SELECT *,row_number() OVER(PARTITION BY owner_id,source_groups,CASE WHEN field LIKE 'fare.%' THEN value->>'currency' ELSE '' END ORDER BY admissible DESC,
     (complete_scope AND freshness='current') DESC,evidence_date DESC NULLS LAST,observation_id DESC) rn FROM rows
 ), eligible AS (SELECT * FROM ranked WHERE admissible AND rn=1),
 witnesses AS (
   SELECT a.value,a.observation_id first_id,b.observation_id second_id,
     row_number() OVER(PARTITION BY a.value ORDER BY a.evidence_date,a.observation_id,b.evidence_date,b.observation_id) rank
   FROM eligible a JOIN eligible b ON a.value=b.value AND a.owner_id<>b.owner_id
     AND (a.evidence_date,a.observation_id)<(b.evidence_date,b.observation_id)
     AND NOT a.source_groups && b.source_groups
   WHERE a.known_source AND b.known_source AND a.complete_scope AND b.complete_scope AND a.basis_eligible AND b.basis_eligible
     AND a.freshness='current' AND b.freshness='current' AND a.temporal_class='ongoing' AND b.temporal_class='ongoing'
 ), candidates AS (
   SELECT e.value,count(DISTINCT e.owner_id) contributors,
     CASE WHEN w.first_id IS NOT NULL THEN 'corroborated' ELSE 'reported' END support,
     CASE WHEN bool_or(e.freshness='current') THEN 'current' WHEN bool_or(e.freshness='recheck_due') THEN 'recheck_due' ELSE 'unknown' END freshness,
     min(e.temporal_class) temporal_class,min(e.evidence_date) oldest_date,max(e.evidence_date) newest_date,
     w.first_id,w.second_id,bool_or(e.complete_scope AND e.freshness='current' AND e.basis_eligible) conflict_eligible
   FROM eligible e LEFT JOIN witnesses w ON w.value=e.value AND w.rank=1 GROUP BY e.value,w.first_id,w.second_id
 )
 SELECT jsonb_build_object('policyVersion',policy,'assessedAt',as_of,
   'candidates',COALESCE((SELECT jsonb_agg(jsonb_build_object('value',value,'support',support,'contributors',contributors,
     'freshness',freshness,'temporalClass',temporal_class,'oldestDate',oldest_date,'newestDate',newest_date,
     'witnesses',CASE WHEN first_id IS NULL THEN '[]'::jsonb ELSE to_jsonb(ARRAY[first_id,second_id]) END) ORDER BY value::text) FROM candidates),'[]'::jsonb),
   'dispute',CASE WHEN EXISTS(SELECT 1 FROM candidates WHERE conflict_eligible GROUP BY CASE
       WHEN field LIKE 'fare.%' THEN value->>'currency' WHEN field='timetable.sign_presence' THEN (value->'place')::text ELSE '' END
       HAVING count(*)>1) THEN 'open' ELSE 'none' END,
   'needsContext',COALESCE((SELECT bool_or(admissible AND NOT complete_scope) FROM ranked),false),
   'nextChangeAt',(SELECT min(next_change) FROM rows),
   'inputs',COALESCE((SELECT jsonb_agg(jsonb_build_object('observationId',observation_id,'stateRevision',state_revision,
     'targetRevision',target_revision,'evidenceDate',evidence_date,'freshness',freshness,'temporalClass',temporal_class,
     'completeScope',complete_scope,'basisEligible',basis_eligible,'knownSource',known_source,'sourceGroups',source_groups,
     'admissible',admissible AND rn=1,'reason',CASE WHEN admissible AND rn>1 THEN 'repeated_account_source' ELSE reason END)
     ORDER BY observation_id) FROM ranked),'[]'::jsonb));
$$;
-- Advance generations only for cached fare scopes which could have collapsed
-- one account's different currencies. Original observations/history survive.
DO $currency_recheck$ DECLARE changed uuid;BEGIN
 FOR changed IN SELECT DISTINCT a.subject_id FROM public.v2_current_assessments ca
  JOIN public.v2_field_assessments a ON a.id=ca.assessment_id JOIN public.v2_subjects s ON s.id=a.subject_id AND s.lifecycle='active'
  WHERE a.field_key LIKE 'fare.%' AND EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_contributions c ON c.id=o.contribution_id
   WHERE public.v2_observation_subject(o.id)=a.subject_id AND o.field_key=a.field_key AND o.scope_key=a.scope_key
   GROUP BY c.user_id HAVING count(DISTINCT o.value->>'currency')>1) LOOP
  UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=changed;
  INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
   SELECT 'assess',id,input_generation,(SELECT version FROM public.v2_evidence_policy_state WHERE id),id FROM public.v2_subjects WHERE id=changed ON CONFLICT DO NOTHING;
 END LOOP;
END;$currency_recheck$;
