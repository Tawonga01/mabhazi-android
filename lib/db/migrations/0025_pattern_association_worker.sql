-- Private deterministic proposals; no identity acceptance/publication here.
CREATE FUNCTION public.v2_pattern_context(subject uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb; refs uuid[];
BEGIN
 SELECT jsonb_build_object('id',s.id,'revision',s.revision,'generation',s.input_generation,
  'route',p.route_subject_id,'operator',r.operator_subject_id,'corridor',p.corridor_id,
  'origin',c.origin_city_id,'destination',c.destination_city_id,'version',v.version,'complete',v.stops_complete,
  'stops',COALESCE((SELECT jsonb_agg(jsonb_build_object('sequence',ps.sequence,'id',ps.stop_subject_id,'pickup',ps.pickup,'dropoff',ps.dropoff) ORDER BY ps.sequence)
   FROM public.v2_pattern_stops ps WHERE ps.pattern_subject_id=p.subject_id AND ps.pattern_version=v.version),'[]'::jsonb))
 INTO result FROM public.v2_subjects s JOIN public.v2_patterns p ON p.subject_id=s.id
 JOIN public.v2_pattern_versions v ON v.pattern_subject_id=p.subject_id AND v.version=p.current_pattern_version AND v.sealed
 JOIN public.v2_routes r ON r.subject_id=p.route_subject_id JOIN public.v2_subjects rs ON rs.id=r.subject_id AND rs.lifecycle='active'
 JOIN public.v2_subjects os ON os.id=r.operator_subject_id AND os.lifecycle='active'
 JOIN public.v2_corridors c ON c.id=p.corridor_id WHERE s.id=subject AND s.lifecycle='active';
 IF result IS NULL THEN RETURN NULL; END IF;
 IF jsonb_array_length(result->'stops')>500 THEN RAISE EXCEPTION 'pattern_contract_size_exceeded' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(result->'stops')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'stops') e
  JOIN public.v2_subjects s ON s.id=(e->>'id')::uuid WHERE s.lifecycle<>'active') THEN RETURN NULL; END IF;
 refs:=ARRAY[subject,(result->>'route')::uuid,(result->>'operator')::uuid]||ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(result->'stops') e);
 -- Erased/stale reviewed origins cannot be reconstructed from retained rows.
 IF EXISTS(SELECT 1 FROM public.v2_transport_creation_origins o WHERE o.subject_id=ANY(refs)
  AND public.v2_read_created_subject(o.subject_id)->>'status' IS DISTINCT FROM 'reviewed_origin') THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_transport_edit_heads h WHERE h.subject_id=ANY(refs)
  AND public.v2_read_transport(h.subject_id)->>'status' IS DISTINCT FROM 'reviewed') THEN RETURN NULL; END IF;
 RETURN result;
END; $$;

