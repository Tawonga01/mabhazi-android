-- Preview ocwlqhlfavvuncfmzuqh only. Tested action-time access confirmation required.
-- Additive0039+0040; no owner role is granted by this script. No content is removed.
BEGIN;
SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $admin_dashboard_guard$
DECLARE previous39 text;previous40 text;spec jsonb;proc_row record;table_name text;role_name text;before_data jsonb;before_functions jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset('[{"name":"0000_initial.sql","checksum":"47816e783afdcbb778d16a4afbb23b2053ad5532fab1e06af7bbf9696115a38e"},{"name":"0001_api_role.sql","checksum":"1a4e952d4a7179075825ab142a38a751cc58a7919e3cf8b981ead546108283e4"},{"name":"0002_contribution_intake.sql","checksum":"b6a8edf014efd7f71531f21205f23c49f1bb0166b43374538a748074f0db25b8"},{"name":"0003_transport_structure.sql","checksum":"7bd24b0451546a40be14f6b8aef127c99c52eba710a812ee4f9e8feaae46b811"},{"name":"0004_review_decisions.sql","checksum":"d22083cdab91f0dc04b46016ebd200a3a3b0ead7229ba981452d27f5f7ba9a5a"},{"name":"0005_derived_decisions.sql","checksum":"62a6d76851d50cfab7754051618a4ac98c056e36a129629190140a107701442f"},{"name":"0006_observation_registry.sql","checksum":"ac310e0a630f58ac09b7bf254c1c8a4afefcd9bc8a6114e6cf89f72d4dfc353f"},{"name":"0007_observation_events.sql","checksum":"b47f0267431ac955faf6ad31981ed7b0133d5d63704b6a27a62c10330b814b21"},{"name":"0008_observation_targets.sql","checksum":"1cfb37200fa370708b9cb22fb46fc41a3704c40636028f84dc61da41bacf598e"},{"name":"0009_source_identity.sql","checksum":"e47a6b7e48bad9a7a2989da14c37a78d20f449c8680f09c439acd159d716190e"},{"name":"0010_evidence_assessments.sql","checksum":"0ccce5368dbf67f14facbc675943c8e094fe37b4dc57b32a770633be81c0dff2"},{"name":"0011_field_resolution.sql","checksum":"f086418f2525b85004d9a05da3b3169e2c1d2afe709e0c43b146a23002d1e572"},{"name":"0012_affiliation_issuers.sql","checksum":"e31320e5eff22ae28d159d5cb6ae95aee7b8aad9b5672d3f7e414fa1f12a1d17"},{"name":"0013_prompt_tasks.sql","checksum":"ab2446b8b4f161bb8bb8b39216f41fb12afd8738256fcd8ce0518171cf0a9b2e"},{"name":"0014_transport_propagation.sql","checksum":"44ff4ec120e21b61c128ef1ceabce3544f6cfad46ea6182315ea53e3c8ab1073"},{"name":"0015_transport_writers.sql","checksum":"6abb4def1d7b30854efe5f0a0371d3c278032f4e03f93b0c27d498b03281bea6"},{"name":"0016_lead_creation.sql","checksum":"748a3f024dedbd96dadef972a00af01d354cdf5a09711526a2ad228ebfa400e0"},{"name":"0017_transport_uuid_normalization.sql","checksum":"846f54fbcfa6446f94e08bdc5306e3cd895256da78d4dff87b40eedd2ed0b96e"},{"name":"0018_transport_creation.sql","checksum":"2b762ee0c3b9c5dab2ccf4f25286df25c4f5c3fdec31f3fe599157f4dce1d1d2"},{"name":"0019_route_pattern_creation.sql","checksum":"27fe4e63f14d665e5406296a44e693bc637b0c306c19efcb9778bc317f9d08ab"},{"name":"0020_service_run_creation.sql","checksum":"d25bd19870fe1307e5b00f75a98a3cccdc1317abedfb02c503109019f965dacd"},{"name":"0021_actual_journey_intake.sql","checksum":"2d5461ea7563dcbbb9b00a9aeac31e7994d0e9305583c251ad301acf25a696e9"},{"name":"0022_minimum_lead_api.sql","checksum":"e74223a70810dc43e0a416b26bf5698368872209fe51bde0a083341a2d95ab9e"},{"name":"0023_normalise_worker.sql","checksum":"8ab0d9f3db1d4ef2dd9e1d1dca00e26f715be963e364e08753e27a2c6cd61ae6"},{"name":"0024_lead_association_worker.sql","checksum":"7b889f2489bc07974ba34e929fbd207be77c1a446e11b381db4b9b09ec74e68d"},{"name":"0025_pattern_association_worker.sql","checksum":"388ba5d4a602d834d8fd8bcbe684b0180f6f98ab2f0f5e75e355fe99ea65eefe"},{"name":"0026_identity_lookup.sql","checksum":"9f5ab9ce65f9911c11ae866d79e88c56b693dc71780f02faf9941197e42ede32"},{"name":"0027_journey_processing.sql","checksum":"48106d054caadd7d97805b7143b69e08f0311b6153645fcbf9b5ce53cd2173a2"},{"name":"0028_actual_journey_api.sql","checksum":"7ab8860ddb09de0cf68ce64c0be883f3718184c4f0a68cff768ae0dce75fe705"},{"name":"0029_empty_search_minimum.sql","checksum":"7537057d3167b540df14c14c52adeda006079d366669bbb257f4d533a1227762"},{"name":"0030_public_route_context.sql","checksum":"b973924494921a729824029d4d80bbd1ebd2570d7b68d1a87af897bb10e5aa36"},{"name":"0031_assessment_worker.sql","checksum":"ae4a5a5017046775147eaf562c90f234e23c47f28e90f11edd81ff94f7c60000"},{"name":"0032_public_fare_reports.sql","checksum":"b8b9d1d0d8136d9c477c3890bdfd52b93be1f81c2fce208978eeb2e05fb15f47"},{"name":"0033_prompt_refresh_worker.sql","checksum":"abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896"},{"name":"0034_route_place_observations.sql","checksum":"0aa11ad9a8b079a9dab49b6f5a0fa00db54ea1747bd29ed1d66ff6f3d087c1c5"},{"name":"0035_route_place_reports.sql","checksum":"19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a"},{"name":"0036_pickup_question_api.sql","checksum":"e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86"},{"name":"0037_prompt_controls_api.sql","checksum":"0d7493e0c7a23c35aabb203c9d32e817dd2779704ea8059b98b11bede877b5f0"},{"name":"0038_pickup_invitation_api.sql","checksum":"62c6215beeb1fff21a9bea934cea0b4906fec3c2c1f389b5c31f174c18af51e1"}]'::jsonb) expected(name text,checksum text)
  LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR EXISTS(SELECT 1 FROM mabhazi_migrations.applied WHERE name<>ALL(ARRAY['0000_initial.sql','0001_api_role.sql','0002_contribution_intake.sql','0003_transport_structure.sql','0004_review_decisions.sql','0005_derived_decisions.sql','0006_observation_registry.sql','0007_observation_events.sql','0008_observation_targets.sql','0009_source_identity.sql','0010_evidence_assessments.sql','0011_field_resolution.sql','0012_affiliation_issuers.sql','0013_prompt_tasks.sql','0014_transport_propagation.sql','0015_transport_writers.sql','0016_lead_creation.sql','0017_transport_uuid_normalization.sql','0018_transport_creation.sql','0019_route_pattern_creation.sql','0020_service_run_creation.sql','0021_actual_journey_intake.sql','0022_minimum_lead_api.sql','0023_normalise_worker.sql','0024_lead_association_worker.sql','0025_pattern_association_worker.sql','0026_identity_lookup.sql','0027_journey_processing.sql','0028_actual_journey_api.sql','0029_empty_search_minimum.sql','0030_public_route_context.sql','0031_assessment_worker.sql','0032_public_fare_reports.sql','0033_prompt_refresh_worker.sql','0034_route_place_observations.sql','0035_route_place_reports.sql','0036_pickup_question_api.sql','0037_prompt_controls_api.sql','0038_pickup_invitation_api.sql','0039_admin_property_batches.sql','0040_admin_route_visibility.sql']))
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT BETWEEN 39 AND 41 THEN RAISE EXCEPTION 'admin_preview_baseline_changed';END IF;
 SELECT checksum INTO previous39 FROM mabhazi_migrations.applied WHERE name='0039_admin_property_batches.sql';
 SELECT checksum INTO previous40 FROM mabhazi_migrations.applied WHERE name='0040_admin_route_visibility.sql';
 IF previous39 IS NOT NULL AND previous39<>'09c61f1a7c5e4b1252f70243a8aacaf4f39669aef60193610250dc9697db2de5' OR previous40 IS NOT NULL AND previous40<>'4598a5a24c8e9c6b1203c44e9fb6ee7b1897ef03f51dd16f6ea1b2a843415a8d'
  OR previous40 IS NOT NULL AND previous39 IS NULL THEN RAISE EXCEPTION 'admin_preview_hash_changed';END IF;
 SELECT jsonb_build_array((SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_targets x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x)),(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname<>ALL(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch','v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action','v2_prompt_eligible','v2_submit_actual_journey'])) INTO before_data,before_functions;
 IF previous40 IS NULL THEN FOR spec IN SELECT value FROM jsonb_array_elements('[{"name":"v2_prompt_eligible","signature":"public.v2_prompt_eligible(uuid,varchar,text[])","returns":"boolean","backend":false,"definer":false,"volatility":"s","hash":"aa637978a9099629fa01b6b8f9fd94a3d455407f62b70ba4cb9d0a053848b826"},{"name":"v2_submit_actual_journey","signature":"public.v2_submit_actual_journey(varchar,text,jsonb)","returns":"jsonb","backend":false,"definer":true,"volatility":"v","hash":"ed7fdad72c0802fc878b352323ded3dd42b03f33e30146ac5891f9d343ecb1e0"}]'::jsonb) LOOP
 SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(spec->>'signature');
 IF NOT FOUND OR proc_row.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR proc_row.prosecdef IS DISTINCT FROM (spec->>'definer')::boolean OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
  OR proc_row.provolatile::text<>spec->>'volatility' OR proc_row.prorettype<>to_regtype(spec->>'returns')
  OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>spec->>'hash'
  OR has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE') IS DISTINCT FROM (spec->>'backend')::boolean
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(proc_row.proacl,acldefault('f',proc_row.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'admin_function_fence_changed: %',spec->>'signature';END IF;
 END LOOP; END IF;
 IF previous39 IS NULL THEN
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['v2_admin_batches','v2_admin_batch_items','v2_admin_core_threads']) t WHERE to_regclass('public.'||t) IS NOT NULL)
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch'])) THEN RAISE EXCEPTION 'admin_partial_or_unrecorded';END IF;
  EXECUTE $admin_dashboard_source39$-- Named administrative batch receipts. Existing typed review/field decisions
-- remain authoritative; this layer orchestrates them without copying evidence.
CREATE TABLE public.v2_admin_batches(
 id uuid PRIMARY KEY,actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 request_digest text,operation text NOT NULL CHECK(operation IN('approve','reverse')),
 reason_code text NOT NULL CHECK(reason_code IN('reports_reviewed','evidence_checked','operator_checked','decision_incorrect','evidence_changed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((actor_user_id IS NULL AND request_digest IS NULL) OR (actor_user_id IS NOT NULL AND request_digest~'^[0-9a-f]{64}$'))
);
CREATE TABLE public.v2_admin_batch_items(
 batch_id uuid NOT NULL REFERENCES public.v2_admin_batches(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 1999),
 route_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),
 field_key text NOT NULL,contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 review_id uuid REFERENCES public.v2_review_decisions(id),
 outcome text NOT NULL CHECK(outcome IN('approved','reversed','held','changed','already_reviewed','newer_decision_kept')),
 detail text NOT NULL CHECK(detail IN('saved','source_changed','needs_context','already_reviewed','newer_decision','erased')),
 PRIMARY KEY(batch_id,ordinal)
);
CREATE INDEX v2_admin_items_review_idx ON public.v2_admin_batch_items(review_id);
CREATE INDEX v2_admin_items_contribution_idx ON public.v2_admin_batch_items(contribution_id);
CREATE INDEX v2_admin_items_observation_idx ON public.v2_admin_batch_items(observation_id);
-- Core endpoints are assertions in an immutable initial contribution, not
-- manufactured transport observations. Their review thread binds that source.
CREATE TABLE public.v2_admin_core_threads(
 route_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),
 field_key text NOT NULL CHECK(field_key IN('route.origin','route.destination')),
 case_id uuid NOT NULL UNIQUE REFERENCES public.v2_review_cases(id),
 contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 PRIMARY KEY(route_subject_id,field_key)
);

CREATE FUNCTION public.v2_admin_require(actor varchar) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users u JOIN public.v2_review_roles r ON r.user_id=u.id
  WHERE u.id=actor AND r.role='administrator' AND r.revoked_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=u.id))
 THEN RAISE EXCEPTION 'v2_admin_required' USING ERRCODE='42501';END IF;
