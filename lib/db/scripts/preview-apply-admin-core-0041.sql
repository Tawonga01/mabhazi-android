-- Mabhazi Preview ocwlqhlfavvuncfmzuqh ONLY. No role/account grant.
-- One private evidence table, two restricted backend actions; no record is corrected by this script.
BEGIN;
SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $core_guard$
DECLARE previous text;spec jsonb;fn record;relation text;before_data jsonb;before_functions jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset('[{"name":"0000_initial.sql","checksum":"47816e783afdcbb778d16a4afbb23b2053ad5532fab1e06af7bbf9696115a38e"},{"name":"0001_api_role.sql","checksum":"1a4e952d4a7179075825ab142a38a751cc58a7919e3cf8b981ead546108283e4"},{"name":"0002_contribution_intake.sql","checksum":"b6a8edf014efd7f71531f21205f23c49f1bb0166b43374538a748074f0db25b8"},{"name":"0003_transport_structure.sql","checksum":"7bd24b0451546a40be14f6b8aef127c99c52eba710a812ee4f9e8feaae46b811"},{"name":"0004_review_decisions.sql","checksum":"d22083cdab91f0dc04b46016ebd200a3a3b0ead7229ba981452d27f5f7ba9a5a"},{"name":"0005_derived_decisions.sql","checksum":"62a6d76851d50cfab7754051618a4ac98c056e36a129629190140a107701442f"},{"name":"0006_observation_registry.sql","checksum":"ac310e0a630f58ac09b7bf254c1c8a4afefcd9bc8a6114e6cf89f72d4dfc353f"},{"name":"0007_observation_events.sql","checksum":"b47f0267431ac955faf6ad31981ed7b0133d5d63704b6a27a62c10330b814b21"},{"name":"0008_observation_targets.sql","checksum":"1cfb37200fa370708b9cb22fb46fc41a3704c40636028f84dc61da41bacf598e"},{"name":"0009_source_identity.sql","checksum":"e47a6b7e48bad9a7a2989da14c37a78d20f449c8680f09c439acd159d716190e"},{"name":"0010_evidence_assessments.sql","checksum":"0ccce5368dbf67f14facbc675943c8e094fe37b4dc57b32a770633be81c0dff2"},{"name":"0011_field_resolution.sql","checksum":"f086418f2525b85004d9a05da3b3169e2c1d2afe709e0c43b146a23002d1e572"},{"name":"0012_affiliation_issuers.sql","checksum":"e31320e5eff22ae28d159d5cb6ae95aee7b8aad9b5672d3f7e414fa1f12a1d17"},{"name":"0013_prompt_tasks.sql","checksum":"ab2446b8b4f161bb8bb8b39216f41fb12afd8738256fcd8ce0518171cf0a9b2e"},{"name":"0014_transport_propagation.sql","checksum":"44ff4ec120e21b61c128ef1ceabce3544f6cfad46ea6182315ea53e3c8ab1073"},{"name":"0015_transport_writers.sql","checksum":"6abb4def1d7b30854efe5f0a0371d3c278032f4e03f93b0c27d498b03281bea6"},{"name":"0016_lead_creation.sql","checksum":"748a3f024dedbd96dadef972a00af01d354cdf5a09711526a2ad228ebfa400e0"},{"name":"0017_transport_uuid_normalization.sql","checksum":"846f54fbcfa6446f94e08bdc5306e3cd895256da78d4dff87b40eedd2ed0b96e"},{"name":"0018_transport_creation.sql","checksum":"2b762ee0c3b9c5dab2ccf4f25286df25c4f5c3fdec31f3fe599157f4dce1d1d2"},{"name":"0019_route_pattern_creation.sql","checksum":"27fe4e63f14d665e5406296a44e693bc637b0c306c19efcb9778bc317f9d08ab"},{"name":"0020_service_run_creation.sql","checksum":"d25bd19870fe1307e5b00f75a98a3cccdc1317abedfb02c503109019f965dacd"},{"name":"0021_actual_journey_intake.sql","checksum":"2d5461ea7563dcbbb9b00a9aeac31e7994d0e9305583c251ad301acf25a696e9"},{"name":"0022_minimum_lead_api.sql","checksum":"e74223a70810dc43e0a416b26bf5698368872209fe51bde0a083341a2d95ab9e"},{"name":"0023_normalise_worker.sql","checksum":"8ab0d9f3db1d4ef2dd9e1d1dca00e26f715be963e364e08753e27a2c6cd61ae6"},{"name":"0024_lead_association_worker.sql","checksum":"7b889f2489bc07974ba34e929fbd207be77c1a446e11b381db4b9b09ec74e68d"},{"name":"0025_pattern_association_worker.sql","checksum":"388ba5d4a602d834d8fd8bcbe684b0180f6f98ab2f0f5e75e355fe99ea65eefe"},{"name":"0026_identity_lookup.sql","checksum":"9f5ab9ce65f9911c11ae866d79e88c56b693dc71780f02faf9941197e42ede32"},{"name":"0027_journey_processing.sql","checksum":"48106d054caadd7d97805b7143b69e08f0311b6153645fcbf9b5ce53cd2173a2"},{"name":"0028_actual_journey_api.sql","checksum":"7ab8860ddb09de0cf68ce64c0be883f3718184c4f0a68cff768ae0dce75fe705"},{"name":"0029_empty_search_minimum.sql","checksum":"7537057d3167b540df14c14c52adeda006079d366669bbb257f4d533a1227762"},{"name":"0030_public_route_context.sql","checksum":"b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36"},{"name":"0031_assessment_worker.sql","checksum":"ae4a5a5017046775147eaf562c90f234e23c47f28e90f11edd81ff94f7c60000"},{"name":"0032_public_fare_reports.sql","checksum":"b8b9d1d0d8136d9c477c3890bdfd52b93be1f81c2fce208978eeb2e05fb15f47"},{"name":"0033_prompt_refresh_worker.sql","checksum":"abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896"},{"name":"0034_route_place_observations.sql","checksum":"0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5"},{"name":"0035_route_place_reports.sql","checksum":"19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a"},{"name":"0036_pickup_question_api.sql","checksum":"e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86"},{"name":"0037_prompt_controls_api.sql","checksum":"0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0"},{"name":"0038_pickup_invitation_api.sql","checksum":"62c6215beeb1fff21a9bea934cea0b4906fec3c2c1f389b5c31f174c18af51e1"},{"name":"0039_admin_property_batches.sql","checksum":"09c61f1a7c5e4b1252f70243a8aacaf4f39669aef60193610250dc9697db2de5"},{"name":"0040_admin_route_visibility.sql","checksum":"4598a5a24c8e9c6b1203c44e9fb6ee7b1897ef03f51dd16f6ea1b2a843415a8d"}]'::jsonb) expected(name text,checksum text)
  LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR EXISTS(SELECT 1 FROM mabhazi_migrations.applied WHERE name<>ALL(ARRAY['0000_initial.sql','0001_api_role.sql','0002_contribution_intake.sql','0003_transport_structure.sql','0004_review_decisions.sql','0005_derived_decisions.sql','0006_observation_registry.sql','0007_observation_events.sql','0008_observation_targets.sql','0009_source_identity.sql','0010_evidence_assessments.sql','0011_field_resolution.sql','0012_affiliation_issuers.sql','0013_prompt_tasks.sql','0014_transport_propagation.sql','0015_transport_writers.sql','0016_lead_creation.sql','0017_transport_uuid_normalization.sql','0018_transport_creation.sql','0019_route_pattern_creation.sql','0020_service_run_creation.sql','0021_actual_journey_intake.sql','0022_minimum_lead_api.sql','0023_normalise_worker.sql','0024_lead_association_worker.sql','0025_pattern_association_worker.sql','0026_identity_lookup.sql','0027_journey_processing.sql','0028_actual_journey_api.sql','0029_empty_search_minimum.sql','0030_public_route_context.sql','0031_assessment_worker.sql','0032_public_fare_reports.sql','0033_prompt_refresh_worker.sql','0034_route_place_observations.sql','0035_route_place_reports.sql','0036_pickup_question_api.sql','0037_prompt_controls_api.sql','0038_pickup_invitation_api.sql','0039_admin_property_batches.sql','0040_admin_route_visibility.sql','0041_admin_core_corrections.sql']))
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT BETWEEN 41 AND 42 THEN RAISE EXCEPTION 'core_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0041_admin_core_corrections.sql';
 IF previous IS NOT NULL AND previous<>'1ce9acc770cbd0c54475c978e81b27aca2dfe199dcb019db196802e832bc773c' THEN RAISE EXCEPTION 'core_preview_hash_changed';END IF;
 SELECT jsonb_build_array((SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_targets x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x)),(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname<>ALL(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch','v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action','v2_prompt_eligible','v2_submit_actual_journey','v2_api_route_report_action','v2_admin_core_guard','v2_admin_core_propagate','v2_admin_core_dependency_count','v2_admin_core_link_guard','v2_api_admin_core_receipt','v2_api_admin_core_action'])) INTO before_data,before_functions;
 IF previous IS NULL THEN
  FOR spec IN SELECT value FROM jsonb_array_elements('[{"name":"v2_admin_require","signature":"public.v2_admin_require(varchar)","returns":"void","backend":false,"definer":false,"volatility":"v","hash":"2f08be4a4d9f2dfbea63d541f43a2a6ac8a69e1669e2e61332ca860a4cf0dae2"},{"name":"v2_admin_history_guard","signature":"public.v2_admin_history_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"62b6d6e428ccb2e0a566454998eba1a43876ea9a66ea6933dbb02a1b324bf5b3"},{"name":"v2_api_admin_batch_receipt","signature":"public.v2_api_admin_batch_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"93ff8c60129278813fe18bf0372d1139a387fafbecc36b714c4bfcce25f72477"},{"name":"v2_api_admin_property_batch","signature":"public.v2_api_admin_property_batch(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"695af4d6fe7255bc7c772a853c1df9f82d38e597043eff30eb6fe8e242224dd9"},{"name":"v2_admin_route_action_guard","signature":"public.v2_admin_route_action_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"16d96eb3b83b8799174108b2ea0d43c7ea432fbf22f5c27749907dcd0c3bc458"},{"name":"v2_admin_route_action_propagate","signature":"public.v2_admin_route_action_propagate()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"8602707d14654207b2fca989c6a495d736c456fcedc4b8f09cb38487fb4f79bd"},{"name":"v2_api_admin_route_action_receipt","signature":"public.v2_api_admin_route_action_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"b027e3d173f5dff5d09ce58363e69259c678a1858fb46a93e787fcbf7a7a4a59"},{"name":"v2_api_admin_route_action","signature":"public.v2_api_admin_route_action(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"a1c7976dd6394610760f002fdf6b9d77eed6101b4d2a4e34b91e5fe8599dbc4a"},{"name":"v2_prompt_eligible","signature":"public.v2_prompt_eligible(uuid,varchar,text[])","returns":"boolean","backend":false,"definer":false,"volatility":"s","hash":"55a6a5498690d4e6a2bf745803126d187860378e7d96927dd59bf93959aa6708"},{"name":"v2_submit_actual_journey","signature":"public.v2_submit_actual_journey(varchar,text,jsonb)","returns":"jsonb","backend":false,"definer":true,"volatility":"v","hash":"d081fdd558099dc179273b26f2c8b8e1a8505eb277603c2a6df0100f8e93cf38"},{"name":"v2_api_route_report_action","signature":"public.v2_api_route_report_action(varchar,uuid,text,text)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"4b1495c3da220e0b6df2b2da15e9f7ad26590dcf4c5fbfd7b9a59a3f611fce23"}]'::jsonb) LOOP
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
  EXECUTE $expected_core_old_source_expected$CREATE TEMPORARY VIEW core_old_source_expected AS SELECT l.subject_id,s.revision,c.user_id AS author_user_id,corridor.origin_city_id,corridor.destination_city_id,
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
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals h WHERE h.route_subject_id=l.subject_id);$expected_core_old_source_expected$;
 IF pg_get_viewdef('public.v2_public_lead_reports'::regclass)<>pg_get_viewdef('pg_temp.core_old_source_expected'::regclass) THEN RAISE EXCEPTION 'core_view_changed: v2_public_lead_reports';END IF;
 DROP VIEW pg_temp.core_old_source_expected;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['v2_admin_core_actions','v2_admin_current_core','v2_public_core_source_reports','v2_public_reviewed_lead_reports']) n WHERE to_regclass('public.'||n) IS NOT NULL)
   OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['v2_admin_core_guard','v2_admin_core_propagate','v2_admin_core_dependency_count','v2_admin_core_link_guard','v2_api_admin_core_receipt','v2_api_admin_core_action'])) THEN RAISE EXCEPTION 'core_partial_or_unrecorded';END IF;
  EXECUTE $core_source$-- Attributed corrections to community reports. Original intake/observations stay
