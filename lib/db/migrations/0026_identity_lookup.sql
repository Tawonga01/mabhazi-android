-- Private reviewed lookup. No automatic service links, importer HTTP or public reviewer access.
CREATE TABLE public.v2_import_revisions(
 request_id uuid PRIMARY KEY,source_namespace text NOT NULL CHECK(length(source_namespace) BETWEEN 1 AND 200 AND source_namespace=btrim(source_namespace)),
 import_version text NOT NULL CHECK(length(import_version) BETWEEN 1 AND 64 AND import_version=btrim(import_version)),
 epoch bigint NOT NULL CHECK(epoch>=1),expected_epoch bigint NOT NULL CHECK(expected_epoch>=0),active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(source_namespace,import_version),UNIQUE(source_namespace,epoch)
);
CREATE UNIQUE INDEX v2_import_revision_current ON public.v2_import_revisions(source_namespace) WHERE active;
CREATE TABLE public.v2_identity_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,request_digest text CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN('operator_alias','external_id')),source_subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
 target_subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),case_id uuid NOT NULL UNIQUE REFERENCES public.v2_review_cases(id),
 expected_source_revision bigint NOT NULL CHECK(expected_source_revision>=1),expected_source_generation bigint NOT NULL CHECK(expected_source_generation>=1),
 expected_target_revision bigint NOT NULL CHECK(expected_target_revision>=1),expected_target_generation bigint NOT NULL CHECK(expected_target_generation>=1),
 payload jsonb CHECK(jsonb_typeof(payload)='object'),import_epoch bigint,
 review_decision_id uuid,FOREIGN KEY(review_decision_id,case_id) REFERENCES public.v2_review_decisions(id,case_id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','applied','rejected','reversed','invalidated','erased')),
 applied_source_revision bigint,applied_source_generation bigint,applied_target_revision bigint,applied_target_generation bigint,
 erased boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((erased AND payload IS NULL AND request_digest IS NULL AND state='erased') OR (NOT erased AND payload IS NOT NULL AND request_digest IS NOT NULL)),
 CHECK((kind='external_id')=(import_epoch IS NOT NULL))
);
CREATE INDEX v2_identity_source_idx ON public.v2_identity_bindings(source_subject_id);
CREATE INDEX v2_identity_target_idx ON public.v2_identity_bindings(target_subject_id);
CREATE TABLE public.v2_identity_binding_evidence(
 binding_id uuid NOT NULL REFERENCES public.v2_identity_bindings(id),observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 observation_revision bigint NOT NULL CHECK(observation_revision>=1),PRIMARY KEY(binding_id,observation_id)
);
CREATE INDEX v2_identity_observation_idx ON public.v2_identity_binding_evidence(observation_id);
CREATE TABLE public.v2_operator_aliases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_subject_id uuid NOT NULL REFERENCES public.v2_operators(subject_id),
 original_name text NOT NULL CHECK(public.v2_valid_operator_name(original_name)),normalised_name text NOT NULL,
 binding_id uuid NOT NULL UNIQUE REFERENCES public.v2_identity_bindings(id),provenance_decision_id uuid NOT NULL REFERENCES public.v2_review_decisions(id),
 active boolean NOT NULL DEFAULT true,CHECK(normalised_name=public.v2_operator_search_key(original_name))
);
CREATE INDEX v2_operator_alias_key_idx ON public.v2_operator_aliases(normalised_name,operator_subject_id) WHERE active;
CREATE TABLE public.v2_external_id_origins(
 mapping_id uuid PRIMARY KEY REFERENCES public.v2_external_ids(id),binding_id uuid NOT NULL UNIQUE REFERENCES public.v2_identity_bindings(id)
);
CREATE TABLE public.v2_identity_binding_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),binding_id uuid NOT NULL REFERENCES public.v2_identity_bindings(id),
 operation text NOT NULL CHECK(operation IN('applied','reversed','invalidated','erased')),
 review_decision_id uuid REFERENCES public.v2_review_decisions(id),actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION public.v2_identity_require_actor(actor varchar,admin_only boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND revoked_at IS NULL AND (NOT admin_only OR role='administrator'))
 THEN RAISE EXCEPTION 'identity_reviewer_required' USING ERRCODE='42501';END IF;
END;$$;
CREATE FUNCTION public.v2_identity_target_current(target uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.v2_subjects s WHERE s.id=target AND s.lifecycle='active')
 AND NOT EXISTS(SELECT 1 FROM public.v2_transport_creation_origins o WHERE o.subject_id=target AND public.v2_read_created_subject(target)->>'status' IS DISTINCT FROM 'reviewed_origin')
 AND NOT EXISTS(SELECT 1 FROM public.v2_transport_edit_heads h WHERE h.subject_id=target AND public.v2_read_transport(target)->>'status' IS DISTINCT FROM 'reviewed');
