-- Private timetable assembly foundation; no public/backend grants or publication.
-- Accept a legitimate reviewed calendar edit as the current plan while
-- retaining its exact initial creation proof and unchanged structural identity.
-- This is not publication, a stale-origin override or a general edit bypass.
CREATE FUNCTION public.v2_current_reviewed_creation(subject uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE original jsonb;current_edit jsonb;o public.v2_transport_creation_origins;p public.v2_transport_creations;s public.v2_subjects;
BEGIN
 SELECT * INTO s FROM public.v2_subjects WHERE id=subject;
 IF s.id IS NULL OR s.lifecycle<>'active' THEN RETURN false;END IF;
 original:=public.v2_read_created_subject(subject);
 IF original->>'status'='reviewed_origin' THEN RETURN true;END IF;
 IF s.kind<>'service_plan' THEN RETURN false;END IF;
 current_edit:=public.v2_read_transport(subject);
 IF current_edit->>'status' IS DISTINCT FROM 'reviewed' OR current_edit->>'fieldKey'<>'service.calendar'
  THEN RETURN false;END IF;
 SELECT * INTO o FROM public.v2_transport_creation_origins WHERE subject_id=subject;
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=o.creation_id;
 IF o.creation_id IS NULL OR o.erased OR p.erased OR NOT public.v2_creation_evidence_live(p.id)
  OR NOT public.v2_creation_dependencies_live(p.id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_transport_edit_heads h
   JOIN public.v2_transport_edits e ON e.id=h.edit_id AND e.subject_id=subject AND e.field_key='service.calendar' AND NOT e.erased
   JOIN public.v2_transport_edit_events applied ON applied.id=h.event_id AND applied.action='apply'
   JOIN public.v2_transport_edit_events approved ON approved.edit_id=e.id AND approved.action='review' AND approved.review_id=applied.review_id
   JOIN public.v2_transport_change_subjects changed ON changed.subject_id=subject AND changed.is_root
    AND changed.previous_revision=approved.resulting_revision AND changed.resulting_revision=applied.resulting_revision
    AND changed.previous_generation=approved.resulting_generation AND changed.resulting_generation=applied.resulting_generation
   JOIN public.v2_transport_changes cause ON cause.id=changed.change_id AND cause.source_table='v2_service_plans'
    AND cause.operation='UPDATE' AND cause.changed_columns<@ARRAY['calendar_id','timezone']::text[]
   JOIN public.v2_transport_creation_events invalidation ON invalidation.creation_id=p.id AND invalidation.action='invalidate' AND invalidation.cause_id=cause.id
   WHERE h.subject_id=subject AND (e.before_snapshot-'calendar')=o.snapshot)
  OR NOT EXISTS(SELECT 1 FROM public.v2_review_decisions d JOIN public.v2_review_cases c ON c.id=d.case_id
   WHERE d.id=o.review_id AND d.action='accept' AND NOT d.evidence_erased AND c.last_decision_id=d.id AND c.state='resolved')
  THEN RETURN false;END IF;
 -- Only the calendar and timezone may differ. An operator, pattern, mode or
 -- applicability change needs its own identity writer; it cannot inherit this.
 IF (o.snapshot->'data')-ARRAY['calendar_id','timezone'] IS DISTINCT FROM
  (current_edit->'snapshot'->'data')-ARRAY['calendar_id','timezone'] THEN RETURN false;END IF;
 RETURN COALESCE(current_edit->'snapshot'->'calendar'->>'id'=current_edit->'snapshot'->'data'->>'calendar_id'
  AND current_edit->'snapshot'->'calendar'->>'timezone'=current_edit->'snapshot'->'data'->>'timezone',false);
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_dependencies_live(creation uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p public.v2_transport_creations;needed integer;actual integer;d record;
BEGIN
 SELECT * INTO p FROM public.v2_transport_creations WHERE id=creation;
 IF NOT FOUND OR p.erased THEN RETURN false;END IF;
 SELECT count(*) INTO needed FROM public.v2_creation_references(p.desired_snapshot);
 SELECT count(*) INTO actual FROM public.v2_transport_creation_dependencies WHERE creation_id=p.id;
 IF needed<>actual THEN RETURN false;END IF;
 FOR d IN SELECT dep.*,s.revision live_revision,s.input_generation live_generation,s.lifecycle,o.creation_id live_origin,o.event_id live_event
 FROM public.v2_transport_creation_dependencies dep JOIN public.v2_subjects s ON s.id=dep.subject_id AND s.kind=dep.subject_kind
 JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE dep.creation_id=p.id LOOP
  IF d.subject_revision<>d.live_revision OR d.input_generation<>d.live_generation OR d.lifecycle<>'active'
   OR d.origin_creation_id<>d.live_origin OR d.origin_event_id<>d.live_event
   OR NOT EXISTS(SELECT 1 FROM public.v2_creation_references(p.desired_snapshot) ref WHERE ref.subject_id=d.subject_id AND ref.subject_kind=d.subject_kind)
   OR NOT public.v2_current_reviewed_creation(d.subject_id) THEN RETURN false;END IF;
 END LOOP;
 RETURN actual=(SELECT count(*) FROM public.v2_transport_creation_dependencies dep JOIN public.v2_subjects s ON s.id=dep.subject_id AND s.kind=dep.subject_kind JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE dep.creation_id=p.id);
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_dependency_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_transport_creations p
  CROSS JOIN LATERAL public.v2_creation_references(p.desired_snapshot) ref JOIN public.v2_subjects s ON s.id=ref.subject_id AND s.kind=ref.subject_kind
  JOIN public.v2_transport_creation_origins o ON o.subject_id=s.id WHERE p.id=NEW.creation_id AND ref.subject_id=NEW.subject_id AND ref.subject_kind=NEW.subject_kind
  AND s.revision=NEW.subject_revision AND s.input_generation=NEW.input_generation AND o.creation_id=NEW.origin_creation_id AND o.event_id=NEW.origin_event_id
  AND public.v2_current_reviewed_creation(s.id)) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_creation_dependency_immutable_or_invalid' USING ERRCODE='23514';
END;$$;

CREATE OR REPLACE FUNCTION public.v2_creation_desired_parent(observation uuid,kind text,target uuid,parent uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE o public.v2_observations;data jsonb;source_operator uuid;route_operator uuid;corridor uuid;stops jsonb;version jsonb;origin_city integer;destination_city integer;pat public.v2_patterns;pv public.v2_pattern_versions;plan public.v2_service_plans;lower_date date;upper_date date;service_date date;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=observation;
 IF NOT FOUND OR target IS NULL THEN RAISE EXCEPTION 'v2_creation_observation_missing' USING ERRCODE='23503';END IF;
 IF kind='operator' AND o.field_key='operator.reported' AND o.value ? 'name' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','operator','display_name',o.value->'name','country_code',NULL,'affiliation_status','unverified');
 ELSIF kind='stop' AND o.field_key IN('boarding.pickup','alighting.dropoff') AND o.value ?& ARRAY['cityId','name'] AND NOT o.value ? 'stopId' THEN
 data:=jsonb_build_object('subject_id',target,'subject_kind','stop','city_id',o.value->'cityId','name',o.value->'name','parent_stop_id',NULL,'latitude',NULL,'longitude',NULL,'precision','named_place');
 ELSIF kind='route' AND o.field_key IN('operator.reported','operator.identity') AND o.value ? 'id' THEN
  IF public.v2_read_created_subject((o.value->>'id')::uuid)->>'status' IS DISTINCT FROM 'reviewed_origin' THEN RAISE EXCEPTION 'v2_creation_reviewed_operator_required' USING ERRCODE='23514';END IF;
  source_operator:=COALESCE(public.v2_resolved_operator(o.original_subject_id),(SELECT public.v2_resolved_operator(a.matched_run_subject_id) FROM public.v2_actual_journeys a WHERE a.subject_id=o.original_subject_id AND a.association_status='matched'));
  IF source_operator IS NOT NULL AND source_operator<>(o.value->>'id')::uuid THEN RAISE EXCEPTION 'v2_creation_source_operator_conflict' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','route','operator_subject_id',(o.value->>'id')::uuid,'public_name',NULL,'public_code',NULL);
 ELSIF kind='pattern' AND o.field_key='pattern.stops' AND parent IS NOT NULL THEN
  IF public.v2_read_created_subject(parent)->>'status' IS DISTINCT FROM 'reviewed_origin' OR NOT EXISTS(SELECT 1 FROM public.v2_routes WHERE subject_id=parent) THEN RAISE EXCEPTION 'v2_creation_reviewed_route_required' USING ERRCODE='23514';END IF;
  SELECT operator_subject_id INTO route_operator FROM public.v2_routes WHERE subject_id=parent;
  source_operator:=public.v2_resolved_operator(o.original_subject_id);corridor:=public.v2_subject_corridor(o.original_subject_id);
  IF corridor IS NULL OR (source_operator IS NOT NULL AND source_operator<>route_operator)
   OR (source_operator IS NULL AND NOT EXISTS(SELECT 1 FROM public.v2_transport_creations p JOIN public.v2_transport_creation_origins r ON r.creation_id=p.id WHERE r.subject_id=parent AND p.source_subject_id=o.original_subject_id)) THEN RAISE EXCEPTION 'v2_creation_pattern_identity_context_required' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(o.value->'stops') e WHERE e->'place'->>'stopId' IS NULL OR public.v2_read_created_subject((e->'place'->>'stopId')::uuid)->>'status' IS DISTINCT FROM 'reviewed_origin'
   OR NOT EXISTS(SELECT 1 FROM public.v2_stops WHERE subject_id=(e->'place'->>'stopId')::uuid)) THEN RAISE EXCEPTION 'v2_creation_reviewed_stops_required' USING ERRCODE='23514';END IF;
  SELECT jsonb_agg(jsonb_build_object('pattern_subject_id',target,'pattern_version',1,'sequence',ordinality-1,'stop_subject_id',(e->'place'->>'stopId')::uuid,'pickup',e->'pickup','dropoff',e->'dropoff') ORDER BY ordinality)
   INTO stops FROM jsonb_array_elements(o.value->'stops') WITH ORDINALITY a(e,ordinality);
  SELECT origin_city_id,destination_city_id INTO origin_city,destination_city FROM public.v2_corridors WHERE id=corridor;
  IF (o.value->>'stopsComplete')::boolean AND ((SELECT city_id FROM public.v2_stops WHERE subject_id=(stops->0->>'stop_subject_id')::uuid) IS DISTINCT FROM origin_city
   OR (SELECT city_id FROM public.v2_stops WHERE subject_id=(stops->(jsonb_array_length(stops)-1)->>'stop_subject_id')::uuid) IS DISTINCT FROM destination_city) THEN RAISE EXCEPTION 'v2_creation_complete_pattern_endpoints_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','pattern','route_subject_id',parent,'corridor_id',corridor,'current_pattern_version',1,'current_version_sealed',true);
  version:=jsonb_build_object('pattern_subject_id',target,'version',1,'effective_from',o.effective_from,'effective_to',o.effective_to,'stops_complete',o.value->'stopsComplete','sealed',true);
  RETURN jsonb_build_object('kind','pattern','data',data,'patternVersion',version,'patternStops',stops);
 ELSIF kind='service_plan' AND o.field_key='service.mode' AND parent IS NOT NULL THEN
  PERFORM public.v2_creation_pattern_context(o.original_subject_id,parent);
  SELECT * INTO pat FROM public.v2_patterns WHERE subject_id=parent;
  SELECT v.* INTO pv FROM public.v2_pattern_versions v WHERE v.pattern_subject_id=parent AND v.version=pat.current_pattern_version AND v.sealed;
  IF pv.pattern_subject_id IS NULL THEN RAISE EXCEPTION 'v2_creation_sealed_pattern_required' USING ERRCODE='23514';END IF;
  lower_date:=o.effective_from;upper_date:=o.effective_to;
  IF lower_date>upper_date OR lower_date<pv.effective_from OR upper_date>pv.effective_to OR upper_date<pv.effective_from OR lower_date>pv.effective_to THEN RAISE EXCEPTION 'v2_creation_service_validity_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','service_plan','pattern_subject_id',parent,'pattern_version',pat.current_pattern_version,'pattern_sealed',true,'mode',o.value->'mode','calendar_id',NULL,'timezone',NULL,'effective_from',lower_date,'effective_to',upper_date,'boarding_instructions',NULL);
 ELSIF kind='run' AND o.field_key='departure.scheduled' AND parent IS NOT NULL THEN
  SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=parent;
  IF plan.subject_id IS NULL OR plan.mode<>'fixed_time' OR NOT public.v2_current_reviewed_creation(parent) THEN RAISE EXCEPTION 'v2_creation_reviewed_fixed_plan_required' USING ERRCODE='23514';END IF;
  PERFORM public.v2_creation_pattern_context(o.original_subject_id,plan.pattern_subject_id);
  IF EXISTS(SELECT 1 FROM public.v2_runs r WHERE r.subject_id=o.original_subject_id AND r.service_plan_subject_id<>parent) THEN RAISE EXCEPTION 'v2_creation_run_plan_context_mismatch' USING ERRCODE='23514';END IF;
  IF (o.scope->>'timezone' IS NOT NULL AND o.scope->>'timezone' IS DISTINCT FROM plan.timezone)
   OR (o.scope->>'calendarId' IS NOT NULL AND (o.scope->>'calendarId')::uuid IS DISTINCT FROM plan.calendar_id) THEN RAISE EXCEPTION 'v2_creation_run_temporal_context_mismatch' USING ERRCODE='23514';END IF;
  SELECT v.* INTO pv FROM public.v2_pattern_versions v WHERE v.pattern_subject_id=plan.pattern_subject_id AND v.version=plan.pattern_version AND v.sealed;
  IF pv.pattern_subject_id IS NULL THEN RAISE EXCEPTION 'v2_creation_sealed_pattern_required' USING ERRCODE='23514';END IF;
  lower_date:=greatest(o.effective_from,(o.scope->>'effectiveFrom')::date);
  upper_date:=least(o.effective_to,(o.scope->>'effectiveTo')::date);service_date:=(o.scope->>'serviceDate')::date;
  IF lower_date>upper_date OR service_date<lower_date OR service_date>upper_date THEN RAISE EXCEPTION 'v2_creation_service_validity_disjoint' USING ERRCODE='23514';END IF;
  IF service_date IS NOT NULL THEN lower_date:=service_date;upper_date:=service_date;END IF;
  IF (greatest(plan.effective_from,pv.effective_from) IS NOT NULL AND (lower_date IS NULL OR lower_date<greatest(plan.effective_from,pv.effective_from)))
   OR (least(plan.effective_to,pv.effective_to) IS NOT NULL AND (upper_date IS NULL OR upper_date>least(plan.effective_to,pv.effective_to))) THEN RAISE EXCEPTION 'v2_creation_run_parent_validity_mismatch' USING ERRCODE='23514';END IF;
  data:=jsonb_build_object('subject_id',target,'subject_kind','run','service_plan_subject_id',parent,'plan_mode','fixed_time','pattern_subject_id',plan.pattern_subject_id,'pattern_version',plan.pattern_version,'departure_seconds',o.value->'seconds','arrival_seconds',NULL,'run_label',NULL,'validity_from',lower_date,'validity_to',upper_date);
  RETURN jsonb_build_object('kind','run','data',data,'runStopTimes','[]'::jsonb);
 ELSE RAISE EXCEPTION 'v2_creation_kind_or_named_evidence_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('kind',kind,'data',data);
