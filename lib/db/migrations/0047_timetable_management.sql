-- Private imported timetable catalogue, exact property withdrawal and explicit replacement.
CREATE TABLE public.v2_admin_timetable_commands(
 id uuid PRIMARY KEY,actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 route_subject_id uuid REFERENCES public.v2_leads(subject_id) ON DELETE SET NULL,
 request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.v2_admin_timetable_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_admin_timetable_commands FROM PUBLIC,mabhazi_api;
CREATE FUNCTION public.v2_timetable_command_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR NEW.actor_user_id IS NULL)
 AND (NEW.route_subject_id IS NOT DISTINCT FROM OLD.route_subject_id OR NEW.route_subject_id IS NULL)
 AND to_jsonb(NEW)-ARRAY['actor_user_id','route_subject_id']=to_jsonb(OLD)-ARRAY['actor_user_id','route_subject_id'] THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'v2_timetable_command_immutable' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER timetable_command_immutable BEFORE UPDATE OR DELETE ON public.v2_admin_timetable_commands FOR EACH ROW EXECUTE FUNCTION public.v2_timetable_command_guard();
CREATE FUNCTION public.v2_timetable_review_impact(review uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_array(e.source_subject_id,p.field_key) ORDER BY e.source_subject_id,p.field_key),'[]'::jsonb)
 FROM public.v2_admin_timetable_properties p JOIN public.v2_admin_timetable_entries e ON e.run_subject_id=p.run_subject_id WHERE p.review_id=review;
$$;
CREATE FUNCTION public.v2_api_admin_timetable_records(actor varchar,cursor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(item ORDER BY source_subject_id),'[]'::jsonb),
 'hasMore',(SELECT count(*)>30 FROM public.v2_admin_timetable_entries WHERE cursor IS NULL OR source_subject_id>cursor)) INTO result
 FROM (SELECT e.source_subject_id,jsonb_build_object('routeId',e.source_subject_id,'revision',s.revision::text,'timetableId',t.id,
 'operator',CASE WHEN NOT t.erased THEN t.proposal->>'operator' END,
 'origin',origin.name,'destination',destination.name,'departure',lpad((r.departure_seconds/3600)::text,2,'0')||':'||lpad(((r.departure_seconds%3600)/60)::text,2,'0'),
 'source',CASE WHEN NOT t.erased THEN t.proposal->'source' END,'calendar',CASE WHEN NOT t.erased THEN jsonb_build_object('weekdays',t.proposal->'weekdays','validFrom',t.proposal->'validFrom','validUntil',t.proposal->'validUntil','timezone',t.proposal->'timezone') END,
 'createdAt',t.created_at,'sourceErased',t.erased,'publiclyAvailable',public.v2_timetable_discovery(e.source_subject_id) IS NOT NULL,
 'removalId',removal.id,'properties',(SELECT coalesce(jsonb_agg(jsonb_build_object('field',p.field_key,'reviewId',p.review_id,
 'caseRevision',c.revision::text,'subjectRevision',cs.revision::text,'current',public.v2_timetable_property_current(e.run_subject_id,p.field_key),'value',(SELECT o.value FROM public.v2_observations o WHERE o.id=p.observation_id),'scope',(SELECT o.scope FROM public.v2_observations o WHERE o.id=p.observation_id),'placeName',(SELECT stop.name FROM public.v2_observations o JOIN public.v2_stops stop ON stop.subject_id=CASE WHEN o.value ? 'stopId' THEN (o.value->>'stopId')::uuid END WHERE o.id=p.observation_id),
 'impact',public.v2_timetable_review_impact(p.review_id),'impactDigest',public.v2_assessment_hash(public.v2_timetable_review_impact(p.review_id)),
 'withdrawable',c.last_decision_id=p.review_id AND d.action='accept' AND NOT d.evidence_erased,
 'history',(SELECT jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'reason',h.reason_code,'at',h.created_at,'evidenceErased',h.evidence_erased) ORDER BY h.expected_revision,h.id)
 FROM public.v2_review_decisions h WHERE h.case_id=c.id)) ORDER BY p.field_key),'[]'::jsonb)
 FROM public.v2_admin_timetable_properties p JOIN public.v2_review_decisions d ON d.id=p.review_id JOIN public.v2_review_cases c ON c.id=d.case_id
 JOIN public.v2_subjects cs ON cs.id=c.subject_id WHERE p.run_subject_id=e.run_subject_id)) item
 FROM public.v2_admin_timetable_entries e JOIN public.v2_admin_timetables t ON t.id=e.timetable_id JOIN public.v2_subjects s ON s.id=e.source_subject_id
 JOIN public.v2_runs r ON r.subject_id=e.run_subject_id JOIN public.v2_leads l ON l.subject_id=e.source_subject_id
 JOIN public.v2_corridors co ON co.id=l.corridor_id JOIN public.cities origin ON origin.id=co.origin_city_id JOIN public.cities destination ON destination.id=co.destination_city_id
 LEFT JOIN public.v2_admin_active_route_removals removal ON removal.route_subject_id=e.source_subject_id
 WHERE cursor IS NULL OR e.source_subject_id>cursor ORDER BY e.source_subject_id LIMIT 30) page;
 RETURN result;