-- immutable. One action changes/reverses one property, never a whole route.
CREATE TABLE public.v2_admin_core_actions(
 id uuid PRIMARY KEY,
 position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 route_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),
 request_digest text,
 operation text NOT NULL CHECK(operation IN('correct','reverse')),
 field_key text NOT NULL CHECK(field_key IN('route.origin','route.destination','operator.reported','departure.reported')),
 proposed_value jsonb,
 corrected_city_id integer GENERATED ALWAYS AS ((proposed_value->>'cityId')::integer) STORED REFERENCES public.cities(id),
 knowledge_basis text NOT NULL CHECK(knowledge_basis IN('unprovided','travelled','saw_operating','observed_sign','operator_statement','heard_from_other')),
 observed_date date,
 reason_code text NOT NULL CHECK(reason_code IN('source_checked','typing_error','operator_checked','decision_incorrect')),
 expected_revision bigint NOT NULL CHECK(expected_revision BETWEEN 1 AND 9007199254740991),
 reversed_action_id uuid REFERENCES public.v2_admin_core_actions(id),
 outcome text NOT NULL CHECK(outcome IN('corrected','reversed','changed','unavailable','unsafe_dependencies','already_reversed','unchanged')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(((actor_user_id IS NULL OR contribution_id IS NULL) AND request_digest IS NULL)
  OR (actor_user_id IS NOT NULL AND contribution_id IS NOT NULL AND request_digest IS NOT NULL AND request_digest~'^[0-9a-f]{64}$')),
 CHECK((operation='correct' AND reversed_action_id IS NULL) OR (operation='reverse' AND reversed_action_id IS NOT NULL))
);
CREATE INDEX v2_admin_core_actions_route_idx ON public.v2_admin_core_actions(route_subject_id,position);
CREATE INDEX v2_admin_core_actions_source_idx ON public.v2_admin_core_actions(contribution_id);
CREATE UNIQUE INDEX v2_admin_core_reversed_once ON public.v2_admin_core_actions(reversed_action_id) WHERE outcome='reversed';