END;$$;

DO $$ DECLARE r text;BEGIN
 REVOKE ALL ON FUNCTION public.v2_current_reviewed_creation(uuid) FROM PUBLIC,mabhazi_api;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_current_reviewed_creation(uuid) FROM %I',r);END IF;
 END LOOP;
END;$$;


-- Draft component for the atomic timetable facade. Not a standalone migration;
-- no public/backend EXECUTE permission. Caller already holds named admin/account
-- and transport locks. Source records never enter traveller-facing lead lists.
ALTER TABLE public.v2_leads DROP CONSTRAINT v2_leads_intake_kind_check;
ALTER TABLE public.v2_leads ADD CONSTRAINT v2_leads_intake_kind_check CHECK(intake_kind IN('community','legacy','staff'));

CREATE FUNCTION public.v2_timetable_source(actor varchar,command uuid,proposal jsonb,operator_value jsonb,source uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE subject uuid:=gen_random_uuid();contribution uuid:=gen_random_uuid();corridor uuid;clock text;basis text;observed date;payload jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF command IS NULL OR source IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=source AND owner_user_id=actor)
  OR NOT public.v2_intake_observation_valid('operator.reported',operator_value,'{}')
  THEN RAISE EXCEPTION 'v2_timetable_source_invalid' USING ERRCODE='23514';END IF;
 clock:=proposal->'departures'->0->>'departure';
 IF clock IS NULL OR clock!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
  THEN RAISE EXCEPTION 'v2_timetable_source_clock_required' USING ERRCODE='23514';END IF;
 basis:=CASE proposal->'source'->>'kind' WHEN 'published_timetable' THEN 'observed_sign' WHEN 'operator_confirmation' THEN 'operator_statement' END;
 IF basis IS NULL THEN RAISE EXCEPTION 'v2_timetable_source_basis_required' USING ERRCODE='23514';END IF;
 observed:=(proposal->'source'->>'checkedOn')::date;
 INSERT INTO public.v2_corridors(origin_city_id,destination_city_id)
  VALUES((proposal->>'originCityId')::integer,(proposal->>'destinationCityId')::integer)
  ON CONFLICT(origin_city_id,destination_city_id) DO NOTHING;
 SELECT id INTO corridor FROM public.v2_corridors WHERE origin_city_id=(proposal->>'originCityId')::integer AND destination_city_id=(proposal->>'destinationCityId')::integer;
 payload:=jsonb_build_object('schemaVersion','1.0','entrySurface','reviewer_context','timetableCommandId',command,
  'target',jsonb_build_object('newLead',jsonb_build_object('originCityId',proposal->'originCityId',
   'destinationCityId',proposal->'destinationCityId','departureTime',clock,'operator',operator_value)),
  'leadContext',jsonb_build_object('knowledgeBasis',basis,'timeBasis','scheduled','observedDate',observed),
  'observations','[]'::jsonb,'proposal',proposal,'sourceId',source);
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_lead_subtype,public.v2_lead_initial_contribution DEFERRED;
 INSERT INTO public.v2_subjects(id,kind) VALUES(subject,'lead');
 INSERT INTO public.v2_leads(subject_id,intake_kind,corridor_id,reported_departure_seconds,operator_subject_id,operator_name,initial_contribution_id)
  VALUES(subject,'staff',corridor,substring(clock,1,2)::integer*3600+substring(clock,4,2)::integer*60,
   (operator_value->>'id')::uuid,operator_value->>'name',contribution);
 INSERT INTO public.v2_contributions(id,user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
  VALUES(contribution,actor,gen_random_uuid(),'1.0','reviewer_context',public.v2_assessment_hash(payload),payload,subject);
 INSERT INTO public.v2_subject_revisions(subject_id,subject_kind,revision,snapshot,origin_kind,initial_contribution_id)
  VALUES(subject,'lead',1,public.v2_transport_snapshot(subject),'contribution',contribution);
 SET CONSTRAINTS public.v2_subject_subtype,public.v2_lead_subtype,public.v2_lead_initial_contribution IMMEDIATE;
 INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from)
  SELECT contribution,subject,f,v,'{}',public.v2_assessment_hash('{}'),public.v2_assessment_hash(v),basis,observed
  FROM (VALUES('operator.reported',operator_value),('departure.reported',jsonb_build_object('time',clock,'basis','scheduled'))) core(f,v);
 INSERT INTO public.v2_observation_sources(observation_id,source_id,relation)
  SELECT id,source,'cites' FROM public.v2_observations WHERE contribution_id=contribution;
 -- These are controlled assembly records, not public submissions to normalise.
 -- Native reviewed constructors/edits enqueue their existing dependent jobs.
 RETURN jsonb_build_object('subjectId',subject,'contributionId',contribution);