END;$$;
CREATE FUNCTION public.v2_admin_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
  IF TG_TABLE_NAME='v2_admin_batches' THEN
   IF OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
    AND to_jsonb(NEW)-ARRAY['actor_user_id','request_digest']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest']
    THEN NEW.request_digest:=NULL;RETURN NEW;END IF;
  ELSIF TG_TABLE_NAME='v2_admin_batch_items' THEN
   IF (NEW.observation_id IS NOT DISTINCT FROM OLD.observation_id OR NEW.observation_id IS NULL)
   AND (NEW.contribution_id IS NOT DISTINCT FROM OLD.contribution_id OR NEW.contribution_id IS NULL)
   AND to_jsonb(NEW)-ARRAY['observation_id','contribution_id']=to_jsonb(OLD)-ARRAY['observation_id','contribution_id']
   THEN RETURN NEW;END IF;
  ELSIF TG_TABLE_NAME='v2_admin_core_threads' THEN
   IF NEW.contribution_id IS NULL AND to_jsonb(NEW)-'contribution_id'=to_jsonb(OLD)-'contribution_id' THEN RETURN NEW;END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'v2_admin_history_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_admin_history BEFORE UPDATE OR DELETE ON public.v2_admin_batches FOR EACH ROW EXECUTE FUNCTION public.v2_admin_history_guard();
