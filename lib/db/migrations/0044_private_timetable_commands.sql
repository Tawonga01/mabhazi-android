-- Private atomic timetable commands. No backend/public grants; not a public reader.
CREATE OR REPLACE FUNCTION public.v2_timetable_observation(actor varchar,subject uuid,command uuid,source uuid,
 field text,value jsonb,scope jsonb,proposal jsonb,contribution uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE observation uuid;payload jsonb;basis text;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=source AND owner_user_id=actor)
  OR NOT public.v2_intake_observation_valid(field,value,scope)
  THEN RAISE EXCEPTION 'v2_timetable_observation_invalid' USING ERRCODE='23514';END IF;
 basis:=CASE proposal->'source'->>'kind' WHEN 'published_timetable' THEN 'observed_sign' WHEN 'operator_confirmation' THEN 'operator_statement' END;
 IF basis IS NULL THEN RAISE EXCEPTION 'v2_timetable_source_basis_required' USING ERRCODE='23514';END IF;
 IF contribution IS NULL THEN
  payload:=jsonb_build_object('schemaVersion','1.0','entrySurface','reviewer_context','timetableCommandId',command,
   'fieldKey',field,'value',value,'scope',scope,'sourceId',source);
  INSERT INTO public.v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
   VALUES(actor,gen_random_uuid(),'1.0','reviewer_context',public.v2_assessment_hash(payload),payload,subject) RETURNING id INTO contribution;
 ELSIF NOT EXISTS(SELECT 1 FROM public.v2_contributions c WHERE c.id=contribution AND c.user_id=actor AND c.original_subject_id=subject AND c.entry_surface='reviewer_context') THEN
  RAISE EXCEPTION 'v2_timetable_contribution_context_required' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from,effective_from,effective_to)
  VALUES(contribution,subject,field,value,scope,public.v2_assessment_hash(scope),public.v2_assessment_hash(value),basis,
   (proposal->'source'->>'checkedOn')::date,CASE WHEN field LIKE 'fare.%' THEN NULL ELSE (proposal->>'validFrom')::date END,CASE WHEN field LIKE 'fare.%' THEN NULL ELSE (proposal->>'validUntil')::date END) RETURNING id INTO observation;
 INSERT INTO public.v2_observation_sources(observation_id,source_id,relation) VALUES(observation,source,'cites');
 RETURN observation;
END;$$;

-- Draft command/proof storage for the narrow atomic facade. No public/backend
-- table access. Source facts live in typed observations/domain transport tables;
-- these rows bind immutable commands and exact independent review references.
CREATE TABLE public.v2_admin_timetables(
 id uuid PRIMARY KEY,actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 request_digest text,proposal jsonb,erased boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(erased=(proposal IS NULL)),CHECK(request_digest IS NULL OR request_digest~'^[a-f0-9]{64}$'),
 CHECK((erased AND request_digest IS NULL) OR (NOT erased AND actor_user_id IS NOT NULL AND request_digest IS NOT NULL AND jsonb_typeof(proposal)='object'))
);
CREATE TABLE public.v2_admin_timetable_entries(
 run_subject_id uuid PRIMARY KEY REFERENCES public.v2_runs(subject_id),
 timetable_id uuid NOT NULL REFERENCES public.v2_admin_timetables(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 29),
 source_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),UNIQUE(timetable_id,ordinal)
);
CREATE TABLE public.v2_admin_timetable_properties(
 run_subject_id uuid NOT NULL REFERENCES public.v2_admin_timetable_entries(run_subject_id),
 field_key text NOT NULL CHECK(field_key IN('route.origin','route.destination','operator.reported','pattern.stops','service.mode','service.calendar',
  'departure.scheduled','arrival.scheduled','boarding.pickup','alighting.dropoff','fare.quoted','fare.advertised')),
 subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
 writer_kind text NOT NULL CHECK(writer_kind IN('header','creation','edit','field')),
 writer_id uuid NOT NULL,review_id uuid NOT NULL REFERENCES public.v2_review_decisions(id),
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 PRIMARY KEY(run_subject_id,field_key)
);
CREATE INDEX v2_admin_timetable_property_observation_idx ON public.v2_admin_timetable_properties(observation_id);
CREATE INDEX v2_admin_timetable_property_contribution_idx ON public.v2_admin_timetable_properties(contribution_id);
CREATE INDEX v2_admin_timetable_property_review_idx ON public.v2_admin_timetable_properties(review_id);

CREATE FUNCTION public.v2_timetable_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
  IF TG_TABLE_NAME='v2_admin_timetables' THEN
   IF NOT OLD.erased AND NEW.erased AND NEW.proposal IS NULL AND NEW.request_digest IS NULL
    AND to_jsonb(NEW)-ARRAY['request_digest','proposal','erased']=to_jsonb(OLD)-ARRAY['request_digest','proposal','erased'] THEN RETURN NEW;END IF;
   IF OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
    AND to_jsonb(NEW)-ARRAY['actor_user_id','request_digest','proposal','erased']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest','proposal','erased'] THEN
    NEW.proposal:=NULL;NEW.request_digest:=NULL;NEW.erased:=true;RETURN NEW;END IF;
  ELSIF TG_TABLE_NAME='v2_admin_timetable_properties' THEN
   IF (NEW.observation_id IS NOT DISTINCT FROM OLD.observation_id OR NEW.observation_id IS NULL)
    AND (NEW.contribution_id IS NOT DISTINCT FROM OLD.contribution_id OR NEW.contribution_id IS NULL)
    AND to_jsonb(NEW)-ARRAY['observation_id','contribution_id']=to_jsonb(OLD)-ARRAY['observation_id','contribution_id'] THEN RETURN NEW;END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'v2_timetable_history_immutable' USING ERRCODE='23514';
