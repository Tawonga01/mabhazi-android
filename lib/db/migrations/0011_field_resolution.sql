-- Reviewed interpretation is separate from canonical transport publication.
-- Existing rows retain the old policy gate; computed rows remain provisional.
ALTER TABLE public.v2_field_decisions ADD COLUMN assessment_id uuid REFERENCES public.v2_field_assessments(id);
ALTER TABLE public.v2_field_decisions DROP CONSTRAINT v2_field_policy_ready;
ALTER TABLE public.v2_field_decisions ADD CONSTRAINT v2_field_policy_ready CHECK(
 publication IN ('provisional','withheld') AND (assessment_id IS NOT NULL OR (support_status IN ('unknown','reported') AND freshness='unknown')));
CREATE INDEX v2_field_assessment_idx ON public.v2_field_decisions(assessment_id);
CREATE TABLE public.v2_field_review_threads (
 subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),field_key text NOT NULL,scope_key text NOT NULL,
 case_id uuid NOT NULL UNIQUE REFERENCES public.v2_review_cases(id),PRIMARY KEY(subject_id,field_key,scope_key)
);
CREATE TABLE public.v2_field_resolutions (
 review_id uuid PRIMARY KEY REFERENCES public.v2_review_decisions(id),
 assessment_id uuid NOT NULL REFERENCES public.v2_field_assessments(id),
 chosen_observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 request_id uuid NOT NULL UNIQUE,request_digest text,
 erased boolean NOT NULL DEFAULT false,receipt_redacted boolean NOT NULL DEFAULT false,
 CHECK(NOT erased OR (chosen_observation_id IS NULL AND receipt_redacted)),
 CHECK((receipt_redacted AND request_digest IS NULL) OR (NOT receipt_redacted AND request_digest IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$'))
);
ALTER TABLE public.v2_field_decisions ADD COLUMN resolution_id uuid REFERENCES public.v2_field_resolutions(review_id);
ALTER TABLE public.v2_field_decisions ADD COLUMN review_blocked boolean NOT NULL DEFAULT false;
CREATE TABLE public.v2_field_resolution_inputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_id uuid NOT NULL REFERENCES public.v2_field_resolutions(review_id),
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 rejected boolean NOT NULL,evidence_digest text,erased boolean NOT NULL DEFAULT false,
 UNIQUE(review_id,observation_id),
 CHECK((erased AND observation_id IS NULL AND evidence_digest IS NULL)
   OR (NOT erased AND observation_id IS NOT NULL AND evidence_digest IS NOT NULL AND evidence_digest ~ '^[0-9a-f]{64}$'))
);
CREATE INDEX v2_resolution_input_observation_idx ON public.v2_field_resolution_inputs(observation_id);
CREATE TABLE public.v2_field_case_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES public.v2_review_cases(id),
 assessment_id uuid NOT NULL REFERENCES public.v2_field_assessments(id),case_revision bigint NOT NULL CHECK(case_revision>=1),
 action text NOT NULL CHECK(action IN ('open','reopen')),reason_code text NOT NULL CHECK(reason_code IN ('current_conflict','new_after_rejection','selection_lost')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(case_id,case_revision)
);

CREATE FUNCTION public.v2_evaluate_assessment_excluding(subject uuid,field text,scope jsonb,as_of timestamptz,policy text,excluded uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 WITH rows AS MATERIALIZED (
   SELECT observation_id,owner_id,value,evidence_date,freshness,temporal_class,complete_scope,basis_eligible,known_source,source_groups,
     admissible AND NOT(observation_id=ANY(excluded)) admissible,
     CASE WHEN observation_id=ANY(excluded) THEN 'review_excluded' ELSE reason END reason,next_change,state_revision,target_revision
   FROM public.v2_assessment_rows(subject,field,scope,as_of,policy)),
 ranked AS (
   SELECT *,row_number() OVER(PARTITION BY owner_id,source_groups ORDER BY admissible DESC,
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

-- One implementation of support computation, with an explicit exclusion input.
CREATE OR REPLACE FUNCTION public.v2_evaluate_assessment(subject uuid,field text,scope jsonb,as_of timestamptz,policy text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT public.v2_evaluate_assessment_excluding(subject,field,scope,as_of,policy,ARRAY[]::uuid[]);
$$;

-- Evidence identity excludes presentation time and changing freshness labels.
-- IDs refer to immutable typed values/scope; state/target/source changes matter.
CREATE FUNCTION public.v2_field_input_fingerprint(input jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT public.v2_assessment_hash(jsonb_build_object('input',input-ARRAY['freshness','reason','admissible'],
   'originMembers',public.v2_source_component(ARRAY(SELECT source_id FROM public.v2_observation_sources WHERE observation_id=(input->>'observationId')::uuid))));
$$;
CREATE FUNCTION public.v2_field_assessment_ready(assessment uuid) RETURNS public.v2_field_assessments
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE a public.v2_field_assessments;
BEGIN
 SELECT * INTO a FROM public.v2_field_assessments WHERE id=assessment;
 IF a.id IS NULL OR a.invalidated OR a.erased OR NOT EXISTS(SELECT 1 FROM public.v2_subjects s
   WHERE s.id=a.subject_id AND s.lifecycle='active' AND s.input_generation=a.input_generation)
   OR a.policy_version<>(SELECT version FROM public.v2_evidence_policy_state WHERE id)
   OR NOT EXISTS(SELECT 1 FROM public.v2_current_assessments WHERE assessment_id=a.id) THEN
   RAISE EXCEPTION 'v2_field_assessment_stale' USING ERRCODE='40001'; END IF;
 RETURN a;
END; $$;
CREATE FUNCTION public.v2_evaluate_field_result(assessment uuid,excluded uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.v2_field_assessments; result jsonb;
BEGIN
 SELECT * INTO a FROM public.v2_field_assessments WHERE id=assessment;
 result:=public.v2_evaluate_assessment_excluding(a.subject_id,a.field_key,a.scope,a.assessed_at,a.policy_version,excluded);
 -- Historical contradictions are reviewed within one actual journey/date/scope,
 -- without promoting historical observations to current ongoing evidence.
 IF EXISTS(SELECT 1 FROM public.v2_assessment_rows(a.subject_id,a.field_key,a.scope,a.assessed_at,a.policy_version)
   WHERE temporal_class='historical' AND admissible AND complete_scope AND basis_eligible AND NOT(observation_id=ANY(excluded))
   GROUP BY CASE WHEN a.field_key LIKE 'fare.%' THEN value->>'currency' ELSE '' END HAVING count(DISTINCT value)>1) THEN
   result:=jsonb_set(result,'{dispute}','"open"'::jsonb);
 END IF;
 RETURN result;
END; $$;
CREATE FUNCTION public.v2_field_review_result(assessment uuid,resolution uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.v2_field_assessments; r public.v2_field_resolutions; excluded uuid[]:=ARRAY[]::uuid[]; chosen jsonb; result jsonb;
BEGIN
 SELECT * INTO a FROM public.v2_field_assessments WHERE id=assessment;
 IF resolution IS NOT NULL THEN
   SELECT * INTO r FROM public.v2_field_resolutions WHERE review_id=resolution AND NOT erased;
   IF r.review_id IS NULL THEN RAISE EXCEPTION 'v2_field_resolution_missing' USING ERRCODE='23514'; END IF;
   SELECT COALESCE(array_agg(i.observation_id),ARRAY[]::uuid[]) INTO excluded FROM public.v2_field_resolution_inputs i
     JOIN public.v2_assessment_inputs ai ON ai.observation_id=i.observation_id AND ai.assessment_id=a.id
     WHERE i.review_id=resolution AND i.rejected AND NOT i.erased
       AND i.evidence_digest=public.v2_field_input_fingerprint(ai.snapshot || jsonb_build_object('observationId',ai.observation_id));
   SELECT value INTO chosen FROM public.v2_assessment_rows(a.subject_id,a.field_key,a.scope,a.assessed_at,a.policy_version)
     WHERE observation_id=r.chosen_observation_id AND admissible;
 END IF;
 result:=public.v2_evaluate_field_result(a.id,excluded);
 RETURN result || jsonb_build_object('choice',chosen,'excluded',excluded);
END; $$;
CREATE FUNCTION public.v2_field_active_resolution(subject uuid,field text,scope_hash text) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT r.review_id FROM public.v2_field_review_threads t JOIN public.v2_review_cases c ON c.id=t.case_id
 JOIN public.v2_field_resolutions r ON r.review_id=c.last_decision_id JOIN public.v2_review_decisions d ON d.id=r.review_id
 WHERE t.subject_id=subject AND t.field_key=field AND t.scope_key=scope_hash AND c.state='resolved'
   AND d.action IN ('accept','reject') AND NOT d.evidence_erased AND NOT r.erased;
$$;
CREATE FUNCTION public.v2_field_expected(assessment uuid,resolution uuid,blocked boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.v2_field_assessments; result jsonb; candidate jsonb; choice jsonb; dispute text; action text;
BEGIN
 SELECT * INTO a FROM public.v2_field_assessments WHERE id=assessment;
 result:=public.v2_field_review_result(assessment,resolution);
 choice:=NULLIF(result->'choice','null'::jsonb); dispute:=result->>'dispute';
 IF resolution IS NOT NULL THEN SELECT d.action INTO action FROM public.v2_review_decisions d WHERE d.id=resolution; END IF;
 IF choice IS NULL AND resolution IS NULL AND dispute='none' AND jsonb_array_length(result->'candidates')=1 THEN
   choice:=result->'candidates'->0->'value';
 END IF;
 IF dispute='open' OR action='reject' OR blocked THEN choice:=NULL; END IF;
 IF choice IS NOT NULL THEN
   SELECT x INTO candidate FROM jsonb_array_elements(result->'candidates') x WHERE x->'value'=choice;
 END IF;
 IF action='accept' AND candidate IS NOT NULL AND dispute='none' THEN dispute:='resolved'; END IF;
 RETURN jsonb_build_object('value',candidate->'value','support',COALESCE(candidate->>'support','unknown'),
   'freshness',COALESCE(candidate->>'freshness','unknown'),'dispute',dispute,
   'publication',CASE WHEN candidate IS NULL THEN 'withheld' ELSE 'provisional' END,
   'inputDigest',public.v2_assessment_hash(jsonb_build_array(a.input_digest,a.input_generation,resolution,blocked,result-'assessedAt')),
   'result',result);
END; $$;

-- Database-owner processing boundary until the authenticated leased worker exists.
CREATE FUNCTION public.v2_process_field_assessment(assessment uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.v2_field_assessments; c public.v2_review_cases; resolution uuid; result jsonb; expectation jsonb;
 reason text; selected_id uuid; previous public.v2_field_decisions; subject_revision bigint; item jsonb;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 a:=public.v2_field_assessment_ready(assessment);
 resolution:=public.v2_field_active_resolution(a.subject_id,a.field_key,a.scope_key);
 result:=public.v2_field_review_result(a.id,resolution);
 SELECT rc.* INTO c FROM public.v2_field_review_threads t JOIN public.v2_review_cases rc ON rc.id=t.case_id
   WHERE t.subject_id=a.subject_id AND t.field_key=a.field_key AND t.scope_key=a.scope_key FOR UPDATE OF rc;
 IF result->>'dispute'='open' THEN reason:='current_conflict';
 ELSIF resolution IS NOT NULL AND EXISTS(SELECT 1 FROM public.v2_review_decisions WHERE id=resolution AND action='reject')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(result->'inputs') x WHERE (x->>'admissible')::boolean AND (x->>'completeScope')::boolean) THEN reason:='new_after_rejection';
 ELSIF resolution IS NOT NULL AND EXISTS(SELECT 1 FROM public.v2_review_decisions WHERE id=resolution AND action='accept')
   AND result->'choice'='null'::jsonb THEN reason:='selection_lost'; END IF;
 IF reason IS NOT NULL THEN
   IF c.id IS NULL THEN
     INSERT INTO public.v2_review_cases(subject_id,subject_kind,field_key,scope_key,kind)
       SELECT id,kind,a.field_key,a.scope_key,'conflict' FROM public.v2_subjects WHERE id=a.subject_id RETURNING * INTO c;
     INSERT INTO public.v2_field_review_threads VALUES(a.subject_id,a.field_key,a.scope_key,c.id);
     INSERT INTO public.v2_field_case_events(case_id,assessment_id,case_revision,action,reason_code) VALUES(c.id,a.id,c.revision,'open',reason);
   ELSIF c.state IN ('resolved','dismissed') THEN
     UPDATE public.v2_review_cases SET state='reopened',revision=revision+1 WHERE id=c.id RETURNING * INTO c;
     INSERT INTO public.v2_field_case_events(case_id,assessment_id,case_revision,action,reason_code) VALUES(c.id,a.id,c.revision,'reopen',reason);
   END IF;
   resolution:=NULL;
 END IF;
 expectation:=public.v2_field_expected(a.id,resolution,COALESCE(c.state IN ('open','in_review','reopened'),false));
 SELECT * INTO previous FROM public.v2_field_decisions WHERE subject_id=a.subject_id AND field_key=a.field_key AND scope_key=a.scope_key ORDER BY revision DESC LIMIT 1;
 IF previous.input_digest=expectation->>'inputDigest' AND NOT previous.invalidated
   AND EXISTS(SELECT 1 FROM public.v2_current_fields WHERE field_decision_id=previous.id) THEN RETURN previous.id; END IF;
 SELECT revision INTO subject_revision FROM public.v2_subjects WHERE id=a.subject_id;
 selected_id:=gen_random_uuid();
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_field_subtype,public.v2_field_evidence_valid DEFERRED;
 INSERT INTO public.v2_decision_ids(id,kind) VALUES(selected_id,'field');
 INSERT INTO public.v2_field_decisions(id,subject_id,field_key,scope_key,scope,revision,expected_subject_revision,input_generation,
   selected_value,support_status,dispute_status,freshness,publication,reason_codes,policy_version,input_digest,assessed_at,next_recheck_at,
   reviewer_decision_id,previous_decision_id,assessment_id,resolution_id,review_blocked)
 VALUES(selected_id,a.subject_id,a.field_key,a.scope_key,a.scope,COALESCE(previous.revision,0)+1,subject_revision,a.input_generation,
   NULLIF(expectation->'value','null'::jsonb),expectation->>'support',expectation->>'dispute',expectation->>'freshness',expectation->>'publication',
   ARRAY[CASE WHEN resolution IS NULL THEN 'assessed_evidence' ELSE 'reviewed_evidence' END],a.policy_version,expectation->>'inputDigest',a.assessed_at,a.valid_until,
   CASE WHEN expectation->>'dispute'='resolved' THEN resolution END,previous.id,a.id,resolution,COALESCE(c.state IN ('open','in_review','reopened'),false));
 FOR item IN SELECT x FROM jsonb_array_elements(expectation->'result'->'inputs') x LOOP
   INSERT INTO public.v2_field_decision_evidence(field_decision_id,observation_id,disposition,reason_code)
   SELECT selected_id,(item->>'observationId')::uuid,
     CASE WHEN NOT (item->>'admissible')::boolean THEN 'excluded'
       WHEN r.value=NULLIF(expectation->'value','null'::jsonb) THEN 'supporting' ELSE 'conflicting' END,item->>'reason'
     FROM public.v2_assessment_rows(a.subject_id,a.field_key,a.scope,a.assessed_at,a.policy_version) r WHERE r.observation_id=(item->>'observationId')::uuid;
 END LOOP;
 PERFORM public.v2_apply_field_decision(selected_id);
 RETURN selected_id;
END; $$;

CREATE FUNCTION public.v2_resolve_field(actor varchar,assessment uuid,expected_case bigint,expected_subject bigint,
 choice uuid,excluded uuid[],decision_action text,reason text,private_note text,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.v2_field_assessments; c public.v2_review_cases; receipt public.v2_field_resolutions; fingerprint text; review uuid:=gen_random_uuid();
 canonical_excluded uuid[]; evaluated jsonb; chosen jsonb; s public.v2_subjects;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'v2_reviewer_required' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO canonical_excluded FROM unnest(excluded) x;
 IF request IS NULL OR cardinality(canonical_excluded)<>COALESCE(cardinality(excluded),0) OR array_position(canonical_excluded,NULL) IS NOT NULL
   OR decision_action IS NULL OR decision_action NOT IN ('accept','reject') OR (decision_action='accept')<>(choice IS NOT NULL)
   OR choice=ANY(canonical_excluded) THEN RAISE EXCEPTION 'v2_field_resolution_request_invalid' USING ERRCODE='23514'; END IF;
 fingerprint:=public.v2_assessment_hash(jsonb_build_array(actor,assessment,expected_case,expected_subject,choice,canonical_excluded,decision_action,reason,private_note));
 SELECT * INTO receipt FROM public.v2_field_resolutions WHERE request_id=request;
 IF FOUND THEN
   IF receipt.erased OR receipt.receipt_redacted OR receipt.request_digest<>fingerprint THEN RAISE EXCEPTION 'v2_field_resolution_retry_conflict' USING ERRCODE='23514'; END IF;
   RETURN receipt.review_id;
 END IF;
 a:=public.v2_field_assessment_ready(assessment);
 -- The reviewer must see a still-valid assessment, not backdate a judgement.
 IF a.valid_until<=statement_timestamp() THEN RAISE EXCEPTION 'v2_field_assessment_expired' USING ERRCODE='40001'; END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=a.subject_id FOR UPDATE;
 IF s.revision IS DISTINCT FROM expected_subject THEN RAISE EXCEPTION 'v2_field_review_revision_conflict' USING ERRCODE='40001'; END IF;
 SELECT rc.* INTO c FROM public.v2_field_review_threads t JOIN public.v2_review_cases rc ON rc.id=t.case_id
 WHERE t.subject_id=a.subject_id AND t.field_key=a.field_key AND t.scope_key=a.scope_key FOR UPDATE OF rc;
 IF c.id IS NULL THEN
   IF expected_case IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'v2_field_review_revision_conflict' USING ERRCODE='40001'; END IF;
   INSERT INTO public.v2_review_cases(subject_id,subject_kind,field_key,scope_key,kind)
     VALUES(a.subject_id,s.kind,a.field_key,a.scope_key,'correction') RETURNING * INTO c;
   INSERT INTO public.v2_field_review_threads VALUES(a.subject_id,a.field_key,a.scope_key,c.id);
 ELSIF c.revision IS DISTINCT FROM expected_case OR c.state IN ('resolved','dismissed') THEN
   RAISE EXCEPTION 'v2_field_review_revision_conflict' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(canonical_excluded) x WHERE NOT EXISTS
   (SELECT 1 FROM public.v2_assessment_inputs WHERE assessment_id=a.id AND observation_id=x AND NOT erased)) THEN
   RAISE EXCEPTION 'v2_field_exclusion_scope_mismatch' USING ERRCODE='23514'; END IF;
 evaluated:=public.v2_evaluate_field_result(a.id,canonical_excluded);
 IF decision_action='accept' THEN
   SELECT value INTO chosen FROM public.v2_assessment_rows(a.subject_id,a.field_key,a.scope,a.assessed_at,a.policy_version) WHERE observation_id=choice AND admissible;
   IF chosen IS NULL OR evaluated->>'dispute'='open' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evaluated->'candidates') x WHERE x->'value'=chosen) THEN
     RAISE EXCEPTION 'v2_field_choice_requires_uncontested_live_evidence' USING ERRCODE='23514'; END IF;
 ELSIF jsonb_array_length(evaluated->'candidates')>0 THEN
   RAISE EXCEPTION 'v2_reject_requires_explicit_exclusions' USING ERRCODE='23514'; END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype DEFERRED;
 INSERT INTO public.v2_decision_ids(id,kind) VALUES(review,'review');
 INSERT INTO public.v2_review_decisions(id,case_id,action,expected_revision,expected_subject_revision,reason_code,private_reason,actor_user_id,policy_version)
 VALUES(review,c.id,decision_action,c.revision,s.revision,reason,private_note,actor,a.policy_version);
 INSERT INTO public.v2_review_decision_evidence(decision_id,observation_id)
   SELECT review,observation_id FROM public.v2_assessment_inputs WHERE assessment_id=a.id AND NOT erased;
 INSERT INTO public.v2_field_resolutions VALUES(review,a.id,choice,request,fingerprint,false,false);
 INSERT INTO public.v2_field_resolution_inputs(review_id,observation_id,rejected,evidence_digest)
   SELECT review,observation_id,observation_id=ANY(canonical_excluded),
     public.v2_field_input_fingerprint(snapshot || jsonb_build_object('observationId',observation_id))
   FROM public.v2_assessment_inputs WHERE assessment_id=a.id AND NOT erased;
 UPDATE public.v2_review_cases SET last_decision_id=review,state='resolved',revision=revision+1 WHERE id=c.id;
 -- Review changes interpretation, not the underlying observation generation.
 UPDATE public.v2_subjects SET revision=revision+1 WHERE id=a.subject_id;
 PERFORM public.v2_process_field_assessment(a.id);
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
   VALUES('assess',a.subject_id,a.input_generation,a.policy_version,review);
 RETURN review;
END; $$;

CREATE FUNCTION public.v2_field_resolution_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
   IF TG_TABLE_NAME='v2_field_resolutions' THEN
     IF (NOT OLD.erased OR NEW.erased) AND (NOT OLD.receipt_redacted OR NEW.receipt_redacted) AND NEW.receipt_redacted AND NEW.request_digest IS NULL
       AND (NEW.chosen_observation_id IS NOT DISTINCT FROM OLD.chosen_observation_id OR (NEW.erased AND NEW.chosen_observation_id IS NULL))
       AND to_jsonb(NEW)-ARRAY['erased','receipt_redacted','request_digest','chosen_observation_id']=to_jsonb(OLD)-ARRAY['erased','receipt_redacted','request_digest','chosen_observation_id'] THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='v2_field_resolution_inputs' THEN
     IF NEW.erased AND NEW.observation_id IS NULL AND NEW.evidence_digest IS NULL
       AND to_jsonb(NEW)-ARRAY['erased','observation_id','evidence_digest']=to_jsonb(OLD)-ARRAY['erased','observation_id','evidence_digest'] THEN RETURN NEW; END IF;
   END IF;
 END IF;
 RAISE EXCEPTION 'v2_field_resolution_history_immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_field_resolution_history BEFORE UPDATE OR DELETE ON public.v2_field_resolutions FOR EACH ROW EXECUTE FUNCTION public.v2_field_resolution_immutable();
CREATE TRIGGER v2_field_resolution_history BEFORE UPDATE OR DELETE ON public.v2_field_resolution_inputs FOR EACH ROW EXECUTE FUNCTION public.v2_field_resolution_immutable();
CREATE TRIGGER v2_field_resolution_history BEFORE UPDATE OR DELETE ON public.v2_field_case_events FOR EACH ROW EXECUTE FUNCTION public.v2_field_resolution_immutable();
CREATE TRIGGER v2_field_resolution_history BEFORE UPDATE OR DELETE ON public.v2_field_review_threads FOR EACH ROW EXECUTE FUNCTION public.v2_field_resolution_immutable();
CREATE FUNCTION public.v2_field_resolution_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.evidence_erased AND NOT OLD.evidence_erased THEN
   UPDATE public.v2_field_resolutions SET erased=true,receipt_redacted=true,chosen_observation_id=NULL,request_digest=NULL WHERE review_id=NEW.id;
   UPDATE public.v2_field_resolution_inputs SET erased=true,observation_id=NULL,evidence_digest=NULL WHERE review_id=NEW.id;
 ELSIF NEW.actor_erased AND NOT OLD.actor_erased THEN
   UPDATE public.v2_field_resolutions SET receipt_redacted=true,request_digest=NULL WHERE review_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_field_resolution_erase AFTER UPDATE ON public.v2_review_decisions FOR EACH ROW EXECUTE FUNCTION public.v2_field_resolution_erase();
CREATE FUNCTION public.v2_field_assessment_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.invalidated AND NOT OLD.invalidated) OR (NEW.erased AND NOT OLD.erased) THEN
   PERFORM public.v2_invalidate_derived(ARRAY(SELECT id FROM public.v2_field_decisions WHERE assessment_id=NEW.id),NEW.erased);
   IF NEW.erased AND NOT OLD.erased THEN
     UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE id IN
       (SELECT review_id FROM public.v2_field_resolutions WHERE assessment_id=NEW.id);
   END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_field_assessment_changed AFTER UPDATE ON public.v2_field_assessments FOR EACH ROW EXECUTE FUNCTION public.v2_field_assessment_changed();
CREATE FUNCTION public.v2_field_computed_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.v2_field_assessments; expected jsonb; blocked boolean; resolution uuid;
BEGIN
 IF NEW.assessment_id IS NULL THEN
   IF NEW.resolution_id IS NOT NULL OR NEW.review_blocked THEN RAISE EXCEPTION 'v2_field_assessment_required' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 a:=public.v2_field_assessment_ready(NEW.assessment_id);
 resolution:=public.v2_field_active_resolution(a.subject_id,a.field_key,a.scope_key);
 SELECT EXISTS(SELECT 1 FROM public.v2_field_review_threads t JOIN public.v2_review_cases c ON c.id=t.case_id
   WHERE t.subject_id=a.subject_id AND t.field_key=a.field_key AND t.scope_key=a.scope_key AND c.state IN ('open','in_review','reopened')) INTO blocked;
 expected:=public.v2_field_expected(a.id,resolution,blocked);
 IF ROW(NEW.subject_id,NEW.field_key,NEW.scope_key,NEW.scope,NEW.input_generation,NEW.policy_version,NEW.assessed_at,NEW.next_recheck_at,NEW.resolution_id,NEW.review_blocked)
   IS DISTINCT FROM ROW(a.subject_id,a.field_key,a.scope_key,a.scope,a.input_generation,a.policy_version,a.assessed_at,a.valid_until,resolution,blocked)
   OR ROW(NEW.selected_value,NEW.support_status,NEW.freshness,NEW.dispute_status,NEW.publication,NEW.input_digest)
   IS DISTINCT FROM ROW(NULLIF(expected->'value','null'::jsonb),expected->>'support',expected->>'freshness',expected->>'dispute',expected->>'publication',expected->>'inputDigest')
   OR NEW.reviewer_decision_id IS DISTINCT FROM CASE WHEN expected->>'dispute'='resolved' THEN resolution END
   OR NEW.expected_subject_revision IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=a.subject_id) THEN
   RAISE EXCEPTION 'v2_field_requires_computed_interpretation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_field_computed_insert BEFORE INSERT ON public.v2_field_decisions FOR EACH ROW EXECUTE FUNCTION public.v2_field_computed_insert();

CREATE OR REPLACE FUNCTION public.v2_validate_derived_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d public.v2_field_decisions; candidate public.v2_association_candidates; previous bigint;
BEGIN
 IF TG_TABLE_NAME='v2_field_decisions' THEN
   SELECT * INTO d FROM public.v2_field_decisions WHERE id=NEW.id;
 ELSE SELECT * INTO d FROM public.v2_field_decisions WHERE id=COALESCE(NEW.field_decision_id,OLD.field_decision_id); END IF;
 IF d.id IS NULL OR d.invalidated THEN RETURN NULL; END IF;
 IF d.assessment_id IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM public.v2_field_assessments WHERE id=d.assessment_id AND invalidated) THEN RETURN NULL; END IF;
   IF EXISTS(SELECT observation_id FROM public.v2_assessment_inputs WHERE assessment_id=d.assessment_id
     EXCEPT SELECT observation_id FROM public.v2_field_decision_evidence WHERE field_decision_id=d.id)
     OR EXISTS(SELECT observation_id FROM public.v2_field_decision_evidence WHERE field_decision_id=d.id
     EXCEPT SELECT observation_id FROM public.v2_assessment_inputs WHERE assessment_id=d.assessment_id) THEN
     RAISE EXCEPTION 'v2_field_input_set_mismatch' USING ERRCODE='23514'; END IF;
   IF EXISTS(
     (SELECT e.observation_id,e.disposition,e.reason_code FROM public.v2_field_decision_evidence e WHERE e.field_decision_id=d.id)
     EXCEPT
     (SELECT r.observation_id,CASE WHEN NOT (x->>'admissible')::boolean THEN 'excluded'
       WHEN r.value=d.selected_value THEN 'supporting' ELSE 'conflicting' END,x->>'reason'
      FROM public.v2_field_assessments a,
        LATERAL jsonb_array_elements(public.v2_field_expected(a.id,d.resolution_id,d.review_blocked)->'result'->'inputs') x,
        LATERAL public.v2_assessment_rows(a.subject_id,a.field_key,a.scope,a.assessed_at,a.policy_version) r
      WHERE a.id=d.assessment_id AND r.observation_id=(x->>'observationId')::uuid)) THEN
     RAISE EXCEPTION 'v2_field_evidence_disposition_mismatch' USING ERRCODE='23514'; END IF;
   IF d.previous_decision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.v2_field_decisions p WHERE p.id=d.previous_decision_id AND p.revision=d.revision-1) THEN
     RAISE EXCEPTION 'v2_field_revision_gap' USING ERRCODE='23514'; END IF;
   RETURN NULL;
 END IF;
 IF d.previous_decision_id IS NOT NULL THEN
   SELECT revision INTO previous FROM public.v2_field_decisions WHERE id=d.previous_decision_id;
   IF previous<>d.revision-1 THEN RAISE EXCEPTION 'v2_field_revision_gap' USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.v2_field_decision_evidence e JOIN public.v2_observations o ON o.id=e.observation_id
   WHERE e.field_decision_id=d.id AND (public.v2_observation_subject(o.id)<>d.subject_id OR o.field_key<>d.field_key OR o.scope_key<>d.scope_key OR o.scope<>d.scope)) THEN
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

CREATE FUNCTION public.v2_read_field_at(subject uuid,field text,scope_hash text,as_of timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT CASE WHEN NOT d.invalidated AND NOT d.erased AND NOT a.invalidated AND NOT a.erased
   AND s.lifecycle='active' AND d.input_generation=s.input_generation AND a.policy_version=(SELECT version FROM public.v2_evidence_policy_state WHERE id)
   AND d.assessed_at<=as_of AND (d.next_recheck_at IS NULL OR as_of<d.next_recheck_at)
   THEN jsonb_build_object('status',CASE WHEN d.review_blocked THEN 'review_required' ELSE 'assessed' END,
     'value',d.selected_value,'support',d.support_status,'freshness',d.freshness,'dispute',d.dispute_status,
     'publication',d.publication,'reviewed',d.resolution_id IS NOT NULL,'nextRecheckAt',d.next_recheck_at)
   ELSE jsonb_build_object('status','recheck_required') END
 FROM public.v2_current_fields c JOIN public.v2_field_decisions d ON d.id=c.field_decision_id
 JOIN public.v2_subjects s ON s.id=d.subject_id JOIN public.v2_field_assessments a ON a.id=d.assessment_id
 WHERE c.subject_id=subject AND c.field_key=field AND c.scope_key=scope_hash),jsonb_build_object('status','recheck_required'));
$$;
CREATE FUNCTION public.v2_read_field(subject uuid,field text,scope_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.v2_read_field_at(subject,field,scope_hash,statement_timestamp());
$$;
DO $$ DECLARE t text; role_name text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_field_review_threads','v2_field_resolutions','v2_field_resolution_inputs','v2_field_case_events'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
   END LOOP;
   EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
   EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
   EXECUTE format('CREATE TRIGGER v2_field_resolution_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND (p.proname LIKE 'v2_field_%' OR p.proname IN('v2_evaluate_assessment_excluding','v2_evaluate_field_result','v2_process_field_assessment','v2_resolve_field','v2_read_field_at','v2_read_field')) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
   END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_read_field(uuid,text,text) TO mabhazi_api;