CREATE TRIGGER v2_admin_history BEFORE UPDATE OR DELETE ON public.v2_admin_batch_items FOR EACH ROW EXECUTE FUNCTION public.v2_admin_history_guard();
CREATE TRIGGER v2_admin_history BEFORE UPDATE OR DELETE ON public.v2_admin_core_threads FOR EACH ROW EXECUTE FUNCTION public.v2_admin_history_guard();

CREATE FUNCTION public.v2_api_admin_batch_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('id',b.id,'operation',b.operation,'reason',b.reason_code,'createdAt',b.created_at,
  'actorErased',b.actor_user_id IS NULL,'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'ordinal',i.ordinal,'routeId',i.route_subject_id,'fieldKey',i.field_key,'observationId',i.observation_id,
   'reviewId',i.review_id,'outcome',i.outcome,'detail',CASE WHEN i.contribution_id IS NULL THEN 'erased' ELSE i.detail END)
   ORDER BY i.ordinal) FROM public.v2_admin_batch_items i WHERE i.batch_id=b.id),'[]'::jsonb))
 INTO result FROM public.v2_admin_batches b WHERE b.id=request;
 RETURN COALESCE(result,'{"found":false}'::jsonb);
END;$$;

CREATE FUNCTION public.v2_api_admin_property_batch(actor varchar,request uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_admin_batches;digest text;item jsonb;idx integer:=0;subject uuid;route uuid;contribution uuid;observation uuid;
 field text;operation text;reason text;expected bigint;subject_revisions jsonb:='{}';review uuid;old_review uuid;
 observation_row public.v2_observations;thread public.v2_admin_core_threads;review_case public.v2_review_cases;
 result text;detail text;evidence uuid[];stored_revision bigint;
BEGIN
 -- Serialize authority changes, evidence/identity writers and this batch in the
 -- existing transport guard. A later role revocation cannot race a child save.
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM public.v2_admin_require(actor);
 IF request IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['operation','reason','items','expiresAt']<>'{}'::jsonb
  OR NOT input?&ARRAY['operation','reason','items','expiresAt'] OR jsonb_typeof(input->'items')<>'array'
  OR jsonb_typeof(input->'expiresAt') IS DISTINCT FROM 'number' OR (input->>'expiresAt')!~'^[1-9][0-9]{0,15}$'
  OR jsonb_array_length(input->'items') NOT BETWEEN 1 AND 2000
  OR COALESCE(input->>'operation','') NOT IN('approve','reverse') OR COALESCE(input->>'reason','') NOT IN('reports_reviewed','evidence_checked','operator_checked','decision_incorrect','evidence_changed')
  THEN RAISE EXCEPTION 'v2_admin_request_invalid' USING ERRCODE='23514';END IF;
 operation:=input->>'operation';reason:=input->>'reason';digest:=public.v2_assessment_hash(jsonb_build_array(actor,input-'expiresAt'));
 SELECT * INTO prior FROM public.v2_admin_batches WHERE id=request;
 IF FOUND THEN
  IF prior.actor_user_id IS DISTINCT FROM actor OR prior.request_digest IS DISTINCT FROM digest
   THEN RAISE EXCEPTION 'v2_admin_request_conflict' USING ERRCODE='23514';END IF;
  RETURN public.v2_api_admin_batch_receipt(actor,request);
 END IF;
 -- Check expiry only after the same lock/receipt lookup used by an in-flight
 -- identical command. A racing lost acknowledgement cannot become a new save.
 IF (input->>'expiresAt')::numeric/1000<=extract(epoch FROM clock_timestamp())
  THEN RAISE EXCEPTION 'v2_admin_preview_expired' USING ERRCODE='23514';END IF;
 IF (SELECT count(DISTINCT x->>'routeId') FROM jsonb_array_elements(input->'items') x)>100
  OR (SELECT count(*) FROM jsonb_array_elements(input->'items'))<>(SELECT count(DISTINCT jsonb_build_array(x->'routeId',x->'fieldKey',x->'observationId')) FROM jsonb_array_elements(input->'items') x)
  THEN RAISE EXCEPTION 'v2_admin_request_invalid' USING ERRCODE='23514';END IF;
 -- Freeze the baseline vector before the first child advances a subject. Own
 -- changes in this batch must not masquerade as concurrent edits to later items.
 FOR item IN SELECT value FROM jsonb_array_elements(input->'items') LOOP
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['routeId','subjectId','contributionId','observationId','fieldKey','subjectRevision','observationRevision','targetRevision','assessmentId','caseRevision','reviewId']<>'{}'::jsonb
   OR NOT item?&ARRAY['routeId','subjectId','contributionId','fieldKey','subjectRevision']
   OR COALESCE(item->>'subjectRevision','')!~'^[1-9][0-9]{0,15}$'
   THEN RAISE EXCEPTION 'v2_admin_request_invalid' USING ERRCODE='23514';END IF;
  subject:=(item->>'subjectId')::uuid;
  IF NOT subject_revisions?subject::text THEN
   SELECT revision INTO stored_revision FROM public.v2_subjects WHERE id=subject FOR UPDATE;
   subject_revisions:=subject_revisions||jsonb_build_object(subject::text,stored_revision);
  END IF;
 END LOOP;
 INSERT INTO public.v2_admin_batches VALUES(request,actor,digest,operation,reason,now());
 FOR item IN SELECT value FROM jsonb_array_elements(input->'items') LOOP
  route:=(item->>'routeId')::uuid;subject:=(item->>'subjectId')::uuid;contribution:=(item->>'contributionId')::uuid;
  observation:=(item->>'observationId')::uuid;field:=item->>'fieldKey';expected:=(item->>'subjectRevision')::bigint;
  review:=NULL;result:='changed';detail:='source_changed';
  IF (subject_revisions->>subject::text)::bigint IS NOT DISTINCT FROM expected
   AND EXISTS(SELECT 1 FROM public.v2_leads l JOIN public.v2_subjects s ON s.id=l.subject_id AND s.lifecycle='active'
    JOIN public.v2_contributions initial ON initial.id=l.initial_contribution_id JOIN public.users u ON u.id=initial.user_id
    WHERE l.subject_id=route AND l.intake_kind='community' AND NOT l.attribution_erased
    AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=u.id))
   AND EXISTS(SELECT 1 FROM public.v2_contributions c JOIN public.users u ON u.id=c.user_id
    WHERE c.id=contribution AND c.original_subject_id=subject AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=u.id)) THEN
   BEGIN
    IF operation='reverse' THEN
     old_review:=(item->>'reviewId')::uuid;
     SELECT c.* INTO review_case FROM public.v2_review_decisions d JOIN public.v2_review_cases c ON c.id=d.case_id
      WHERE d.id=old_review AND c.subject_id=subject AND NOT d.evidence_erased
       AND EXISTS(SELECT 1 FROM public.v2_admin_batch_items i WHERE i.review_id=d.id AND i.route_subject_id=route AND i.field_key=field
        AND i.contribution_id=contribution AND i.observation_id IS NOT DISTINCT FROM observation AND i.outcome='approved');
     IF NOT FOUND OR review_case.last_decision_id IS DISTINCT FROM old_review THEN result:='newer_decision_kept';detail:='newer_decision';
     ELSIF review_case.revision IS DISTINCT FROM (item->>'caseRevision')::bigint THEN result:='changed';
     ELSE
      review:=public.v2_record_review(actor,review_case.id,review_case.revision,(SELECT revision FROM public.v2_subjects WHERE id=subject),
       'reverse',reason,NULL,ARRAY[]::uuid[],'evidence/1',old_review);
      result:='reversed';detail:='saved';
     END IF;
    ELSIF observation IS NULL AND field IN('route.origin','route.destination') AND subject=route
     AND EXISTS(SELECT 1 FROM public.v2_leads l JOIN public.v2_contributions c ON c.id=l.initial_contribution_id
      JOIN public.cities city ON city.id=CASE WHEN (c.payload#>>ARRAY['target','newLead',CASE field WHEN 'route.origin' THEN 'originCityId' ELSE 'destinationCityId' END])~'^[1-9][0-9]{0,8}$'
       THEN (c.payload#>>ARRAY['target','newLead',CASE field WHEN 'route.origin' THEN 'originCityId' ELSE 'destinationCityId' END])::integer END
      WHERE l.subject_id=route AND l.initial_contribution_id=contribution) THEN
     SELECT * INTO thread FROM public.v2_admin_core_threads WHERE route_subject_id=route AND field_key=field;
     IF thread.case_id IS NULL THEN
      IF (item->>'caseRevision')::bigint IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'v2_admin_source_changed' USING ERRCODE='40001';END IF;
      thread.case_id:=public.v2_open_review_case(actor,route,'identity');
      INSERT INTO public.v2_admin_core_threads VALUES(route,field,thread.case_id,contribution);
     END IF;
     SELECT * INTO review_case FROM public.v2_review_cases WHERE id=thread.case_id;
     IF review_case.state='resolved' THEN result:='already_reviewed';detail:='already_reviewed';
     ELSE
      IF review_case.revision IS DISTINCT FROM (CASE WHEN (item->>'caseRevision')::bigint=0 THEN 1::bigint ELSE (item->>'caseRevision')::bigint END)
       THEN RAISE EXCEPTION 'v2_admin_source_changed' USING ERRCODE='40001';END IF;
      SELECT array_agg(o.id ORDER BY o.id) INTO evidence FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id AND s.status='active'
       WHERE o.contribution_id=contribution AND o.original_subject_id=route;
      review:=public.v2_record_review(actor,review_case.id,review_case.revision,(SELECT revision FROM public.v2_subjects WHERE id=subject),
       'accept',reason,NULL,evidence,'evidence/1');result:='approved';detail:='saved';
     END IF;
    ELSE
     SELECT o.* INTO observation_row FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id AND s.status='active'
      JOIN public.v2_observation_targets t ON t.observation_id=o.id AND t.assignment_id IS NULL
      WHERE o.id=observation AND o.original_subject_id=subject AND o.contribution_id=contribution AND o.field_key=field
      AND s.revision=(item->>'observationRevision')::bigint AND t.revision=(item->>'targetRevision')::bigint
      AND (subject=route OR EXISTS(SELECT 1 FROM public.v2_actual_journeys a WHERE a.subject_id=subject
       AND a.intended_subject_id=route AND a.intended_subject_kind='lead' AND a.matched_run_subject_id IS NULL));
     IF FOUND AND EXISTS(SELECT 1 FROM public.v2_current_fields cf JOIN public.v2_field_decisions d ON d.id=cf.field_decision_id
      WHERE cf.subject_id=subject AND cf.field_key=field AND cf.scope_key=observation_row.scope_key
      AND d.assessment_id=(item->>'assessmentId')::uuid AND NOT d.invalidated AND NOT d.erased) THEN
      review:=public.v2_resolve_field(actor,(item->>'assessmentId')::uuid,(item->>'caseRevision')::bigint,
       (SELECT revision FROM public.v2_subjects WHERE id=subject),observation,ARRAY[]::uuid[],'accept',reason,NULL,gen_random_uuid());
      result:='approved';detail:='saved';
     ELSE result:='held';detail:='needs_context';END IF;
    END IF;
   EXCEPTION WHEN serialization_failure THEN result:='changed';detail:='source_changed';review:=NULL;
    WHEN check_violation THEN
     IF SQLERRM IN('v2_field_choice_requires_uncontested_live_evidence','v2_review_case_requires_reopening','v2_review_evidence_missing_hidden_or_duplicate','v2_review_evidence_required')
      THEN result:='held';detail:='needs_context';review:=NULL;ELSE RAISE;END IF;
   END;
  END IF;
  INSERT INTO public.v2_admin_batch_items VALUES(request,idx,route,field,
   CASE WHEN EXISTS(SELECT 1 FROM public.v2_contributions WHERE id=contribution) THEN contribution END,
   CASE WHEN EXISTS(SELECT 1 FROM public.v2_observations WHERE id=observation) THEN observation END,
   review,result,detail);idx:=idx+1;
 END LOOP;
 RETURN public.v2_api_admin_batch_receipt(actor,request);
END;$$;

DO $$DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_admin_batches','v2_admin_batch_items','v2_admin_core_threads'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO mabhazi_api USING(true)',t||'_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  IF f.proname LIKE 'v2_api_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f.signature);END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;
$admin_dashboard_source39$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0039_admin_property_batches.sql','09c61f1a7c5e4b1252f70243a8aacaf4f39669aef60193610250dc9697db2de5');
 ELSIF previous40 IS NULL THEN FOR spec IN SELECT value FROM jsonb_array_elements('[{"name":"v2_admin_require","signature":"public.v2_admin_require(varchar)","returns":"void","backend":false,"definer":false,"volatility":"v","hash":"2f08be4a4d9f2dfbea63d541f43a2a6ac8a69e1669e2e61332ca860a4cf0dae2"},{"name":"v2_admin_history_guard","signature":"public.v2_admin_history_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"62b6d6e428ccb2e0a566454998eba1a43876ea9a66ea6933dbb02a1b324bf5b3"},{"name":"v2_api_admin_batch_receipt","signature":"public.v2_api_admin_batch_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"9c244f61c40c7a54ffce64f77f298fc8e868d25bff28daab844aea0187c3fdc4"},{"name":"v2_api_admin_property_batch","signature":"public.v2_api_admin_property_batch(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"695af4d6fe7255bc7c772a853c1df9f82d38e597043eff30eb6fe8e242224dd9"}]'::jsonb) LOOP
 SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(spec->>'signature');
 IF NOT FOUND OR proc_row.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR proc_row.prosecdef IS DISTINCT FROM (spec->>'definer')::boolean OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
  OR proc_row.provolatile::text<>spec->>'volatility' OR proc_row.prorettype<>to_regtype(spec->>'returns')
  OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>spec->>'hash'
  OR has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE') IS DISTINCT FROM (spec->>'backend')::boolean
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(proc_row.proacl,acldefault('f',proc_row.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'admin_function_fence_changed: %',spec->>'signature';END IF;
 END LOOP; END IF;
 IF previous40 IS NULL THEN
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['v2_admin_route_actions','v2_admin_active_route_removals']) t WHERE to_regclass('public.'||t) IS NOT NULL)
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action'])) THEN RAISE EXCEPTION 'admin_partial_or_unrecorded';END IF;
  EXECUTE $admin_dashboard_source40$-- Named, restorable route visibility. No source evidence or lifecycle is erased.
CREATE TABLE public.v2_admin_route_actions(
 id uuid PRIMARY KEY,actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 request_digest text,operation text NOT NULL CHECK(operation IN('remove','restore')),
 reason_code text NOT NULL CHECK(reason_code IN('inaccurate','duplicate','spam','unsafe','other','removal_reversed','record_rechecked')),
 route_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),
 contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 expected_revision bigint NOT NULL CHECK(expected_revision BETWEEN 1 AND 9007199254740991),
 removal_id uuid REFERENCES public.v2_admin_route_actions(id),
 outcome text NOT NULL CHECK(outcome IN('removed','restored','changed','unavailable','already_restored')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((actor_user_id IS NULL AND request_digest IS NULL) OR (actor_user_id IS NOT NULL AND request_digest~'^[0-9a-f]{64}$')),
 CHECK((operation='remove' AND removal_id IS NULL) OR (operation='restore' AND removal_id IS NOT NULL))
);
CREATE INDEX v2_admin_route_actions_subject_idx ON public.v2_admin_route_actions(route_subject_id,created_at,id);
CREATE INDEX v2_admin_route_actions_source_idx ON public.v2_admin_route_actions(contribution_id);
CREATE UNIQUE INDEX v2_admin_route_restored_once ON public.v2_admin_route_actions(removal_id) WHERE outcome='restored';
CREATE VIEW public.v2_admin_active_route_removals AS
 SELECT a.* FROM public.v2_admin_route_actions a WHERE a.operation='remove' AND a.outcome='removed'
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_route_actions r WHERE r.removal_id=a.id AND r.outcome='restored');