CREATE FUNCTION public.v2_pattern_input_evidence(subject uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH refs(id) AS (
  SELECT subject UNION SELECT route_subject_id FROM public.v2_patterns WHERE subject_id=subject
  UNION SELECT r.operator_subject_id FROM public.v2_patterns p JOIN public.v2_routes r ON r.subject_id=p.route_subject_id WHERE p.subject_id=subject
  UNION SELECT ps.stop_subject_id FROM public.v2_patterns p JOIN public.v2_pattern_stops ps
   ON ps.pattern_subject_id=p.subject_id AND ps.pattern_version=p.current_pattern_version WHERE p.subject_id=subject
 ), evidence(id) AS (
  SELECT o.id FROM public.v2_observations o WHERE o.original_subject_id=subject AND o.field_key='pattern.stops' AND public.v2_observation_subject(o.id)=subject
  UNION SELECT p.observation_id FROM public.v2_transport_creation_origins r JOIN public.v2_transport_creations p ON p.id=r.creation_id WHERE r.subject_id IN(SELECT id FROM refs) AND NOT p.erased
  UNION SELECT e.observation_id FROM public.v2_transport_edit_heads h JOIN public.v2_transport_edits e ON e.id=h.edit_id WHERE h.subject_id IN(SELECT id FROM refs) AND NOT e.erased
  UNION SELECT e.observation_id FROM public.v2_patterns p JOIN public.v2_pattern_version_origins r ON r.pattern_subject_id=p.subject_id AND r.pattern_version=p.current_pattern_version
   JOIN public.v2_transport_edits e ON e.id=r.edit_id WHERE p.subject_id=subject AND NOT e.erased
 ) SELECT COALESCE(array_agg(o.id ORDER BY o.id),'{}'::uuid[]) FROM evidence e JOIN public.v2_observations o ON o.id=e.id
 JOIN public.v2_observation_states s ON s.observation_id=o.id AND s.status='active';
$$;

-- Stable keys and one lookahead result allow arbitrarily many endpoint windows
-- without materialising an exponential set of internal subsequence embeddings.
CREATE FUNCTION public.v2_pattern_candidate_page(first uuid,second uuid,after_key text DEFAULT NULL,page_limit integer DEFAULT 51) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE a jsonb; b jsonb; long_context jsonb; short_context jsonb; result jsonb:='[]'; key text;
 ids_a uuid[]; ids_b uuid[]; long_ids uuid[]; short_ids uuid[]; reasons text[]; relation_name text;
 complete boolean; known_permissions boolean; permissions_equal boolean; permission_conflict boolean; valid boolean;
 from_id uuid; to_id uuid; start_pos integer; end_pos integer; position integer; previous_position integer; gap boolean;
BEGIN
 IF first IS NULL OR second IS NULL OR first=second OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 51
  OR (after_key IS NOT NULL AND after_key !~ '^(00|09|10|20:[0-9]{4}:[0-9]{4})$') THEN RAISE EXCEPTION 'pattern_page_invalid' USING ERRCODE='23514'; END IF;
 a:=public.v2_pattern_context(LEAST(first,second));b:=public.v2_pattern_context(GREATEST(first,second));
 IF a IS NULL OR b IS NULL THEN RETURN '[]'::jsonb; END IF;
 from_id:=(a->>'id')::uuid;to_id:=(b->>'id')::uuid;
 ids_a:=ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(a->'stops') e);
 ids_b:=ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(b->'stops') e);
 IF a->>'corridor'=b->>'corridor' THEN
  key:='00';reasons:=ARRAY['directed_corridor_equal','corridor_grouping_only','identity_review_required'];
  IF a->>'operator'<>b->>'operator' THEN reasons:=array_append(reasons,'known_operators_differ');
  ELSIF a->>'route'<>b->>'route' THEN reasons:=array_append(reasons,'route_identity_different'); END IF;
  IF NOT (a->>'complete')::boolean OR NOT (b->>'complete')::boolean THEN reasons:=array_append(reasons,'stop_list_incomplete'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements((a->'stops')||(b->'stops')) e WHERE e->>'pickup'='unknown' OR e->>'dropoff'='unknown') THEN reasons:=array_append(reasons,'permissions_incomplete'); END IF;
  IF after_key IS NULL OR key>after_key THEN result:=result||jsonb_build_array(jsonb_build_object('key',key,'from',from_id,'to',to_id,'relation','same_corridor','reasons',reasons)); END IF;
  IF jsonb_array_length(result)>=page_limit THEN RETURN result; END IF;
 END IF;
 IF a->>'operator'<>b->>'operator' OR a->>'route'<>b->>'route'
  OR (a->>'origin'=b->>'destination' AND a->>'destination'=b->>'origin') THEN RETURN result; END IF;
 complete:=(a->>'complete')::boolean AND (b->>'complete')::boolean;
 IF complete THEN
  SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'stops') e WHERE e->>'pickup'='unknown' OR e->>'dropoff'='unknown')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'stops') e WHERE e->>'pickup'='unknown' OR e->>'dropoff'='unknown') INTO known_permissions;
  SELECT COALESCE(bool_and(x.e->>'pickup'=y.e->>'pickup' AND x.e->>'dropoff'=y.e->>'dropoff'),false),
   COALESCE(bool_or((x.e->>'pickup'<>'unknown' AND y.e->>'pickup'<>'unknown' AND x.e->>'pickup'<>y.e->>'pickup')
    OR (x.e->>'dropoff'<>'unknown' AND y.e->>'dropoff'<>'unknown' AND x.e->>'dropoff'<>y.e->>'dropoff')),false)
   INTO permissions_equal,permission_conflict FROM jsonb_array_elements(a->'stops') WITH ORDINALITY x(e,n)
   JOIN jsonb_array_elements(b->'stops') WITH ORDINALITY y(e,n) USING(n);
  relation_name:=NULL;reasons:=ARRAY['known_operator_equal','route_identity_equal','complete_stop_lists','identity_review_required'];
  IF ids_a=ids_b AND a->>'corridor'=b->>'corridor' AND known_permissions AND permissions_equal THEN
   relation_name:='same_pattern';reasons:=reasons||ARRAY['ordered_stops_equal','known_permissions_equal'];
  ELSIF ids_a<>ids_b THEN relation_name:='variant_of';reasons:=array_append(reasons,'ordered_stops_differ');
  ELSIF permission_conflict THEN relation_name:='variant_of';reasons:=array_append(reasons,'known_permissions_differ'); END IF;
  key:='10';IF relation_name IS NOT NULL AND (after_key IS NULL OR key>after_key) THEN
   result:=result||jsonb_build_array(jsonb_build_object('key',key,'from',from_id,'to',to_id,'relation',relation_name,'reasons',reasons));
   IF jsonb_array_length(result)>=page_limit THEN RETURN result; END IF;
  END IF;
 END IF;
 IF cardinality(ids_a)=cardinality(ids_b) THEN RETURN result; END IF;
 IF cardinality(ids_a)>cardinality(ids_b) THEN long_context:=a;short_context:=b;long_ids:=ids_a;short_ids:=ids_b;
 ELSE long_context:=b;short_context:=a;long_ids:=ids_b;short_ids:=ids_a; END IF;
 IF cardinality(short_ids)<2 THEN RETURN result; END IF;
 FOR start_pos IN 1..cardinality(long_ids)-1 LOOP
  IF long_ids[start_pos]<>short_ids[1] THEN CONTINUE; END IF;
  FOR end_pos IN start_pos+1..cardinality(long_ids) LOOP
   key:='20:'||lpad(start_pos::text,4,'0')||':'||lpad(end_pos::text,4,'0');
   IF (after_key IS NOT NULL AND key<=after_key) OR long_ids[end_pos]<>short_ids[cardinality(short_ids)] THEN CONTINUE; END IF;
   valid:=true;position:=start_pos;gap:=false;permission_conflict:=false;known_permissions:=true;
   FOR i IN 1..cardinality(short_ids) LOOP
    previous_position:=position;
    IF i=cardinality(short_ids) THEN position:=end_pos;
    ELSIF i>1 THEN position:=array_position(long_ids,short_ids[i],position+1); END IF;
    IF position IS NULL OR (i<cardinality(short_ids) AND position>=end_pos) THEN valid:=false;EXIT; END IF;
    IF i>1 AND position>previous_position+1 THEN gap:=true; END IF;
    IF long_context->'stops'->(position-1)->>'pickup'='unknown' OR long_context->'stops'->(position-1)->>'dropoff'='unknown'
     OR short_context->'stops'->(i-1)->>'pickup'='unknown' OR short_context->'stops'->(i-1)->>'dropoff'='unknown' THEN known_permissions:=false; END IF;
    IF (long_context->'stops'->(position-1)->>'pickup'<>'unknown' AND short_context->'stops'->(i-1)->>'pickup'<>'unknown'
      AND long_context->'stops'->(position-1)->>'pickup'<>short_context->'stops'->(i-1)->>'pickup')
     OR (long_context->'stops'->(position-1)->>'dropoff'<>'unknown' AND short_context->'stops'->(i-1)->>'dropoff'<>'unknown'
      AND long_context->'stops'->(position-1)->>'dropoff'<>short_context->'stops'->(i-1)->>'dropoff') THEN permission_conflict:=true; END IF;
   END LOOP;
   IF NOT valid THEN CONTINUE; END IF;
   reasons:=ARRAY['known_operator_equal','route_identity_equal','ordered_stop_subsequence','identity_review_required','no_schedule_or_fare_inheritance'];
   IF gap THEN reasons:=array_append(reasons,'unmatched_intermediate_stops'); END IF;
   IF NOT known_permissions THEN reasons:=array_append(reasons,'segment_permissions_incomplete'); END IF;
   IF permission_conflict THEN reasons:=array_append(reasons,'segment_permission_conflict'); END IF;
   IF NOT (long_context->>'complete')::boolean OR NOT (short_context->>'complete')::boolean THEN reasons:=array_append(reasons,'stop_list_incomplete'); END IF;
   result:=result||jsonb_build_array(jsonb_build_object('key',key,'from',long_context->'id','to',short_context->'id','relation','contains_segment',
    'segmentStart',long_context->'stops'->(start_pos-1)->'sequence','segmentEnd',long_context->'stops'->(end_pos-1)->'sequence','reasons',reasons));
   IF jsonb_array_length(result)>=page_limit THEN RETURN result; END IF;
  END LOOP;
 END LOOP;
 RETURN result;
