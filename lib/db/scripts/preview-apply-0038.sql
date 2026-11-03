-- Mabhazi Preview ocwlqhlfavvuncfmzuqh only. Action-time permission required.
-- Source0038 SHA256 62c6215beeb1fff21a9bea934cea0b4906fec3c2c1f389b5c31f174c18af51e1. One restricted function; no tables or schedules.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $preview_invitation_0038$
DECLARE previous text;before_data jsonb;before_functions jsonb;f jsonb;proc_row record;
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
('0033_prompt_refresh_worker.sql','abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896'),
('0034_route_place_observations.sql','0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5'),
('0035_route_place_reports.sql','19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a'),
('0036_pickup_question_api.sql','e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86'),
('0037_prompt_controls_api.sql','0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0')) expected(name,checksum)
 LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(38,39) THEN RAISE EXCEPTION 'invitation_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0038_pickup_invitation_api.sql';
 IF previous IS NOT NULL AND previous<>'62c6215beeb1fff21a9bea934cea0b4906fec3c2c1f389b5c31f174c18af51e1' THEN RAISE EXCEPTION 'invitation_preview_hash_changed';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements($deps$[{"signature":"public.v2_prompt_eligible(uuid,varchar,text[])","hash":"aa637978a9099629fa01b6b8f9fd94a3d455407f62b70ba4cb9d0a053848b826","securityDefiner":false,"backendExecute":false},{"signature":"public.v2_prompt_account(varchar)","hash":"198ed9bd7e351b2a02cdea5567f525927244892ba5a879217dd21adc628277f8","securityDefiner":false,"backendExecute":false},{"signature":"public.v2_prompt_touch(varchar)","hash":"dc8a199fb9c99ee8cda5ad0b4be86d03af97170d290d0f5ab1d7572c5b9ff63a","securityDefiner":true,"backendExecute":false},{"signature":"public.v2_prompt_read(varchar,uuid)","hash":"a8bf025b7b8f902897ca368d6258852d40d903720f62250ecde74bfa0541faa5","securityDefiner":false,"backendExecute":false},{"signature":"public.v2_api_pickup_question_read(varchar,uuid,varchar[])","hash":"e51f43c6be2e31fa0d3d1b713bf2a60ca43965fbbaf6f5ee812fc85db59a762b","securityDefiner":true,"backendExecute":true}]$deps$::jsonb) LOOP
  SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f->>'signature');
  IF NOT FOUND OR proc_row.prosecdef IS DISTINCT FROM (f->>'securityDefiner')::boolean
   OR proc_row.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
   OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f->>'hash'
   OR has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE') IS DISTINCT FROM (f->>'backendExecute')::boolean
   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(proc_row.proacl,acldefault('f',proc_row.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
   THEN RAISE EXCEPTION 'invitation_dependency_changed: %',f->>'signature';END IF;
 END LOOP;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_pickup_answer_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x)),(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.proname NOT IN('v2_api_pickup_invitation_reserve')) INTO before_data,before_functions;
 IF previous IS NULL THEN
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_api_pickup_invitation_reserve')) THEN RAISE EXCEPTION 'invitation_partial_or_unrecorded';END IF;
  EXECUTE $source_invitation_0038$-- Supported unsolicited pickup reservation; existing prompts/1 settings apply.