-- Keep erased latest corrections as value-free tombstones: erasure must not
-- silently resurrect an original value that was corrected as inaccurate.
CREATE VIEW public.v2_admin_current_core AS
 SELECT DISTINCT ON(a.route_subject_id,a.field_key) a.*
 FROM public.v2_admin_core_actions a WHERE a.outcome='corrected'
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_core_actions r WHERE r.reversed_action_id=a.id AND r.outcome='reversed')
 ORDER BY a.route_subject_id,a.field_key,a.position DESC;

CREATE FUNCTION public.v2_admin_core_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1
  AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR NEW.actor_user_id IS NULL)
  AND (NEW.contribution_id IS NOT DISTINCT FROM OLD.contribution_id OR NEW.contribution_id IS NULL)
  AND to_jsonb(NEW)-ARRAY['actor_user_id','contribution_id','request_digest','proposed_value','observed_date','corrected_city_id']
   =to_jsonb(OLD)-ARRAY['actor_user_id','contribution_id','request_digest','proposed_value','observed_date','corrected_city_id'] THEN
  IF NEW.actor_user_id IS NULL OR NEW.contribution_id IS NULL THEN
   NEW.request_digest:=NULL;NEW.proposed_value:=NULL;NEW.observed_date:=NULL;
  ELSIF NEW.proposed_value IS DISTINCT FROM OLD.proposed_value OR NEW.observed_date IS DISTINCT FROM OLD.observed_date
   OR NEW.request_digest IS DISTINCT FROM OLD.request_digest THEN
   RAISE EXCEPTION 'v2_admin_history_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'v2_admin_history_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_admin_core_guard BEFORE UPDATE OR DELETE ON public.v2_admin_core_actions
 FOR EACH ROW EXECUTE FUNCTION public.v2_admin_core_guard();