END;$$;

CREATE FUNCTION public.v2_timetable_observation(actor varchar,subject uuid,command uuid,source uuid,
 field text,value jsonb,scope jsonb,proposal jsonb,contribution uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE observation uuid;payload jsonb;basis text;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=source AND owner_user_id=actor)
  OR NOT public.v2_intake_observation_valid(field,value,scope)
  THEN RAISE EXCEPTION 'v2_timetable_observation_invalid' USING ERRCODE='23514';END IF;
 basis:=CASE proposal->'source'->>'kind' WHEN 'published_timetable' THEN 'observed_sign' WHEN 'operator_confirmation' THEN 'operator_statement' END;
 IF basis IS NULL THEN RAISE EXCEPTION 'v2_timetable_source_basis_required' USING ERRCODE='23514';END IF;
 IF contribution IS NULL THEN
  payload:=jsonb_build_object('schemaVersion','1.0','entrySurface','reviewer_context','timetableCommandId',command,
   'fieldKey',field,'value',value,'scope',scope,'sourceId',source);
  INSERT INTO public.v2_contributions(user_id,client_submission_id,schema_version,entry_surface,semantic_hash,payload,original_subject_id)
   VALUES(actor,gen_random_uuid(),'1.0','reviewer_context',public.v2_assessment_hash(payload),payload,subject) RETURNING id INTO contribution;
 ELSIF NOT EXISTS(SELECT 1 FROM public.v2_contributions c WHERE c.id=contribution AND c.user_id=actor AND c.original_subject_id=subject AND c.entry_surface='reviewer_context') THEN
  RAISE EXCEPTION 'v2_timetable_contribution_context_required' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.v2_observations(contribution_id,original_subject_id,field_key,value,scope,scope_key,value_key,knowledge_basis,observed_from,effective_from,effective_to)
  VALUES(contribution,subject,field,value,scope,public.v2_assessment_hash(scope),public.v2_assessment_hash(value),basis,
   (proposal->'source'->>'checkedOn')::date,(proposal->>'validFrom')::date,(proposal->>'validUntil')::date) RETURNING id INTO observation;
 INSERT INTO public.v2_observation_sources(observation_id,source_id,relation) VALUES(observation,source,'cites');
 RETURN observation;
