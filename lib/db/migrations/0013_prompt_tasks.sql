-- prompts/1 storage primitives. No HTTP actor binding or automatic UI/worker.
CREATE TABLE public.v2_prompt_policies (
 version text PRIMARY KEY, session_minutes integer NOT NULL CHECK(session_minutes>0), daily_cap integer NOT NULL CHECK(daily_cap>0),
 unopened_minutes integer NOT NULL CHECK(unopened_minutes>0), cooldown_hours integer NOT NULL CHECK(cooldown_hours>=24),
 unknown_days integer NOT NULL CHECK(unknown_days>0), retention_days integer NOT NULL CHECK(retention_days>=2)
);
INSERT INTO public.v2_prompt_policies VALUES('prompts/1',30,3,15,24,30,90);
CREATE TABLE public.v2_question_registry (
 key text NOT NULL, version text NOT NULL REFERENCES public.v2_prompt_policies(version), field_keys text[] NOT NULL,
 target_kinds text[] NOT NULL, prerequisites text[] NOT NULL, contexts text[] NOT NULL, context_mode text NOT NULL CHECK(context_mode IN('any','all')),
 form_schema_id text NOT NULL, surfaces text[] NOT NULL, priority integer NOT NULL CHECK(priority>0), freshness_policy text NOT NULL, suppression_policy text NOT NULL,
 PRIMARY KEY(key,version)
);
INSERT INTO public.v2_question_registry VALUES
 ('identify_service','prompts/1',ARRAY['operator.identity'],ARRAY['lead','actual_journey'],ARRAY['unresolved_identity'],ARRAY['knows_route','saw_bus'],'any','operator-identity/1',ARRAY['search_result','route_detail'],10,'evidence/1','prompts/1'),
 ('clarify_time_basis','prompts/1',ARRAY['departure.reported'],ARRAY['lead'],ARRAY['unspecified_clock'],ARRAY['knows_schedule','travelled'],'any','time-basis/1',ARRAY['search_result','route_detail'],20,'evidence/1','prompts/1'),
 ('operating_days','prompts/1',ARRAY['service.calendar'],ARRAY['lead','service_plan'],ARRAY['service_or_lead'],ARRAY['knows_schedule','saw_timetable'],'any','service-calendar/1',ARRAY['search_result','route_detail'],30,'evidence/1','prompts/1'),
 ('pickup_place','prompts/1',ARRAY['boarding.pickup'],ARRAY['lead','pattern','actual_journey'],ARRAY['service_or_explicit_unresolved'],ARRAY['knows_route','at_stop','travelled'],'any','boarding-pickup/1',ARRAY['search_result','route_detail'],40,'evidence/1','prompts/1'),
 ('fare_paid','prompts/1',ARRAY['fare.paid'],ARRAY['lead','pattern','run','actual_journey'],ARRAY['service_or_own_unresolved'],ARRAY['travelled','paid'],'all','fare-paid/1',ARRAY['search_result','route_detail'],50,'evidence/1','prompts/1'),
 ('fare_advertised','prompts/1',ARRAY['fare.advertised'],ARRAY['lead','pattern','run','actual_journey'],ARRAY['place_service_context'],ARRAY['observed_sign','operator_statement'],'any','fare-advertised/1',ARRAY['search_result','route_detail'],60,'evidence/1','prompts/1'),
 ('complete_pattern','prompts/1',ARRAY['pattern.stops'],ARRAY['lead','pattern'],ARRAY['pattern_or_lead'],ARRAY['knows_stops','travelled'],'any','pattern-stops/1',ARRAY['search_result','route_detail'],70,'evidence/1','prompts/1'),
 ('confirm_current_fact','prompts/1',ARRAY['*'],ARRAY['lead','operator','route','stop','pattern','service_plan','run','actual_journey'],ARRAY['dated_fact_due'],ARRAY['knows_route','knows_schedule','travelled','at_stop','saw_timetable','observed_sign','operator_statement'],'any','confirm-fact/1',ARRAY['search_result','route_detail'],80,'evidence/1','prompts/1'),
 ('resolve_conflict_context','prompts/1',ARRAY['*'],ARRAY['lead','operator','route','stop','pattern','service_plan','run','actual_journey'],ARRAY['current_scoped_conflict'],ARRAY['knows_route','knows_schedule','travelled','at_stop','saw_timetable','observed_sign','operator_statement'],'any','conflict-context/1',ARRAY['search_result','route_detail'],25,'evidence/1','prompts/1');