END; $$;


-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_worker_finish_associate(uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'220f0f9027422361042e78c9578af4c4b70ff651e7bca05579a94618e8f19939' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$v2_worker_finish_associate($old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$v2_worker_finish_associate($old0$,$new0$v2_worker_finish_lead($new0$);
 EXECUTE definition;
END; $verified_patch$;

CREATE TABLE public.v2_pattern_catalog (
 route_subject_id uuid PRIMARY KEY REFERENCES public.v2_routes(subject_id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>=1)
);
CREATE TABLE public.v2_pattern_scans (
 job_id uuid PRIMARY KEY REFERENCES public.v2_jobs(id) ON DELETE CASCADE,
 subject_id uuid NOT NULL REFERENCES public.v2_patterns(subject_id) ON DELETE CASCADE,
 source_revision bigint NOT NULL CHECK(source_revision>=1),route_revision bigint NOT NULL CHECK(route_revision>=1),
 corridor_revision bigint NOT NULL CHECK(corridor_revision>=1),input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 cursor_subject_id uuid,cursor_key text CHECK(cursor_key IS NULL OR cursor_key ~ '^(00|10|20:[0-9]{4}:[0-9]{4})$'),
 pages_completed integer NOT NULL DEFAULT 0 CHECK(pages_completed>=0)
);
CREATE INDEX v2_pattern_scans_subject_idx ON public.v2_pattern_scans(subject_id);
CREATE TABLE public.v2_pattern_candidate_support (
 candidate_id uuid NOT NULL REFERENCES public.v2_association_candidates(id),
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 PRIMARY KEY(candidate_id,observation_id)
);
CREATE INDEX v2_pattern_support_observation_idx ON public.v2_pattern_candidate_support(observation_id);
ALTER TABLE public.v2_association_candidates ADD COLUMN match_key text CHECK(match_key IS NULL OR match_key ~ '^(00|10|20:[0-9]{4}:[0-9]{4})$');
ALTER TABLE public.v2_association_candidates ADD CONSTRAINT v2_pattern_candidate_basis CHECK(rule_version<>'pattern-association/1' OR (match_key IS NOT NULL AND (basis_digest IS NOT NULL OR evidence_erased)));
ALTER TABLE public.v2_worker_status DROP CONSTRAINT v2_worker_status_runner_key_check;
ALTER TABLE public.v2_worker_status ADD CONSTRAINT v2_worker_status_runner_key_check CHECK(runner_key IN('normalise/1','association/1','pattern-association/1'));
INSERT INTO public.v2_pattern_catalog SELECT DISTINCT route_subject_id,1 FROM public.v2_patterns ON CONFLICT DO NOTHING;

CREATE FUNCTION public.v2_candidate_review_increment(candidate uuid,changed uuid,old_revision bigint,new_revision bigint,old_generation bigint,new_generation bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT new_revision=old_revision+1 AND new_generation=old_generation+1 AND EXISTS(
  SELECT 1 FROM public.v2_review_cases c JOIN public.v2_review_decisions d ON d.id=c.last_decision_id
  WHERE c.candidate_id=candidate AND c.subject_id=changed AND c.kind='identity'
   AND d.expected_subject_revision=old_revision AND NOT d.evidence_erased);
$$;
CREATE FUNCTION public.v2_wake_pattern_work(routes uuid[],corridors uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE route uuid;corridor uuid;event uuid:=gen_random_uuid();
BEGIN
 FOR route IN SELECT DISTINCT r FROM unnest(routes) r WHERE r IS NOT NULL ORDER BY r LOOP
  INSERT INTO public.v2_pattern_catalog VALUES(route,1) ON CONFLICT(route_subject_id) DO UPDATE SET revision=public.v2_pattern_catalog.revision+1;
 END LOOP;
 FOR corridor IN SELECT DISTINCT c FROM unnest(corridors) c WHERE c IS NOT NULL ORDER BY c LOOP
  INSERT INTO public.v2_association_catalog VALUES(corridor,1) ON CONFLICT(corridor_id) DO UPDATE SET revision=public.v2_association_catalog.revision+1;
 END LOOP;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
  SELECT 'associate',s.id,s.input_generation,'pattern-association/1',event FROM public.v2_patterns p
  JOIN public.v2_subjects s ON s.id=p.subject_id AND s.lifecycle='active'
  JOIN public.v2_pattern_versions v ON v.pattern_subject_id=p.subject_id AND v.version=p.current_pattern_version AND v.sealed
  WHERE (p.route_subject_id=ANY(routes) OR p.corridor_id=ANY(corridors)) AND NOT EXISTS(
   SELECT 1 FROM public.v2_jobs j WHERE j.kind='associate' AND j.policy_version='pattern-association/1'
    AND j.subject_id=s.id AND j.requested_generation=s.input_generation AND j.state='pending') ON CONFLICT DO NOTHING;
END; $$;
CREATE FUNCTION public.v2_pattern_work_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE routes uuid[];corridors uuid[];target uuid;old_row jsonb;new_row jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD);END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW);END IF;
 IF TG_TABLE_NAME='v2_subjects' THEN
  IF NEW.kind<>'pattern' OR (NEW.input_generation=OLD.input_generation AND NEW.lifecycle=OLD.lifecycle) THEN RETURN NEW;END IF;
  target:=NEW.id;
  DELETE FROM public.v2_pattern_scans WHERE subject_id=target;
  UPDATE public.v2_association_candidates SET state='obsolete',revision=revision+1
   WHERE rule_version='pattern-association/1' AND state='pending' AND last_decision_id IS NULL
    AND target IN(from_subject_id,to_subject_id)
    AND NOT public.v2_candidate_review_increment(id,target,OLD.revision,NEW.revision,OLD.input_generation,NEW.input_generation);
 ELSIF TG_TABLE_NAME='v2_pattern_versions' THEN
  IF TG_OP='UPDATE' AND NEW.sealed=OLD.sealed THEN RETURN NEW;END IF;
  target:=COALESCE((new_row->>'pattern_subject_id')::uuid,(old_row->>'pattern_subject_id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM public.v2_patterns p WHERE p.subject_id=target
   AND p.current_pattern_version=COALESCE((new_row->>'version')::integer,(old_row->>'version')::integer)) THEN RETURN COALESCE(NEW,OLD);END IF;
 ELSE target:=COALESCE((new_row->>'subject_id')::uuid,(old_row->>'subject_id')::uuid);END IF;
 SELECT ARRAY[p.route_subject_id],ARRAY[p.corridor_id] INTO routes,corridors FROM public.v2_patterns p WHERE p.subject_id=target;
 IF TG_TABLE_NAME='v2_patterns' THEN
  routes:=ARRAY[(new_row->>'route_subject_id')::uuid,(old_row->>'route_subject_id')::uuid];
  corridors:=ARRAY[(new_row->>'corridor_id')::uuid,(old_row->>'corridor_id')::uuid];
 END IF;
 PERFORM public.v2_wake_pattern_work(routes,corridors);
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END; $$;
CREATE TRIGGER v2_pattern_work_change AFTER INSERT OR UPDATE OR DELETE ON public.v2_patterns FOR EACH ROW EXECUTE FUNCTION public.v2_pattern_work_change();
CREATE TRIGGER v2_pattern_work_change AFTER INSERT OR UPDATE ON public.v2_pattern_versions FOR EACH ROW EXECUTE FUNCTION public.v2_pattern_work_change();
CREATE TRIGGER v2_pattern_work_change AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_pattern_work_change();

CREATE FUNCTION public.v2_pattern_support_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.v2_observations WHERE id=OLD.observation_id) THEN RETURN OLD;END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.v2_association_candidates c WHERE c.id=NEW.candidate_id
  AND c.rule_version='pattern-association/1' AND c.state='pending' AND c.last_decision_id IS NULL
  AND NEW.observation_id=ANY(public.v2_pattern_input_evidence(c.from_subject_id)||public.v2_pattern_input_evidence(c.to_subject_id))) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'pattern_support_sealed' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_pattern_support_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_pattern_candidate_support FOR EACH ROW EXECUTE FUNCTION public.v2_pattern_support_guard();
CREATE FUNCTION public.v2_pattern_support_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observation uuid;erase boolean;ids uuid[];decisions uuid[];routes uuid[];corridors uuid[];
BEGIN
 erase:=TG_TABLE_NAME='v2_observations';
 IF erase THEN observation:=OLD.id;ELSE
  IF NEW.status=OLD.status AND NEW.revision=OLD.revision THEN RETURN NEW;END IF;observation:=NEW.observation_id;
 END IF;
 SELECT array_agg(candidate_id) INTO ids FROM public.v2_pattern_candidate_support WHERE observation_id=observation;
 IF ids IS NOT NULL THEN
  SELECT array_agg(id) INTO decisions FROM public.v2_association_decisions WHERE candidate_id=ANY(ids);
  PERFORM public.v2_invalidate_derived(decisions,erase);
  UPDATE public.v2_association_candidates SET state='obsolete',revision=revision+1,evidence_erased=evidence_erased OR erase,
   evidence_digest=CASE WHEN erase THEN NULL ELSE evidence_digest END WHERE id=ANY(ids);
  SELECT array_agg(DISTINCT p.route_subject_id),array_agg(DISTINCT p.corridor_id) INTO routes,corridors
   FROM public.v2_association_candidates c JOIN public.v2_patterns p ON p.subject_id IN(c.from_subject_id,c.to_subject_id) WHERE c.id=ANY(ids);
  PERFORM public.v2_wake_pattern_work(routes,corridors);
 END IF;
 IF erase THEN RETURN OLD;ELSE RETURN NEW;END IF;
END; $$;
CREATE TRIGGER v2_pattern_support_change BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_pattern_support_change();
CREATE TRIGGER v2_pattern_support_change AFTER UPDATE ON public.v2_observation_states FOR EACH ROW EXECUTE FUNCTION public.v2_pattern_support_change();

CREATE FUNCTION public.v2_worker_finish_pattern(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE work public.v2_jobs;source public.v2_subjects;context jsonb;scan public.v2_pattern_scans;
 route_epoch bigint;corridor_epoch bigint;input text;target record;proposals jsonb;proposal jsonb;
 emitted integer:=0;targets integer:=0;remaining integer;partial boolean:=false;cursor_id uuid;next_cursor_key text;
 from_context jsonb;to_context jsonb;support uuid[];evidence jsonb;basis text;digest text;candidate uuid;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO work FROM public.v2_jobs WHERE id=job FOR UPDATE;
 IF NOT FOUND OR work.kind<>'associate' OR work.policy_version<>'pattern-association/1' OR work.state<>'leased'
  OR work.lease_token IS DISTINCT FROM token OR work.lease_until<=clock_timestamp() THEN RETURN 'lease_lost';END IF;
 SELECT * INTO source FROM public.v2_subjects WHERE id=work.subject_id FOR UPDATE;
 context:=public.v2_pattern_context(source.id);
 IF source.lifecycle<>'active' OR source.input_generation<>work.requested_generation OR context IS NULL THEN
  DELETE FROM public.v2_pattern_scans WHERE job_id=job;
  UPDATE public.v2_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE id=job;RETURN 'superseded';END IF;
 SELECT revision INTO route_epoch FROM public.v2_pattern_catalog WHERE route_subject_id=(context->>'route')::uuid;
 SELECT revision INTO corridor_epoch FROM public.v2_association_catalog WHERE corridor_id=(context->>'corridor')::uuid;
 IF route_epoch IS NULL OR corridor_epoch IS NULL THEN RAISE EXCEPTION 'pattern_catalog_missing';END IF;
 input:=public.v2_assessment_hash(context);
 SELECT * INTO scan FROM public.v2_pattern_scans WHERE job_id=job;
 IF scan.job_id IS NULL OR scan.source_revision<>source.revision OR scan.route_revision<>route_epoch
  OR scan.corridor_revision<>corridor_epoch OR scan.input_digest<>input THEN
  INSERT INTO public.v2_pattern_scans(job_id,subject_id,source_revision,route_revision,corridor_revision,input_digest)
   VALUES(job,source.id,source.revision,route_epoch,corridor_epoch,input)
  ON CONFLICT(job_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,route_revision=EXCLUDED.route_revision,
   corridor_revision=EXCLUDED.corridor_revision,input_digest=EXCLUDED.input_digest,cursor_subject_id=NULL,cursor_key=NULL,pages_completed=0 RETURNING * INTO scan;
 END IF;
 cursor_id:=scan.cursor_subject_id;next_cursor_key:=scan.cursor_key;
 FOR target IN SELECT p.subject_id FROM public.v2_patterns p JOIN public.v2_subjects s ON s.id=p.subject_id AND s.lifecycle='active'
  WHERE p.subject_id<>source.id AND (p.route_subject_id=(context->>'route')::uuid OR p.corridor_id=(context->>'corridor')::uuid)
   AND (scan.cursor_subject_id IS NULL OR p.subject_id>scan.cursor_subject_id OR (p.subject_id=scan.cursor_subject_id AND scan.cursor_key IS NOT NULL))
  ORDER BY p.subject_id LIMIT 10 LOOP
  targets:=targets+1;remaining:=50-emitted;
  proposals:=public.v2_pattern_candidate_page(source.id,target.subject_id,CASE WHEN target.subject_id=scan.cursor_subject_id THEN scan.cursor_key ELSE NULL END,remaining+1);
  cursor_id:=target.subject_id;next_cursor_key:=NULL;
  FOR proposal IN SELECT value FROM jsonb_array_elements(proposals) LOOP
   IF emitted>=50 THEN partial:=true;EXIT;END IF;
   from_context:=public.v2_pattern_context((proposal->>'from')::uuid);to_context:=public.v2_pattern_context((proposal->>'to')::uuid);
   support:=public.v2_pattern_input_evidence((proposal->>'from')::uuid)||public.v2_pattern_input_evidence((proposal->>'to')::uuid);
   SELECT COALESCE(jsonb_agg(jsonb_build_array(observation_id,revision) ORDER BY observation_id),'[]'::jsonb) INTO evidence
    FROM public.v2_observation_states WHERE observation_id=ANY(support);
   basis:=public.v2_assessment_hash(jsonb_build_object('policy','pattern-association/1','proposal',proposal,
    'from',from_context-ARRAY['revision','generation','version'],'to',to_context-ARRAY['revision','generation','version'],'evidence',evidence));
   digest:=public.v2_assessment_hash(jsonb_build_object('basis',basis,'from',from_context,'to',to_context));
   emitted:=emitted+1;next_cursor_key:=proposal->>'key';candidate:=NULL;
   IF EXISTS(SELECT 1 FROM public.v2_association_candidates c JOIN public.v2_association_decisions d ON d.id=c.last_decision_id
    WHERE c.rule_version='pattern-association/1' AND c.from_subject_id=(proposal->>'from')::uuid AND c.to_subject_id=(proposal->>'to')::uuid
     AND c.basis_digest=basis AND NOT d.invalidated AND NOT d.erased
     AND (d.action='reject' OR (d.action='accept' AND EXISTS(SELECT 1 FROM public.v2_association_links l WHERE l.candidate_id=c.id)))) THEN CONTINUE;END IF;
   INSERT INTO public.v2_association_candidates(from_subject_id,from_kind,to_subject_id,to_kind,relation,segment_start,segment_end,
    evidence_digest,basis_digest,match_key,reason_codes,rule_version,source_revision,target_revision)
   VALUES((proposal->>'from')::uuid,'pattern',(proposal->>'to')::uuid,'pattern',proposal->>'relation',(proposal->>'segmentStart')::integer,(proposal->>'segmentEnd')::integer,
    digest,basis,proposal->>'key',ARRAY(SELECT jsonb_array_elements_text(proposal->'reasons')),'pattern-association/1',(from_context->>'revision')::bigint,(to_context->>'revision')::bigint)
   ON CONFLICT DO NOTHING RETURNING id INTO candidate;
   IF candidate IS NOT NULL THEN
    INSERT INTO public.v2_pattern_candidate_support(candidate_id,observation_id) SELECT candidate,o.id FROM public.v2_observations o WHERE o.id=ANY(support);
    INSERT INTO public.v2_candidate_evidence(candidate_id,observation_id) SELECT candidate,o.id FROM public.v2_observations o
     WHERE o.id=ANY(support) AND o.original_subject_id IN((proposal->>'from')::uuid,(proposal->>'to')::uuid);
   END IF;
  END LOOP;
  IF partial THEN EXIT;END IF;next_cursor_key:=NULL;
  IF emitted>=50 THEN EXIT;END IF;
 END LOOP;
 UPDATE public.v2_pattern_scans SET cursor_subject_id=cursor_id,cursor_key=next_cursor_key,pages_completed=pages_completed+1 WHERE job_id=job;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 IF partial OR targets=10 OR emitted>=50 THEN
  UPDATE public.v2_jobs SET state='pending',lease_token=NULL,lease_until=NULL,available_at=clock_timestamp(),max_attempts=max_attempts+1,last_error_code=NULL WHERE id=job;RETURN 'continued';END IF;
 digest:=public.v2_assessment_hash(jsonb_build_object('policy','pattern-association/1','source',context,'routeEpoch',route_epoch,'corridorEpoch',corridor_epoch));
 INSERT INTO public.v2_job_effects(job_id,stage,input_digest,result_revision) VALUES(job,'pattern-association/1',digest,source.revision) ON CONFLICT DO NOTHING;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) VALUES('assess',source.id,source.input_generation,'evidence/1',source.id) ON CONFLICT DO NOTHING;
 IF work.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001';END IF;
 UPDATE public.v2_jobs SET state='done',lease_token=NULL,lease_until=NULL,last_error_code=NULL,completed_at=clock_timestamp() WHERE id=job;RETURN 'done';
END; $$;

CREATE OR REPLACE FUNCTION public.v2_worker_finish_associate(job uuid,token uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy text;
BEGIN
 SELECT policy_version INTO policy FROM public.v2_jobs WHERE id=job AND kind='associate';
 IF policy='association/1' THEN RETURN public.v2_worker_finish_lead(job,token);
 ELSIF policy='pattern-association/1' THEN RETURN public.v2_worker_finish_pattern(job,token);END IF;
 RETURN 'lease_lost';
END; $$;
CREATE FUNCTION public.v2_generated_pattern_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.v2_association_candidates;page jsonb;before_key text;
BEGIN
 SELECT * INTO c FROM public.v2_association_candidates WHERE id=NEW.candidate_id;
 IF c.rule_version<>'pattern-association/1' THEN RETURN NEW;END IF;
 before_key:=CASE c.match_key WHEN '00' THEN NULL WHEN '10' THEN '09'
  ELSE left(c.match_key,8)||lpad((right(c.match_key,4)::integer-1)::text,4,'0') END;
 page:=public.v2_pattern_candidate_page(c.from_subject_id,c.to_subject_id,before_key,1);
 IF page->0->>'key' IS DISTINCT FROM c.match_key OR page->0->>'relation' IS DISTINCT FROM c.relation
  OR (page->0->>'segmentStart')::integer IS DISTINCT FROM c.segment_start OR (page->0->>'segmentEnd')::integer IS DISTINCT FROM c.segment_end THEN
  RAISE EXCEPTION 'pattern_relation_context_changed' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.v2_pattern_candidate_support p JOIN public.v2_observation_states s ON s.observation_id=p.observation_id
  WHERE p.candidate_id=c.id AND s.status<>'active') THEN RAISE EXCEPTION 'pattern_support_inactive' USING ERRCODE='23514';END IF;
 IF c.relation='same_corridor' THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.v2_pattern_candidate_support p WHERE p.candidate_id=c.id AND NOT EXISTS(
  SELECT 1 FROM public.v2_association_decisions d JOIN public.v2_review_decision_evidence e ON e.decision_id=d.reviewer_decision_id
   WHERE d.id=NEW.decision_id AND e.observation_id=p.observation_id)) THEN RAISE EXCEPTION 'pattern_origin_not_reviewed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_generated_pattern_link_guard BEFORE INSERT ON public.v2_association_links FOR EACH ROW EXECUTE FUNCTION public.v2_generated_pattern_link_guard();


-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_worker_claim_associate()'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'942b29b4d1c21239cba3278807265f7b9e8aad97e42b805f93c5dce188165b00' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$policy_version='association/1'$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$policy_version='association/1'$old0$,$new0$policy_version IN('association/1','pattern-association/1')$new0$);
 EXECUTE definition;
END; $verified_patch$;

-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_worker_heartbeat_associate(uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'976257c8e62864ec3b150247fc1038050b3504f8fede1f5ccb8bd1900ad62399' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$policy_version='association/1'$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$policy_version='association/1'$old0$,$new0$policy_version IN('association/1','pattern-association/1')$new0$);
 EXECUTE definition;
END; $verified_patch$;

-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_worker_fail_associate(uuid,uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'8cf5e93b09c48632cd835aab829894af2ea1b2271f1c6c8558d0cbe32fa79197' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$policy_version='association/1'$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$policy_version='association/1'$old0$,$new0$policy_version IN('association/1','pattern-association/1')$new0$);
 EXECUTE definition;
END; $verified_patch$;

-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_worker_retry_associate(uuid)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'4db3540b24439b2c4eb5441667b46f2365931a9d2544097bfea544ee9e1e05fe' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$policy_version='association/1'$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$policy_version='association/1'$old0$,$new0$policy_version IN('association/1','pattern-association/1')$new0$);
 EXECUTE definition;
END; $verified_patch$;

-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_association_catalog_change()'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'2b78d8c95490812b7b85bfea7b614798a0bc18285f03feb83a00a9ef0f2d17fb' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$AND NEW.id IN(from_subject_id,to_subject_id);$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$AND NEW.id IN(from_subject_id,to_subject_id);$old0$,$new0$AND NEW.id IN(from_subject_id,to_subject_id)
    AND NOT public.v2_candidate_review_increment(id,NEW.id,OLD.revision,NEW.revision,OLD.input_generation,NEW.input_generation);$new0$);
 EXECUTE definition;
