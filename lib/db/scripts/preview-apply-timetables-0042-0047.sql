-- Mabhazi Preview ocwlqhlfavvuncfmzuqh ONLY. No transport import, owner grant or production change.
BEGIN;
SET LOCAL statement_timeout='120s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $activate_timetables$
DECLARE baseline jsonb:='[{"name":"0000_initial.sql","checksum":"47816e783afdcbb778d16a4afbb23b2053ad5532fab1e06af7bbf9696115a38e"},{"name":"0001_api_role.sql","checksum":"1a4e952d4a7179075825ab142a38a751cc58a7919e3cf8b981ead546108283e4"},{"name":"0002_contribution_intake.sql","checksum":"b6a8edf014efd7f71531f21205f23c49f1bb0166b43374538a748074f0db25b8"},{"name":"0003_transport_structure.sql","checksum":"7bd24b0451546a40be14f6b8aef127c99c52eba710a812ee4f9e8feaae46b811"},{"name":"0004_review_decisions.sql","checksum":"d22083cdab91f0dc04b46016ebd200a3a3b0ead7229ba981452d27f5f7ba9a5a"},{"name":"0005_derived_decisions.sql","checksum":"62a6d76851d50cfab7754051618a4ac98c056e36a129629190140a107701442f"},{"name":"0006_observation_registry.sql","checksum":"ac310e0a630f58ac09b7bf254c1c8a4afefcd9bc8a6114e6cf89f72d4dfc353f"},{"name":"0007_observation_events.sql","checksum":"b47f0267431ac955faf6ad31981ed7b0133d5d63704b6a27a62c10330b814b21"},{"name":"0008_observation_targets.sql","checksum":"1cfb37200fa370708b9cb22fb46fc41a3704c40636028f84dc61da41bacf598e"},{"name":"0009_source_identity.sql","checksum":"e47a6b7e48bad9a7a2989da14c37a78d20f449c8680f09c439acd159d716190e"},{"name":"0010_evidence_assessments.sql","checksum":"0ccce5368dbf67f14facbc675943c8e094fe37b4dc57b32a770633be81c0dff2"},{"name":"0011_field_resolution.sql","checksum":"f086418f2525b85004d9a05da3b3169e2c1d2afe709e0c43b146a23002d1e572"},{"name":"0012_affiliation_issuers.sql","checksum":"e31320e5eff22ae28d159d5cb6ae95aee7b8aad9b5672d3f7e414fa1f12a1d17"},{"name":"0013_prompt_tasks.sql","checksum":"ab2446b8b4f161bb8bb8b39216f41fb12afd8738256fcd8ce0518171cf0a9b2e"},{"name":"0014_transport_propagation.sql","checksum":"44ff4ec120e21b61c128ef1ceabce3544f6cfad46ea6182315ea53e3c8ab1073"},{"name":"0015_transport_writers.sql","checksum":"6abb4def1d7b30854efe5f0a0371d3c278032f4e03f93b0c27d498b03281bea6"},{"name":"0016_lead_creation.sql","checksum":"748a3f024dedbd96dadef972a00af01d354cdf5a09711526a2ad228ebfa400e0"},{"name":"0017_transport_uuid_normalization.sql","checksum":"846f54fbcfa6446f94e08bdc5306e3cd895256da78d4dff87b40eedd2ed0b96e"},{"name":"0018_transport_creation.sql","checksum":"2b762ee0c3b9c5dab2ccf4f25286df25c4f5c3fdec31f3fe599157f4dce1d1d2"},{"name":"0019_route_pattern_creation.sql","checksum":"27fe4e63f14d665e5406296a44e693bc637b0c306c19efcb9778bc317f9d08ab"},{"name":"0020_service_run_creation.sql","checksum":"d25bd19870fe1307e5b00f75a98a3cccdc1317abedfb02c503109019f965dacd"},{"name":"0021_actual_journey_intake.sql","checksum":"2d5461ea7563dcbbb9b00a9aeac31e7994d0e9305583c251ad301acf25a696e9"},{"name":"0022_minimum_lead_api.sql","checksum":"e74223a70810dc43e0a416b26bf5698368872209fe51bde0a083341a2d95ab9e"},{"name":"0023_normalise_worker.sql","checksum":"8ab0d9f3db1d4ef2dd9e1d1dca00e26f715be963e364e08753e27a2c6cd61ae6"},{"name":"0024_lead_association_worker.sql","checksum":"7b889f2489bc07974ba34e929fbd207be77c1a446e11b381db4b9b09ec74e68d"},{"name":"0025_pattern_association_worker.sql","checksum":"388ba5d4a602d834d8fd8bcbe684b0180f6f98ab2f0f5e75e355fe99ea65eefe"},{"name":"0026_identity_lookup.sql","checksum":"9f5ab9ce65f9911c11ae866d79e88c56b693dc71780f02faf9941197e42ede32"},{"name":"0027_journey_processing.sql","checksum":"48106d054caadd7d97805b7143b69e08f0311b6153645fcbf9b5ce53cd2173a2"},{"name":"0028_actual_journey_api.sql","checksum":"7ab8860ddb09de0cf68ce64c0be883f3718184c4f0a68cff768ae0dce75fe705"},{"name":"0029_empty_search_minimum.sql","checksum":"7537057d3167b540df14c14c52adeda006079d366669bbb257f4d533a1227762"},{"name":"0030_public_route_context.sql","checksum":"b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36"},{"name":"0031_assessment_worker.sql","checksum":"ae4a5a5017046775147eaf562c90f234e23c47f28e90f11edd81ff94f7c60000"},{"name":"0032_public_fare_reports.sql","checksum":"b8b9d1d0d8136d9c477c3890bdfd52b93be1f81c2fce208978eeb2e05fb15f47"},{"name":"0033_prompt_refresh_worker.sql","checksum":"abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896"},{"name":"0034_route_place_observations.sql","checksum":"0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5"},{"name":"0035_route_place_reports.sql","checksum":"19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a"},{"name":"0036_pickup_question_api.sql","checksum":"e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86"},{"name":"0037_prompt_controls_api.sql","checksum":"0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0"},{"name":"0038_pickup_invitation_api.sql","checksum":"62c6215beeb1fff21a9bea934cea0b4906fec3c2c1f389b5c31f174c18af51e1"},{"name":"0039_admin_property_batches.sql","checksum":"09c61f1a7c5e4b1252f70243a8aacaf4f39669aef60193610250dc9697db2de5"},{"name":"0040_admin_route_visibility.sql","checksum":"4598a5a24c8e9c6b1203c44e9fb6ee7b1897ef03f51dd16f6ea1b2a843415a8d"},{"name":"0041_admin_core_corrections.sql","checksum":"aef318ebc5f6bf8408f95b9a503595b8b951d9a35e554a4b4e9a11850ee01248"}]'::jsonb;expected jsonb:='[{"name":"0000_initial.sql","checksum":"47816e783afdcbb778d16a4afbb23b2053ad5532fab1e06af7bbf9696115a38e"},{"name":"0001_api_role.sql","checksum":"1a4e952d4a7179075825ab142a38a751cc58a7919e3cf8b981ead546108283e4"},{"name":"0002_contribution_intake.sql","checksum":"b6a8edf014efd7f71531f21205f23c49f1bb0166b43374538a748074f0db25b8"},{"name":"0003_transport_structure.sql","checksum":"7bd24b0451546a40be14f6b8aef127c99c52eba710a812ee4f9e8feaae46b811"},{"name":"0004_review_decisions.sql","checksum":"d22083cdab91f0dc04b46016ebd200a3a3b0ead7229ba981452d27f5f7ba9a5a"},{"name":"0005_derived_decisions.sql","checksum":"62a6d76851d50cfab7754051618a4ac98c056e36a129629190140a107701442f"},{"name":"0006_observation_registry.sql","checksum":"ac310e0a630f58ac09b7bf254c1c8a4afefcd9bc8a6114e6cf89f72d4dfc353f"},{"name":"0007_observation_events.sql","checksum":"b47f0267431ac955faf6ad31981ed7b0133d5d63704b6a27a62c10330b814b21"},{"name":"0008_observation_targets.sql","checksum":"1cfb37200fa370708b9cb22fb46fc41a3704c40636028f84dc61da41bacf598e"},{"name":"0009_source_identity.sql","checksum":"e47a6b7e48bad9a7a2989da14c37a78d20f449c8680f09c439acd159d716190e"},{"name":"0010_evidence_assessments.sql","checksum":"0ccce5368dbf67f14facbc675943c8e094fe37b4dc57b32a770633be81c0dff2"},{"name":"0011_field_resolution.sql","checksum":"f086418f2525b85004d9a05da3b3169e2c1d2afe709e0c43b146a23002d1e572"},{"name":"0012_affiliation_issuers.sql","checksum":"e31320e5eff22ae28d159d5cb6ae95aee7b8aad9b5672d3f7e414fa1f12a1d17"},{"name":"0013_prompt_tasks.sql","checksum":"ab2446b8b4f161bb8bb8b39216f41fb12afd8738256fcd8ce0518171cf0a9b2e"},{"name":"0014_transport_propagation.sql","checksum":"44ff4ec120e21b61c128ef1ceabce3544f6cfad46ea6182315ea53e3c8ab1073"},{"name":"0015_transport_writers.sql","checksum":"6abb4def1d7b30854efe5f0a0371d3c278032f4e03f93b0c27d498b03281bea6"},{"name":"0016_lead_creation.sql","checksum":"748a3f024dedbd96dadef972a00af01d354cdf5a09711526a2ad228ebfa400e0"},{"name":"0017_transport_uuid_normalization.sql","checksum":"846f54fbcfa6446f94e08bdc5306e3cd895256da78d4dff87b40eedd2ed0b96e"},{"name":"0018_transport_creation.sql","checksum":"2b762ee0c3b9c5dab2ccf4f25286df25c4f5c3fdec31f3fe599157f4dce1d1d2"},{"name":"0019_route_pattern_creation.sql","checksum":"27fe4e63f14d665e5406296a44e693bc637b0c306c19efcb9778bc317f9d08ab"},{"name":"0020_service_run_creation.sql","checksum":"d25bd19870fe1307e5b00f75a98a3cccdc1317abedfb02c503109019f965dacd"},{"name":"0021_actual_journey_intake.sql","checksum":"2d5461ea7563dcbbb9b00a9aeac31e7994d0e9305583c251ad301acf25a696e9"},{"name":"0022_minimum_lead_api.sql","checksum":"e74223a70810dc43e0a416b26bf5698368872209fe51bde0a083341a2d95ab9e"},{"name":"0023_normalise_worker.sql","checksum":"8ab0d9f3db1d4ef2dd9e1d1dca00e26f715be963e364e08753e27a2c6cd61ae6"},{"name":"0024_lead_association_worker.sql","checksum":"7b889f2489bc07974ba34e929fbd207be77c1a446e11b381db4b9b09ec74e68d"},{"name":"0025_pattern_association_worker.sql","checksum":"388ba5d4a602d834d8fd8bcbe684b0180f6f98ab2f0f5e75e355fe99ea65eefe"},{"name":"0026_identity_lookup.sql","checksum":"9f5ab9ce65f9911c11ae866d79e88c56b693dc71780f02faf9941197e42ede32"},{"name":"0027_journey_processing.sql","checksum":"48106d054caadd7d97805b7143b69e08f0311b6153645fcbf9b5ce53cd2173a2"},{"name":"0028_actual_journey_api.sql","checksum":"7ab8860ddb09de0cf68ce64c0be883f3718184c4f0a68cff768ae0dce75fe705"},{"name":"0029_empty_search_minimum.sql","checksum":"7537057d3167b540df14c14c52adeda006079d366669bbb257f4d533a1227762"},{"name":"0030_public_route_context.sql","checksum":"b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36"},{"name":"0031_assessment_worker.sql","checksum":"ae4a5a5017046775147eaf562c90f234e23c47f28e90f11edd81ff94f7c60000"},{"name":"0032_public_fare_reports.sql","checksum":"b8b9d1d0d8136d9c477c3890bdfd52b93be1f81c2fce208978eeb2e05fb15f47"},{"name":"0033_prompt_refresh_worker.sql","checksum":"abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896"},{"name":"0034_route_place_observations.sql","checksum":"0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5"},{"name":"0035_route_place_reports.sql","checksum":"19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a"},{"name":"0036_pickup_question_api.sql","checksum":"e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86"},{"name":"0037_prompt_controls_api.sql","checksum":"0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0"},{"name":"0038_pickup_invitation_api.sql","checksum":"62c6215beeb1fff21a9bea934cea0b4906fec3c2c1f389b5c31f174c18af51e1"},{"name":"0039_admin_property_batches.sql","checksum":"09c61f1a7c5e4b1252f70243a8aacaf4f39669aef60193610250dc9697db2de5"},{"name":"0040_admin_route_visibility.sql","checksum":"4598a5a24c8e9c6b1203c44e9fb6ee7b1897ef03f51dd16f6ea1b2a843415a8d"},{"name":"0041_admin_core_corrections.sql","checksum":"aef318ebc5f6bf8408f95b9a503595b8b951d9a35e554a4b4e9a11850ee01248"},{"name":"0042_reviewed_recurring_calendars.sql","checksum":"f739406d5d8d10f7417547e37a356f20d8883ce760f9fe04e0820b9737d6850b"},{"name":"0043_staff_timetable_foundation.sql","checksum":"a8a5ed4aabf502d8c35e9ef98d69b507e5e310ce1044ed5652cf95bcd842dace"},{"name":"0044_private_timetable_commands.sql","checksum":"e0d2c96471a2edb3f8680a570b3c87ba397e670c59ace09c69338e19b405da30"},{"name":"0045_private_timetable_discovery.sql","checksum":"5809e352bddf763c8f5a50855c75e842dcab6feef021643008eb486135f0e0b4"},{"name":"0046_timetable_public_adapters.sql","checksum":"038d3e685819b9ab4bb38c37621aef904b3a90f1e1e91f340b3213e87a635992"},{"name":"0047_timetable_management.sql","checksum":"cea55115285049a8685f985430416df9d9c540dc077b8f70ff2b3f44be4a8a24"}]'::jsonb;entry jsonb;f text;spec record;sql text;complete boolean;fixture boolean;
BEGIN
 fixture:=current_database()~'^mabhazi_intake_test_[a-f0-9]{32}$' AND current_setting('mabhazi.activation_fixture',true)='ci-only';
 IF NOT coalesce(fixture,false) AND NOT EXISTS(SELECT 1 FROM public.users u JOIN public.v2_review_roles r ON r.user_id=u.id
 WHERE u.id='acf85881-cf70-4db1-84d0-c7c6c2df5f76' AND u.email='tawongatsokodayi@gmail.com' AND r.role='administrator' AND r.revoked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=u.id)) THEN RAISE EXCEPTION 'timetable_preview_identity_mismatch';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(baseline) x(name text,checksum text) LEFT JOIN mabhazi_migrations.applied a USING(name) WHERE a.checksum IS DISTINCT FROM x.checksum)
 OR EXISTS(SELECT 1 FROM mabhazi_migrations.applied a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE e->>'name'=a.name AND e->>'checksum'=a.checksum))
 THEN RAISE EXCEPTION 'timetable_preview_ledger_changed';END IF;
 complete:=(SELECT count(*)=48 FROM mabhazi_migrations.applied);
 IF NOT complete THEN
 IF (SELECT count(*) FROM mabhazi_migrations.applied)<>42 OR to_regclass('public.v2_admin_timetables') IS NOT NULL
 OR to_regclass('public.v2_admin_timetable_commands') IS NOT NULL OR to_regprocedure('public.v2_api_public_timetable_reports()') IS NOT NULL
 THEN RAISE EXCEPTION 'timetable_preview_partial_or_unrecorded';END IF;
 EXECUTE $baseline_guard$DO $verify_core$ DECLARE spec jsonb;fn record;relation text;BEGIN FOR spec IN SELECT value FROM jsonb_array_elements('[{"name":"v2_admin_require","signature":"public.v2_admin_require(varchar)","returns":"void","backend":false,"definer":false,"volatility":"v","hash":"2f08be4a4d9f2dfbea63d541f43a2a6ac8a69e1669e2e61332ca860a4cf0dae2"},{"name":"v2_admin_history_guard","signature":"public.v2_admin_history_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"62b6d6e428ccb2e0a566454998eba1a43876ea9a66ea6933dbb02a1b324bf5b3"},{"name":"v2_api_admin_batch_receipt","signature":"public.v2_api_admin_batch_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"93ff8c60129278813fe18bf0372d1139a387fafbecc36b714c4bfcce25f72477"},{"name":"v2_api_admin_property_batch","signature":"public.v2_api_admin_property_batch(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"695af4d6fe7255bc7c772a853c1df9f82d38e597043eff30eb6fe8e242224dd9"},{"name":"v2_admin_route_action_guard","signature":"public.v2_admin_route_action_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"16d96eb3b83b8799174108b2ea0d43c7ea432fbf22f5c27749907dcd0c3bc458"},{"name":"v2_admin_route_action_propagate","signature":"public.v2_admin_route_action_propagate()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"8602707d14654207b2fca989c6a495d736c456fcedc4b8f09cb38487fb4f79bd"},{"name":"v2_api_admin_route_action_receipt","signature":"public.v2_api_admin_route_action_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"b027e3d173f5dff5d09ce58363e69259c678a1858fb46a93e787fcbf7a7a4a59"},{"name":"v2_api_admin_route_action","signature":"public.v2_api_admin_route_action(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"a1c7976dd6394610760f002fdf6b9d77eed6101b4d2a4e34b91e5fe8599dbc4a"},{"name":"v2_prompt_eligible","signature":"public.v2_prompt_eligible(uuid,varchar,text[])","returns":"boolean","backend":false,"definer":false,"volatility":"s","hash":"42fcacaaf504ed63324a8cafa31fb84cbc58feea59608bb96b8f4f91c8595afc"},{"name":"v2_submit_actual_journey","signature":"public.v2_submit_actual_journey(varchar,text,jsonb)","returns":"jsonb","backend":false,"definer":true,"volatility":"v","hash":"f5db4b2b5dd243719a1727a1045ab2c9d7681330a369b7f7d808c57de66f40fa"},{"name":"v2_api_route_report_action","signature":"public.v2_api_route_report_action(varchar,uuid,text,text)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"b33124e19098533b34e0cee473585282ad2f4167421478c19a6d9792cb5a4048"},{"name":"v2_api_route_contribution_context","signature":"public.v2_api_route_contribution_context(varchar,uuid,varchar[])","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"49a3ba461588b2bd8ddfa3a36666538ee292e927dfed9301eeaa8e93cf39eb53"},{"name":"v2_admin_core_guard","signature":"public.v2_admin_core_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"416788246f696908aefa4b1244a04aeec0523aa2f1eddd62d271b558b5cb8f79"},{"name":"v2_admin_core_propagate","signature":"public.v2_admin_core_propagate()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"e581e8a194d7e203106df9d9938941e44cc98549f4cf2c3eed2179fa4bc5faed"},{"name":"v2_admin_core_dependency_count","signature":"public.v2_admin_core_dependency_count(uuid)","returns":"integer","backend":false,"definer":false,"volatility":"s","hash":"20f16d1db343df6aa94e0b83c829f3c897412d60cd6d9ad2c386903c2f1b5ab7"},{"name":"v2_admin_core_link_guard","signature":"public.v2_admin_core_link_guard()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"25e213d1b2661c3b2bb3701ccb42e9282abd06d62a63aef02b2a7084b7cd39a9"},{"name":"v2_api_admin_core_receipt","signature":"public.v2_api_admin_core_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"5d03c12ceffea9dd70b0824f68a0cfa5da1139829228e42787791cbe77bd7fcc"},{"name":"v2_api_admin_core_action","signature":"public.v2_api_admin_core_action(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"f8057c0679516fdd7c6b58349775ab9cb443dbebbf315316adde9d922ed31789"}]'::jsonb) LOOP
 SELECT * INTO fn FROM pg_proc WHERE oid=to_regprocedure(spec->>'signature');
 IF NOT FOUND OR fn.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR fn.prosecdef IS DISTINCT FROM (spec->>'definer')::boolean OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
  OR fn.provolatile::text<>spec->>'volatility' OR fn.prorettype<>to_regtype(spec->>'returns')
  OR encode(sha256(convert_to(replace(fn.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>spec->>'hash'
  OR has_function_privilege('mabhazi_api',fn.oid,'EXECUTE') IS DISTINCT FROM (spec->>'backend')::boolean
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,fn.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'core_function_fence_changed: %',spec->>'signature';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch','v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action','v2_prompt_eligible','v2_submit_actual_journey','v2_api_route_report_action','v2_api_route_contribution_context','v2_admin_core_guard','v2_admin_core_propagate','v2_admin_core_dependency_count','v2_admin_core_link_guard','v2_api_admin_core_receipt','v2_api_admin_core_action'])
  AND oid<>ALL(ARRAY['public.v2_admin_require(varchar)'::regprocedure,'public.v2_admin_history_guard()'::regprocedure,'public.v2_api_admin_batch_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_property_batch(varchar,uuid,jsonb)'::regprocedure,'public.v2_admin_route_action_guard()'::regprocedure,'public.v2_admin_route_action_propagate()'::regprocedure,'public.v2_api_admin_route_action_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_route_action(varchar,uuid,jsonb)'::regprocedure,'public.v2_prompt_eligible(uuid,varchar,text[])'::regprocedure,'public.v2_submit_actual_journey(varchar,text,jsonb)'::regprocedure,'public.v2_api_route_report_action(varchar,uuid,text,text)'::regprocedure,'public.v2_api_route_contribution_context(varchar,uuid,varchar[])'::regprocedure,'public.v2_admin_core_guard()'::regprocedure,'public.v2_admin_core_propagate()'::regprocedure,'public.v2_admin_core_dependency_count(uuid)'::regprocedure,'public.v2_admin_core_link_guard()'::regprocedure,'public.v2_api_admin_core_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_core_action(varchar,uuid,jsonb)'::regprocedure])) THEN RAISE EXCEPTION 'core_unexpected_overload';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.v2_admin_core_actions'::regclass AND relrowsecurity AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.v2_admin_core_actions'::regclass AND attnum>0 AND NOT attisdropped)
   IS DISTINCT FROM ARRAY['id','position','actor_user_id','contribution_id','route_subject_id','request_digest','operation','field_key','proposed_value','corrected_city_id','knowledge_basis','observed_date','reason_code','expected_revision','reversed_action_id','outcome','created_at']
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.v2_admin_core_actions'::regclass AND attname='corrected_city_id' AND attgenerated='s')
 THEN RAISE EXCEPTION 'core_table_shape_changed';END IF;
 FOREACH relation IN ARRAY ARRAY['v2_admin_batches','v2_admin_batch_items','v2_admin_core_threads','v2_admin_route_actions','v2_admin_active_route_removals','v2_admin_core_actions','v2_admin_current_core','v2_public_core_source_reports','v2_public_reviewed_lead_reports'] LOOP
  IF NOT has_table_privilege('mabhazi_api','public.'||relation,'SELECT')
   OR has_table_privilege('mabhazi_api','public.'||relation,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR EXISTS(SELECT 1 FROM aclexplode((SELECT coalesce(relacl,acldefault('r',relowner)) FROM pg_class WHERE oid=to_regclass('public.'||relation))) a WHERE a.grantee=0)
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_table_privilege(r.oid,to_regclass('public.'||relation),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  THEN RAISE EXCEPTION 'core_relation_fence_changed: %',relation;END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||relation) AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
   AND (relkind<>'r' OR relrowsecurity)) THEN RAISE EXCEPTION 'core_relation_owner_changed: %',relation;END IF;
 END LOOP;
 EXECUTE $expected_core_source_expected$CREATE TEMPORARY VIEW core_source_expected AS SELECT l.subject_id,s.revision,c.user_id AS author_user_id,corridor.origin_city_id,corridor.destination_city_id,
 jsonb_build_object('id',origin.id,'name',origin.name,'placeType',origin.place_type) AS origin,
 jsonb_build_object('id',destination.id,'name',destination.name,'placeType',destination.place_type) AS destination,
 jsonb_build_object('value',COALESCE(op.value->>'name',operator.display_name),'support','reported','freshness','unknown','submittedAt',op.submitted_at,
   'observedDate',op.observed_from) AS operator_report,
 jsonb_build_object('value',clock.value->>'time','basis',clock.value->>'basis','support','reported','freshness','unknown','submittedAt',clock.submitted_at,
   'observedDate',clock.observed_from) AS reported_time  FROM public.v2_leads l
 JOIN public.v2_subjects s ON s.id=l.subject_id AND s.kind='lead' AND s.lifecycle='active'
 JOIN public.v2_contributions c ON c.id=l.initial_contribution_id AND c.original_subject_id=l.subject_id
 JOIN public.users author ON author.id=c.user_id
 JOIN public.v2_corridors corridor ON corridor.id=l.corridor_id
 JOIN public.cities origin ON origin.id=corridor.origin_city_id
 JOIN public.cities destination ON destination.id=corridor.destination_city_id
 JOIN public.v2_observations op ON op.contribution_id=c.id AND op.original_subject_id=l.subject_id AND op.field_key='operator.reported'
 JOIN public.v2_observation_states op_state ON op_state.observation_id=op.id AND op_state.status='active'
 JOIN public.v2_observation_targets op_target ON op_target.observation_id=op.id AND op_target.assignment_id IS NULL
 JOIN public.v2_observations clock ON clock.contribution_id=c.id AND clock.original_subject_id=l.subject_id AND clock.field_key='departure.reported'
 JOIN public.v2_observation_states clock_state ON clock_state.observation_id=clock.id AND clock_state.status='active'
 JOIN public.v2_observation_targets clock_target ON clock_target.observation_id=clock.id AND clock_target.assignment_id IS NULL
 LEFT JOIN public.v2_operators operator ON operator.subject_id=l.operator_subject_id
 LEFT JOIN public.v2_subjects operator_subject ON operator_subject.id=operator.subject_id
 WHERE l.intake_kind='community' AND NOT l.attribution_erased
 AND (l.operator_subject_id IS NULL OR operator_subject.lifecycle='active')
 AND op.scope='{}'::jsonb AND clock.scope='{}'::jsonb
 AND op.value=CASE WHEN l.operator_name IS NOT NULL THEN jsonb_build_object('name',l.operator_name) ELSE jsonb_build_object('id',l.operator_subject_id) END
 AND l.reported_departure_seconds%60=0
 AND clock.value->>'time'=lpad((l.reported_departure_seconds/3600)::text,2,'0')||':'||lpad(((l.reported_departure_seconds%3600)/60)::text,2,'0')
 AND NOT EXISTS(SELECT 1 FROM public.v2_observations extra WHERE extra.contribution_id=c.id AND extra.field_key IN ('operator.reported','departure.reported') AND extra.id NOT IN(op.id,clock.id))
 AND NOT EXISTS(SELECT 1 FROM public.v2_current_fields current_field JOIN public.v2_field_decisions decision ON decision.id=current_field.field_decision_id
   WHERE current_field.subject_id=l.subject_id AND current_field.field_key IN('operator.reported','departure.reported')
   AND (decision.invalidated OR decision.erased OR decision.review_blocked OR decision.publication='withheld' OR decision.dispute_status='open'
     OR decision.selected_value IS DISTINCT FROM CASE current_field.field_key WHEN 'operator.reported' THEN op.value ELSE clock.value END))
 AND NOT EXISTS(SELECT 1 FROM public.v2_public_lead_hides h WHERE h.subject_id=l.subject_id)
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals h WHERE h.route_subject_id=l.subject_id);$expected_core_source_expected$;
 IF pg_get_viewdef('public.v2_public_core_source_reports'::regclass)<>pg_get_viewdef('pg_temp.core_source_expected'::regclass) THEN RAISE EXCEPTION 'core_view_changed: v2_public_core_source_reports';END IF;
 DROP VIEW pg_temp.core_source_expected;
EXECUTE $expected_core_expected_1$CREATE TEMPORARY VIEW core_expected_1 AS
 SELECT DISTINCT ON(a.route_subject_id,a.field_key) a.*
 FROM public.v2_admin_core_actions a WHERE a.outcome='corrected'
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_core_actions r WHERE r.reversed_action_id=a.id AND r.outcome='reversed')
 ORDER BY a.route_subject_id,a.field_key,a.position DESC;$expected_core_expected_1$;
 IF pg_get_viewdef('public.v2_admin_current_core'::regclass)<>pg_get_viewdef('pg_temp.core_expected_1'::regclass) THEN RAISE EXCEPTION 'core_view_changed: v2_admin_current_core';END IF;
 DROP VIEW pg_temp.core_expected_1;