CREATE TABLE public.v2_question_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL REFERENCES public.v2_subjects(id) ON DELETE CASCADE,
 field_key text NOT NULL, scope_key text NOT NULL CHECK(scope_key~'^[0-9a-f]{64}$'), scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'),
 registry_key text NOT NULL, registry_version text NOT NULL, reason text NOT NULL CHECK(reason IN('missing','stale','disputed')),
 input_generation bigint NOT NULL CHECK(input_generation>0), state text NOT NULL DEFAULT 'open' CHECK(state IN('open','satisfied','obsolete','paused')),
 priority integer NOT NULL, created_at timestamptz NOT NULL DEFAULT statement_timestamp(), updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(registry_key,registry_version) REFERENCES public.v2_question_registry(key,version), CHECK(scope_key=public.v2_assessment_hash(scope))
);
CREATE UNIQUE INDEX v2_question_task_active ON public.v2_question_tasks(subject_id,field_key,scope_key,registry_key) WHERE state IN('open','paused');
CREATE INDEX v2_question_task_pick ON public.v2_question_tasks(state,priority,created_at,id);
CREATE TABLE public.v2_prompt_preferences (
 user_id varchar PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE, invitations_enabled boolean NOT NULL DEFAULT true,
 disabled_types text[] NOT NULL DEFAULT '{}', dismissed_until timestamptz, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE public.v2_prompt_suppressions (
 user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, subject_id uuid NOT NULL REFERENCES public.v2_subjects(id) ON DELETE CASCADE,
 field_key text NOT NULL, scope_key text NOT NULL, until_time timestamptz NOT NULL, reason text NOT NULL CHECK(reason='unknown'),
 PRIMARY KEY(user_id,subject_id,field_key,scope_key)
);
-- One current session per account, shared across devices. Clients cannot mint it.
CREATE TABLE public.v2_prompt_sessions (
 user_id varchar PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE, session_id uuid NOT NULL DEFAULT gen_random_uuid(),
 last_active_at timestamptz NOT NULL, invite_reserved boolean NOT NULL DEFAULT false
);
-- Reservation budget survives removal of task/answer content. A denied request
-- is also a receipt; replay cannot unexpectedly open a new invitation.
CREATE TABLE public.v2_prompt_requests (
 id uuid PRIMARY KEY, user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, request_digest text,
 session_id uuid NOT NULL, consumed boolean NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(id,user_id)
);
CREATE INDEX v2_prompt_request_budget ON public.v2_prompt_requests(user_id,created_at) WHERE consumed;
CREATE TABLE public.v2_prompt_invitations (
 id uuid PRIMARY KEY REFERENCES public.v2_prompt_requests(id) ON DELETE CASCADE, user_id varchar NOT NULL,
 task_id uuid NOT NULL REFERENCES public.v2_question_tasks(id) ON DELETE CASCADE, policy_version text NOT NULL REFERENCES public.v2_prompt_policies(version),
 mode text NOT NULL CHECK(mode IN('unsolicited','manual')), reserved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 target_revision bigint NOT NULL, identity_hash text NOT NULL, declared_context text[] NOT NULL, surface text NOT NULL,
 UNIQUE(id,user_id), FOREIGN KEY(id,user_id) REFERENCES public.v2_prompt_requests(id,user_id) ON DELETE CASCADE
);
CREATE INDEX v2_prompt_invitation_task ON public.v2_prompt_invitations(task_id);
CREATE TABLE public.v2_prompt_events (
 id uuid PRIMARY KEY, invitation_id uuid NOT NULL, user_id varchar NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('shown','opened','skip','dismiss','unknown','answered')),
 received_at timestamptz NOT NULL, client_observed_at timestamptz, request_digest text NOT NULL,
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 FOREIGN KEY(invitation_id,user_id) REFERENCES public.v2_prompt_invitations(id,user_id) ON DELETE CASCADE,
 CHECK((outcome='answered')=(observation_id IS NOT NULL)), CHECK(client_observed_at IS NULL OR isfinite(client_observed_at)),
 UNIQUE(invitation_id,outcome)
);
CREATE UNIQUE INDEX v2_prompt_event_terminal ON public.v2_prompt_events(invitation_id) WHERE outcome IN('skip','dismiss','unknown','answered');
CREATE INDEX v2_prompt_event_expiry ON public.v2_prompt_events(received_at);
CREATE TABLE public.v2_prompt_metrics (
 policy_version text NOT NULL, registry_key text NOT NULL, outcome text NOT NULL, count bigint NOT NULL CHECK(count>=0),
 PRIMARY KEY(policy_version,registry_key,outcome)
);

