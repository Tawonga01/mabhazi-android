-- Controlled new-lead assembly. No resolved identities, public API or live grants.
-- Historical migrations remain immutable; origin snapshots are not review.
CREATE FUNCTION public.v2_submit_lead(actor varchar,required_terms text,request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE core jsonb; context jsonb; item jsonb; operator_value jsonb; input jsonb;
 client_key uuid; digest text; prior public.v2_receipts; response jsonb;
 subject uuid:=gen_random_uuid(); contribution uuid:=gen_random_uuid(); corridor uuid;
 observation uuid; citation jsonb; source_id uuid; generation bigint;
 origin integer; destination integer; clock text; basis text; knowledge text; observed date;
 operator_id uuid; n integer; date_key text; field text;
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
   AND request-ARRAY['schemaVersion','clientSubmissionId','entrySurface','target','observations','leadContext']='{}'::jsonb
   AND jsonb_typeof(request->'schemaVersion')='string' AND request->>'schemaVersion'='1.0' AND public.v2_json_uuid(request->'clientSubmissionId')
   AND request->>'entrySurface' IN('contribute_tab','search_empty','search_result','route_detail','own_contribution','reviewer_context')
   AND jsonb_typeof(request->'target')='object' AND request->'target' ? 'newLead'
   AND (request->'target')-'newLead'='{}'::jsonb AND jsonb_typeof(request->'observations')='array',false)
   OR octet_length(request::text)>65536 THEN
  RAISE EXCEPTION 'v2_intake_request_invalid' USING ERRCODE='23514'; END IF;
 n:=jsonb_array_length(request->'observations');
 IF n>20 THEN RAISE EXCEPTION 'v2_intake_observation_limit' USING ERRCODE='23514'; END IF;
 core:=request->'target'->'newLead'; context:=COALESCE(request->'leadContext','{}'::jsonb);
 operator_value:=core->'operator'; clock:=core->>'departureTime';
 IF NOT COALESCE(jsonb_typeof(core)='object' AND core ?& ARRAY['originCityId','destinationCityId','departureTime','operator']
   AND core-ARRAY['originCityId','destinationCityId','departureTime','operator']='{}'::jsonb
   AND jsonb_typeof(core->'originCityId')='number' AND core->>'originCityId' ~ '^[1-9][0-9]{0,8}$'
   AND jsonb_typeof(core->'destinationCityId')='number' AND core->>'destinationCityId' ~ '^[1-9][0-9]{0,8}$'
   AND jsonb_typeof(core->'departureTime')='string' AND length(clock)=5 AND clock ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   AND public.v2_intake_observation_valid('operator.reported',operator_value,'{}'),false) THEN
  RAISE EXCEPTION 'v2_intake_minimum_invalid' USING ERRCODE='23514'; END IF;
 origin:=(core->>'originCityId')::integer; destination:=(core->>'destinationCityId')::integer;
 IF origin=destination THEN RAISE EXCEPTION 'v2_intake_direction_invalid' USING ERRCODE='23514'; END IF;
 IF NOT COALESCE(jsonb_typeof(context)='object' AND context-ARRAY['knowledgeBasis','observedDate','timeBasis']='{}'::jsonb
   AND (NOT context ? 'knowledgeBasis' OR context->>'knowledgeBasis' IN('travelled','saw_operating','observed_sign','operator_statement','heard_from_other','unprovided'))
   AND (NOT context ? 'timeBasis' OR context->>'timeBasis' IN('unspecified','scheduled','actual'))
   AND (NOT context ? 'observedDate' OR public.v2_json_date(context->'observedDate')),false) THEN
  RAISE EXCEPTION 'v2_intake_context_invalid' USING ERRCODE='23514'; END IF;
 basis:=COALESCE(context->>'timeBasis','unspecified'); knowledge:=COALESCE(context->>'knowledgeBasis','unprovided');
 observed:=(context->>'observedDate')::date;
 IF observed>current_date+1 THEN RAISE EXCEPTION 'v2_future_observation_date' USING ERRCODE='23514'; END IF;
 -- Normalize defaults and UUID case before receipt identity. JSONB removes object
 -- key order/whitespace; observation array order remains meaningful.
 IF operator_value ? 'id' THEN
  operator_id:=(operator_value->>'id')::uuid; operator_value:=jsonb_build_object('id',operator_id);
 END IF;
 core:=jsonb_set(core,'{operator}',operator_value);
 input:=jsonb_set(request,'{target,newLead}',core)-'clientSubmissionId';
 input:=jsonb_set(input,'{leadContext}',jsonb_strip_nulls(jsonb_build_object('knowledgeBasis',knowledge,'timeBasis',basis,'observedDate',observed)));
 client_key:=(request->>'clientSubmissionId')::uuid; digest:=public.v2_assessment_hash(input);
 SELECT * INTO prior FROM public.v2_receipts WHERE user_id=actor AND client_submission_id=client_key;
 IF FOUND THEN
  IF prior.semantic_hash<>digest OR (SELECT payload FROM public.v2_contributions WHERE id=prior.contribution_id) IS DISTINCT FROM input THEN
   RAISE EXCEPTION 'v2_intake_idempotency_conflict' USING ERRCODE='23514'; END IF;
  RETURN prior.initial_response || jsonb_build_object('replayed',true);
 END IF;
 -- Current reference checks occur only on a new request. Receipts never replay
 -- effects, even if their operator/source was subsequently retired or erased.
 IF NOT EXISTS(SELECT 1 FROM public.cities WHERE id=origin) OR NOT EXISTS(SELECT 1 FROM public.cities WHERE id=destination) THEN
  RAISE EXCEPTION 'v2_intake_city_missing' USING ERRCODE='23503'; END IF;
 IF operator_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.v2_subjects s JOIN public.v2_operators o ON o.subject_id=s.id WHERE s.id=operator_id AND s.lifecycle='active') THEN
  RAISE EXCEPTION 'v2_intake_operator_unavailable' USING ERRCODE='23503'; END IF;
 -- Scoped circular assembly is also safe under caller SET CONSTRAINTS ALL IMMEDIATE.
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_lead_subtype,public.v2_lead_initial_contribution DEFERRED;
 INSERT INTO public.v2_corridors(origin_city_id,destination_city_id) VALUES(origin,destination)
  ON CONFLICT(origin_city_id,destination_city_id) DO NOTHING;
 SELECT id INTO corridor FROM public.v2_corridors WHERE origin_city_id=origin AND destination_city_id=destination;
 INSERT INTO public.v2_subjects(id,kind) VALUES(subject,'lead');
 INSERT INTO public.v2_leads(subject_id,corridor_id,reported_departure_seconds,operator_subject_id,operator_name,initial_contribution_id)
  VALUES(subject,corridor,substring(clock,1,2)::integer*3600+substring(clock,4,2)::integer*60,operator_id,operator_value->>'name',contribution);
 INSERT INTO public.v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
  VALUES(contribution,actor,client_key,'1.0',request->>'entrySurface',digest,input,subject);
 INSERT INTO public.v2_subject_revisions(subject_id,subject_kind,revision,snapshot,origin_kind,initial_contribution_id)
  VALUES(subject,'lead',1,public.v2_transport_snapshot(subject),'contribution',contribution);
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_lead_subtype,public.v2_lead_initial_contribution IMMEDIATE;
 INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
  SELECT contribution,subject,f,v,'{}',public.v2_assessment_hash('{}'),public.v2_assessment_hash(v),knowledge,observed
  FROM (VALUES('operator.reported',operator_value),('departure.reported',jsonb_build_object('time',clock,'basis',basis))) core_facts(f,v);
 FOR item IN SELECT value FROM jsonb_array_elements(request->'observations') LOOP
  IF NOT COALESCE(jsonb_typeof(item)='object' AND item ?& ARRAY['fieldKey','value','scope']
    AND item-ARRAY['fieldKey','value','scope','knowledgeBasis','observedDate','observedDateEnd','effectiveFrom','effectiveTo','sources']='{}'::jsonb
    AND jsonb_typeof(item->'fieldKey')='string' AND item->>'fieldKey' NOT IN('operator.reported','departure.reported')
    AND (NOT item ? 'knowledgeBasis' OR item->>'knowledgeBasis' IN('travelled','saw_operating','observed_sign','operator_statement','heard_from_other','unprovided'))
    AND (NOT item ? 'sources' OR jsonb_typeof(item->'sources')='array'),false) THEN
   RAISE EXCEPTION 'v2_intake_observation_envelope_invalid' USING ERRCODE='23514'; END IF;
  FOREACH date_key IN ARRAY ARRAY['observedDate','observedDateEnd','effectiveFrom','effectiveTo'] LOOP
   IF item ? date_key AND NOT public.v2_json_date(item->date_key) THEN RAISE EXCEPTION 'v2_intake_date_invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  field:=item->>'fieldKey';
  INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from,observed_to,effective_from,effective_to)
   VALUES(contribution,subject,field,item->'value',item->'scope',public.v2_assessment_hash(item->'scope'),public.v2_assessment_hash(item->'value'),COALESCE(item->>'knowledgeBasis','unprovided'),
    (item->>'observedDate')::date,(item->>'observedDateEnd')::date,(item->>'effectiveFrom')::date,(item->>'effectiveTo')::date) RETURNING id INTO observation;
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
-- Removing an original core observation also erases the copied origin snapshot.
-- Withdrawal retains private history; physical erasure must not retain its copy.
CREATE FUNCTION public.v2_erase_lead_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.field_key IN('operator.reported','departure.reported') THEN
  UPDATE public.v2_subject_revisions SET origin_kind='erased',snapshot=NULL,decision_id=NULL,decision_kind=NULL,initial_contribution_id=NULL
   WHERE subject_id=OLD.original_subject_id AND origin_kind='contribution' AND initial_contribution_id=OLD.contribution_id;
 END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER v2_erase_lead_origin BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_erase_lead_origin();
-- Dedicated owner-only boundary until authenticated API actor/Terms wiring.
DO $$ DECLARE r text; BEGIN
 REVOKE ALL ON FUNCTION public.v2_submit_lead(varchar,text,jsonb),public.v2_erase_lead_origin() FROM PUBLIC,mabhazi_api;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_submit_lead(varchar,text,jsonb),public.v2_erase_lead_origin() FROM %I',r); END IF;
 END LOOP;
END; $$;
