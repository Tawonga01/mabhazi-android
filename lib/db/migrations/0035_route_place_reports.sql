-- Public presentation IDs are distinct from private evidence/receipt IDs.
CREATE TABLE public.v2_place_report_refs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL UNIQUE REFERENCES public.v2_observations(id) ON DELETE CASCADE);
CREATE TABLE public.v2_place_report_hides(
 place_ref uuid PRIMARY KEY REFERENCES public.v2_place_report_refs(id) ON DELETE CASCADE,
 report_id integer NOT NULL REFERENCES public.abuse_reports(id),
 hidden_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.v2_place_reference_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.field_key IN('boarding.pickup','alighting.dropoff') AND EXISTS(
  SELECT 1 FROM public.v2_contributions c WHERE c.id=NEW.contribution_id AND c.payload->>'operation'='route-observations/1') THEN
  INSERT INTO public.v2_place_report_refs(observation_id) VALUES(NEW.id) ON CONFLICT(observation_id) DO NOTHING;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_place_reference_created AFTER INSERT ON public.v2_observations
 FOR EACH ROW EXECUTE FUNCTION public.v2_place_reference_created();
CREATE FUNCTION public.v2_place_reference_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'v2_place_reference_immutable' USING ERRCODE='23514';END;$$;
CREATE TRIGGER v2_place_reference_immutable BEFORE UPDATE ON public.v2_place_report_refs
 FOR EACH ROW EXECUTE FUNCTION public.v2_place_reference_immutable();
INSERT INTO public.v2_place_report_refs(observation_id)
 SELECT o.id FROM public.v2_observations o JOIN public.v2_contributions c ON c.id=o.contribution_id
 WHERE o.field_key IN('boarding.pickup','alighting.dropoff') AND c.payload->>'operation'='route-observations/1'
 ON CONFLICT(observation_id) DO NOTHING;

-- Private backend view. Raw identity/value columns must never be serialized.
CREATE VIEW public.v2_place_report_context AS
SELECT ref.id AS place_ref,l.subject_id AS route_subject_id,initial.user_id AS route_author_id,c.user_id AS place_author_id,
 o.id AS observation_id,o.field_key,o.scope_key,o.value AS original_value,o.knowledge_basis,o.observed_from,o.submitted_at,
 jsonb_build_object('id',city.id,'name',city.name,'placeType',city.place_type) AS city,
 COALESCE(e.disposition<>'excluded',false) AS evidence_included,
 public.v2_read_field(o.original_subject_id,o.field_key,o.scope_key) AS field_read,
 EXISTS(SELECT 1 FROM public.v2_place_report_hides h WHERE h.place_ref=ref.id) AS is_hidden
FROM public.v2_place_report_refs ref
JOIN public.v2_observations o ON o.id=ref.observation_id AND o.scope='{}'::jsonb
JOIN public.v2_observation_states state ON state.observation_id=o.id AND state.status='active'
JOIN public.v2_observation_targets target ON target.observation_id=o.id AND target.assignment_id IS NULL
JOIN public.v2_contributions c ON c.id=o.contribution_id AND c.original_subject_id=o.original_subject_id
JOIN public.users author ON author.id=c.user_id
JOIN public.v2_leads l ON l.subject_id=o.original_subject_id AND l.intake_kind='community' AND NOT l.attribution_erased
JOIN public.v2_subjects subject ON subject.id=l.subject_id AND subject.kind='lead' AND subject.lifecycle='active'
JOIN public.v2_contributions initial ON initial.id=l.initial_contribution_id AND initial.original_subject_id=l.subject_id
JOIN public.v2_corridors corridor ON corridor.id=l.corridor_id
JOIN public.cities city ON city.id=CASE o.field_key WHEN 'boarding.pickup' THEN corridor.origin_city_id ELSE corridor.destination_city_id END
LEFT JOIN public.v2_current_fields current_field ON current_field.subject_id=o.original_subject_id AND current_field.field_key=o.field_key AND current_field.scope_key=o.scope_key
LEFT JOIN public.v2_field_decision_evidence e ON e.field_decision_id=current_field.field_decision_id AND e.observation_id=o.id
WHERE o.field_key IN('boarding.pickup','alighting.dropoff') AND c.payload->>'operation'='route-observations/1'
 AND c.payload#>>'{target,existing,subjectId}'=l.subject_id::text
 AND c.payload#>>'{target,existing,identityKey}'=public.v2_prompt_identity(l.subject_id)
 AND (o.value->>'cityId')::integer=city.id
 AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs j WHERE j.user_id IN(c.user_id,initial.user_id));