CREATE FUNCTION public.v2_prompt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'v2_prompt_record_immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER v2_prompt_policy_immutable BEFORE UPDATE OR DELETE ON public.v2_prompt_policies FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_immutable();
CREATE TRIGGER v2_question_registry_immutable BEFORE UPDATE OR DELETE ON public.v2_question_registry FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_immutable();
CREATE TRIGGER v2_prompt_event_immutable BEFORE UPDATE ON public.v2_prompt_events FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_immutable();
CREATE TRIGGER v2_prompt_invitation_immutable BEFORE UPDATE ON public.v2_prompt_invitations FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_immutable();
CREATE FUNCTION public.v2_prompt_validate_task() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE definition public.v2_question_registry; subject public.v2_subjects;
BEGIN
 SELECT * INTO definition FROM public.v2_question_registry WHERE key=NEW.registry_key AND version=NEW.registry_version;
 SELECT * INTO subject FROM public.v2_subjects WHERE id=NEW.subject_id;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','updated_at'])
    OR (OLD.state IN('obsolete','satisfied') AND NEW.state<>OLD.state) THEN RAISE EXCEPTION 'v2_task_replace_not_retarget' USING ERRCODE='23514'; END IF;
 ELSE
  IF subject.lifecycle<>'active' OR subject.input_generation IS DISTINCT FROM NEW.input_generation THEN RAISE EXCEPTION 'v2_task_stale_generation' USING ERRCODE='40001'; END IF;
 END IF;
 IF definition.key IS NULL OR NOT subject.kind=ANY(definition.target_kinds) OR NOT public.v2_observation_kind_valid(NEW.field_key,subject.kind)
   OR NOT ('*'=ANY(definition.field_keys) OR NEW.field_key=ANY(definition.field_keys)) OR NEW.priority<>definition.priority
   OR NEW.reason<>(CASE NEW.registry_key WHEN 'confirm_current_fact' THEN 'stale' WHEN 'resolve_conflict_context' THEN 'disputed' ELSE 'missing' END) THEN
  RAISE EXCEPTION 'v2_task_registry_mismatch' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=statement_timestamp(); RETURN NEW;
END; $$;
CREATE TRIGGER v2_question_task_validate BEFORE INSERT OR UPDATE ON public.v2_question_tasks FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_validate_task();
CREATE FUNCTION public.v2_prompt_put_task(subject uuid,field text,scope jsonb,question text,generation bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid; definition public.v2_question_registry; key text:=public.v2_assessment_hash(scope);
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO definition FROM public.v2_question_registry WHERE v2_question_registry.key=question AND version='prompts/1';
 IF NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=subject AND input_generation=generation AND lifecycle='active') THEN RAISE EXCEPTION 'v2_task_stale_generation' USING ERRCODE='40001'; END IF;
 UPDATE public.v2_question_tasks SET state='obsolete' WHERE subject_id=subject AND field_key=field AND scope_key=key AND registry_key=question AND state IN('open','paused') AND input_generation<>generation;
 SELECT id INTO result FROM public.v2_question_tasks WHERE subject_id=subject AND field_key=field AND scope_key=key AND registry_key=question AND state IN('open','paused');
 IF FOUND THEN RETURN result; END IF;
 INSERT INTO public.v2_question_tasks(subject_id,field_key,scope_key,scope,registry_key,registry_version,reason,input_generation,priority)
 VALUES(subject,field,key,scope,question,'prompts/1',CASE question WHEN 'confirm_current_fact' THEN 'stale' WHEN 'resolve_conflict_context' THEN 'disputed' ELSE 'missing' END,generation,definition.priority) RETURNING id INTO result;
 RETURN result;
