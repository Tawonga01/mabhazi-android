-- Public-account actual reports through a bounded server facade, not direct SQL clients.
-- No public canonical-subject catalogue exists yet: intentions are owned leads only.
CREATE FUNCTION public.v2_api_submit_actual_journey(actor varchar,required_terms text,request jsonb)
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
 intent:=request->'target'->'newActualJourney'->'intendedSubject';
 IF intent IS NOT NULL AND intent<>'null'::jsonb THEN
  IF intent->>'kind' IS DISTINCT FROM 'lead' OR NOT public.v2_json_uuid(intent->'id') OR NOT EXISTS(
   SELECT 1 FROM public.v2_leads l JOIN public.v2_contributions c ON c.id=l.initial_contribution_id
    JOIN public.v2_subjects s ON s.id=l.subject_id
   WHERE l.subject_id=(intent->>'id')::uuid AND c.user_id=actor AND l.intake_kind='community'
    AND NOT l.attribution_erased AND s.lifecycle='active') THEN
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
REVOKE ALL ON FUNCTION public.v2_api_submit_actual_journey(varchar,text,jsonb) FROM PUBLIC,mabhazi_api;
DO $$DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.v2_api_submit_actual_journey(varchar,text,jsonb) FROM %I',r);
  END IF;
 END LOOP;
END;$$;
GRANT EXECUTE ON FUNCTION public.v2_api_submit_actual_journey(varchar,text,jsonb) TO mabhazi_api;