END; $verified_patch$;

-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_record_review(varchar,uuid,bigint,bigint,text,text,text,uuid[],text,uuid)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'363a8b43ce88449b576f0bf81e2de0d6e1d00ef38a83bc4bbdc922e29299e9fb' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$AND o.original_subject_id=review_case.subject_id$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$AND o.original_subject_id=review_case.subject_id$old0$,$new0$AND (((review_case.kind<>'identity' OR review_case.candidate_id IS NULL) AND o.original_subject_id=review_case.subject_id) OR (review_case.kind='identity' AND review_case.candidate_id IS NOT NULL AND EXISTS(
         SELECT 1 FROM public.v2_association_candidates c WHERE c.id=review_case.candidate_id AND c.state='pending' AND NOT c.evidence_erased
          AND review_case.subject_id IN(c.from_subject_id,c.to_subject_id)
          AND (EXISTS(SELECT 1 FROM public.v2_candidate_evidence ce WHERE ce.candidate_id=c.id AND ce.observation_id=o.id)
           OR EXISTS(SELECT 1 FROM public.v2_pattern_candidate_support ps WHERE ps.candidate_id=c.id AND ps.observation_id=o.id)))))$new0$);
 EXECUTE definition;
END; $verified_patch$;

-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_apply_association_decision(uuid)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'5ed4d7a4bb1f66fd693c9a768ec87f120c86b72ef18d40b2c03c4c8683b2c61a' OR secure IS DISTINCT FROM false OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$ELSIF NOT EXISTS(SELECT 1 FROM public.v2_candidate_evidence e JOIN public.v2_observation_states o ON o.observation_id=e.observation_id WHERE e.candidate_id=c.id AND o.status='active') THEN$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$ELSIF NOT EXISTS(SELECT 1 FROM public.v2_candidate_evidence e JOIN public.v2_observation_states o ON o.observation_id=e.observation_id WHERE e.candidate_id=c.id AND o.status='active') THEN$old0$,$new0$ELSIF NOT EXISTS(SELECT 1 FROM public.v2_candidate_evidence e JOIN public.v2_observation_states o ON o.observation_id=e.observation_id WHERE e.candidate_id=c.id AND o.status='active')
    AND NOT (c.rule_version='pattern-association/1' AND EXISTS(SELECT 1 FROM public.v2_pattern_candidate_support ps JOIN public.v2_observation_states os ON os.observation_id=ps.observation_id WHERE ps.candidate_id=c.id AND os.status='active')) THEN$new0$);
 EXECUTE definition;