END; $$;
-- Conservative transport identity binding, excluding assessments and generations.
-- Parent identity is recursive; an answer alone does not alter this fingerprint.
CREATE FUNCTION public.v2_prompt_identity(subject uuid) RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb; data jsonb; parent uuid; identity jsonb;
BEGIN
 snapshot:=public.v2_transport_snapshot(subject); data:=snapshot->'data';
 CASE snapshot->>'kind'
 WHEN 'lead' THEN identity:=jsonb_build_array(data->'corridor_id',data->'operator_subject_id',data->'operator_name',data->'reported_departure_seconds'); parent:=(data->>'operator_subject_id')::uuid;
 WHEN 'route' THEN identity:=data; parent:=(data->>'operator_subject_id')::uuid;
 WHEN 'pattern' THEN identity:=data; parent:=(data->>'route_subject_id')::uuid;
 WHEN 'service_plan' THEN identity:=data; parent:=(data->>'pattern_subject_id')::uuid;
 WHEN 'run' THEN identity:=data; parent:=(data->>'service_plan_subject_id')::uuid;
 WHEN 'actual_journey' THEN identity:=data; parent:=COALESCE((data->>'matched_run_subject_id')::uuid,(data->>'intended_subject_id')::uuid);
 ELSE identity:=data;
 END CASE;
 RETURN public.v2_assessment_hash(jsonb_build_array(subject,snapshot->'kind',identity,CASE WHEN parent IS NOT NULL THEN public.v2_prompt_identity(parent) END));
END; $$;
CREATE FUNCTION public.v2_prompt_context_valid(contexts text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT contexts IS NOT NULL AND cardinality(contexts)<=12 AND NOT EXISTS(SELECT 1 FROM unnest(contexts) x WHERE x IS NULL OR x NOT IN
 ('knows_route','saw_bus','knows_schedule','travelled','paid','saw_timetable','at_stop','observed_sign','operator_statement','knows_stops','relevant_conflict','new_experience'))
 AND cardinality(contexts)=(SELECT count(DISTINCT x) FROM unnest(contexts) x);
$$;
CREATE FUNCTION public.v2_prompt_eligible(task uuid,actor varchar,contexts text[]) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE t public.v2_question_tasks; r public.v2_question_registry; kind text; a jsonb; p text; found_fact boolean;
BEGIN
 IF NOT public.v2_prompt_context_valid(contexts) THEN RETURN false; END IF;
 SELECT q.* INTO t FROM public.v2_question_tasks q JOIN public.v2_subjects s ON s.id=q.subject_id
 WHERE q.id=task AND q.state='open' AND s.lifecycle='active' AND q.input_generation=s.input_generation;
 IF NOT FOUND THEN RETURN false; END IF;
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
CREATE FUNCTION public.v2_prompt_account(actor varchar) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor) THEN
  RAISE EXCEPTION 'v2_prompt_account_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 INSERT INTO public.v2_prompt_preferences(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