END;$$;

CREATE FUNCTION public.v2_timetable_create(actor varchar,source uuid,observation uuid,kind text,parent uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p uuid;review uuid;expected bigint;parent_expected bigint;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT revision INTO expected FROM public.v2_subjects WHERE id=source;
 IF parent IS NULL THEN
  p:=public.v2_propose_transport_creation(actor,source,expected,observation,kind,gen_random_uuid());
 ELSE
  SELECT revision INTO parent_expected FROM public.v2_subjects WHERE id=parent;
  p:=public.v2_propose_transport_creation_context(actor,source,expected,observation,kind,parent,parent_expected,gen_random_uuid());
 END IF;
 review:=public.v2_review_transport_creation(actor,p,1,(SELECT revision FROM public.v2_subjects WHERE id=source),
  'accept','timetable_source_checked',NULL,gen_random_uuid());
 PERFORM public.v2_apply_transport_creation(actor,p,review,gen_random_uuid());
 RETURN (SELECT target_subject_id FROM public.v2_transport_creations WHERE id=p);
END;$$;

CREATE FUNCTION public.v2_timetable_edit(actor varchar,subject uuid,observation uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE edit uuid;review uuid;
BEGIN
 PERFORM public.v2_admin_require(actor);
 edit:=public.v2_propose_transport_edit(actor,subject,(SELECT revision FROM public.v2_subjects WHERE id=subject),observation,gen_random_uuid());
 review:=public.v2_review_transport_edit(actor,edit,1,(SELECT revision FROM public.v2_subjects WHERE id=subject),'accept','timetable_source_checked',NULL,gen_random_uuid());
 PERFORM public.v2_apply_transport_edit(actor,edit,review,gen_random_uuid());
 RETURN review;
END;$$;

DO $$ DECLARE r text;f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
  ('v2_timetable_source','v2_timetable_observation','v2_timetable_create','v2_timetable_edit') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;
  END LOOP;
 END LOOP;
END;$$;