CREATE FUNCTION public.v2_admin_route_action_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1
  AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR NEW.actor_user_id IS NULL)
  AND (NEW.contribution_id IS NOT DISTINCT FROM OLD.contribution_id OR NEW.contribution_id IS NULL)
  AND to_jsonb(NEW)-ARRAY['actor_user_id','request_digest','contribution_id']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest','contribution_id'] THEN
  IF NEW.actor_user_id IS NULL THEN NEW.request_digest:=NULL;END IF;RETURN NEW;
 END IF;
 RAISE EXCEPTION 'v2_admin_history_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_admin_route_action_guard BEFORE UPDATE OR DELETE ON public.v2_admin_route_actions
 FOR EACH ROW EXECUTE FUNCTION public.v2_admin_route_action_guard();
CREATE FUNCTION public.v2_admin_route_action_propagate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.outcome IN('removed','restored') THEN
  PERFORM public.v2_transport_propagate(ARRAY[NEW.route_subject_id],'v2_admin_route_actions','UPDATE',ARRAY['public_visibility']);
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_admin_route_action_propagate AFTER INSERT ON public.v2_admin_route_actions
 FOR EACH ROW EXECUTE FUNCTION public.v2_admin_route_action_propagate();

CREATE FUNCTION public.v2_api_admin_route_action_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('id',a.id,'operation',a.operation,'reason',a.reason_code,'routeId',a.route_subject_id,
  'removalId',a.removal_id,'outcome',a.outcome,'createdAt',a.created_at,'actorErased',a.actor_user_id IS NULL,'actorId',a.actor_user_id,
  'sourceErased',a.contribution_id IS NULL,'effect',CASE a.outcome WHEN 'removed' THEN 'public_hidden'
   WHEN 'restored' THEN 'eligibility_recheck_queued' ELSE 'unchanged' END)
 INTO result FROM public.v2_admin_route_actions a WHERE a.id=request;
 RETURN COALESCE(result,'{"found":false}'::jsonb);
