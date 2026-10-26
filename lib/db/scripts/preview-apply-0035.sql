-- Mabhazi Preview ocwlqhlfavvuncfmzuqh only. Fresh approval required before execution.
-- Source0035 SHA256 19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a; private presentation tables, two fenced safety actions.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $preview_places_0035$
DECLARE prior text;before_data jsonb;before_functions jsonb;f jsonb;p record;r text;t text;actual_view text;
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
('0034_route_place_observations.sql','0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5')) expected(name,checksum) LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(35,36) THEN RAISE EXCEPTION 'place_preview_baseline_changed';END IF;
 SELECT checksum INTO prior FROM mabhazi_migrations.applied WHERE name='0035_route_place_reports.sql';
 IF prior IS NOT NULL AND prior<>'19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a' THEN RAISE EXCEPTION 'place_preview_hash_changed';END IF;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_targets x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_actual_journeys x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_sources x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_current_fields x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_assessments x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_decisions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_route_report_blocks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_refs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_hides x)) INTO before_data;SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname NOT IN('v2_place_reference_created','v2_place_reference_immutable','v2_api_place_report_context','v2_api_place_report_action','v2_api_hide_reported_place')) INTO before_functions;
 IF prior IS NULL THEN
  IF to_regclass('public.v2_place_report_refs') IS NOT NULL OR to_regclass('public.v2_place_report_hides') IS NOT NULL OR to_regclass('public.v2_place_report_context') IS NOT NULL
   OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_place_reference_created','v2_place_reference_immutable','v2_api_place_report_context','v2_api_place_report_action','v2_api_hide_reported_place')) THEN RAISE EXCEPTION 'place_partial_or_unrecorded';END IF;
  EXECUTE $place_source_0035$-- Public presentation IDs are distinct from private evidence/receipt IDs.
