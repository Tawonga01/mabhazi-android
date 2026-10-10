-- Evidence assessments are computed inputs for later reviewed field selection.
-- The existing v2_field_policy_ready/publication gate is deliberately retained.
CREATE TABLE public.v2_evidence_policies (
 version text PRIMARY KEY CHECK(version ~ '^[a-z][a-z0-9_/-]{0,63}$'),
 engine text NOT NULL CHECK(engine='assessment/1'),
 schedule_days integer NOT NULL CHECK(schedule_days BETWEEN 1 AND 3650),
 place_days integer NOT NULL CHECK(place_days BETWEEN 1 AND 3650),
 operator_days integer NOT NULL CHECK(operator_days BETWEEN 1 AND 3650),
 disruption_days integer NOT NULL CHECK(disruption_days BETWEEN 1 AND 30),
 witness_count integer NOT NULL CHECK(witness_count=2),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.v2_evidence_policies(version,engine,schedule_days,place_days,operator_days,disruption_days,witness_count)
 VALUES('evidence/1','assessment/1',30,90,180,7,2);
CREATE TABLE public.v2_evidence_policy_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 version text NOT NULL REFERENCES public.v2_evidence_policies(version),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1)
);
INSERT INTO public.v2_evidence_policy_state(id,version) VALUES(true,'evidence/1');
CREATE TABLE public.v2_field_assessments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
 field_key text NOT NULL,
 scope_key text NOT NULL CHECK(scope_key ~ '^[0-9a-f]{64}$'),
 scope jsonb,
 revision bigint NOT NULL CHECK(revision>=1),
 previous_id uuid,
 subject_revision bigint NOT NULL CHECK(subject_revision>=1),
 input_generation bigint NOT NULL CHECK(input_generation>=1),
 source_graph_revision bigint NOT NULL CHECK(source_graph_revision>=1),
 policy_version text NOT NULL REFERENCES public.v2_evidence_policies(version),
 request_id uuid NOT NULL UNIQUE,
 request_digest text,
 input_digest text,
 assessed_at timestamptz NOT NULL,
 valid_until timestamptz,
 result jsonb,
 invalidated boolean NOT NULL DEFAULT false,
 erased boolean NOT NULL DEFAULT false,
 UNIQUE(id,subject_id,field_key,scope_key), UNIQUE(subject_id,field_key,scope_key,revision),
 FOREIGN KEY(previous_id,subject_id,field_key,scope_key) REFERENCES public.v2_field_assessments(id,subject_id,field_key,scope_key),
 CHECK((revision=1)=(previous_id IS NULL)), CHECK(previous_id IS NULL OR previous_id<>id),
 CHECK(valid_until IS NULL OR valid_until>assessed_at),
 CHECK((erased AND invalidated AND num_nonnulls(scope,result,request_digest,input_digest)=0)
   OR (NOT erased AND jsonb_typeof(scope)='object' AND scope IS NOT NULL AND jsonb_typeof(result)='object' AND result IS NOT NULL
     AND request_digest IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$' AND input_digest IS NOT NULL AND input_digest ~ '^[0-9a-f]{64}$'))
);
CREATE INDEX v2_assessment_due_idx ON public.v2_field_assessments(valid_until) WHERE NOT invalidated;
CREATE TABLE public.v2_assessment_inputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 assessment_id uuid NOT NULL REFERENCES public.v2_field_assessments(id),
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 snapshot jsonb,
 erased boolean NOT NULL DEFAULT false,
 UNIQUE(assessment_id,observation_id),
 CHECK((erased AND observation_id IS NULL AND snapshot IS NULL)
   OR (NOT erased AND observation_id IS NOT NULL AND snapshot IS NOT NULL AND jsonb_typeof(snapshot)='object'))
);
CREATE INDEX v2_assessment_observation_idx ON public.v2_assessment_inputs(observation_id);
CREATE TABLE public.v2_current_assessments (
 subject_id uuid NOT NULL, field_key text NOT NULL, scope_key text NOT NULL,
 assessment_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(subject_id,field_key,scope_key),
 FOREIGN KEY(assessment_id,subject_id,field_key,scope_key) REFERENCES public.v2_field_assessments(id,subject_id,field_key,scope_key)
);