$$;
CREATE FUNCTION public.v2_identity_binding_current(binding uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.v2_identity_bindings p JOIN public.v2_review_cases c ON c.id=p.case_id
 JOIN public.v2_review_decisions d ON d.id=p.review_decision_id JOIN public.v2_subjects s ON s.id=p.source_subject_id
 JOIN public.v2_subjects t ON t.id=p.target_subject_id WHERE p.id=binding AND p.state='applied' AND NOT p.erased
 AND c.kind='identity' AND c.candidate_id IS NULL AND c.subject_id=p.source_subject_id AND c.last_decision_id=d.id AND c.state='resolved'
 AND d.case_id=c.id AND d.action='accept' AND NOT d.evidence_erased AND NOT d.actor_erased AND d.expected_subject_revision=p.expected_source_revision
 AND s.lifecycle='active' AND s.revision=p.applied_source_revision AND s.input_generation=p.applied_source_generation
 AND t.revision=p.applied_target_revision AND t.input_generation=p.applied_target_generation AND public.v2_identity_target_current(t.id)
 AND EXISTS(SELECT 1 FROM public.v2_identity_binding_evidence e WHERE e.binding_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM public.v2_identity_binding_evidence e JOIN public.v2_observation_states os ON os.observation_id=e.observation_id
 WHERE e.binding_id=p.id AND (os.status<>'active' OR os.revision<>e.observation_revision OR public.v2_observation_subject(e.observation_id)<>p.source_subject_id))
 AND (SELECT count(*) FROM public.v2_identity_binding_evidence WHERE binding_id=p.id)=(SELECT count(*) FROM public.v2_review_decision_evidence WHERE decision_id=d.id)
 AND NOT EXISTS(SELECT 1 FROM public.v2_identity_binding_evidence e WHERE e.binding_id=p.id AND NOT EXISTS(SELECT 1 FROM public.v2_review_decision_evidence re WHERE re.decision_id=d.id AND re.observation_id=e.observation_id))
 AND (p.kind='operator_alias' OR EXISTS(SELECT 1 FROM public.v2_import_revisions r WHERE r.source_namespace=p.payload->>'namespace' AND r.import_version=p.payload->>'version' AND r.epoch=p.import_epoch AND r.active)));
$$;

CREATE FUNCTION public.v2_lookup_operator_alias(name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[];more boolean;BEGIN
 IF NOT COALESCE(public.v2_valid_operator_name(name),false) THEN RAISE EXCEPTION 'identity_name_invalid' USING ERRCODE='23514';END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT DISTINCT a.operator_subject_id id FROM public.v2_operator_aliases a
 WHERE a.active AND a.normalised_name=public.v2_operator_search_key(name) AND public.v2_identity_binding_current(a.binding_id) ORDER BY id LIMIT 51) x;
 ids:=COALESCE(ids,'{}'::uuid[]);more:=cardinality(ids)>50;
 RETURN jsonb_build_object('status',CASE cardinality(ids) WHEN 0 THEN 'unresolved' WHEN 1 THEN 'resolved' ELSE 'ambiguous' END,
 'operatorId',CASE WHEN cardinality(ids)=1 THEN ids[1] END,'operatorIds',ids[1:50],'more',more);