END;$$;
-- The command must not retain an extra raw copy after its evidence is erased.
-- Historical entry/property IDs survive, while replay can never restore it.
CREATE FUNCTION public.v2_timetable_forget_payload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- During account cascade the users row is already absent. Its own command
 -- FK SET NULL trigger will redact the payload; do not recheck that FK early.
 IF public.v2_json_uuid(OLD.payload->'timetableCommandId') AND EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
  UPDATE public.v2_admin_timetables SET proposal=NULL,request_digest=NULL,erased=true
   WHERE id=(OLD.payload->>'timetableCommandId')::uuid AND actor_user_id=OLD.user_id AND NOT erased;
 END IF;
 RETURN OLD;
END;$$;
CREATE TRIGGER timetable_forget_payload BEFORE DELETE ON public.v2_contributions FOR EACH ROW EXECUTE FUNCTION public.v2_timetable_forget_payload();
DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_admin_timetables','v2_admin_timetable_entries','v2_admin_timetable_properties'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('CREATE TRIGGER timetable_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_timetable_history_guard()',t);
  EXECUTE format('CREATE TRIGGER timetable_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);END IF;
  END LOOP;
 END LOOP;
 REVOKE ALL ON FUNCTION public.v2_timetable_history_guard() FROM PUBLIC,mabhazi_api;
 REVOKE ALL ON FUNCTION public.v2_timetable_forget_payload() FROM PUBLIC,mabhazi_api;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.v2_timetable_history_guard() FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.v2_timetable_forget_payload() FROM %I',r);
  END IF;
 END LOOP;
END;$$;

CREATE FUNCTION public.v2_timetable_proposal_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE departure_row jsonb;fare jsonb;source jsonb;cal jsonb;seen text[]:=ARRAY[]::text[];departure integer;arrival integer;
BEGIN
 IF NOT COALESCE(jsonb_typeof(p)='object' AND p ?& ARRAY['version','operator','operatorRef','separateOperator','originCityId','destinationCityId','pickup','dropoff','timezone',
  'weekdays','validFrom','validUntil','source','departures'] AND p-ARRAY['version','operator','originCityId','destinationCityId','pickup','dropoff','timezone',
  'operatorRef','separateOperator','weekdays','validFrom','validUntil','source','departures']='{}'::jsonb AND p->'version'='1'::jsonb,false) THEN RETURN false;END IF;
 IF jsonb_typeof(p->'separateOperator') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
 IF p->'operatorRef'<>'null'::jsonb THEN
  IF NOT COALESCE(jsonb_typeof(p->'operatorRef')='object' AND p->'operatorRef' ?& ARRAY['id','revision']
   AND (p->'operatorRef')-ARRAY['id','revision']='{}'::jsonb AND public.v2_json_uuid(p->'operatorRef'->'id')
   AND jsonb_typeof(p->'operatorRef'->'revision')='string' AND p->'operatorRef'->>'revision'~'^[1-9][0-9]{0,15}$'
   AND (p->'operatorRef'->>'revision')::numeric<=9007199254740991 AND p->'separateOperator'='false'::jsonb,false) THEN RETURN false;END IF;
 END IF;
 IF jsonb_typeof(p->'operator') IS DISTINCT FROM 'string' OR NOT public.v2_valid_operator_name(p->>'operator') OR NOT public.v2_json_text(p->'pickup',200)
  OR (p->'dropoff'<>'null'::jsonb AND NOT public.v2_json_text(p->'dropoff',200))
  OR jsonb_typeof(p->'originCityId')<>'number' OR p->>'originCityId'!~'^[1-9][0-9]{0,8}$'
  OR jsonb_typeof(p->'destinationCityId')<>'number' OR p->>'destinationCityId'!~'^[1-9][0-9]{0,8}$'
  OR p->'originCityId'=p->'destinationCityId' OR NOT public.v2_json_date(p->'validFrom') OR NOT public.v2_json_date(p->'validUntil')
  OR p->>'validFrom'>p->>'validUntil' OR NOT EXISTS(SELECT 1 FROM public.v2_timezones WHERE name=p->>'timezone') THEN RETURN false;END IF;
 cal:=jsonb_build_object('weekdays',p->'weekdays','startDate',p->'validFrom','endDate',p->'validUntil','timezone',p->'timezone');
 IF jsonb_typeof(p->'weekdays') IS DISTINCT FROM 'array' OR NOT public.v2_calendar_observation_valid(cal) THEN RETURN false;END IF;
 source:=p->'source';
 IF NOT COALESCE(jsonb_typeof(source)='object' AND source ?& ARRAY['kind','reference','checkedOn']
  AND source-ARRAY['kind','reference','checkedOn']='{}'::jsonb AND source->>'kind' IN('published_timetable','operator_confirmation')
  AND public.v2_json_text(source->'reference',1000) AND public.v2_json_date(source->'checkedOn'),false)
  OR (source->>'checkedOn')::date>(statement_timestamp() AT TIME ZONE (p->>'timezone'))::date THEN RETURN false;END IF;
 IF jsonb_typeof(p->'departures')<>'array' OR jsonb_array_length(p->'departures') NOT BETWEEN 1 AND 30 THEN RETURN false;END IF;
 FOR departure_row IN SELECT value FROM jsonb_array_elements(p->'departures') LOOP
  IF NOT COALESCE(jsonb_typeof(departure_row)='object' AND departure_row ?& ARRAY['departure','arrival','arrivalDay','fare']
   AND departure_row-ARRAY['departure','arrival','arrivalDay','fare']='{}'::jsonb AND jsonb_typeof(departure_row->'departure')='string'
   AND departure_row->>'departure'~'^([01][0-9]|2[0-3]):[0-5][0-9]$' AND departure_row->'arrivalDay' IN('0'::jsonb,'1'::jsonb),false)
   OR departure_row->>'departure'=ANY(seen) THEN RETURN false;END IF;
  seen:=array_append(seen,departure_row->>'departure');departure:=substring(departure_row->>'departure',1,2)::integer*3600+substring(departure_row->>'departure',4,2)::integer*60;
  IF departure_row->'arrival'='null'::jsonb THEN IF departure_row->'arrivalDay'<>'0'::jsonb THEN RETURN false;END IF;
  ELSE
   IF jsonb_typeof(departure_row->'arrival')<>'string' OR departure_row->>'arrival'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN false;END IF;
   arrival:=substring(departure_row->>'arrival',1,2)::integer*3600+substring(departure_row->>'arrival',4,2)::integer*60+(departure_row->>'arrivalDay')::integer*86400;
   IF arrival<departure THEN RETURN false;END IF;
  END IF;
  fare:=departure_row->'fare';
  IF fare<>'null'::jsonb AND NOT COALESCE(jsonb_typeof(fare)='object' AND fare ?& ARRAY['amount','currency','kind']
   AND fare-ARRAY['amount','currency','kind']='{}'::jsonb AND fare->>'kind' IN('quoted','advertised') AND jsonb_typeof(fare->'amount')='string'
   AND fare->>'amount'~'^(0|[1-9][0-9]{0,8})([.][0-9]{1,2})?$' AND fare->>'currency' IN('USD','ZAR','ZMW','MWK','BWP','ZWG'),false) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_parameter_value OR numeric_value_out_of_range THEN RETURN false;
END;$$;

CREATE FUNCTION public.v2_api_admin_timetable_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('kind','timetable','id',t.id,'outcome','approved','actorErased',t.actor_user_id IS NULL,'sourceErased',t.erased,'createdAt',t.created_at,
  'departureCount',(SELECT count(*) FROM public.v2_admin_timetable_entries e WHERE e.timetable_id=t.id),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('runId',e.run_subject_id,'ordinal',e.ordinal,
   'properties',(SELECT jsonb_agg(jsonb_build_object('field',p.field_key,'reviewId',p.review_id,'sourceErased',p.contribution_id IS NULL OR (p.writer_kind<>'header' AND p.observation_id IS NULL)) ORDER BY p.field_key)
    FROM public.v2_admin_timetable_properties p WHERE p.run_subject_id=e.run_subject_id)) ORDER BY e.ordinal)
   FROM public.v2_admin_timetable_entries e WHERE e.timetable_id=t.id),'[]'::jsonb)) INTO result
  FROM public.v2_admin_timetables t WHERE t.id=request;
 RETURN COALESCE(result,'{"found":false}'::jsonb);