END; $$;
CREATE FUNCTION public.v2_prompt_set_preferences(actor varchar,expected bigint,enabled boolean,disabled text[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result bigint;
BEGIN
 PERFORM public.v2_prompt_account(actor);
 IF enabled IS NULL OR disabled IS NULL OR EXISTS(SELECT 1 FROM unnest(disabled) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_question_registry r WHERE r.key=x AND version='prompts/1')) THEN
  RAISE EXCEPTION 'v2_prompt_preferences_invalid' USING ERRCODE='23514'; END IF;
 UPDATE public.v2_prompt_preferences SET invitations_enabled=enabled,disabled_types=ARRAY(SELECT DISTINCT x FROM unnest(disabled) x ORDER BY x),revision=revision+1 WHERE user_id=actor AND revision=expected RETURNING revision INTO result;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_prompt_preferences_stale' USING ERRCODE='40001'; END IF; RETURN result;
END; $$;
CREATE FUNCTION public.v2_prompt_touch(actor varchar) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE now_time timestamptz; result uuid; minutes integer;
BEGIN
 PERFORM public.v2_prompt_account(actor); now_time:=clock_timestamp(); SELECT session_minutes INTO minutes FROM public.v2_prompt_policies WHERE version='prompts/1';
 INSERT INTO public.v2_prompt_sessions(user_id,last_active_at) VALUES(actor,now_time) ON CONFLICT(user_id) DO UPDATE
 SET session_id=CASE WHEN v2_prompt_sessions.last_active_at<=now_time-make_interval(mins=>minutes) THEN gen_random_uuid() ELSE v2_prompt_sessions.session_id END,
 invite_reserved=CASE WHEN v2_prompt_sessions.last_active_at<=now_time-make_interval(mins=>minutes) THEN false ELSE v2_prompt_sessions.invite_reserved END,last_active_at=now_time RETURNING session_id INTO result;
 RETURN result;
END; $$;
CREATE FUNCTION public.v2_prompt_reserve(actor varchar,request uuid,declared text[],surface text,manual_task uuid DEFAULT NULL,requested_subject uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.v2_prompt_policies; pref public.v2_prompt_preferences; session public.v2_prompt_sessions; prior public.v2_prompt_requests;
 chosen public.v2_question_tasks; now_time timestamptz; digest text; blocked boolean;
BEGIN
 PERFORM public.v2_prompt_account(actor); now_time:=clock_timestamp();
 IF request IS NULL OR requested_subject IS NULL OR surface IS NULL OR surface NOT IN('search_result','route_detail','own_contribution','contribute_tab') OR NOT public.v2_prompt_context_valid(declared) THEN RAISE EXCEPTION 'v2_prompt_request_invalid' USING ERRCODE='23514'; END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,ARRAY(SELECT x FROM unnest(declared) x ORDER BY x),surface,manual_task,requested_subject));
 SELECT * INTO prior FROM public.v2_prompt_requests WHERE id=request;
 IF FOUND THEN
  IF prior.user_id<>actor OR prior.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_prompt_request_conflict' USING ERRCODE='23514'; END IF;
  RETURN (SELECT i.id FROM public.v2_prompt_invitations i WHERE i.id=request);
 END IF;
 SELECT * INTO policy FROM public.v2_prompt_policies WHERE version='prompts/1';
 PERFORM public.v2_prompt_touch(actor); SELECT * INTO session FROM public.v2_prompt_sessions WHERE user_id=actor;
 SELECT * INTO pref FROM public.v2_prompt_preferences WHERE user_id=actor;
 blocked:=manual_task IS NULL AND (NOT pref.invitations_enabled OR pref.dismissed_until>now_time OR session.invite_reserved
    OR (SELECT count(*) FROM public.v2_prompt_requests WHERE user_id=actor AND consumed AND created_at>now_time-interval '24 hours')>=policy.daily_cap);
 IF NOT COALESCE(blocked,false) THEN
  SELECT t.* INTO chosen FROM public.v2_question_tasks t JOIN public.v2_question_registry r ON r.key=t.registry_key AND r.version=t.registry_version
  WHERE t.registry_version='prompts/1' AND t.subject_id=requested_subject AND (manual_task IS NULL OR t.id=manual_task) AND public.v2_prompt_eligible(t.id,actor,declared)
   AND (manual_task IS NOT NULL OR (surface=ANY(r.surfaces) AND NOT t.registry_key=ANY(pref.disabled_types)
     AND ( 'new_experience'=ANY(declared) OR NOT EXISTS(SELECT 1 FROM public.v2_prompt_suppressions s WHERE s.user_id=actor AND s.subject_id=t.subject_id AND s.field_key=t.field_key AND s.scope_key=t.scope_key AND s.until_time>now_time))))
  ORDER BY t.priority,t.created_at,t.id LIMIT 1;
 END IF;
 INSERT INTO public.v2_prompt_requests(id,user_id,request_digest,session_id,consumed,created_at) VALUES(request,actor,digest,session.session_id,chosen.id IS NOT NULL AND manual_task IS NULL,now_time);
 IF chosen.id IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.v2_prompt_invitations(id,user_id,task_id,policy_version,mode,reserved_at,expires_at,target_revision,identity_hash,declared_context,surface)
 VALUES(request,actor,chosen.id,'prompts/1',CASE WHEN manual_task IS NULL THEN 'unsolicited' ELSE 'manual' END,now_time,now_time+make_interval(mins=>policy.unopened_minutes),
  (SELECT revision FROM public.v2_subjects WHERE id=chosen.subject_id),public.v2_prompt_identity(chosen.subject_id),declared,surface);
 IF manual_task IS NULL THEN UPDATE public.v2_prompt_sessions SET invite_reserved=true WHERE user_id=actor; END IF;
 RETURN request;
