-- Own Mabhazi Preview ocwlqhlfavvuncfmzuqh only. No credentials, new jobs or production changes.
-- Source migration SHA256 b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36; never edit its embedded bytes or checksum independently.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
DO $preview_context_0030$
DECLARE previous text;t text;r text;f record;p record;before_functions jsonb;after_functions jsonb;before_data jsonb;after_data jsonb;columns text[];
BEGIN
 IF EXISTS(SELECT 1 FROM(VALUES
('0000_initial.sql','47816e783afdcbb778d16a4afbb23b2053ad5532fab1e06af7bbf9696115a38e'),
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
('0029_empty_search_minimum.sql','7537057d3167b540df14c14c52adeda006079d366669bbb257f4d533a1227762')
 ) expected(name,checksum) LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(30,31) THEN RAISE EXCEPTION 'public_context_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0030_public_route_context.sql';
 IF previous IS NOT NULL AND previous<>'b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36' THEN RAISE EXCEPTION 'public_context_preview_hash_changed';END IF;
 SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) INTO before_functions FROM pg_proc proc_snapshot
 WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_api_submit_public_actual_journey','v2_api_route_report_action','v2_api_unblock_route_report_author','v2_api_hide_reported_lead');
 SELECT jsonb_build_array((SELECT count(*) FROM public.v2_contributions),(SELECT count(*) FROM public.v2_receipts),(SELECT count(*) FROM public.v2_observations)) INTO before_data;
 IF previous IS NULL THEN
  IF (SELECT count(*) FROM mabhazi_migrations.applied)<>30
   OR to_regclass('public.v2_route_report_blocks') IS NOT NULL OR to_regclass('public.v2_public_lead_hides') IS NOT NULL OR to_regclass('public.v2_public_lead_reports') IS NOT NULL
   OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_api_submit_public_actual_journey','v2_api_route_report_action','v2_api_unblock_route_report_author','v2_api_hide_reported_lead')) THEN RAISE EXCEPTION 'public_context_partial_or_unrecorded';END IF;
  EXECUTE $source_context_0030$
-- Public initial-report discovery and contextual intake share this private projection.
-- No raw author/evidence fields are exposed by the HTTP serializer.
CREATE TABLE public.v2_route_report_blocks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),blocker_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 blocked_user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(blocker_id,blocked_user_id),CHECK(blocker_id<>blocked_user_id));
CREATE INDEX v2_route_report_block_author_idx ON public.v2_route_report_blocks(blocked_user_id);
CREATE TABLE public.v2_public_lead_hides(
 subject_id uuid PRIMARY KEY REFERENCES public.v2_leads(subject_id) ON DELETE CASCADE,
 report_id integer NOT NULL REFERENCES public.abuse_reports(id),hidden_at timestamptz NOT NULL DEFAULT now());
CREATE VIEW public.v2_public_lead_reports AS SELECT l.subject_id,s.revision,c.user_id AS author_user_id,corridor.origin_city_id,corridor.destination_city_id,
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
 AND NOT EXISTS(SELECT 1 FROM public.v2_public_lead_hides h WHERE h.subject_id=l.subject_id);