CREATE TABLE public.v2_place_report_refs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL UNIQUE REFERENCES public.v2_observations(id) ON DELETE CASCADE);
CREATE TABLE public.v2_place_report_hides(
 place_ref uuid PRIMARY KEY REFERENCES public.v2_place_report_refs(id) ON DELETE CASCADE,
 report_id integer NOT NULL REFERENCES public.abuse_reports(id),
 hidden_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.v2_place_reference_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.field_key IN('boarding.pickup','alighting.dropoff') AND EXISTS(
  SELECT 1 FROM public.v2_contributions c WHERE c.id=NEW.contribution_id AND c.payload->>'operation'='route-observations/1') THEN
  INSERT INTO public.v2_place_report_refs(observation_id) VALUES(NEW.id) ON CONFLICT(observation_id) DO NOTHING;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_place_reference_created AFTER INSERT ON public.v2_observations
 FOR EACH ROW EXECUTE FUNCTION public.v2_place_reference_created();
CREATE FUNCTION public.v2_place_reference_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'v2_place_reference_immutable' USING ERRCODE='23514';END;$$;
CREATE TRIGGER v2_place_reference_immutable BEFORE UPDATE ON public.v2_place_report_refs
 FOR EACH ROW EXECUTE FUNCTION public.v2_place_reference_immutable();
INSERT INTO public.v2_place_report_refs(observation_id)
 SELECT o.id FROM public.v2_observations o JOIN public.v2_contributions c ON c.id=o.contribution_id
 WHERE o.field_key IN('boarding.pickup','alighting.dropoff') AND c.payload->>'operation'='route-observations/1'
 ON CONFLICT(observation_id) DO NOTHING;

-- Private backend view. Raw identity/value columns must never be serialized.
CREATE VIEW public.v2_place_report_context AS
SELECT ref.id AS place_ref,l.subject_id AS route_subject_id,initial.user_id AS route_author_id,c.user_id AS place_author_id,
 o.id AS observation_id,o.field_key,o.scope_key,o.value AS original_value,o.knowledge_basis,o.observed_from,o.submitted_at,
 jsonb_build_object('id',city.id,'name',city.name,'placeType',city.place_type) AS city,
 COALESCE(e.disposition<>'excluded',false) AS evidence_included,
 public.v2_read_field(o.original_subject_id,o.field_key,o.scope_key) AS field_read,
 EXISTS(SELECT 1 FROM public.v2_place_report_hides h WHERE h.place_ref=ref.id) AS is_hidden
FROM public.v2_place_report_refs ref
JOIN public.v2_observations o ON o.id=ref.observation_id AND o.scope='{}'::jsonb
JOIN public.v2_observation_states state ON state.observation_id=o.id AND state.status='active'
JOIN public.v2_observation_targets target ON target.observation_id=o.id AND target.assignment_id IS NULL
JOIN public.v2_contributions c ON c.id=o.contribution_id AND c.original_subject_id=o.original_subject_id
JOIN public.users author ON author.id=c.user_id
JOIN public.v2_leads l ON l.subject_id=o.original_subject_id AND l.intake_kind='community' AND NOT l.attribution_erased
JOIN public.v2_subjects subject ON subject.id=l.subject_id AND subject.kind='lead' AND subject.lifecycle='active'
JOIN public.v2_contributions initial ON initial.id=l.initial_contribution_id AND initial.original_subject_id=l.subject_id
JOIN public.v2_corridors corridor ON corridor.id=l.corridor_id
JOIN public.cities city ON city.id=CASE o.field_key WHEN 'boarding.pickup' THEN corridor.origin_city_id ELSE corridor.destination_city_id END
LEFT JOIN public.v2_current_fields current_field ON current_field.subject_id=o.original_subject_id AND current_field.field_key=o.field_key AND current_field.scope_key=o.scope_key
LEFT JOIN public.v2_field_decision_evidence e ON e.field_decision_id=current_field.field_decision_id AND e.observation_id=o.id
WHERE o.field_key IN('boarding.pickup','alighting.dropoff') AND c.payload->>'operation'='route-observations/1'
 AND c.payload#>>'{target,existing,subjectId}'=l.subject_id::text
 AND c.payload#>>'{target,existing,identityKey}'=public.v2_prompt_identity(l.subject_id)
 AND (o.value->>'cityId')::integer=city.id
 AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs j WHERE j.user_id IN(c.user_id,initial.user_id));

-- View expressions call private identity helpers. The backend gets this bounded
-- read facade, never execution on the generic helper or direct view access.
CREATE FUNCTION public.v2_api_place_report_context(subject uuid) RETURNS SETOF public.v2_place_report_context
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT * FROM public.v2_place_report_context WHERE route_subject_id=subject;
$$;