EXECUTE $expected_core_expected_2$CREATE TEMPORARY VIEW core_expected_2 AS
 SELECT p.subject_id,p.revision,p.author_user_id,
  coalesce((origin_fix.proposed_value->>'cityId')::integer,p.origin_city_id) origin_city_id,
  coalesce((destination_fix.proposed_value->>'cityId')::integer,p.destination_city_id) destination_city_id,
  coalesce((SELECT jsonb_build_object('id',c.id,'name',c.name,'placeType',c.place_type) FROM public.cities c WHERE c.id=(origin_fix.proposed_value->>'cityId')::integer),p.origin) origin,
  coalesce((SELECT jsonb_build_object('id',c.id,'name',c.name,'placeType',c.place_type) FROM public.cities c WHERE c.id=(destination_fix.proposed_value->>'cityId')::integer),p.destination) destination,
  CASE WHEN operator_fix.id IS NULL THEN p.operator_report ELSE p.operator_report||jsonb_build_object('value',operator_fix.proposed_value->>'name',
   'submittedAt',operator_fix.created_at,'observedDate',operator_fix.observed_date) END operator_report,
  CASE WHEN time_fix.id IS NULL THEN p.reported_time ELSE p.reported_time||jsonb_build_object('value',time_fix.proposed_value->>'time','basis',time_fix.proposed_value->>'basis',
   'submittedAt',time_fix.created_at,'observedDate',time_fix.observed_date) END reported_time,
  coalesce((SELECT jsonb_agg(jsonb_build_object('field',a.field_key,'reviewedAt',a.created_at,'basis',a.knowledge_basis,'observedDate',a.observed_date)
   ORDER BY a.field_key) FROM public.v2_admin_current_core a WHERE a.route_subject_id=p.subject_id),'[]'::jsonb) core_corrections
 FROM public.v2_public_core_source_reports p
 LEFT JOIN public.v2_admin_current_core origin_fix ON origin_fix.route_subject_id=p.subject_id AND origin_fix.field_key='route.origin'
 LEFT JOIN public.v2_admin_current_core destination_fix ON destination_fix.route_subject_id=p.subject_id AND destination_fix.field_key='route.destination'
 LEFT JOIN public.v2_admin_current_core operator_fix ON operator_fix.route_subject_id=p.subject_id AND operator_fix.field_key='operator.reported'
 LEFT JOIN public.v2_admin_current_core time_fix ON time_fix.route_subject_id=p.subject_id AND time_fix.field_key='departure.reported'
 WHERE NOT EXISTS(SELECT 1 FROM public.v2_admin_current_core a WHERE a.route_subject_id=p.subject_id
  AND (a.proposed_value IS NULL OR a.actor_user_id IS NULL OR a.contribution_id IS NULL));$expected_core_expected_2$;
 IF pg_get_viewdef('public.v2_public_reviewed_lead_reports'::regclass)<>pg_get_viewdef('pg_temp.core_expected_2'::regclass) THEN RAISE EXCEPTION 'core_view_changed: v2_public_reviewed_lead_reports';END IF;
 DROP VIEW pg_temp.core_expected_2;