END;$$;
CREATE FUNCTION public.v2_api_admin_timetable_command_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT receipt INTO result FROM public.v2_admin_timetable_commands WHERE id=request AND actor_user_id=actor;
 RETURN coalesce(result,'{"found":false}'::jsonb);
END;$$;
CREATE FUNCTION public.v2_api_admin_timetable_command(actor varchar,request uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.v2_admin_timetable_commands;p public.v2_admin_timetable_properties;c public.v2_review_cases;s public.v2_subjects;
 route uuid;review uuid;result uuid;digest text;response jsonb;visibility jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;PERFORM public.v2_admin_require(actor);
 IF request IS NULL OR NOT coalesce(jsonb_typeof(input)='object' AND input?&ARRAY['routeId','revision','operation','reason','expiresAt']
 AND input-ARRAY['routeId','revision','operation','reason','expiresAt','field','reviewId','caseRevision','subjectRevision','impactDigest','removalId']='{}'::jsonb
 AND public.v2_json_uuid(input->'routeId') AND input->>'revision'~'^[1-9][0-9]{0,15}$' AND input->>'expiresAt'~'^[1-9][0-9]{0,15}$'
 AND input->>'operation' IN('withdraw','remove','restore'),false) THEN RAISE EXCEPTION 'v2_timetable_command_invalid' USING ERRCODE='23514';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,input-'expiresAt'));route:=(input->>'routeId')::uuid;
 SELECT * INTO prior FROM public.v2_admin_timetable_commands WHERE id=request;
 IF FOUND THEN IF prior.actor_user_id IS DISTINCT FROM actor OR prior.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_admin_request_conflict' USING ERRCODE='23514';END IF;
 RETURN prior.receipt;END IF;
 IF (input->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 OR (input->>'expiresAt')::numeric>extract(epoch FROM clock_timestamp())*1000+330000
 THEN RAISE EXCEPTION 'v2_admin_preview_expired' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_admin_timetable_entries WHERE source_subject_id=route) THEN RAISE EXCEPTION 'v2_admin_route_unavailable' USING ERRCODE='23503';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=route AND revision=(input->>'revision')::bigint) THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 IF input->>'operation'='withdraw' THEN
 IF input->>'reason' NOT IN('incorrect_information','source_outdated','duplicate','other') OR NOT public.v2_json_uuid(input->'reviewId')
 OR input->>'caseRevision'!~'^[1-9][0-9]{0,15}$' OR input->>'subjectRevision'!~'^[1-9][0-9]{0,15}$' OR input->>'impactDigest'!~'^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'v2_timetable_command_invalid' USING ERRCODE='23514';END IF;
 SELECT property.* INTO p FROM public.v2_admin_timetable_properties property JOIN public.v2_admin_timetable_entries e ON e.run_subject_id=property.run_subject_id
 WHERE e.source_subject_id=route AND property.field_key=input->>'field' AND property.review_id=(input->>'reviewId')::uuid;
 IF NOT FOUND OR p.observation_id IS NULL AND p.writer_kind<>'header' THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 IF public.v2_assessment_hash(public.v2_timetable_review_impact(p.review_id)) IS DISTINCT FROM input->>'impactDigest' THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 SELECT * INTO c FROM public.v2_review_cases WHERE id=(SELECT case_id FROM public.v2_review_decisions WHERE id=p.review_id);
 SELECT * INTO s FROM public.v2_subjects WHERE id=c.subject_id;
 IF c.last_decision_id IS DISTINCT FROM p.review_id THEN RAISE EXCEPTION 'v2_timetable_record_changed' USING ERRCODE='40001';END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid DEFERRED;
 IF p.writer_kind='creation' THEN result:=public.v2_review_transport_creation(actor,p.writer_id,(input->>'caseRevision')::bigint,(input->>'subjectRevision')::bigint,'reverse',input->>'reason',NULL,request,p.review_id);
 ELSIF p.writer_kind='edit' THEN result:=public.v2_review_transport_edit(actor,p.writer_id,(input->>'caseRevision')::bigint,(input->>'subjectRevision')::bigint,'reverse',input->>'reason',NULL,request,p.review_id);
 ELSE result:=public.v2_record_review(actor,c.id,(input->>'caseRevision')::bigint,(input->>'subjectRevision')::bigint,'reverse',input->>'reason',NULL,ARRAY[]::uuid[],'review/1',p.review_id);END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid IMMEDIATE;
 response:=jsonb_build_object('kind','timetable-command','id',request,'outcome','withdrawn','routeId',route,'field',p.field_key,'reviewId',result,'reverses',p.review_id,'impact',public.v2_timetable_review_impact(p.review_id));
 ELSE
 IF input-ARRAY['routeId','revision','operation','reason','expiresAt','removalId']<>'{}'::jsonb THEN RAISE EXCEPTION 'v2_timetable_command_invalid' USING ERRCODE='23514';END IF;
 visibility:=public.v2_api_admin_route_action(actor,request,jsonb_build_object('routeId',route,'revision',input->>'revision','operation',input->>'operation','reason',input->>'reason','expiresAt',input->'expiresAt','removalId',coalesce(input->'removalId','null'::jsonb)));
 response:=visibility||jsonb_build_object('kind','timetable-command');
 END IF;
 INSERT INTO public.v2_admin_timetable_commands(id,actor_user_id,route_subject_id,request_digest,receipt) VALUES(request,actor,route,digest,response);
 RETURN response;