CREATE FUNCTION public.v2_api_place_report_action(actor varchar,subject uuid,place uuid,action text,reason text,blocked varchar[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context public.v2_place_report_context;report integer;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor)
  OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) x WHERE x IS NULL OR length(x) NOT BETWEEN 1 AND 200 OR x~'[[:cntrl:]]') THEN RAISE EXCEPTION 'v2_safety_context_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 SELECT c.* INTO context FROM public.v2_place_report_context c JOIN public.v2_public_lead_reports p ON p.subject_id=c.route_subject_id
  WHERE c.place_ref=place AND c.route_subject_id=subject
   AND NOT c.is_hidden AND c.evidence_included AND c.field_read->>'status' IN('assessed','review_required')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c.field_read->'candidates','[]'::jsonb)) candidate WHERE candidate->'value'=c.original_value)
   AND NOT EXISTS(SELECT 1 FROM public.v2_place_report_context newer WHERE newer.route_subject_id=c.route_subject_id
    AND newer.place_author_id=c.place_author_id AND newer.field_key=c.field_key AND newer.evidence_included AND newer.field_read->>'status' IN('assessed','review_required') AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(newer.field_read->'candidates','[]'::jsonb)) admitted WHERE admitted->'value'=newer.original_value) AND (newer.submitted_at,newer.place_ref)>(c.submitted_at,c.place_ref));
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_place_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL AND EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id=context.place_author_id) THEN RETURN '{"status":"blocked"}'::jsonb;END IF;
 IF context.route_author_id=ANY(blocked) OR context.place_author_id=ANY(blocked) OR EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id IN(context.route_author_id,context.place_author_id)) THEN RAISE EXCEPTION 'v2_place_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL THEN
  IF actor=context.place_author_id THEN RAISE EXCEPTION 'v2_self_block_invalid' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM public.v2_route_report_blocks WHERE blocker_id=actor)>=200 THEN RAISE EXCEPTION 'v2_block_limit' USING ERRCODE='23514';END IF;
  INSERT INTO public.v2_route_report_blocks(blocker_id,blocked_user_id) VALUES(actor,context.place_author_id) ON CONFLICT DO NOTHING;
  RETURN '{"status":"blocked"}'::jsonb;
 ELSIF action='report' AND reason IN('spam','inaccurate','offensive','unsafe','other') THEN
  SELECT id INTO report FROM public.abuse_reports WHERE reporter_id=actor AND target_type='place_report' AND target_id=place::text AND abuse_reports.reason=v2_api_place_report_action.reason AND status='pending' ORDER BY id LIMIT 1;
  IF report IS NULL THEN INSERT INTO public.abuse_reports(reporter_id,target_type,target_id,reason) VALUES(actor,'place_report',place::text,reason);END IF;
  RETURN '{"status":"reported"}'::jsonb;
 END IF;RAISE EXCEPTION 'v2_safety_action_invalid' USING ERRCODE='23514';
END;$$;
CREATE FUNCTION public.v2_api_hide_reported_place(report integer,notes text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.abuse_reports;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO r FROM public.abuse_reports WHERE id=report FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.target_type<>'place_report' OR length(notes)>2000 THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_place_report_refs WHERE id=r.target_id::uuid) THEN RETURN false;END IF;
 INSERT INTO public.v2_place_report_hides(place_ref,report_id) VALUES(r.target_id::uuid,r.id) ON CONFLICT DO NOTHING;
 UPDATE public.abuse_reports SET status='actioned',moderator_notes=notes,reviewed_at=now() WHERE id=r.id;RETURN true;
END;$$;
DO $$DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_place_report_refs','v2_place_report_hides'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_read ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
 END LOOP;
 REVOKE ALL ON public.v2_place_report_context FROM PUBLIC,mabhazi_api;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_place_reference_created','v2_place_reference_immutable','v2_api_place_report_context','v2_api_place_report_action','v2_api_hide_reported_place') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
  FOREACH t IN ARRAY ARRAY['v2_place_report_refs','v2_place_report_hides','v2_place_report_context'] LOOP EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END LOOP;
 END IF;END LOOP;