CREATE FUNCTION public.v2_api_submit_public_actual_journey(actor varchar,required_terms text,request jsonb,blocked varchar[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;intent jsonb;prior boolean;input jsonb:=request;item_index integer:=0;amount text;
BEGIN
 IF actor IS NULL OR required_terms IS NULL THEN RAISE EXCEPTION 'v2_intake_actor_or_terms_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND terms_accepted_version=required_terms AND terms_accepted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'v2_intake_terms_required' USING ERRCODE='42501';END IF;
 IF NOT COALESCE(jsonb_typeof(request)='object' AND public.v2_json_uuid(request->'clientSubmissionId')
  AND jsonb_typeof(request->'observations')='array',false) OR octet_length(request::text)>65536 THEN
  RAISE EXCEPTION 'v2_intake_request_invalid' USING ERRCODE='23514';END IF;
 IF jsonb_array_length(request->'observations') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'v2_intake_observation_limit' USING ERRCODE='23514';END IF;
 -- Normalize decimal scale only, without numeric rounding or copying header context.
 FOR item IN SELECT value FROM jsonb_array_elements(request->'observations') LOOP
  IF item->>'fieldKey' IN('fare.paid','fare.quoted','fare.advertised') THEN
   amount:=item->'value'->>'amount';
   IF amount ~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' AND jsonb_typeof(item->'value'->'amount')='string' THEN
    -- Validate original precision before removing zeros (JPY 1.00 is still invalid).
    IF public.v2_currency_minor_units(item->'value'->>'currency') IS NULL
      OR length(split_part(amount,'.',2))>least(public.v2_currency_minor_units(item->'value'->>'currency'),2) THEN
     RAISE EXCEPTION 'v2_actual_fare_precision_invalid' USING ERRCODE='23514';END IF;
    IF strpos(amount,'.')>0 THEN amount:=rtrim(rtrim(amount,'0'),'.');END IF;
    input:=jsonb_set(input,ARRAY['observations',item_index::text,'value','amount'],to_jsonb(amount));
   END IF;
  END IF;
  item_index:=item_index+1;
 END LOOP;
 SELECT EXISTS(SELECT 1 FROM public.v2_receipts WHERE user_id=actor AND client_submission_id=(request->>'clientSubmissionId')::uuid) INTO prior;
 -- Historical receipt replay is validated by the constructor before fresh references.
 IF prior THEN RETURN public.v2_submit_actual_journey(actor,required_terms,input);END IF;
 IF request->>'entrySurface' IS NULL OR request->>'entrySurface' NOT IN('search_result','route_detail')
  OR blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) b WHERE b IS NULL OR length(b) NOT BETWEEN 1 AND 200) THEN
  RAISE EXCEPTION 'v2_actual_capability_only' USING ERRCODE='23514';END IF;
 intent:=request->'target'->'newActualJourney'->'intendedSubject';
 IF intent IS NULL OR intent='null'::jsonb THEN RAISE EXCEPTION 'v2_actual_target_unavailable' USING ERRCODE='42501';END IF;
 IF intent IS NOT NULL AND intent<>'null'::jsonb THEN
  IF intent->>'kind' IS DISTINCT FROM 'lead' OR NOT public.v2_json_uuid(intent->'id') OR NOT EXISTS(
   SELECT 1 FROM public.v2_public_lead_reports p
   WHERE p.subject_id=(intent->>'id')::uuid AND NOT(p.author_user_id=ANY(blocked))
    AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=actor AND b.blocked_user_id=p.author_user_id)) THEN
   RAISE EXCEPTION 'v2_actual_target_unavailable' USING ERRCODE='42501';END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(input->'observations') LOOP
  IF item->>'fieldKey' NOT IN('departure.actual','arrival.actual','operator.reported','boarding.pickup','alighting.dropoff','fare.paid','fare.quoted','fare.advertised')
   OR item->>'fieldKey' IS NULL
   OR item->>'fieldKey'='operator.reported' AND NOT COALESCE(item->'value' ? 'name',false)
   OR item->>'fieldKey' IN('boarding.pickup','alighting.dropoff') AND NOT COALESCE(item->'value' ? 'cityId',false)
   OR item->>'fieldKey' LIKE 'fare.%' AND item->'scope'->'segment'->>'kind' IS DISTINCT FROM 'city_pair' THEN
   RAISE EXCEPTION 'v2_actual_capability_only' USING ERRCODE='23514';END IF;
 END LOOP;
 RETURN public.v2_submit_actual_journey(actor,required_terms,input);
