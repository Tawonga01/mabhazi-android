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
