-- Private timetable discovery and registered-source restorable management.
-- No new grants; source-only until full public/client adapters are installed.
ALTER TABLE public.v2_admin_timetable_entries ADD CONSTRAINT v2_timetable_unique_source UNIQUE(source_subject_id);
CREATE OR REPLACE FUNCTION public.v2_transport_dependents(roots uuid[]) RETURNS uuid[] LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH RECURSIVE edges(parent,child) AS (
  SELECT operator_subject_id,subject_id FROM public.v2_leads WHERE operator_subject_id IS NOT NULL
  UNION SELECT operator_subject_id,subject_id FROM public.v2_routes
  UNION SELECT route_subject_id,subject_id FROM public.v2_patterns
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_service_plans
  UNION SELECT service_plan_subject_id,subject_id FROM public.v2_runs
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_runs
  UNION SELECT run_subject_id,source_subject_id FROM public.v2_admin_timetable_entries
  UNION SELECT parent_stop_id,subject_id FROM public.v2_stops WHERE parent_stop_id IS NOT NULL
  UNION SELECT ps.stop_subject_id,ps.pattern_subject_id FROM public.v2_pattern_stops ps JOIN public.v2_pattern_versions pv ON pv.pattern_subject_id=ps.pattern_subject_id AND pv.version=ps.pattern_version WHERE pv.sealed
  UNION SELECT intended_subject_id,subject_id FROM public.v2_actual_journeys WHERE intended_subject_id IS NOT NULL
  UNION SELECT matched_run_subject_id,subject_id FROM public.v2_actual_journeys WHERE matched_run_subject_id IS NOT NULL
  UNION SELECT x.ref_id,o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT x.ref_id,public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT p.source_subject_id,p.target_subject_id FROM public.v2_transport_creations p JOIN public.v2_transport_creation_origins o ON o.creation_id=p.id
  UNION SELECT from_subject_id,to_subject_id FROM public.v2_association_links
  UNION SELECT to_subject_id,from_subject_id FROM public.v2_association_links
 ), reached(id) AS (SELECT unnest(roots) UNION SELECT e.child FROM edges e JOIN reached r ON r.id=e.parent)
 SELECT COALESCE(array_agg(s.id ORDER BY s.id),'{}'::uuid[]) FROM reached r JOIN public.v2_subjects s ON s.id=r.id;
$$;

-- Private discovery projection prerequisite. No client/backend grant here.
-- The public HTTP/native capability and compatible contribution adapters must
-- be installed before exposing it. Staff scaffolds never become public leads.
CREATE FUNCTION public.v2_timetable_discovery(subject uuid,as_of timestamptz DEFAULT statement_timestamp()) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE e public.v2_admin_timetable_entries;cmd public.v2_admin_timetables;l public.v2_leads;r public.v2_runs;plan public.v2_service_plans;
 pat public.v2_patterns;route public.v2_routes;op public.v2_operators;cal public.v2_calendars;policy public.v2_evidence_policies;
 property record;observation public.v2_observations;local_day date;evidence_day date;source_day date;source_latest date;horizon integer;
 critical text[]:=ARRAY['route.origin','route.destination','operator.reported','pattern.stops','service.mode','service.calendar','departure.scheduled','boarding.pickup'];
 pickup public.v2_stops;dropoff public.v2_stops;corridor public.v2_corridors;facts jsonb;revision_digest text;
