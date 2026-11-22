-- Typed endpoint knowledge on an existing route. No actual journey is fabricated.
CREATE FUNCTION public.v2_api_route_contribution_context(actor varchar,subject uuid,blocked varchar[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lead public.v2_leads;state public.v2_subjects;own boolean;origin jsonb;destination jsonb;operator_name text;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor)
  OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) b WHERE b IS NULL OR length(b) NOT BETWEEN 1 AND 200)
  THEN RAISE EXCEPTION 'v2_route_safety_context_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO state FROM public.v2_subjects WHERE id=subject AND kind='lead' AND lifecycle='active';
 SELECT * INTO lead FROM public.v2_leads WHERE subject_id=subject AND intake_kind='community' AND NOT attribution_erased;
 IF state.id IS NULL OR lead.subject_id IS NULL THEN RAISE EXCEPTION 'v2_route_target_unavailable' USING ERRCODE='42501';END IF;
 own:=EXISTS(SELECT 1 FROM public.v2_contributions WHERE id=lead.initial_contribution_id AND user_id=actor);
 IF NOT own AND NOT EXISTS(SELECT 1 FROM public.v2_public_lead_reports p WHERE p.subject_id=subject AND NOT(p.author_user_id=ANY(blocked))
  AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=actor AND b.blocked_user_id=p.author_user_id))
  THEN RAISE EXCEPTION 'v2_route_target_unavailable' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('id',a.id,'name',a.name,'placeType',a.place_type),jsonb_build_object('id',b.id,'name',b.name,'placeType',b.place_type)
 INTO origin,destination FROM public.v2_corridors c JOIN public.cities a ON a.id=c.origin_city_id JOIN public.cities b ON b.id=c.destination_city_id WHERE c.id=lead.corridor_id;
 SELECT COALESCE(lead.operator_name,o.display_name) INTO operator_name FROM (SELECT 1) singleton LEFT JOIN public.v2_operators o ON o.subject_id=lead.operator_subject_id;
 IF origin IS NULL OR destination IS NULL OR operator_name IS NULL OR lead.reported_departure_seconds IS NULL
  OR lead.reported_departure_seconds%60<>0 THEN RAISE EXCEPTION 'v2_route_target_unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('subjectId',subject,'revision',state.revision,'identityKey',public.v2_prompt_identity(subject),
  'origin',origin,'destination',destination,'operatorName',operator_name,
  'departureTime',lpad((lead.reported_departure_seconds/3600)::text,2,'0')||':'||lpad(((lead.reported_departure_seconds%3600)/60)::text,2,'0'));
END;$$;

