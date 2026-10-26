-- Mabhazi Preview ocwlqhlfavvuncfmzuqh only. Fresh action-time permission required.
-- Source0036 SHA256 e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86; four restricted manual-question functions and one private binding table.
BEGIN;
SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $preview_pickup_0036$
DECLARE previous text;before_data jsonb;before_functions jsonb;f jsonb;proc_row record;shape jsonb;
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
('0035_route_place_reports.sql','19df96929ff2eb5539d59e430541b6b6eb6648d9b7d6247ddd0d0edba102804a')) expected(name,checksum)
 LEFT JOIN mabhazi_migrations.applied actual USING(name) WHERE actual.checksum IS DISTINCT FROM expected.checksum)
 OR (SELECT count(*) FROM mabhazi_migrations.applied) NOT IN(36,37) THEN RAISE EXCEPTION 'pickup_preview_baseline_changed';END IF;
 SELECT checksum INTO previous FROM mabhazi_migrations.applied WHERE name='0036_pickup_question_api.sql';
 IF previous IS NOT NULL AND previous<>'e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86' THEN RAISE EXCEPTION 'pickup_preview_hash_changed';END IF;
 SELECT jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x)) INTO before_data;SELECT (SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) FROM pg_proc proc_snapshot WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_api_pickup_question_read','v2_api_pickup_question_reserve','v2_api_pickup_question_event','v2_api_submit_pickup_question_answer')) INTO before_functions;
 IF previous IS NULL THEN
  IF to_regclass('public.v2_pickup_answer_requests') IS NOT NULL
   OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_api_pickup_question_read','v2_api_pickup_question_reserve','v2_api_pickup_question_event','v2_api_submit_pickup_question_answer'))
   THEN RAISE EXCEPTION 'pickup_partial_or_unrecorded';END IF;
  EXECUTE $source_pickup_0036$
-- Supported manual pickup questions. Existing prompts/1 policy is unchanged.
CREATE TABLE public.v2_pickup_answer_requests (
 user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 client_submission_id uuid NOT NULL,
 invitation_id uuid NOT NULL,
 contribution_id uuid NOT NULL REFERENCES public.v2_contributions(id) ON DELETE CASCADE,
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,client_submission_id),
 FOREIGN KEY(invitation_id,user_id) REFERENCES public.v2_prompt_invitations(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,client_submission_id) REFERENCES public.v2_receipts(user_id,client_submission_id) ON DELETE CASCADE
);
ALTER TABLE public.v2_pickup_answer_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_pickup_answer_requests FROM PUBLIC,mabhazi_api;
GRANT SELECT ON public.v2_pickup_answer_requests TO mabhazi_api;
CREATE POLICY v2_pickup_answer_requests_backend_select ON public.v2_pickup_answer_requests FOR SELECT TO mabhazi_api USING (true);
CREATE TRIGGER v2_pickup_answer_request_immutable BEFORE UPDATE ON public.v2_pickup_answer_requests
 FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_immutable();

CREATE FUNCTION public.v2_api_pickup_question_read(p_actor varchar,p_invitation uuid,p_blocked varchar[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.v2_prompt_invitations;t public.v2_question_tasks;result jsonb;context jsonb;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor)
  OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=p_actor) THEN RAISE EXCEPTION 'v2_prompt_account_unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM public.v2_prompt_invitations WHERE id=p_invitation AND user_id=p_actor;
 SELECT q.* INTO t FROM public.v2_question_tasks q JOIN public.v2_subjects s ON s.id=q.subject_id
  WHERE q.id=i.task_id AND s.kind='lead' AND q.registry_key='pickup_place' AND q.registry_version='prompts/1'
   AND q.field_key='boarding.pickup' AND q.scope='{}'::jsonb;
 IF i.id IS NULL OR t.id IS NULL THEN RETURN jsonb_build_object('status','unavailable');END IF;
 result:=public.v2_prompt_read(p_actor,p_invitation);
 IF result->>'status' NOT IN('offered','opened') THEN RETURN jsonb_build_object('status',result->>'status');END IF;
 BEGIN context:=public.v2_api_route_contribution_context(p_actor,t.subject_id,p_blocked);
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','unavailable');END;
 RETURN jsonb_build_object('status',result->>'status','invitationId',i.id,'questionKey','pickup_place',
  'formSchemaId','boarding-pickup/1','expiresAt',i.expires_at,'route',context);