END; $$;
-- Feedback and answers deliberately use separate functions. Clients cannot post
-- 'answered'; it requires an owned typed observation and its saved receipt.
CREATE FUNCTION public.v2_prompt_event(actor varchar,invitation uuid,event uuid,feedback text,device_timezone text,client_time timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.v2_prompt_invitations; t public.v2_question_tasks; prior public.v2_prompt_events; digest text; now_time timestamptz; until_time timestamptz; policy public.v2_prompt_policies;
BEGIN
 PERFORM public.v2_prompt_account(actor); now_time:=clock_timestamp();
 IF event IS NULL OR feedback IS NULL OR feedback NOT IN('shown','opened','skip','dismiss','unknown') OR NOT EXISTS(SELECT 1 FROM public.v2_timezones WHERE name=device_timezone)
  OR (client_time IS NOT NULL AND (NOT isfinite(client_time) OR client_time>now_time+interval '1 day')) THEN RAISE EXCEPTION 'v2_prompt_event_invalid' USING ERRCODE='23514'; END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,invitation,feedback,device_timezone,extract(epoch FROM client_time)));
 SELECT * INTO prior FROM public.v2_prompt_events WHERE id=event;
 IF FOUND THEN IF prior.user_id<>actor OR prior.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_prompt_event_conflict' USING ERRCODE='23514'; END IF; RETURN prior.id; END IF;
 SELECT * INTO i FROM public.v2_prompt_invitations WHERE id=invitation AND user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_prompt_invitation_unavailable' USING ERRCODE='42501'; END IF;
 IF now_time>=i.expires_at AND NOT EXISTS(SELECT 1 FROM public.v2_prompt_events e WHERE e.invitation_id=i.id AND e.outcome='opened') THEN RAISE EXCEPTION 'v2_prompt_invitation_expired' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_prompt_events e WHERE e.invitation_id=i.id AND (e.outcome IN('skip','dismiss','unknown','answered') OR e.outcome=feedback)) THEN RAISE EXCEPTION 'v2_prompt_event_already_recorded' USING ERRCODE='23514'; END IF;
 IF feedback IN('shown','opened') AND public.v2_prompt_read(actor,invitation)->>'status' NOT IN('offered','opened') THEN RAISE EXCEPTION 'v2_prompt_no_longer_offered' USING ERRCODE='23514'; END IF;
 SELECT * INTO t FROM public.v2_question_tasks WHERE id=i.task_id; SELECT * INTO policy FROM public.v2_prompt_policies WHERE version=i.policy_version;
 INSERT INTO public.v2_prompt_events(id,invitation_id,user_id,outcome,received_at,client_observed_at,request_digest) VALUES(event,i.id,actor,feedback,now_time,client_time,digest);
 IF feedback IN('skip','dismiss') THEN
  until_time:=greatest(now_time+make_interval(hours=>policy.cooldown_hours),((now_time AT TIME ZONE device_timezone)::date+1)::timestamp AT TIME ZONE device_timezone);
  UPDATE public.v2_prompt_preferences SET dismissed_until=greatest(dismissed_until,until_time),revision=revision+1 WHERE user_id=actor;
 ELSIF feedback='unknown' THEN
  INSERT INTO public.v2_prompt_suppressions(user_id,subject_id,field_key,scope_key,until_time,reason) VALUES(actor,t.subject_id,t.field_key,t.scope_key,now_time+make_interval(days=>policy.unknown_days),'unknown')
  ON CONFLICT(user_id,subject_id,field_key,scope_key) DO UPDATE SET until_time=greatest(v2_prompt_suppressions.until_time,EXCLUDED.until_time);
 END IF;
 UPDATE public.v2_prompt_sessions SET last_active_at=now_time WHERE user_id=actor;
 RETURN event;
