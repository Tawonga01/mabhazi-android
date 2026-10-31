-- Named administrative batch receipts. Existing typed review/field decisions
-- remain authoritative; this layer orchestrates them without copying evidence.
CREATE TABLE public.v2_admin_batches(
 id uuid PRIMARY KEY,actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 request_digest text,operation text NOT NULL CHECK(operation IN('approve','reverse')),
 reason_code text NOT NULL CHECK(reason_code IN('reports_reviewed','evidence_checked','operator_checked','decision_incorrect','evidence_changed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((actor_user_id IS NULL AND request_digest IS NULL) OR (actor_user_id IS NOT NULL AND request_digest~'^[0-9a-f]{64}$'))
);
CREATE TABLE public.v2_admin_batch_items(
 batch_id uuid NOT NULL REFERENCES public.v2_admin_batches(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 1999),
 route_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),
 field_key text NOT NULL,contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 review_id uuid REFERENCES public.v2_review_decisions(id),
 outcome text NOT NULL CHECK(outcome IN('approved','reversed','held','changed','already_reviewed','newer_decision_kept')),
 detail text NOT NULL CHECK(detail IN('saved','source_changed','needs_context','already_reviewed','newer_decision','erased')),
 PRIMARY KEY(batch_id,ordinal)
);
CREATE INDEX v2_admin_items_review_idx ON public.v2_admin_batch_items(review_id);
CREATE INDEX v2_admin_items_contribution_idx ON public.v2_admin_batch_items(contribution_id);
CREATE INDEX v2_admin_items_observation_idx ON public.v2_admin_batch_items(observation_id);
-- Core endpoints are assertions in an immutable initial contribution, not
-- manufactured transport observations. Their review thread binds that source.
CREATE TABLE public.v2_admin_core_threads(
 route_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),
 field_key text NOT NULL CHECK(field_key IN('route.origin','route.destination')),
 case_id uuid NOT NULL UNIQUE REFERENCES public.v2_review_cases(id),
 contribution_id uuid REFERENCES public.v2_contributions(id) ON DELETE SET NULL,
 PRIMARY KEY(route_subject_id,field_key)
);

CREATE FUNCTION public.v2_admin_require(actor varchar) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users u JOIN public.v2_review_roles r ON r.user_id=u.id
  WHERE u.id=actor AND r.role='administrator' AND r.revoked_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs d WHERE d.user_id=u.id))
 THEN RAISE EXCEPTION 'v2_admin_required' USING ERRCODE='42501';END IF;
END;$$;
CREATE FUNCTION public.v2_admin_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
  IF TG_TABLE_NAME='v2_admin_batches' AND OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
   AND to_jsonb(NEW)-ARRAY['actor_user_id','request_digest']=to_jsonb(OLD)-ARRAY['actor_user_id','request_digest']
   THEN NEW.request_digest:=NULL;RETURN NEW;
  ELSIF TG_TABLE_NAME='v2_admin_batch_items'
   AND (NEW.observation_id IS NOT DISTINCT FROM OLD.observation_id OR NEW.observation_id IS NULL)
   AND (NEW.contribution_id IS NOT DISTINCT FROM OLD.contribution_id OR NEW.contribution_id IS NULL)
   AND to_jsonb(NEW)-ARRAY['observation_id','contribution_id']=to_jsonb(OLD)-ARRAY['observation_id','contribution_id']
   THEN RETURN NEW;
  ELSIF TG_TABLE_NAME='v2_admin_core_threads' AND NEW.contribution_id IS NULL
   AND to_jsonb(NEW)-'contribution_id'=to_jsonb(OLD)-'contribution_id' THEN RETURN NEW;
  END IF;
 END IF;
 RAISE EXCEPTION 'v2_admin_history_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER v2_admin_history BEFORE UPDATE OR DELETE ON public.v2_admin_batches FOR EACH ROW EXECUTE FUNCTION public.v2_admin_history_guard();
