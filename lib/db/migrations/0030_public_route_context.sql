-- Public initial-report discovery and contextual intake share this private projection.
-- No raw author/evidence fields are exposed by the HTTP serializer.
CREATE TABLE public.v2_route_report_blocks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),blocker_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 blocked_user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(blocker_id,blocked_user_id),CHECK(blocker_id<>blocked_user_id));
CREATE INDEX v2_route_report_block_author_idx ON public.v2_route_report_blocks(blocked_user_id);
CREATE TABLE public.v2_public_lead_hides(
 subject_id uuid PRIMARY KEY REFERENCES public.v2_leads(subject_id) ON DELETE CASCADE,
 report_id integer NOT NULL REFERENCES public.abuse_reports(id),hidden_at timestamptz NOT NULL DEFAULT now());
CREATE VIEW public.v2_public_lead_reports AS SELECT l.subject_id,s.revision,c.user_id AS author_user_id,corridor.origin_city_id,corridor.destination_city_id,
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
 AND NOT EXISTS(SELECT 1 FROM public.v2_public_lead_hides h WHERE h.subject_id=l.subject_id);
CREATE FUNCTION public.v2_api_submit_public_actual_journey(actor varchar,required_terms text,request jsonb,blocked varchar[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;intent jsonb;prior boolean;input jsonb:=request;item_index integer:=0;amount text;
BEGIN
 IF actor IS NULL OR required_terms IS NULL THEN RAISE EXCEPTION 'v2_intake_actor_or_terms_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND terms_accepted_version=required_terms AND terms_accepted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'v2_intake_terms_required' USING ERRCODE='42501';END IF;
 IF NOT COALESCE(jsonb_typeof(request)='object' AND public.v2_json_uuid(request->'clientSubmissionId')
  AND jsonb_typeof(request->'observations')='array',false) OR octet_length(request::text)>65536 THEN
  RAISE EXCEPTION 'v2_intake_request_invalid' USING ERRCODE='23514';END IF;
 IF jsonb_array_length(request->'observations') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'v2_intake_observation_limit' USING ERRCODE='23514';END IF;
 -- Normalize decimal scale only, without numeric rounding or copying header context.
 FOR item IN SELECT value FROM jsonb_array_elements(request->'observations') LOOP
  IF item->>'fieldKey' IN('fare.paid','fare.quoted','fare.advertised') THEN
   amount:=item->'value'->>'amount';
   IF amount ~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' AND jsonb_typeof(item->'value'->'amount')='string' THEN
    -- Validate original precision before removing zeros (JPY 1.00 is still invalid).
    IF public.v2_currency_minor_units(item->'value'->>'currency') IS NULL
      OR length(split_part(amount,'.',2))>least(public.v2_currency_minor_units(item->'value'->>'currency'),2) THEN
     RAISE EXCEPTION 'v2_actual_fare_precision_invalid' USING ERRCODE='23514';END IF;
    IF strpos(amount,'.')>0 THEN amount:=rtrim(rtrim(amount,'0'),'.');END IF;
    input:=jsonb_set(input,ARRAY['observations',item_index::text,'value','amount'],to_jsonb(amount));
   END IF;
  END IF;
  item_index:=item_index+1;
 END LOOP;
 SELECT EXISTS(SELECT 1 FROM public.v2_receipts WHERE user_id=actor AND client_submission_id=(request->>'clientSubmissionId')::uuid) INTO prior;
 -- Historical receipt replay is validated by the constructor before fresh references.
 IF prior THEN RETURN public.v2_submit_actual_journey(actor,required_terms,input);END IF;
 IF request->>'entrySurface' IS NULL OR request->>'entrySurface' NOT IN('search_result','route_detail')
  OR blocked IS NULL OR cardinality(blocked)>200 OR EXISTS(SELECT 1 FROM unnest(blocked) b WHERE b IS NULL OR length(b) NOT BETWEEN 1 AND 200) THEN
  RAISE EXCEPTION 'v2_actual_capability_only' USING ERRCODE='23514';END IF;
 intent:=request->'target'->'newActualJourney'->'intendedSubject';
 IF intent IS NULL OR intent='null'::jsonb THEN RAISE EXCEPTION 'v2_actual_target_unavailable' USING ERRCODE='42501';END IF;
 IF intent IS NOT NULL AND intent<>'null'::jsonb THEN
  IF intent->>'kind' IS DISTINCT FROM 'lead' OR NOT public.v2_json_uuid(intent->'id') OR NOT EXISTS(
   SELECT 1 FROM public.v2_public_lead_reports p
   WHERE p.subject_id=(intent->>'id')::uuid AND NOT(p.author_user_id=ANY(blocked))
    AND NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks b WHERE b.blocker_id=actor AND b.blocked_user_id=p.author_user_id)) THEN
   RAISE EXCEPTION 'v2_actual_target_unavailable' USING ERRCODE='42501';END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(input->'observations') LOOP
  IF item->>'fieldKey' NOT IN('departure.actual','arrival.actual','operator.reported','boarding.pickup','alighting.dropoff','fare.paid','fare.quoted','fare.advertised')
   OR item->>'fieldKey' IS NULL
   OR item->>'fieldKey'='operator.reported' AND NOT COALESCE(item->'value' ? 'name',false)
   OR item->>'fieldKey' IN('boarding.pickup','alighting.dropoff') AND NOT COALESCE(item->'value' ? 'cityId',false)
   OR item->>'fieldKey' LIKE 'fare.%' AND item->'scope'->'segment'->>'kind' IS DISTINCT FROM 'city_pair' THEN
   RAISE EXCEPTION 'v2_actual_capability_only' USING ERRCODE='23514';END IF;
 END LOOP;
 RETURN public.v2_submit_actual_journey(actor,required_terms,input);
END;$$;
CREATE FUNCTION public.v2_api_route_report_action(actor varchar,subject uuid,action text,reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE author_id varchar;report integer;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM 1 FROM public.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 SELECT author_user_id INTO author_id FROM public.v2_public_lead_reports WHERE subject_id=subject;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_actual_target_unavailable' USING ERRCODE='42501';END IF;
 IF action='block' AND reason IS NULL THEN
  IF author_id=actor THEN RAISE EXCEPTION 'v2_self_block_invalid' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.v2_route_report_blocks WHERE blocker_id=actor AND blocked_user_id=author_id)
    AND (SELECT count(*) FROM public.v2_route_report_blocks WHERE blocker_id=actor)>=200 THEN RAISE EXCEPTION 'v2_block_limit' USING ERRCODE='23514';END IF;
  INSERT INTO public.v2_route_report_blocks(blocker_id,blocked_user_id) VALUES(actor,author_id) ON CONFLICT(blocker_id,blocked_user_id) DO NOTHING;
  RETURN '{"status":"blocked"}'::jsonb;
 ELSIF action='report' AND reason IN('spam','inaccurate','offensive','unsafe','other') THEN
  SELECT id INTO report FROM public.abuse_reports WHERE reporter_id=actor AND target_type='transport_subject' AND target_id=subject::text AND abuse_reports.reason=v2_api_route_report_action.reason AND status='pending' ORDER BY id LIMIT 1;
  IF report IS NULL THEN INSERT INTO public.abuse_reports(reporter_id,target_type,target_id,reason) VALUES(actor,'transport_subject',subject::text,reason);END IF;
  RETURN '{"status":"reported"}'::jsonb;
 END IF;
 RAISE EXCEPTION 'v2_safety_action_invalid' USING ERRCODE='23514';
END;$$;
CREATE FUNCTION public.v2_api_unblock_route_report_author(actor varchar,block_ref uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN RAISE EXCEPTION 'v2_intake_account_missing' USING ERRCODE='23503';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 DELETE FROM public.v2_route_report_blocks WHERE id=block_ref AND blocker_id=actor;RETURN true;
END;$$;
CREATE FUNCTION public.v2_api_hide_reported_lead(report integer,notes text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.abuse_reports;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO r FROM public.abuse_reports WHERE id=report FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.target_type<>'transport_subject' OR length(notes)>2000 THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=r.target_id::uuid) THEN RETURN false;END IF;
 INSERT INTO public.v2_public_lead_hides(subject_id,report_id) VALUES(r.target_id::uuid,r.id) ON CONFLICT(subject_id) DO NOTHING;
 UPDATE public.abuse_reports SET status='actioned',moderator_notes=notes,reviewed_at=now() WHERE id=r.id;RETURN true;
END;$$;
DO $$DECLARE t text;f text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_route_report_blocks','v2_public_lead_hides'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_read ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
 END LOOP;
 REVOKE ALL ON public.v2_public_lead_reports FROM PUBLIC,mabhazi_api;
 GRANT SELECT ON public.v2_public_lead_reports TO mabhazi_api;
 FOREACH f IN ARRAY ARRAY['public.v2_api_submit_public_actual_journey(varchar,text,jsonb,varchar[])','public.v2_api_route_report_action(varchar,uuid,text,text)','public.v2_api_unblock_route_report_author(varchar,uuid)','public.v2_api_hide_reported_lead(integer,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;
  END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   FOREACH t IN ARRAY ARRAY['v2_public_lead_reports','v2_route_report_blocks','v2_public_lead_hides'] LOOP EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END LOOP;
  END IF;
 END LOOP;
END;$$;