-- View expressions call private identity helpers. The backend gets this bounded
-- read facade, never execution on the generic helper or direct view access.
CREATE FUNCTION public.v2_api_place_report_context(subject uuid) RETURNS SETOF public.v2_place_report_context
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT * FROM public.v2_place_report_context WHERE route_subject_id=subject;
$$;

CREATE FUNCTION public.v2_api_place_report_action(actor varchar,subject uuid,place uuid,action text,reason text,blocked varchar[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context public.v2_place_report_context;report integer;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor)
  OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) x WHERE x IS NULL OR length(x) NOT BETWEEN 1 AND 200 OR x~'[[:cntrl:]]') THEN RAISE EXCEPTION 'v2_safety_context_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 SELECT c.* INTO context FROM public.v2_place_report_context c JOIN public.v2_public_lead_reports p ON p.subject_id=c.route_subject_id
  WHERE c.place_ref=place AND c.route_subject_id=subject
   AND NOT c.is_hidden AND c.evidence_included AND c.field_read->>'status' IN('assessed','review_required')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c.field_read->'candidates','[]'::jsonb)) candidate WHERE candidate->'value'=c.original_value)
   AND NOT EXISTS(SELECT 1 FROM public.v2_place_report_context newer WHERE newer.route_subject_id=c.route_subject_id
    AND newer.place_author_id=c.place_author_id AND newer.field_key=c.field_key AND newer.evidence_included AND newer.field_read->>'status' IN('assessed','review_required') AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(newer.field_read->'candidates','[]'::jsonb)) admitted WHERE admitted->'value'=newer.original_value) AND (newer.submitted_at,newer.place_ref)>(c.submitted_at,c.place_ref));
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_place_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL AND EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id=context.place_author_id) THEN RETURN '{"status":"blocked"}'::jsonb;END IF;
 IF context.route_author_id=ANY(blocked) OR context.place_author_id=ANY(blocked) OR EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id IN(context.route_author_id,context.place_author_id)) THEN RAISE EXCEPTION 'v2_place_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL THEN
  IF actor=context.place_author_id THEN RAISE EXCEPTION 'v2_self_block_invalid' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM public.v2_route_report_blocks WHERE blocker_id=actor)>=200 THEN RAISE EXCEPTION 'v2_block_limit' USING ERRCODE='23514';END IF;
  INSERT INTO public.v2_route_report_blocks(blocker_id,blocked_user_id) VALUES(actor,context.place_author_id) ON CONFLICT DO NOTHING;
  RETURN '{"status":"blocked"}'::jsonb;
 ELSIF action='report' AND reason IN('spam','inaccurate','offensive','unsafe','other') THEN
  SELECT id INTO report FROM public.abuse_reports WHERE reporter_id=actor AND target_type='place_report' AND target_id=place::text AND abuse_reports.reason=v2_api_place_report_action.reason AND status='pending' ORDER BY id LIMIT 1;
  IF report IS NULL THEN INSERT INTO public.abuse_reports(reporter_id,target_type,target_id,reason) VALUES(actor,'place_report',place::text,reason);END IF;
  RETURN '{"status":"reported"}'::jsonb;
 END IF;RAISE EXCEPTION 'v2_safety_action_invalid' USING ERRCODE='23514';
END;$$;
CREATE FUNCTION public.v2_api_hide_reported_place(report integer,notes text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.abuse_reports;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO r FROM public.abuse_reports WHERE id=report FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.target_type<>'place_report' OR length(notes)>2000 THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_place_report_refs WHERE id=r.target_id::uuid) THEN RETURN false;END IF;
 INSERT INTO public.v2_place_report_hides(place_ref,report_id) VALUES(r.target_id::uuid,r.id) ON CONFLICT DO NOTHING;
 UPDATE public.abuse_reports SET status='actioned',moderator_notes=notes,reviewed_at=now() WHERE id=r.id;RETURN true;
END;$$;
DO $$DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_place_report_refs','v2_place_report_hides'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_read ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
 END LOOP;
 REVOKE ALL ON public.v2_place_report_context FROM PUBLIC,mabhazi_api;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_place_reference_created','v2_place_reference_immutable','v2_api_place_report_context','v2_api_place_report_action','v2_api_hide_reported_place') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
  FOREACH t IN ARRAY ARRAY['v2_place_report_refs','v2_place_report_hides','v2_place_report_context'] LOOP EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END LOOP;
 END IF;END LOOP;
END;$$;
GRANT EXECUTE ON FUNCTION public.v2_api_place_report_context(uuid),public.v2_api_place_report_action(varchar,uuid,uuid,text,text,varchar[]),public.v2_api_hide_reported_place(integer,text) TO mabhazi_api;