CREATE FUNCTION public.v2_admin_core_propagate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.outcome IN('corrected','reversed') OR TG_OP='UPDATE' THEN
  PERFORM public.v2_transport_propagate(ARRAY[NEW.route_subject_id],'v2_admin_core_actions','UPDATE',ARRAY['reviewed_core']);
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_admin_core_propagate AFTER INSERT OR UPDATE ON public.v2_admin_core_actions
 FOR EACH ROW EXECUTE FUNCTION public.v2_admin_core_propagate();

-- A correction that might change the identity of linked transport must go
-- through the later explicit identity workflow; never carry fares/places over.
CREATE FUNCTION public.v2_admin_core_dependency_count(route uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*) FROM public.v2_actual_journeys a WHERE a.intended_subject_id=route)
  +(SELECT count(*) FROM public.v2_observations o JOIN public.v2_leads l ON l.subject_id=route
    WHERE o.original_subject_id=route AND (o.contribution_id IS DISTINCT FROM l.initial_contribution_id
     OR o.field_key NOT IN('operator.reported','departure.reported')))
  +(SELECT count(*) FROM public.v2_leads l WHERE l.subject_id=route AND l.operator_subject_id IS NOT NULL)
  +(SELECT count(*) FROM public.v2_association_links l WHERE l.from_subject_id=route OR l.to_subject_id=route)
  +(SELECT count(*) FROM public.v2_observation_targets t JOIN public.v2_observations o ON o.id=t.observation_id
    WHERE o.original_subject_id=route AND t.assignment_id IS NOT NULL)
$$;

CREATE FUNCTION public.v2_admin_core_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_admin_current_core a WHERE a.route_subject_id IN(NEW.from_subject_id,NEW.to_subject_id)) THEN
  RAISE EXCEPTION 'v2_corrected_core_identity_review_required' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER v2_admin_core_link_guard BEFORE INSERT OR UPDATE ON public.v2_association_links
 FOR EACH ROW EXECUTE FUNCTION public.v2_admin_core_link_guard();