END;$$;
-- Keep the draft facade private until all writer/read/erasure tests and the
-- action-time grant are prepared. Its creation alone must not enable the UI.
DO $$ DECLARE r text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_timetable_proposal_valid(jsonb)','public.v2_api_admin_timetable_receipt(varchar,uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
 END LOOP;
END;$$;


-- Draft named preview/lookup. Narrow grants are intentionally absent until the
-- atomic action, public effects, privacy and recovery tests are complete.
CREATE FUNCTION public.v2_api_admin_timetable_operators(actor varchar,q text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF q IS NULL OR length(btrim(q)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'v2_timetable_operator_query_invalid' USING ERRCODE='23514';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.subject_id,'name',a.display_name,'revision',a.revision,'countryCode',a.country_code)
  ORDER BY a.display_name,a.subject_id),'[]'::jsonb) INTO result FROM (
   SELECT o.subject_id,o.display_name,s.revision::text revision,o.country_code FROM public.v2_operators o JOIN public.v2_subjects s ON s.id=o.subject_id
   WHERE strpos(lower(o.display_name),lower(btrim(q)))>0 AND public.v2_current_reviewed_creation(o.subject_id)
   ORDER BY o.display_name,o.subject_id LIMIT 30) a;
 RETURN result;
END;$$;

