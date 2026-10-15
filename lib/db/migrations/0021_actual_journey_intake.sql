-- Atomic reported actual journeys; intention is not a matched run or timetable.
ALTER TABLE public.v2_actual_journeys ADD COLUMN initial_contribution_id uuid;
ALTER TABLE public.v2_actual_journeys ADD CONSTRAINT v2_actual_initial_contribution FOREIGN KEY(initial_contribution_id,subject_id) REFERENCES public.v2_contributions(id,original_subject_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_actual_initial_contribution_idx ON public.v2_actual_journeys(initial_contribution_id);
CREATE FUNCTION public.v2_actual_origin_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.initial_contribution_id IS NOT DISTINCT FROM OLD.initial_contribution_id THEN RETURN NEW;END IF;
 IF pg_trigger_depth()>1 AND NEW.initial_contribution_id IS NULL AND OLD.initial_contribution_id IS NOT NULL THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_actual_initial_origin_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_actual_origin_link_guard BEFORE UPDATE ON public.v2_actual_journeys FOR EACH ROW EXECUTE FUNCTION public.v2_actual_origin_link_guard();
CREATE FUNCTION public.v2_erase_actual_initial_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_actual_journeys SET initial_contribution_id=NULL WHERE initial_contribution_id=OLD.id;RETURN OLD;
END;$$;
CREATE TRIGGER v2_erase_actual_initial_link BEFORE DELETE ON public.v2_contributions FOR EACH ROW EXECUTE FUNCTION public.v2_erase_actual_initial_link();
CREATE FUNCTION public.v2_erase_actual_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_subject_revisions r SET origin_kind='erased',snapshot=NULL,decision_id=NULL,decision_kind=NULL,initial_contribution_id=NULL
 WHERE r.subject_id=OLD.original_subject_id AND r.origin_kind='contribution' AND r.initial_contribution_id=OLD.contribution_id
 AND EXISTS(SELECT 1 FROM public.v2_actual_journeys a WHERE a.subject_id=OLD.original_subject_id AND a.initial_contribution_id=OLD.contribution_id);
 RETURN OLD;
END;$$;
CREATE TRIGGER v2_erase_actual_origin BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_erase_actual_origin();
CREATE OR REPLACE FUNCTION public.v2_validate_subject_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.revision IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=NEW.subject_id)
   OR NEW.snapshot IS DISTINCT FROM public.v2_transport_snapshot(NEW.subject_id) THEN
   RAISE EXCEPTION 'v2_snapshot_must_describe_current_projection' USING ERRCODE='23514'; END IF;
 IF NEW.origin_kind='contribution' THEN
   IF NOT (EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=NEW.subject_id AND initial_contribution_id=NEW.initial_contribution_id) OR EXISTS(SELECT 1 FROM public.v2_actual_journeys WHERE subject_id=NEW.subject_id AND initial_contribution_id=NEW.initial_contribution_id))
      OR NEW.revision<>1 THEN RAISE EXCEPTION 'v2_initial_snapshot_origin_mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.origin_kind='decision' THEN
   IF NOT EXISTS(SELECT 1 FROM public.v2_field_decisions WHERE id=NEW.decision_id AND subject_id=NEW.subject_id AND NOT invalidated)
     AND NOT EXISTS(SELECT 1 FROM public.v2_association_decisions d JOIN public.v2_association_candidates c ON c.id=d.candidate_id
       WHERE d.id=NEW.decision_id AND NEW.subject_id IN (c.from_subject_id,c.to_subject_id) AND NOT d.invalidated) THEN
     RAISE EXCEPTION 'v2_snapshot_decision_subject_mismatch' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'v2_new_snapshot_requires_origin' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.v2_transport_input_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row jsonb; new_row jsonb; changed text[]; roots uuid[]:='{}'; ids uuid[]; cities integer[]; removed uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='v2_subjects' THEN
  IF NEW.lifecycle IS NOT DISTINCT FROM OLD.lifecycle THEN RETURN NEW; END IF;
  old_row:=jsonb_build_object('lifecycle',OLD.lifecycle);new_row:=jsonb_build_object('lifecycle',NEW.lifecycle);roots:=ARRAY[NEW.id];
 ELSIF TG_TABLE_NAME IN('v2_leads','v2_operators','v2_routes','v2_stops','v2_patterns','v2_service_plans','v2_runs','v2_actual_journeys') THEN
  IF TG_TABLE_NAME='v2_leads' THEN old_row:=old_row-ARRAY['initial_contribution_id','attribution_erased'];new_row:=new_row-ARRAY['initial_contribution_id','attribution_erased']; END IF;
  IF TG_TABLE_NAME='v2_actual_journeys' THEN old_row:=old_row-'initial_contribution_id';new_row:=new_row-'initial_contribution_id';END IF;
  roots:=ARRAY[(old_row->>'subject_id')::uuid,(new_row->>'subject_id')::uuid];
  IF TG_OP='DELETE' THEN removed:=roots[1]; END IF;
 ELSIF TG_TABLE_NAME='v2_corridors' THEN
  ids:=ARRAY[(old_row->>'id')::uuid,(new_row->>'id')::uuid];
  roots:=ARRAY(SELECT subject_id FROM public.v2_leads WHERE corridor_id=ANY(ids) UNION SELECT subject_id FROM public.v2_patterns WHERE corridor_id=ANY(ids));
 ELSIF TG_TABLE_NAME IN('v2_calendars','v2_calendar_exceptions') THEN
  ids:=CASE TG_TABLE_NAME WHEN 'v2_calendars' THEN ARRAY[(old_row->>'id')::uuid,(new_row->>'id')::uuid] ELSE ARRAY[(old_row->>'calendar_id')::uuid,(new_row->>'calendar_id')::uuid] END;
  roots:=ARRAY(SELECT subject_id FROM public.v2_service_plans WHERE calendar_id=ANY(ids)
   UNION SELECT o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id WHERE r.calendar_id=ANY(ids)
   UNION SELECT public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r WHERE r.calendar_id=ANY(ids));
 ELSIF TG_TABLE_NAME='cities' THEN
  cities:=ARRAY[(old_row->>'id')::integer,(new_row->>'id')::integer];
  roots:=ARRAY(SELECT subject_id FROM public.v2_stops WHERE city_id=ANY(cities)
   UNION SELECT l.subject_id FROM public.v2_leads l JOIN public.v2_corridors c ON c.id=l.corridor_id WHERE c.origin_city_id=ANY(cities) OR c.destination_city_id=ANY(cities)
   UNION SELECT p.subject_id FROM public.v2_patterns p JOIN public.v2_corridors c ON c.id=p.corridor_id WHERE c.origin_city_id=ANY(cities) OR c.destination_city_id=ANY(cities)
   UNION SELECT o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id WHERE r.city_id=ANY(cities)
   UNION SELECT public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r WHERE r.city_id=ANY(cities));
 ELSIF TG_TABLE_NAME='v2_run_stop_times' THEN roots:=ARRAY[(old_row->>'run_subject_id')::uuid,(new_row->>'run_subject_id')::uuid];
 ELSIF TG_TABLE_NAME IN('v2_frequency_windows','v2_availability_windows') THEN roots:=ARRAY[(old_row->>'service_plan_subject_id')::uuid,(new_row->>'service_plan_subject_id')::uuid];
 ELSIF TG_TABLE_NAME IN('v2_external_ids','v2_legacy_links') THEN roots:=ARRAY[(old_row->>'subject_id')::uuid,(new_row->>'subject_id')::uuid];
 ELSE RAISE EXCEPTION 'v2_transport_change_table_unsupported' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND old_row IS NOT DISTINCT FROM new_row THEN RETURN NEW; END IF;
 SELECT array_agg(k ORDER BY k) INTO changed FROM (SELECT jsonb_object_keys(COALESCE(old_row,'{}')) k UNION SELECT jsonb_object_keys(COALESCE(new_row,'{}')) k) keys
  WHERE old_row->k IS DISTINCT FROM new_row->k;
 IF COALESCE(cardinality(changed),0)>0 THEN PERFORM public.v2_transport_propagate(roots,TG_TABLE_NAME,TG_OP,changed,removed); END IF;
 RETURN COALESCE(NEW,OLD);