END; $$;
CREATE FUNCTION public.v2_prompt_answer(actor varchar,invitation uuid,event uuid,observation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.v2_prompt_invitations; t public.v2_question_tasks; prior public.v2_prompt_events; digest text;
BEGIN
 PERFORM public.v2_prompt_account(actor);
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,invitation,observation));
 SELECT * INTO prior FROM public.v2_prompt_events WHERE id=event;
 IF FOUND THEN IF prior.user_id<>actor OR prior.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_prompt_event_conflict' USING ERRCODE='23514'; END IF; RETURN prior.id; END IF;
 SELECT * INTO i FROM public.v2_prompt_invitations WHERE id=invitation AND user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_prompt_invitation_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.v2_question_tasks WHERE id=i.task_id;
 IF i.identity_hash IS DISTINCT FROM public.v2_prompt_identity(t.subject_id) OR NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=t.subject_id AND lifecycle='active') THEN RAISE EXCEPTION 'v2_prompt_identity_reconfirmation_required' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_observations o JOIN public.v2_contributions c ON c.id=o.contribution_id JOIN public.v2_receipts r ON r.contribution_id=c.id AND r.user_id=c.user_id
    JOIN public.v2_observation_states st ON st.observation_id=o.id
    WHERE o.id=observation AND c.user_id=actor AND o.field_key=t.field_key AND o.scope_key=t.scope_key AND public.v2_observation_subject(o.id)=t.subject_id AND st.status='active' AND c.submitted_at>=least(i.reserved_at,transaction_timestamp()) AND r.created_at>=least(i.reserved_at,transaction_timestamp())) THEN
  RAISE EXCEPTION 'v2_prompt_answer_requires_saved_matching_observation' USING ERRCODE='23514'; END IF;
 INSERT INTO public.v2_prompt_events(id,invitation_id,user_id,outcome,received_at,request_digest,observation_id) VALUES(event,i.id,actor,'answered',clock_timestamp(),digest,observation);
 UPDATE public.v2_prompt_sessions SET last_active_at=clock_timestamp() WHERE user_id=actor; RETURN event;