END;$$;
CREATE FUNCTION public.v2_api_route_report_action(actor varchar,subject uuid,action text,reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE author_id varchar;report integer;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 SELECT author_user_id INTO author_id FROM public.v2_public_lead_reports WHERE subject_id=subject;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_actual_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL THEN
  IF author_id=actor THEN RAISE EXCEPTION 'v2_self_block_invalid' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id=author_id)
    AND (SELECT count(*) FROM public.v2_route_report_blocks WHERE blocker_id=actor)>=200 THEN RAISE EXCEPTION 'v2_block_limit' USING ERRCODE='23514';END IF;
  INSERT INTO public.v2_route_report_blocks(blocker_id,blocked_user_id) VALUES(actor,author_id) ON CONFLICT(blocker_id,blocked_user_id) DO NOTHING;
  RETURN '{"status":"blocked"}'::jsonb;
 ELSIF action='report' AND reason IN('spam','inaccurate','offensive','unsafe','other') THEN
  SELECT id INTO report FROM public.abuse_reports WHERE reporter_id=actor AND target_type='transport_subject' AND target_id=subject::text AND abuse_reports.reason=v2_api_route_report_action.reason AND status='pending' ORDER BY id LIMIT 1;
  IF report IS NULL THEN INSERT INTO public.abuse_reports(reporter_id,target_type,target_id,reason) VALUES(actor,'transport_subject',subject::text,reason);END IF;
  RETURN '{"status":"reported"}'::jsonb;
 END IF;
 RAISE EXCEPTION 'v2_safety_action_invalid' USING ERRCODE='23514';