CREATE FUNCTION public.v2_api_admin_core_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('id',a.id,'operation',a.operation,'routeId',a.route_subject_id,'field',a.field_key,
  'value',a.proposed_value,'basis',a.knowledge_basis,'observedDate',a.observed_date,'reason',a.reason_code,
  'reversedActionId',a.reversed_action_id,'outcome',a.outcome,'createdAt',a.created_at,
  'actorErased',a.actor_user_id IS NULL,'sourceErased',a.contribution_id IS NULL,'actorId',a.actor_user_id,
  'effect',CASE WHEN a.outcome IN('corrected','reversed') THEN 'reviewed_core_changed' ELSE 'unchanged' END)
 INTO result FROM public.v2_admin_core_actions a WHERE a.id=request;
 RETURN coalesce(result,'{"found":false}'::jsonb);
END;$$;

CREATE FUNCTION public.v2_api_admin_core_action(actor varchar,request uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_admin_core_actions;original public.v2_admin_core_actions;route uuid;source uuid;revision bigint;
 digest text;operation text;field text;proposal jsonb;basis text;observed date;reason text;reverse_id uuid;result text;current_value jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM public.v2_admin_require(actor);
 IF request IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object'
  OR input-ARRAY['routeId','revision','operation','field','value','basis','observedDate','reason','reversedActionId','expiresAt']<>'{}'
  OR NOT input?&ARRAY['routeId','revision','operation','field','value','basis','observedDate','reason','reversedActionId','expiresAt']
  OR NOT public.v2_json_uuid(input->'routeId')
  OR jsonb_typeof(input->'revision') IS DISTINCT FROM 'string' OR input->>'revision'!~'^[1-9][0-9]{0,15}$'
  OR (input->>'revision')::bigint>9007199254740991
  OR jsonb_typeof(input->'expiresAt') IS DISTINCT FROM 'number' OR input->>'expiresAt'!~'^[1-9][0-9]{0,15}$'
  OR coalesce(input->>'operation','') NOT IN('correct','reverse')
  OR coalesce(input->>'field','') NOT IN('route.origin','route.destination','operator.reported','departure.reported')
  OR coalesce(input->>'basis','') NOT IN('unprovided','travelled','saw_operating','observed_sign','operator_statement','heard_from_other')
  OR coalesce(input->>'reason','') NOT IN('source_checked','typing_error','operator_checked','decision_incorrect')
  OR input->'observedDate'<>'null'::jsonb AND NOT public.v2_json_date(input->'observedDate') THEN
  RAISE EXCEPTION 'v2_admin_core_invalid' USING ERRCODE='23514';END IF;
 route:=(input->>'routeId')::uuid;operation:=input->>'operation';field:=input->>'field';proposal:=input->'value';
 basis:=input->>'basis';observed:=(input->>'observedDate')::date;reason:=input->>'reason';reverse_id:=(input->>'reversedActionId')::uuid;
 IF observed>current_date+1 OR operation='correct' AND input->'reversedActionId'<>'null'::jsonb
  OR operation='reverse' AND (NOT public.v2_json_uuid(input->'reversedActionId') OR proposal<>'null'::jsonb
   OR basis<>'unprovided' OR observed IS NOT NULL) THEN RAISE EXCEPTION 'v2_admin_core_invalid' USING ERRCODE='23514';END IF;
 IF operation='correct' THEN
  IF field IN('route.origin','route.destination') THEN
   IF NOT coalesce(jsonb_typeof(proposal)='object' AND proposal-'cityId'='{}' AND jsonb_typeof(proposal->'cityId')='number'
    AND proposal->>'cityId'~'^[1-9][0-9]{0,9}$' AND (proposal->>'cityId')::numeric<=2147483647,false) THEN
    RAISE EXCEPTION 'v2_admin_core_invalid' USING ERRCODE='23514';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.cities WHERE id=(proposal->>'cityId')::integer) THEN RAISE EXCEPTION 'v2_admin_city_unavailable' USING ERRCODE='23503';END IF;
  ELSIF field='operator.reported' THEN
   IF NOT coalesce(jsonb_typeof(proposal)='object' AND proposal-'name'='{}' AND public.v2_json_text(proposal->'name',120)
     AND proposal->>'name'=btrim(proposal->>'name'),false) THEN RAISE EXCEPTION 'v2_admin_core_invalid' USING ERRCODE='23514';END IF;
  ELSE
   IF NOT coalesce(jsonb_typeof(proposal)='object' AND proposal-ARRAY['time','basis']='{}' AND proposal?&ARRAY['time','basis']
    AND jsonb_typeof(proposal->'time')='string' AND proposal->>'time'~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND proposal->>'basis' IN('unspecified','scheduled','actual'),false) THEN RAISE EXCEPTION 'v2_admin_core_invalid' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,input-'expiresAt'));
 SELECT * INTO prior FROM public.v2_admin_core_actions WHERE id=request;
 IF FOUND THEN
  IF prior.actor_user_id IS DISTINCT FROM actor OR prior.request_digest IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'v2_admin_request_conflict' USING ERRCODE='23514';END IF;
  RETURN public.v2_api_admin_core_receipt(actor,request);
 END IF;
 IF (input->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000
  OR (input->>'expiresAt')::numeric>extract(epoch FROM clock_timestamp())*1000+330000 THEN
  RAISE EXCEPTION 'v2_admin_preview_expired' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=route) THEN RAISE EXCEPTION 'v2_admin_route_unavailable' USING ERRCODE='23503';END IF;
 SELECT s.revision,c.id INTO revision,source FROM public.v2_leads l JOIN public.v2_subjects s ON s.id=l.subject_id AND s.lifecycle='active'
  JOIN public.v2_contributions c ON c.id=l.initial_contribution_id AND c.original_subject_id=l.subject_id
  JOIN public.users author ON author.id=c.user_id WHERE l.subject_id=route AND l.intake_kind='community' AND NOT l.attribution_erased;
 IF NOT FOUND THEN result:='unavailable';
 ELSIF revision<>(input->>'revision')::bigint THEN result:='changed';
 ELSIF operation='reverse' THEN
  SELECT * INTO original FROM public.v2_admin_core_actions WHERE id=reverse_id;
  IF NOT FOUND OR original.route_subject_id<>route OR original.field_key<>field OR original.outcome<>'corrected'
   OR original.contribution_id IS DISTINCT FROM source OR original.actor_user_id IS NULL OR original.proposed_value IS NULL THEN result:='unavailable';
  ELSIF EXISTS(SELECT 1 FROM public.v2_admin_core_actions WHERE reversed_action_id=reverse_id AND outcome='reversed') THEN result:='already_reversed';
  ELSIF public.v2_admin_core_dependency_count(route)>0 THEN result:='unsafe_dependencies';
  ELSE result:='reversed';END IF;
 ELSIF public.v2_admin_core_dependency_count(route)>0 THEN result:='unsafe_dependencies';
 ELSE result:='corrected';
 END IF;
 IF result='corrected' THEN
  IF field IN('route.origin','route.destination') THEN
   SELECT jsonb_build_object('cityId',CASE field WHEN 'route.origin' THEN co.origin_city_id ELSE co.destination_city_id END)
    INTO current_value FROM public.v2_leads l JOIN public.v2_corridors co ON co.id=l.corridor_id WHERE l.subject_id=route;
  ELSE
   SELECT o.value INTO current_value FROM public.v2_observations o WHERE o.contribution_id=source AND o.field_key=field;
  END IF;
  IF EXISTS(SELECT 1 FROM public.v2_admin_current_core a WHERE a.route_subject_id=route AND a.field_key=field) THEN
   SELECT a.proposed_value INTO current_value FROM public.v2_admin_current_core a WHERE a.route_subject_id=route AND a.field_key=field;
  END IF;
  IF proposal=current_value THEN result:='unchanged';END IF;
  IF field IN('route.origin','route.destination') AND proposal->>'cityId'=coalesce(
   (SELECT a.proposed_value->>'cityId' FROM public.v2_admin_current_core a WHERE a.route_subject_id=route
    AND a.field_key=CASE field WHEN 'route.origin' THEN 'route.destination' ELSE 'route.origin' END),
   (SELECT CASE field WHEN 'route.origin' THEN co.destination_city_id ELSE co.origin_city_id END::text
    FROM public.v2_leads l JOIN public.v2_corridors co ON co.id=l.corridor_id WHERE l.subject_id=route)) THEN
   RAISE EXCEPTION 'v2_admin_same_city' USING ERRCODE='23514';END IF;
 END IF;
 INSERT INTO public.v2_admin_core_actions(id,actor_user_id,contribution_id,route_subject_id,request_digest,operation,field_key,
  proposed_value,knowledge_basis,observed_date,reason_code,expected_revision,reversed_action_id,outcome)
 VALUES(request,actor,source,route,CASE WHEN source IS NULL THEN NULL ELSE digest END,operation,field,
  CASE WHEN source IS NULL THEN NULL ELSE proposal END,basis,CASE WHEN source IS NULL THEN NULL ELSE observed END,reason,(input->>'revision')::bigint,reverse_id,result);
 RETURN public.v2_api_admin_core_receipt(actor,request);