END;$$;

CREATE FUNCTION public.v2_api_pickup_question_reserve(p_actor varchar,p_request uuid,p_subject uuid,p_declared text[],p_surface text,p_blocked varchar[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_prompt_requests;chosen public.v2_question_tasks;session public.v2_prompt_sessions;
 now_time timestamptz;digest text;minutes integer;context jsonb;
BEGIN
 PERFORM public.v2_prompt_account(p_actor);
 IF p_request IS NULL OR p_subject IS NULL OR p_surface IS NULL OR p_surface NOT IN('search_result','route_detail','own_contribution','contribute_tab')
  OR NOT public.v2_prompt_context_valid(p_declared) OR cardinality(p_declared) NOT BETWEEN 1 AND 3
  OR EXISTS(SELECT 1 FROM unnest(p_declared) d WHERE d NOT IN('knows_route','at_stop','travelled'))
  THEN RAISE EXCEPTION 'v2_prompt_request_invalid' USING ERRCODE='23514';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array('manual-pickup/1',p_actor,p_subject,p_surface,ARRAY(SELECT d FROM unnest(p_declared) d ORDER BY d)));
 SELECT * INTO prior FROM public.v2_prompt_requests WHERE id=p_request;
 IF FOUND THEN
  IF prior.user_id<>p_actor OR prior.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_prompt_request_conflict' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.v2_prompt_invitations WHERE id=p_request AND user_id=p_actor) THEN RETURN jsonb_build_object('status','none');END IF;
  RETURN public.v2_api_pickup_question_read(p_actor,p_request,p_blocked);
 END IF;
 context:=public.v2_api_route_contribution_context(p_actor,p_subject,p_blocked);
 PERFORM public.v2_prompt_touch(p_actor);
 SELECT * INTO session FROM public.v2_prompt_sessions WHERE user_id=p_actor;
 now_time:=clock_timestamp();SELECT unopened_minutes INTO minutes FROM public.v2_prompt_policies WHERE version='prompts/1';
 -- Never reserve an unsupported higher-priority question or consume an automatic invitation slot.
 SELECT q.* INTO chosen FROM public.v2_question_tasks q JOIN public.v2_subjects s ON s.id=q.subject_id
  WHERE q.subject_id=p_subject AND s.kind='lead' AND q.registry_key='pickup_place' AND q.registry_version='prompts/1'
   AND q.field_key='boarding.pickup' AND q.scope='{}'::jsonb AND public.v2_prompt_eligible(q.id,p_actor,p_declared)
  ORDER BY q.priority,q.created_at,q.id LIMIT 1;
 INSERT INTO public.v2_prompt_requests(id,user_id,request_digest,session_id,consumed,created_at)
  VALUES(p_request,p_actor,digest,session.session_id,false,now_time);
 IF chosen.id IS NULL THEN RETURN jsonb_build_object('status','none');END IF;
 INSERT INTO public.v2_prompt_invitations(id,user_id,task_id,policy_version,mode,reserved_at,expires_at,target_revision,identity_hash,declared_context,surface)
  VALUES(p_request,p_actor,chosen.id,'prompts/1','manual',now_time,now_time+make_interval(mins=>minutes),
   (context->>'revision')::bigint,context->>'identityKey',p_declared,p_surface);
 RETURN public.v2_api_pickup_question_read(p_actor,p_request,p_blocked);
END;$$;

CREATE FUNCTION public.v2_api_pickup_question_event(p_actor varchar,p_invitation uuid,p_event uuid,p_feedback text,p_timezone text,p_blocked varchar[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE valid boolean;result uuid;status jsonb;
BEGIN
 PERFORM public.v2_prompt_account(p_actor);
 SELECT true INTO valid FROM public.v2_prompt_invitations i JOIN public.v2_question_tasks q ON q.id=i.task_id
  JOIN public.v2_subjects s ON s.id=q.subject_id WHERE i.id=p_invitation AND i.user_id=p_actor AND s.kind='lead'
   AND q.registry_key='pickup_place' AND q.registry_version='prompts/1' AND q.field_key='boarding.pickup' AND q.scope='{}'::jsonb;
 IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'v2_prompt_invitation_unavailable' USING ERRCODE='42501';END IF;
 IF p_feedback IN('shown','opened') AND NOT EXISTS(SELECT 1 FROM public.v2_prompt_events WHERE id=p_event AND user_id=p_actor) THEN
  status:=public.v2_api_pickup_question_read(p_actor,p_invitation,p_blocked);
  IF status->>'status' NOT IN('offered','opened') THEN RAISE EXCEPTION 'v2_prompt_no_longer_offered' USING ERRCODE='23514';END IF;
 END IF;
 result:=public.v2_prompt_event(p_actor,p_invitation,p_event,p_feedback,p_timezone);
 RETURN jsonb_build_object('eventId',result);
END;$$;

CREATE FUNCTION public.v2_api_submit_pickup_question_answer(p_actor varchar,p_required_terms text,p_request jsonb,p_blocked varchar[],p_invitation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_pickup_answer_requests;i public.v2_prompt_invitations;t public.v2_question_tasks;
 client_key uuid;context jsonb;receipt jsonb;observation uuid;
BEGIN
 PERFORM public.v2_prompt_account(p_actor);
 IF p_invitation IS NULL OR NOT public.v2_json_uuid(p_request->'clientSubmissionId') THEN RAISE EXCEPTION 'v2_prompt_request_invalid' USING ERRCODE='23514';END IF;
 client_key:=(p_request->>'clientSubmissionId')::uuid;
 SELECT * INTO prior FROM public.v2_pickup_answer_requests WHERE user_id=p_actor AND client_submission_id=client_key;
 IF FOUND THEN
  IF prior.invitation_id<>p_invitation OR NOT EXISTS(SELECT 1 FROM public.v2_prompt_events e WHERE e.id=client_key
   AND e.invitation_id=p_invitation AND e.user_id=p_actor AND e.outcome='answered' AND e.observation_id=prior.observation_id)
   THEN RAISE EXCEPTION 'v2_prompt_request_conflict' USING ERRCODE='23514';END IF;
  -- Historical exact replay uses the writer's own immutable receipt, even after later route changes.
  RETURN public.v2_api_submit_route_observations(p_actor,p_required_terms,p_request,p_blocked);
 END IF;
 IF EXISTS(SELECT 1 FROM public.v2_receipts WHERE user_id=p_actor AND client_submission_id=client_key)
  THEN RAISE EXCEPTION 'v2_prompt_independent_receipt_conflict' USING ERRCODE='23514';END IF;
 SELECT * INTO i FROM public.v2_prompt_invitations WHERE id=p_invitation AND user_id=p_actor;
 SELECT q.* INTO t FROM public.v2_question_tasks q JOIN public.v2_subjects s ON s.id=q.subject_id
  WHERE q.id=i.task_id AND s.kind='lead' AND q.registry_key='pickup_place' AND q.registry_version='prompts/1'
   AND q.field_key='boarding.pickup' AND q.scope='{}'::jsonb;
 IF i.id IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'v2_prompt_invitation_unavailable' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.v2_prompt_events WHERE invitation_id=p_invitation AND outcome IN('skip','dismiss','unknown','answered'))
  THEN RAISE EXCEPTION 'v2_prompt_event_already_recorded' USING ERRCODE='23514';END IF;
 context:=public.v2_api_route_contribution_context(p_actor,t.subject_id,p_blocked);
 IF i.identity_hash IS DISTINCT FROM context->>'identityKey'
  THEN RAISE EXCEPTION 'v2_prompt_identity_reconfirmation_required' USING ERRCODE='40001';END IF;
 IF (p_request->'target'->'existing'->>'subjectId') IS DISTINCT FROM t.subject_id::text
  THEN RAISE EXCEPTION 'v2_prompt_answer_requires_saved_matching_observation' USING ERRCODE='23514';END IF;
 receipt:=public.v2_api_submit_route_observations(p_actor,p_required_terms,p_request,p_blocked);
 SELECT o.id INTO observation FROM public.v2_observations o JOIN public.v2_observation_states st ON st.observation_id=o.id
  WHERE o.contribution_id=(receipt->>'contributionId')::uuid AND o.field_key=t.field_key AND o.scope_key=t.scope_key
   AND st.status='active' AND public.v2_observation_subject(o.id)=t.subject_id;
 -- Final identity and owned matching observation/receipt checks happen after intake; any failure rolls everything back.
 PERFORM public.v2_prompt_answer(p_actor,p_invitation,client_key,observation);
 INSERT INTO public.v2_pickup_answer_requests(user_id,client_submission_id,invitation_id,contribution_id,observation_id)
  VALUES(p_actor,client_key,p_invitation,(receipt->>'contributionId')::uuid,observation);
 RETURN receipt;
END;$$;

DO $$DECLARE f text;r text;BEGIN
 FOREACH f IN ARRAY ARRAY[
  'public.v2_api_pickup_question_read(varchar,uuid,varchar[])',
  'public.v2_api_pickup_question_reserve(varchar,uuid,uuid,text[],text,varchar[])',
  'public.v2_api_pickup_question_event(varchar,uuid,uuid,text,text,varchar[])',
  'public.v2_api_submit_pickup_question_answer(varchar,text,jsonb,varchar[],uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.v2_pickup_answer_requests FROM %I',r);END IF;END LOOP;
END;$$;

$source_pickup_0036$;
  INSERT INTO mabhazi_migrations.applied(name,checksum) VALUES('0036_pickup_question_api.sql','e60d47a74eb7fd07726a5fb965666352b75b2c8ba303df1c9890d732ed6a9b86');
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements($specs$[{"name":"v2_api_pickup_question_read","signature":"public.v2_api_pickup_question_read(varchar,uuid,varchar[])","hash":"e51f43c6be2e31fa0d3d1b713bf2a60ca43965fbbaf6f5ee812fc85db59a762b","volatility":"s"},{"name":"v2_api_pickup_question_reserve","signature":"public.v2_api_pickup_question_reserve(varchar,uuid,uuid,text[],text,varchar[])","hash":"20fc6605f9a649eeaca44033f5593d00487e653c45408d7fe5dc1da3f584f0cf","volatility":"v"},{"name":"v2_api_pickup_question_event","signature":"public.v2_api_pickup_question_event(varchar,uuid,uuid,text,text,varchar[])","hash":"eb089c1697e4d543ce7c1b822b2fe740d55995d3f397410aaf385127d1f6edeb","volatility":"v"},{"name":"v2_api_submit_pickup_question_answer","signature":"public.v2_api_submit_pickup_question_answer(varchar,text,jsonb,varchar[],uuid)","hash":"40750840cec224990a30c0954078729ebcf82250165aeb7a1b9bcfa2d4b11850","volatility":"v"}]$specs$::jsonb) LOOP
  SELECT * INTO proc_row FROM pg_proc WHERE oid=to_regprocedure(f->>'signature');
  IF proc_row.oid IS NULL OR NOT proc_row.prosecdef OR proc_row.provolatile<>(f->>'volatility')::"char"
   OR proc_row.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR proc_row.prorettype<>'jsonb'::regtype
   OR proc_row.proretset OR proc_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR encode(sha256(convert_to(replace(proc_row.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>f->>'hash'
   OR NOT has_function_privilege('mabhazi_api',proc_row.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(proc_row.proacl,acldefault('f',proc_row.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_function_privilege(r.oid,proc_row.oid,'EXECUTE'))
   THEN RAISE EXCEPTION 'pickup_function_fence_changed: %',f->>'signature';END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum) INTO shape
 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.v2_pickup_answer_requests') AND a.attnum>0 AND NOT a.attisdropped;
 IF shape IS DISTINCT FROM $cols$[["user_id","character varying",true],["client_submission_id","uuid",true],["invitation_id","uuid",true],["contribution_id","uuid",true],["observation_id","uuid",true],["created_at","timestamp with time zone",true]]$cols$::jsonb
  OR NOT COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.v2_pickup_answer_requests')),false)
  OR (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.v2_pickup_answer_requests'))<>6
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.v2_pickup_answer_requests') AND contype='p' AND conkey=ARRAY[1,2]::smallint[])
  OR NOT EXISTS(SELECT 1 FROM pg_attrdef WHERE adrelid=to_regclass('public.v2_pickup_answer_requests') AND adnum=6 AND pg_get_expr(adbin,adrelid)='clock_timestamp()')
  THEN RAISE EXCEPTION 'pickup_table_shape_changed';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements('[{"local":[1],"table":"users","remote":["id"]},{"local":[4],"table":"v2_contributions","remote":["id"]},{"local":[5],"table":"v2_observations","remote":["id"]},{"local":[3,1],"table":"v2_prompt_invitations","remote":["id","user_id"]},{"local":[1,2],"table":"v2_receipts","remote":["user_id","client_submission_id"]}]'::jsonb) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.v2_pickup_answer_requests') AND c.contype='f'
   AND c.confrelid=to_regclass('public.'||(f->>'table')) AND c.confdeltype='c'
   AND to_jsonb(c.conkey)=f->'local'
   AND (SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum)=f->'remote')
   THEN RAISE EXCEPTION 'pickup_table_shape_changed';END IF;
 END LOOP;
 IF NOT has_table_privilege('mabhazi_api','public.v2_pickup_answer_requests','SELECT')
  OR has_table_privilege('mabhazi_api','public.v2_pickup_answer_requests','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated') AND has_table_privilege(r.oid,'public.v2_pickup_answer_requests','SELECT,INSERT,UPDATE,DELETE'))
  OR EXISTS(SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid='public.v2_pickup_answer_requests'::regclass)) WHERE grantee=0)
  OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.v2_pickup_answer_requests'::regclass)<>1
  OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.v2_pickup_answer_requests'::regclass AND polname='v2_pickup_answer_requests_backend_select'
    AND polcmd='r' AND polpermissive AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='mabhazi_api')] AND pg_get_expr(polqual,polrelid)='true' AND polwithcheck IS NULL)
  THEN RAISE EXCEPTION 'pickup_table_fence_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.v2_pickup_answer_requests'::regclass AND tgname='v2_pickup_answer_request_immutable'
  AND tgenabled='O' AND tgtype=19 AND tgfoid='public.v2_prompt_immutable()'::regprocedure AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'pickup_trigger_changed';END IF;
 IF jsonb_build_array((SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_contributions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_receipts x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_observation_states x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_leads x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_question_tasks x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_preferences x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_requests x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_sessions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_invitations x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_events x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_prompt_suppressions x),(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'')) FROM public.v2_jobs x)) IS DISTINCT FROM before_data OR (SELECT jsonb_agg(to_jsonb(proc_snapshot) ORDER BY proc_snapshot.oid) FROM pg_proc proc_snapshot WHERE proc_snapshot.pronamespace='public'::regnamespace AND proc_snapshot.proname NOT IN('v2_api_pickup_question_read','v2_api_pickup_question_reserve','v2_api_pickup_question_event','v2_api_submit_pickup_question_answer')) IS DISTINCT FROM before_functions
  THEN RAISE EXCEPTION 'pickup_preserved_state_changed';END IF;
END;$preview_pickup_0036$;
COMMIT;
SELECT clock_timestamp() checked_at,(SELECT count(*) FROM mabhazi_migrations.applied) ledger_entries,
 (SELECT checksum FROM mabhazi_migrations.applied WHERE name='0036_pickup_question_api.sql') migration_hash;
