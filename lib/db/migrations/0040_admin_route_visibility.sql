-- Named, restorable route visibility. No source evidence or lifecycle is erased.
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
  'removalId',a.removal_id,'outcome',a.outcome,'createdAt',a.created_at,'actorErased',a.actor_user_id IS NULL,
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