CREATE FUNCTION public.v2_api_submit_route_observations(actor varchar,required_terms text,request jsonb,blocked varchar[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target jsonb;item jsonb;input jsonb;context jsonb;items jsonb:='[]';normal_item jsonb;source_ids jsonb;
 client_key uuid;digest text;prior public.v2_receipts;subject uuid;contribution uuid:=gen_random_uuid();observation uuid;response jsonb;
 field text;seen text[]:='{}';citation jsonb;source_id uuid;generation bigint;expected bigint;
BEGIN
 IF actor IS NULL OR required_terms IS NULL OR length(required_terms) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'v2_intake_actor_or_terms_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND terms_accepted_version=required_terms AND terms_accepted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'v2_intake_terms_required' USING ERRCODE='42501';END IF;
 IF NOT COALESCE(jsonb_typeof(request)='object' AND request ?& ARRAY['schemaVersion','clientSubmissionId','entrySurface','target','observations']
  AND request-ARRAY['schemaVersion','clientSubmissionId','entrySurface','target','observations']='{}'::jsonb
  AND jsonb_typeof(request->'schemaVersion')='string' AND request->>'schemaVersion'='1.0' AND public.v2_json_uuid(request->'clientSubmissionId')
  AND request->>'entrySurface' IN('contribute_tab','search_result','route_detail','own_contribution')
  AND jsonb_typeof(request->'target')='object' AND (request->'target')-'existing'='{}'::jsonb
  AND jsonb_typeof(request->'observations')='array',false) OR octet_length(request::text)>65536
  THEN RAISE EXCEPTION 'v2_intake_request_invalid' USING ERRCODE='23514';END IF;
 IF jsonb_array_length(request->'observations') NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'v2_intake_observation_limit' USING ERRCODE='23514';END IF;
 target:=request->'target'->'existing';
 IF NOT COALESCE(jsonb_typeof(target)='object' AND target ?& ARRAY['subjectId','expectedRevision','identityKey']
  AND target-ARRAY['subjectId','expectedRevision','identityKey']='{}'::jsonb AND public.v2_json_uuid(target->'subjectId')
  AND jsonb_typeof(target->'expectedRevision')='number' AND target->>'expectedRevision' ~ '^[1-9][0-9]{0,15}$'
  AND (target->>'expectedRevision')::numeric<=9007199254740991 AND jsonb_typeof(target->'identityKey')='string'
  AND target->>'identityKey' ~ '^[0-9a-f]{64}$',false) THEN RAISE EXCEPTION 'v2_route_target_invalid' USING ERRCODE='23514';END IF;
 subject:=(target->>'subjectId')::uuid;expected:=(target->>'expectedRevision')::bigint;
 FOR item IN SELECT value FROM jsonb_array_elements(request->'observations') LOOP
  field:=item->>'fieldKey';
  IF NOT COALESCE(jsonb_typeof(item)='object' AND item ?& ARRAY['fieldKey','value','scope']
   AND item-ARRAY['fieldKey','value','scope','knowledgeBasis','observedDate','sources']='{}'::jsonb
   AND field IN('boarding.pickup','alighting.dropoff') AND NOT field=ANY(seen)
   AND item->'scope'='{}'::jsonb AND public.v2_intake_observation_valid(field,item->'value',item->'scope')
   AND (item->'value')-ARRAY['cityId','name','instructions']='{}'::jsonb
   AND (item->'value') ? 'cityId' AND jsonb_typeof(item->'value'->'cityId')='number'
   AND item->'value'->>'cityId' ~ '^[1-9][0-9]{0,8}$'
   AND item->'value'->>'name'=btrim(item->'value'->>'name') AND item->'value'->>'name' !~ '[[:cntrl:]]'
   AND (NOT item ? 'knowledgeBasis' OR item->>'knowledgeBasis' IN('travelled','saw_operating','observed_sign','operator_statement','heard_from_other','unprovided'))
   AND (NOT item ? 'observedDate' OR public.v2_json_date(item->'observedDate'))
   AND (NOT item ? 'sources' OR jsonb_typeof(item->'sources')='array'),false)
   THEN RAISE EXCEPTION 'v2_route_observation_invalid' USING ERRCODE='23514';END IF;
  IF item ? 'sources' AND jsonb_array_length(item->'sources')>10 THEN RAISE EXCEPTION 'v2_intake_source_limit' USING ERRCODE='23514';END IF;
  source_ids:='[]';
  FOR citation IN SELECT value FROM jsonb_array_elements(COALESCE(item->'sources','[]'::jsonb)) LOOP
   IF NOT public.v2_json_uuid(citation) THEN RAISE EXCEPTION 'v2_intake_existing_source_id_required' USING ERRCODE='23514';END IF;
   source_id:=(citation#>>'{}')::uuid;
   IF source_ids @> jsonb_build_array(source_id) THEN RAISE EXCEPTION 'v2_route_duplicate_source' USING ERRCODE='23514';END IF;
   source_ids:=source_ids||jsonb_build_array(source_id);
  END LOOP;
  normal_item:=item||jsonb_build_object('knowledgeBasis',COALESCE(item->>'knowledgeBasis','unprovided'),
   'sources',COALESCE((SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(source_ids) x),'[]'::jsonb));
  items:=items||jsonb_build_array(normal_item);seen:=array_append(seen,field);
 END LOOP;
 -- Operation namespace blocks accidental receipt reuse across intake endpoints.
 input:=(request-'clientSubmissionId')||jsonb_build_object('operation','route-observations/1','target',jsonb_build_object('existing',target||jsonb_build_object('subjectId',subject)),'observations',items);
 client_key:=(request->>'clientSubmissionId')::uuid;digest:=public.v2_assessment_hash(input);
 SELECT * INTO prior FROM public.v2_receipts WHERE user_id=actor AND client_submission_id=client_key;
 IF FOUND THEN
  IF prior.semantic_hash<>digest OR (SELECT payload FROM public.v2_contributions WHERE id=prior.contribution_id) IS DISTINCT FROM input THEN RAISE EXCEPTION 'v2_intake_idempotency_conflict' USING ERRCODE='23514';END IF;
  RETURN prior.initial_response||jsonb_build_object('replayed',true);
 END IF;
 PERFORM 1 FROM public.v2_subjects WHERE id=subject FOR UPDATE;
 context:=public.v2_api_route_contribution_context(actor,subject,blocked);
 IF context->>'identityKey' IS DISTINCT FROM target->>'identityKey' OR expected>(context->>'revision')::bigint
  THEN RAISE EXCEPTION 'v2_route_identity_changed' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF (item->'value'->>'cityId')::integer<>(CASE item->>'fieldKey' WHEN 'boarding.pickup' THEN (context->'origin'->>'id')::integer ELSE (context->'destination'->>'id')::integer END)
   THEN RAISE EXCEPTION 'v2_route_endpoint_mismatch' USING ERRCODE='23514';END IF;
  FOR citation IN SELECT value FROM jsonb_array_elements(item->'sources') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=(citation#>>'{}')::uuid AND owner_user_id=actor)
    THEN RAISE EXCEPTION 'v2_intake_source_forbidden' USING ERRCODE='42501';END IF;
  END LOOP;
 END LOOP;
 INSERT INTO public.v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
  VALUES(contribution,actor,client_key,'1.0',request->>'entrySurface',digest,input,subject);
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
   VALUES(contribution,subject,item->>'fieldKey',item->'value','{}',public.v2_assessment_hash('{}'),public.v2_assessment_hash(item->'value'),item->>'knowledgeBasis',(item->>'observedDate')::date) RETURNING id INTO observation;
  FOR citation IN SELECT value FROM jsonb_array_elements(item->'sources') LOOP
   INSERT INTO public.v2_observation_sources(observation_id,source_id,relation) VALUES(observation,(citation#>>'{}')::uuid,'cites');
  END LOOP;
 END LOOP;
 SELECT input_generation INTO generation FROM public.v2_subjects WHERE id=subject;
 INSERT INTO public.v2_jobs(kind,subject_id,contribution_id,requested_generation,policy_version,trigger_id)
  VALUES('assess',subject,contribution,generation,'evidence/1',contribution);
 response:=jsonb_build_object('contributionId',contribution,'clientSubmissionId',client_key,'subjectId',subject,
  'saveStatus','saved','processingStatus','queued','associationStatus','unresolved','publicationStatus','pending','replayed',false,
  'targetAdvanced',(context->>'revision')::bigint>expected);
 INSERT INTO public.v2_receipts(user_id,client_submission_id,contribution_id,semantic_hash,initial_response) VALUES(actor,client_key,contribution,digest,response);
 RETURN response;
END;$$;
DO $$DECLARE f text;r text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_api_route_contribution_context(varchar,uuid,varchar[])','public.v2_api_submit_route_observations(varchar,text,jsonb,varchar[])'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END;$$;