END; $$;
CREATE FUNCTION public.v2_submit_actual_journey(actor varchar,required_terms text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE core jsonb;context jsonb;item jsonb;input jsonb;intent jsonb;client_key uuid;digest text;prior public.v2_receipts;response jsonb;
 subject uuid:=gen_random_uuid();contribution uuid:=gen_random_uuid();observation uuid;citation jsonb;source_id uuid;generation bigint;knowledge text;observed date;field text;date_key text;n integer;
 intended_id uuid;intended_kind text;intended_revision bigint;
BEGIN
 IF actor IS NULL OR required_terms IS NULL OR length(required_terms) NOT BETWEEN 1 AND 64 THEN
  RAISE EXCEPTION 'v2_intake_actor_or_terms_invalid' USING ERRCODE='23514'; END IF;
 -- Same account lock as erasure, before shared transport guard and any row locks.
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND terms_accepted_version=required_terms AND terms_accepted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'v2_intake_terms_required' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE(jsonb_typeof(request)='object' AND request ?& ARRAY['schemaVersion','clientSubmissionId','entrySurface','target','observations']
   AND request-ARRAY['schemaVersion','clientSubmissionId','entrySurface','target','observations','actualContext']='{}'::jsonb
   AND jsonb_typeof(request->'schemaVersion')='string' AND request->>'schemaVersion'='1.0' AND public.v2_json_uuid(request->'clientSubmissionId')
   AND request->>'entrySurface' IN('contribute_tab','search_empty','search_result','route_detail','own_contribution','reviewer_context')
   AND jsonb_typeof(request->'target')='object' AND request->'target' ? 'newActualJourney'
   AND (request->'target')-'newActualJourney'='{}'::jsonb AND jsonb_typeof(request->'observations')='array',false)
   OR octet_length(request::text)>65536 THEN
  RAISE EXCEPTION 'v2_intake_request_invalid' USING ERRCODE='23514'; END IF;
 n:=jsonb_array_length(request->'observations');
 IF n NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'v2_intake_observation_limit' USING ERRCODE='23514'; END IF;

 core:=request->'target'->'newActualJourney';context:=COALESCE(request->'actualContext','{}'::jsonb);intent:=core->'intendedSubject';
 IF NOT COALESCE(jsonb_typeof(core)='object' AND core-ARRAY['reportedServiceDate','timezone','intendedSubject']='{}'::jsonb
  AND (core->>'reportedServiceDate' IS NULL OR public.v2_json_date(core->'reportedServiceDate'))
  AND (core->>'timezone' IS NULL OR public.v2_json_text(core->'timezone',100))
  AND (intent IS NULL OR intent='null'::jsonb OR (jsonb_typeof(intent)='object' AND intent ?& ARRAY['id','kind','expectedRevision'] AND intent-ARRAY['id','kind','expectedRevision']='{}'::jsonb
   AND public.v2_json_uuid(intent->'id') AND intent->>'kind' IN('lead','route','pattern','service_plan','run') AND jsonb_typeof(intent->'expectedRevision')='number' AND intent->>'expectedRevision' ~ '^[1-9][0-9]{0,15}$')),false) THEN RAISE EXCEPTION 'v2_actual_context_invalid' USING ERRCODE='23514';END IF;
 IF NOT COALESCE(jsonb_typeof(context)='object' AND context-ARRAY['knowledgeBasis','observedDate']='{}'::jsonb
  AND (NOT context ? 'knowledgeBasis' OR context->>'knowledgeBasis' IN('travelled','saw_operating','observed_sign','operator_statement','heard_from_other','unprovided'))
  AND (NOT context ? 'observedDate' OR public.v2_json_date(context->'observedDate')),false) THEN RAISE EXCEPTION 'v2_actual_knowledge_invalid' USING ERRCODE='23514';END IF;
 knowledge:=COALESCE(context->>'knowledgeBasis','unprovided');observed:=(context->>'observedDate')::date;
 IF observed>current_date+1 THEN RAISE EXCEPTION 'v2_future_observation_date' USING ERRCODE='23514';END IF;
 IF intent IS NOT NULL AND intent<>'null'::jsonb THEN intended_id:=(intent->>'id')::uuid;intended_kind:=intent->>'kind';intended_revision:=(intent->>'expectedRevision')::bigint;intent:=jsonb_build_object('id',intended_id,'kind',intended_kind,'expectedRevision',intended_revision);ELSE intent:=NULL;END IF;
 core:=jsonb_strip_nulls(jsonb_build_object('reportedServiceDate',core->'reportedServiceDate','timezone',core->'timezone','intendedSubject',intent));
 input:=jsonb_set(request,'{target,newActualJourney}',core)-'clientSubmissionId';input:=jsonb_set(input,'{actualContext}',jsonb_strip_nulls(jsonb_build_object('knowledgeBasis',knowledge,'observedDate',observed)));
 client_key:=(request->>'clientSubmissionId')::uuid;digest:=public.v2_assessment_hash(input);
 SELECT * INTO prior FROM public.v2_receipts WHERE user_id=actor AND client_submission_id=client_key;
 IF FOUND THEN
  IF prior.semantic_hash<>digest OR (SELECT payload FROM public.v2_contributions WHERE id=prior.contribution_id) IS DISTINCT FROM input THEN RAISE EXCEPTION 'v2_intake_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.initial_response||jsonb_build_object('replayed',true);
 END IF;
 IF core->>'timezone' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.v2_timezones WHERE name=core->>'timezone') THEN RAISE EXCEPTION 'v2_actual_timezone_unavailable' USING ERRCODE='23503';END IF;
 IF intended_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=intended_id AND kind=intended_kind AND lifecycle='active') THEN RAISE EXCEPTION 'v2_actual_intended_subject_unavailable' USING ERRCODE='23503';END IF;
  IF intended_revision IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=intended_id) THEN RAISE EXCEPTION 'v2_actual_intended_revision_conflict' USING ERRCODE='40001';END IF;
 END IF;
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_actual_initial_contribution DEFERRED;
 INSERT INTO public.v2_subjects(id,kind) VALUES(subject,'actual_journey');
 INSERT INTO public.v2_actual_journeys(subject_id,reported_service_date,timezone,intended_subject_id,intended_subject_kind,initial_contribution_id) VALUES(subject,(core->>'reportedServiceDate')::date,core->>'timezone',intended_id,intended_kind,contribution);
 INSERT INTO public.v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id) VALUES(contribution,actor,client_key,'1.0',request->>'entrySurface',digest,input,subject);
 INSERT INTO public.v2_subject_revisions(subject_id,subject_kind,revision,snapshot,origin_kind,initial_contribution_id) VALUES(subject,'actual_journey',1,public.v2_transport_snapshot(subject),'contribution',contribution);
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_actual_initial_contribution IMMEDIATE;
 FOR item IN SELECT value FROM jsonb_array_elements(request->'observations') LOOP
  IF NOT COALESCE(jsonb_typeof(item)='object' AND item ?& ARRAY['fieldKey','value','scope']
    AND item-ARRAY['fieldKey','value','scope','knowledgeBasis','observedDate','observedDateEnd','effectiveFrom','effectiveTo','sources']='{}'::jsonb
    AND jsonb_typeof(item->'fieldKey')='string'
    AND (NOT item ? 'knowledgeBasis' OR item->>'knowledgeBasis' IN('travelled','saw_operating','observed_sign','operator_statement','heard_from_other','unprovided'))
    AND (NOT item ? 'sources' OR jsonb_typeof(item->'sources')='array'),false) THEN
   RAISE EXCEPTION 'v2_intake_observation_envelope_invalid' USING ERRCODE='23514'; END IF;
  FOREACH date_key IN ARRAY ARRAY['observedDate','observedDateEnd','effectiveFrom','effectiveTo'] LOOP
   IF item ? date_key AND NOT public.v2_json_date(item->date_key) THEN RAISE EXCEPTION 'v2_intake_date_invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  field:=item->>'fieldKey';
  INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from,observed_to,effective_from,effective_to)
   VALUES(contribution,subject,field,item->'value',item->'scope',public.v2_assessment_hash(item->'scope'),public.v2_assessment_hash(item->'value'),COALESCE(item->>'knowledgeBasis',knowledge),
    COALESCE((item->>'observedDate')::date,observed),(item->>'observedDateEnd')::date,(item->>'effectiveFrom')::date,(item->>'effectiveTo')::date) RETURNING id INTO observation;
  IF item ? 'sources' THEN
   IF jsonb_array_length(item->'sources')>10 THEN RAISE EXCEPTION 'v2_intake_source_limit' USING ERRCODE='23514'; END IF;
   FOR citation IN SELECT value FROM jsonb_array_elements(item->'sources') LOOP
    IF NOT public.v2_json_uuid(citation) THEN RAISE EXCEPTION 'v2_intake_existing_source_id_required' USING ERRCODE='23514'; END IF;
    source_id:=(citation#>>'{}')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=source_id AND owner_user_id=actor) THEN
     RAISE EXCEPTION 'v2_intake_source_forbidden' USING ERRCODE='42501'; END IF;
    INSERT INTO public.v2_observation_sources(observation_id,source_id,relation) VALUES(observation,source_id,'cites');
   END LOOP;
  END IF;
 END LOOP;
 SELECT input_generation INTO generation FROM public.v2_subjects WHERE id=subject;
 INSERT INTO public.v2_jobs(kind,subject_id,contribution_id,requested_generation,policy_version,trigger_id)
  VALUES('normalise',subject,contribution,generation,'intake/1',contribution);
 response:=jsonb_build_object('contributionId',contribution,'clientSubmissionId',client_key,'subjectId',subject,'saveStatus','saved',
  'processingStatus','queued','associationStatus','unresolved','publicationStatus','pending','replayed',false);
 INSERT INTO public.v2_receipts(user_id,client_submission_id,contribution_id,semantic_hash,initial_response)
  VALUES(actor,client_key,contribution,digest,response);
 RETURN response;
END; $$;
DO $$ DECLARE r text;f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_submit_actual_journey','v2_actual_origin_link_guard','v2_erase_actual_initial_link','v2_erase_actual_origin','v2_validate_subject_revision','v2_transport_input_change') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;
