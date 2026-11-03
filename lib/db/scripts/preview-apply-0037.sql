-- Mabhazi Preview ocwlqhlfavvuncfmzuqh only. Action-time permission required.
-- Source0037 SHA256 0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0. Three restricted functions; no tables or schedules.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $preview_controls_0037$
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
('0036_pickup_question_api.sql','e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86')) expected(name,checksum)
 LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(37,38) THEN RAISE EXCEPTION 'controls_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0037_prompt_controls_api.sql';
 IF previous IS NOT NULL AND previous<>'0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0' THEN RAISE EXCEPTION 'controls_preview_hash_changed';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements($deps$[{"signature":"public.v2_prompt_account(varchar)","hash":"198ed9bd7e351b2a02cdea5567f525927244892ba5a879217dd21adc628277f8","securityDefiner":false},{"signature":"public.v2_prompt_set_preferences(varchar,bigint,boolean,text[])","hash":"0eae3ecea318efa09eaabce7f158b53025c990d7794204a6277bf51a7031b15a","securityDefiner":true},{"signature":"public.v2_prompt_touch(varchar)","hash":"dc8a199fb9c99ee8cda5ad0b4be86d03af97170d290d0f5ab1d7572c5b9ff63a","securityDefiner":true}]$deps$::jsonb) LOOP
  SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f->>'signature');
  IF NOT FOUND OR proc_row.prosecdef IS DISTINCT FROM (f->>'securityDefiner')::boolean
   OR proc_row.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
   OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f->>'hash'
   OR has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(proc_row.proacl,acldefault('f',proc_row.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
   THEN RAISE EXCEPTION 'controls_dependency_changed: %',f->>'signature';END IF;
 END LOOP;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_pickup_answer_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x)),(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.proname NOT IN('v2_api_prompt_preferences_read','v2_api_prompt_preferences_set','v2_api_prompt_activity')) INTO before_data,before_functions;
 IF previous IS NULL THEN
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_api_prompt_preferences_read','v2_api_prompt_preferences_set','v2_api_prompt_activity')) THEN RAISE EXCEPTION 'controls_partial_or_unrecorded';END IF;
  EXECUTE $source_controls_0037$-- Account prompt controls only; prompts/1 policy and manual help are unchanged.
CREATE FUNCTION public.v2_api_prompt_preferences_read(p_actor varchar)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pref public.v2_prompt_preferences;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor)
  OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=p_actor) THEN
  RAISE EXCEPTION 'v2_prompt_account_unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO pref FROM public.v2_prompt_preferences WHERE user_id=p_actor;
 RETURN jsonb_build_object('policyVersion','prompts/1','revision',COALESCE(pref.revision,1),
  'invitationsEnabled',COALESCE(pref.invitations_enabled,true),'disabledTypes',COALESCE(to_jsonb(pref.disabled_types),'[]'::jsonb),
  'dismissedUntil',pref.dismissed_until);
END;$$;

CREATE FUNCTION public.v2_api_prompt_preferences_set(p_actor varchar,p_expected bigint,p_enabled boolean,p_disabled text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pref public.v2_prompt_preferences; canonical text[];
BEGIN
 PERFORM public.v2_prompt_account(p_actor);
 IF p_expected IS NULL OR p_expected<1 OR p_expected>9007199254740991 OR p_enabled IS NULL OR p_disabled IS NULL
  OR cardinality(p_disabled)>9 OR array_ndims(p_disabled)>1
  OR EXISTS(SELECT 1 FROM unnest(p_disabled) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_question_registry r WHERE r.key=x AND r.version='prompts/1'))
  OR cardinality(p_disabled)<>(SELECT count(DISTINCT x) FROM unnest(p_disabled) x) THEN
  RAISE EXCEPTION 'v2_prompt_preferences_invalid' USING ERRCODE='23514';END IF;
 canonical:=ARRAY(SELECT x FROM unnest(p_disabled) x ORDER BY x);
 SELECT * INTO pref FROM public.v2_prompt_preferences WHERE user_id=p_actor;
 -- A lost acknowledgement may retry its exact desired state. Do not bump the
 -- revision again, clear dismissal, touch activity or overwrite another choice.
 IF pref.invitations_enabled=p_enabled AND pref.disabled_types=canonical THEN
  RETURN public.v2_api_prompt_preferences_read(p_actor);END IF;
 IF pref.revision<>p_expected THEN RAISE EXCEPTION 'v2_prompt_preferences_stale' USING ERRCODE='40001';END IF;
 PERFORM public.v2_prompt_set_preferences(p_actor,p_expected,p_enabled,canonical);
 RETURN public.v2_api_prompt_preferences_read(p_actor);
END;$$;

CREATE FUNCTION public.v2_api_prompt_activity(p_actor varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.v2_prompt_touch(p_actor);
 RETURN jsonb_build_object('recorded',true);
END;$$;

DO $fences$
DECLARE f regprocedure; r text;
BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_api_prompt_preferences_read(varchar)'::regprocedure,
  'public.v2_api_prompt_preferences_set(varchar,bigint,boolean,text[])'::regprocedure,
  'public.v2_api_prompt_activity(varchar)'::regprocedure] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f);
 END LOOP;
END;$fences$;
$source_controls_0037$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0037_prompt_controls_api.sql','0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0');
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements($specs$[{"name":"v2_api_prompt_preferences_read","signature":"public.v2_api_prompt_preferences_read(varchar)","hash":"92d07273fb2c66953df29a6bc449fd98f881ae91882c86e7752cdfa990f4b47e","volatility":"s"},{"name":"v2_api_prompt_preferences_set","signature":"public.v2_api_prompt_preferences_set(varchar,bigint,boolean,text[])","hash":"2d62fd5b82bbcbacd0049b19fc4740447bbc70a414116b34a94451433007216f","volatility":"v"},{"name":"v2_api_prompt_activity","signature":"public.v2_api_prompt_activity(varchar)","hash":"2985b4eca0f444c5f5019278b18cd4b95a6dc3bf4fdbf70b9022c14ca419a1a5","volatility":"v"}]$specs$::jsonb) LOOP
  SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f->>'signature');
  IF NOT FOUND OR NOT proc_row.prosecdef OR proc_row.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
   OR proc_row.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR proc_row.provolatile::text<>f->>'volatility'
   OR proc_row.prorettype<>'jsonb'::regtype OR proc_row.proretset OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f->>'hash'
   OR NOT has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(proc_row.proacl,acldefault('f',proc_row.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
   THEN RAISE EXCEPTION 'controls_function_fence_changed: %',f->>'signature';END IF;
 END LOOP;
 IF jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_metrics x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_pickup_answer_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x)) IS DISTINCT FROM before_data OR (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.proname NOT IN('v2_api_prompt_preferences_read','v2_api_prompt_preferences_set','v2_api_prompt_activity')) IS DISTINCT FROM before_functions THEN RAISE EXCEPTION 'controls_preserved_state_changed';END IF;
END;$preview_controls_0037$;
COMMIT;
SELECT clock_timestamp() checked_at,(SELECT count(*) FROM mabhazi_migrations.applied) ledger_entries,
 (SELECT checksum FROM mabhazi_migrations.applied WHERE name='0037_prompt_controls_api.sql') migration_hash;