-- No generic reservation helper is exposed and no transport evidence is written.
CREATE FUNCTION public.v2_api_pickup_invitation_reserve(p_actor varchar,p_request uuid,p_subject uuid,p_revision bigint,p_identity text,p_declared text[],p_surface text,p_blocked varchar[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_prompt_requests;chosen public.v2_question_tasks;
 policy public.v2_prompt_policies;pref public.v2_prompt_preferences;session public.v2_prompt_sessions;
 now_time timestamptz;digest text;context jsonb;blocked boolean;
BEGIN
 PERFORM public.v2_prompt_account(p_actor);
 IF p_request IS NULL OR p_subject IS NULL OR p_revision IS NULL OR p_revision NOT BETWEEN 1 AND 9007199254740991
  OR p_identity IS NULL OR p_identity !~ '^[0-9a-f]{64}$'
  OR p_surface IS NULL OR p_surface NOT IN('search_result','route_detail')
  OR NOT public.v2_prompt_context_valid(p_declared) OR cardinality(p_declared) NOT BETWEEN 1 AND 3
  OR EXISTS(SELECT 1 FROM unnest(p_declared) d WHERE d NOT IN('knows_route','at_stop','travelled'))
  OR p_blocked IS NULL OR EXISTS(SELECT 1 FROM unnest(p_blocked) b WHERE b IS NULL)
  THEN RAISE EXCEPTION 'v2_prompt_request_invalid' USING ERRCODE='23514';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array('pickup-invitation/1',p_actor,p_subject,p_revision,p_identity,p_surface,
  ARRAY(SELECT d FROM unnest(p_declared) d ORDER BY d)));
 SELECT * INTO prior FROM public.v2_prompt_requests WHERE id=p_request;
 IF FOUND THEN
  IF prior.user_id<>p_actor OR prior.request_digest IS DISTINCT FROM digest
   THEN RAISE EXCEPTION 'v2_prompt_request_conflict' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.v2_prompt_invitations WHERE id=p_request AND user_id=p_actor)
   THEN RETURN jsonb_build_object('status','none');END IF;
  RETURN public.v2_api_pickup_question_read(p_actor,p_request,p_blocked);
 END IF;
 context:=public.v2_api_route_contribution_context(p_actor,p_subject,p_blocked);
 IF context->>'identityKey' IS DISTINCT FROM p_identity
  THEN RAISE EXCEPTION 'v2_prompt_identity_reconfirmation_required' USING ERRCODE='40001';END IF;
 IF (context->>'revision')::bigint<>p_revision
  THEN RAISE EXCEPTION 'v2_prompt_target_changed' USING ERRCODE='40001';END IF;
 -- Account/transport locking above serialises concurrent devices and task changes.
 PERFORM public.v2_prompt_touch(p_actor);
 now_time:=clock_timestamp();
 SELECT * INTO policy FROM public.v2_prompt_policies WHERE version='prompts/1';
 SELECT * INTO pref FROM public.v2_prompt_preferences WHERE user_id=p_actor;
 SELECT * INTO session FROM public.v2_prompt_sessions WHERE user_id=p_actor;
 blocked:=NOT pref.invitations_enabled OR pref.dismissed_until>now_time OR session.invite_reserved
  OR (SELECT count(*) FROM public.v2_prompt_requests WHERE user_id=p_actor AND consumed AND created_at>now_time-interval '24 hours')>=policy.daily_cap;
 IF NOT COALESCE(blocked,false) THEN
  SELECT t.* INTO chosen FROM public.v2_question_tasks t
   JOIN public.v2_question_registry r ON r.key=t.registry_key AND r.version=t.registry_version
   WHERE t.subject_id=p_subject AND t.registry_version='prompts/1'
    AND public.v2_prompt_eligible(t.id,p_actor,p_declared) AND p_surface=ANY(r.surfaces)
    AND NOT t.registry_key=ANY(pref.disabled_types)
    AND NOT EXISTS(SELECT 1 FROM public.v2_prompt_suppressions s WHERE s.user_id=p_actor
     AND s.subject_id=t.subject_id AND s.field_key=t.field_key AND s.scope_key=t.scope_key AND s.until_time>now_time)
   ORDER BY t.priority,t.created_at,t.id LIMIT 1;
 END IF;
 -- Do not reserve an unsupported higher-priority task or bypass it for pickup.
 IF chosen.registry_key IS DISTINCT FROM 'pickup_place' OR chosen.field_key IS DISTINCT FROM 'boarding.pickup'
  OR chosen.scope IS DISTINCT FROM '{}'::jsonb THEN chosen.id:=NULL;END IF;
 INSERT INTO public.v2_prompt_requests(id,user_id,request_digest,session_id,consumed,created_at)
  VALUES(p_request,p_actor,digest,session.session_id,chosen.id IS NOT NULL,now_time);
 IF chosen.id IS NULL THEN RETURN jsonb_build_object('status','none');END IF;
 INSERT INTO public.v2_prompt_invitations(id,user_id,task_id,policy_version,mode,reserved_at,expires_at,target_revision,identity_hash,declared_context,surface)
  VALUES(p_request,p_actor,chosen.id,'prompts/1','unsolicited',now_time,now_time+make_interval(mins=>policy.unopened_minutes),
   p_revision,p_identity,p_declared,p_surface);
 UPDATE public.v2_prompt_sessions SET invite_reserved=true WHERE user_id=p_actor;
 RETURN public.v2_api_pickup_question_read(p_actor,p_request,p_blocked);
END;$$;

REVOKE ALL ON FUNCTION public.v2_api_pickup_invitation_reserve(varchar,uuid,uuid,bigint,text,text[],text,varchar[]) FROM PUBLIC,mabhazi_api;
GRANT EXECUTE ON FUNCTION public.v2_api_pickup_invitation_reserve(varchar,uuid,uuid,bigint,text,text[],text,varchar[]) TO mabhazi_api;
DO $$DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.v2_api_pickup_invitation_reserve(varchar,uuid,uuid,bigint,text,text[],text,varchar[]) FROM %I',r);
 END IF;END LOOP;
END;$$;
$source_invitation_0038$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0038_pickup_invitation_api.sql','62c6215beeb1fff21a9bea934cea0b4906fec3c2c1f389b5c31f174c18af51e1');
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements($specs$[{"name":"v2_api_pickup_invitation_reserve","signature":"public.v2_api_pickup_invitation_reserve(varchar,uuid,uuid,bigint,text,text[],text,varchar[])","hash":"33bbd12fecddf15359e89d8c13d21aed55380707e4866fbe119765475049895f","volatility":"v"}]$specs$::jsonb) LOOP
  SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f->>'signature');
  IF NOT FOUND OR NOT proc_row.prosecdef OR proc_row.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
   OR proc_row.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR proc_row.provolatile::text<>f->>'volatility'
   OR proc_row.prorettype<>'jsonb'::regtype OR proc_row.proretset OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f->>'hash'
   OR NOT has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(proc_row.proacl,acldefault('f',proc_row.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
   THEN RAISE EXCEPTION 'invitation_function_fence_changed: %',f->>'signature';END IF;
 END LOOP;
 IF jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_pickup_answer_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x)) IS DISTINCT FROM before_data OR (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.proname NOT IN('v2_api_pickup_invitation_reserve')) IS DISTINCT FROM before_functions THEN RAISE EXCEPTION 'invitation_preserved_state_changed';END IF;
END;$preview_invitation_0038$;
COMMIT;
SELECT clock_timestamp() checked_at,(SELECT count(*) FROM mabhazi_migrations.applied) ledger_entries,
 (SELECT checksum FROM mabhazi_migrations.applied WHERE name='0038_pickup_invitation_api.sql') migration_hash;