END;$$;
CREATE FUNCTION public.v2_api_unblock_route_report_author(actor varchar,block_ref uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 DELETE FROM public.v2_route_report_blocks WHERE id=block_ref AND blocker_id=actor;RETURN true;
END;$$;
CREATE FUNCTION public.v2_api_hide_reported_lead(report integer,notes text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.abuse_reports;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO r FROM public.abuse_reports WHERE id=report FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.target_type<>'transport_subject' OR length(notes)>2000 THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=r.target_id::uuid) THEN RETURN false;END IF;
 INSERT INTO public.v2_public_lead_hides(subject_id,report_id) VALUES(r.target_id::uuid,r.id) ON CONFLICT(subject_id) DO NOTHING;
 UPDATE public.abuse_reports SET status='actioned',moderator_notes=notes,reviewed_at=now() WHERE id=r.id;RETURN true;
END;$$;
DO $$DECLARE t text;f text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_route_report_blocks','v2_public_lead_hides'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_read ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
 END LOOP;
 REVOKE ALL ON public.v2_public_lead_reports FROM PUBLIC,mabhazi_api;
 GRANT SELECT ON public.v2_public_lead_reports TO mabhazi_api;
 FOREACH f IN ARRAY ARRAY['public.v2_api_submit_public_actual_journey(varchar,text,jsonb,varchar[])','public.v2_api_route_report_action(varchar,uuid,text,text)','public.v2_api_unblock_route_report_author(varchar,uuid)','public.v2_api_hide_reported_lead(integer,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   FOREACH t IN ARRAY ARRAY['v2_public_lead_reports','v2_route_report_blocks','v2_public_lead_hides'] LOOP EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END LOOP;
  END IF;
 END LOOP;
END;$$;

$source_context_0030$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0030_public_route_context.sql','b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36');
 END IF;
 EXECUTE $expected_context_view$
CREATE TEMP VIEW context_0030_expected AS SELECT l.subject_id,s.revision,c.user_id AS author_user_id,corridor.origin_city_id,corridor.destination_city_id,
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
 AND NOT EXISTS(SELECT 1 FROM public.v2_public_lead_hides h WHERE h.subject_id=l.subject_id);
$expected_context_view$;
 IF replace(pg_get_viewdef('public.v2_public_lead_reports'::regclass,true),E'\r\n',E'\n') IS DISTINCT FROM replace(pg_get_viewdef('pg_temp.context_0030_expected'::regclass,true),E'\r\n',E'\n') THEN RAISE EXCEPTION 'public_context_view_changed';END IF;
 DROP VIEW pg_temp.context_0030_expected;
 FOR f IN SELECT * FROM(VALUES ('public.v2_api_submit_public_actual_journey(varchar,text,jsonb,varchar[])','4dc41e6b7206b92bceb08ce398d5dfd3'),('public.v2_api_route_report_action(varchar,uuid,text,text)','2152ad4a4432b36b344e3e53e48a7f5e'),('public.v2_api_unblock_route_report_author(varchar,uuid)','434b05df1011ec6306af98231b79e1d3'),('public.v2_api_hide_reported_lead(integer,text)','3460449bfb2a81374a57f689abb06dd9')) expected(signature,body_hash) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(f.signature);
  IF p.oid IS NULL OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR md5(replace(p.prosrc,E'\r\n',E'\n'))<>f.body_hash
   OR NOT has_function_privilege('mabhazi_api',p.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles role WHERE role.rolname IN('anon','authenticated') AND has_function_privilege(role.oid,p.oid,'EXECUTE'))
  THEN RAISE EXCEPTION 'public_context_function_fence_changed: %',f.signature;END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['v2_route_report_blocks','v2_public_lead_hides','v2_public_lead_reports'] LOOP
  SELECT * INTO p FROM pg_class WHERE oid=('public.'||t)::regclass;
  IF NOT has_table_privilege('mabhazi_api',p.oid,'SELECT') OR has_table_privilege('mabhazi_api',p.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.relacl,acldefault('r',p.relowner))) WHERE grantee=0)
   OR EXISTS(SELECT 1 FROM pg_roles role WHERE role.rolname IN('anon','authenticated') AND has_table_privilege(role.oid,p.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  THEN RAISE EXCEPTION 'public_context_relation_fence_changed: %',t;END IF;
  IF t<>'v2_public_lead_reports' THEN
   IF NOT p.relrowsecurity OR p.relkind<>'r' OR (SELECT count(*) FROM pg_policy WHERE polrelid=p.oid)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=p.oid AND polname='backend_read' AND polcmd='r' AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='mabhazi_api')] AND pg_get_expr(polqual,polrelid)='true') THEN RAISE EXCEPTION 'public_context_rls_changed: %',t;END IF;
   SELECT array_agg(column_name||':'||data_type||':'||(is_nullable='YES')::text ORDER BY ordinal_position) INTO columns FROM information_schema.columns WHERE table_schema='public' AND table_name=t;
   IF columns IS DISTINCT FROM (CASE t WHEN 'v2_route_report_blocks' THEN ARRAY['id:uuid:false','blocker_id:character varying:false','blocked_user_id:character varying:false','created_at:timestamp with time zone:false'] WHEN 'v2_public_lead_hides' THEN ARRAY['subject_id:uuid:false','report_id:integer:false','hidden_at:timestamp with time zone:false'] END) THEN RAISE EXCEPTION 'public_context_columns_changed: %',t;END IF;
  END IF;
 END LOOP;
 IF has_function_privilege('mabhazi_api','public.v2_submit_actual_journey(varchar,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public_context_constructor_exposed';END IF;
 SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) INTO after_functions FROM pg_proc proc_snapshot
 WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_api_submit_public_actual_journey','v2_api_route_report_action','v2_api_unblock_route_report_author','v2_api_hide_reported_lead');
 SELECT jsonb_build_array((SELECT count(*) FROM public.v2_contributions),(SELECT count(*) FROM public.v2_receipts),(SELECT count(*) FROM public.v2_observations)) INTO after_data;
 IF after_functions IS DISTINCT FROM before_functions OR after_data IS DISTINCT FROM before_data THEN RAISE EXCEPTION 'public_context_existing_state_changed';END IF;
 IF (SELECT count(*) FROM mabhazi_migrations.applied)<>31 THEN RAISE EXCEPTION 'public_context_ledger_changed';END IF;
END;$preview_context_0030$;
COMMIT;
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'ledgerEntries',(SELECT count(*) FROM mabhazi_migrations.applied),'migrationHash',(SELECT checksum FROM mabhazi_migrations.applied WHERE name='0030_public_route_context.sql'),'newTables',2,'restrictedFunctions',4,'contributions',(SELECT count(*) FROM v2_contributions),'receipts',(SELECT count(*) FROM v2_receipts),'health',public.v2_worker_health())::text proof;