END;$$;
CREATE FUNCTION public.v2_api_admin_route_action(actor varchar,request uuid,input jsonb) RETURNS jsonb
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
  WHERE l.subject_id=route AND l.intake_kind='community' AND NOT l.attribution_erased;
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

DO $$DECLARE r text;f record;t text;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_admin_route_actions','v2_admin_active_route_removals'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 ALTER TABLE public.v2_admin_route_actions ENABLE ROW LEVEL SECURITY;
 CREATE POLICY v2_admin_route_actions_api ON public.v2_admin_route_actions FOR SELECT TO mabhazi_api USING(true);
 FOR f IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  IF f.proname LIKE 'v2_api_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f.signature);END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;


CREATE OR REPLACE VIEW public.v2_public_lead_reports AS SELECT l.subject_id,s.revision,c.user_id AS author_user_id,corridor.origin_city_id,corridor.destination_city_id,
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
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals h WHERE h.route_subject_id=l.subject_id);

CREATE OR REPLACE FUNCTION public.v2_prompt_eligible(task uuid,actor varchar,contexts text[]) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE t public.v2_question_tasks; r public.v2_question_registry; kind text; a jsonb; p text; found_fact boolean;
BEGIN
 IF NOT public.v2_prompt_context_valid(contexts) THEN RETURN false; END IF;
 SELECT q.* INTO t FROM public.v2_question_tasks q JOIN public.v2_subjects s ON s.id=q.subject_id
 WHERE q.id=task AND q.state='open' AND s.lifecycle='active' AND q.input_generation=s.input_generation;
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals h WHERE h.route_subject_id=t.subject_id) THEN RETURN false;END IF;
 SELECT * INTO r FROM public.v2_question_registry WHERE key=t.registry_key AND version=t.registry_version;
 IF (r.context_mode='all' AND NOT contexts @> r.contexts) OR (r.context_mode='any' AND NOT contexts && r.contexts) THEN RETURN false; END IF;
 IF t.field_key='fare.paid' AND NOT contexts @> ARRAY['travelled','paid'] THEN RETURN false; END IF;
 IF t.registry_key='resolve_conflict_context' AND NOT 'relevant_conflict'=ANY(contexts) THEN RETURN false; END IF;
 SELECT s.kind INTO kind FROM public.v2_subjects s WHERE s.id=t.subject_id;
 IF t.registry_key='fare_paid' AND kind IN('lead','actual_journey') AND NOT EXISTS
  (SELECT 1 FROM public.v2_contributions c WHERE c.original_subject_id=t.subject_id AND c.user_id=actor) THEN RETURN false; END IF;
 IF kind='lead' AND t.registry_key<>'identify_service' AND NOT EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=t.subject_id AND corridor_id IS NOT NULL AND reported_departure_seconds IS NOT NULL AND num_nonnulls(operator_subject_id,operator_name)=1) THEN RETURN false; END IF;
 IF kind='actual_journey' AND NOT EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_observation_states st ON st.observation_id=o.id WHERE public.v2_observation_subject(o.id)=t.subject_id AND st.status='active') THEN RETURN false; END IF;
 IF t.registry_key='identify_service' THEN
  RETURN (kind='lead' AND EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=t.subject_id AND operator_subject_id IS NULL))
    OR (kind='actual_journey' AND EXISTS(SELECT 1 FROM public.v2_actual_journeys WHERE subject_id=t.subject_id AND association_status='unresolved'));
 END IF;
 IF t.registry_key='clarify_time_basis' THEN
  RETURN EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_observation_states st ON st.observation_id=o.id
   WHERE public.v2_observation_subject(o.id)=t.subject_id AND st.status='active' AND o.field_key='departure.reported' AND o.scope_key=t.scope_key AND o.value->>'basis'='unspecified');
 END IF;
 -- Read evidence at the real clock, even if the background task refresher stalls.
 SELECT version INTO p FROM public.v2_evidence_policy_state WHERE id;
 a:=public.v2_evaluate_assessment(t.subject_id,t.field_key,t.scope,statement_timestamp(),p);
 IF t.reason='disputed' THEN RETURN a->>'dispute'='open'; END IF;
 IF t.reason='stale' THEN RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(a->'inputs') x WHERE x->>'freshness' IN('recheck_due','expired') AND x->>'evidenceDate' IS NOT NULL AND x->>'reason' NOT IN('hidden','withdrawn','superseded','future_or_invalid_date','not_yet_effective')); END IF;
 -- A usable current report satisfies a missing-fact invitation, without claiming
 -- that it is corroborated or canonically accepted.
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'candidates') x WHERE x->>'freshness'='current');
END; $$;