EXECUTE $expected_core_expected_3$CREATE TEMPORARY VIEW core_expected_3 AS
 SELECT p.* FROM public.v2_public_core_source_reports p WHERE NOT EXISTS(
  SELECT 1 FROM public.v2_admin_current_core a WHERE a.route_subject_id=p.subject_id);$expected_core_expected_3$;
 IF pg_get_viewdef('public.v2_public_lead_reports'::regclass)<>pg_get_viewdef('pg_temp.core_expected_3'::regclass) THEN RAISE EXCEPTION 'core_view_changed: v2_public_lead_reports';END IF;
 DROP VIEW pg_temp.core_expected_3; END;$verify_core$;
$baseline_guard$;
 sql:=$timetable_migration_0$-- Reviewed recurring-calendar writer prerequisite for administrative timetables.
-- No new public/backend permissions, no timetable publication and no inference.
-- Existing reviewed proposals, exact snapshots, epochs and reversal are reused.
CREATE OR REPLACE FUNCTION public.v2_edit_snapshot(subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb; kind text; chosen_version integer;
BEGIN
 result:=public.v2_transport_snapshot(subject); kind:=result->>'kind';
 IF kind='pattern' THEN
  chosen_version:=(result->'data'->>'current_pattern_version')::integer;
  result:=result || jsonb_build_object('patternVersion',(SELECT to_jsonb(v) FROM public.v2_pattern_versions v WHERE pattern_subject_id=subject AND v.version=chosen_version),
   'patternStops',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY sequence) FROM public.v2_pattern_stops s WHERE pattern_subject_id=subject AND pattern_version=chosen_version),'[]'::jsonb));
 ELSIF kind='service_plan' THEN
  -- Include calendar contents, not just its UUID. A later metadata change must
  -- make the exact reviewed snapshot stale rather than change a live schedule.
  result:=result || jsonb_build_object('calendar',(SELECT to_jsonb(c) FROM public.v2_calendars c
   JOIN public.v2_service_plans p ON p.calendar_id=c.id WHERE p.subject_id=subject));
 ELSIF kind='run' THEN
  result:=result || jsonb_build_object('runStopTimes',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY pattern_sequence) FROM public.v2_run_stop_times t WHERE run_subject_id=subject),'[]'::jsonb));
 END IF;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.v2_edit_after(subject uuid,observation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb; data jsonb; o public.v2_observations; plan public.v2_service_plans; kind text; n integer; stops jsonb; meta jsonb; item jsonb; normalized public.v2_stops;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR o.original_subject_id IS DISTINCT FROM subject OR public.v2_observation_subject(observation) IS DISTINCT FROM subject THEN RAISE EXCEPTION 'v2_edit_observation_target_mismatch' USING ERRCODE='23514'; END IF;
 result:=public.v2_edit_snapshot(subject); data:=result->'data'; kind:=result->>'kind';
 IF kind='route' AND o.field_key='operator.identity' THEN
  IF NOT EXISTS(SELECT 1 FROM public.v2_operators p JOIN public.v2_subjects s ON s.id=p.subject_id AND s.lifecycle='active' WHERE p.subject_id=(o.value->>'id')::uuid) THEN
   RAISE EXCEPTION 'v2_edit_operator_inactive' USING ERRCODE='23514'; END IF;
  data:=data || jsonb_build_object('operator_subject_id',(o.value->>'id')::uuid);
 ELSIF kind='stop' AND o.field_key='stop.location' THEN
  -- No surveyed precision, parent hierarchy or invented exact coordinates.
  data:=data || jsonb_build_object('city_id',o.value->'cityId','name',o.value->'name','latitude',o.value->'latitude','longitude',o.value->'longitude','precision',o.value->'precision');
  SELECT * INTO normalized FROM jsonb_populate_record(NULL::public.v2_stops,data);
  data:=to_jsonb(normalized);
  IF normalized.latitude IS DISTINCT FROM (o.value->>'latitude')::numeric OR normalized.longitude IS DISTINCT FROM (o.value->>'longitude')::numeric THEN
   RAISE EXCEPTION 'v2_edit_coordinate_precision_loss' USING ERRCODE='23514'; END IF;
 ELSIF kind='service_plan' AND o.field_key='service.calendar' THEN
  -- This first writer accepts a bounded recurring calendar only. Explicit
  -- dates/exceptions remain represented as observations, never silently lost.
  IF NOT o.value ?& ARRAY['weekdays','startDate','endDate','timezone']
   OR o.value ?| ARRAY['dates','exceptions'] OR jsonb_typeof(o.value->'weekdays') IS DISTINCT FROM 'array'
   OR NOT public.v2_calendar_observation_valid(o.value)
   OR NOT EXISTS(SELECT 1 FROM public.v2_timezones WHERE name=o.value->>'timezone')
   THEN RAISE EXCEPTION 'v2_edit_complete_recurring_calendar_required' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM public.v2_runs WHERE service_plan_subject_id=subject)
   THEN RAISE EXCEPTION 'v2_edit_calendar_existing_runs_require_review' USING ERRCODE='23514';END IF;
  SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=subject;
  IF (o.value->>'startDate')::date IS NULL OR (o.value->>'endDate')::date IS NULL
   OR (o.value->>'startDate')::date<(plan.effective_from)
   OR (o.value->>'endDate')::date>(plan.effective_to)
   OR (o.effective_from IS NOT NULL AND (o.value->>'startDate')::date<o.effective_from)
   OR (o.effective_to IS NOT NULL AND (o.value->>'endDate')::date>o.effective_to)
   THEN RAISE EXCEPTION 'v2_edit_calendar_validity_mismatch' USING ERRCODE='23514';END IF;
  SELECT sum(1 << ((day#>>'{}')::integer-1))::integer INTO n FROM jsonb_array_elements(o.value->'weekdays') day;
  -- Observation UUID gives deterministic identity through preview/retry;
  -- creating the row happens only when its exact reviewed edit is applied.
  meta:=jsonb_build_object('id',o.id,'timezone',o.value->>'timezone',
   'start_date',(o.value->>'startDate')::date,'end_date',(o.value->>'endDate')::date,
   'weekdays',n,'coverage','recurring','revision',1);
  IF EXISTS(SELECT 1 FROM public.v2_calendars c WHERE c.id=o.id AND to_jsonb(c)<>meta)
   THEN RAISE EXCEPTION 'v2_edit_calendar_identity_conflict' USING ERRCODE='23514';END IF;
  data:=data || jsonb_build_object('calendar_id',o.id,'timezone',o.value->>'timezone');
  result:=result || jsonb_build_object('calendar',meta);
 ELSIF kind='run' AND o.field_key IN('departure.scheduled','arrival.scheduled') THEN
  SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=(data->>'service_plan_subject_id')::uuid;
  IF (o.scope ? 'timezone' AND o.scope->>'timezone' IS DISTINCT FROM plan.timezone)
   OR (o.scope ? 'calendarId' AND (o.scope->>'calendarId')::uuid IS DISTINCT FROM plan.calendar_id)
   OR (o.scope ? 'serviceDate' AND ((data->>'validity_from')::date IS DISTINCT FROM (o.scope->>'serviceDate')::date OR (data->>'validity_to')::date IS DISTINCT FROM (o.scope->>'serviceDate')::date))
   OR (o.scope ? 'effectiveFrom' AND ((data->>'validity_from')::date IS NULL OR (data->>'validity_from')::date<(o.scope->>'effectiveFrom')::date))
  OR (o.scope ? 'effectiveTo' AND ((data->>'validity_to')::date IS NULL OR (data->>'validity_to')::date>(o.scope->>'effectiveTo')::date))
  OR (o.effective_from IS NOT NULL AND ((data->>'validity_from')::date IS NULL OR (data->>'validity_from')::date<o.effective_from))
  OR (o.effective_to IS NOT NULL AND ((data->>'validity_to')::date IS NULL OR (data->>'validity_to')::date>o.effective_to)) THEN
   RAISE EXCEPTION 'v2_edit_scheduled_scope_mismatch' USING ERRCODE='23514'; END IF;
  data:=data || jsonb_build_object(CASE o.field_key WHEN 'departure.scheduled' THEN 'departure_seconds' ELSE 'arrival_seconds' END,o.value->'seconds');
 ELSIF kind='pattern' AND o.field_key='pattern.stops' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e WHERE e->'place'->>'stopId' IS NULL) THEN
   RAISE EXCEPTION 'v2_edit_resolved_stops_required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e LEFT JOIN public.v2_subjects s ON s.id=(e->'place'->>'stopId')::uuid WHERE s.kind IS DISTINCT FROM 'stop' OR s.lifecycle<>'active') THEN
   RAISE EXCEPTION 'v2_edit_stop_inactive' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(max(version),0)+1 INTO n FROM public.v2_pattern_versions WHERE pattern_subject_id=subject;
  SELECT jsonb_agg(jsonb_build_object('pattern_subject_id',subject,'pattern_version',n,'sequence',ordinality-1,'stop_subject_id',(e->'place'->>'stopId')::uuid,'pickup',e->'pickup','dropoff',e->'dropoff') ORDER BY ordinality)
   INTO stops FROM jsonb_array_elements(o.value->'stops') WITH ORDINALITY a(e,ordinality);
  IF (SELECT jsonb_agg(e-ARRAY['pattern_version','pattern_subject_id']) FROM jsonb_array_elements(stops) e)
   IS NOT DISTINCT FROM (SELECT jsonb_agg(e-ARRAY['pattern_version','pattern_subject_id']) FROM jsonb_array_elements(result->'patternStops') e)
   AND o.value->'stopsComplete' IS NOT DISTINCT FROM result->'patternVersion'->'stops_complete' THEN
   RAISE EXCEPTION 'v2_edit_no_change' USING ERRCODE='23514'; END IF;
  meta:=result->'patternVersion' || jsonb_build_object('version',n,'stops_complete',o.value->'stopsComplete','sealed',true);
  data:=data || jsonb_build_object('current_pattern_version',n);
  result:=result || jsonb_build_object('patternVersion',meta,'patternStops',stops);
 ELSE RAISE EXCEPTION 'v2_edit_field_writer_not_available' USING ERRCODE='23514'; END IF;
 result:=result || jsonb_build_object('data',data);
 IF result=public.v2_edit_snapshot(subject) THEN RAISE EXCEPTION 'v2_edit_no_change' USING ERRCODE='23514'; END IF;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.v2_write_edit_snapshot(subject uuid,snapshot jsonb,edit uuid,review uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE data jsonb:=snapshot->'data'; kind text:=snapshot->>'kind'; meta jsonb; chosen_version integer; item jsonb;
BEGIN
 IF kind='route' THEN UPDATE public.v2_routes SET operator_subject_id=(data->>'operator_subject_id')::uuid WHERE subject_id=subject;
 ELSIF kind='stop' THEN UPDATE public.v2_stops SET city_id=(data->>'city_id')::integer,name=data->>'name',latitude=(data->>'latitude')::numeric,longitude=(data->>'longitude')::numeric,precision=data->>'precision' WHERE subject_id=subject;
 ELSIF kind='service_plan' THEN
  meta:=snapshot->'calendar';
  IF EXISTS(SELECT 1 FROM public.v2_runs WHERE service_plan_subject_id=subject)
   AND EXISTS(SELECT 1 FROM public.v2_review_decisions WHERE id=review AND action='accept')
   THEN RAISE EXCEPTION 'v2_edit_calendar_existing_runs_require_review' USING ERRCODE='23514';END IF;
  IF meta<>'null'::jsonb THEN
   IF meta IS NULL OR meta->>'id' IS DISTINCT FROM data->>'calendar_id'
    OR meta->>'timezone' IS DISTINCT FROM data->>'timezone' OR meta->>'coverage'<>'recurring'
    THEN RAISE EXCEPTION 'v2_edit_calendar_snapshot_invalid' USING ERRCODE='23514';END IF;
   INSERT INTO public.v2_calendars(id,timezone,start_date,end_date,weekdays,coverage,revision)
    VALUES((meta->>'id')::uuid,meta->>'timezone',(meta->>'start_date')::date,(meta->>'end_date')::date,
     (meta->>'weekdays')::integer,meta->>'coverage',(meta->>'revision')::bigint) ON CONFLICT(id) DO NOTHING;
   IF NOT EXISTS(SELECT 1 FROM public.v2_calendars c WHERE c.id=(meta->>'id')::uuid AND to_jsonb(c)=meta)
    THEN RAISE EXCEPTION 'v2_edit_calendar_snapshot_changed' USING ERRCODE='40001';END IF;
  ELSIF data->>'calendar_id' IS NOT NULL THEN RAISE EXCEPTION 'v2_edit_calendar_snapshot_invalid' USING ERRCODE='23514';END IF;
  UPDATE public.v2_service_plans SET calendar_id=(data->>'calendar_id')::uuid,timezone=data->>'timezone' WHERE subject_id=subject;
 ELSIF kind='run' THEN UPDATE public.v2_runs SET departure_seconds=(data->>'departure_seconds')::integer,arrival_seconds=(data->>'arrival_seconds')::integer WHERE subject_id=subject;
 ELSIF kind='pattern' THEN
  meta:=snapshot->'patternVersion'; chosen_version:=(meta->>'version')::integer;
  IF NOT EXISTS(SELECT 1 FROM public.v2_pattern_versions WHERE pattern_subject_id=subject AND v2_pattern_versions.version=chosen_version) THEN
   INSERT INTO public.v2_pattern_versions(pattern_subject_id,version,effective_from,effective_to,stops_complete)
   VALUES(subject,chosen_version,(meta->>'effective_from')::date,(meta->>'effective_to')::date,(meta->>'stops_complete')::boolean);
   FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'patternStops') LOOP
    INSERT INTO public.v2_pattern_stops(pattern_subject_id,pattern_version,sequence,stop_subject_id,pickup,dropoff)
    VALUES(subject,chosen_version,(item->>'sequence')::integer,(item->>'stop_subject_id')::uuid,item->>'pickup',item->>'dropoff');
   END LOOP;
   UPDATE public.v2_pattern_versions SET sealed=true WHERE pattern_subject_id=subject AND v2_pattern_versions.version=chosen_version;
   INSERT INTO public.v2_pattern_version_origins VALUES(subject,chosen_version,edit,review);
  END IF;
  UPDATE public.v2_patterns SET current_pattern_version=chosen_version WHERE subject_id=subject;
 ELSE RAISE EXCEPTION 'v2_edit_writer_not_available' USING ERRCODE='23514'; END IF;
 -- Fail inside the mutation, even when the surrounding transaction deferred
 -- its constraints. Other deferred constraints still run normally at commit.
 IF kind='pattern' THEN PERFORM public.v2_assert_pattern(subject); END IF;
 IF kind='run' THEN PERFORM public.v2_assert_run(subject); END IF;
 IF public.v2_edit_snapshot(subject) IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'v2_edit_projection_does_not_match_approval' USING ERRCODE='23514'; END IF;
END; $$;

-- CREATE OR REPLACE preserves the original restrictive ACLs. Assert the three
-- raw helpers stay private even on installations with broader default grants.
DO $$ DECLARE r text;f text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_edit_snapshot(uuid)','public.v2_edit_after(uuid,uuid)','public.v2_write_edit_snapshot(uuid,jsonb,uuid,uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
 END LOOP;
END;$$;
$timetable_migration_0$;
 IF encode(sha256(convert_to(replace(sql,E'\r\n',E'\n'),'UTF8')),'hex')<>'f739406d5d8d10f7417547e37a356f20d8883ce760f9fe04e0820b9737d6850b' THEN RAISE EXCEPTION 'timetable_embedded_hash_changed';END IF;
 EXECUTE sql;
 INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0042_reviewed_recurring_calendars.sql','f739406d5d8d10f7417547e37a356f20d8883ce760f9fe04e0820b9737d6850b');
 sql:=$timetable_migration_1$-- Private timetable assembly foundation; no public/backend grants or publication.
-- Accept a legitimate reviewed calendar edit as the current plan while
-- retaining its exact initial creation proof and unchanged structural identity.
-- This is not publication, a stale-origin override or a general edit bypass.
CREATE FUNCTION public.v2_current_reviewed_creation(subject uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE original jsonb;current_edit jsonb;o public.v2_transport_creation_origins;p public.v2_transport_creations;s public.v2_subjects;
BEGIN
 SELECT * INTO s FROM public.v2_subjects WHERE id=subject;
 IF s.id IS NULL OR s.lifecycle<>'active' THEN RETURN false;END IF;
 original:=public.v2_read_created_subject(subject);
 IF original->>'status'='reviewed_origin' THEN RETURN true;END IF;
 IF s.kind<>'service_plan' THEN RETURN false;END IF;
 current_edit:=public.v2_read_transport(subject);
 IF current_edit->>'status' IS DISTINCT FROM 'reviewed' OR current_edit->>'fieldKey'<>'service.calendar'
  THEN RETURN false;END IF;
 SELECT * INTO o FROM public.v2_transport_creation_origins WHERE subject_id=subject;
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=o.creation_id;
 IF o.creation_id IS NULL OR o.erased OR p.erased OR NOT public.v2_creation_evidence_live(p.id)
  OR NOT public.v2_creation_dependencies_live(p.id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_transport_edit_heads h
   JOIN public.v2_transport_edits e ON e.id=h.edit_id AND e.subject_id=subject AND e.field_key='service.calendar' AND NOT e.erased
   JOIN public.v2_transport_edit_events applied ON applied.id=h.event_id AND applied.action='apply'
   JOIN public.v2_transport_edit_events approved ON approved.edit_id=e.id AND approved.action='review' AND approved.review_id=applied.review_id
   JOIN public.v2_transport_change_subjects changed ON changed.subject_id=subject AND changed.is_root
    AND changed.previous_revision=approved.resulting_revision AND changed.resulting_revision=applied.resulting_revision
    AND changed.previous_generation=approved.resulting_generation AND changed.resulting_generation=applied.resulting_generation
   JOIN public.v2_transport_changes cause ON cause.id=changed.change_id AND cause.source_table='v2_service_plans'
    AND cause.operation='UPDATE' AND cause.changed_columns<@ARRAY['calendar_id','timezone']::text[]
   JOIN public.v2_transport_creation_events invalidation ON invalidation.creation_id=p.id AND invalidation.action='invalidate' AND invalidation.cause_id=cause.id
   WHERE h.subject_id=subject AND (e.before_snapshot-'calendar')=o.snapshot)
  OR NOT EXISTS(SELECT 1 FROM public.v2_review_decisions d JOIN public.v2_review_cases c ON c.id=d.case_id
   WHERE d.id=o.review_id AND d.action='accept' AND NOT d.evidence_erased AND c.last_decision_id=d.id AND c.state='resolved')
  THEN RETURN false;END IF;
 -- Only the calendar and timezone may differ. An operator, pattern, mode or
 -- applicability change needs its own identity writer; it cannot inherit this.
 IF (o.snapshot->'data')-ARRAY['calendar_id','timezone'] IS DISTINCT FROM
  (current_edit->'snapshot'->'data')-ARRAY['calendar_id','timezone'] THEN RETURN false;END IF;
 RETURN COALESCE(current_edit->'snapshot'->'calendar'->>'id'=current_edit->'snapshot'->'data'->>'calendar_id'
  AND current_edit->'snapshot'->'calendar'->>'timezone'=current_edit->'snapshot'->'data'->>'timezone',false);
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_dependencies_live(creation uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;needed integer;actual integer;d record;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=creation;
 IF NOT FOUND OR p.erased THEN RETURN false;END IF;
 SELECT count(*) INTO needed FROM public.v2_creation_references(p.desired_snapshot);
 SELECT count(*) INTO actual FROM public.v2_transport_creation_dependencies WHERE creation_id=p.id;
 IF needed<>actual THEN RETURN false;END IF;
 FOR d IN SELECT dep.*,s.revision live_revision,s.input_generation live_generation,s.lifecycle,o.creation_id live_origin,o.event_id live_event
 FROM public.v2_transport_creation_dependencies dep JOIN public.v2_subjects s ON s.id=dep.subject_id AND s.kind=dep.subject_kind
 JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE dep.creation_id=p.id LOOP
  IF d.subject_revision<>d.live_revision OR d.input_generation<>d.live_generation OR d.lifecycle<>'active'
   OR d.origin_creation_id<>d.live_origin OR d.origin_event_id<>d.live_event
   OR NOT EXISTS(SELECT 1 FROM public.v2_creation_references(p.desired_snapshot) ref WHERE ref.subject_id=d.subject_id AND ref.subject_kind=d.subject_kind)
   OR NOT public.v2_current_reviewed_creation(d.subject_id) THEN RETURN false;END IF;
 END LOOP;
 RETURN actual=(SELECT count(*) FROM public.v2_transport_creation_dependencies dep JOIN public.v2_subjects s ON s.id=dep.subject_id AND s.kind=dep.subject_kind JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE dep.creation_id=p.id);
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_dependency_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_transport_creations p
  CROSS JOIN LATERAL public.v2_creation_references(p.desired_snapshot) ref JOIN public.v2_subjects s ON s.id=ref.subject_id AND s.kind=ref.subject_kind
  JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE p.id=NEW.creation_id AND ref.subject_id=NEW.subject_id AND ref.subject_kind=NEW.subject_kind
  AND s.revision=NEW.subject_revision AND s.input_generation=NEW.input_generation AND o.creation_id=NEW.origin_creation_id AND o.event_id=NEW.origin_event_id
  AND public.v2_current_reviewed_creation(s.id)) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_creation_dependency_immutable_or_invalid' USING ERRCODE='23514';
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_desired_parent(observation uuid,kind text,target uuid,parent uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE o public.v2_observations;data jsonb;source_operator uuid;route_operator uuid;corridor uuid;stops jsonb;version jsonb;origin_city integer;destination_city integer;pat public.v2_patterns;pv public.v2_pattern_versions;plan public.v2_service_plans;lower_date date;upper_date date;service_date date;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR target IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;
 IF kind='operator' AND o.field_key='operator.reported' AND o.value ? 'name' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','operator','display_name',o.value->'name','country_code',NULL,'affiliation_status','unverified');
 ELSIF kind='stop' AND o.field_key IN('boarding.pickup','alighting.dropoff') AND o.value ?& ARRAY['cityId','name'] AND NOT o.value ? 'stopId' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','stop','city_id',o.value->'cityId','name',o.value->'name','parent_stop_id',NULL,'latitude',NULL,'longitude',NULL,'precision','named_place');
 ELSIF kind='route' AND o.field_key IN('operator.reported','operator.identity') AND o.value ? 'id' THEN
  IF public.v2_read_created_subject((o.value->>'id')::uuid)->>'status' IS DISTINCT FROM 'reviewed_origin' THEN RAISE EXCEPTION 'v2_creation_reviewed_operator_required' USING ERRCODE='23514';END IF;
  source_operator:=COALESCE(public.v2_resolved_operator(o.original_subject_id),(SELECT public.v2_resolved_operator(a.matched_run_subject_id) FROM public.v2_actual_journeys a WHERE a.subject_id=o.original_subject_id AND a.association_status='matched'));
  IF source_operator IS NOT NULL AND source_operator<>(o.value->>'id')::uuid THEN RAISE EXCEPTION 'v2_creation_source_operator_conflict' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','route','operator_subject_id',(o.value->>'id')::uuid,'public_name',NULL,'public_code',NULL);
 ELSIF kind='pattern' AND o.field_key='pattern.stops' AND parent IS NOT NULL THEN
  IF public.v2_read_created_subject(parent)->>'status' IS DISTINCT FROM 'reviewed_origin' OR NOT EXISTS(SELECT 1 FROM public.v2_routes WHERE subject_id=parent) THEN RAISE EXCEPTION 'v2_creation_reviewed_route_required' USING ERRCODE='23514';END IF;
  SELECT operator_subject_id INTO route_operator FROM public.v2_routes WHERE subject_id=parent;
  source_operator:=public.v2_resolved_operator(o.original_subject_id);corridor:=public.v2_subject_corridor(o.original_subject_id);
  IF corridor IS NULL OR (source_operator IS NOT NULL AND source_operator<>route_operator)
   OR (source_operator IS NULL AND NOT EXISTS(SELECT 1 FROM public.v2_transport_creations p JOIN public.v2_transport_creation_origins r ON r.creation_id=p.id WHERE r.subject_id=parent AND p.source_subject_id=o.original_subject_id)) THEN RAISE EXCEPTION 'v2_creation_pattern_identity_context_required' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e WHERE e->'place'->>'stopId' IS NULL OR public.v2_read_created_subject((e->'place'->>'stopId')::uuid)->>'status' IS DISTINCT FROM 'reviewed_origin'
   OR NOT EXISTS(SELECT 1 FROM public.v2_stops WHERE subject_id=(e->'place'->>'stopId')::uuid)) THEN RAISE EXCEPTION 'v2_creation_reviewed_stops_required' USING ERRCODE='23514';END IF;
  SELECT jsonb_agg(jsonb_build_object('pattern_subject_id',target,'pattern_version',1,'sequence',ordinality-1,'stop_subject_id',(e->'place'->>'stopId')::uuid,'pickup',e->'pickup','dropoff',e->'dropoff') ORDER BY ordinality)
   INTO stops FROM jsonb_array_elements(o.value->'stops') WITH ORDINALITY a(e,ordinality);
  SELECT origin_city_id,destination_city_id INTO origin_city,destination_city FROM public.v2_corridors WHERE id=corridor;
  IF (o.value->>'stopsComplete')::boolean AND ((SELECT city_id FROM public.v2_stops WHERE subject_id=(stops->0->>'stop_subject_id')::uuid) IS DISTINCT FROM origin_city
   OR (SELECT city_id FROM public.v2_stops WHERE subject_id=(stops->(jsonb_array_length(stops)-1)->>'stop_subject_id')::uuid) IS DISTINCT FROM destination_city) THEN RAISE EXCEPTION 'v2_creation_complete_pattern_endpoints_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','pattern','route_subject_id',parent,'corridor_id',corridor,'current_pattern_version',1,'current_version_sealed',true);
  version:=jsonb_build_object('pattern_subject_id',target,'version',1,'effective_from',o.effective_from,'effective_to',o.effective_to,'stops_complete',o.value->'stopsComplete','sealed',true);
  RETURN jsonb_build_object('kind','pattern','data',data,'patternVersion',version,'patternStops',stops);
 ELSIF kind='service_plan' AND o.field_key='service.mode' AND parent IS NOT NULL THEN
  PERFORM public.v2_creation_pattern_context(o.original_subject_id,parent);
  SELECT * INTO pat FROM public.v2_patterns WHERE subject_id=parent;
  SELECT v.* INTO pv FROM public.v2_pattern_versions v WHERE v.pattern_subject_id=parent AND v.version=pat.current_pattern_version AND v.sealed;
  IF pv.pattern_subject_id IS NULL THEN RAISE EXCEPTION 'v2_creation_sealed_pattern_required' USING ERRCODE='23514';END IF;
  lower_date:=o.effective_from;upper_date:=o.effective_to;
  IF lower_date>upper_date OR lower_date<pv.effective_from OR upper_date>pv.effective_to OR upper_date<pv.effective_from OR lower_date>pv.effective_to THEN RAISE EXCEPTION 'v2_creation_service_validity_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','service_plan','pattern_subject_id',parent,'pattern_version',pat.current_pattern_version,'pattern_sealed',true,'mode',o.value->'mode','calendar_id',NULL,'timezone',NULL,'effective_from',lower_date,'effective_to',upper_date,'boarding_instructions',NULL);
 ELSIF kind='run' AND o.field_key='departure.scheduled' AND parent IS NOT NULL THEN
  SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=parent;
  IF plan.subject_id IS NULL OR plan.mode<>'fixed_time' OR NOT public.v2_current_reviewed_creation(parent) THEN RAISE EXCEPTION 'v2_creation_reviewed_fixed_plan_required' USING ERRCODE='23514';END IF;
  PERFORM public.v2_creation_pattern_context(o.original_subject_id,plan.pattern_subject_id);
  IF EXISTS(SELECT 1 FROM public.v2_runs r WHERE r.subject_id=o.original_subject_id AND r.service_plan_subject_id<>parent) THEN RAISE EXCEPTION 'v2_creation_run_plan_context_mismatch' USING ERRCODE='23514';END IF;
  IF (o.scope->>'timezone' IS NOT NULL AND o.scope->>'timezone' IS DISTINCT FROM plan.timezone)
   OR (o.scope->>'calendarId' IS NOT NULL AND (o.scope->>'calendarId')::uuid IS DISTINCT FROM plan.calendar_id) THEN RAISE EXCEPTION 'v2_creation_run_temporal_context_mismatch' USING ERRCODE='23514';END IF;
  SELECT v.* INTO pv FROM public.v2_pattern_versions v WHERE v.pattern_subject_id=plan.pattern_subject_id AND v.version=plan.pattern_version AND v.sealed;
  IF pv.pattern_subject_id IS NULL THEN RAISE EXCEPTION 'v2_creation_sealed_pattern_required' USING ERRCODE='23514';END IF;
  lower_date:=greatest(o.effective_from,(o.scope->>'effectiveFrom')::date);
  upper_date:=least(o.effective_to,(o.scope->>'effectiveTo')::date);service_date:=(o.scope->>'serviceDate')::date;
  IF lower_date>upper_date OR service_date<lower_date OR service_date>upper_date THEN RAISE EXCEPTION 'v2_creation_service_validity_disjoint' USING ERRCODE='23514';END IF;
  IF service_date IS NOT NULL THEN lower_date:=service_date;upper_date:=service_date;END IF;
  IF (greatest(plan.effective_from,pv.effective_from) IS NOT NULL AND (lower_date IS NULL OR lower_date<greatest(plan.effective_from,pv.effective_from)))
   OR (least(plan.effective_to,pv.effective_to) IS NOT NULL AND (upper_date IS NULL OR upper_date>least(plan.effective_to,pv.effective_to))) THEN RAISE EXCEPTION 'v2_creation_run_parent_validity_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','run','service_plan_subject_id',parent,'plan_mode','fixed_time','pattern_subject_id',plan.pattern_subject_id,'pattern_version',plan.pattern_version,'departure_seconds',o.value->'seconds','arrival_seconds',NULL,'run_label',NULL,'validity_from',lower_date,'validity_to',upper_date);
  RETURN jsonb_build_object('kind','run','data',data,'runStopTimes','[]'::jsonb);
 ELSE RAISE EXCEPTION 'v2_creation_kind_or_named_evidence_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('kind',kind,'data',data);
END;$$;

DO $$ DECLARE r text;BEGIN
 REVOKE ALL ON FUNCTION public.v2_current_reviewed_creation(uuid) FROM PUBLIC,mabhazi_api;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_current_reviewed_creation(uuid) FROM %I',r);END IF;
 END LOOP;
END;$$;


-- Draft component for the atomic timetable facade. Not a standalone migration;
-- no public/backend EXECUTE permission. Caller already holds named admin/account
-- and transport locks. Source records never enter traveller-facing lead lists.
ALTER TABLE public.v2_leads DROP CONSTRAINT v2_leads_intake_kind_check;
ALTER TABLE public.v2_leads ADD CONSTRAINT v2_leads_intake_kind_check CHECK(intake_kind IN('community','legacy','staff'));

CREATE FUNCTION public.v2_timetable_source(actor varchar,command uuid,proposal jsonb,operator_value jsonb,source uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE subject uuid:=gen_random_uuid();contribution uuid:=gen_random_uuid();corridor uuid;clock text;basis text;observed date;payload jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF command IS NULL OR source IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=source AND owner_user_id=actor)
  OR NOT public.v2_intake_observation_valid('operator.reported',operator_value,'{}')
  THEN RAISE EXCEPTION 'v2_timetable_source_invalid' USING ERRCODE='23514';END IF;
 clock:=proposal->'departures'->0->>'departure';
 IF clock IS NULL OR clock!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
  THEN RAISE EXCEPTION 'v2_timetable_source_clock_required' USING ERRCODE='23514';END IF;
 basis:=CASE proposal->'source'->>'kind' WHEN 'published_timetable' THEN 'observed_sign' WHEN 'operator_confirmation' THEN 'operator_statement' END;
 IF basis IS NULL THEN RAISE EXCEPTION 'v2_timetable_source_basis_required' USING ERRCODE='23514';END IF;
 observed:=(proposal->'source'->>'checkedOn')::date;
 INSERT INTO public.v2_corridors(origin_city_id,destination_city_id)
  VALUES((proposal->>'originCityId')::integer,(proposal->>'destinationCityId')::integer)
  ON CONFLICT(origin_city_id,destination_city_id) DO NOTHING;
 SELECT id INTO corridor FROM public.v2_corridors WHERE origin_city_id=(proposal->>'originCityId')::integer AND destination_city_id=(proposal->>'destinationCityId')::integer;
 payload:=jsonb_build_object('schemaVersion','1.0','entrySurface','reviewer_context','timetableCommandId',command,
  'target',jsonb_build_object('newLead',jsonb_build_object('originCityId',proposal->'originCityId',
   'destinationCityId',proposal->'destinationCityId','departureTime',clock,'operator',operator_value)),
  'leadContext',jsonb_build_object('knowledgeBasis',basis,'timeBasis','scheduled','observedDate',observed),
  'observations','[]'::jsonb,'proposal',proposal,'sourceId',source);
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_lead_subtype,public.v2_lead_initial_contribution DEFERRED;
 INSERT INTO public.v2_subjects(id,kind) VALUES(subject,'lead');
 INSERT INTO public.v2_leads(subject_id,intake_kind,corridor_id,reported_departure_seconds,operator_subject_id,operator_name,initial_contribution_id)
  VALUES(subject,'staff',corridor,substring(clock,1,2)::integer*3600+substring(clock,4,2)::integer*60,
   (operator_value->>'id')::uuid,operator_value->>'name',contribution);
 INSERT INTO public.v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
  VALUES(contribution,actor,gen_random_uuid(),'1.0','reviewer_context',public.v2_assessment_hash(payload),payload,subject);
 INSERT INTO public.v2_subject_revisions(subject_id,subject_kind,revision,snapshot,origin_kind,initial_contribution_id)
  VALUES(subject,'lead',1,public.v2_transport_snapshot(subject),'contribution',contribution);
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_lead_subtype,public.v2_lead_initial_contribution IMMEDIATE;
 INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
  SELECT contribution,subject,f,v,'{}',public.v2_assessment_hash('{}'),public.v2_assessment_hash(v),basis,observed
  FROM (VALUES('operator.reported',operator_value),('departure.reported',jsonb_build_object('time',clock,'basis','scheduled'))) core(f,v);
 INSERT INTO public.v2_observation_sources(observation_id,source_id,relation)
  SELECT id,source,'cites' FROM public.v2_observations WHERE contribution_id=contribution;
 -- These are controlled assembly records, not public submissions to normalise.
 -- Native reviewed constructors/edits enqueue their existing dependent jobs.
 RETURN jsonb_build_object('subjectId',subject,'contributionId',contribution);
END;$$;

CREATE FUNCTION public.v2_timetable_observation(actor varchar,subject uuid,command uuid,source uuid,
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
   (proposal->'source'->>'checkedOn')::date,(proposal->>'validFrom')::date,(proposal->>'validUntil')::date) RETURNING id INTO observation;
 INSERT INTO public.v2_observation_sources(observation_id,source_id,relation) VALUES(observation,source,'cites');
 RETURN observation;
END;$$;

CREATE FUNCTION public.v2_timetable_create(actor varchar,source uuid,observation uuid,kind text,parent uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p uuid;review uuid;expected bigint;parent_expected bigint;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT revision INTO expected FROM public.v2_subjects WHERE id=source;
 IF parent IS NULL THEN
  p:=public.v2_propose_transport_creation(actor,source,expected,observation,kind,gen_random_uuid());
 ELSE
  SELECT revision INTO parent_expected FROM public.v2_subjects WHERE id=parent;
  p:=public.v2_propose_transport_creation_context(actor,source,expected,observation,kind,parent,parent_expected,gen_random_uuid());
 END IF;
 review:=public.v2_review_transport_creation(actor,p,1,(SELECT revision FROM public.v2_subjects WHERE id=source),
  'accept','timetable_source_checked',NULL,gen_random_uuid());
 PERFORM public.v2_apply_transport_creation(actor,p,review,gen_random_uuid());
 RETURN (SELECT target_subject_id FROM public.v2_transport_creations WHERE id=p);
END;$$;

CREATE FUNCTION public.v2_timetable_edit(actor varchar,subject uuid,observation uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE edit uuid;review uuid;
BEGIN
 PERFORM public.v2_admin_require(actor);
 edit:=public.v2_propose_transport_edit(actor,subject,(SELECT revision FROM public.v2_subjects WHERE id=subject),observation,gen_random_uuid());
 review:=public.v2_review_transport_edit(actor,edit,1,(SELECT revision FROM public.v2_subjects WHERE id=subject),'accept','timetable_source_checked',NULL,gen_random_uuid());
 PERFORM public.v2_apply_transport_edit(actor,edit,review,gen_random_uuid());
 RETURN review;
END;$$;

DO $$ DECLARE r text;f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
  ('v2_timetable_source','v2_timetable_observation','v2_timetable_create','v2_timetable_edit') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;
  END LOOP;
 END LOOP;
END;$$;
$timetable_migration_1$;
 IF encode(sha256(convert_to(replace(sql,E'\r\n',E'\n'),'UTF8')),'hex')<>'a8a5ed4aabf502d8c35e9ef98d69b507e5e310ce1044ed5652cf95bcd842dace' THEN RAISE EXCEPTION 'timetable_embedded_hash_changed';END IF;
 EXECUTE sql;
 INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0043_staff_timetable_foundation.sql','a8a5ed4aabf502d8c35e9ef98d69b507e5e310ce1044ed5652cf95bcd842dace');
 sql:=$timetable_migration_2$-- Private atomic timetable commands. No backend/public grants; not a public reader.
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

-- A new citation changes its observation's footprint, not the footprints of
-- every earlier observation citing that source. Recompute its actual targets
-- and advance the graph fence. Source identity changes and deletions still
-- invalidate the whole connected component through the existing path.
-- Without this distinction, adding an arrival from the same document advances
-- an unchanged parent plan's epoch and invalidates an already reviewed run.
CREATE OR REPLACE FUNCTION public.v2_source_citation_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM public.v2_source_changed(ARRAY[]::uuid[],ARRAY[NEW.observation_id],false);RETURN NEW;
 ELSE
  PERFORM public.v2_source_changed(ARRAY[OLD.source_id],ARRAY[OLD.observation_id],true);RETURN OLD;
 END IF;
END;$$;
REVOKE ALL ON FUNCTION public.v2_source_citation_changed() FROM PUBLIC,mabhazi_api;
DO $$ DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_source_citation_changed() FROM %I',r);END IF;
 END LOOP;
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
CREATE FUNCTION public.v2_timetable_forget_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.users WHERE id=OLD.owner_user_id) THEN
  UPDATE public.v2_admin_timetables SET proposal=NULL,request_digest=NULL,erased=true
   WHERE actor_user_id=OLD.owner_user_id AND NOT erased AND id IN(
    SELECT CASE WHEN public.v2_json_uuid(c.payload->'timetableCommandId') THEN (c.payload->>'timetableCommandId')::uuid END
    FROM public.v2_observation_sources os JOIN public.v2_observations o ON o.id=os.observation_id
    JOIN public.v2_contributions c ON c.id=o.contribution_id WHERE os.source_id=OLD.id);
 END IF;
 RETURN OLD;
END;$$;
CREATE TRIGGER aa_timetable_forget_source BEFORE DELETE ON public.v2_sources FOR EACH ROW EXECUTE FUNCTION public.v2_timetable_forget_source();
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
 REVOKE ALL ON FUNCTION public.v2_timetable_forget_source() FROM PUBLIC,mabhazi_api;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.v2_timetable_history_guard() FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.v2_timetable_forget_payload() FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.v2_timetable_forget_source() FROM %I',r);
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
 IF s.kind='run' THEN RETURN (o.snapshot-'data')=((current_edit->'snapshot')-'data');END IF;
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
$timetable_migration_2$;
 IF encode(sha256(convert_to(replace(sql,E'\r\n',E'\n'),'UTF8')),'hex')<>'e0d2c96471a2edb3f8680a570b3c87ba397e670c59ace09c69338e19b405da30' THEN RAISE EXCEPTION 'timetable_embedded_hash_changed';END IF;
 EXECUTE sql;
 INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0044_private_timetable_commands.sql','e0d2c96471a2edb3f8680a570b3c87ba397e670c59ace09c69338e19b405da30');
 sql:=$timetable_migration_3$-- Private timetable discovery and registered-source restorable management.
-- No new grants; source-only until full public/client adapters are installed.
ALTER TABLE public.v2_admin_timetable_entries ADD CONSTRAINT v2_timetable_unique_source UNIQUE(source_subject_id);
CREATE OR REPLACE FUNCTION public.v2_transport_dependents(roots uuid[]) RETURNS uuid[] LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH RECURSIVE edges(parent,child) AS (
  SELECT operator_subject_id,subject_id FROM public.v2_leads WHERE operator_subject_id IS NOT NULL
  UNION SELECT operator_subject_id,subject_id FROM public.v2_routes
  UNION SELECT route_subject_id,subject_id FROM public.v2_patterns
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_service_plans
  UNION SELECT service_plan_subject_id,subject_id FROM public.v2_runs
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_runs
  UNION SELECT run_subject_id,source_subject_id FROM public.v2_admin_timetable_entries
  UNION SELECT parent_stop_id,subject_id FROM public.v2_stops WHERE parent_stop_id IS NOT NULL
  UNION SELECT ps.stop_subject_id,ps.pattern_subject_id FROM public.v2_pattern_stops ps JOIN public.v2_pattern_versions pv ON pv.pattern_subject_id=ps.pattern_subject_id AND pv.version=ps.pattern_version WHERE pv.sealed
  UNION SELECT intended_subject_id,subject_id FROM public.v2_actual_journeys WHERE intended_subject_id IS NOT NULL
  UNION SELECT matched_run_subject_id,subject_id FROM public.v2_actual_journeys WHERE matched_run_subject_id IS NOT NULL
  UNION SELECT x.ref_id,o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT x.ref_id,public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT p.source_subject_id,p.target_subject_id FROM public.v2_transport_creations p JOIN public.v2_transport_creation_origins o ON o.creation_id=p.id
  UNION SELECT from_subject_id,to_subject_id FROM public.v2_association_links
  UNION SELECT to_subject_id,from_subject_id FROM public.v2_association_links
 ), reached(id) AS (SELECT unnest(roots) UNION SELECT e.child FROM edges e JOIN reached r ON r.id=e.parent)
 SELECT COALESCE(array_agg(s.id ORDER BY s.id),'{}'::uuid[]) FROM reached r JOIN public.v2_subjects s ON s.id=r.id;
$$;

-- Private discovery projection prerequisite. No client/backend grant here.
-- The public HTTP/native capability and compatible contribution adapters must
-- be installed before exposing it. Staff scaffolds never become public leads.
CREATE FUNCTION public.v2_timetable_discovery(subject uuid,as_of timestamptz DEFAULT statement_timestamp()) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE e public.v2_admin_timetable_entries;cmd public.v2_admin_timetables;l public.v2_leads;r public.v2_runs;plan public.v2_service_plans;
 pat public.v2_patterns;route public.v2_routes;op public.v2_operators;cal public.v2_calendars;policy public.v2_evidence_policies;
 property record;observation public.v2_observations;local_day date;evidence_day date;source_day date;source_latest date;horizon integer;
 critical text[]:=ARRAY['route.origin','route.destination','operator.reported','pattern.stops','service.mode','service.calendar','departure.scheduled','boarding.pickup'];
 pickup public.v2_stops;dropoff public.v2_stops;corridor public.v2_corridors;facts jsonb;revision_digest text;
BEGIN
 IF as_of IS NULL OR NOT isfinite(as_of) THEN RETURN NULL;END IF;
 SELECT * INTO e FROM public.v2_admin_timetable_entries WHERE source_subject_id=subject;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO cmd FROM public.v2_admin_timetables WHERE id=e.timetable_id;
 SELECT * INTO l FROM public.v2_leads WHERE subject_id=subject;
 IF cmd.erased OR cmd.actor_user_id IS NULL OR l.intake_kind<>'staff' OR l.attribution_erased
  OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=cmd.actor_user_id)
  OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=cmd.actor_user_id)
  OR EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals WHERE route_subject_id=subject)
  OR EXISTS(SELECT 1 FROM public.v2_public_lead_hides WHERE subject_id=subject)
  OR NOT public.v2_current_reviewed_creation(e.run_subject_id)
  OR EXISTS(SELECT 1 FROM unnest(critical) f WHERE NOT public.v2_timetable_property_current(e.run_subject_id,f)) THEN RETURN NULL;END IF;
 SELECT * INTO r FROM public.v2_runs WHERE subject_id=e.run_subject_id;
 SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=r.service_plan_subject_id;
 SELECT * INTO pat FROM public.v2_patterns WHERE subject_id=plan.pattern_subject_id;
 SELECT * INTO route FROM public.v2_routes WHERE subject_id=pat.route_subject_id;
 SELECT * INTO op FROM public.v2_operators WHERE subject_id=route.operator_subject_id;
 SELECT * INTO cal FROM public.v2_calendars WHERE id=plan.calendar_id;
 SELECT * INTO corridor FROM public.v2_corridors WHERE id=pat.corridor_id;
 IF l.corridor_id IS DISTINCT FROM pat.corridor_id OR l.operator_subject_id IS DISTINCT FROM op.subject_id
  OR l.reported_departure_seconds IS DISTINCT FROM r.departure_seconds OR plan.mode<>'fixed_time' OR cal.coverage<>'recurring' OR cal.timezone IS DISTINCT FROM plan.timezone
  OR cal.weekdays IS NULL OR cal.weekdays=0 OR cal.start_date IS NULL OR cal.end_date IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.v2_timezones WHERE name=cal.timezone)
  OR EXISTS(SELECT 1 FROM public.v2_calendar_exceptions WHERE calendar_id=cal.id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_transport_creation_origins o JOIN public.v2_transport_creations c ON c.id=o.creation_id
   WHERE o.subject_id=r.subject_id AND c.source_subject_id=subject AND c.target_kind='run' AND NOT c.erased AND NOT o.erased) THEN RETURN NULL;END IF;
 local_day:=(as_of AT TIME ZONE cal.timezone)::date;
 IF local_day<greatest(cal.start_date,r.validity_from,plan.effective_from)
  OR local_day>least(cal.end_date,r.validity_to,plan.effective_to) THEN RETURN NULL;END IF;
 SELECT p.* INTO policy FROM public.v2_evidence_policy_state s JOIN public.v2_evidence_policies p ON p.version=s.version WHERE s.id;
 IF policy.version IS NULL THEN RETURN NULL;END IF;
 -- Retain current evidence-policy horizons and original observation/source age.
 -- Manual native review supplies exact entity context; it never creates a
 -- second witness or rewrites the observation's date to the approval date.
 FOR property IN SELECT p.* FROM public.v2_admin_timetable_properties p WHERE p.run_subject_id=r.subject_id AND p.field_key=ANY(critical)
  AND p.writer_kind<>'header' LOOP
  SELECT * INTO observation FROM public.v2_observations WHERE id=property.observation_id;
  SELECT min(s.source_date),max(s.source_date) INTO source_day,source_latest FROM public.v2_sources s WHERE s.id=ANY(public.v2_source_component(
   ARRAY(SELECT os.source_id FROM public.v2_observation_sources os WHERE os.observation_id=observation.id)));
  evidence_day:=least(observation.observed_from,source_day);
  horizon:=CASE WHEN property.field_key='operator.reported' THEN policy.operator_days
   WHEN property.field_key IN('pattern.stops','boarding.pickup') THEN policy.place_days ELSE policy.schedule_days END;
  IF evidence_day IS NULL OR evidence_day>local_day OR observation.observed_from>local_day
   OR observation.observed_to>local_day OR source_latest>local_day OR observation.knowledge_basis NOT IN('observed_sign','operator_statement')
   OR NOT coalesce((public.v2_source_footprint(observation.id)->>'known')::boolean,false)
   OR as_of>=public.v2_assessment_day_end(evidence_day,horizon,cal.timezone) THEN RETURN NULL;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.v2_review_cases c WHERE c.subject_id=ANY(ARRAY[subject,r.subject_id,plan.subject_id,pat.subject_id,route.subject_id,op.subject_id])
  AND c.kind='conflict' AND c.state IN('open','in_review','reopened') AND (c.field_key IS NULL OR c.field_key=ANY(critical))) THEN RETURN NULL;END IF;
 SELECT s.* INTO pickup FROM public.v2_admin_timetable_properties p JOIN public.v2_observations o ON o.id=p.observation_id
  JOIN public.v2_stops s ON s.subject_id=(o.value->>'stopId')::uuid WHERE p.run_subject_id=r.subject_id AND p.field_key='boarding.pickup';
 IF pickup.subject_id IS NULL OR pickup.city_id IS DISTINCT FROM corridor.origin_city_id OR NOT public.v2_current_reviewed_creation(pickup.subject_id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_pattern_stops ps WHERE ps.pattern_subject_id=pat.subject_id AND ps.pattern_version=plan.pattern_version
   AND ps.stop_subject_id=pickup.subject_id AND ps.pickup IN('allowed','request')) THEN RETURN NULL;END IF;
 IF public.v2_timetable_property_current(r.subject_id,'alighting.dropoff') THEN
  SELECT s.* INTO dropoff FROM public.v2_admin_timetable_properties p JOIN public.v2_observations o ON o.id=p.observation_id
   JOIN public.v2_stops s ON s.subject_id=(o.value->>'stopId')::uuid WHERE p.run_subject_id=r.subject_id AND p.field_key='alighting.dropoff';
  IF dropoff.city_id IS DISTINCT FROM corridor.destination_city_id OR NOT public.v2_current_reviewed_creation(dropoff.subject_id) THEN dropoff:=NULL;END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('field',p.field_key,'ref','timetable:'||p.review_id::text,'value',o.value,'scope',o.scope,
  'observedDate',o.observed_from,'asOf',local_day) ORDER BY p.field_key),'[]'::jsonb) INTO facts
  FROM public.v2_admin_timetable_properties p JOIN public.v2_observations o ON o.id=p.observation_id
  WHERE p.run_subject_id=r.subject_id AND p.field_key IN('fare.quoted','fare.advertised','boarding.pickup','alighting.dropoff')
   AND public.v2_timetable_property_current(r.subject_id,p.field_key);
 revision_digest:=public.v2_assessment_hash(jsonb_build_object('source',(SELECT jsonb_build_array(revision,input_generation) FROM public.v2_subjects WHERE id=subject),
  'run',(SELECT jsonb_build_array(revision,input_generation) FROM public.v2_subjects WHERE id=r.subject_id),
  'plan',(SELECT jsonb_build_array(revision,input_generation) FROM public.v2_subjects WHERE id=plan.subject_id),
  'policy',policy.version,'graph',(SELECT revision FROM public.v2_source_graph WHERE id),'facts',facts));
 RETURN jsonb_build_object('subjectId',subject,'runId',r.subject_id,'contextDigest',revision_digest,'provenance','reviewed_timetable',
  'origin',(SELECT jsonb_build_object('id',id,'name',name,'placeType',place_type) FROM public.cities WHERE id=corridor.origin_city_id),
  'destination',(SELECT jsonb_build_object('id',id,'name',name,'placeType',place_type) FROM public.cities WHERE id=corridor.destination_city_id),
  'operator',jsonb_build_object('id',op.subject_id,'name',op.display_name),
  'departureSeconds',r.departure_seconds,'arrivalSeconds',CASE WHEN public.v2_timetable_property_current(r.subject_id,'arrival.scheduled') THEN r.arrival_seconds END,
  'pickup',jsonb_build_object('stopId',pickup.subject_id,'cityId',pickup.city_id,'name',pickup.name),
  'dropoff',CASE WHEN dropoff.subject_id IS NOT NULL THEN jsonb_build_object('stopId',dropoff.subject_id,'cityId',dropoff.city_id,'name',dropoff.name) END,
  'calendar',jsonb_build_object('timezone',cal.timezone,'weekdays',cal.weekdays,'validFrom',greatest(cal.start_date,r.validity_from,plan.effective_from),
   'validUntil',least(cal.end_date,r.validity_to,plan.effective_to)),'approvedFacts',facts,'asOf',as_of);
