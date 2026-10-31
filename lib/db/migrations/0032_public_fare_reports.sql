-- Opaque public presentation references preserve private observation identity.
-- This exposes dated reports, not canonical fares or timetables.
CREATE TABLE public.v2_public_fare_refs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL UNIQUE REFERENCES public.v2_observations(id) ON DELETE CASCADE);
CREATE TABLE public.v2_public_fare_hides(
 fare_ref uuid PRIMARY KEY REFERENCES public.v2_public_fare_refs(id) ON DELETE CASCADE,
 report_id integer NOT NULL REFERENCES public.abuse_reports(id),
 hidden_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.v2_fare_reference_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.field_key IN('fare.paid','fare.quoted','fare.advertised') THEN
  INSERT INTO public.v2_public_fare_refs(observation_id) VALUES(NEW.id) ON CONFLICT(observation_id) DO NOTHING;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER v2_fare_reference_created AFTER INSERT ON public.v2_observations
 FOR EACH ROW EXECUTE FUNCTION public.v2_fare_reference_created();
CREATE FUNCTION public.v2_fare_reference_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'v2_fare_reference_immutable' USING ERRCODE='23514';END;$$;
CREATE TRIGGER v2_fare_reference_immutable BEFORE UPDATE ON public.v2_public_fare_refs
 FOR EACH ROW EXECUTE FUNCTION public.v2_fare_reference_immutable();
INSERT INTO public.v2_public_fare_refs(observation_id)
 SELECT id FROM public.v2_observations WHERE field_key IN('fare.paid','fare.quoted','fare.advertised') ON CONFLICT(observation_id) DO NOTHING;

-- Private context includes unready evidence so the API can distinguish checking
-- from a real empty result. Never serialize raw value/IDs without its read gate.
CREATE VIEW public.v2_fare_report_context AS
SELECT ref.id AS fare_ref,p.subject_id AS route_subject_id,p.author_user_id AS route_author_id,c.user_id AS fare_author_id,
 o.id AS observation_id,o.original_subject_id AS actual_subject_id,o.field_key,o.scope_key,o.scope,o.value AS original_value,
 o.knowledge_basis,o.observed_from,o.observed_to,o.effective_from,o.effective_to,o.submitted_at,
 p.origin,p.destination,p.operator_report,p.reported_time,
 COALESCE(e.disposition<>'excluded',false) AS evidence_included,
 public.v2_read_field(o.original_subject_id,o.field_key,o.scope_key) AS field_read
FROM public.v2_public_fare_refs ref
JOIN public.v2_observations o ON o.id=ref.observation_id
JOIN public.v2_observation_states state ON state.observation_id=o.id AND state.status='active'
JOIN public.v2_observation_targets target ON target.observation_id=o.id AND target.assignment_id IS NULL
JOIN public.v2_contributions c ON c.id=o.contribution_id AND c.original_subject_id=o.original_subject_id
JOIN public.users author ON author.id=c.user_id
JOIN public.v2_actual_journeys a ON a.subject_id=o.original_subject_id AND a.intended_subject_kind='lead' AND a.matched_run_subject_id IS NULL
JOIN public.v2_subjects actual ON actual.id=a.subject_id AND actual.kind='actual_journey' AND actual.lifecycle='active'
JOIN public.v2_contributions initial ON initial.id=a.initial_contribution_id AND initial.original_subject_id=a.subject_id AND initial.user_id=c.user_id
JOIN public.v2_public_lead_reports p ON p.subject_id=a.intended_subject_id
LEFT JOIN public.v2_current_fields current_field ON current_field.subject_id=o.original_subject_id AND current_field.field_key=o.field_key AND current_field.scope_key=o.scope_key
LEFT JOIN public.v2_field_decision_evidence e ON e.field_decision_id=current_field.field_decision_id AND e.observation_id=o.id
WHERE o.field_key IN('fare.paid','fare.quoted','fare.advertised')
 AND o.scope->'segment'->>'kind'='city_pair'
 AND (o.scope->'segment'->>'originCityId')::integer=p.origin_city_id
 AND (o.scope->'segment'->>'destinationCityId')::integer=p.destination_city_id
 AND NOT EXISTS(SELECT 1 FROM public.v2_public_fare_hides h WHERE h.fare_ref=ref.id)
 -- A known different reported company is not silently attached to this lead.
 AND NOT EXISTS(SELECT 1 FROM public.v2_observations company JOIN public.v2_observation_states cs ON cs.observation_id=company.id AND cs.status='active'
  WHERE company.original_subject_id=a.subject_id AND company.field_key='operator.reported'
   AND (company.operator_ref IS NOT NULL OR lower(regexp_replace(btrim(company.value->>'name'),'[[:space:]]+',' ','g')) IS DISTINCT FROM lower(regexp_replace(btrim(p.operator_report->>'value'),'[[:space:]]+',' ','g'))));

CREATE FUNCTION public.v2_api_fare_report_action(actor varchar,subject uuid,fare uuid,action text,reason text,blocked varchar[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context public.v2_fare_report_context;report integer;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) x WHERE x IS NULL OR length(x) NOT BETWEEN 1 AND 200 OR x~'[[:cntrl:]]') THEN RAISE EXCEPTION 'v2_safety_context_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 SELECT * INTO context FROM public.v2_fare_report_context f WHERE f.fare_ref=fare AND f.route_subject_id=subject;
 IF NOT FOUND OR NOT context.evidence_included OR context.field_read->>'status' NOT IN('assessed','review_required')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(context.field_read->'candidates','[]'::jsonb)) candidate
   WHERE candidate->'value'=jsonb_set(context.original_value,'{amount}',to_jsonb(trim_scale((context.original_value->>'amount')::numeric)::text))) THEN
  RAISE EXCEPTION 'v2_fare_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL AND EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id=context.fare_author_id) THEN RETURN '{"status":"blocked"}'::jsonb;END IF;
 IF context.route_author_id=ANY(blocked) OR context.fare_author_id=ANY(blocked) OR EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id IN(context.route_author_id,context.fare_author_id)) THEN RAISE EXCEPTION 'v2_fare_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL THEN
  IF actor=context.fare_author_id THEN RAISE EXCEPTION 'v2_self_block_invalid' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM public.v2_route_report_blocks WHERE blocker_id=actor)>=200 THEN RAISE EXCEPTION 'v2_block_limit' USING ERRCODE='23514';END IF;
  INSERT INTO public.v2_route_report_blocks(blocker_id,blocked_user_id) VALUES(actor,context.fare_author_id) ON CONFLICT DO NOTHING;
  RETURN '{"status":"blocked"}'::jsonb;
 ELSIF action='report' AND reason IN('spam','inaccurate','offensive','unsafe','other') THEN
  SELECT id INTO report FROM public.abuse_reports WHERE reporter_id=actor AND target_type='fare_report' AND target_id=fare::text AND abuse_reports.reason=v2_api_fare_report_action.reason AND status='pending' ORDER BY id LIMIT 1;
  IF report IS NULL THEN INSERT INTO public.abuse_reports(reporter_id,target_type,target_id,reason) VALUES(actor,'fare_report',fare::text,reason);END IF;
  RETURN '{"status":"reported"}'::jsonb;
 END IF;
 RAISE EXCEPTION 'v2_safety_action_invalid' USING ERRCODE='23514';