END;$$;
CREATE FUNCTION public.v2_lookup_external_id(namespace text,kind text,external text,version text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.v2_import_revisions;m public.v2_external_ids;b uuid;BEGIN
 IF namespace IS NULL OR external IS NULL OR version IS NULL OR namespace<>btrim(namespace) OR external<>btrim(external) OR version<>btrim(version)
 OR length(namespace) NOT BETWEEN 1 AND 200 OR length(external) NOT BETWEEN 1 AND 200 OR length(version) NOT BETWEEN 1 AND 64
 OR kind IS NULL OR kind NOT IN('lead','operator','route','stop','pattern','service_plan','run','actual_journey') THEN RAISE EXCEPTION 'identity_external_request_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM public.v2_import_revisions WHERE source_namespace=namespace AND active;
 SELECT * INTO m FROM public.v2_external_ids WHERE source_namespace=namespace AND entity_kind=kind AND external_id=external AND active;
 IF r.request_id IS NULL THEN RETURN jsonb_build_object('status',CASE WHEN m.id IS NULL THEN 'unresolved' ELSE 'review_required' END);END IF;
 IF r.import_version<>version THEN RETURN jsonb_build_object('status','revision_mismatch');END IF;
 IF m.id IS NULL THEN RETURN jsonb_build_object('status','unresolved');END IF;
 SELECT o.binding_id INTO b FROM public.v2_external_id_origins o JOIN public.v2_identity_bindings p ON p.id=o.binding_id WHERE o.mapping_id=m.id
 AND p.target_subject_id=m.subject_id AND p.payload->>'namespace'=m.source_namespace AND p.payload->>'entityKind'=m.entity_kind
 AND p.payload->>'externalId'=m.external_id AND p.payload->>'version'=m.import_version;
 IF m.import_version<>version OR b IS NULL OR NOT public.v2_identity_binding_current(b) THEN RETURN jsonb_build_object('status','review_required');END IF;
 RETURN jsonb_build_object('status','resolved','subjectId',m.subject_id,'entityKind',m.entity_kind,'mappingId',m.id,'importEpoch',r.epoch);
END;$$;

CREATE FUNCTION public.v2_register_import_revision(actor varchar,namespace text,version text,expected bigint,request uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_import_revisions;current_epoch bigint;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;PERFORM public.v2_identity_require_actor(actor,true);
 IF request IS NULL OR expected IS NULL OR expected<0 OR namespace IS NULL OR namespace<>btrim(namespace) OR length(namespace) NOT BETWEEN 1 AND 200
 OR version IS NULL OR version<>btrim(version) OR length(version) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'identity_import_invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO receipt FROM public.v2_import_revisions WHERE request_id=request;
 IF FOUND THEN IF receipt.source_namespace<>namespace OR receipt.import_version<>version OR receipt.expected_epoch<>expected THEN RAISE EXCEPTION 'identity_import_request_conflict' USING ERRCODE='23514';END IF;RETURN receipt.epoch;END IF;
 SELECT COALESCE(max(epoch),0) INTO current_epoch FROM public.v2_import_revisions WHERE source_namespace=namespace;
 IF current_epoch<>expected THEN RAISE EXCEPTION 'identity_import_epoch_conflict' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.v2_import_revisions WHERE source_namespace=namespace AND import_version=version) THEN RAISE EXCEPTION 'identity_import_version_reuse' USING ERRCODE='23514';END IF;
 UPDATE public.v2_import_revisions SET active=false WHERE source_namespace=namespace AND active;
 INSERT INTO public.v2_import_revisions(request_id,source_namespace,import_version,epoch,expected_epoch) VALUES(request,namespace,version,current_epoch+1,expected);
 RETURN current_epoch+1;
END;$$;

CREATE FUNCTION public.v2_propose_identity_binding(actor varchar,kind text,source uuid,expected_source bigint,target uuid,expected_target bigint,evidence uuid[],context jsonb,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.v2_subjects;t public.v2_subjects;receipt public.v2_identity_bindings;digest text;payload jsonb;epoch bigint;result uuid;case_id uuid;name_observation public.v2_observations;prior_map uuid;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;PERFORM public.v2_identity_require_actor(actor,kind='external_id');
 IF kind IS NULL OR kind NOT IN('operator_alias','external_id') OR source IS NULL OR target IS NULL OR request IS NULL OR expected_source IS NULL OR expected_target IS NULL
 OR evidence IS NULL OR cardinality(evidence) NOT BETWEEN 1 AND 100 OR cardinality(evidence)<>(SELECT count(DISTINCT x) FROM unnest(evidence) x) OR context IS NULL OR jsonb_typeof(context)<>'object'
 THEN RAISE EXCEPTION 'identity_proposal_invalid' USING ERRCODE='23514';END IF;
 evidence:=ARRAY(SELECT x FROM unnest(evidence) x ORDER BY x);digest:=public.v2_assessment_hash(jsonb_build_array(actor,kind,source,expected_source,target,expected_target,evidence,context));
 SELECT * INTO receipt FROM public.v2_identity_bindings WHERE request_id=request;
 IF FOUND THEN IF receipt.erased OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'identity_request_conflict' USING ERRCODE='23514';END IF;RETURN receipt.id;END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=source FOR UPDATE;SELECT * INTO t FROM public.v2_subjects WHERE id=target FOR UPDATE;
 IF s.id IS NULL OR s.lifecycle<>'active' OR t.id IS NULL OR NOT public.v2_identity_target_current(target) THEN RAISE EXCEPTION 'identity_subject_unavailable' USING ERRCODE='23514';END IF;
 IF s.revision<>expected_source OR t.revision<>expected_target THEN RAISE EXCEPTION 'identity_subject_revision_conflict' USING ERRCODE='40001';END IF;
 IF (SELECT count(*) FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id WHERE o.id=ANY(evidence)
 AND os.status='active' AND o.original_subject_id=source AND public.v2_observation_subject(o.id)=source)<>cardinality(evidence) THEN RAISE EXCEPTION 'identity_evidence_unavailable' USING ERRCODE='23514';END IF;
 IF kind='operator_alias' THEN
  IF t.kind<>'operator' OR cardinality(evidence)<>1 OR context<>'{}'::jsonb THEN RAISE EXCEPTION 'identity_alias_context_invalid' USING ERRCODE='23514';END IF;
  SELECT * INTO name_observation FROM public.v2_observations WHERE id=evidence[1];
  IF name_observation.field_key<>'operator.reported' OR NOT name_observation.value ? 'name' THEN RAISE EXCEPTION 'identity_alias_name_proof_required' USING ERRCODE='23514';END IF;
  payload:=jsonb_build_object('name',name_observation.value->>'name','key',public.v2_operator_search_key(name_observation.value->>'name'));
 ELSE
  IF NOT context ?& ARRAY['namespace','externalId','version'] OR context-ARRAY['namespace','externalId','version']<>'{}'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_each(context) e WHERE jsonb_typeof(e.value)<>'string') THEN RAISE EXCEPTION 'identity_mapping_context_invalid' USING ERRCODE='23514';END IF;
  -- Validate exact opaque keys without case folding, version ordering or fallback.
  PERFORM public.v2_lookup_external_id(context->>'namespace',t.kind,context->>'externalId',context->>'version');
  SELECT r.epoch INTO epoch FROM public.v2_import_revisions r WHERE r.source_namespace=context->>'namespace' AND r.import_version=context->>'version' AND r.active;
  IF epoch IS NULL THEN RAISE EXCEPTION 'identity_import_revision_unavailable' USING ERRCODE='23514';END IF;
  SELECT id INTO prior_map FROM public.v2_external_ids WHERE source_namespace=context->>'namespace' AND entity_kind=t.kind AND external_id=context->>'externalId' AND active;
  payload:=jsonb_build_object('namespace',context->>'namespace','externalId',context->>'externalId','version',context->>'version','entityKind',t.kind,'previousMappingId',prior_map);
 END IF;
 case_id:=public.v2_open_review_case(actor,source,'identity',NULL,NULL);
 INSERT INTO public.v2_identity_bindings(request_id,request_digest,actor_user_id,kind,source_subject_id,target_subject_id,case_id,
 expected_source_revision,expected_source_generation,expected_target_revision,expected_target_generation,payload,import_epoch)
 VALUES(request,digest,actor,kind,source,target,case_id,s.revision,s.input_generation,t.revision,t.input_generation,payload,epoch) RETURNING id INTO result;
 INSERT INTO public.v2_identity_binding_evidence SELECT result,o.id,os.revision FROM public.v2_observations o JOIN public.v2_observation_states os ON os.observation_id=o.id WHERE o.id=ANY(evidence);
 RETURN result;
END;$$;
CREATE FUNCTION public.v2_review_identity_binding(actor varchar,binding uuid,expected_case bigint,operation text,reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_identity_bindings;s public.v2_subjects;t public.v2_subjects;result uuid;ids uuid[];BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO p FROM public.v2_identity_bindings WHERE id=binding FOR UPDATE;PERFORM public.v2_identity_require_actor(actor,p.kind='external_id');
 IF p.id IS NULL OR p.erased OR operation IS NULL OR operation NOT IN('accept','reject','needs_context') OR p.state<>'pending' THEN RAISE EXCEPTION 'identity_review_unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=p.source_subject_id FOR UPDATE;SELECT * INTO t FROM public.v2_subjects WHERE id=p.target_subject_id FOR UPDATE;
 IF s.revision<>p.expected_source_revision OR s.input_generation<>p.expected_source_generation OR t.revision<>p.expected_target_revision OR t.input_generation<>p.expected_target_generation
 OR s.lifecycle<>'active' OR NOT public.v2_identity_target_current(t.id) THEN RAISE EXCEPTION 'identity_review_context_changed' USING ERRCODE='40001';END IF;
 SELECT array_agg(observation_id ORDER BY observation_id) INTO ids FROM public.v2_identity_binding_evidence WHERE binding_id=binding;
 IF EXISTS(SELECT 1 FROM public.v2_identity_binding_evidence e JOIN public.v2_observation_states os ON os.observation_id=e.observation_id WHERE e.binding_id=binding AND (os.status<>'active' OR os.revision<>e.observation_revision))
 OR (p.kind='external_id' AND NOT EXISTS(SELECT 1 FROM public.v2_import_revisions r WHERE r.source_namespace=p.payload->>'namespace' AND r.import_version=p.payload->>'version' AND r.epoch=p.import_epoch AND r.active))
 THEN RAISE EXCEPTION 'identity_review_evidence_changed' USING ERRCODE='40001';END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid DEFERRED;
 result:=public.v2_record_review(actor,p.case_id,expected_case,s.revision,operation,reason,NULL,ids,'identity-lookup/1',NULL);
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid IMMEDIATE;
 UPDATE public.v2_identity_bindings SET review_decision_id=result,state=CASE WHEN operation='accept' THEN 'pending' ELSE 'rejected' END WHERE id=binding;RETURN result;
END;$$;

CREATE FUNCTION public.v2_apply_identity_binding(actor varchar,binding uuid,approval uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_identity_bindings;s public.v2_subjects;t public.v2_subjects;r public.v2_review_decisions;c public.v2_review_cases;mapping uuid;current_map uuid;ids uuid[];BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO p FROM public.v2_identity_bindings WHERE id=binding FOR UPDATE;PERFORM public.v2_identity_require_actor(actor,p.kind='external_id');
 IF p.id IS NULL OR p.erased OR p.review_decision_id IS DISTINCT FROM approval THEN RAISE EXCEPTION 'identity_approval_unavailable' USING ERRCODE='23514';END IF;
 IF p.state='applied' THEN RETURN p.id;END IF;
 IF p.state<>'pending' THEN RAISE EXCEPTION 'identity_binding_not_pending' USING ERRCODE='23514';END IF;
 SET CONSTRAINTS public.v2_identity_projection_valid DEFERRED;
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=approval;SELECT * INTO c FROM public.v2_review_cases WHERE id=p.case_id;
 SELECT * INTO s FROM public.v2_subjects WHERE id=p.source_subject_id FOR UPDATE;SELECT * INTO t FROM public.v2_subjects WHERE id=p.target_subject_id FOR UPDATE;
 IF r.id IS NULL OR r.case_id<>p.case_id OR r.action<>'accept' OR r.actor_erased OR r.evidence_erased OR c.last_decision_id IS DISTINCT FROM approval OR c.candidate_id IS NOT NULL OR c.state<>'resolved'
 OR r.expected_subject_revision<>p.expected_source_revision OR s.lifecycle<>'active' OR s.revision<>p.expected_source_revision+1 OR s.input_generation<>p.expected_source_generation+1
 OR t.revision<>p.expected_target_revision+(CASE WHEN s.id=t.id THEN 1 ELSE 0 END) OR t.input_generation<>p.expected_target_generation+(CASE WHEN s.id=t.id THEN 1 ELSE 0 END)
 OR NOT public.v2_identity_target_current(t.id) THEN RAISE EXCEPTION 'identity_apply_context_changed' USING ERRCODE='40001';END IF;
 SELECT array_agg(observation_id ORDER BY observation_id) INTO ids FROM public.v2_identity_binding_evidence WHERE binding_id=binding;
 IF ids IS NULL OR cardinality(ids)<>(SELECT count(*) FROM public.v2_review_decision_evidence WHERE decision_id=approval)
 OR EXISTS(SELECT 1 FROM public.v2_identity_binding_evidence e JOIN public.v2_observation_states os ON os.observation_id=e.observation_id WHERE e.binding_id=binding
 AND (os.status<>'active' OR os.revision<>e.observation_revision OR public.v2_observation_subject(e.observation_id)<>p.source_subject_id
 OR NOT EXISTS(SELECT 1 FROM public.v2_review_decision_evidence re WHERE re.decision_id=approval AND re.observation_id=e.observation_id)))
 THEN RAISE EXCEPTION 'identity_apply_evidence_changed' USING ERRCODE='23514';END IF;
 IF p.kind='operator_alias' THEN
  INSERT INTO public.v2_operator_aliases(operator_subject_id,original_name,normalised_name,binding_id,provenance_decision_id)
   VALUES(t.id,p.payload->>'name',p.payload->>'key',p.id,approval);
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.v2_import_revisions ir WHERE ir.source_namespace=p.payload->>'namespace' AND ir.import_version=p.payload->>'version' AND ir.epoch=p.import_epoch AND ir.active)
  THEN RAISE EXCEPTION 'identity_import_revision_changed' USING ERRCODE='40001';END IF;
  SELECT id INTO current_map FROM public.v2_external_ids WHERE source_namespace=p.payload->>'namespace' AND entity_kind=t.kind AND external_id=p.payload->>'externalId' AND active;
  IF current_map IS DISTINCT FROM (p.payload->>'previousMappingId')::uuid THEN RAISE EXCEPTION 'identity_mapping_head_changed' USING ERRCODE='40001';END IF;
  UPDATE public.v2_external_ids SET active=false WHERE id=current_map;
  INSERT INTO public.v2_external_ids(source_namespace,entity_kind,external_id,subject_id,import_version)
   VALUES(p.payload->>'namespace',t.kind,p.payload->>'externalId',t.id,p.payload->>'version') RETURNING id INTO mapping;
  INSERT INTO public.v2_external_id_origins VALUES(mapping,p.id);
 END IF;
 -- Existing external-ID propagation can legitimately advance these epochs during the effect.
 SELECT * INTO s FROM public.v2_subjects WHERE id=p.source_subject_id;SELECT * INTO t FROM public.v2_subjects WHERE id=p.target_subject_id;
 UPDATE public.v2_identity_bindings SET state='applied',applied_source_revision=s.revision,applied_source_generation=s.input_generation,
 applied_target_revision=t.revision,applied_target_generation=t.input_generation WHERE id=p.id;
 INSERT INTO public.v2_identity_binding_events(binding_id,operation,review_decision_id,actor_user_id) VALUES(p.id,'applied',approval,actor);
 SET CONSTRAINTS public.v2_identity_projection_valid IMMEDIATE;
 RETURN p.id;
END;$$;

CREATE FUNCTION public.v2_identity_wake_alias(key text,erase boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ids uuid[];decisions uuid[];corridors uuid[];BEGIN
 SELECT array_agg(c.id) INTO ids FROM public.v2_association_candidates c JOIN public.v2_normalised_leads n ON n.subject_id=c.from_subject_id
 WHERE n.operator_key=key AND c.rule_version='lead-association/1' AND c.reason_codes && ARRAY['reviewed_operator_alias_hint','operator_alias_ambiguous','reviewed_alias_other_operator'];
 SELECT array_agg(d.id) INTO decisions FROM public.v2_association_decisions d WHERE d.candidate_id=ANY(ids);
 PERFORM public.v2_invalidate_derived(decisions,erase);
 UPDATE public.v2_association_candidates SET state='obsolete',evidence_erased=evidence_erased OR erase,evidence_digest=CASE WHEN erase THEN NULL ELSE evidence_digest END WHERE id=ANY(ids);
 SELECT array_agg(DISTINCT corridor_id) INTO corridors FROM public.v2_normalised_leads WHERE operator_key=key;
 UPDATE public.v2_association_catalog SET revision=revision+1 WHERE corridor_id=ANY(corridors);
 PERFORM public.v2_wake_lead_association(corridors);
END;$$;
CREATE FUNCTION public.v2_identity_detach(binding uuid,erase boolean) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE key text;BEGIN
 SELECT normalised_name INTO key FROM public.v2_operator_aliases WHERE binding_id=binding;
 IF erase THEN DELETE FROM public.v2_operator_aliases WHERE binding_id=binding;ELSE UPDATE public.v2_operator_aliases SET active=false WHERE binding_id=binding AND active;END IF;
 UPDATE public.v2_external_ids SET active=false WHERE active AND id IN(SELECT mapping_id FROM public.v2_external_id_origins WHERE binding_id=binding);
 IF key IS NOT NULL THEN PERFORM public.v2_identity_wake_alias(key,erase);END IF;
END;$$;
CREATE FUNCTION public.v2_invalidate_identity_binding(binding uuid,erase boolean DEFAULT false,reverse boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.v2_identity_bindings;BEGIN
 SELECT * INTO p FROM public.v2_identity_bindings WHERE id=binding FOR UPDATE;
 IF p.id IS NULL OR p.erased OR (NOT erase AND p.state IN('invalidated','reversed','rejected')) THEN RETURN;END IF;
 -- Referential actor cleanup may still be pending in a multi-account DELETE.
 IF p.actor_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=p.actor_user_id) THEN
  UPDATE public.v2_identity_bindings SET actor_user_id=NULL WHERE id=binding;RETURN;
 END IF;
 UPDATE public.v2_identity_bindings SET state=CASE WHEN erase THEN 'erased' WHEN reverse THEN 'reversed' ELSE 'invalidated' END,
 erased=erased OR erase,payload=CASE WHEN erase THEN NULL ELSE payload END,request_digest=CASE WHEN erase THEN NULL ELSE request_digest END WHERE id=binding;
 PERFORM public.v2_identity_detach(binding,erase);
 INSERT INTO public.v2_identity_binding_events(binding_id,operation,review_decision_id) VALUES(binding,CASE WHEN erase THEN 'erased' WHEN reverse THEN 'reversed' ELSE 'invalidated' END,
 CASE WHEN reverse THEN (SELECT last_decision_id FROM public.v2_review_cases WHERE id=p.case_id) ELSE p.review_decision_id END);
END;$$;
CREATE FUNCTION public.v2_reverse_identity_binding(actor varchar,binding uuid,expected_case bigint,reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_identity_bindings;s public.v2_subjects;result uuid;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(actor));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO p FROM public.v2_identity_bindings WHERE id=binding FOR UPDATE;PERFORM public.v2_identity_require_actor(actor,p.kind='external_id');
 IF p.id IS NULL OR p.erased OR p.state<>'applied' THEN RAISE EXCEPTION 'identity_reverse_unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public.v2_subjects WHERE id=p.source_subject_id FOR UPDATE;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid DEFERRED;
 result:=public.v2_record_review(actor,p.case_id,expected_case,s.revision,'reverse',reason,NULL,'{}'::uuid[],'identity-lookup/1',p.review_decision_id);
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_current_field_valid,public.v2_current_association_valid IMMEDIATE;
 PERFORM public.v2_invalidate_identity_binding(binding,false,true);RETURN result;
END;$$;

CREATE FUNCTION public.v2_identity_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE b uuid;BEGIN
 IF TG_TABLE_NAME='v2_observations' THEN
  FOR b IN SELECT binding_id FROM public.v2_identity_binding_evidence WHERE observation_id=OLD.id LOOP PERFORM public.v2_invalidate_identity_binding(b,true);END LOOP;RETURN OLD;
 ELSIF TG_TABLE_NAME='v2_observation_states' THEN
  IF OLD.revision=NEW.revision AND OLD.status=NEW.status THEN RETURN NEW;END IF;
  FOR b IN SELECT binding_id FROM public.v2_identity_binding_evidence WHERE observation_id=NEW.observation_id LOOP PERFORM public.v2_invalidate_identity_binding(b);END LOOP;
 ELSIF TG_TABLE_NAME='v2_subjects' THEN
  IF (OLD.revision,OLD.input_generation,OLD.lifecycle) IS NOT DISTINCT FROM (NEW.revision,NEW.input_generation,NEW.lifecycle) THEN RETURN NEW;END IF;
  FOR b IN SELECT id FROM public.v2_identity_bindings WHERE state='applied' AND NEW.id IN(source_subject_id,target_subject_id) LOOP
   IF NOT public.v2_identity_binding_current(b) THEN PERFORM public.v2_invalidate_identity_binding(b);END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='v2_review_cases' THEN
  FOR b IN SELECT id FROM public.v2_identity_bindings WHERE case_id=NEW.id AND state='applied' AND review_decision_id IS DISTINCT FROM NEW.last_decision_id LOOP
   PERFORM public.v2_invalidate_identity_binding(b,false,EXISTS(SELECT 1 FROM public.v2_review_decisions WHERE id=NEW.last_decision_id AND action='reverse'));
  END LOOP;
 ELSIF TG_TABLE_NAME='v2_import_revisions' THEN
  IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active THEN
   FOR b IN SELECT id FROM public.v2_identity_bindings WHERE state='applied' AND kind='external_id' AND payload->>'namespace'=NEW.source_namespace AND import_epoch=NEW.epoch LOOP PERFORM public.v2_invalidate_identity_binding(b);END LOOP;
  END IF;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_identity_evidence_delete BEFORE DELETE ON public.v2_observations FOR EACH ROW EXECUTE FUNCTION public.v2_identity_change();
CREATE TRIGGER v2_identity_evidence_change AFTER UPDATE ON public.v2_observation_states FOR EACH ROW EXECUTE FUNCTION public.v2_identity_change();
CREATE TRIGGER v2_identity_subject_change AFTER UPDATE ON public.v2_subjects FOR EACH ROW EXECUTE FUNCTION public.v2_identity_change();
CREATE TRIGGER v2_identity_review_change AFTER UPDATE ON public.v2_review_cases FOR EACH ROW EXECUTE FUNCTION public.v2_identity_change();
CREATE TRIGGER v2_identity_import_change AFTER UPDATE ON public.v2_import_revisions FOR EACH ROW EXECUTE FUNCTION public.v2_identity_change();

CREATE FUNCTION public.v2_identity_seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='v2_operator_aliases' AND EXISTS(SELECT 1 FROM public.v2_identity_bindings WHERE id=OLD.binding_id AND erased) THEN RETURN OLD;END IF;
  IF TG_TABLE_NAME='v2_identity_binding_evidence' AND pg_trigger_depth()>1 AND EXISTS(SELECT 1 FROM public.v2_identity_bindings WHERE id=OLD.binding_id AND erased) THEN RETURN OLD;END IF;
 ELSIF TG_TABLE_NAME='v2_identity_bindings' THEN
  IF pg_trigger_depth()>1 AND OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL THEN
   NEW.erased:=true;NEW.payload:=NULL;NEW.request_digest:=NULL;NEW.state:='erased';RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','review_decision_id','applied_source_revision','applied_source_generation','applied_target_revision','applied_target_generation'])=
     (to_jsonb(OLD)-ARRAY['state','review_decision_id','applied_source_revision','applied_source_generation','applied_target_revision','applied_target_generation']) THEN RETURN NEW;END IF;
  IF pg_trigger_depth()>1 AND NEW.erased AND NEW.payload IS NULL AND NEW.request_digest IS NULL AND
   (to_jsonb(NEW)-ARRAY['state','erased','payload','request_digest'])=(to_jsonb(OLD)-ARRAY['state','erased','payload','request_digest']) THEN RETURN NEW;END IF;
 ELSIF TG_TABLE_NAME IN('v2_operator_aliases','v2_import_revisions') THEN
  IF OLD.active AND NOT NEW.active AND (to_jsonb(NEW)-'active')=(to_jsonb(OLD)-'active') THEN RETURN NEW;END IF;
 ELSIF TG_TABLE_NAME='v2_identity_binding_events' AND pg_trigger_depth()>1 AND NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
 AND (to_jsonb(NEW)-'actor_user_id')=(to_jsonb(OLD)-'actor_user_id') THEN RETURN NEW;
 END IF;RAISE EXCEPTION 'identity_history_sealed' USING ERRCODE='23514';END;$$;
CREATE FUNCTION public.v2_identity_actor_erasure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.erased AND NOT OLD.erased THEN PERFORM public.v2_identity_detach(NEW.id,true);
  INSERT INTO public.v2_identity_binding_events(binding_id,operation,review_decision_id) VALUES(NEW.id,'erased',NEW.review_decision_id);
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_identity_actor_erasure AFTER UPDATE OF actor_user_id ON public.v2_identity_bindings FOR EACH ROW EXECUTE FUNCTION public.v2_identity_actor_erasure();
CREATE FUNCTION public.v2_identity_projection_valid() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.v2_identity_bindings;a public.v2_operator_aliases;m public.v2_external_ids;BEGIN
 IF TG_TABLE_NAME='v2_operator_aliases' THEN
  SELECT * INTO a FROM public.v2_operator_aliases WHERE id=NEW.id;IF a.id IS NULL OR NOT a.active THEN RETURN NULL;END IF;
  SELECT * INTO p FROM public.v2_identity_bindings WHERE id=a.binding_id;
  IF p.kind<>'operator_alias' OR p.target_subject_id<>a.operator_subject_id OR p.review_decision_id<>a.provenance_decision_id
  OR p.payload->>'name'<>a.original_name OR p.payload->>'key'<>a.normalised_name OR NOT public.v2_identity_binding_current(p.id) THEN RAISE EXCEPTION 'identity_alias_projection_invalid' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO m FROM public.v2_external_ids WHERE id=NEW.mapping_id;IF m.id IS NULL OR NOT m.active THEN RETURN NULL;END IF;
  SELECT * INTO p FROM public.v2_identity_bindings WHERE id=NEW.binding_id;
  IF p.kind<>'external_id' OR p.target_subject_id<>m.subject_id OR p.payload->>'namespace'<>m.source_namespace OR p.payload->>'entityKind'<>m.entity_kind
  OR p.payload->>'externalId'<>m.external_id OR p.payload->>'version'<>m.import_version OR NOT public.v2_identity_binding_current(p.id) THEN RAISE EXCEPTION 'identity_mapping_projection_invalid' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER v2_identity_projection_valid AFTER INSERT OR UPDATE ON public.v2_operator_aliases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_identity_projection_valid();
CREATE CONSTRAINT TRIGGER v2_identity_projection_valid AFTER INSERT OR UPDATE ON public.v2_external_id_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_identity_projection_valid();
CREATE FUNCTION public.v2_identity_alias_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' THEN PERFORM public.v2_identity_wake_alias(NEW.normalised_name);
 ELSIF TG_OP='UPDATE' THEN PERFORM public.v2_identity_wake_alias(NEW.normalised_name);
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_identity_alias_change AFTER INSERT OR UPDATE ON public.v2_operator_aliases FOR EACH ROW EXECUTE FUNCTION public.v2_identity_alias_change();

-- Generic review primitives must respect this bound workflow too; authority is not a UI convention.
CREATE FUNCTION public.v2_identity_case_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_identity_bindings WHERE case_id=NEW.id) AND
  (NEW.subject_id,NEW.subject_kind,NEW.kind,NEW.field_key,NEW.scope_key,NEW.candidate_id) IS DISTINCT FROM
  (OLD.subject_id,OLD.subject_kind,OLD.kind,OLD.field_key,OLD.scope_key,OLD.candidate_id) THEN RAISE EXCEPTION 'identity_case_sealed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER v2_identity_case_guard BEFORE UPDATE ON public.v2_review_cases FOR EACH ROW EXECUTE FUNCTION public.v2_identity_case_guard();
CREATE FUNCTION public.v2_identity_review_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.v2_identity_bindings;s public.v2_subjects;t public.v2_subjects;BEGIN
 SELECT * INTO p FROM public.v2_identity_bindings WHERE case_id=NEW.case_id;IF NOT FOUND THEN RETURN NEW;END IF;
 PERFORM public.v2_identity_require_actor(NEW.actor_user_id,p.kind='external_id');
 IF p.erased OR NEW.policy_version<>'identity-lookup/1' OR NEW.action NOT IN('accept','reject','needs_context','reverse') THEN RAISE EXCEPTION 'identity_bound_review_required' USING ERRCODE='23514';END IF;
 IF NEW.action='reverse' THEN
  IF p.state<>'applied' OR NEW.reverses_decision_id IS DISTINCT FROM p.review_decision_id OR NOT public.v2_identity_binding_current(p.id) THEN RAISE EXCEPTION 'identity_reverse_context_changed' USING ERRCODE='40001';END IF;
 ELSE
  SELECT * INTO s FROM public.v2_subjects WHERE id=p.source_subject_id;SELECT * INTO t FROM public.v2_subjects WHERE id=p.target_subject_id;
  IF p.state<>'pending' OR NEW.expected_subject_revision<>p.expected_source_revision OR s.revision<>p.expected_source_revision OR s.input_generation<>p.expected_source_generation
  OR t.revision<>p.expected_target_revision OR t.input_generation<>p.expected_target_generation OR NOT public.v2_identity_target_current(t.id)
  THEN RAISE EXCEPTION 'identity_bound_review_context_changed' USING ERRCODE='40001';END IF;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER v2_identity_review_guard BEFORE INSERT ON public.v2_review_decisions FOR EACH ROW EXECUTE FUNCTION public.v2_identity_review_guard();

-- Names and external IDs stay private to the restricted backend. Mutation facades remain owner-only.
DO $$ DECLARE t text;r text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['v2_import_revisions','v2_identity_bindings','v2_identity_binding_evidence','v2_operator_aliases','v2_external_id_origins','v2_identity_binding_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,mabhazi_api',t);
  EXECUTE format('GRANT SELECT ON public.%I TO mabhazi_api',t);EXECUTE format('CREATE POLICY v2_identity_api ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_identity_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
  EXECUTE format('CREATE TRIGGER v2_identity_seal BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_identity_seal()',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'v2_identity_%' OR proname IN('v2_lookup_operator_alias','v2_lookup_external_id','v2_register_import_revision','v2_propose_identity_binding','v2_review_identity_binding','v2_apply_identity_binding','v2_reverse_identity_binding','v2_invalidate_identity_binding')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
END;$$;
GRANT EXECUTE ON FUNCTION public.v2_lookup_operator_alias(text),public.v2_lookup_external_id(text,text,text,text) TO mabhazi_api;

-- Same fence body as the0025 private lead consumer; refuse unknown live changes.
DO $identity_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_worker_finish_lead(uuid,uuid)'::regprocedure;
 body:=replace(body,chr(13)||chr(10),chr(10));definition:=replace(definition,chr(13)||chr(10),chr(10));
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'220f0f9027422361042e78c9578af4c4b70ff651e7bca05579a94618e8f19939' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'identity_prior_function_changed';END IF;
 IF position(replace($old0$last_target uuid;$old0$,chr(13)||chr(10),chr(10)) IN definition)=0 THEN RAISE EXCEPTION 'identity_patch_anchor_missing';END IF;
 definition:=replace(definition,replace($old0$last_target uuid;$old0$,chr(13)||chr(10),chr(10)),replace($new0$last_target uuid; alias_context jsonb;$new0$,chr(13)||chr(10),chr(10)));
 IF position(replace($old1$SELECT revision INTO epoch FROM public.v2_association_catalog$old1$,chr(13)||chr(10),chr(10)) IN definition)=0 THEN RAISE EXCEPTION 'identity_patch_anchor_missing';END IF;
 definition:=replace(definition,replace($old1$SELECT revision INTO epoch FROM public.v2_association_catalog$old1$,chr(13)||chr(10),chr(10)),replace($new1$alias_context:=CASE WHEN n.operator_key IS NOT NULL THEN public.v2_lookup_operator_alias(n.operator_key) ELSE '{}'::jsonb END;
 SELECT revision INTO epoch FROM public.v2_association_catalog$new1$,chr(13)||chr(10),chr(10)));
 IF position(replace($old2$IF target.kind='run' THEN$old2$,chr(13)||chr(10),chr(10)) IN definition)=0 THEN RAISE EXCEPTION 'identity_patch_anchor_missing';END IF;
 definition:=replace(definition,replace($old2$IF target.kind='run' THEN$old2$,chr(13)||chr(10),chr(10)),replace($new2$IF alias_context->>'status'='ambiguous' THEN reasons:=array_append(reasons,'operator_alias_ambiguous');
  ELSIF alias_context->>'status'='resolved' THEN
   reasons:=array_append(reasons,CASE WHEN (alias_context->>'operatorId')::uuid=target_operator THEN 'reviewed_operator_alias_hint' ELSE 'reviewed_alias_other_operator' END);
  END IF;
  -- An alias explains candidate context; it does not assign this report to a scheduled run.
  IF target.kind='run' THEN$new2$,chr(13)||chr(10),chr(10)));
 IF position(replace($old3$basis:=public.v2_assessment_hash(jsonb_build_object('policy','lead-association/1','relation',candidate_relation,
   'from',source.id,'corridor',n.corridor_id,'operator',n.operator_subject_id,'operatorKey',n.operator_key,
   'seconds',n.departure_seconds,'timeBasis',n.time_basis,'to',target.id,'snapshot',public.v2_transport_snapshot(target.id),
   'evidence',(SELECT jsonb_agg(jsonb_build_array(observation_id,revision) ORDER BY observation_id) FROM public.v2_observation_states
    WHERE observation_id=ANY(ARRAY[n.operator_observation_id,n.departure_observation_id,target_lead.operator_observation_id,target_lead.departure_observation_id]))));$old3$,chr(13)||chr(10),chr(10)) IN definition)=0 THEN RAISE EXCEPTION 'identity_patch_anchor_missing';END IF;
 definition:=replace(definition,replace($old3$basis:=public.v2_assessment_hash(jsonb_build_object('policy','lead-association/1','relation',candidate_relation,
   'from',source.id,'corridor',n.corridor_id,'operator',n.operator_subject_id,'operatorKey',n.operator_key,
   'seconds',n.departure_seconds,'timeBasis',n.time_basis,'to',target.id,'snapshot',public.v2_transport_snapshot(target.id),
   'evidence',(SELECT jsonb_agg(jsonb_build_array(observation_id,revision) ORDER BY observation_id) FROM public.v2_observation_states
    WHERE observation_id=ANY(ARRAY[n.operator_observation_id,n.departure_observation_id,target_lead.operator_observation_id,target_lead.departure_observation_id]))));$old3$,chr(13)||chr(10),chr(10)),replace($new3$basis:=public.v2_assessment_hash(jsonb_build_object('policy','lead-association/1','relation',candidate_relation,
   'from',source.id,'corridor',n.corridor_id,'operator',n.operator_subject_id,'operatorKey',n.operator_key,
   'seconds',n.departure_seconds,'timeBasis',n.time_basis,'to',target.id,'snapshot',public.v2_transport_snapshot(target.id),
   'evidence',(SELECT jsonb_agg(jsonb_build_array(observation_id,revision) ORDER BY observation_id) FROM public.v2_observation_states
    WHERE observation_id=ANY(ARRAY[n.operator_observation_id,n.departure_observation_id,target_lead.operator_observation_id,target_lead.departure_observation_id]))) || CASE WHEN alias_context->>'status' IN('resolved','ambiguous') THEN jsonb_build_object('aliasContext',alias_context) ELSE '{}'::jsonb END);$new3$,chr(13)||chr(10),chr(10)));
 EXECUTE definition;
END;$identity_patch$;

DO $erase_patch$ DECLARE definition text;body text;secure boolean;settings text[];BEGIN
 SELECT pg_get_functiondef(oid),prosrc,prosecdef,proconfig INTO definition,body,secure,settings FROM pg_proc WHERE oid='public.v2_erase_review_evidence()'::regprocedure;
 body:=replace(body,chr(13)||chr(10),chr(10));definition:=replace(definition,chr(13)||chr(10),chr(10));
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'a7e01a56d9b30b262e2365abc37723791720db4fbb00643a52e8e499c4c1432a' OR secure IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'identity_prior_erase_function_changed';END IF;
 IF position($erase_old$UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE case_id=ANY(changed_cases);$erase_old$ IN definition)=0 THEN RAISE EXCEPTION 'identity_erase_anchor_missing';END IF;
 definition:=replace(definition,$erase_old$UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE case_id=ANY(changed_cases);$erase_old$,replace($erase_new$-- A single statement may delete both the reporter and a decision actor.
  -- Clear an actor already absent in this statement before a redaction rechecks its FK.
  -- The existing immutable-history trigger sets actor_erased and removes private notes.
  UPDATE public.v2_review_decisions d SET actor_user_id=NULL WHERE d.case_id=ANY(changed_cases) AND d.actor_user_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=d.actor_user_id);
  UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE case_id=ANY(changed_cases);$erase_new$,chr(13)||chr(10),chr(10)));
 EXECUTE definition;
END;$erase_patch$;