END; $verified_patch$;

-- Refuse an unrecorded body/security/search-path change before reusing a fence.
DO $verified_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_worker_drain_associate(integer)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'9fb82ce2b7dcf442ccf7a430bf3f7d4e53e6a5ca9128bb12c6807f40d051b592' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'pattern_prior_function_changed';END IF;
 IF position($old0$safe_code text;$old0$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old0$safe_code text;$old0$,$new0$safe_code text;pattern_done integer:=0;pattern_superseded integer:=0;pattern_failed integer:=0;pattern_continued integer:=0;$new0$);
 IF position($old1$ELSIF result='continued' THEN continued_count:=continued_count+1; END IF;$old1$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old1$ELSIF result='continued' THEN continued_count:=continued_count+1; END IF;$old1$,$new1$ELSIF result='continued' THEN continued_count:=continued_count+1; END IF;
   IF work.policy_version='pattern-association/1' THEN
    IF result='done' THEN pattern_done:=pattern_done+1;ELSIF result='superseded' THEN pattern_superseded:=pattern_superseded+1;ELSIF result='continued' THEN pattern_continued:=pattern_continued+1;END IF;
   END IF;$new1$);
 IF position($old2$failure_count:=failure_count+1;$old2$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old2$failure_count:=failure_count+1;$old2$,$new2$failure_count:=failure_count+1;
   IF work.policy_version='pattern-association/1' THEN pattern_failed:=pattern_failed+1;END IF;$new2$);
 IF position($old3$RETURN jsonb_build_object('done'$old3$ IN definition)=0 THEN RAISE EXCEPTION 'pattern_patch_anchor_missing';END IF;
 definition:=replace(definition,$old3$RETURN jsonb_build_object('done'$old3$,$new3$INSERT INTO public.v2_worker_status(runner_key,last_completed_at,last_done,last_superseded,last_failed_attempts,last_continued)
  VALUES('pattern-association/1',clock_timestamp(),pattern_done,pattern_superseded,pattern_failed,pattern_continued)
 ON CONFLICT(runner_key) DO UPDATE SET last_completed_at=EXCLUDED.last_completed_at,last_done=EXCLUDED.last_done,last_superseded=EXCLUDED.last_superseded,last_failed_attempts=EXCLUDED.last_failed_attempts,last_continued=EXCLUDED.last_continued;
 RETURN jsonb_build_object('done'$new3$);
 EXECUTE definition;
END; $verified_patch$;

CREATE OR REPLACE FUNCTION public.v2_worker_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('normalise',public.v2_worker_stage_health('normalise','intake/1','normalise/1'),
  'associate',public.v2_worker_stage_health('associate','association/1','association/1'),
  'pattern',public.v2_worker_stage_health('associate','pattern-association/1','pattern-association/1'),
  'failedJobs',COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,kind,policy_version,attempt,max_attempts,last_error_code,completed_at FROM public.v2_jobs
   WHERE ((kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1'))) AND state='failed' ORDER BY completed_at,id LIMIT 20) x),'[]'::jsonb),
  'otherPendingStages',(SELECT count(*) FROM public.v2_jobs WHERE state='pending'
   AND NOT ((kind='normalise' AND policy_version='intake/1') OR (kind='associate' AND policy_version IN('association/1','pattern-association/1')))));
$$;


DO $$ DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_pattern_catalog','v2_pattern_scans','v2_pattern_candidate_support'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY v2_pattern_api ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_pattern_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;
  END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('v2_pattern_context','v2_pattern_input_evidence','v2_pattern_candidate_page','v2_candidate_review_increment','v2_wake_pattern_work',
   'v2_pattern_work_change','v2_pattern_support_guard','v2_pattern_support_change','v2_worker_finish_lead','v2_worker_finish_pattern','v2_generated_pattern_link_guard') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;
  END LOOP;
 END LOOP;
END; $$;
-- Existing fenced facade grants are retained. No new reviewer/role/credential.