CREATE FUNCTION public.v2_assessment_hash(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex'); $$;
-- Inclusive evidence day plus policy window; unknown zone expires at the
-- earliest worldwide day boundary (UTC+14), never at the phone/server timezone.
CREATE FUNCTION public.v2_assessment_day_end(day date,days integer,zone text) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN day IS NOT NULL AND isfinite(day) THEN (day+days+1)::timestamp AT TIME ZONE COALESCE(zone,'Pacific/Kiritimati') END;
$$;
CREATE FUNCTION public.v2_assessment_scope_complete(field text,kind text,value jsonb,scope jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(CASE
 WHEN field IN('operator.identity','operator.reported') THEN value->>'id' IS NOT NULL
 WHEN field='departure.reported' THEN false -- unresolved clock/basis is not a dated run
 WHEN field='service.mode' THEN kind='service_plan' AND value->>'mode'<>'unknown'
 WHEN field='service.calendar' THEN kind='service_plan' AND value->>'timezone' IS NOT NULL
   AND (value->>'dates' IS NOT NULL OR (value->>'weekdays' IS NOT NULL AND value->>'startDate' IS NOT NULL AND value->>'endDate' IS NOT NULL))
 WHEN field IN('departure.scheduled','arrival.scheduled') THEN kind='run' AND scope->>'timezone' IS NOT NULL
   AND (scope->>'serviceDate' IS NOT NULL OR (scope->>'effectiveFrom' IS NOT NULL AND scope->>'effectiveTo' IS NOT NULL))
 WHEN field IN('departure.actual','arrival.actual') THEN scope->>'serviceDate' IS NOT NULL
   AND (scope->>'timezone' IS NOT NULL OR scope->>'utcOffset' IS NOT NULL)
 WHEN field IN('boarding.pickup','alighting.dropoff') THEN kind='actual_journey'
 WHEN field='pattern.stops' THEN kind='pattern' AND (value->>'stopsComplete')::boolean
 WHEN field='stop.location' THEN value->>'precision'='named_place'
 WHEN field LIKE 'fare.%' THEN scope->>'passengerCategory'<>'unknown' AND scope->>'ticketBasis'<>'unknown'
   AND scope->>'paymentMethod' IS NOT NULL AND scope->>'luggageIncluded' IS NOT NULL
   AND scope->>'timeBasis' IN('scheduled','actual') AND CASE field
     WHEN 'fare.paid' THEN scope->>'serviceDate' IS NOT NULL
     WHEN 'fare.quoted' THEN scope->>'quotationDate' IS NOT NULL
     ELSE scope->>'serviceDate' IS NOT NULL OR (scope->>'effectiveFrom' IS NOT NULL AND scope->>'effectiveTo' IS NOT NULL) END
 WHEN field='service.operating_status' THEN kind IN('service_plan','run') AND scope->>'timezone' IS NOT NULL
 WHEN field='timetable.sign_presence' THEN scope->>'serviceDate' IS NOT NULL
 ELSE false END,false);
$$;

-- Each row preserves why evidence is/was eligible. All dates come from evidence,
-- never submitted_at or review time. No account identity is copied to snapshots.
CREATE FUNCTION public.v2_assessment_rows(subject uuid,field text,requested_scope jsonb,as_of timestamptz,policy text)
RETURNS TABLE(observation_id uuid,owner_id varchar,value jsonb,evidence_date date,freshness text,temporal_class text,
 complete_scope boolean,basis_eligible boolean,known_source boolean,source_groups uuid[],admissible boolean,
 reason text,next_change timestamptz,state_revision bigint,target_revision bigint)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE o record; p public.v2_evidence_policies; kind text; zone text; dated date; source_day date; source_latest date; start_day date; end_day date;
 horizon integer; due timestamptz; expires timestamptz; starts timestamptz; local_day date; fp jsonb; bad_date boolean;
BEGIN
 SELECT * INTO p FROM public.v2_evidence_policies WHERE version=policy;
 IF p.version IS NULL OR as_of IS NULL OR NOT isfinite(as_of) THEN RAISE EXCEPTION 'v2_assessment_policy_time_invalid' USING ERRCODE='23514'; END IF;
 SELECT s.kind INTO kind FROM public.v2_subjects s WHERE s.id=subject;
 IF NOT public.v2_observation_kind_valid(field,kind) OR requested_scope IS NULL OR jsonb_typeof(requested_scope)<>'object' THEN
   RAISE EXCEPTION 'v2_assessment_subject_field_invalid' USING ERRCODE='23514'; END IF;
 FOR o IN SELECT ob.*,c.user_id,st.status,st.revision state_rev,t.revision target_rev
   FROM public.v2_observations ob JOIN public.v2_contributions c ON c.id=ob.contribution_id
   JOIN public.v2_observation_states st ON st.observation_id=ob.id JOIN public.v2_observation_targets t ON t.observation_id=ob.id
   WHERE public.v2_observation_subject(ob.id)=subject AND ob.field_key=field AND jsonb_strip_nulls(ob.scope)=jsonb_strip_nulls(requested_scope)
   ORDER BY ob.id LOOP
   observation_id:=o.id; owner_id:=o.user_id; value:=o.value; state_revision:=o.state_rev; target_revision:=o.target_rev;
   IF field LIKE 'fare.%' THEN value:=jsonb_set(value,'{amount}',to_jsonb(trim_scale((value->>'amount')::numeric)::text)); END IF;
   zone:=COALESCE(o.scope->>'timezone',CASE WHEN field='service.calendar' THEN o.value->>'timezone' END);
   local_day:=(as_of AT TIME ZONE COALESCE(zone,'Pacific/Kiritimati'))::date;
   fp:=public.v2_source_footprint(o.id);
   known_source:=(fp->>'known')::boolean;
   SELECT COALESCE(array_agg(x::uuid ORDER BY x::uuid),ARRAY[]::uuid[]) INTO source_groups FROM jsonb_array_elements_text(fp->'groups') x;
   SELECT min(s.source_date),max(s.source_date) INTO source_day,source_latest FROM public.v2_sources s WHERE s.id=ANY(public.v2_source_component(
     ARRAY(SELECT os.source_id FROM public.v2_observation_sources os WHERE os.observation_id=o.id)));
   dated:=least(o.observed_from,source_day,(o.scope->>'sourceDate')::date,
     CASE WHEN field='fare.quoted' THEN (o.scope->>'quotationDate')::date END);
   temporal_class:=CASE WHEN field IN('fare.paid','departure.actual','arrival.actual') THEN 'historical' ELSE 'ongoing' END;
   IF temporal_class='historical' THEN dated:=(o.scope->>'serviceDate')::date; END IF;
   IF field='timetable.sign_presence' THEN dated:=least(dated,(o.scope->>'serviceDate')::date); END IF;
   evidence_date:=dated;
   bad_date:=EXISTS(SELECT 1 FROM unnest(ARRAY[o.observed_from,o.observed_to,source_day,source_latest,
     (o.scope->>'sourceDate')::date,CASE WHEN field='fare.quoted' THEN (o.scope->>'quotationDate')::date END,dated]) d
     WHERE d IS NOT NULL AND (NOT isfinite(d) OR d>local_day));
   complete_scope:=public.v2_assessment_scope_complete(field,kind,o.value,o.scope);
   basis_eligible:=CASE
     WHEN field IN('departure.scheduled','arrival.scheduled','service.calendar','fare.advertised','fare.quoted') THEN o.knowledge_basis IN('observed_sign','operator_statement')
     WHEN field='fare.paid' THEN o.knowledge_basis='travelled'
     WHEN field='service.operating_status' THEN o.knowledge_basis IN('travelled','saw_operating','observed_sign','operator_statement') AND o.knowledge_basis=o.value->>'basis'
     ELSE o.knowledge_basis IN('travelled','saw_operating','observed_sign','operator_statement') END;
   horizon:=CASE WHEN field IN('operator.reported','operator.identity') THEN p.operator_days
     WHEN field IN('boarding.pickup','alighting.dropoff','pattern.stops','stop.location','timetable.sign_presence') THEN p.place_days ELSE p.schedule_days END;
   start_day:=greatest(o.effective_from,(o.scope->>'effectiveFrom')::date,
     CASE WHEN field NOT IN('fare.paid','fare.quoted','departure.actual','arrival.actual','timetable.sign_presence') THEN (o.scope->>'serviceDate')::date END,
     CASE WHEN field='service.calendar' THEN (o.value->>'startDate')::date END);
   end_day:=least(o.effective_to,(o.scope->>'effectiveTo')::date,
     CASE WHEN field NOT IN('fare.paid','fare.quoted','departure.actual','arrival.actual','timetable.sign_presence') THEN (o.scope->>'serviceDate')::date END,
     CASE WHEN field='service.calendar' THEN (o.value->>'endDate')::date END);
   IF field='service.calendar' AND o.value->>'dates' IS NOT NULL THEN
     SELECT greatest(start_day,min(x::date)),least(end_day,max(x::date)) INTO start_day,end_day FROM jsonb_array_elements_text(o.value->'dates') x;
   END IF;
   due:=CASE WHEN temporal_class='ongoing' THEN public.v2_assessment_day_end(dated,horizon,zone) END;
   expires:=CASE WHEN temporal_class='ongoing' THEN public.v2_assessment_day_end(end_day,0,zone) END;
   starts:=CASE WHEN start_day IS NOT NULL AND temporal_class='ongoing'
     THEN start_day::timestamp AT TIME ZONE COALESCE(zone,'Etc/GMT+12') END; -- conservative latest start when zone unknown
   IF field='service.operating_status' AND o.value->>'status'<>'operating' THEN
     expires:=least(expires,public.v2_assessment_day_end(COALESCE(dated,start_day),p.disruption_days-1,zone));
   END IF;
   freshness:=CASE WHEN expires<=as_of THEN 'expired' WHEN dated IS NULL OR dated>local_day THEN 'unknown'
     WHEN temporal_class='historical' THEN 'unknown' WHEN due<=as_of THEN 'recheck_due' ELSE 'current' END;
   admissible:=o.status='active' AND NOT bad_date
     AND (starts IS NULL OR starts<=as_of) AND freshness<>'expired';
   reason:=CASE WHEN o.status<>'active' THEN o.status WHEN bad_date THEN 'future_or_invalid_date'
     WHEN starts>as_of THEN 'not_yet_effective' WHEN freshness='expired' THEN 'expired'
     WHEN NOT complete_scope THEN 'needs_context' WHEN dated IS NULL THEN 'date_unknown'
     WHEN temporal_class='historical' THEN 'historical_evidence' WHEN freshness='recheck_due' THEN 'recheck_due'
     WHEN NOT known_source THEN 'source_unknown' WHEN NOT basis_eligible THEN 'basis_ineligible' ELSE 'eligible' END;
   SELECT min(v) INTO next_change FROM unnest(ARRAY[due,expires,starts,
     CASE WHEN dated>local_day THEN dated::timestamp AT TIME ZONE COALESCE(zone,'Etc/GMT+12') END]) v WHERE v>as_of;
   RETURN NEXT;
 END LOOP;
END; $$;

CREATE FUNCTION public.v2_evaluate_assessment(subject uuid,field text,scope jsonb,as_of timestamptz,policy text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 WITH rows AS MATERIALIZED (SELECT * FROM public.v2_assessment_rows(subject,field,scope,as_of,policy)),
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

CREATE FUNCTION public.v2_invalidate_assessments(ids uuid[],erase boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_field_assessments SET invalidated=true,erased=erased OR erase,
   scope=CASE WHEN erase THEN NULL ELSE scope END,result=CASE WHEN erase THEN NULL ELSE result END,
   request_digest=CASE WHEN erase THEN NULL ELSE request_digest END,input_digest=CASE WHEN erase THEN NULL ELSE input_digest END
   WHERE id=ANY(ids) AND (NOT invalidated OR (erase AND NOT erased));
 IF erase THEN UPDATE public.v2_assessment_inputs SET erased=true,observation_id=NULL,snapshot=NULL WHERE assessment_id=ANY(ids) AND NOT erased; END IF;
 DELETE FROM public.v2_current_assessments WHERE assessment_id=ANY(ids);
END; $$;
CREATE FUNCTION public.v2_assessment_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
   IF TG_TABLE_NAME='v2_field_assessments' AND (NOT OLD.invalidated OR NEW.invalidated) AND (NOT OLD.erased OR NEW.erased)
     AND (NEW.erased OR (NEW.result IS NOT DISTINCT FROM OLD.result AND NEW.scope IS NOT DISTINCT FROM OLD.scope
       AND NEW.request_digest IS NOT DISTINCT FROM OLD.request_digest AND NEW.input_digest IS NOT DISTINCT FROM OLD.input_digest))
     AND to_jsonb(NEW)-ARRAY['invalidated','erased','result','scope','request_digest','input_digest']
       =to_jsonb(OLD)-ARRAY['invalidated','erased','result','scope','request_digest','input_digest'] THEN RETURN NEW; END IF;
   IF TG_TABLE_NAME='v2_assessment_inputs' AND NEW.erased AND NEW.observation_id IS NULL AND NEW.snapshot IS NULL
     AND to_jsonb(NEW)-ARRAY['erased','observation_id','snapshot']=to_jsonb(OLD)-ARRAY['erased','observation_id','snapshot'] THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'v2_assessment_history_immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_assessment_history BEFORE UPDATE OR DELETE ON public.v2_field_assessments FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_history_guard();
CREATE TRIGGER v2_assessment_history BEFORE UPDATE OR DELETE ON public.v2_assessment_inputs FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_history_guard();
CREATE TRIGGER v2_assessment_history BEFORE UPDATE OR DELETE ON public.v2_evidence_policies FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_history_guard();

CREATE FUNCTION public.v2_assessment_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.v2_subjects; evaluated jsonb; latest public.v2_field_assessments;
BEGIN
 SELECT * INTO s FROM public.v2_subjects WHERE id=NEW.subject_id;
 IF s.lifecycle<>'active' OR NEW.subject_revision IS DISTINCT FROM s.revision OR NEW.input_generation IS DISTINCT FROM s.input_generation
   OR NEW.source_graph_revision IS DISTINCT FROM (SELECT revision FROM public.v2_source_graph WHERE id)
   OR NEW.policy_version IS DISTINCT FROM (SELECT version FROM public.v2_evidence_policy_state WHERE id) THEN
   RAISE EXCEPTION 'v2_assessment_input_revision_conflict' USING ERRCODE='40001'; END IF;
 SELECT * INTO latest FROM public.v2_field_assessments WHERE subject_id=NEW.subject_id AND field_key=NEW.field_key AND scope_key=NEW.scope_key ORDER BY revision DESC LIMIT 1;
 IF NEW.previous_id IS DISTINCT FROM latest.id OR NEW.revision<>COALESCE(latest.revision,0)+1 OR NEW.invalidated OR NEW.erased THEN
   RAISE EXCEPTION 'v2_assessment_lineage_invalid' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_observations o WHERE public.v2_observation_subject(o.id)=NEW.subject_id AND o.field_key=NEW.field_key
   AND ((o.scope_key=NEW.scope_key AND jsonb_strip_nulls(o.scope)<>jsonb_strip_nulls(NEW.scope))
     OR (o.scope_key<>NEW.scope_key AND jsonb_strip_nulls(o.scope)=jsonb_strip_nulls(NEW.scope)))) THEN
   RAISE EXCEPTION 'v2_assessment_scope_hash_inconsistent' USING ERRCODE='23514'; END IF;
 evaluated:=public.v2_evaluate_assessment(NEW.subject_id,NEW.field_key,NEW.scope,NEW.assessed_at,NEW.policy_version);
 IF NEW.result IS DISTINCT FROM evaluated-'inputs' OR NEW.input_digest IS DISTINCT FROM public.v2_assessment_hash(evaluated)
   OR NEW.valid_until IS DISTINCT FROM (evaluated->>'nextChangeAt')::timestamptz THEN
   RAISE EXCEPTION 'v2_assessment_requires_computed_evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_assessment_validate BEFORE INSERT ON public.v2_field_assessments FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_validate();
CREATE FUNCTION public.v2_assessment_input_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.v2_field_assessments; actual jsonb; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='v2_field_assessments' THEN SELECT * INTO a FROM public.v2_field_assessments WHERE id=COALESCE(NEW.id,OLD.id);
 ELSE SELECT * INTO a FROM public.v2_field_assessments WHERE id=COALESCE(NEW.assessment_id,OLD.assessment_id); END IF;
 IF a.id IS NULL OR a.invalidated THEN RETURN NULL; END IF;
 expected:=public.v2_evaluate_assessment(a.subject_id,a.field_key,a.scope,a.assessed_at,a.policy_version)->'inputs';
 SELECT COALESCE(jsonb_agg(snapshot || jsonb_build_object('observationId',observation_id) ORDER BY observation_id),'[]'::jsonb)
   INTO actual FROM public.v2_assessment_inputs WHERE assessment_id=a.id;
 IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'v2_assessment_input_snapshot_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_assessment_snapshot_valid AFTER INSERT OR UPDATE ON public.v2_field_assessments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_input_check();
CREATE CONSTRAINT TRIGGER v2_assessment_snapshot_valid AFTER INSERT OR UPDATE OR DELETE ON public.v2_assessment_inputs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_input_check();

CREATE FUNCTION public.v2_assess_field(subject uuid,field text,scope_hash text,requested_scope jsonb,
 expected_subject bigint,expected_generation bigint,expected_graph bigint,as_of timestamptz,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.v2_field_assessments; s public.v2_subjects; policy text; result_id uuid:=gen_random_uuid();
 evaluated jsonb; fingerprint text; previous public.v2_field_assessments;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF request IS NULL OR as_of IS NULL OR as_of>statement_timestamp() OR NOT isfinite(as_of) THEN
   RAISE EXCEPTION 'v2_assessment_request_time_invalid' USING ERRCODE='23514'; END IF;
 fingerprint:=public.v2_assessment_hash(jsonb_build_array(subject,field,scope_hash,requested_scope,expected_subject,expected_generation,expected_graph,as_of));
 SELECT * INTO a FROM public.v2_field_assessments WHERE request_id=request;
 IF FOUND THEN
   IF a.erased OR a.request_digest<>fingerprint THEN RAISE EXCEPTION 'v2_assessment_request_conflict' USING ERRCODE='23514'; END IF;
   RETURN a.id; -- receipt, never reapply an invalidated result
 END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=subject FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_assessment_subject_missing' USING ERRCODE='23503'; END IF;
 IF expected_subject IS DISTINCT FROM s.revision OR expected_generation IS DISTINCT FROM s.input_generation
   OR expected_graph IS DISTINCT FROM (SELECT revision FROM public.v2_source_graph WHERE id) THEN
   RAISE EXCEPTION 'v2_assessment_input_revision_conflict' USING ERRCODE='40001'; END IF;
 SELECT version INTO policy FROM public.v2_evidence_policy_state WHERE id;
 evaluated:=public.v2_evaluate_assessment(subject,field,requested_scope,as_of,policy);
 SELECT * INTO previous FROM public.v2_field_assessments WHERE subject_id=subject AND field_key=field AND scope_key=scope_hash ORDER BY revision DESC LIMIT 1;
 SET CONSTRAINTS public.v2_assessment_snapshot_valid DEFERRED;
 INSERT INTO public.v2_field_assessments(id,subject_id,field_key,scope_key,scope,revision,previous_id,subject_revision,input_generation,
   source_graph_revision,policy_version,request_id,request_digest,input_digest,assessed_at,valid_until,result)
 VALUES(result_id,subject,field,scope_hash,requested_scope,COALESCE(previous.revision,0)+1,previous.id,s.revision,s.input_generation,
   expected_graph,policy,request,fingerprint,public.v2_assessment_hash(evaluated),as_of,(evaluated->>'nextChangeAt')::timestamptz,evaluated-'inputs');
 INSERT INTO public.v2_assessment_inputs(assessment_id,observation_id,snapshot)
   SELECT result_id,(x->>'observationId')::uuid,x-'observationId' FROM jsonb_array_elements(evaluated->'inputs') x;
 SET CONSTRAINTS public.v2_assessment_snapshot_valid IMMEDIATE;
 SET CONSTRAINTS public.v2_assessment_snapshot_valid DEFERRED;
 INSERT INTO public.v2_current_assessments VALUES(subject,field,scope_hash,result_id)
   ON CONFLICT(subject_id,field_key,scope_key) DO UPDATE SET assessment_id=excluded.assessment_id;
 IF (evaluated->>'nextChangeAt')::timestamptz IS NOT NULL THEN
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id,available_at)
     VALUES('assess',subject,s.input_generation,policy,result_id,(evaluated->>'nextChangeAt')::timestamptz);
 END IF;
 RETURN result_id;
END; $$;
CREATE FUNCTION public.v2_assessment_current_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 ELSIF EXISTS(SELECT 1 FROM public.v2_field_assessments a JOIN public.v2_subjects s ON s.id=a.subject_id
   WHERE a.id=NEW.assessment_id AND a.subject_id=NEW.subject_id AND a.field_key=NEW.field_key AND a.scope_key=NEW.scope_key
     AND NOT a.invalidated AND s.lifecycle='active' AND a.input_generation=s.input_generation
     AND a.policy_version=(SELECT version FROM public.v2_evidence_policy_state WHERE id)
     AND NOT EXISTS(SELECT 1 FROM public.v2_field_assessments later WHERE later.subject_id=a.subject_id AND later.field_key=a.field_key
       AND later.scope_key=a.scope_key AND later.revision>a.revision)) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'v2_current_assessment_invalid' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_current_assessment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_current_assessments
 FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_current_guard();

CREATE FUNCTION public.v2_read_assessment_at(subject uuid,field text,scope_hash text,as_of timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT CASE WHEN NOT a.invalidated AND NOT a.erased AND a.input_generation=s.input_generation AND s.lifecycle='active'
   AND a.policy_version=(SELECT version FROM public.v2_evidence_policy_state WHERE id)
   AND a.assessed_at<=as_of AND (a.valid_until IS NULL OR as_of<a.valid_until)
   THEN jsonb_build_object('status','assessed','assessmentId',a.id,'result',a.result)
   ELSE jsonb_build_object('status','recheck_required') END
 FROM public.v2_current_assessments c JOIN public.v2_field_assessments a ON a.id=c.assessment_id JOIN public.v2_subjects s ON s.id=a.subject_id
 WHERE c.subject_id=subject AND c.field_key=field AND c.scope_key=scope_hash),jsonb_build_object('status','recheck_required'));
$$;
CREATE FUNCTION public.v2_read_assessment(subject uuid,field text,scope_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.v2_read_assessment_at(subject,field,scope_hash,statement_timestamp());
$$;

CREATE FUNCTION public.v2_assessment_subject_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.input_generation<>OLD.input_generation OR NEW.lifecycle<>OLD.lifecycle THEN
   PERFORM public.v2_invalidate_assessments(ARRAY(SELECT id FROM public.v2_field_assessments WHERE subject_id=NEW.id),false);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_assessment_subject_change AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_subject_change();
CREATE FUNCTION public.v2_assessment_observation_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject uuid; ids uuid[];
BEGIN
 IF TG_OP='DELETE' THEN
   SELECT array_agg(assessment_id) INTO ids FROM public.v2_assessment_inputs WHERE observation_id=OLD.id;
   PERFORM public.v2_invalidate_assessments(ids,true); RETURN OLD;
 END IF;
 subject:=NEW.original_subject_id;
 -- Older storage fixtures have no assessment yet. Once assessment exists, a
 -- new report changes its complete input set, even before it gains a citation.
 IF EXISTS(SELECT 1 FROM public.v2_field_assessments WHERE subject_id=subject) THEN
   UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=subject;
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     SELECT 'assess',id,input_generation,(SELECT version FROM public.v2_evidence_policy_state WHERE id),NEW.id FROM public.v2_subjects WHERE id=subject;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_assessment_observation_insert AFTER INSERT ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_observation_change();
CREATE TRIGGER v2_assessment_observation_erase BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_observation_change();
CREATE FUNCTION public.v2_assessment_source_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE members uuid[]; ids uuid[];
BEGIN
 members:=public.v2_source_component(ARRAY[OLD.id]);
 SELECT array_agg(DISTINCT i.assessment_id) INTO ids FROM public.v2_assessment_inputs i JOIN public.v2_observation_sources os ON os.observation_id=i.observation_id
   WHERE os.source_id=ANY(members);
 PERFORM public.v2_invalidate_assessments(ids,true); RETURN OLD;
END; $$;
CREATE TRIGGER v2_assessment_source_erase BEFORE DELETE ON public.v2_sources FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_source_erase();

CREATE FUNCTION public.v2_assessment_policy_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject record;
BEGIN
 IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.revision<>OLD.revision+1 OR NEW.version=OLD.version THEN
   RAISE EXCEPTION 'v2_policy_revision_required' USING ERRCODE='23514'; END IF;
 FOR subject IN SELECT DISTINCT subject_id id FROM public.v2_current_assessments LOOP
   UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=subject.id;
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     SELECT 'assess',id,input_generation,NEW.version,gen_random_uuid() FROM public.v2_subjects WHERE id=subject.id;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_assessment_policy_change BEFORE UPDATE OR DELETE ON public.v2_evidence_policy_state FOR EACH ROW EXECUTE FUNCTION public.v2_assessment_policy_change();

DO $$ DECLARE t text; role_name text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_evidence_policies','v2_evidence_policy_state','v2_field_assessments','v2_assessment_inputs','v2_current_assessments'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
   END LOOP;
   EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
   EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
   EXECUTE format('CREATE TRIGGER v2_assessment_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND (p.proname LIKE 'v2_assessment_%' OR p.proname IN('v2_evaluate_assessment','v2_assess_field','v2_invalidate_assessments','v2_read_assessment_at','v2_read_assessment')) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
   END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_read_assessment(uuid,text,text) TO mabhazi_api;