END;$$;
GRANT EXECUTE ON FUNCTION public.v2_api_place_report_context(uuid),public.v2_api_place_report_action(varchar,uuid,uuid,text,text,varchar[]),public.v2_api_hide_reported_place(integer,text) TO mabhazi_api;
$place_source_0035$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0035_route_place_reports.sql','19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a');
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements('[{"name":"v2_place_reference_created","signature":"public.v2_place_reference_created()","hash":"57b20fdaee678ff5cf1fe6ada1d2482426a8f373d6581a211c37ac47e3693055","definer":true,"backend":false,"language":"plpgsql","volatility":"v","set":false},{"name":"v2_place_reference_immutable","signature":"public.v2_place_reference_immutable()","hash":"2a6e8ea8eaed7284a6c253e9deb47bbfb4d83f629a5aae5d53454b95ab7261dd","definer":false,"backend":false,"language":"plpgsql","volatility":"v","set":false},{"name":"v2_api_place_report_context","signature":"public.v2_api_place_report_context(uuid)","hash":"e393bc3086234791ffb232012b163af40f7d8cc809ad97a795a1f0e53c3f34c0","definer":true,"backend":true,"language":"sql","volatility":"s","set":true},{"name":"v2_api_place_report_action","signature":"public.v2_api_place_report_action(varchar,uuid,uuid,text,text,varchar[])","hash":"e9b3efb249a6b5651ad9e8490b7728d115c4bbb16114aa35cac7d5935b421f20","definer":true,"backend":true,"language":"plpgsql","volatility":"v","set":false},{"name":"v2_api_hide_reported_place","signature":"public.v2_api_hide_reported_place(integer,text)","hash":"5be5e8ecc786b53bc2a885df378c2c23fad483fdc48700451e694bfc41c9e344","definer":true,"backend":true,"language":"plpgsql","volatility":"v","set":false}]'::jsonb) LOOP
  SELECT pg.*,l.lanname INTO p FROM pg_proc pg JOIN pg_language l ON l.oid=pg.prolang WHERE pg.oid=to_regprocedure(f->>'signature');
  IF p.oid IS NULL OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f->>'hash' OR p.prosecdef<>(f->>'definer')::boolean OR p.lanname<>f->>'language'
   OR p.provolatile::text<>f->>'volatility' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] OR p.proretset<>(f->>'set')::boolean
   OR has_function_privilege('mabhazi_api',p.oid,'EXECUTE')<>(f->>'backend')::boolean
   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'place_function_fence_changed';END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_function_privilege(r,p.oid,'EXECUTE') THEN RAISE EXCEPTION 'place_function_fence_changed';END IF;END LOOP;
 END LOOP;
 -- Compare the server-normalised view against a temporary copy of the exact source.
 EXECUTE $expected_view$CREATE TEMP VIEW expected_place_report_context AS SELECT ref.id AS place_ref,l.subject_id AS route_subject_id,initial.user_id AS route_author_id,c.user_id AS place_author_id,
 o.id AS observation_id,o.field_key,o.scope_key,o.value AS original_value,o.knowledge_basis,o.observed_from,o.submitted_at,
 jsonb_build_object('id',city.id,'name',city.name,'placeType',city.place_type) AS city,
 COALESCE(e.disposition<>'excluded',false) AS evidence_included,
 public.v2_read_field(o.original_subject_id,o.field_key,o.scope_key) AS field_read,
 EXISTS(SELECT 1 FROM public.v2_place_report_hides h WHERE h.place_ref=ref.id) AS is_hidden
