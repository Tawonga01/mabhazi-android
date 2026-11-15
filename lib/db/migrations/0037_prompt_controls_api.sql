-- Account prompt controls only; prompts/1 policy and manual help are unchanged.
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
