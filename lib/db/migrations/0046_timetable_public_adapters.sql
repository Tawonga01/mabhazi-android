-- Versioned timetable public adapters. Only the restricted backend receives these projections.
-- Registered source leads remain real leads; no inferred association or anonymous SQL access.
CREATE OR REPLACE FUNCTION public.v2_place_reference_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.field_key IN('boarding.pickup','alighting.dropoff') THEN
  INSERT INTO public.v2_place_report_refs(observation_id) VALUES(NEW.id) ON CONFLICT(observation_id) DO NOTHING;
 END IF;RETURN NEW;
END;$$;
INSERT INTO public.v2_place_report_refs(observation_id)
 SELECT p.observation_id FROM public.v2_admin_timetable_properties p WHERE p.field_key IN('boarding.pickup','alighting.dropoff')
 ON CONFLICT(observation_id) DO NOTHING;

-- Keep current typed native proof authoritative. Presentation moderation never
-- withdraws that proof; restoring visibility rechecks it instead of reapproving it.
DO $$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.v2_timetable_discovery(uuid,timestamptz)'::regprocedure);
 IF strpos(definition,'OR NOT public.v2_current_reviewed_creation(e.run_subject_id)')=0 THEN RAISE EXCEPTION 'timetable_discovery_baseline_changed';END IF;
 definition:=replace(definition,'OR NOT public.v2_current_reviewed_creation(e.run_subject_id)',
  'OR EXISTS(SELECT 1 FROM public.v2_admin_current_core WHERE route_subject_id=subject)
  OR EXISTS(SELECT 1 FROM public.v2_admin_timetable_properties p JOIN public.v2_place_report_refs ref ON ref.observation_id=p.observation_id JOIN public.v2_place_report_hides hide ON hide.place_ref=ref.id WHERE p.run_subject_id=e.run_subject_id AND p.field_key=''boarding.pickup'')
  OR NOT public.v2_current_reviewed_creation(e.run_subject_id)');
 EXECUTE definition;
END;$$;
CREATE FUNCTION public.v2_timetable_identity(subject uuid) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT public.v2_assessment_hash(jsonb_build_array(d->'subjectId',d->'runId',d->'origin',d->'destination',d->'operator',d->'departureSeconds',d->'pickup',d->'calendar'))
 FROM (SELECT public.v2_timetable_discovery(subject) d) x WHERE d IS NOT NULL;
$$;
CREATE FUNCTION public.v2_api_public_timetable_reports() RETURNS TABLE(
 subject_id uuid,revision bigint,author_user_id varchar,origin_city_id integer,destination_city_id integer,
 origin jsonb,destination jsonb,operator_report jsonb,reported_time jsonb,core_corrections jsonb,timetable jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e.source_subject_id,s.revision,t.actor_user_id,(d->'origin'->>'id')::integer,(d->'destination'->>'id')::integer,
 d->'origin',d->'destination',
 jsonb_build_object('value',d->'operator'->>'name','support','reported','freshness','unknown','submittedAt',c.submitted_at,'observedDate',t.proposal->'source'->>'checkedOn'),
 jsonb_build_object('value',lpad(((d->>'departureSeconds')::integer/3600)::text,2,'0')||':'||lpad((((d->>'departureSeconds')::integer%3600)/60)::text,2,'0'),
 'basis','scheduled','support','reported','freshness','unknown','submittedAt',c.submitted_at,'observedDate',t.proposal->'source'->>'checkedOn'),
 '[]'::jsonb,jsonb_build_object('runId',d->'runId','departureSeconds',d->'departureSeconds','arrivalSeconds',d->'arrivalSeconds','calendar',d->'calendar')
 FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id
 JOIN public.v2_subjects s ON s.id=e.source_subject_id JOIN public.v2_leads l ON l.subject_id=s.id
 JOIN public.v2_contributions c ON c.id=l.initial_contribution_id
 CROSS JOIN LATERAL (SELECT public.v2_timetable_discovery(e.source_subject_id) d) projection WHERE d IS NOT NULL;
$$;
CREATE VIEW public.v2_public_supported_route_reports AS
 SELECT p.subject_id,p.revision,p.author_user_id,p.origin_city_id,p.destination_city_id,p.origin,p.destination,p.operator_report,p.reported_time,p.core_corrections,NULL::jsonb timetable
 FROM public.v2_public_reviewed_lead_reports p UNION ALL SELECT * FROM public.v2_api_public_timetable_reports();
-- Fresh intake on corrected community identity remains fenced. Never substitute
-- the reviewed community display for the original contribution identity.
CREATE VIEW public.v2_public_contributable_route_reports AS
 SELECT p.*,NULL::jsonb timetable FROM public.v2_public_lead_reports p
 UNION ALL SELECT subject_id,revision,author_user_id,origin_city_id,destination_city_id,origin,destination,operator_report,reported_time,timetable FROM public.v2_api_public_timetable_reports();

CREATE FUNCTION public.v2_timetable_contribution_context(actor varchar,subject uuid,blocked varchar[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p record;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor)
  THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) b WHERE b IS NULL OR length(b) NOT BETWEEN 1 AND 200 OR b~'[[:cntrl:]]')
  THEN RAISE EXCEPTION 'v2_route_safety_context_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM public.v2_api_public_timetable_reports() r WHERE r.subject_id=subject AND NOT(r.author_user_id=ANY(blocked))
 AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=actor AND b.blocked_user_id=r.author_user_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_route_target_unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('subjectId',subject,'revision',p.revision,'identityKey',public.v2_timetable_identity(subject),
  'origin',p.origin,'destination',p.destination,'operatorName',p.operator_report->>'value','departureTime',p.reported_time->>'value');
END;$$;
DO $$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.v2_api_route_contribution_context(character varying,uuid,character varying[])'::regprocedure);
 IF strpos(definition,'BEGIN')=0 THEN RAISE EXCEPTION 'timetable_context_baseline_changed';END IF;
 definition:=replace(definition,'BEGIN','BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries WHERE source_subject_id=subject) THEN RETURN public.v2_timetable_contribution_context(actor,subject,blocked);END IF;');
 EXECUTE definition;
 definition:=pg_get_functiondef('public.v2_api_submit_public_actual_journey(character varying,text,jsonb,character varying[])'::regprocedure);
 IF strpos(definition,'public.v2_public_lead_reports')=0 THEN RAISE EXCEPTION 'timetable_actual_baseline_changed';END IF;
 EXECUTE replace(definition,'public.v2_public_lead_reports','public.v2_public_contributable_route_reports');
 definition:=pg_get_functiondef('public.v2_api_route_report_action(character varying,uuid,text,text)'::regprocedure);
 IF strpos(definition,'public.v2_public_reviewed_lead_reports')=0 THEN RAISE EXCEPTION 'timetable_safety_baseline_changed';END IF;
 EXECUTE replace(definition,'public.v2_public_reviewed_lead_reports','public.v2_public_supported_route_reports');
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_fare_report_context AS '||replace(pg_get_viewdef('public.v2_fare_report_context'::regclass,true),'v2_public_lead_reports','v2_public_contributable_route_reports');
 definition:=pg_get_viewdef('public.v2_place_report_context'::regclass,true);
 IF strpos(definition,$anchor$l.intake_kind = 'community'$anchor$)=0 OR strpos(definition,'v2_prompt_identity(l.subject_id)')=0 THEN RAISE EXCEPTION 'timetable_place_baseline_changed';END IF;
 definition:=replace(definition,$anchor$l.intake_kind = 'community'::text$anchor$,$replacement$(l.intake_kind = 'community'::text OR (l.intake_kind = 'staff'::text AND v2_timetable_discovery(l.subject_id) IS NOT NULL))$replacement$);
 definition:=replace(definition,'v2_prompt_identity(l.subject_id)',$replacement$CASE WHEN l.intake_kind='staff' THEN v2_timetable_identity(l.subject_id) ELSE v2_prompt_identity(l.subject_id) END$replacement$);
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_place_report_context AS '||definition;
 definition:=pg_get_functiondef('public.v2_api_place_report_action(character varying,uuid,uuid,text,text,character varying[])'::regprocedure);
 EXECUTE replace(definition,'public.v2_public_lead_reports','public.v2_public_contributable_route_reports');
END;$$;

-- These claims are exact independent native approvals, not fabricated selected
-- field resolutions. Public references are separate from evidence/review IDs.
CREATE FUNCTION public.v2_api_timetable_card_claims(subjects uuid[]) RETURNS TABLE(
 route_subject_id uuid,field_key text,ref uuid,original_value jsonb,scope jsonb,observed_date text,as_of text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF subjects IS NULL OR cardinality(subjects)>20 THEN RAISE EXCEPTION 'timetable_card_page_invalid' USING ERRCODE='23514';END IF;
 RETURN QUERY SELECT e.source_subject_id,p.field_key,coalesce(f.id,place.id),
 CASE WHEN p.field_key IN('boarding.pickup','alighting.dropoff') THEN jsonb_build_object('name',stop.name) ELSE jsonb_set(o.value,'{amount}',to_jsonb(trim_scale((o.value->>'amount')::numeric)::text)) END,o.scope,o.observed_from::text,
 (statement_timestamp() AT TIME ZONE (d->'calendar'->>'timezone'))::date::text
 FROM public.v2_admin_timetable_entries e CROSS JOIN LATERAL (SELECT public.v2_timetable_discovery(e.source_subject_id) d) available
 JOIN public.v2_admin_timetable_properties p ON p.run_subject_id=e.run_subject_id
 JOIN public.v2_observations o ON o.id=p.observation_id
 LEFT JOIN public.v2_public_fare_refs f ON f.observation_id=o.id
 LEFT JOIN public.v2_place_report_refs place ON place.observation_id=o.id
 LEFT JOIN public.v2_stops stop ON stop.subject_id=CASE WHEN p.field_key IN('boarding.pickup','alighting.dropoff') THEN (o.value->>'stopId')::uuid END
 WHERE e.source_subject_id=ANY(subjects) AND d IS NOT NULL AND p.field_key IN('fare.quoted','fare.advertised','boarding.pickup','alighting.dropoff')
 AND public.v2_timetable_property_current(e.run_subject_id,p.field_key) AND coalesce(f.id,place.id) IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.v2_public_fare_hides h WHERE h.fare_ref=f.id)
 AND NOT EXISTS(SELECT 1 FROM public.v2_place_report_hides h WHERE h.place_ref=place.id);
END;$$;
-- New anonymous SQL privileges are never introduced. The browser/mobile uses
-- authenticated HTTP guards; these facades are exclusive to the backend role.
DO $$ DECLARE f text;r text;t text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_timetable_identity(uuid)','public.v2_timetable_contribution_context(varchar,uuid,varchar[])',
 'public.v2_api_public_timetable_reports()','public.v2_api_timetable_card_claims(uuid[])'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.v2_api_public_timetable_reports(),public.v2_api_timetable_card_claims(uuid[]) TO mabhazi_api;
 FOREACH t IN ARRAY ARRAY['v2_public_supported_route_reports','v2_public_contributable_route_reports'] LOOP
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
 EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
 END LOOP;
END;$$;

CREATE FUNCTION public.v2_api_timetable_report_claims(subjects uuid[]) RETURNS TABLE(
 route_subject_id uuid,author_id varchar,observation_id uuid,subject_id uuid,field_key text,scope_key text,scope jsonb,original_value jsonb,
 knowledge_basis text,observed_from date,observed_to date,effective_from date,effective_to date,submitted_at timestamptz,ref uuid,field_read jsonb,city jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $
 SELECT card.route_subject_id,t.actor_user_id,o.id,o.original_subject_id,o.field_key,o.scope_key,o.scope,card.original_value,
 o.knowledge_basis,o.observed_from,o.observed_to,o.effective_from,o.effective_to,o.submitted_at,card.ref,
 jsonb_build_object('status','assessed','reviewed',true,'dispute','none','provenance','reviewed_timetable','value',card.original_value,
 'candidates',jsonb_build_array(jsonb_build_object('value',card.original_value,'freshness','current','temporalClass','ongoing','oldestDate',o.observed_from,'newestDate',o.observed_from))),
 CASE WHEN o.field_key IN('boarding.pickup','alighting.dropoff') THEN
 (SELECT jsonb_build_object('id',c.id,'name',c.name,'placeType',c.place_type) FROM public.cities c WHERE c.id=(projection->CASE o.field_key WHEN 'boarding.pickup' THEN 'origin' ELSE 'destination' END->>'id')::integer) END
 FROM public.v2_api_timetable_card_claims(subjects) card
 JOIN public.v2_admin_timetable_entries e ON e.source_subject_id=card.route_subject_id
 JOIN public.v2_admin_timetables t ON t.id=e.timetable_id
 JOIN public.v2_admin_timetable_properties p ON p.run_subject_id=e.run_subject_id AND p.field_key=card.field_key
 JOIN public.v2_observations o ON o.id=p.observation_id
 CROSS JOIN LATERAL (SELECT public.v2_timetable_discovery(e.source_subject_id) projection) d;
$$;
REVOKE ALL ON FUNCTION public.v2_api_timetable_report_claims(uuid[]) FROM PUBLIC,mabhazi_api;
GRANT EXECUTE ON FUNCTION public.v2_api_timetable_report_claims(uuid[]) TO mabhazi_api;
DO $$ DECLARE definition text;BEGIN
 definition:=rtrim(pg_get_viewdef('public.v2_fare_report_context'::regclass,true),E'; \n');
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_fare_report_context AS '||definition||
 ' UNION ALL SELECT c.ref,c.route_subject_id,c.author_id,c.author_id,c.observation_id,c.subject_id,c.field_key,c.scope_key,c.scope,c.original_value,
 c.knowledge_basis,c.observed_from,c.observed_to,c.effective_from,c.effective_to,c.submitted_at,p.origin,p.destination,p.operator_report,p.reported_time,true,c.field_read
 FROM public.v2_api_public_timetable_reports() p CROSS JOIN LATERAL public.v2_api_timetable_report_claims(ARRAY[p.subject_id]) c WHERE c.field_key LIKE ''fare.%''';
 definition:=rtrim(pg_get_viewdef('public.v2_place_report_context'::regclass,true),E'; \n');
 EXECUTE 'CREATE OR REPLACE VIEW public.v2_place_report_context AS '||definition||
 ' UNION ALL SELECT c.ref,c.route_subject_id,c.author_id,c.author_id,c.observation_id,c.field_key,c.scope_key,c.original_value,c.knowledge_basis,c.observed_from,c.submitted_at,c.city,true,c.field_read,false
 FROM public.v2_api_public_timetable_reports() p CROSS JOIN LATERAL public.v2_api_timetable_report_claims(ARRAY[p.subject_id]) c WHERE c.field_key IN(''boarding.pickup'',''alighting.dropoff'')';
END;$$;