END;$$;

-- Retain the exact existing source/safety projection as a private base. Old
-- clients cannot mistake a corrected route's original fields for current ones.
CREATE VIEW public.v2_public_core_source_reports AS SELECT * FROM public.v2_public_lead_reports;
-- The source view above must not depend on the compatibility view that follows.
DO $$DECLARE definition text;BEGIN
 SELECT pg_get_viewdef('public.v2_public_lead_reports'::regclass,true) INTO definition;
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_public_core_source_reports AS '||definition;
END;$$;
CREATE OR REPLACE VIEW public.v2_public_lead_reports AS
 SELECT p.* FROM public.v2_public_core_source_reports p WHERE NOT EXISTS(
  SELECT 1 FROM public.v2_admin_current_core a WHERE a.route_subject_id=p.subject_id);

-- This explicit, opt-in display is new evidence, not a relabelling of the
-- original author. Missing/erased corrected evidence withholds the whole row.
CREATE VIEW public.v2_public_reviewed_lead_reports AS
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
  AND (a.proposed_value IS NULL OR a.actor_user_id IS NULL OR a.contribution_id IS NULL));

-- Until identity-aware contextual intake/association is delivered, corrected
-- cores are readable but not targets for new contextual observations/questions.
DO $$DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('public.v2_prompt_eligible(uuid,varchar,text[])'::regprocedure) INTO definition;
 IF strpos(definition,'BEGIN')=0 THEN RAISE EXCEPTION 'v2_core_prompt_definition_changed';END IF;
 definition:=replace(definition,'BEGIN','BEGIN'||E'\n IF EXISTS(SELECT 1 FROM public.v2_question_tasks core_task JOIN public.v2_admin_current_core a ON a.route_subject_id=core_task.subject_id WHERE core_task.id=task) THEN RETURN false;END IF;');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.v2_submit_actual_journey(varchar,text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,'IF intended_id IS NOT NULL THEN')=0 THEN RAISE EXCEPTION 'v2_core_intake_definition_changed';END IF;
 definition:=replace(definition,'IF intended_id IS NOT NULL THEN','IF intended_id IS NOT NULL THEN'||E'\n IF EXISTS(SELECT 1 FROM public.v2_admin_current_core a WHERE a.route_subject_id=intended_id) THEN RAISE EXCEPTION ''v2_actual_intended_subject_unavailable'' USING ERRCODE=''23503'';END IF;');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.v2_api_route_report_action(varchar,uuid,text,text)'::regprocedure) INTO definition;
 IF strpos(definition,'public.v2_public_lead_reports')=0 THEN RAISE EXCEPTION 'v2_core_safety_definition_changed';END IF;
 definition:=replace(definition,'public.v2_public_lead_reports','public.v2_public_reviewed_lead_reports');
 EXECUTE definition;