BEGIN
 IF as_of IS NULL OR NOT isfinite(as_of) THEN RETURN NULL;END IF;
 SELECT * INTO e FROM public.v2_admin_timetable_entries WHERE source_subject_id=subject;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO cmd FROM public.v2_admin_timetables WHERE id=e.timetable_id;
 SELECT * INTO l FROM public.v2_leads WHERE subject_id=subject;
 IF cmd.erased OR cmd.actor_user_id IS NULL OR l.intake_kind<>'staff' OR l.attribution_erased
  OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=cmd.actor_user_id)
  OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=cmd.actor_user_id)
  OR EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals WHERE route_subject_id=subject)
  OR EXISTS(SELECT 1 FROM public.v2_public_lead_hides WHERE subject_id=subject)
  OR NOT public.v2_current_reviewed_creation(e.run_subject_id)
  OR EXISTS(SELECT 1 FROM unnest(critical) f WHERE NOT public.v2_timetable_property_current(e.run_subject_id,f)) THEN RETURN NULL;END IF;
 SELECT * INTO r FROM public.v2_runs WHERE subject_id=e.run_subject_id;
 SELECT * INTO plan FROM public.v2_service_plans WHERE subject_id=r.service_plan_subject_id;
 SELECT * INTO pat FROM public.v2_patterns WHERE subject_id=plan.pattern_subject_id;
 SELECT * INTO route FROM public.v2_routes WHERE subject_id=pat.route_subject_id;
 SELECT * INTO op FROM public.v2_operators WHERE subject_id=route.operator_subject_id;
 SELECT * INTO cal FROM public.v2_calendars WHERE id=plan.calendar_id;
 SELECT * INTO corridor FROM public.v2_corridors WHERE id=pat.corridor_id;
 IF l.corridor_id IS DISTINCT FROM pat.corridor_id OR l.operator_subject_id IS DISTINCT FROM op.subject_id
  OR l.reported_departure_seconds IS DISTINCT FROM r.departure_seconds OR plan.mode<>'fixed_time' OR cal.coverage<>'recurring' OR cal.timezone IS DISTINCT FROM plan.timezone
  OR cal.weekdays IS NULL OR cal.weekdays=0 OR cal.start_date IS NULL OR cal.end_date IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.v2_timezones WHERE name=cal.timezone)
  OR EXISTS(SELECT 1 FROM public.v2_calendar_exceptions WHERE calendar_id=cal.id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_transport_creation_origins o JOIN public.v2_transport_creations c ON c.id=o.creation_id
   WHERE o.subject_id=r.subject_id AND c.source_subject_id=subject AND c.target_kind='run' AND NOT c.erased AND NOT o.erased) THEN RETURN NULL;END IF;
 local_day:=(as_of AT TIME ZONE cal.timezone)::date;
 IF local_day<greatest(cal.start_date,r.validity_from,plan.effective_from)
  OR local_day>least(cal.end_date,r.validity_to,plan.effective_to) THEN RETURN NULL;END IF;
 SELECT p.* INTO policy FROM public.v2_evidence_policy_state s JOIN public.v2_evidence_policies p ON p.version=s.version WHERE s.id;
 IF policy.version IS NULL THEN RETURN NULL;END IF;
 -- Retain current evidence-policy horizons and original observation/source age.
 -- Manual native review supplies exact entity context; it never creates a
 -- second witness or rewrites the observation's date to the approval date.
 FOR property IN SELECT p.* FROM public.v2_admin_timetable_properties p WHERE p.run_subject_id=r.subject_id AND p.field_key=ANY(critical)
  AND p.writer_kind<>'header' LOOP
  SELECT * INTO observation FROM public.v2_observations WHERE id=property.observation_id;
  SELECT min(s.source_date),max(s.source_date) INTO source_day,source_latest FROM public.v2_sources s WHERE s.id=ANY(public.v2_source_component(
   ARRAY(SELECT os.source_id FROM public.v2_observation_sources os WHERE os.observation_id=observation.id)));
  evidence_day:=least(observation.observed_from,source_day);
  horizon:=CASE WHEN property.field_key='operator.reported' THEN policy.operator_days
   WHEN property.field_key IN('pattern.stops','boarding.pickup') THEN policy.place_days ELSE policy.schedule_days END;
  IF evidence_day IS NULL OR evidence_day>local_day OR observation.observed_from>local_day
   OR observation.observed_to>local_day OR source_latest>local_day OR observation.knowledge_basis NOT IN('observed_sign','operator_statement')
   OR NOT coalesce((public.v2_source_footprint(observation.id)->>'known')::boolean,false)
   OR as_of>=public.v2_assessment_day_end(evidence_day,horizon,cal.timezone) THEN RETURN NULL;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.v2_review_cases c WHERE c.subject_id=ANY(ARRAY[subject,r.subject_id,plan.subject_id,pat.subject_id,route.subject_id,op.subject_id])
  AND c.kind='conflict' AND c.state IN('open','in_review','reopened') AND (c.field_key IS NULL OR c.field_key=ANY(critical))) THEN RETURN NULL;END IF;
 SELECT s.* INTO pickup FROM public.v2_admin_timetable_properties p JOIN public.v2_observations o ON o.id=p.observation_id
  JOIN public.v2_stops s ON s.subject_id=(o.value->>'stopId')::uuid WHERE p.run_subject_id=r.subject_id AND p.field_key='boarding.pickup';
 IF pickup.subject_id IS NULL OR pickup.city_id IS DISTINCT FROM corridor.origin_city_id OR NOT public.v2_current_reviewed_creation(pickup.subject_id)
  OR NOT EXISTS(SELECT 1 FROM public.v2_pattern_stops ps WHERE ps.pattern_subject_id=pat.subject_id AND ps.pattern_version=plan.pattern_version
   AND ps.stop_subject_id=pickup.subject_id AND ps.pickup IN('allowed','request')) THEN RETURN NULL;END IF;
 IF public.v2_timetable_property_current(r.subject_id,'alighting.dropoff') THEN
  SELECT s.* INTO dropoff FROM public.v2_admin_timetable_properties p JOIN public.v2_observations o ON o.id=p.observation_id
   JOIN public.v2_stops s ON s.subject_id=(o.value->>'stopId')::uuid WHERE p.run_subject_id=r.subject_id AND p.field_key='alighting.dropoff';
  IF dropoff.city_id IS DISTINCT FROM corridor.destination_city_id OR NOT public.v2_current_reviewed_creation(dropoff.subject_id) THEN dropoff:=NULL;END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('field',p.field_key,'ref','timetable:'||p.review_id::text,'value',o.value,'scope',o.scope,
  'observedDate',o.observed_from,'asOf',local_day) ORDER BY p.field_key),'[]'::jsonb) INTO facts
  FROM public.v2_admin_timetable_properties p JOIN public.v2_observations o ON o.id=p.observation_id
  WHERE p.run_subject_id=r.subject_id AND p.field_key IN('fare.quoted','fare.advertised','boarding.pickup','alighting.dropoff')
   AND public.v2_timetable_property_current(r.subject_id,p.field_key);
 revision_digest:=public.v2_assessment_hash(jsonb_build_object('source',(SELECT jsonb_build_array(revision,input_generation) FROM public.v2_subjects WHERE id=subject),
  'run',(SELECT jsonb_build_array(revision,input_generation) FROM public.v2_subjects WHERE id=r.subject_id),
  'plan',(SELECT jsonb_build_array(revision,input_generation) FROM public.v2_subjects WHERE id=plan.subject_id),
  'policy',policy.version,'graph',(SELECT revision FROM public.v2_source_graph WHERE id),'facts',facts));
 RETURN jsonb_build_object('subjectId',subject,'runId',r.subject_id,'contextDigest',revision_digest,'provenance','reviewed_timetable',
  'origin',(SELECT jsonb_build_object('id',id,'name',name,'placeType',place_type) FROM public.cities WHERE id=corridor.origin_city_id),
  'destination',(SELECT jsonb_build_object('id',id,'name',name,'placeType',place_type) FROM public.cities WHERE id=corridor.destination_city_id),
  'operator',jsonb_build_object('id',op.subject_id,'name',op.display_name),
  'departureSeconds',r.departure_seconds,'arrivalSeconds',CASE WHEN public.v2_timetable_property_current(r.subject_id,'arrival.scheduled') THEN r.arrival_seconds END,
  'pickup',jsonb_build_object('stopId',pickup.subject_id,'cityId',pickup.city_id,'name',pickup.name),
  'dropoff',CASE WHEN dropoff.subject_id IS NOT NULL THEN jsonb_build_object('stopId',dropoff.subject_id,'cityId',dropoff.city_id,'name',dropoff.name) END,
  'calendar',jsonb_build_object('timezone',cal.timezone,'weekdays',cal.weekdays,'validFrom',greatest(cal.start_date,r.validity_from,plan.effective_from),
   'validUntil',least(cal.end_date,r.validity_to,plan.effective_to)),'approvedFacts',facts,'asOf',as_of);