END;$$;
DO $$ DECLARE f text;r text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_timetable_command_guard()','public.v2_timetable_review_impact(uuid)',
 'public.v2_api_admin_timetable_records(varchar,uuid)','public.v2_api_admin_timetable_command(varchar,uuid,jsonb)','public.v2_api_admin_timetable_command_receipt(varchar,uuid)'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.v2_admin_timetable_commands FROM %I',r);END IF;END LOOP;
END;$$;

ALTER FUNCTION public.v2_timetable_proposal_valid(jsonb) RENAME TO v2_timetable_proposal_valid_original;
CREATE FUNCTION public.v2_timetable_proposal_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb;seen text[]:='{}';BEGIN
 IF NOT public.v2_timetable_proposal_valid_original(p-'replacements') THEN RETURN false;END IF;
 IF NOT p?'replacements' THEN RETURN true;END IF;
 IF jsonb_typeof(p->'replacements')<>'array' OR jsonb_array_length(p->'replacements')>100 THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p->'replacements') LOOP
 IF NOT coalesce(jsonb_typeof(item)='object' AND item?&ARRAY['kind','id','revision'] AND item-ARRAY['kind','id','revision']='{}'::jsonb
 AND item->>'kind' IN('lead','timetable') AND public.v2_json_uuid(item->'id') AND jsonb_typeof(item->'revision')='string' AND item->>'revision'~'^[1-9][0-9]{0,15}$',false)
 OR item->>'id'=ANY(seen) THEN RETURN false;END IF;
 seen:=array_append(seen,item->>'id');END LOOP;RETURN true;
END;$$;
ALTER FUNCTION public.v2_api_admin_timetable_preview(varchar,jsonb) RENAME TO v2_timetable_preview_original;
DO $$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.v2_timetable_preview_original(varchar,jsonb)'::regprocedure);
 EXECUTE replace(definition,'LIMIT 100','LIMIT 101');