END;$$;
REVOKE ALL ON FUNCTION public.v2_timetable_discovery(uuid,timestamptz) FROM PUBLIC,mabhazi_api;
DO $$ DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_timetable_discovery(uuid,timestamptz) FROM %I',r);END IF;
 END LOOP;
END;$$;


CREATE OR REPLACE FUNCTION public.v2_api_admin_route_action(actor varchar,request uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_admin_route_actions;removal public.v2_admin_route_actions;digest text;route uuid;
 operation text;reason text;expected bigint;source uuid;actual_revision bigint;result text;removal_ref uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM public.v2_admin_require(actor);
 IF request IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object'
  OR input-ARRAY['routeId','revision','operation','reason','removalId','expiresAt']<>'{}'::jsonb
  OR NOT input?&ARRAY['routeId','revision','operation','reason','removalId','expiresAt']
  OR NOT public.v2_json_uuid(input->'routeId')
  OR jsonb_typeof(input->'revision') IS DISTINCT FROM 'string' OR (input->>'revision')!~'^[1-9][0-9]{0,15}$'
  OR (input->>'revision')::bigint>9007199254740991
  OR jsonb_typeof(input->'expiresAt') IS DISTINCT FROM 'number' OR (input->>'expiresAt')!~'^[1-9][0-9]{0,15}$'
  OR COALESCE(input->>'operation','') NOT IN('remove','restore') THEN
  RAISE EXCEPTION 'v2_admin_visibility_invalid' USING ERRCODE='23514';END IF;
 operation:=input->>'operation';reason:=input->>'reason';route:=(input->>'routeId')::uuid;expected:=(input->>'revision')::bigint;
 IF operation='remove' AND (input->'removalId'<>'null'::jsonb OR COALESCE(reason,'') NOT IN('inaccurate','duplicate','spam','unsafe','other'))
  OR operation='restore' AND (NOT public.v2_json_uuid(input->'removalId') OR COALESCE(reason,'') NOT IN('removal_reversed','record_rechecked')) THEN
  RAISE EXCEPTION 'v2_admin_visibility_invalid' USING ERRCODE='23514';END IF;
 removal_ref:=(input->>'removalId')::uuid;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,input-'expiresAt'));
 SELECT * INTO prior FROM public.v2_admin_route_actions WHERE id=request;
 IF FOUND THEN
  IF prior.actor_user_id IS DISTINCT FROM actor OR prior.request_digest IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'v2_admin_request_conflict' USING ERRCODE='23514';END IF;
  RETURN public.v2_api_admin_route_action_receipt(actor,request);
 END IF;
 IF (input->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000
  OR (input->>'expiresAt')::numeric>extract(epoch FROM clock_timestamp())*1000+330000 THEN
  RAISE EXCEPTION 'v2_admin_preview_expired' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=route) THEN
  RAISE EXCEPTION 'v2_admin_route_unavailable' USING ERRCODE='23503';END IF;
 SELECT s.revision,c.id INTO actual_revision,source FROM public.v2_leads l
  JOIN public.v2_subjects s ON s.id=l.subject_id AND s.lifecycle='active'
  JOIN public.v2_contributions c ON c.id=l.initial_contribution_id AND c.original_subject_id=l.subject_id
  JOIN public.users author ON author.id=c.user_id
  WHERE l.subject_id=route AND (l.intake_kind='community' OR (l.intake_kind='staff' AND EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id AND NOT t.erased WHERE e.source_subject_id=l.subject_id))) AND NOT l.attribution_erased;
 IF NOT FOUND THEN result:='unavailable';
 ELSIF actual_revision<>expected THEN result:='changed';
 ELSIF operation='remove' THEN result:='removed';
 ELSE
  SELECT * INTO removal FROM public.v2_admin_route_actions WHERE id=removal_ref;
  IF NOT FOUND OR removal.route_subject_id<>route OR removal.operation<>'remove' OR removal.outcome<>'removed'
   OR removal.contribution_id IS DISTINCT FROM source THEN result:='unavailable';
  ELSIF EXISTS(SELECT 1 FROM public.v2_admin_route_actions WHERE removal_id=removal_ref AND outcome='restored') THEN result:='already_restored';
  ELSE result:='restored';END IF;
 END IF;
 INSERT INTO public.v2_admin_route_actions(id,actor_user_id,request_digest,operation,reason_code,route_subject_id,contribution_id,expected_revision,removal_id,outcome)
 VALUES(request,actor,digest,operation,reason,route,source,expected,removal_ref,result);
 RETURN public.v2_api_admin_route_action_receipt(actor,request);