END; $$;
CREATE FUNCTION public.v2_prompt_read(actor varchar,invitation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE i public.v2_prompt_invitations; t public.v2_question_tasks; p public.v2_prompt_preferences; terminal text; opened boolean;
BEGIN
 SELECT * INTO i FROM public.v2_prompt_invitations WHERE id=invitation AND user_id=actor;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
 SELECT * INTO t FROM public.v2_question_tasks WHERE id=i.task_id;
 SELECT e.outcome INTO terminal FROM public.v2_prompt_events e WHERE e.invitation_id=i.id AND e.outcome IN('answered','skip','dismiss','unknown');
 IF FOUND THEN RETURN jsonb_build_object('status',terminal); END IF;
 opened:=EXISTS(SELECT 1 FROM public.v2_prompt_events e WHERE e.invitation_id=i.id AND e.outcome='opened');
 IF NOT opened AND statement_timestamp()>=i.expires_at THEN RETURN jsonb_build_object('status','expired'); END IF;
 IF i.identity_hash IS DISTINCT FROM public.v2_prompt_identity(t.subject_id) THEN RETURN jsonb_build_object('status','reconfirm_identity'); END IF;
 IF NOT opened AND NOT public.v2_prompt_eligible(t.id,actor,i.declared_context) THEN RETURN jsonb_build_object('status','obsolete'); END IF;
 SELECT * INTO p FROM public.v2_prompt_preferences WHERE user_id=actor;
 IF i.mode='unsolicited' AND (NOT p.invitations_enabled OR p.dismissed_until>statement_timestamp() OR t.registry_key=ANY(p.disabled_types) OR
  (NOT 'new_experience'=ANY(i.declared_context) AND EXISTS(SELECT 1 FROM public.v2_prompt_suppressions WHERE user_id=actor AND subject_id=t.subject_id AND field_key=t.field_key AND scope_key=t.scope_key AND until_time>statement_timestamp()))) THEN RETURN jsonb_build_object('status','suppressed'); END IF;
 RETURN jsonb_build_object('status',CASE WHEN opened THEN 'opened' ELSE 'offered' END,'invitationId',i.id,'taskId',t.id,'subjectId',t.subject_id,'fieldKey',t.field_key,'registryKey',t.registry_key,'registryVersion',t.registry_version,'expiresAt',i.expires_at,'targetRevision',i.target_revision);
END; $$;
CREATE FUNCTION public.v2_prompt_obsolete_tasks() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.input_generation<>OLD.input_generation OR NEW.lifecycle<>OLD.lifecycle THEN UPDATE public.v2_question_tasks SET state='obsolete' WHERE subject_id=NEW.id AND state IN('open','paused'); END IF; RETURN NEW;
END; $$;
CREATE TRIGGER v2_prompt_subject_change AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_obsolete_tasks();
-- Content erasure cannot refund the rolling/session nuisance budget.
CREATE FUNCTION public.v2_prompt_forget_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN UPDATE public.v2_prompt_requests SET request_digest=NULL WHERE id=OLD.id; RETURN OLD; END; $$;
CREATE TRIGGER v2_prompt_forget_invitation BEFORE DELETE ON public.v2_prompt_invitations FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_forget_invitation();
CREATE FUNCTION public.v2_prompt_erase_observation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_subject uuid;
BEGIN
 current_subject:=public.v2_observation_subject(OLD.id);
 DELETE FROM public.v2_prompt_suppressions WHERE subject_id IN(OLD.original_subject_id,current_subject);
 DELETE FROM public.v2_question_tasks WHERE subject_id IN(OLD.original_subject_id,current_subject);
 RETURN OLD;
END; $$;
CREATE TRIGGER aa_v2_prompt_observation_erasure BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_prompt_erase_observation();
CREATE FUNCTION public.v2_prompt_prune() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE removed bigint; cutoff timestamptz;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 cutoff:=clock_timestamp()-make_interval(days=>(SELECT retention_days FROM public.v2_prompt_policies WHERE version='prompts/1'));
 -- No dates, accounts, subjects, scopes, event IDs or small-group identifiers.
 INSERT INTO public.v2_prompt_metrics(policy_version,registry_key,outcome,count)
 SELECT i.policy_version,t.registry_key,e.outcome,count(*) FROM public.v2_prompt_events e JOIN public.v2_prompt_invitations i ON i.id=e.invitation_id JOIN public.v2_question_tasks t ON t.id=i.task_id
 WHERE i.reserved_at<cutoff GROUP BY i.policy_version,t.registry_key,e.outcome
 ON CONFLICT(policy_version,registry_key,outcome) DO UPDATE SET count=v2_prompt_metrics.count+EXCLUDED.count;
 DELETE FROM public.v2_prompt_requests WHERE created_at<cutoff; GET DIAGNOSTICS removed=ROW_COUNT;
 DELETE FROM public.v2_prompt_suppressions WHERE until_time<=clock_timestamp();
 DELETE FROM public.v2_prompt_sessions WHERE last_active_at<cutoff;
 RETURN removed;
END; $$;
DO $$ DECLARE t text; r text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_prompt_policies','v2_question_registry','v2_question_tasks','v2_prompt_preferences','v2_prompt_suppressions','v2_prompt_sessions','v2_prompt_requests','v2_prompt_invitations','v2_prompt_events','v2_prompt_metrics'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF; END LOOP;
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_prompt_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'v2_prompt_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r); END IF; END LOOP;
 END LOOP;
END; $$;