CREATE TRIGGER v2_admin_history BEFORE UPDATE OR DELETE ON public.v2_admin_batch_items FOR EACH ROW EXECUTE FUNCTION public.v2_admin_history_guard();
CREATE TRIGGER v2_admin_history BEFORE UPDATE OR DELETE ON public.v2_admin_core_threads FOR EACH ROW EXECUTE FUNCTION public.v2_admin_history_guard();

CREATE FUNCTION public.v2_api_admin_batch_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('id',b.id,'operation',b.operation,'reason',b.reason_code,'createdAt',b.created_at,
  'actorErased',b.actor_user_id IS NULL,'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'ordinal',i.ordinal,'routeId',i.route_subject_id,'fieldKey',i.field_key,'observationId',i.observation_id,
   'reviewId',i.review_id,'outcome',i.outcome,'detail',CASE WHEN i.contribution_id IS NULL THEN 'erased' ELSE i.detail END)
   ORDER BY i.ordinal) FROM public.v2_admin_batch_items i WHERE i.batch_id=b.id),'[]'::jsonb))
 INTO result FROM public.v2_admin_batches b WHERE b.id=request;
 RETURN COALESCE(result,'{"found":false}'::jsonb);
END;$$;

CREATE FUNCTION public.v2_api_admin_property_batch(actor varchar,request uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_admin_batches;digest text;item jsonb;idx integer:=0;subject uuid;route uuid;contribution uuid;observation uuid;
 field text;operation text;reason text;expected bigint;subject_revisions jsonb:='{}';review uuid;old_review uuid;
 observation_row public.v2_observations;thread public.v2_admin_core_threads;review_case public.v2_review_cases;
 result text;detail text;evidence uuid[];stored_revision bigint;
BEGIN
 -- Serialize authority changes, evidence/identity writers and this batch in the
 -- existing transport guard. A later role revocation cannot race a child save.
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 PERFORM public.v2_admin_require(actor);
 IF request IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' OR input-ARRAY['operation','reason','items']<>'{}'::jsonb
  OR NOT input?&ARRAY['operation','reason','items'] OR jsonb_typeof(input->'items')<>'array'
  OR jsonb_array_length(input->'items') NOT BETWEEN 1 AND 2000
  OR COALESCE(input->>'operation','') NOT IN('approve','reverse') OR COALESCE(input->>'reason','') NOT IN('reports_reviewed','evidence_checked','operator_checked','decision_incorrect','evidence_changed')
  THEN RAISE EXCEPTION 'v2_admin_request_invalid' USING ERRCODE='23514';END IF;
 operation:=input->>'operation';reason:=input->>'reason';digest:=public.v2_assessment_hash(jsonb_build_array(actor,input));
 SELECT * INTO prior FROM public.v2_admin_batches WHERE id=request;
 IF FOUND THEN
  IF prior.actor_user_id IS DISTINCT FROM actor OR prior.request_digest IS DISTINCT FROM digest
   THEN RAISE EXCEPTION 'v2_admin_request_conflict' USING ERRCODE='23514';END IF;
  RETURN public.v2_api_admin_batch_receipt(actor,request);
 END IF;
 IF (SELECT count(DISTINCT x->>'routeId') FROM jsonb_array_elements(input->'items') x)>100
  OR (SELECT count(*) FROM jsonb_array_elements(input->'items'))<>(SELECT count(DISTINCT jsonb_build_array(x->'routeId',x->'fieldKey',x->'observationId')) FROM jsonb_array_elements(input->'items') x)
  THEN RAISE EXCEPTION 'v2_admin_request_invalid' USING ERRCODE='23514';END IF;
 -- Freeze the baseline vector before the first child advances a subject. Own
 -- changes in this batch must not masquerade as concurrent edits to later items.
 FOR item IN SELECT value FROM jsonb_array_elements(input->'items') LOOP
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['routeId','subjectId','contributionId','observationId','fieldKey','subjectRevision','observationRevision','targetRevision','assessmentId','caseRevision','reviewId']<>'{}'::jsonb
   OR NOT item?&ARRAY['routeId','subjectId','contributionId','fieldKey','subjectRevision']
   OR COALESCE(item->>'subjectRevision','')!~'^[1-9][0-9]{0,15}$'
   THEN RAISE EXCEPTION 'v2_admin_request_invalid' USING ERRCODE='23514';END IF;
  subject:=(item->>'subjectId')::uuid;
  IF NOT subject_revisions?subject::text THEN
   SELECT revision INTO stored_revision FROM public.v2_subjects WHERE id=subject FOR UPDATE;
   subject_revisions:=subject_revisions||jsonb_build_object(subject::text,stored_revision);
  END IF;
 END LOOP;
 INSERT INTO public.v2_admin_batches VALUES(request,actor,digest,operation,reason,now());
 FOR item IN SELECT value FROM jsonb_array_elements(input->'items') LOOP
  route:=(item->>'routeId')::uuid;subject:=(item->>'subjectId')::uuid;contribution:=(item->>'contributionId')::uuid;
  observation:=(item->>'observationId')::uuid;field:=item->>'fieldKey';expected:=(item->>'subjectRevision')::bigint;
  review:=NULL;result:='changed';detail:='source_changed';
  IF (subject_revisions->>subject::text)::bigint IS NOT DISTINCT FROM expected
   AND EXISTS(SELECT 1 FROM public.v2_leads l JOIN public.v2_subjects s ON s.id=l.subject_id AND s.lifecycle='active'
    JOIN public.v2_contributions initial ON initial.id=l.initial_contribution_id JOIN public.users u ON u.id=initial.user_id
    WHERE l.subject_id=route AND l.intake_kind='community' AND NOT l.attribution_erased
    AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=u.id))
   AND EXISTS(SELECT 1 FROM public.v2_contributions c JOIN public.users u ON u.id=c.user_id
    WHERE c.id=contribution AND c.original_subject_id=subject AND NOT EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=u.id)) THEN
   BEGIN
    IF operation='reverse' THEN
     old_review:=(item->>'reviewId')::uuid;
     SELECT c.* INTO review_case FROM public.v2_review_decisions d JOIN public.v2_review_cases c ON c.id=d.case_id
      WHERE d.id=old_review AND c.subject_id=subject AND NOT d.evidence_erased
       AND EXISTS(SELECT 1 FROM public.v2_admin_batch_items i WHERE i.review_id=d.id AND i.route_subject_id=route AND i.field_key=field
        AND i.contribution_id=contribution AND i.observation_id IS NOT DISTINCT FROM observation AND i.outcome='approved');
     IF NOT FOUND OR review_case.last_decision_id IS DISTINCT FROM old_review THEN result:='newer_decision_kept';detail:='newer_decision';
     ELSIF review_case.revision IS DISTINCT FROM (item->>'caseRevision')::bigint THEN result:='changed';
     ELSE
      review:=public.v2_record_review(actor,review_case.id,review_case.revision,(SELECT revision FROM public.v2_subjects WHERE id=subject),
       'reverse',reason,NULL,ARRAY[]::uuid[],'evidence/1',old_review);
      result:='reversed';detail:='saved';
     END IF;
    ELSIF observation IS NULL AND field IN('route.origin','route.destination') AND subject=route
     AND EXISTS(SELECT 1 FROM public.v2_leads l JOIN public.v2_contributions c ON c.id=l.initial_contribution_id
      JOIN public.cities city ON city.id=CASE WHEN (c.payload#>>ARRAY['target','newLead',CASE field WHEN 'route.origin' THEN 'originCityId' ELSE 'destinationCityId' END])~'^[1-9][0-9]{0,8}$'
       THEN (c.payload#>>ARRAY['target','newLead',CASE field WHEN 'route.origin' THEN 'originCityId' ELSE 'destinationCityId' END])::integer END
      WHERE l.subject_id=route AND l.initial_contribution_id=contribution) THEN
     SELECT * INTO thread FROM public.v2_admin_core_threads WHERE route_subject_id=route AND field_key=field;
     IF thread.case_id IS NULL THEN
      IF (item->>'caseRevision')::bigint IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'v2_admin_source_changed' USING ERRCODE='40001';END IF;
      thread.case_id:=public.v2_open_review_case(actor,route,'identity');
      INSERT INTO public.v2_admin_core_threads VALUES(route,field,thread.case_id,contribution);
     END IF;
     SELECT * INTO review_case FROM public.v2_review_cases WHERE id=thread.case_id;
     IF review_case.state='resolved' THEN result:='already_reviewed';detail:='already_reviewed';
     ELSE
      IF review_case.revision IS DISTINCT FROM (CASE WHEN (item->>'caseRevision')::bigint=0 THEN 1::bigint ELSE (item->>'caseRevision')::bigint END)
       THEN RAISE EXCEPTION 'v2_admin_source_changed' USING ERRCODE='40001';END IF;
      SELECT array_agg(o.id ORDER BY o.id) INTO evidence FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id AND s.status='active'
       WHERE o.contribution_id=contribution AND o.original_subject_id=route;
      review:=public.v2_record_review(actor,review_case.id,review_case.revision,(SELECT revision FROM public.v2_subjects WHERE id=subject),
       'accept',reason,NULL,evidence,'evidence/1');result:='approved';detail:='saved';
     END IF;
    ELSE
     SELECT o.* INTO observation_row FROM public.v2_observations o JOIN public.v2_observation_states s ON s.observation_id=o.id AND s.status='active'
      JOIN public.v2_observation_targets t ON t.observation_id=o.id AND t.assignment_id IS NULL
      WHERE o.id=observation AND o.original_subject_id=subject AND o.contribution_id=contribution AND o.field_key=field
      AND s.revision=(item->>'observationRevision')::bigint AND t.revision=(item->>'targetRevision')::bigint
      AND (subject=route OR EXISTS(SELECT 1 FROM public.v2_actual_journeys a WHERE a.subject_id=subject
       AND a.intended_subject_id=route AND a.intended_subject_kind='lead' AND a.matched_run_subject_id IS NULL));
     IF FOUND AND EXISTS(SELECT 1 FROM public.v2_current_fields cf JOIN public.v2_field_decisions d ON d.id=cf.field_decision_id
      WHERE cf.subject_id=subject AND cf.field_key=field AND cf.scope_key=observation_row.scope_key
      AND d.assessment_id=(item->>'assessmentId')::uuid AND NOT d.invalidated AND NOT d.erased) THEN
      review:=public.v2_resolve_field(actor,(item->>'assessmentId')::uuid,(item->>'caseRevision')::bigint,
       (SELECT revision FROM public.v2_subjects WHERE id=subject),observation,ARRAY[]::uuid[],'accept',reason,NULL,gen_random_uuid());
      result:='approved';detail:='saved';
     ELSE result:='held';detail:='needs_context';END IF;
    END IF;
   EXCEPTION WHEN serialization_failure THEN result:='changed';detail:='source_changed';review:=NULL;
    WHEN check_violation THEN
     IF SQLERRM IN('v2_field_choice_requires_uncontested_live_evidence','v2_review_case_requires_reopening','v2_review_evidence_missing_hidden_or_duplicate','v2_review_evidence_required')
      THEN result:='held';detail:='needs_context';review:=NULL;ELSE RAISE;END IF;
   END;
  END IF;
  INSERT INTO public.v2_admin_batch_items VALUES(request,idx,route,field,
   CASE WHEN EXISTS(SELECT 1 FROM public.v2_contributions WHERE id=contribution) THEN contribution END,
   CASE WHEN EXISTS(SELECT 1 FROM public.v2_observations WHERE id=observation) THEN observation END,
   review,result,detail);idx:=idx+1;
 END LOOP;
 RETURN public.v2_api_admin_batch_receipt(actor,request);
END;$$;

DO $$DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_admin_batches','v2_admin_batch_items','v2_admin_core_threads'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO mabhazi_api USING(true)',t||'_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('v2_admin_require','v2_admin_history_guard','v2_api_admin_batch_receipt','v2_api_admin_property_batch') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  IF f.proname LIKE 'v2_api_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mabhazi_api',f.signature);END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;