END;$$;

DO $$DECLARE r text;f record;t text;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_admin_core_actions','v2_admin_current_core','v2_public_core_source_reports','v2_public_reviewed_lead_reports'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 ALTER TABLE public.v2_admin_core_actions ENABLE ROW LEVEL SECURITY;
 CREATE POLICY v2_admin_core_api ON public.v2_admin_core_actions FOR SELECT TO mabhazi_api USING(true);
 FOR f IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('v2_admin_core_guard','v2_admin_core_propagate','v2_admin_core_dependency_count','v2_admin_core_link_guard','v2_api_admin_core_receipt','v2_api_admin_core_action') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  IF f.proname LIKE 'v2_api_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f.signature);END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;
$core_source$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0041_admin_core_corrections.sql','1ce9acc770cbd0c54475c978e81b27aca2dfe199dcb019db196802e832bc773c');
 END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements('[{"name":"v2_admin_require","signature":"public.v2_admin_require(varchar)","returns":"void","backend":false,"definer":false,"volatility":"v","hash":"2f08be4a4d9f2dfbea63d541f43a2a6ac8a69e1669e2e61332ca860a4cf0dae2"},{"name":"v2_admin_history_guard","signature":"public.v2_admin_history_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"62b6d6e428ccb2e0a566454998eba1a43876ea9a66ea6933dbb02a1b324bf5b3"},{"name":"v2_api_admin_batch_receipt","signature":"public.v2_api_admin_batch_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"93ff8c60129278813fe18bf0372d1139a387fafbecc36b714c4bfcce25f72477"},{"name":"v2_api_admin_property_batch","signature":"public.v2_api_admin_property_batch(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"695af4d6fe7255bc7c772a853c1df9f82d38e597043eff30eb6fe8e242224dd9"},{"name":"v2_admin_route_action_guard","signature":"public.v2_admin_route_action_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"16d96eb3b83b8799174108b2ea0d43c7ea432fbf22f5c27749907dcd0c3bc458"},{"name":"v2_admin_route_action_propagate","signature":"public.v2_admin_route_action_propagate()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"8602707d14654207b2fca989c6a495d736c456fcedc4b8f09cb38487fb4f79bd"},{"name":"v2_api_admin_route_action_receipt","signature":"public.v2_api_admin_route_action_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"b027e3d173f5dff5d09ce58363e69259c678a1858fb46a93e787fcbf7a7a4a59"},{"name":"v2_api_admin_route_action","signature":"public.v2_api_admin_route_action(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"a1c7976dd6394610760f002fdf6b9d77eed6101b4d2a4e34b91e5fe8599dbc4a"},{"name":"v2_prompt_eligible","signature":"public.v2_prompt_eligible(uuid,varchar,text[])","returns":"boolean","backend":false,"definer":false,"volatility":"s","hash":"42fcacaaf504ed63324a8cafa31fb84cbc58feea59608bb96b8f4f91c8595afc"},{"name":"v2_submit_actual_journey","signature":"public.v2_submit_actual_journey(varchar,text,jsonb)","returns":"jsonb","backend":false,"definer":true,"volatility":"v","hash":"f5db4b2b5dd243719a1727a1045ab2c9d7681330a369b7f7d808c57de66f40fa"},{"name":"v2_api_route_report_action","signature":"public.v2_api_route_report_action(varchar,uuid,text,text)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"b33124e19098533b34e0cee473585282ad2f4167421478c19a6d9792cb5a4048"},{"name":"v2_admin_core_guard","signature":"public.v2_admin_core_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"416788246f696908aefa4b1244a04aeec0523aa2f1eddd62d271b558b5cb8f79"},{"name":"v2_admin_core_propagate","signature":"public.v2_admin_core_propagate()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"e581e8a194d7e203106df9d9938941e44cc98549f4cf2c3eed2179fa4bc5faed"},{"name":"v2_admin_core_dependency_count","signature":"public.v2_admin_core_dependency_count(uuid)","returns":"integer","backend":false,"definer":false,"volatility":"s","hash":"20f16d1db343df6aa94e0b83c829f3c897412d60cd6d9ad2c386903c2f1b5ab7"},{"name":"v2_admin_core_link_guard","signature":"public.v2_admin_core_link_guard()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"25e213d1b2661c3b2bb3701ccb42e9282abd06d62a63aef02b2a7084b7cd39a9"},{"name":"v2_api_admin_core_receipt","signature":"public.v2_api_admin_core_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"5d03c12ceffea9dd70b0824f68a0cfa5da1139829228e42787791cbe77bd7fcc"},{"name":"v2_api_admin_core_action","signature":"public.v2_api_admin_core_action(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"f8057c0679516fdd7c6b58349775ab9cb443dbebbf315316adde9d922ed31789"}]'::jsonb) LOOP
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
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch','v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action','v2_prompt_eligible','v2_submit_actual_journey','v2_api_route_report_action','v2_admin_core_guard','v2_admin_core_propagate','v2_admin_core_dependency_count','v2_admin_core_link_guard','v2_api_admin_core_receipt','v2_api_admin_core_action'])
  AND oid<>ALL(ARRAY['public.v2_admin_require(varchar)'::regprocedure,'public.v2_admin_history_guard()'::regprocedure,'public.v2_api_admin_batch_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_property_batch(varchar,uuid,jsonb)'::regprocedure,'public.v2_admin_route_action_guard()'::regprocedure,'public.v2_admin_route_action_propagate()'::regprocedure,'public.v2_api_admin_route_action_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_route_action(varchar,uuid,jsonb)'::regprocedure,'public.v2_prompt_eligible(uuid,varchar,text[])'::regprocedure,'public.v2_submit_actual_journey(varchar,text,jsonb)'::regprocedure,'public.v2_api_route_report_action(varchar,uuid,text,text)'::regprocedure,'public.v2_admin_core_guard()'::regprocedure,'public.v2_admin_core_propagate()'::regprocedure,'public.v2_admin_core_dependency_count(uuid)'::regprocedure,'public.v2_admin_core_link_guard()'::regprocedure,'public.v2_api_admin_core_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_core_action(varchar,uuid,jsonb)'::regprocedure])) THEN RAISE EXCEPTION 'core_unexpected_overload';END IF;
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
 DROP VIEW pg_temp.core_expected_3;
 IF jsonb_build_array((SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_targets x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x)) IS DISTINCT FROM before_data OR (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname<>ALL(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch','v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action','v2_prompt_eligible','v2_submit_actual_journey','v2_api_route_report_action','v2_admin_core_guard','v2_admin_core_propagate','v2_admin_core_dependency_count','v2_admin_core_link_guard','v2_api_admin_core_receipt','v2_api_admin_core_action'])) IS DISTINCT FROM before_functions THEN RAISE EXCEPTION 'core_unrelated_state_changed';END IF;
END;$core_guard$;
COMMIT;
SELECT clock_timestamp() checked_at,(SELECT count(*) FROM mabhazi_migrations.applied) ledger_entries,
 (SELECT count(*) FROM public.v2_admin_core_actions) correction_actions;
