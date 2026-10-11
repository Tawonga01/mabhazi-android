-- Structural edits invalidate dependent interpretations synchronously. These
-- records are value-free change provenance, not canonical reviewer approval.
CREATE TABLE public.v2_transport_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text NOT NULL,
 operation text NOT NULL CHECK(operation IN('INSERT','UPDATE','DELETE')),
 changed_columns text[] NOT NULL CHECK(cardinality(changed_columns)>0),
 policy_version text NOT NULL DEFAULT 'transport-inputs/1' CHECK(policy_version='transport-inputs/1'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE public.v2_transport_change_subjects (
 change_id uuid NOT NULL REFERENCES public.v2_transport_changes(id), subject_id uuid NOT NULL REFERENCES public.v2_subjects(id) ON DELETE CASCADE,
 is_root boolean NOT NULL, previous_revision bigint NOT NULL CHECK(previous_revision>=1), previous_generation bigint NOT NULL CHECK(previous_generation>=1),
 resulting_revision bigint NOT NULL, resulting_generation bigint NOT NULL,
 PRIMARY KEY(change_id,subject_id), CHECK(resulting_revision>previous_revision), CHECK(resulting_generation>previous_generation)
);
CREATE INDEX v2_transport_change_subject_idx ON public.v2_transport_change_subjects(subject_id,change_id);
CREATE FUNCTION public.v2_transport_change_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='v2_transport_change_subjects' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=OLD.subject_id) THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'v2_structural_change_audit_is_trigger_owned' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_transport_change_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_transport_changes FOR EACH ROW EXECUTE FUNCTION public.v2_transport_change_guard();
CREATE TRIGGER v2_transport_change_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_transport_change_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_transport_change_guard();

CREATE FUNCTION public.v2_transport_dependents(roots uuid[]) RETURNS uuid[] LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH RECURSIVE edges(parent,child) AS (
  SELECT operator_subject_id,subject_id FROM public.v2_leads WHERE operator_subject_id IS NOT NULL
  UNION SELECT operator_subject_id,subject_id FROM public.v2_routes
  UNION SELECT route_subject_id,subject_id FROM public.v2_patterns
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_service_plans
  UNION SELECT service_plan_subject_id,subject_id FROM public.v2_runs
  UNION SELECT pattern_subject_id,subject_id FROM public.v2_runs
  UNION SELECT parent_stop_id,subject_id FROM public.v2_stops WHERE parent_stop_id IS NOT NULL
  UNION SELECT ps.stop_subject_id,ps.pattern_subject_id FROM public.v2_pattern_stops ps JOIN public.v2_pattern_versions pv ON pv.pattern_subject_id=ps.pattern_subject_id AND pv.version=ps.pattern_version WHERE pv.sealed
  UNION SELECT intended_subject_id,subject_id FROM public.v2_actual_journeys WHERE intended_subject_id IS NOT NULL
  UNION SELECT matched_run_subject_id,subject_id FROM public.v2_actual_journeys WHERE matched_run_subject_id IS NOT NULL
  UNION SELECT x.ref_id,o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT x.ref_id,public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r CROSS JOIN LATERAL unnest(ARRAY[r.operator_id,r.stop_id]) x(ref_id) WHERE x.ref_id IS NOT NULL
  UNION SELECT from_subject_id,to_subject_id FROM public.v2_association_links
  UNION SELECT to_subject_id,from_subject_id FROM public.v2_association_links
 ), reached(id) AS (SELECT unnest(roots) UNION SELECT e.child FROM edges e JOIN reached r ON r.id=e.parent)
 SELECT COALESCE(array_agg(s.id ORDER BY s.id),'{}'::uuid[]) FROM reached r JOIN public.v2_subjects s ON s.id=r.id;
