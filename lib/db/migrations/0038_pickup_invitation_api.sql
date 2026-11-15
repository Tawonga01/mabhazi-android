-- Supported unsolicited pickup reservation; existing prompts/1 settings apply.
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