CREATE OR REPLACE FUNCTION public.v2_submit_actual_journey(actor varchar,required_terms text,request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  IF NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=intended_id AND kind=intended_kind AND lifecycle='active' AND NOT EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals h WHERE h.route_subject_id=intended_id)) THEN RAISE EXCEPTION 'v2_actual_intended_subject_unavailable' USING ERRCODE='23503';END IF;
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

CREATE OR REPLACE FUNCTION public.v2_api_admin_batch_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('id',b.id,'operation',b.operation,'reason',b.reason_code,'createdAt',b.created_at,
  'actorErased',b.actor_user_id IS NULL,'actorId',b.actor_user_id,'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'ordinal',i.ordinal,'routeId',i.route_subject_id,'fieldKey',i.field_key,'observationId',i.observation_id,
   'reviewId',i.review_id,'outcome',i.outcome,'detail',CASE WHEN i.contribution_id IS NULL THEN 'erased' ELSE i.detail END)
   ORDER BY i.ordinal) FROM public.v2_admin_batch_items i WHERE i.batch_id=b.id),'[]'::jsonb))
 INTO result FROM public.v2_admin_batches b WHERE b.id=request;
 RETURN COALESCE(result,'{"found":false}'::jsonb);
END;$$;

$admin_dashboard_source40$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0040_admin_route_visibility.sql','4598a5a24c8e9c6b1203c44e9fb6ee7b1897ef03f51dd16f6ea1b2a843415a8d');
 END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements('[{"name":"v2_admin_require","signature":"public.v2_admin_require(varchar)","returns":"void","backend":false,"definer":false,"volatility":"v","hash":"2f08be4a4d9f2dfbea63d541f43a2a6ac8a69e1669e2e61332ca860a4cf0dae2"},{"name":"v2_admin_history_guard","signature":"public.v2_admin_history_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"62b6d6e428ccb2e0a566454998eba1a43876ea9a66ea6933dbb02a1b324bf5b3"},{"name":"v2_api_admin_batch_receipt","signature":"public.v2_api_admin_batch_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"93ff8c60129278813fe18bf0372d1139a387fafbecc36b714c4bfcce25f72477"},{"name":"v2_api_admin_property_batch","signature":"public.v2_api_admin_property_batch(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"695af4d6fe7255bc7c772a853c1df9f82d38e597043eff30eb6fe8e242224dd9"},{"name":"v2_admin_route_action_guard","signature":"public.v2_admin_route_action_guard()","returns":"trigger","backend":false,"definer":false,"volatility":"v","hash":"16d96eb3b83b8799174108b2ea0d43c7ea432fbf22f5c27749907dcd0c3bc458"},{"name":"v2_admin_route_action_propagate","signature":"public.v2_admin_route_action_propagate()","returns":"trigger","backend":false,"definer":true,"volatility":"v","hash":"8602707d14654207b2fca989c6a495d736c456fcedc4b8f09cb38487fb4f79bd"},{"name":"v2_api_admin_route_action_receipt","signature":"public.v2_api_admin_route_action_receipt(varchar,uuid)","returns":"jsonb","backend":true,"definer":true,"volatility":"s","hash":"b027e3d173f5dff5d09ce58363e69259c678a1858fb46a93e787fcbf7a7a4a59"},{"name":"v2_api_admin_route_action","signature":"public.v2_api_admin_route_action(varchar,uuid,jsonb)","returns":"jsonb","backend":true,"definer":true,"volatility":"v","hash":"a1c7976dd6394610760f002fdf6b9d77eed6101b4d2a4e34b91e5fe8599dbc4a"},{"name":"v2_prompt_eligible","signature":"public.v2_prompt_eligible(uuid,varchar,text[])","returns":"boolean","backend":false,"definer":false,"volatility":"s","hash":"55a6a5498690d4e6a2bf745803126d187860378e7d96927dd59bf93959aa6708"},{"name":"v2_submit_actual_journey","signature":"public.v2_submit_actual_journey(varchar,text,jsonb)","returns":"jsonb","backend":false,"definer":true,"volatility":"v","hash":"d081fdd558099dc179273b26f2c8b8e1a8505eb277603c2a6df0100f8e93cf38"}]'::jsonb) LOOP
 SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(spec->>'signature');
 IF NOT FOUND OR proc_row.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR proc_row.prosecdef IS DISTINCT FROM (spec->>'definer')::boolean OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
  OR proc_row.provolatile::text<>spec->>'volatility' OR proc_row.prorettype<>to_regtype(spec->>'returns')
  OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>spec->>'hash'
  OR has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE') IS DISTINCT FROM (spec->>'backend')::boolean
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(proc_row.proacl,acldefault('f',proc_row.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'admin_function_fence_changed: %',spec->>'signature';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch','v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action','v2_prompt_eligible','v2_submit_actual_journey'])
 AND oid<>ALL(ARRAY['public.v2_admin_require(varchar)'::regprocedure,'public.v2_admin_history_guard()'::regprocedure,'public.v2_api_admin_batch_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_property_batch(varchar,uuid,jsonb)'::regprocedure,'public.v2_admin_route_action_guard()'::regprocedure,'public.v2_admin_route_action_propagate()'::regprocedure,'public.v2_api_admin_route_action_receipt(varchar,uuid)'::regprocedure,'public.v2_api_admin_route_action(varchar,uuid,jsonb)'::regprocedure,'public.v2_prompt_eligible(uuid,varchar,text[])'::regprocedure,'public.v2_submit_actual_journey(varchar,text,jsonb)'::regprocedure])) THEN RAISE EXCEPTION 'admin_unexpected_overload';END IF;
 FOREACH table_name IN ARRAY ARRAY['v2_admin_batches','v2_admin_batch_items','v2_admin_core_threads','v2_admin_route_actions'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||table_name) AND relrowsecurity AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
   OR NOT has_table_privilege('mabhazi_api','public.'||table_name,'SELECT')
   OR has_table_privilege('mabhazi_api','public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   THEN RAISE EXCEPTION 'admin_table_fence_changed: %',table_name;END IF;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['v2_admin_batches','v2_admin_batch_items','v2_admin_core_threads','v2_admin_route_actions','v2_admin_active_route_removals'] LOOP
  IF EXISTS(SELECT 1 FROM aclexplode((SELECT coalesce(relacl,acldefault('r',relowner)) FROM pg_class WHERE oid=to_regclass('public.'||table_name))) a WHERE a.grantee=0)
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_table_privilege(r.oid,to_regclass('public.'||table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
   THEN RAISE EXCEPTION 'admin_table_fence_changed: %',table_name;END IF;
 END LOOP;
 EXECUTE $admin_expected_public$CREATE TEMPORARY VIEW mabhazi_expected_public_leads AS SELECT l.subject_id,s.revision,c.user_id AS author_user_id,corridor.origin_city_id,corridor.destination_city_id,
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
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals h WHERE h.route_subject_id=l.subject_id);$admin_expected_public$;
 EXECUTE $admin_expected_active$CREATE TEMPORARY VIEW mabhazi_expected_active_removals AS
 SELECT a.* FROM public.v2_admin_route_actions a WHERE a.operation='remove' AND a.outcome='removed'
 AND NOT EXISTS(SELECT 1 FROM public.v2_admin_route_actions r WHERE r.removal_id=a.id AND r.outcome='restored');$admin_expected_active$;
 IF pg_get_viewdef('public.v2_public_lead_reports'::regclass)<>pg_get_viewdef('pg_temp.mabhazi_expected_public_leads'::regclass)
 OR pg_get_viewdef('public.v2_admin_active_route_removals'::regclass)<>pg_get_viewdef('pg_temp.mabhazi_expected_active_removals'::regclass)
 THEN RAISE EXCEPTION 'admin_visibility_view_changed';END IF;
 DROP VIEW pg_temp.mabhazi_expected_public_leads;DROP VIEW pg_temp.mabhazi_expected_active_removals;
 IF jsonb_build_array((SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_targets x),(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x)) IS DISTINCT FROM before_data OR (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname<>ALL(ARRAY['v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch','v2_admin_route_action_guard','v2_admin_route_action_propagate','v2_api_admin_route_action_receipt','v2_api_admin_route_action','v2_prompt_eligible','v2_submit_actual_journey'])) IS DISTINCT FROM before_functions THEN RAISE EXCEPTION 'admin_unrelated_state_changed';END IF;
END;$admin_dashboard_guard$;
COMMIT;
SELECT clock_timestamp() checked_at,(SELECT count(*) FROM mabhazi_migrations.applied) ledger_entries,
 (SELECT count(*) FROM public.v2_admin_batches) batch_actions,(SELECT count(*) FROM public.v2_admin_route_actions) visibility_actions;