$$;
CREATE FUNCTION public.v2_transport_propagate(roots uuid[],origin_table text,operation_name text,columns_changed text[],removed_subject uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected uuid[]; event_id uuid:=gen_random_uuid(); before_state jsonb; candidates uuid[]; decisions uuid[]; item record;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 affected:=ARRAY(SELECT x FROM unnest(public.v2_transport_dependents(roots)) x WHERE x IS DISTINCT FROM removed_subject);
 IF cardinality(affected)=0 THEN RETURN; END IF;
 PERFORM 1 FROM public.v2_subjects WHERE id=ANY(affected) ORDER BY id FOR UPDATE;
 SELECT jsonb_object_agg(id::text,jsonb_build_array(revision,input_generation)) INTO before_state FROM public.v2_subjects WHERE id=ANY(affected);
 INSERT INTO public.v2_transport_changes(id,source_table,operation,changed_columns) VALUES(event_id,origin_table,operation_name,columns_changed);
 SELECT array_agg(id) INTO candidates FROM public.v2_association_candidates WHERE from_subject_id=ANY(affected) OR to_subject_id=ANY(affected);
 SELECT array_agg(id) INTO decisions FROM (
  SELECT id FROM public.v2_association_decisions WHERE candidate_id=ANY(candidates)
  UNION SELECT id FROM public.v2_field_decisions WHERE subject_id=ANY(affected)
 ) d;
 -- Existing invalidation records target fallback events and preserves originals.
 PERFORM public.v2_invalidate_derived(decisions,false);
 UPDATE public.v2_association_candidates SET state='obsolete',revision=revision+1 WHERE id=ANY(candidates) AND state<>'obsolete';
 -- Always advance even when there were no prior decisions; pending tasks and
 -- slow workers still hold meaningful expected revisions.
 UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=ANY(affected);
 FOR item IN SELECT id,revision,input_generation FROM public.v2_subjects WHERE id=ANY(affected) ORDER BY id LOOP
  INSERT INTO public.v2_transport_change_subjects(change_id,subject_id,is_root,previous_revision,previous_generation,resulting_revision,resulting_generation)
  VALUES(event_id,item.id,item.id=ANY(roots),(before_state->item.id::text->>0)::bigint,(before_state->item.id::text->>1)::bigint,item.revision,item.input_generation);
  INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
   VALUES('assess',item.id,item.input_generation,'transport-inputs/1',event_id),('refresh_tasks',item.id,item.input_generation,'prompts/1',event_id);
 END LOOP;
END; $$;
CREATE FUNCTION public.v2_transport_input_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row jsonb; new_row jsonb; changed text[]; roots uuid[]:='{}'; ids uuid[]; cities integer[]; removed uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='v2_subjects' THEN
  IF NEW.lifecycle IS NOT DISTINCT FROM OLD.lifecycle THEN RETURN NEW; END IF;
  old_row:=jsonb_build_object('lifecycle',OLD.lifecycle);new_row:=jsonb_build_object('lifecycle',NEW.lifecycle);roots:=ARRAY[NEW.id];
 ELSIF TG_TABLE_NAME IN('v2_leads','v2_operators','v2_routes','v2_stops','v2_patterns','v2_service_plans','v2_runs','v2_actual_journeys') THEN
  IF TG_TABLE_NAME='v2_leads' THEN old_row:=old_row-ARRAY['initial_contribution_id','attribution_erased'];new_row:=new_row-ARRAY['initial_contribution_id','attribution_erased']; END IF;
  roots:=ARRAY[(old_row->>'subject_id')::uuid,(new_row->>'subject_id')::uuid];
  IF TG_OP='DELETE' THEN removed:=roots[1]; END IF;
 ELSIF TG_TABLE_NAME='v2_corridors' THEN
  ids:=ARRAY[(old_row->>'id')::uuid,(new_row->>'id')::uuid];
  roots:=ARRAY(SELECT subject_id FROM public.v2_leads WHERE corridor_id=ANY(ids) UNION SELECT subject_id FROM public.v2_patterns WHERE corridor_id=ANY(ids));
 ELSIF TG_TABLE_NAME IN('v2_calendars','v2_calendar_exceptions') THEN
  ids:=CASE TG_TABLE_NAME WHEN 'v2_calendars' THEN ARRAY[(old_row->>'id')::uuid,(new_row->>'id')::uuid] ELSE ARRAY[(old_row->>'calendar_id')::uuid,(new_row->>'calendar_id')::uuid] END;
  roots:=ARRAY(SELECT subject_id FROM public.v2_service_plans WHERE calendar_id=ANY(ids)
   UNION SELECT o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id WHERE r.calendar_id=ANY(ids)
   UNION SELECT public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r WHERE r.calendar_id=ANY(ids));
 ELSIF TG_TABLE_NAME='cities' THEN
  cities:=ARRAY[(old_row->>'id')::integer,(new_row->>'id')::integer];
  roots:=ARRAY(SELECT subject_id FROM public.v2_stops WHERE city_id=ANY(cities)
   UNION SELECT l.subject_id FROM public.v2_leads l JOIN public.v2_corridors c ON c.id=l.corridor_id WHERE c.origin_city_id=ANY(cities) OR c.destination_city_id=ANY(cities)
   UNION SELECT p.subject_id FROM public.v2_patterns p JOIN public.v2_corridors c ON c.id=p.corridor_id WHERE c.origin_city_id=ANY(cities) OR c.destination_city_id=ANY(cities)
   UNION SELECT o.original_subject_id FROM public.v2_observation_refs r JOIN public.v2_observations o ON o.id=r.observation_id WHERE r.city_id=ANY(cities)
   UNION SELECT public.v2_observation_subject(r.observation_id) FROM public.v2_observation_refs r WHERE r.city_id=ANY(cities));
 ELSIF TG_TABLE_NAME='v2_run_stop_times' THEN roots:=ARRAY[(old_row->>'run_subject_id')::uuid,(new_row->>'run_subject_id')::uuid];
 ELSIF TG_TABLE_NAME IN('v2_frequency_windows','v2_availability_windows') THEN roots:=ARRAY[(old_row->>'service_plan_subject_id')::uuid,(new_row->>'service_plan_subject_id')::uuid];
 ELSIF TG_TABLE_NAME IN('v2_external_ids','v2_legacy_links') THEN roots:=ARRAY[(old_row->>'subject_id')::uuid,(new_row->>'subject_id')::uuid];
 ELSE RAISE EXCEPTION 'v2_transport_change_table_unsupported' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND old_row IS NOT DISTINCT FROM new_row THEN RETURN NEW; END IF;
 SELECT array_agg(k ORDER BY k) INTO changed FROM (SELECT jsonb_object_keys(COALESCE(old_row,'{}')) k UNION SELECT jsonb_object_keys(COALESCE(new_row,'{}')) k) keys
  WHERE old_row->k IS DISTINCT FROM new_row->k;
 IF COALESCE(cardinality(changed),0)>0 THEN PERFORM public.v2_transport_propagate(roots,TG_TABLE_NAME,TG_OP,changed,removed); END IF;
 RETURN COALESCE(NEW,OLD);
END; $$;
DO $$ DECLARE t text; r text; f record; BEGIN
 -- Initial subtype construction is not an edit. Draft stop lists are immutable
 -- once sealed; current version/plan attachment changes carry their effects.
 FOREACH t IN ARRAY ARRAY['v2_leads','v2_operators','v2_routes','v2_stops','v2_patterns','v2_service_plans','v2_runs','v2_actual_journeys','v2_corridors','v2_calendars','cities'] LOOP
  EXECUTE format('CREATE TRIGGER zz_v2_transport_input AFTER UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_transport_input_change()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['v2_calendar_exceptions','v2_run_stop_times','v2_frequency_windows','v2_availability_windows','v2_external_ids','v2_legacy_links'] LOOP
  EXECUTE format('CREATE TRIGGER zz_v2_transport_input AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_transport_input_change()',t);
 END LOOP;
 CREATE TRIGGER zz_v2_transport_lifecycle AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_transport_input_change();
 FOREACH t IN ARRAY ARRAY['v2_subjects','v2_leads','v2_operators','cities'] LOOP
  EXECUTE format('CREATE TRIGGER aa_v2_structural_lock BEFORE UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['v2_transport_changes','v2_transport_change_subjects'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF; END LOOP;
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_structural_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('v2_transport_change_guard','v2_transport_dependents','v2_transport_propagate','v2_transport_input_change') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r); END IF; END LOOP;
 END LOOP;
END; $$;
