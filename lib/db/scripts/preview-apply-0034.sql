-- Mabhazi Preview ocwlqhlfavvuncfmzuqh only. Fresh action-time approval required.
-- Source0034 SHA256 0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5; two fenced route-knowledge permissions; no new tables or client access.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $preview_tasks_0034$
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
('0032_public_fare_reports.sql','b8b9d1d0d8136d9c477c3890bdfd52b93be1f81c2fce208978eeb2e05fb15f47'),
('0033_prompt_refresh_worker.sql','abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896')) expected(name,checksum)
  LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(34,35) THEN RAISE EXCEPTION 'prompt_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0034_route_place_observations.sql';
 IF previous IS NOT NULL AND previous<>'0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5' THEN RAISE EXCEPTION 'prompt_preview_hash_changed';END IF;
 SELECT (SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) FROM pg_proc proc_snapshot WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_api_route_contribution_context','v2_api_submit_route_observations')) INTO before_functions;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_actual_journeys x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_sources x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_assessments x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_decisions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_current_fields x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_refs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_hides x)) INTO before_data;
 SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) INTO old_jobs FROM public.v2_jobs j;
 IF previous IS NULL THEN
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_api_route_contribution_context','v2_api_submit_route_observations'))
   THEN RAISE EXCEPTION 'prompt_partial_or_unrecorded';END IF;
  EXECUTE $source_tasks_0034$
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

$source_tasks_0034$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0034_route_place_observations.sql','0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5');
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements($function_specs$[{"name":"v2_api_route_contribution_context","signature":"public.v2_api_route_contribution_context(varchar,uuid,varchar[])","hash":"f34bd8f067428438c015d075a428e7dd0ef46a9f64a5d55f94336a4d9e0474e8","definer":true,"language":"plpgsql","volatility":"s","config":["search_path=pg_catalog"],"result":"jsonb","set":false,"backend":true},{"name":"v2_api_submit_route_observations","signature":"public.v2_api_submit_route_observations(varchar,text,jsonb,varchar[])","hash":"6fe2218cfb85c31216ddc742f3e3d48063485c50358046cfc04039a9177aca10","definer":true,"language":"plpgsql","volatility":"v","config":["search_path=pg_catalog"],"result":"jsonb","set":false,"backend":true}]$function_specs$::jsonb) LOOP
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
 SELECT (SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) FROM pg_proc proc_snapshot WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_api_route_contribution_context','v2_api_submit_route_observations')) INTO after_functions;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_actual_journeys x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_sources x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_assessments x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_decisions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_current_fields x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_refs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_hides x)) INTO after_data;
 SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY id),'[]'::jsonb) INTO retained_jobs FROM public.v2_jobs j
  WHERE j.id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(old_jobs) x);
 IF before_functions IS DISTINCT FROM after_functions OR before_data IS DISTINCT FROM after_data OR old_jobs IS DISTINCT FROM retained_jobs
  THEN RAISE EXCEPTION 'prompt_existing_state_changed';END IF;
 IF (SELECT count(*) FROM mabhazi_migrations.applied)<>35 THEN RAISE EXCEPTION 'prompt_ledger_changed';END IF;
END;$preview_tasks_0034$;
COMMIT;
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'ledgerEntries',(SELECT count(*) FROM mabhazi_migrations.applied),
 'migrationHash',(SELECT checksum FROM mabhazi_migrations.applied WHERE name='0034_route_place_observations.sql'),
 'contributions',(SELECT count(*) FROM public.v2_contributions),'receipts',(SELECT count(*) FROM public.v2_receipts),
 'observations',(SELECT count(*) FROM public.v2_observations),'tasks',(SELECT count(*) FROM public.v2_question_tasks))::text proof;