CREATE FUNCTION public.v2_api_admin_timetable_preview(actor varchar,p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cities jsonb;operators jsonb;duplicates jsonb;operator_state jsonb;state_digest text;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF NOT public.v2_timetable_proposal_valid(p) THEN RAISE EXCEPTION 'v2_timetable_proposal_invalid' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM public.cities WHERE id IN((p->>'originCityId')::integer,(p->>'destinationCityId')::integer))<>2
  THEN RAISE EXCEPTION 'v2_timetable_city_unavailable' USING ERRCODE='23514';END IF;
 SELECT jsonb_build_object('origin',(SELECT name FROM public.cities WHERE id=(p->>'originCityId')::integer),
  'destination',(SELECT name FROM public.cities WHERE id=(p->>'destinationCityId')::integer)) INTO cities;
 operators:=public.v2_api_admin_timetable_operators(actor,p->>'operator');
 IF p->'operatorRef'<>'null'::jsonb THEN
  SELECT jsonb_build_object('id',o.subject_id,'name',o.display_name,'revision',s.revision::text,'generation',s.input_generation::text) INTO operator_state
   FROM public.v2_operators o JOIN public.v2_subjects s ON s.id=o.subject_id WHERE o.subject_id=(p->'operatorRef'->>'id')::uuid
   AND s.revision=(p->'operatorRef'->>'revision')::bigint AND o.display_name=p->>'operator' AND public.v2_current_reviewed_creation(o.subject_id);
  IF operator_state IS NULL THEN RAISE EXCEPTION 'v2_timetable_operator_changed' USING ERRCODE='40001';END IF;
 END IF;
 WITH proposed_clocks AS (SELECT a->>'departure' clock FROM jsonb_array_elements(p->'departures') a),
 candidates AS (
  SELECT 'operator'::text kind,o.subject_id::text id,s.revision::text revision,NULL::text clock
   FROM public.v2_operators o JOIN public.v2_subjects s ON s.id=o.subject_id
   WHERE p->'operatorRef'='null'::jsonb AND p->'separateOperator'='false'::jsonb AND lower(o.display_name)=lower(p->>'operator')
    AND public.v2_current_reviewed_creation(o.subject_id)
  UNION ALL
  SELECT 'lead',r.subject_id::text,r.revision::text,r.reported_time->>'value' FROM public.v2_public_reviewed_lead_reports r
   WHERE r.origin_city_id=(p->>'originCityId')::integer AND r.destination_city_id=(p->>'destinationCityId')::integer
   AND lower(r.operator_report->>'value')=lower(p->>'operator') AND r.reported_time->>'value' IN(SELECT clock FROM proposed_clocks)
  UNION ALL
  SELECT 'timetable',e.run_subject_id::text,s.revision::text,
   lpad((r.departure_seconds/3600)::text,2,'0')||':'||lpad(((r.departure_seconds%3600)/60)::text,2,'0')
   FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id AND NOT t.erased
   JOIN public.v2_runs r ON r.subject_id=e.run_subject_id JOIN public.v2_subjects s ON s.id=r.subject_id
   JOIN public.v2_service_plans sp ON sp.subject_id=r.service_plan_subject_id JOIN public.v2_calendars cal ON cal.id=sp.calendar_id
   JOIN public.v2_patterns pat ON pat.subject_id=sp.pattern_subject_id JOIN public.v2_corridors co ON co.id=pat.corridor_id
   JOIN public.v2_routes rt ON rt.subject_id=pat.route_subject_id JOIN public.v2_operators op ON op.subject_id=rt.operator_subject_id
   WHERE co.origin_city_id=(p->>'originCityId')::integer AND co.destination_city_id=(p->>'destinationCityId')::integer
    AND lower(op.display_name)=lower(p->>'operator') AND cal.start_date<=(p->>'validUntil')::date AND cal.end_date>=(p->>'validFrom')::date
    AND (cal.weekdays & (SELECT sum(1 << ((d#>>'{}')::integer-1))::integer FROM jsonb_array_elements(p->'weekdays') d))<>0
    AND lpad((r.departure_seconds/3600)::text,2,'0')||':'||lpad(((r.departure_seconds%3600)/60)::text,2,'0') IN(SELECT clock FROM proposed_clocks)
  UNION ALL
  SELECT 'legacy',j.id::text,public.v2_assessment_hash(to_jsonb(j)),j.departure_time FROM public.journeys j
   WHERE j.moderation_status='visible' AND j.data_status<>'inactive' AND lower(btrim(j.from_city))=lower(cities->>'origin')
   AND lower(btrim(j.to_city))=lower(cities->>'destination') AND lower(btrim(j.bus_company))=lower(p->>'operator')
   AND j.departure_time IN(SELECT clock FROM proposed_clocks)
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'revision',revision,'departure',clock) ORDER BY kind,id),'[]'::jsonb)
 INTO duplicates FROM (SELECT * FROM candidates ORDER BY kind,id LIMIT 100) c;
 state_digest:=public.v2_assessment_hash(jsonb_build_object('cities',cities,'operator',operator_state,'operatorChoices',operators,'duplicates',duplicates,
  'policy',(SELECT jsonb_build_array(version,revision) FROM public.v2_evidence_policy_state WHERE id)));
 RETURN jsonb_build_object('cities',cities,'operatorOptions',operators,'duplicates',duplicates,'stateDigest',state_digest);
END;$$;
DO $$ DECLARE r text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_api_admin_timetable_operators(varchar,text)','public.v2_api_admin_timetable_preview(varchar,jsonb)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
 END LOOP;
END;$$;


-- Draft atomic approval writer. Its proof/reader/reversal tests are still to be
-- completed; no GRANT is included and this is not a registered migration.
CREATE FUNCTION public.v2_timetable_accept(actor varchar,subject uuid,field text,observation uuid,contribution uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c uuid;scope_key text;evidence uuid[];decision uuid;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF field IN('route.origin','route.destination') THEN
  c:=public.v2_open_review_case(actor,subject,'identity');
  SELECT array_agg(o.id ORDER BY o.id) INTO evidence FROM public.v2_observations o
   WHERE o.contribution_id=contribution AND o.original_subject_id=subject AND o.field_key IN('operator.reported','departure.reported');
 ELSE
  SELECT o.scope_key INTO scope_key FROM public.v2_observations o WHERE o.id=observation AND o.original_subject_id=subject AND o.field_key=field AND o.contribution_id=contribution;
  IF scope_key IS NULL THEN RAISE EXCEPTION 'v2_timetable_property_context_required' USING ERRCODE='23514';END IF;
  c:=public.v2_open_review_case(actor,subject,'correction',field,scope_key);evidence:=ARRAY[observation];
 END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision DEFERRED;
 decision:=public.v2_record_review(actor,c,1,(SELECT revision FROM public.v2_subjects WHERE id=subject),
  'accept','timetable_source_checked',NULL,evidence,'timetable-import/1');
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision IMMEDIATE;
 RETURN decision;
END;$$;

CREATE FUNCTION public.v2_timetable_bind(actor varchar,run uuid,field text,subject uuid,observation uuid,contribution uuid,kind text,writer uuid,review uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF NOT EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id
  WHERE e.run_subject_id=run AND t.actor_user_id=actor AND NOT t.erased)
  OR NOT EXISTS(SELECT 1 FROM public.v2_review_decisions d JOIN public.v2_review_cases c ON c.id=d.case_id
   WHERE d.id=review AND d.action='accept' AND NOT d.evidence_erased AND c.last_decision_id=d.id AND c.state='resolved' AND c.subject_id=subject)
  THEN RAISE EXCEPTION 'v2_timetable_review_binding_invalid' USING ERRCODE='23514';END IF;
 IF kind<>'header' AND NOT EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_review_decision_evidence e ON e.observation_id=o.id
  WHERE o.id=observation AND o.contribution_id=contribution AND o.original_subject_id=subject AND o.field_key=field AND e.decision_id=review)
  THEN RAISE EXCEPTION 'v2_timetable_review_binding_invalid' USING ERRCODE='23514';END IF;
 INSERT INTO public.v2_admin_timetable_properties(run_subject_id,field_key,subject_id,writer_kind,writer_id,review_id,observation_id,contribution_id)
  VALUES(run,field,subject,kind,writer,review,observation,contribution);
END;$$;

CREATE FUNCTION public.v2_api_admin_timetable_action(actor varchar,request uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_admin_timetables;p jsonb;digest text;preview jsonb;source uuid;basis text;op_source jsonb;pattern_source jsonb;row_source jsonb;
 operator uuid;route uuid;pickup uuid;dropoff uuid;pattern uuid;plan uuid;run uuid;calendar uuid;calendar_review uuid;
 operator_observation uuid;identity uuid;pickup_observation uuid;dropoff_observation uuid;pattern_observation uuid;mode_observation uuid;
 clock_observation uuid;arrival_observation uuid;fare_observation uuid;property_review uuid;header_origin uuid;header_destination uuid;
 departure_row jsonb;row_proposal jsonb;stops jsonb;scope jsonb;fare_scope jsonb;value jsonb;idx integer:=0;seconds integer;
 creation public.v2_transport_creation_origins;creation_record public.v2_transport_creations;field text;contribution uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM public.v2_admin_require(actor);
 IF request IS NULL OR NOT COALESCE(jsonb_typeof(input)='object' AND input ?& ARRAY['proposal','stateDigest','expiresAt']
  AND input-ARRAY['proposal','stateDigest','expiresAt']='{}'::jsonb AND jsonb_typeof(input->'stateDigest')='string'
  AND input->>'stateDigest'~'^[a-f0-9]{64}$' AND jsonb_typeof(input->'expiresAt')='number'
  AND input->>'expiresAt'~'^[1-9][0-9]{0,15}$',false) THEN RAISE EXCEPTION 'v2_timetable_action_invalid' USING ERRCODE='23514';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,input-'expiresAt'));
 SELECT * INTO prior FROM public.v2_admin_timetables WHERE id=request;
 IF FOUND THEN
  IF prior.erased OR prior.actor_user_id IS DISTINCT FROM actor OR prior.request_digest IS DISTINCT FROM digest
   THEN RAISE EXCEPTION 'v2_admin_request_conflict' USING ERRCODE='23514';END IF;
  RETURN public.v2_api_admin_timetable_receipt(actor,request);
 END IF;
 IF (input->>'expiresAt')::numeric/1000<=extract(epoch FROM clock_timestamp()) THEN RAISE EXCEPTION 'v2_admin_preview_expired' USING ERRCODE='23514';END IF;
 p:=input->'proposal';preview:=public.v2_api_admin_timetable_preview(actor,p);
 IF preview->>'stateDigest' IS DISTINCT FROM input->>'stateDigest' OR jsonb_array_length(preview->'duplicates')<>0
  THEN RAISE EXCEPTION 'v2_timetable_preview_changed' USING ERRCODE='40001';END IF;
 INSERT INTO public.v2_admin_timetables(id,actor_user_id,request_digest,proposal) VALUES(request,actor,digest,p);
 basis:=CASE p->'source'->>'kind' WHEN 'published_timetable' THEN 'document' ELSE 'operator_statement' END;
 -- Date checked belongs on observations. Publication date was not supplied.
 INSERT INTO public.v2_sources(owner_user_id,kind,private_reference) VALUES(actor,basis,p->'source'->>'reference') RETURNING id INTO source;
 IF p->'operatorRef'<>'null'::jsonb THEN operator:=(p->'operatorRef'->>'id')::uuid;
 ELSE
  op_source:=public.v2_timetable_source(actor,request,p,jsonb_build_object('name',p->>'operator'),source);
  SELECT id INTO operator_observation FROM public.v2_observations WHERE contribution_id=(op_source->>'contributionId')::uuid AND field_key='operator.reported';
  operator:=public.v2_timetable_create(actor,(op_source->>'subjectId')::uuid,operator_observation,'operator');
 END IF;
 pattern_source:=public.v2_timetable_source(actor,request,p,jsonb_build_object('id',operator),source);
 SELECT id INTO identity FROM public.v2_observations WHERE contribution_id=(pattern_source->>'contributionId')::uuid AND field_key='operator.reported';
 route:=public.v2_timetable_create(actor,(pattern_source->>'subjectId')::uuid,identity,'route');
 pickup_observation:=public.v2_timetable_observation(actor,(pattern_source->>'subjectId')::uuid,request,source,'boarding.pickup',
  jsonb_build_object('cityId',p->'originCityId','name',p->>'pickup'),'{}',p,(pattern_source->>'contributionId')::uuid);
 pickup:=public.v2_timetable_create(actor,(pattern_source->>'subjectId')::uuid,pickup_observation,'stop');
 stops:=jsonb_build_array(jsonb_build_object('place',jsonb_build_object('stopId',pickup),'pickup','allowed','dropoff','unknown'));
 IF p->'dropoff'<>'null'::jsonb THEN
  dropoff_observation:=public.v2_timetable_observation(actor,(pattern_source->>'subjectId')::uuid,request,source,'alighting.dropoff',
   jsonb_build_object('cityId',p->'destinationCityId','name',p->>'dropoff'),'{}',p,(pattern_source->>'contributionId')::uuid);
  dropoff:=public.v2_timetable_create(actor,(pattern_source->>'subjectId')::uuid,dropoff_observation,'stop');
  stops:=jsonb_set(stops,'{0,dropoff}','"forbidden"')||jsonb_build_array(jsonb_build_object('place',jsonb_build_object('stopId',dropoff),'pickup','forbidden','dropoff','allowed'));
 END IF;
 pattern_observation:=public.v2_timetable_observation(actor,(pattern_source->>'subjectId')::uuid,request,source,'pattern.stops',
  jsonb_build_object('stops',stops,'stopsComplete',false),'{}',p,(pattern_source->>'contributionId')::uuid);
 pattern:=public.v2_timetable_create(actor,(pattern_source->>'subjectId')::uuid,pattern_observation,'pattern',route);
 mode_observation:=public.v2_timetable_observation(actor,(pattern_source->>'subjectId')::uuid,request,source,'service.mode',
  '{"mode":"fixed_time"}','{}',p,(pattern_source->>'contributionId')::uuid);
 plan:=public.v2_timetable_create(actor,(pattern_source->>'subjectId')::uuid,mode_observation,'service_plan',pattern);
 calendar:=public.v2_timetable_observation(actor,plan,request,source,'service.calendar',jsonb_build_object(
  'weekdays',p->'weekdays','startDate',p->'validFrom','endDate',p->'validUntil','timezone',p->'timezone'),'{}',p);
 calendar_review:=public.v2_timetable_edit(actor,plan,calendar);
 scope:=jsonb_build_object('schemaVersion','1.0','timezone',p->'timezone','calendarId',calendar,'effectiveFrom',p->'validFrom','effectiveTo',p->'validUntil');
 -- Fare applicability/conditions were not supplied. Preserve unknowns rather
 -- than extending the timetable validity to its price or inventing an adult fare.
 fare_scope:=jsonb_build_object('schemaVersion','1.0','segment',jsonb_build_object('kind','city_pair','originCityId',p->'originCityId','destinationCityId',p->'destinationCityId'),
  'passengerCategory','unknown','ticketBasis','unknown','timeBasis','scheduled');
 FOR departure_row IN SELECT item FROM jsonb_array_elements(p->'departures') item LOOP
  row_proposal:=jsonb_set(p,'{departures}',jsonb_build_array(departure_row));
  row_source:=public.v2_timetable_source(actor,request,row_proposal,jsonb_build_object('id',operator),source);
  contribution:=(row_source->>'contributionId')::uuid;
  header_origin:=public.v2_timetable_accept(actor,(row_source->>'subjectId')::uuid,'route.origin',NULL,contribution);
  header_destination:=public.v2_timetable_accept(actor,(row_source->>'subjectId')::uuid,'route.destination',NULL,contribution);
  SELECT id INTO operator_observation FROM public.v2_observations WHERE contribution_id=contribution AND field_key='operator.reported';
  property_review:=public.v2_timetable_accept(actor,(row_source->>'subjectId')::uuid,'operator.reported',operator_observation,contribution);
  seconds:=substring(departure_row->>'departure',1,2)::integer*3600+substring(departure_row->>'departure',4,2)::integer*60;
  clock_observation:=public.v2_timetable_observation(actor,(row_source->>'subjectId')::uuid,request,source,'departure.scheduled',jsonb_build_object('seconds',seconds),scope,p,contribution);
  run:=public.v2_timetable_create(actor,(row_source->>'subjectId')::uuid,clock_observation,'run',plan);
  INSERT INTO public.v2_admin_timetable_entries VALUES(run,request,idx,(row_source->>'subjectId')::uuid);
  PERFORM public.v2_timetable_bind(actor,run,'route.origin',(row_source->>'subjectId')::uuid,NULL,contribution,'header',
   (SELECT case_id FROM public.v2_review_decisions WHERE id=header_origin),header_origin);
  PERFORM public.v2_timetable_bind(actor,run,'route.destination',(row_source->>'subjectId')::uuid,NULL,contribution,'header',
   (SELECT case_id FROM public.v2_review_decisions WHERE id=header_destination),header_destination);
  PERFORM public.v2_timetable_bind(actor,run,'operator.reported',(row_source->>'subjectId')::uuid,operator_observation,contribution,'field',
   (SELECT case_id FROM public.v2_review_decisions WHERE id=property_review),property_review);
  SELECT * INTO creation FROM public.v2_transport_creation_origins WHERE subject_id=run;
  PERFORM public.v2_timetable_bind(actor,run,'departure.scheduled',(row_source->>'subjectId')::uuid,clock_observation,contribution,'creation',creation.creation_id,creation.review_id);
  SELECT * INTO creation FROM public.v2_transport_creation_origins WHERE subject_id=pattern;
  PERFORM public.v2_timetable_bind(actor,run,'pattern.stops',(pattern_source->>'subjectId')::uuid,pattern_observation,(pattern_source->>'contributionId')::uuid,'creation',creation.creation_id,creation.review_id);
  SELECT * INTO creation FROM public.v2_transport_creation_origins WHERE subject_id=plan;
  PERFORM public.v2_timetable_bind(actor,run,'service.mode',(pattern_source->>'subjectId')::uuid,mode_observation,(pattern_source->>'contributionId')::uuid,'creation',creation.creation_id,creation.review_id);
  PERFORM public.v2_timetable_bind(actor,run,'service.calendar',plan,calendar,(SELECT contribution_id FROM public.v2_observations WHERE id=calendar),
   'edit',(SELECT id FROM public.v2_transport_edits WHERE subject_id=plan AND observation_id=calendar),calendar_review);
  FOREACH field IN ARRAY ARRAY['boarding.pickup','alighting.dropoff'] LOOP
   IF field='alighting.dropoff' AND dropoff IS NULL THEN CONTINUE;END IF;
   value:=jsonb_build_object('stopId',CASE field WHEN 'boarding.pickup' THEN pickup ELSE dropoff END);
   identity:=public.v2_timetable_observation(actor,(row_source->>'subjectId')::uuid,request,source,field,value,'{}',p,contribution);
   property_review:=public.v2_timetable_accept(actor,(row_source->>'subjectId')::uuid,field,identity,contribution);
   PERFORM public.v2_timetable_bind(actor,run,field,(row_source->>'subjectId')::uuid,identity,contribution,'field',
    (SELECT case_id FROM public.v2_review_decisions WHERE id=property_review),property_review);
  END LOOP;
  IF departure_row->'arrival'<>'null'::jsonb THEN
   seconds:=substring(departure_row->>'arrival',1,2)::integer*3600+substring(departure_row->>'arrival',4,2)::integer*60+(departure_row->>'arrivalDay')::integer*86400;
   arrival_observation:=public.v2_timetable_observation(actor,run,request,source,'arrival.scheduled',jsonb_build_object('seconds',seconds),scope,p);
   property_review:=public.v2_timetable_edit(actor,run,arrival_observation);
   PERFORM public.v2_timetable_bind(actor,run,'arrival.scheduled',run,arrival_observation,(SELECT contribution_id FROM public.v2_observations WHERE id=arrival_observation),
    'edit',(SELECT id FROM public.v2_transport_edits WHERE subject_id=run AND observation_id=arrival_observation),property_review);
  END IF;
  IF departure_row->'fare'<>'null'::jsonb THEN
   field:='fare.'||(departure_row->'fare'->>'kind');value:=(departure_row->'fare')-'kind';
   fare_observation:=public.v2_timetable_observation(actor,(row_source->>'subjectId')::uuid,request,source,field,value,fare_scope,p,contribution);
   property_review:=public.v2_timetable_accept(actor,(row_source->>'subjectId')::uuid,field,fare_observation,contribution);
   PERFORM public.v2_timetable_bind(actor,run,field,(row_source->>'subjectId')::uuid,fare_observation,contribution,'field',
    (SELECT case_id FROM public.v2_review_decisions WHERE id=property_review),property_review);
  END IF;
  idx:=idx+1;
 END LOOP;
 RETURN public.v2_api_admin_timetable_receipt(actor,request);
END;$$;
DO $$ DECLARE r text;f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
  ('v2_timetable_accept','v2_timetable_bind','v2_api_admin_timetable_action') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;
  END LOOP;
 END LOOP;
END;$$;


-- Reader prerequisite, not a public view or access grant. Preserve the strict
-- original reader; bridge only one exact reviewed calendar/arrival edit whose
-- own physical change invalidated the original head. Never rescue an unrelated
-- stale origin, overwritten parent, erased evidence or reversed edit.
CREATE OR REPLACE FUNCTION public.v2_current_reviewed_creation(subject uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE original jsonb;current_edit jsonb;o public.v2_transport_creation_origins;p public.v2_transport_creations;s public.v2_subjects;
 field text;native_table text;columns text[];
BEGIN
 SELECT * INTO s FROM public.v2_subjects WHERE id=subject;
 IF s.id IS NULL OR s.lifecycle<>'active' THEN RETURN false;END IF;
 original:=public.v2_read_created_subject(subject);
 IF original->>'status'='reviewed_origin' THEN RETURN true;END IF;
 IF s.kind='service_plan' THEN field:='service.calendar';native_table:='v2_service_plans';columns:=ARRAY['calendar_id','timezone'];
 ELSIF s.kind='run' THEN field:='arrival.scheduled';native_table:='v2_runs';columns:=ARRAY['arrival_seconds'];
 ELSE RETURN false;END IF;
 current_edit:=public.v2_read_transport(subject);
 IF current_edit->>'status' IS DISTINCT FROM 'reviewed' OR current_edit->>'fieldKey' IS DISTINCT FROM field THEN RETURN false;END IF;
 SELECT * INTO o FROM public.v2_transport_creation_origins WHERE subject_id=subject;
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=o.creation_id;
 IF o.creation_id IS NULL OR o.erased OR p.erased OR NOT public.v2_creation_evidence_live(p.id)
  OR NOT public.v2_creation_dependencies_live(p.id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_transport_edit_heads h
   JOIN public.v2_transport_edits e ON e.id=h.edit_id AND e.subject_id=subject AND e.field_key=field AND NOT e.erased
   JOIN public.v2_transport_edit_events applied ON applied.id=h.event_id AND applied.action='apply'
   JOIN public.v2_transport_edit_events approved ON approved.edit_id=e.id AND approved.action='review' AND approved.review_id=applied.review_id
   JOIN public.v2_transport_change_subjects changed ON changed.subject_id=subject AND changed.is_root
    AND changed.previous_revision=approved.resulting_revision AND changed.resulting_revision=applied.resulting_revision
    AND changed.previous_generation=approved.resulting_generation AND changed.resulting_generation=applied.resulting_generation
   JOIN public.v2_transport_changes cause ON cause.id=changed.change_id AND cause.source_table=native_table
    AND cause.operation='UPDATE' AND cause.changed_columns<@columns
   JOIN public.v2_transport_creation_events invalidation ON invalidation.creation_id=p.id AND invalidation.action='invalidate' AND invalidation.cause_id=cause.id
   WHERE h.subject_id=subject AND (CASE s.kind WHEN 'service_plan' THEN e.before_snapshot-'calendar' ELSE e.before_snapshot END)=o.snapshot)
  OR NOT EXISTS(SELECT 1 FROM public.v2_review_decisions d JOIN public.v2_review_cases c ON c.id=d.case_id
   WHERE d.id=o.review_id AND d.action='accept' AND NOT d.evidence_erased AND c.last_decision_id=d.id AND c.state='resolved') THEN RETURN false;END IF;
 IF (o.snapshot->'data')-columns IS DISTINCT FROM (current_edit->'snapshot'->'data')-columns THEN RETURN false;END IF;
 IF s.kind='run' THEN RETURN o.snapshot-'data'=current_edit->'snapshot'-'data';END IF;
 RETURN COALESCE(current_edit->'snapshot'->'calendar'->>'id'=current_edit->'snapshot'->'data'->>'calendar_id'
  AND current_edit->'snapshot'->'calendar'->>'timezone'=current_edit->'snapshot'->'data'->>'timezone',false);
END;$$;

CREATE FUNCTION public.v2_timetable_property_current(run uuid,field text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE property public.v2_admin_timetable_properties;target uuid;
BEGIN
 SELECT p.* INTO property FROM public.v2_admin_timetable_properties p
  JOIN public.v2_admin_timetable_entries e ON e.run_subject_id=p.run_subject_id
  JOIN public.v2_admin_timetables t ON t.id=e.timetable_id AND NOT t.erased
  JOIN public.v2_leads l ON l.subject_id=e.source_subject_id AND NOT l.attribution_erased
  JOIN public.v2_subjects s ON s.id=e.source_subject_id AND s.lifecycle='active'
  WHERE p.run_subject_id=run AND p.field_key=field;
 IF NOT FOUND OR property.contribution_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_contributions WHERE id=property.contribution_id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_review_decisions d JOIN public.v2_review_cases c ON c.id=d.case_id
   WHERE d.id=property.review_id AND NOT d.evidence_erased AND d.action='accept' AND c.state='resolved' AND c.last_decision_id=d.id) THEN RETURN false;END IF;
 IF property.writer_kind='header' THEN
  RETURN EXISTS(SELECT 1 FROM public.v2_leads l WHERE l.subject_id=property.subject_id AND l.initial_contribution_id=property.contribution_id AND NOT l.attribution_erased);
 END IF;
 IF property.observation_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_observations o
  JOIN public.v2_observation_states os ON os.observation_id=o.id AND os.status='active'
  JOIN public.v2_observation_targets ot ON ot.observation_id=o.id AND ot.assignment_id IS NULL
  JOIN public.v2_review_decision_evidence ev ON ev.observation_id=o.id AND ev.decision_id=property.review_id
  WHERE o.id=property.observation_id AND o.field_key=field AND o.original_subject_id=property.subject_id AND o.contribution_id=property.contribution_id) THEN RETURN false;END IF;
 IF property.writer_kind='field' THEN RETURN true;
 ELSIF property.writer_kind='creation' THEN
  SELECT p.target_subject_id INTO target FROM public.v2_transport_creations p
   JOIN public.v2_transport_creation_origins o ON o.creation_id=p.id AND o.review_id=property.review_id AND NOT o.erased
   WHERE p.id=property.writer_id AND NOT p.erased AND p.observation_id=property.observation_id;
  RETURN COALESCE(public.v2_current_reviewed_creation(target),false);
 ELSIF property.writer_kind='edit' THEN
  RETURN EXISTS(SELECT 1 FROM public.v2_transport_edit_heads h JOIN public.v2_transport_edits e ON e.id=h.edit_id
   JOIN public.v2_transport_edit_events a ON a.id=h.event_id AND a.action='apply' AND a.review_id=property.review_id
   WHERE h.subject_id=property.subject_id AND e.id=property.writer_id AND e.observation_id=property.observation_id
   AND NOT e.erased AND public.v2_read_transport(h.subject_id)->>'status'='reviewed'
   AND public.v2_current_reviewed_creation(h.subject_id));
 END IF;
 RETURN false;
END;$$;
DO $$ DECLARE r text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_current_reviewed_creation(uuid)','public.v2_timetable_property_current(uuid,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
 END LOOP;
END;$$;