END;$$;
REVOKE ALL ON FUNCTION public.v2_timetable_discovery(uuid,timestamptz) FROM PUBLIC,mabhazi_api;
DO $$ DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.v2_timetable_discovery(uuid,timestamptz) FROM %I',r);END IF;
 END LOOP;
END;$$;


CREATE OR REPLACE FUNCTION public.v2_api_admin_route_action(actor varchar,request uuid,input jsonb) RETURNS jsonb
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
  WHERE l.subject_id=route AND (l.intake_kind='community' OR (l.intake_kind='staff' AND EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id AND NOT t.erased WHERE e.source_subject_id=l.subject_id))) AND NOT l.attribution_erased;
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

-- Removing a registered presentation row changes publication, not the reviewed
-- native facts. The generic path follows native source->created-run provenance
-- edges and irreversibly invalidates that creation head on a visibility toggle.
-- Keep the public gate closed while removed, advance the alias revision/tasks,
-- and let restoration re-evaluate unchanged native proof. Real structural or
-- evidence changes still use their original invalidation paths.
CREATE OR REPLACE FUNCTION public.v2_admin_route_action_propagate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.outcome IN('removed','restored') THEN
  IF EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries e JOIN public.v2_leads l ON l.subject_id=e.source_subject_id
   WHERE e.source_subject_id=NEW.route_subject_id AND l.intake_kind='staff') THEN
   PERFORM public.v2_target_recompute_subjects(ARRAY[NEW.route_subject_id],NEW.id,false);
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
    SELECT 'refresh_tasks',id,input_generation,'prompts/1',NEW.id FROM public.v2_subjects WHERE id=NEW.route_subject_id;
  ELSE
   PERFORM public.v2_transport_propagate(ARRAY[NEW.route_subject_id],'v2_admin_route_actions','UPDATE',ARRAY['public_visibility']);
  END IF;
 END IF;
 RETURN NEW;
END;$$;