END;$$;

-- Removing a registered presentation row changes publication, not the reviewed
-- native facts. The generic path follows native source->created-run provenance
-- edges and irreversibly invalidates that creation head on a visibility toggle.
-- Keep the public gate closed while removed, advance the alias revision/tasks,
-- and let restoration re-evaluate unchanged native proof. Real structural or
-- evidence changes still use their original invalidation paths.
CREATE OR REPLACE FUNCTION public.v2_admin_route_action_propagate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.outcome IN('removed','restored') THEN
  IF EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries e JOIN public.v2_leads l ON l.subject_id=e.source_subject_id
   WHERE e.source_subject_id=NEW.route_subject_id AND l.intake_kind='staff') THEN
   PERFORM public.v2_target_recompute_subjects(ARRAY[NEW.route_subject_id],NEW.id,false);
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
    SELECT 'refresh_tasks',id,input_generation,'prompts/1',NEW.id FROM public.v2_subjects WHERE id=NEW.route_subject_id;
  ELSE
   PERFORM public.v2_transport_propagate(ARRAY[NEW.route_subject_id],'v2_admin_route_actions','UPDATE',ARRAY['public_visibility']);
  END IF;
 END IF;
 RETURN NEW;
END;$$;

$timetable_migration_3$;
 IF encode(sha256(convert_to(replace(sql,E'\r\n',E'\n'),'UTF8')),'hex')<>'5809e352bddf763c8f5a50855c75e842dcab6feef021643008eb486135f0e0b4' THEN RAISE EXCEPTION 'timetable_embedded_hash_changed';END IF;
 EXECUTE sql;
 INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0045_private_timetable_discovery.sql','5809e352bddf763c8f5a50855c75e842dcab6feef021643008eb486135f0e0b4');
 sql:=$timetable_migration_4$-- Versioned timetable public adapters. Only the restricted backend receives these projections.