FROM public.v2_place_report_refs ref
JOIN public.v2_observations o ON o.id=ref.observation_id AND o.scope='{}'::jsonb
JOIN public.v2_observation_states state ON state.observation_id=o.id AND state.status='active'
JOIN public.v2_observation_targets target ON target.observation_id=o.id AND target.assignment_id IS NULL
JOIN public.v2_contributions c ON c.id=o.contribution_id AND c.original_subject_id=o.original_subject_id
JOIN public.users author ON author.id=c.user_id
JOIN public.v2_leads l ON l.subject_id=o.original_subject_id AND l.intake_kind='community' AND NOT l.attribution_erased
JOIN public.v2_subjects subject ON subject.id=l.subject_id AND subject.kind='lead' AND subject.lifecycle='active'
JOIN public.v2_contributions initial ON initial.id=l.initial_contribution_id AND initial.original_subject_id=l.subject_id
JOIN public.v2_corridors corridor ON corridor.id=l.corridor_id
JOIN public.cities city ON city.id=CASE o.field_key WHEN 'boarding.pickup' THEN corridor.origin_city_id ELSE corridor.destination_city_id END
LEFT JOIN public.v2_current_fields current_field ON current_field.subject_id=o.original_subject_id AND current_field.field_key=o.field_key AND current_field.scope_key=o.scope_key
LEFT JOIN public.v2_field_decision_evidence e ON e.field_decision_id=current_field.field_decision_id AND e.observation_id=o.id
WHERE o.field_key IN('boarding.pickup','alighting.dropoff') AND c.payload->>'operation'='route-observations/1'
 AND c.payload#>>'{target,existing,subjectId}'=l.subject_id::text
 AND c.payload#>>'{target,existing,identityKey}'=public.v2_prompt_identity(l.subject_id)
 AND (o.value->>'cityId')::integer=city.id
 AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs j WHERE j.user_id IN(c.user_id,initial.user_id))$expected_view$;
 IF pg_get_viewdef('public.v2_place_report_context'::regclass,true) IS DISTINCT FROM pg_get_viewdef('pg_temp.expected_place_report_context'::regclass,true) THEN RAISE EXCEPTION 'place_view_changed';END IF;
 DROP VIEW pg_temp.expected_place_report_context;
 FOREACH t IN ARRAY ARRAY['v2_place_report_refs','v2_place_report_hides','v2_place_report_context'] LOOP
  IF has_table_privilege('mabhazi_api','public.'||t,'SELECT')<>(t<>'v2_place_report_context') OR has_table_privilege('mabhazi_api','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=to_regclass('public.'||t) AND a.grantee=0) THEN RAISE EXCEPTION 'place_table_fence_changed';END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) AND has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'place_table_fence_changed';END IF;END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE oid IN('public.v2_place_report_refs'::regclass,'public.v2_place_report_hides'::regclass) AND relrowsecurity)<>2
 OR (SELECT count(*) FROM pg_policy WHERE polrelid IN('public.v2_place_report_refs'::regclass,'public.v2_place_report_hides'::regclass) AND polname='backend_read' AND polcmd='r' AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='mabhazi_api')] AND pg_get_expr(polqual,polrelid)='true')<>2
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid IN('public.v2_place_report_refs'::regclass,'public.v2_place_report_hides'::regclass) AND contype='f' AND convalidated)<>3
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid IN('public.v2_place_report_refs'::regclass,'public.v2_place_report_hides'::regclass) AND contype='p')<>2
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_place_report_refs'::regclass AND contype='u' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.v2_place_report_refs'::regclass AND attname='observation_id')])
 OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.v2_place_report_refs'::regclass AND attnum>0 AND NOT attisdropped)<>2
 OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.v2_place_report_hides'::regclass AND attnum>0 AND NOT attisdropped)<>3 THEN RAISE EXCEPTION 'place_table_shape_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_place_report_refs'::regclass AND contype='f' AND confrelid='public.v2_observations'::regclass AND confdeltype='c')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_place_report_hides'::regclass AND contype='f' AND confrelid='public.v2_place_report_refs'::regclass AND confdeltype='c')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.v2_place_report_hides'::regclass AND contype='f' AND confrelid='public.abuse_reports'::regclass AND confdeltype='a') THEN RAISE EXCEPTION 'place_table_shape_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.v2_observations'::regclass AND tgname='v2_place_reference_created' AND tgenabled='O' AND tgfoid='public.v2_place_reference_created()'::regprocedure AND tgtype=5 AND tgqual IS NULL AND tgnargs=0)
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.v2_place_report_refs'::regclass AND tgname='v2_place_reference_immutable' AND tgenabled='O' AND tgfoid='public.v2_place_reference_immutable()'::regprocedure AND tgtype=19 AND tgqual IS NULL AND tgnargs=0) THEN RAISE EXCEPTION 'place_trigger_changed';END IF;
 IF jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_targets x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_actual_journeys x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_sources x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_current_fields x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_assessments x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_field_decisions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_route_report_blocks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_refs x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_public_fare_hides x)) IS DISTINCT FROM before_data OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname NOT IN('v2_place_reference_created','v2_place_reference_immutable','v2_api_place_report_context','v2_api_place_report_action','v2_api_hide_reported_place')) IS DISTINCT FROM before_functions THEN RAISE EXCEPTION 'place_existing_state_changed';END IF;
END;$preview_places_0035$;
COMMIT;
SELECT statement_timestamp() checked_at,(SELECT count(*) FROM mabhazi_migrations.applied) ledger_entries,
 (SELECT checksum FROM mabhazi_migrations.applied WHERE name='0035_route_place_reports.sql') migration_hash;