END;$$;
CREATE FUNCTION public.v2_api_admin_timetable_preview(actor varchar,p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;item jsonb;candidate jsonb;remaining jsonb:='[]';targets jsonb:='[]';subject uuid;revision bigint;
BEGIN
 PERFORM public.v2_admin_require(actor);
 IF NOT public.v2_timetable_proposal_valid(p) THEN RAISE EXCEPTION 'v2_timetable_proposal_invalid' USING ERRCODE='23514';END IF;
 result:=public.v2_timetable_preview_original(actor,p-'replacements');
 IF jsonb_array_length(result->'duplicates')>100 THEN RAISE EXCEPTION 'v2_timetable_too_many_matches' USING ERRCODE='23514';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p->'replacements','[]')) LOOP
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'duplicates') d WHERE d->>'kind'=item->>'kind' AND d->>'id'=item->>'id' AND d->>'revision'=item->>'revision')
 THEN RAISE EXCEPTION 'v2_timetable_replacement_changed' USING ERRCODE='40001';END IF;END LOOP;
 FOR candidate IN SELECT value FROM jsonb_array_elements(result->'duplicates') LOOP
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p->'replacements','[]')) d WHERE d->>'kind'=candidate->>'kind' AND d->>'id'=candidate->>'id') THEN
  subject:=CASE candidate->>'kind' WHEN 'lead' THEN (candidate->>'id')::uuid ELSE (SELECT source_subject_id FROM public.v2_admin_timetable_entries WHERE run_subject_id=(candidate->>'id')::uuid) END;
  SELECT s.revision INTO revision FROM public.v2_subjects s WHERE s.id=subject;
  IF revision IS NULL THEN RAISE EXCEPTION 'v2_timetable_replacement_changed' USING ERRCODE='40001';END IF;
  targets:=targets||jsonb_build_array(candidate||jsonb_build_object('routeId',subject,'routeRevision',revision::text));
 ELSE remaining:=remaining||jsonb_build_array(candidate);END IF;
 END LOOP;
 RETURN result||jsonb_build_object('duplicates',remaining,'replacements',targets,'stateDigest',public.v2_assessment_hash(jsonb_build_array(result->'stateDigest',targets)));
END;$$;
CREATE FUNCTION public.v2_timetable_apply_replacements(actor varchar,command uuid,preview jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target jsonb;result jsonb;BEGIN
 FOR target IN SELECT value FROM jsonb_array_elements(preview->'replacements') LOOP
 IF EXISTS(SELECT 1 FROM public.v2_admin_active_route_removals WHERE route_subject_id=(target->>'routeId')::uuid) THEN CONTINUE;END IF;
 result:=public.v2_api_admin_route_action(actor,md5(command::text||(target->>'routeId'))::uuid,jsonb_build_object('routeId',target->'routeId','revision',target->>'routeRevision',
 'operation','remove','reason','duplicate','expiresAt',floor(extract(epoch FROM clock_timestamp())*1000)+300000,'removalId',NULL));
 IF result->>'outcome'<>'removed' THEN RAISE EXCEPTION 'v2_timetable_replacement_changed' USING ERRCODE='40001';END IF;
 END LOOP;
END;$$;
DO $$ DECLARE definition text;anchor text:=E' END LOOP;\n RETURN public.v2_api_admin_timetable_receipt(actor,request);';BEGIN
 definition:=pg_get_functiondef('public.v2_api_admin_timetable_action(varchar,uuid,jsonb)'::regprocedure);
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'timetable_action_baseline_changed';END IF;
 EXECUTE replace(definition,anchor,E' END LOOP;\n PERFORM public.v2_timetable_apply_replacements(actor,request,preview);\n RETURN public.v2_api_admin_timetable_receipt(actor,request);');
END;$$;
DO $$ DECLARE f text;r text;BEGIN
 FOREACH f IN ARRAY ARRAY['public.v2_timetable_proposal_valid(jsonb)','public.v2_timetable_proposal_valid_original(jsonb)',
 'public.v2_timetable_preview_original(varchar,jsonb)','public.v2_api_admin_timetable_preview(varchar,jsonb)','public.v2_timetable_apply_replacements(varchar,uuid,jsonb)'] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END;$$;

CREATE OR REPLACE FUNCTION public.v2_api_admin_timetable_receipt(actor varchar,request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.v2_admin_require(actor);
 SELECT jsonb_build_object('kind','timetable','id',t.id,'outcome','approved','actorErased',t.actor_user_id IS NULL,'sourceErased',t.erased,'createdAt',t.created_at,
  'replacedRecords',coalesce(t.proposal->'replacements','[]'::jsonb),'departureCount',(SELECT count(*) FROM public.v2_admin_timetable_entries e WHERE e.timetable_id=t.id),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('runId',e.run_subject_id,'ordinal',e.ordinal,
   'properties',(SELECT jsonb_agg(jsonb_build_object('field',p.field_key,'reviewId',p.review_id,'sourceErased',p.contribution_id IS NULL OR (p.writer_kind<>'header' AND p.observation_id IS NULL)) ORDER BY p.field_key)
    FROM public.v2_admin_timetable_properties p WHERE p.run_subject_id=e.run_subject_id)) ORDER BY e.ordinal)
   FROM public.v2_admin_timetable_entries e WHERE e.timetable_id=t.id),'[]'::jsonb)) INTO result
  FROM public.v2_admin_timetables t WHERE t.id=request;
 RETURN COALESCE(result,'{"found":false}'::jsonb);
END;$$;