-- Registered source leads remain real leads; no inferred association or anonymous SQL access.
CREATE OR REPLACE FUNCTION public.v2_place_reference_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.field_key IN('boarding.pickup','alighting.dropoff') THEN
  INSERT INTO public.v2_place_report_refs(observation_id) VALUES(NEW.id) ON CONFLICT(observation_id) DO NOTHING;
 END IF;RETURN NEW;
END;$$;
INSERT INTO public.v2_place_report_refs(observation_id)
 SELECT p.observation_id FROM public.v2_admin_timetable_properties p WHERE p.field_key IN('boarding.pickup','alighting.dropoff')
 ON CONFLICT(observation_id) DO NOTHING;

-- Keep current typed native proof authoritative. Presentation moderation never
-- withdraws that proof; restoring visibility rechecks it instead of reapproving it.
DO $$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.v2_timetable_discovery(uuid,timestamptz)'::regprocedure);
 IF strpos(definition,'OR NOT public.v2_current_reviewed_creation(e.run_subject_id)')=0 THEN RAISE EXCEPTION 'timetable_discovery_baseline_changed';END IF;
 definition:=replace(definition,'OR NOT public.v2_current_reviewed_creation(e.run_subject_id)',
  'OR EXISTS(SELECT 1 FROM public.v2_admin_current_core WHERE route_subject_id=subject)
  OR EXISTS(SELECT 1 FROM public.v2_admin_timetable_properties p JOIN public.v2_place_report_refs ref ON ref.observation_id=p.observation_id JOIN public.v2_place_report_hides hide ON hide.place_ref=ref.id WHERE p.run_subject_id=e.run_subject_id AND p.field_key=''boarding.pickup'')
  OR NOT public.v2_current_reviewed_creation(e.run_subject_id)');
 EXECUTE definition;
END;$$;
CREATE FUNCTION public.v2_timetable_identity(subject uuid) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT public.v2_assessment_hash(jsonb_build_array(d->'subjectId',d->'runId',d->'origin',d->'destination',d->'operator',d->'departureSeconds',d->'pickup',d->'calendar'))
 FROM (SELECT public.v2_timetable_discovery(subject) d) x WHERE d IS NOT NULL;
$$;
CREATE FUNCTION public.v2_api_public_timetable_reports() RETURNS TABLE(
 subject_id uuid,revision bigint,author_user_id varchar,origin_city_id integer,destination_city_id integer,
 origin jsonb,destination jsonb,operator_report jsonb,reported_time jsonb,core_corrections jsonb,timetable jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e.source_subject_id,s.revision,t.actor_user_id,(d->'origin'->>'id')::integer,(d->'destination'->>'id')::integer,
 d->'origin',d->'destination',
 jsonb_build_object('value',d->'operator'->>'name','support','reported','freshness','unknown','submittedAt',c.submitted_at,'observedDate',t.proposal->'source'->>'checkedOn'),
 jsonb_build_object('value',lpad(((d->>'departureSeconds')::integer/3600)::text,2,'0')||':'||lpad((((d->>'departureSeconds')::integer%3600)/60)::text,2,'0'),
 'basis','scheduled','support','reported','freshness','unknown','submittedAt',c.submitted_at,'observedDate',t.proposal->'source'->>'checkedOn'),
 '[]'::jsonb,jsonb_build_object('runId',d->'runId','departureSeconds',d->'departureSeconds','arrivalSeconds',d->'arrivalSeconds','calendar',d->'calendar')
 FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id
 JOIN public.v2_subjects s ON s.id=e.source_subject_id JOIN public.v2_leads l ON l.subject_id=s.id
 JOIN public.v2_contributions c ON c.id=l.initial_contribution_id
 CROSS JOIN LATERAL (SELECT public.v2_timetable_discovery(e.source_subject_id) d) projection WHERE d IS NOT NULL;
$$;
CREATE VIEW public.v2_public_supported_route_reports AS
 SELECT p.subject_id,p.revision,p.author_user_id,p.origin_city_id,p.destination_city_id,p.origin,p.destination,p.operator_report,p.reported_time,p.core_corrections,NULL::jsonb timetable
 FROM public.v2_public_reviewed_lead_reports p UNION ALL SELECT * FROM public.v2_api_public_timetable_reports();
-- Fresh intake on corrected community identity remains fenced. Never substitute
-- the reviewed community display for the original contribution identity.
CREATE VIEW public.v2_public_contributable_route_reports AS
 SELECT p.*,NULL::jsonb timetable FROM public.v2_public_lead_reports p
 UNION ALL SELECT subject_id,revision,author_user_id,origin_city_id,destination_city_id,origin,destination,operator_report,reported_time,timetable FROM public.v2_api_public_timetable_reports();

CREATE FUNCTION public.v2_timetable_contribution_context(actor varchar,subject uuid,blocked varchar[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor)
  THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) b WHERE b IS NULL OR length(b) NOT BETWEEN 1 AND 200 OR b~'[[:cntrl:]]')
  THEN RAISE EXCEPTION 'v2_route_safety_context_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM public.v2_api_public_timetable_reports() r WHERE r.subject_id=subject AND NOT(r.author_user_id=ANY(blocked))
 AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=actor AND b.blocked_user_id=r.author_user_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_route_target_unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('subjectId',subject,'revision',p.revision,'identityKey',public.v2_timetable_identity(subject),
  'origin',p.origin,'destination',p.destination,'operatorName',p.operator_report->>'value','departureTime',p.reported_time->>'value');
END;$$;
DO $$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.v2_api_route_contribution_context(character varying,uuid,character varying[])'::regprocedure);
 IF strpos(definition,'BEGIN')=0 THEN RAISE EXCEPTION 'timetable_context_baseline_changed';END IF;
 definition:=replace(definition,'BEGIN','BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries WHERE source_subject_id=subject) THEN RETURN public.v2_timetable_contribution_context(actor,subject,blocked);END IF;');
 EXECUTE definition;
 definition:=pg_get_functiondef('public.v2_api_submit_public_actual_journey(character varying,text,jsonb,character varying[])'::regprocedure);
 IF strpos(definition,'public.v2_public_lead_reports')=0 THEN RAISE EXCEPTION 'timetable_actual_baseline_changed';END IF;
 EXECUTE replace(definition,'public.v2_public_lead_reports','public.v2_public_contributable_route_reports');
 definition:=pg_get_functiondef('public.v2_api_route_report_action(character varying,uuid,text,text)'::regprocedure);
 IF strpos(definition,'public.v2_public_reviewed_lead_reports')=0 THEN RAISE EXCEPTION 'timetable_safety_baseline_changed';END IF;
 EXECUTE replace(definition,'public.v2_public_reviewed_lead_reports','public.v2_public_supported_route_reports');
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_fare_report_context AS '||replace(pg_get_viewdef('public.v2_fare_report_context'::regclass,true),'v2_public_lead_reports','v2_public_contributable_route_reports');
 definition:=pg_get_viewdef('public.v2_place_report_context'::regclass,true);
 IF strpos(definition,$anchor$l.intake_kind = 'community'$anchor$)=0 OR strpos(definition,'v2_prompt_identity(l.subject_id)')=0 THEN RAISE EXCEPTION 'timetable_place_baseline_changed';END IF;
 definition:=replace(definition,$anchor$l.intake_kind = 'community'::text$anchor$,$replacement$(l.intake_kind = 'community'::text OR (l.intake_kind = 'staff'::text AND v2_timetable_discovery(l.subject_id) IS NOT NULL))$replacement$);
 definition:=replace(definition,'v2_prompt_identity(l.subject_id)',$replacement$CASE WHEN l.intake_kind='staff' THEN v2_timetable_identity(l.subject_id) ELSE v2_prompt_identity(l.subject_id) END$replacement$);
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_place_report_context AS '||definition;
 definition:=pg_get_functiondef('public.v2_api_place_report_action(character varying,uuid,uuid,text,text,character varying[])'::regprocedure);
 EXECUTE replace(definition,'public.v2_public_lead_reports','public.v2_public_contributable_route_reports');
END;$$;

-- These claims are exact independent native approvals, not fabricated selected
-- field resolutions. Public references are separate from evidence/review IDs.
CREATE FUNCTION public.v2_api_timetable_card_claims(subjects uuid[]) RETURNS TABLE(
 route_subject_id uuid,field_key text,ref uuid,original_value jsonb,scope jsonb,observed_date text,as_of text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF subjects IS NULL OR cardinality(subjects)>20 THEN RAISE EXCEPTION 'timetable_card_page_invalid' USING ERRCODE='23514';END IF;
 RETURN QUERY SELECT e.source_subject_id,p.field_key,coalesce(f.id,place.id),
 CASE WHEN p.field_key IN('boarding.pickup','alighting.dropoff') THEN jsonb_build_object('name',stop.name) ELSE jsonb_set(o.value,'{amount}',to_jsonb(trim_scale((o.value->>'amount')::numeric)::text)) END,o.scope,o.observed_from::text,
 (statement_timestamp() AT TIME ZONE (d->'calendar'->>'timezone'))::date::text
 FROM public.v2_admin_timetable_entries e CROSS JOIN LATERAL (SELECT public.v2_timetable_discovery(e.source_subject_id) d) available
 JOIN public.v2_admin_timetable_properties p ON p.run_subject_id=e.run_subject_id
 JOIN public.v2_observations o ON o.id=p.observation_id
 LEFT JOIN public.v2_public_fare_refs f ON f.observation_id=o.id
 LEFT JOIN public.v2_place_report_refs place ON place.observation_id=o.id
 LEFT JOIN public.v2_stops stop ON stop.subject_id=CASE WHEN p.field_key IN('boarding.pickup','alighting.dropoff') THEN (o.value->>'stopId')::uuid END
 WHERE e.source_subject_id=ANY(subjects) AND d IS NOT NULL AND p.field_key IN('fare.quoted','fare.advertised','boarding.pickup','alighting.dropoff')
 AND public.v2_timetable_property_current(e.run_subject_id,p.field_key) AND coalesce(f.id,place.id) IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.v2_public_fare_hides h WHERE h.fare_ref=f.id)
 AND NOT EXISTS(SELECT 1 FROM public.v2_place_report_hides h WHERE h.place_ref=place.id);
END;$$;
-- New anonymous SQL privileges are never introduced. The browser/mobile uses
-- authenticated HTTP guards; these facades are exclusive to the backend role.
DO $$ DECLARE f text;r text;t text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_timetable_identity(uuid)','public.v2_timetable_contribution_context(varchar,uuid,varchar[])',
 'public.v2_api_public_timetable_reports()','public.v2_api_timetable_card_claims(uuid[])'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.v2_api_public_timetable_reports(),public.v2_api_timetable_card_claims(uuid[]) TO mabhazi_api;
 FOREACH t IN ARRAY ARRAY['v2_public_supported_route_reports','v2_public_contributable_route_reports'] LOOP
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
 EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
 END LOOP;
END;$$;

CREATE FUNCTION public.v2_api_timetable_report_claims(subjects uuid[]) RETURNS TABLE(
 route_subject_id uuid,author_id varchar,observation_id uuid,subject_id uuid,field_key text,scope_key text,scope jsonb,original_value jsonb,
 knowledge_basis text,observed_from date,observed_to date,effective_from date,effective_to date,submitted_at timestamptz,ref uuid,field_read jsonb,city jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT card.route_subject_id,t.actor_user_id,o.id,o.original_subject_id,o.field_key,o.scope_key,o.scope,card.original_value,
 o.knowledge_basis,o.observed_from,o.observed_to,o.effective_from,o.effective_to,o.submitted_at,card.ref,
 jsonb_build_object('status','assessed','reviewed',true,'dispute','none','provenance','reviewed_timetable','value',card.original_value,
 'candidates',jsonb_build_array(jsonb_build_object('value',card.original_value,'freshness','current','temporalClass','ongoing','oldestDate',o.observed_from,'newestDate',o.observed_from))),
 CASE WHEN o.field_key IN('boarding.pickup','alighting.dropoff') THEN
 (SELECT jsonb_build_object('id',c.id,'name',c.name,'placeType',c.place_type) FROM public.cities c WHERE c.id=(projection->CASE o.field_key WHEN 'boarding.pickup' THEN 'origin' ELSE 'destination' END->>'id')::integer) END
 FROM public.v2_api_timetable_card_claims(subjects) card
 JOIN public.v2_admin_timetable_entries e ON e.source_subject_id=card.route_subject_id
 JOIN public.v2_admin_timetables t ON t.id=e.timetable_id
 JOIN public.v2_admin_timetable_properties p ON p.run_subject_id=e.run_subject_id AND p.field_key=card.field_key
 JOIN public.v2_observations o ON o.id=p.observation_id
 CROSS JOIN LATERAL (SELECT public.v2_timetable_discovery(e.source_subject_id) projection) d;
$$;
REVOKE ALL ON FUNCTION public.v2_api_timetable_report_claims(uuid[]) FROM PUBLIC,mabhazi_api;
GRANT EXECUTE ON FUNCTION public.v2_api_timetable_report_claims(uuid[]) TO mabhazi_api;
DO $timetable_claims_private$ DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_api_timetable_report_claims(uuid[]) FROM %I',r);END IF;
 END LOOP;
END;$timetable_claims_private$;
DO $$ DECLARE definition text;BEGIN
 definition:=rtrim(pg_get_viewdef('public.v2_fare_report_context'::regclass,true),E'; \n');
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_fare_report_context AS '||definition||
 ' UNION ALL SELECT c.ref,c.route_subject_id,c.author_id,c.author_id,c.observation_id,c.subject_id,c.field_key,c.scope_key,c.scope,c.original_value,
 c.knowledge_basis,c.observed_from,c.observed_to,c.effective_from,c.effective_to,c.submitted_at,p.origin,p.destination,p.operator_report,p.reported_time,true,c.field_read
 FROM public.v2_api_public_timetable_reports() p CROSS JOIN LATERAL public.v2_api_timetable_report_claims(ARRAY[p.subject_id]) c WHERE c.field_key LIKE ''fare.%''';
 definition:=rtrim(pg_get_viewdef('public.v2_place_report_context'::regclass,true),E'; \n');
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_place_report_context AS '||definition||
 ' UNION ALL SELECT c.ref,c.route_subject_id,c.author_id,c.author_id,c.observation_id,c.field_key,c.scope_key,c.original_value,c.knowledge_basis,c.observed_from,c.submitted_at,c.city,true,c.field_read,false
 FROM public.v2_api_public_timetable_reports() p CROSS JOIN LATERAL public.v2_api_timetable_report_claims(ARRAY[p.subject_id]) c WHERE c.field_key IN(''boarding.pickup'',''alighting.dropoff'')';
END;$$;
$timetable_migration_4$;
 IF encode(sha256(convert_to(replace(sql,E'\r\n',E'\n'),'UTF8')),'hex')<>'038d3e685819b9ab4bb38c37621aef904b3a90f1e1e91f340b3213e87a635992' THEN RAISE EXCEPTION 'timetable_embedded_hash_changed';END IF;
 EXECUTE sql;
 INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0046_timetable_public_adapters.sql','038d3e685819b9ab4bb38c37621aef904b3a90f1e1e91f340b3213e87a635992');
 sql:=$timetable_migration_5$-- Private imported timetable catalogue, exact property withdrawal and explicit replacement.
CREATE TABLE public.v2_admin_timetable_commands(
 id uuid PRIMARY KEY,actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 route_subject_id uuid REFERENCES public.v2_leads(subject_id) ON DELETE SET NULL,
 request_digest text CHECK(request_digest~'^[a-f0-9]{64}$'),receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((actor_user_id IS NULL AND request_digest IS NULL) OR (actor_user_id IS NOT NULL AND request_digest IS NOT NULL)));
ALTER TABLE public.v2_admin_timetable_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_admin_timetable_commands FROM PUBLIC,mabhazi_api;
CREATE FUNCTION public.v2_timetable_command_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR NEW.actor_user_id IS NULL)
 AND (NEW.route_subject_id IS NOT DISTINCT FROM OLD.route_subject_id OR NEW.route_subject_id IS NULL)
 AND to_jsonb(NEW)-ARRAY['actor_user_id','route_subject_id']=to_jsonb(OLD)-ARRAY['actor_user_id','route_subject_id'] THEN IF NEW.actor_user_id IS NULL THEN NEW.request_digest:=NULL;END IF;RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_timetable_command_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER timetable_command_immutable BEFORE UPDATE OR DELETE ON public.v2_admin_timetable_commands FOR EACH ROW EXECUTE FUNCTION public.v2_timetable_command_guard();
CREATE FUNCTION public.v2_timetable_review_impact(review uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_array(e.source_subject_id,p.field_key) ORDER BY e.source_subject_id,p.field_key),'[]'::jsonb)
 FROM public.v2_admin_timetable_properties p JOIN public.v2_admin_timetable_entries e ON e.run_subject_id=p.run_subject_id WHERE p.review_id=review;
$$;
CREATE FUNCTION public.v2_api_admin_timetable_records(actor varchar,cursor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY source_subject_id),'[]'::jsonb),
 'hasMore',(SELECT count(*)>30 FROM public.v2_admin_timetable_entries WHERE cursor IS NULL OR source_subject_id>cursor)) INTO result
 FROM (SELECT e.source_subject_id,jsonb_build_object('routeId',e.source_subject_id,'revision',s.revision::text,'timetableId',t.id,
 'operator',CASE WHEN NOT t.erased THEN t.proposal->>'operator' END,
 'origin',origin.name,'destination',destination.name,'departure',lpad((r.departure_seconds/3600)::text,2,'0')||':'||lpad(((r.departure_seconds%3600)/60)::text,2,'0'),
 'source',CASE WHEN NOT t.erased THEN t.proposal->'source' END,'calendar',CASE WHEN NOT t.erased THEN jsonb_build_object('weekdays',t.proposal->'weekdays','validFrom',t.proposal->'validFrom','validUntil',t.proposal->'validUntil','timezone',t.proposal->'timezone') END,
 'createdAt',t.created_at,'sourceErased',t.erased,'publiclyAvailable',public.v2_timetable_discovery(e.source_subject_id) IS NOT NULL,
 'removalId',removal.id,'properties',(SELECT coalesce(jsonb_agg(jsonb_build_object('field',p.field_key,'reviewId',p.review_id,
 'caseRevision',c.revision::text,'subjectRevision',cs.revision::text,'current',public.v2_timetable_property_current(e.run_subject_id,p.field_key),'value',(SELECT o.value FROM public.v2_observations o WHERE o.id=p.observation_id),'scope',(SELECT o.scope FROM public.v2_observations o WHERE o.id=p.observation_id),'placeName',(SELECT stop.name FROM public.v2_observations o JOIN public.v2_stops stop ON stop.subject_id=CASE WHEN o.value ? 'stopId' THEN (o.value->>'stopId')::uuid END WHERE o.id=p.observation_id),
 'impact',public.v2_timetable_review_impact(p.review_id),'impactDigest',public.v2_assessment_hash(public.v2_timetable_review_impact(p.review_id)),
 'withdrawable',c.last_decision_id=p.review_id AND d.action='accept' AND NOT d.evidence_erased,
 'history',(SELECT jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'reason',h.reason_code,'at',h.created_at,'evidenceErased',h.evidence_erased) ORDER BY h.expected_revision,h.id)
 FROM public.v2_review_decisions h WHERE h.case_id=c.id)) ORDER BY p.field_key),'[]'::jsonb)
 FROM public.v2_admin_timetable_properties p JOIN public.v2_review_decisions d ON d.id=p.review_id JOIN public.v2_review_cases c ON c.id=d.case_id
 JOIN public.v2_subjects cs ON cs.id=c.subject_id WHERE p.run_subject_id=e.run_subject_id)) item
 FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id JOIN public.v2_subjects s ON s.id=e.source_subject_id
 JOIN public.v2_runs r ON r.subject_id=e.run_subject_id JOIN public.v2_leads l ON l.subject_id=e.source_subject_id
 JOIN public.v2_corridors co ON co.id=l.corridor_id JOIN public.cities origin ON origin.id=co.origin_city_id JOIN public.cities destination ON destination.id=co.destination_city_id
 LEFT JOIN public.v2_admin_active_route_removals removal ON removal.route_subject_id=e.source_subject_id
 WHERE cursor IS NULL OR e.source_subject_id>cursor ORDER BY e.source_subject_id LIMIT 30) page;
 RETURN result;
END;$$;
CREATE FUNCTION public.v2_api_admin_timetable_command_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT receipt INTO result FROM public.v2_admin_timetable_commands WHERE id=request AND actor_user_id=actor;
 RETURN coalesce(result,'{"found":false}'::jsonb);
END;$$;
CREATE FUNCTION public.v2_api_admin_timetable_command(actor varchar,request uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_admin_timetable_commands;p public.v2_admin_timetable_properties;c public.v2_review_cases;s public.v2_subjects;
 route uuid;review uuid;result uuid;digest text;response jsonb;visibility jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;PERFORM public.v2_admin_require(actor);
 IF request IS NULL OR NOT coalesce(jsonb_typeof(input)='object' AND input?&ARRAY['routeId','revision','operation','reason','expiresAt']
 AND input-ARRAY['routeId','revision','operation','reason','expiresAt','field','reviewId','caseRevision','subjectRevision','impactDigest','removalId']='{}'::jsonb
 AND public.v2_json_uuid(input->'routeId') AND input->>'revision'~'^[1-9][0-9]{0,15}$' AND input->>'expiresAt'~'^[1-9][0-9]{0,15}$'
 AND input->>'operation' IN('withdraw','remove','restore'),false) THEN RAISE EXCEPTION 'v2_timetable_command_invalid' USING ERRCODE='23514';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,input-'expiresAt'));route:=(input->>'routeId')::uuid;
 SELECT * INTO prior FROM public.v2_admin_timetable_commands WHERE id=request;
 IF FOUND THEN IF prior.actor_user_id IS DISTINCT FROM actor OR prior.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_admin_request_conflict' USING ERRCODE='23514';END IF;
 RETURN prior.receipt;END IF;
 IF (input->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 OR (input->>'expiresAt')::numeric>extract(epoch FROM clock_timestamp())*1000+330000
 THEN RAISE EXCEPTION 'v2_admin_preview_expired' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries WHERE source_subject_id=route) THEN RAISE EXCEPTION 'v2_admin_route_unavailable' USING ERRCODE='23503';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=route AND revision=(input->>'revision')::bigint) THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 IF input->>'operation'='withdraw' THEN
 IF input->>'reason' NOT IN('incorrect_information','source_outdated','duplicate','other') OR NOT public.v2_json_uuid(input->'reviewId')
 OR input->>'caseRevision'!~'^[1-9][0-9]{0,15}$' OR input->>'subjectRevision'!~'^[1-9][0-9]{0,15}$' OR input->>'impactDigest'!~'^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'v2_timetable_command_invalid' USING ERRCODE='23514';END IF;
 SELECT property.* INTO p FROM public.v2_admin_timetable_properties property JOIN public.v2_admin_timetable_entries e ON e.run_subject_id=property.run_subject_id
 WHERE e.source_subject_id=route AND property.field_key=input->>'field' AND property.review_id=(input->>'reviewId')::uuid;
 IF NOT FOUND OR p.observation_id IS NULL AND p.writer_kind<>'header' THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 IF public.v2_assessment_hash(public.v2_timetable_review_impact(p.review_id)) IS DISTINCT FROM input->>'impactDigest' THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 SELECT * INTO c FROM public.v2_review_cases WHERE id=(SELECT case_id FROM public.v2_review_decisions WHERE id=p.review_id);
 SELECT * INTO s FROM public.v2_subjects WHERE id=c.subject_id;
 IF c.last_decision_id IS DISTINCT FROM p.review_id THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid DEFERRED;
 IF p.writer_kind='creation' THEN result:=public.v2_review_transport_creation(actor,p.writer_id,(input->>'caseRevision')::bigint,(input->>'subjectRevision')::bigint,'reverse',input->>'reason',NULL,request,p.review_id);
 ELSIF p.writer_kind='edit' THEN result:=public.v2_review_transport_edit(actor,p.writer_id,(input->>'caseRevision')::bigint,(input->>'subjectRevision')::bigint,'reverse',input->>'reason',NULL,request,p.review_id);
 ELSE result:=public.v2_record_review(actor,c.id,(input->>'caseRevision')::bigint,(input->>'subjectRevision')::bigint,'reverse',input->>'reason',NULL,ARRAY[]::uuid[],'review/1',p.review_id);END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid IMMEDIATE;
 response:=jsonb_build_object('kind','timetable-command','id',request,'outcome','withdrawn','routeId',route,'field',p.field_key,'reviewId',result,'reverses',p.review_id,'impact',public.v2_timetable_review_impact(p.review_id));
 ELSE
 IF input-ARRAY['routeId','revision','operation','reason','expiresAt','removalId']<>'{}'::jsonb THEN RAISE EXCEPTION 'v2_timetable_command_invalid' USING ERRCODE='23514';END IF;
 visibility:=public.v2_api_admin_route_action(actor,request,jsonb_build_object('routeId',route,'revision',input->>'revision','operation',input->>'operation','reason',input->>'reason','expiresAt',input->'expiresAt','removalId',coalesce(input->'removalId','null'::jsonb)));
 response:=(visibility-ARRAY['actorId','actorErased','sourceErased'])||jsonb_build_object('kind','timetable-command');
 END IF;
 INSERT INTO public.v2_admin_timetable_commands(id,actor_user_id,route_subject_id,request_digest,receipt) VALUES(request,actor,route,digest,response);
 RETURN response;
END;$$;
DO $$ DECLARE f text;r text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_timetable_command_guard()','public.v2_timetable_review_impact(uuid)',
 'public.v2_api_admin_timetable_records(varchar,uuid)','public.v2_api_admin_timetable_command(varchar,uuid,jsonb)','public.v2_api_admin_timetable_command_receipt(varchar,uuid)'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.v2_admin_timetable_commands FROM %I',r);END IF;END LOOP;
END;$$;

ALTER FUNCTION public.v2_timetable_proposal_valid(jsonb) RENAME TO v2_timetable_proposal_valid_original;
CREATE FUNCTION public.v2_timetable_proposal_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb;seen text[]:='{}';BEGIN
 IF NOT public.v2_timetable_proposal_valid_original(p-'replacements') THEN RETURN false;END IF;
 IF NOT p?'replacements' THEN RETURN true;END IF;
 IF jsonb_typeof(p->'replacements')<>'array' OR jsonb_array_length(p->'replacements')>100 THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p->'replacements') LOOP
 IF NOT coalesce(jsonb_typeof(item)='object' AND item?&ARRAY['kind','id','revision'] AND item-ARRAY['kind','id','revision']='{}'::jsonb
 AND item->>'kind' IN('lead','timetable') AND public.v2_json_uuid(item->'id') AND jsonb_typeof(item->'revision')='string' AND item->>'revision'~'^[1-9][0-9]{0,15}$',false)
 OR item->>'id'=ANY(seen) THEN RETURN false;END IF;
 seen:=array_append(seen,item->>'id');END LOOP;RETURN true;
END;$$;
ALTER FUNCTION public.v2_api_admin_timetable_preview(varchar,jsonb) RENAME TO v2_timetable_preview_original;
DO $$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.v2_timetable_preview_original(varchar,jsonb)'::regprocedure);
 EXECUTE replace(definition,'LIMIT 100','LIMIT 101');
END;$$;
CREATE FUNCTION public.v2_api_admin_timetable_preview(actor varchar,p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;item jsonb;candidate jsonb;remaining jsonb:='[]';targets jsonb:='[]';subject uuid;revision bigint;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF NOT public.v2_timetable_proposal_valid(p) THEN RAISE EXCEPTION 'v2_timetable_proposal_invalid' USING ERRCODE='23514';END IF;
 result:=public.v2_timetable_preview_original(actor,p-'replacements');
 IF jsonb_array_length(result->'duplicates')>100 THEN RAISE EXCEPTION 'v2_timetable_too_many_matches' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p->'replacements','[]')) LOOP
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'duplicates') d WHERE d->>'kind'=item->>'kind' AND d->>'id'=item->>'id' AND d->>'revision'=item->>'revision')
 THEN RAISE EXCEPTION 'v2_timetable_replacement_changed' USING ERRCODE='40001';END IF;END LOOP;
 FOR candidate IN SELECT value FROM jsonb_array_elements(result->'duplicates') LOOP
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p->'replacements','[]')) d WHERE d->>'kind'=candidate->>'kind' AND d->>'id'=candidate->>'id') THEN
  subject:=CASE candidate->>'kind' WHEN 'lead' THEN (candidate->>'id')::uuid ELSE (SELECT source_subject_id FROM public.v2_admin_timetable_entries WHERE run_subject_id=(candidate->>'id')::uuid) END;
  SELECT s.revision INTO revision FROM public.v2_subjects s WHERE s.id=subject;
  IF revision IS NULL THEN RAISE EXCEPTION 'v2_timetable_replacement_changed' USING ERRCODE='40001';END IF;
  targets:=targets||jsonb_build_array(candidate||jsonb_build_object('routeId',subject,'routeRevision',revision::text));
 ELSE remaining:=remaining||jsonb_build_array(candidate);END IF;
 END LOOP;
 RETURN result||jsonb_build_object('duplicates',remaining,'replacements',targets,'stateDigest',public.v2_assessment_hash(jsonb_build_array(result->'stateDigest',targets)));
END;$$;
CREATE FUNCTION public.v2_timetable_apply_replacements(actor varchar,command uuid,preview jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target jsonb;result jsonb;BEGIN
 FOR target IN SELECT value FROM jsonb_array_elements(preview->'replacements') LOOP
 IF EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals WHERE route_subject_id=(target->>'routeId')::uuid) THEN CONTINUE;END IF;
 result:=public.v2_api_admin_route_action(actor,md5(command::text||(target->>'routeId'))::uuid,jsonb_build_object('routeId',target->'routeId','revision',target->>'routeRevision',
 'operation','remove','reason','duplicate','expiresAt',floor(extract(epoch FROM clock_timestamp())*1000)+300000,'removalId',NULL));
 IF result->>'outcome'<>'removed' THEN RAISE EXCEPTION 'v2_timetable_replacement_changed' USING ERRCODE='40001';END IF;
 END LOOP;
END;$$;
DO $$ DECLARE definition text;anchor text:=E' END LOOP;\n RETURN public.v2_api_admin_timetable_receipt(actor,request);';BEGIN
 definition:=replace(pg_get_functiondef('public.v2_api_admin_timetable_action(varchar,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'timetable_action_baseline_changed';END IF;
 EXECUTE replace(definition,anchor,E' END LOOP;\n PERFORM public.v2_timetable_apply_replacements(actor,request,preview);\n RETURN public.v2_api_admin_timetable_receipt(actor,request);');
END;$$;
DO $$ DECLARE f text;r text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_timetable_proposal_valid(jsonb)','public.v2_timetable_proposal_valid_original(jsonb)',
 'public.v2_timetable_preview_original(varchar,jsonb)','public.v2_api_admin_timetable_preview(varchar,jsonb)','public.v2_timetable_apply_replacements(varchar,uuid,jsonb)'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END;$$;

CREATE OR REPLACE FUNCTION public.v2_api_admin_timetable_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('kind','timetable','id',t.id,'outcome','approved','actorErased',t.actor_user_id IS NULL,'sourceErased',t.erased,'createdAt',t.created_at,
  'replacedRecords',coalesce(t.proposal->'replacements','[]'::jsonb),'departureCount',(SELECT count(*) FROM public.v2_admin_timetable_entries e WHERE e.timetable_id=t.id),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('runId',e.run_subject_id,'ordinal',e.ordinal,
   'properties',(SELECT jsonb_agg(jsonb_build_object('field',p.field_key,'reviewId',p.review_id,'sourceErased',p.contribution_id IS NULL OR (p.writer_kind<>'header' AND p.observation_id IS NULL)) ORDER BY p.field_key)
    FROM public.v2_admin_timetable_properties p WHERE p.run_subject_id=e.run_subject_id)) ORDER BY e.ordinal)
   FROM public.v2_admin_timetable_entries e WHERE e.timetable_id=t.id),'[]'::jsonb)) INTO result
  FROM public.v2_admin_timetables t WHERE t.id=request;
 RETURN COALESCE(result,'{"found":false}'::jsonb);
END;$$;
$timetable_migration_5$;
 IF encode(sha256(convert_to(replace(sql,E'\r\n',E'\n'),'UTF8')),'hex')<>'cea55115285049a8685f985430416df9d9c540dc077b8f70ff2b3f44be4a8a24' THEN RAISE EXCEPTION 'timetable_embedded_hash_changed';END IF;
 EXECUTE sql;
 INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0047_timetable_management.sql','cea55115285049a8685f985430416df9d9c540dc077b8f70ff2b3f44be4a8a24');
 END IF;
 FOREACH f IN ARRAY ARRAY['public.v2_api_admin_timetable_preview(varchar,jsonb)','public.v2_api_admin_timetable_action(varchar,uuid,jsonb)','public.v2_api_admin_timetable_receipt(varchar,uuid)','public.v2_api_admin_timetable_operators(varchar,text)','public.v2_api_admin_timetable_records(varchar,uuid)','public.v2_api_admin_timetable_command(varchar,uuid,jsonb)','public.v2_api_admin_timetable_command_receipt(varchar,uuid)'] LOOP
 SELECT p.* INTO spec FROM pg_proc p WHERE p.oid=to_regprocedure(f);
 IF NOT FOUND OR NOT spec.prosecdef OR spec.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] OR spec.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'timetable_backend_facade_changed: %',f;END IF;
 IF complete THEN IF NOT has_function_privilege('mabhazi_api',spec.oid,'EXECUTE') THEN RAISE EXCEPTION 'timetable_backend_grant_changed: %',f;END IF;
 ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f);END IF;
 END LOOP;
 FOR spec IN SELECT p.oid,p.proname,p.proacl,p.proowner,p.prosecdef,p.proconfig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND (p.proname LIKE 'v2%timetable%' OR p.proname IN('v2_api_public_timetable_reports')) LOOP
 IF spec.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
 OR EXISTS(SELECT 1 FROM aclexplode(coalesce(spec.proacl,acldefault('f',spec.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,spec.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'timetable_public_function_access_changed: %',spec.proname;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(expected) x(name text,checksum text) LEFT JOIN mabhazi_migrations.applied a USING(name) WHERE a.checksum IS DISTINCT FROM x.checksum)
 THEN RAISE EXCEPTION 'timetable_post_ledger_changed';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN unnest(ARRAY['public.v2_admin_timetables','public.v2_admin_timetable_entries','public.v2_admin_timetable_properties','public.v2_admin_timetable_commands','public.v2_public_supported_route_reports','public.v2_public_contributable_route_reports']) t
 WHERE r.rolname IN('anon','authenticated') AND has_table_privilege(r.oid,t,'SELECT,INSERT,UPDATE,DELETE')) THEN RAISE EXCEPTION 'timetable_public_relation_access_changed';END IF;
END;$activate_timetables$;
COMMIT;
SELECT clock_timestamp() checked_at,(SELECT count(*) FROM mabhazi_migrations.applied) ledger_entries,
 (SELECT count(*) FROM public.v2_admin_timetables) timetables,(SELECT count(*) FROM public.v2_admin_timetable_commands) management_actions;
