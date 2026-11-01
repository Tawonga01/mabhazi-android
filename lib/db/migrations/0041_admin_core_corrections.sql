-- Attributed corrections to community reports. Original intake/observations stay
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