END;$$;

CREATE FUNCTION public.v2_api_hide_reported_fare(report integer,notes text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.abuse_reports;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO r FROM public.abuse_reports WHERE id=report FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.target_type<>'fare_report' OR length(notes)>2000 THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_public_fare_refs WHERE id=r.target_id::uuid) THEN RETURN false;END IF;
 INSERT INTO public.v2_public_fare_hides(fare_ref,report_id) VALUES(r.target_id::uuid,r.id) ON CONFLICT DO NOTHING;
 UPDATE public.abuse_reports SET status='actioned',moderator_notes=notes,reviewed_at=now() WHERE id=r.id;RETURN true;
END;$$;
DO $$ DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_public_fare_refs','v2_public_fare_hides'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_read ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
 END LOOP;
 REVOKE ALL ON public.v2_fare_report_context FROM PUBLIC,mabhazi_api;
 GRANT SELECT ON public.v2_fare_report_context TO mabhazi_api;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_fare_reference_created','v2_fare_reference_immutable','v2_api_fare_report_action','v2_api_hide_reported_fare') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN FOREACH t IN ARRAY ARRAY['v2_public_fare_refs','v2_public_fare_hides','v2_fare_report_context'] LOOP EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END LOOP;END IF;
 END LOOP;
END;$$;
GRANT EXECUTE ON FUNCTION public.v2_api_fare_report_action(varchar,uuid,uuid,text,text,varchar[]),public.v2_api_hide_reported_fare(integer,text) TO mabhazi_api;
