-- Affiliation is an account/operator relationship, not a route confidence badge.
-- Dedicated proof never reuses a route observation as proof of employment.
CREATE TABLE public.v2_affiliation_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL UNIQUE REFERENCES public.v2_review_cases(id),
 operator_subject_id uuid NOT NULL REFERENCES public.v2_operators(subject_id),
 claimant_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 claimed_role text CHECK(length(btrim(claimed_role)) BETWEEN 1 AND 80),
 request_id uuid NOT NULL UNIQUE, request_digest text,
 erased boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((erased AND claimant_user_id IS NULL AND claimed_role IS NULL AND request_digest IS NULL)
   OR (NOT erased AND claimant_user_id IS NOT NULL AND claimed_role IS NOT NULL AND request_digest IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$'))
);
CREATE UNIQUE INDEX v2_affiliation_account_operator ON public.v2_affiliation_claims(claimant_user_id,operator_subject_id) WHERE NOT erased;
CREATE TABLE public.v2_affiliation_proofs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES public.v2_affiliation_claims(id),
 owner_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN('authorization_document','independent_confirmation')),
 observed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 private_reference text CHECK(length(btrim(private_reference)) BETWEEN 1 AND 2048),
 request_id uuid NOT NULL UNIQUE, request_digest text,
 erased boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>observed_at AND expires_at<=observed_at+interval '180 days'),
 CHECK((erased AND owner_user_id IS NULL AND private_reference IS NULL AND request_digest IS NULL)
   OR (NOT erased AND owner_user_id IS NOT NULL AND private_reference IS NOT NULL AND request_digest IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$'))
);
CREATE INDEX v2_affiliation_proof_owner ON public.v2_affiliation_proofs(owner_user_id);
CREATE INDEX v2_affiliation_proof_claim ON public.v2_affiliation_proofs(claim_id);
CREATE TABLE public.v2_affiliation_resolutions (
 review_id uuid PRIMARY KEY REFERENCES public.v2_review_decisions(id),
 claim_id uuid NOT NULL REFERENCES public.v2_affiliation_claims(id),
 valid_until timestamptz, request_id uuid NOT NULL UNIQUE, request_digest text,
 evidence_erased boolean NOT NULL DEFAULT false, receipt_redacted boolean NOT NULL DEFAULT false,
 CHECK((receipt_redacted AND request_digest IS NULL) OR (NOT receipt_redacted AND request_digest IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$'))
);
CREATE INDEX v2_affiliation_resolution_claim ON public.v2_affiliation_resolutions(claim_id);
CREATE TABLE public.v2_affiliation_resolution_proofs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL REFERENCES public.v2_affiliation_resolutions(review_id),
 proof_id uuid REFERENCES public.v2_affiliation_proofs(id), erased boolean NOT NULL DEFAULT false,
 UNIQUE(review_id,proof_id), CHECK((erased AND proof_id IS NULL) OR (NOT erased AND proof_id IS NOT NULL))
);
CREATE INDEX v2_affiliation_bound_proof ON public.v2_affiliation_resolution_proofs(proof_id);
CREATE TABLE public.v2_source_issuer_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid REFERENCES public.v2_sources(id) ON DELETE SET NULL,
 operator_subject_id uuid REFERENCES public.v2_operators(subject_id),
 affiliation_review_id uuid REFERENCES public.v2_affiliation_resolutions(review_id),
 revision bigint NOT NULL CHECK(revision>=1), previous_event_id uuid REFERENCES public.v2_source_issuer_events(id),
 action text NOT NULL CHECK(action IN('claim','withdraw')), actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 request_id uuid NOT NULL UNIQUE, request_digest text, erased boolean NOT NULL DEFAULT false,
 receipt_redacted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_id,revision),
 CHECK((erased AND source_id IS NULL AND operator_subject_id IS NULL AND affiliation_review_id IS NULL AND actor_user_id IS NULL)
   OR (NOT erased AND source_id IS NOT NULL AND actor_user_id IS NOT NULL AND ((action='claim' AND operator_subject_id IS NOT NULL)
    OR (action='withdraw' AND operator_subject_id IS NULL AND affiliation_review_id IS NULL)))),
 CHECK((receipt_redacted AND request_digest IS NULL) OR (NOT receipt_redacted AND request_digest IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$'))
);
CREATE INDEX v2_issuer_affiliation ON public.v2_source_issuer_events(affiliation_review_id);
CREATE TABLE public.v2_source_issuers (
 source_id uuid PRIMARY KEY REFERENCES public.v2_sources(id) ON DELETE CASCADE,
 event_id uuid NOT NULL UNIQUE REFERENCES public.v2_source_issuer_events(id), revision bigint NOT NULL CHECK(revision>=1)
);

CREATE FUNCTION public.v2_affiliation_valid(review uuid,as_of timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.v2_affiliation_resolutions a JOIN public.v2_review_decisions d ON d.id=a.review_id
 JOIN public.v2_affiliation_claims c ON c.id=a.claim_id JOIN public.v2_review_cases r ON r.id=c.case_id
 JOIN public.v2_subjects s ON s.id=c.operator_subject_id
 WHERE a.review_id=review AND NOT a.evidence_erased AND NOT d.evidence_erased AND NOT c.erased AND s.lifecycle='active'
 AND r.last_decision_id=d.id AND r.state='resolved' AND d.action='verify_affiliation' AND d.created_at<=as_of AND as_of<a.valid_until
 AND EXISTS(SELECT 1 FROM public.v2_affiliation_resolution_proofs b WHERE b.review_id=d.id)
 AND NOT EXISTS(SELECT 1 FROM public.v2_affiliation_resolution_proofs b LEFT JOIN public.v2_affiliation_proofs p ON p.id=b.proof_id
   WHERE b.review_id=d.id AND (b.erased OR p.erased OR p.id IS NULL OR as_of>=p.expires_at)));
$$;
CREATE FUNCTION public.v2_read_affiliation_at(claim uuid,as_of timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT jsonb_build_object('status',CASE WHEN c.erased THEN 'erased'
   WHEN public.v2_affiliation_valid(r.last_decision_id,as_of) THEN 'verified_affiliation'
   WHEN d.action='verify_affiliation' THEN 'recheck_required' WHEN d.action='revoke_affiliation' THEN 'revoked'
   WHEN d.action='reject' THEN 'rejected' ELSE 'pending' END,
   'validUntil',CASE WHEN public.v2_affiliation_valid(r.last_decision_id,as_of) THEN a.valid_until END)
 FROM public.v2_affiliation_claims c JOIN public.v2_review_cases r ON r.id=c.case_id
 LEFT JOIN public.v2_review_decisions d ON d.id=r.last_decision_id
 LEFT JOIN public.v2_affiliation_resolutions a ON a.review_id=d.id WHERE c.id=claim),jsonb_build_object('status','missing'));
$$;
CREATE FUNCTION public.v2_read_affiliation(claim uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.v2_read_affiliation_at(claim,statement_timestamp()); $$;
CREATE FUNCTION public.v2_read_source_issuer_at(source uuid,as_of timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT jsonb_build_object('operatorId',e.operator_subject_id,'status',
   CASE WHEN public.v2_affiliation_valid(e.affiliation_review_id,as_of) THEN 'affiliated_submitter' ELSE 'issuer_claimed' END,
   'validUntil',CASE WHEN public.v2_affiliation_valid(e.affiliation_review_id,as_of) THEN a.valid_until END)
 FROM public.v2_source_issuers c JOIN public.v2_source_issuer_events e ON e.id=c.event_id
 JOIN public.v2_subjects s ON s.id=e.operator_subject_id LEFT JOIN public.v2_affiliation_resolutions a ON a.review_id=e.affiliation_review_id
 WHERE c.source_id=source AND NOT e.erased AND e.action='claim' AND s.lifecycle='active' AND e.created_at<=as_of),jsonb_build_object('status','unknown'));
$$;
CREATE FUNCTION public.v2_read_source_issuer(source uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.v2_read_source_issuer_at(source,statement_timestamp()); $$;

CREATE FUNCTION public.v2_affiliation_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
  IF TG_TABLE_NAME='v2_affiliation_claims' THEN
   IF NEW.erased AND NEW.claimant_user_id IS NULL AND NEW.claimed_role IS NULL AND NEW.request_digest IS NULL
    AND to_jsonb(NEW)-ARRAY['erased','claimant_user_id','claimed_role','request_digest']=to_jsonb(OLD)-ARRAY['erased','claimant_user_id','claimed_role','request_digest'] THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='v2_affiliation_proofs' THEN
   IF NEW.erased AND NEW.owner_user_id IS NULL AND NEW.private_reference IS NULL AND NEW.request_digest IS NULL
    AND to_jsonb(NEW)-ARRAY['erased','owner_user_id','private_reference','request_digest']=to_jsonb(OLD)-ARRAY['erased','owner_user_id','private_reference','request_digest'] THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='v2_affiliation_resolutions' THEN
   IF NEW.receipt_redacted AND NEW.request_digest IS NULL AND (NOT OLD.evidence_erased OR NEW.evidence_erased)
    AND to_jsonb(NEW)-ARRAY['evidence_erased','receipt_redacted','request_digest']=to_jsonb(OLD)-ARRAY['evidence_erased','receipt_redacted','request_digest'] THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='v2_affiliation_resolution_proofs' THEN
   IF NEW.erased AND NEW.proof_id IS NULL AND to_jsonb(NEW)-ARRAY['erased','proof_id']=to_jsonb(OLD)-ARRAY['erased','proof_id'] THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='v2_source_issuer_events' THEN
   IF NEW.receipt_redacted AND NEW.request_digest IS NULL AND (NOT OLD.erased OR NEW.erased)
    AND (NEW.erased OR (NEW.source_id IS NOT DISTINCT FROM OLD.source_id AND NEW.operator_subject_id IS NOT DISTINCT FROM OLD.operator_subject_id AND NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id))
    AND (NEW.affiliation_review_id IS NOT DISTINCT FROM OLD.affiliation_review_id OR NEW.affiliation_review_id IS NULL)
    AND to_jsonb(NEW)-ARRAY['erased','receipt_redacted','source_id','operator_subject_id','actor_user_id','affiliation_review_id','request_digest']
     =to_jsonb(OLD)-ARRAY['erased','receipt_redacted','source_id','operator_subject_id','actor_user_id','affiliation_review_id','request_digest'] THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'v2_affiliation_history_immutable' USING ERRCODE='23514';
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_affiliation_claims','v2_affiliation_proofs','v2_affiliation_resolutions','v2_affiliation_resolution_proofs','v2_source_issuer_events'] LOOP
  EXECUTE format('CREATE TRIGGER v2_affiliation_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_history_guard()',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.v2_affiliation_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.v2_affiliation_claims; r public.v2_review_cases; d public.v2_review_decisions;
BEGIN
 IF TG_TABLE_NAME='v2_affiliation_claims' THEN
  SELECT * INTO r FROM public.v2_review_cases WHERE id=NEW.case_id;
  IF NEW.erased OR r.id IS NULL OR r.kind<>'affiliation' OR r.subject_id<>NEW.operator_subject_id OR r.last_decision_id IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=NEW.operator_subject_id AND lifecycle='active') THEN
   RAISE EXCEPTION 'v2_affiliation_claim_case_mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='v2_affiliation_proofs' THEN
  SELECT * INTO c FROM public.v2_affiliation_claims WHERE id=NEW.claim_id;
  IF NEW.erased OR c.erased OR c.id IS NULL OR NEW.observed_at>statement_timestamp() OR NEW.expires_at<=statement_timestamp()
    OR (NEW.owner_user_id IS DISTINCT FROM c.claimant_user_id AND NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.owner_user_id AND role='administrator' AND revoked_at IS NULL)) THEN
   RAISE EXCEPTION 'v2_affiliation_proof_invalid' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO c FROM public.v2_affiliation_claims WHERE id=NEW.claim_id;
  SELECT * INTO r FROM public.v2_review_cases WHERE id=c.case_id;
  SELECT * INTO d FROM public.v2_review_decisions WHERE id=NEW.review_id;
  IF NEW.evidence_erased OR NEW.receipt_redacted OR c.id IS NULL OR c.erased OR d.case_id IS DISTINCT FROM c.case_id
   OR d.expected_revision IS DISTINCT FROM r.revision OR d.expected_subject_revision IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=c.operator_subject_id)
   OR d.actor_user_id IS NOT DISTINCT FROM c.claimant_user_id
   OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=d.actor_user_id AND role='administrator' AND revoked_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=c.operator_subject_id AND lifecycle='active') THEN
    RAISE EXCEPTION 'v2_affiliation_review_binding_invalid' USING ERRCODE='23514'; END IF;
  IF d.action NOT IN('verify_affiliation','revoke_affiliation','reject','needs_context','reverse')
   OR (d.action='verify_affiliation') IS DISTINCT FROM (NEW.valid_until IS NOT NULL)
   OR (NEW.valid_until IS NOT NULL AND NEW.valid_until<=statement_timestamp()) THEN
    RAISE EXCEPTION 'v2_affiliation_action_invalid' USING ERRCODE='23514'; END IF;
  IF d.action='reverse' AND (d.reverses_decision_id IS DISTINCT FROM r.last_decision_id OR NOT EXISTS(
    SELECT 1 FROM public.v2_affiliation_resolutions a JOIN public.v2_review_decisions old ON old.id=a.review_id
    WHERE a.review_id=r.last_decision_id AND NOT a.evidence_erased AND old.action NOT IN('reverse','needs_context'))) THEN
    RAISE EXCEPTION 'v2_reverse_current_affiliation_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_affiliation_insert BEFORE INSERT ON public.v2_affiliation_claims FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_insert_guard();
CREATE TRIGGER v2_affiliation_insert BEFORE INSERT ON public.v2_affiliation_proofs FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_insert_guard();
CREATE TRIGGER v2_affiliation_insert BEFORE INSERT ON public.v2_affiliation_resolutions FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_insert_guard();

CREATE FUNCTION public.v2_affiliation_proof_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.erased OR NOT EXISTS(SELECT 1 FROM public.v2_affiliation_resolutions a JOIN public.v2_review_decisions d ON d.id=a.review_id
  JOIN public.v2_review_cases c ON c.id=d.case_id JOIN public.v2_affiliation_proofs p ON p.id=NEW.proof_id
  WHERE a.review_id=NEW.review_id AND NOT a.evidence_erased AND NOT p.erased AND p.claim_id=a.claim_id AND c.revision=d.expected_revision) THEN
  RAISE EXCEPTION 'v2_affiliation_proof_binding_sealed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_affiliation_proof_binding BEFORE INSERT ON public.v2_affiliation_resolution_proofs FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_proof_binding_guard();

CREATE FUNCTION public.v2_affiliation_complete_check() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d public.v2_review_decisions; a public.v2_affiliation_resolutions; target uuid;
BEGIN
 IF TG_TABLE_NAME='v2_review_decisions' THEN target:=NEW.id; ELSE target:=NEW.review_id; END IF;
 SELECT * INTO d FROM public.v2_review_decisions WHERE id=target;
 IF NOT EXISTS(SELECT 1 FROM public.v2_review_cases WHERE id=d.case_id AND kind='affiliation') THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.v2_affiliation_resolutions WHERE review_id=target;
 IF a.review_id IS NULL THEN RAISE EXCEPTION 'v2_dedicated_affiliation_resolution_required' USING ERRCODE='23514'; END IF;
 IF a.evidence_erased THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_review_decision_evidence WHERE decision_id=target) THEN RAISE EXCEPTION 'v2_route_report_is_not_affiliation_proof' USING ERRCODE='23514'; END IF;
 IF d.action='verify_affiliation' AND NOT EXISTS(SELECT 1 FROM public.v2_affiliation_resolution_proofs WHERE review_id=target) THEN
   RAISE EXCEPTION 'v2_affiliation_proof_required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_affiliation_resolution_proofs b LEFT JOIN public.v2_affiliation_proofs p ON p.id=b.proof_id
   WHERE b.review_id=target AND (b.erased OR p.id IS NULL OR p.erased OR p.claim_id<>a.claim_id OR p.observed_at>d.created_at
     OR (d.action='verify_affiliation' AND (p.expires_at<a.valid_until OR p.expires_at<=d.created_at)))) THEN
   RAISE EXCEPTION 'v2_affiliation_proof_binding_invalid' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER v2_affiliation_complete AFTER INSERT ON public.v2_review_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_complete_check();
CREATE CONSTRAINT TRIGGER v2_affiliation_complete AFTER INSERT ON public.v2_affiliation_resolutions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_complete_check();
CREATE CONSTRAINT TRIGGER v2_affiliation_complete AFTER INSERT ON public.v2_affiliation_resolution_proofs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_complete_check();

CREATE FUNCTION public.v2_claim_affiliation(actor varchar,operator_id uuid,role_claim text,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_affiliation_claims; digest text; case_id uuid; result uuid;
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'v2_affiliation_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,operator_id,role_claim));
 SELECT * INTO receipt FROM public.v2_affiliation_claims WHERE request_id=request;
 IF FOUND THEN IF receipt.erased OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_affiliation_request_conflict' USING ERRCODE='23514'; END IF; RETURN receipt.id; END IF;
 INSERT INTO public.v2_review_cases(subject_id,subject_kind,kind) VALUES(operator_id,'operator','affiliation') RETURNING id INTO case_id;
 INSERT INTO public.v2_affiliation_claims(case_id,operator_subject_id,claimant_user_id,claimed_role,request_id,request_digest)
  VALUES(case_id,operator_id,actor,role_claim,request,digest) RETURNING id INTO result;
 RETURN result;
END; $$;
CREATE FUNCTION public.v2_add_affiliation_proof(actor varchar,claim uuid,proof_kind text,observed timestamptz,expires timestamptz,reference text,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_affiliation_proofs; digest text; result uuid;
BEGIN
 IF actor IS NULL OR request IS NULL THEN RAISE EXCEPTION 'v2_affiliation_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,claim,proof_kind,extract(epoch FROM observed),extract(epoch FROM expires),reference));
 SELECT * INTO receipt FROM public.v2_affiliation_proofs WHERE request_id=request;
 IF FOUND THEN IF receipt.erased OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_affiliation_request_conflict' USING ERRCODE='23514'; END IF; RETURN receipt.id; END IF;
 INSERT INTO public.v2_affiliation_proofs(claim_id,owner_user_id,kind,observed_at,expires_at,private_reference,request_id,request_digest)
 VALUES(claim,actor,proof_kind,observed,expires,reference,request,digest) RETURNING id INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION public.v2_review_affiliation(actor varchar,claim uuid,expected bigint,expected_subject bigint,operation text,proofs uuid[],until_time timestamptz,
 reason text,note text,request uuid,reverse_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.v2_affiliation_claims; r public.v2_review_cases; receipt public.v2_affiliation_resolutions; digest text; result uuid; canonical uuid[]; claimant varchar;
BEGIN
 SELECT claimant_user_id INTO claimant FROM public.v2_affiliation_claims WHERE id=claim;
 IF actor IS NULL OR request IS NULL OR claimant IS NULL THEN RAISE EXCEPTION 'v2_affiliation_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(least(actor,claimant))); PERFORM pg_advisory_xact_lock(hashtext(greatest(actor,claimant)));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF actor=claimant OR NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE user_id=actor AND role='administrator' AND revoked_at IS NULL) THEN
  RAISE EXCEPTION 'v2_independent_administrator_required' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(array_agg(x ORDER BY x),ARRAY[]::uuid[]) INTO canonical FROM (SELECT DISTINCT unnest(COALESCE(proofs,ARRAY[]::uuid[])) x) q;
 IF cardinality(canonical)<>COALESCE(cardinality(proofs),0) OR array_position(canonical,NULL) IS NOT NULL THEN RAISE EXCEPTION 'v2_affiliation_proof_set_invalid' USING ERRCODE='23514'; END IF;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,claim,expected,expected_subject,operation,canonical,extract(epoch FROM until_time),reason,note,reverse_id));
 SELECT * INTO receipt FROM public.v2_affiliation_resolutions WHERE request_id=request;
 IF FOUND THEN IF receipt.receipt_redacted OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_affiliation_request_conflict' USING ERRCODE='23514'; END IF; RETURN receipt.review_id; END IF;
 SELECT * INTO c FROM public.v2_affiliation_claims WHERE id=claim;
 SELECT * INTO r FROM public.v2_review_cases WHERE id=c.case_id FOR UPDATE;
 IF c.erased OR r.revision IS DISTINCT FROM expected OR expected_subject IS DISTINCT FROM (SELECT revision FROM public.v2_subjects WHERE id=c.operator_subject_id) THEN
  RAISE EXCEPTION 'v2_affiliation_revision_conflict' USING ERRCODE='40001'; END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision,public.v2_affiliation_complete DEFERRED;
 result:=gen_random_uuid(); INSERT INTO public.v2_decision_ids(id,kind) VALUES(result,'review');
 INSERT INTO public.v2_review_decisions(id,case_id,action,expected_revision,expected_subject_revision,reason_code,private_reason,actor_user_id,reverses_decision_id,policy_version,created_at)
 VALUES(result,c.case_id,operation,expected,expected_subject,reason,note,actor,reverse_id,'affiliation/1',statement_timestamp());
 INSERT INTO public.v2_affiliation_resolutions(review_id,claim_id,valid_until,request_id,request_digest) VALUES(result,claim,until_time,request,digest);
 INSERT INTO public.v2_affiliation_resolution_proofs(review_id,proof_id) SELECT result,unnest(canonical);
 SET CONSTRAINTS public.v2_affiliation_complete IMMEDIATE;
 UPDATE public.v2_review_cases SET revision=revision+1,last_decision_id=result,state=CASE WHEN operation='reverse' THEN 'reopened' WHEN operation='needs_context' THEN 'open' ELSE 'resolved' END WHERE id=c.case_id;
 UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=c.operator_subject_id;
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
 SELECT 'refresh_tasks',id,input_generation,'affiliation/1',result FROM public.v2_subjects WHERE id=c.operator_subject_id;
 IF until_time IS NOT NULL THEN
  INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id,available_at)
  SELECT 'assess',id,input_generation,'affiliation/1',result,until_time FROM public.v2_subjects WHERE id=c.operator_subject_id;
 END IF;
 SET CONSTRAINTS public.v2_decision_subtype,public.v2_review_subtype,public.v2_review_last_decision IMMEDIATE;
 RETURN result;
END; $$;

-- Source issuer events are assertions by the source owner. A verified account
-- relationship describes that submitter only; it does not authenticate a poster.
CREATE FUNCTION public.v2_issuer_validate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE current public.v2_source_issuers; c public.v2_affiliation_claims;
BEGIN
 SELECT * INTO current FROM public.v2_source_issuers WHERE source_id=NEW.source_id;
 IF NEW.erased OR NEW.receipt_redacted OR NEW.revision<>COALESCE(current.revision,0)+1 OR NEW.previous_event_id IS DISTINCT FROM current.event_id THEN
  RAISE EXCEPTION 'v2_issuer_revision_conflict' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_sources WHERE id=NEW.source_id AND owner_user_id=NEW.actor_user_id AND kind IN('document','operator_statement')) THEN
  RAISE EXCEPTION 'v2_issuer_source_owner_required' USING ERRCODE='42501'; END IF;
 IF NEW.action='claim' AND NOT EXISTS(SELECT 1 FROM public.v2_subjects WHERE id=NEW.operator_subject_id AND lifecycle='active') THEN
  RAISE EXCEPTION 'v2_issuer_operator_inactive' USING ERRCODE='23514'; END IF;
 IF NEW.affiliation_review_id IS NOT NULL THEN
  SELECT c0.* INTO c FROM public.v2_affiliation_claims c0 JOIN public.v2_affiliation_resolutions a ON a.claim_id=c0.id WHERE a.review_id=NEW.affiliation_review_id;
  IF c.claimant_user_id IS DISTINCT FROM NEW.actor_user_id OR c.operator_subject_id IS DISTINCT FROM NEW.operator_subject_id
    OR NOT public.v2_affiliation_valid(NEW.affiliation_review_id,statement_timestamp()) THEN
   RAISE EXCEPTION 'v2_issuer_affiliation_mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_issuer_validate BEFORE INSERT ON public.v2_source_issuer_events FOR EACH ROW EXECUTE FUNCTION public.v2_issuer_validate();
CREATE FUNCTION public.v2_issuer_projection_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN IF pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 ELSE IF EXISTS(SELECT 1 FROM public.v2_source_issuer_events e WHERE e.id=NEW.event_id AND e.source_id=NEW.source_id AND e.revision=NEW.revision AND NOT e.erased)
  AND pg_trigger_depth()>1 THEN RETURN NEW; END IF; END IF;
 RAISE EXCEPTION 'v2_issuer_projection_internal' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_issuer_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_source_issuers FOR EACH ROW EXECUTE FUNCTION public.v2_issuer_projection_guard();
CREATE FUNCTION public.v2_issuer_enqueue_expiry(source uuid,event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id,available_at)
 SELECT 'refresh_tasks',s.id,s.input_generation,'affiliation/1',event,a.valid_until FROM public.v2_source_issuer_events e
 JOIN public.v2_affiliation_resolutions a ON a.review_id=e.affiliation_review_id
 JOIN public.v2_observation_sources os ON os.source_id=source
 JOIN public.v2_subjects s ON s.id=public.v2_observation_subject(os.observation_id)
 WHERE e.id=event AND a.valid_until IS NOT NULL GROUP BY s.id,s.input_generation,a.valid_until
 ON CONFLICT DO NOTHING;
END; $$;
CREATE FUNCTION public.v2_issuer_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.v2_source_issuers(source_id,event_id,revision) VALUES(NEW.source_id,NEW.id,NEW.revision)
 ON CONFLICT(source_id) DO UPDATE SET event_id=EXCLUDED.event_id,revision=EXCLUDED.revision;
 PERFORM public.v2_source_changed(ARRAY[NEW.source_id],ARRAY[]::uuid[],false);
 PERFORM public.v2_issuer_enqueue_expiry(NEW.source_id,NEW.id);
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_issuer_project AFTER INSERT ON public.v2_source_issuer_events FOR EACH ROW EXECUTE FUNCTION public.v2_issuer_project();
CREATE FUNCTION public.v2_record_source_issuer(actor varchar,source uuid,expected bigint,operation text,operator_id uuid,affiliation uuid,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.v2_source_issuer_events; current public.v2_source_issuers; digest text; result uuid;
BEGIN
 IF actor IS NULL OR request IS NULL OR expected IS NULL OR expected<0 THEN RAISE EXCEPTION 'v2_issuer_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 digest:=public.v2_assessment_hash(jsonb_build_array(actor,source,expected,operation,operator_id,affiliation));
 SELECT * INTO receipt FROM public.v2_source_issuer_events WHERE request_id=request;
 IF FOUND THEN IF receipt.receipt_redacted OR receipt.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'v2_issuer_request_conflict' USING ERRCODE='23514'; END IF; RETURN receipt.id; END IF;
 SELECT * INTO current FROM public.v2_source_issuers WHERE source_id=source;
 IF expected<>COALESCE(current.revision,0) THEN RAISE EXCEPTION 'v2_issuer_revision_conflict' USING ERRCODE='40001'; END IF;
 INSERT INTO public.v2_source_issuer_events(source_id,operator_subject_id,affiliation_review_id,revision,previous_event_id,action,actor_user_id,request_id,request_digest)
 VALUES(source,operator_id,affiliation,expected+1,current.event_id,operation,actor,request,digest) RETURNING id INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION public.v2_affiliation_case_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[];
BEGIN
 IF NEW.kind<>'affiliation' OR (NEW.last_decision_id IS NOT DISTINCT FROM OLD.last_decision_id AND NEW.state=OLD.state) THEN RETURN NEW; END IF;
 SELECT array_agg(DISTINCT e.source_id) INTO ids FROM public.v2_source_issuer_events e JOIN public.v2_affiliation_resolutions a ON a.review_id=e.affiliation_review_id
 JOIN public.v2_affiliation_claims c ON c.id=a.claim_id WHERE c.case_id=NEW.id AND NOT e.erased;
 IF cardinality(ids)>0 THEN PERFORM public.v2_source_changed(ids,ARRAY[]::uuid[],false); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_affiliation_case_changed AFTER UPDATE ON public.v2_review_cases FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_case_changed();
CREATE FUNCTION public.v2_affiliation_review_erased() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.actor_erased OR NEW.evidence_erased OR (OLD.private_reason IS NOT NULL AND NEW.private_reason IS NULL) THEN
  UPDATE public.v2_affiliation_resolutions SET request_digest=NULL,receipt_redacted=true,evidence_erased=evidence_erased OR NEW.evidence_erased WHERE review_id=NEW.id;
 END IF;
 IF NEW.evidence_erased THEN
  UPDATE public.v2_affiliation_resolution_proofs SET proof_id=NULL,erased=true WHERE review_id=NEW.id;
  UPDATE public.v2_source_issuer_events SET affiliation_review_id=NULL,request_digest=NULL,receipt_redacted=true WHERE affiliation_review_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_affiliation_review_erased AFTER UPDATE ON public.v2_review_decisions FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_review_erased();
CREATE FUNCTION public.v2_affiliation_proof_erased() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected_case uuid; ids uuid[];
BEGIN
 IF NOT NEW.erased OR OLD.erased THEN RETURN NEW; END IF;
 SELECT c.case_id INTO affected_case FROM public.v2_affiliation_claims c WHERE c.id=NEW.claim_id;
 SELECT array_agg(DISTINCT e.source_id) INTO ids FROM public.v2_source_issuer_events e JOIN public.v2_affiliation_resolutions a ON a.review_id=e.affiliation_review_id WHERE a.claim_id=NEW.claim_id AND NOT e.erased;
 -- Later review notes can quote an earlier proof. Redact the whole claim case.
 UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE v2_review_decisions.case_id=affected_case;
 UPDATE public.v2_review_cases SET state='reopened',revision=revision+1 WHERE id=affected_case;
 IF cardinality(ids)>0 THEN PERFORM public.v2_source_changed(ids,ARRAY[]::uuid[],true); END IF;
 UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=(SELECT operator_subject_id FROM public.v2_affiliation_claims WHERE id=NEW.claim_id);
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id) SELECT 'erase_recompute',id,input_generation,'affiliation/1',NEW.id FROM public.v2_subjects WHERE id=(SELECT operator_subject_id FROM public.v2_affiliation_claims WHERE id=NEW.claim_id);
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_affiliation_proof_erased AFTER UPDATE ON public.v2_affiliation_proofs FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_proof_erased();
-- An erased proof retains a nonpersonal receipt tombstone; replay cannot recreate it.
CREATE FUNCTION public.v2_affiliation_erase_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.v2_affiliation_proofs SET erased=true,owner_user_id=NULL,private_reference=NULL,request_digest=NULL WHERE id=OLD.id;
 RETURN NULL;
END; $$;
CREATE TRIGGER a_v2_affiliation_erase_request BEFORE DELETE ON public.v2_affiliation_proofs FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_erase_request();
CREATE FUNCTION public.v2_erase_affiliation_proof(actor varchar,proof uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'v2_affiliation_proof_owner_required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF NOT EXISTS(SELECT 1 FROM public.v2_affiliation_proofs WHERE id=proof AND owner_user_id=actor AND NOT erased) THEN
   RAISE EXCEPTION 'v2_affiliation_proof_owner_required' USING ERRCODE='42501'; END IF;
 DELETE FROM public.v2_affiliation_proofs WHERE id=proof;
END; $$;
CREATE FUNCTION public.v2_affiliation_account_erasure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(OLD.id)); UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 UPDATE public.v2_affiliation_proofs SET erased=true,owner_user_id=NULL,private_reference=NULL,request_digest=NULL
 WHERE NOT erased AND (owner_user_id=OLD.id OR claim_id IN(SELECT id FROM public.v2_affiliation_claims WHERE claimant_user_id=OLD.id));
 UPDATE public.v2_review_decisions SET evidence_erased=true,private_reason=NULL WHERE case_id IN(SELECT case_id FROM public.v2_affiliation_claims WHERE claimant_user_id=OLD.id);
 UPDATE public.v2_affiliation_claims SET erased=true,claimant_user_id=NULL,claimed_role=NULL,request_digest=NULL WHERE claimant_user_id=OLD.id;
 RETURN OLD;
END; $$;
CREATE TRIGGER v2_account_affiliation_erasure BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.v2_affiliation_account_erasure();
CREATE FUNCTION public.v2_issuer_source_erasure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM public.v2_source_issuers WHERE source_id=OLD.id;
 UPDATE public.v2_source_issuer_events SET erased=true,source_id=NULL,operator_subject_id=NULL,affiliation_review_id=NULL,actor_user_id=NULL,request_digest=NULL,receipt_redacted=true WHERE source_id=OLD.id;
 RETURN OLD;
END; $$;
CREATE TRIGGER v2_issuer_source_erasure BEFORE DELETE ON public.v2_sources FOR EACH ROW EXECUTE FUNCTION public.v2_issuer_source_erasure();
CREATE FUNCTION public.v2_issuer_citation_expiry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE event uuid;
BEGIN
 SELECT event_id INTO event FROM public.v2_source_issuers WHERE source_id=NEW.source_id;
 IF event IS NOT NULL THEN PERFORM public.v2_issuer_enqueue_expiry(NEW.source_id,event); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER zz_v2_issuer_citation_expiry AFTER INSERT ON public.v2_observation_sources FOR EACH ROW EXECUTE FUNCTION public.v2_issuer_citation_expiry();

DO $$ DECLARE t text; role_name text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['v2_affiliation_claims','v2_affiliation_proofs','v2_affiliation_resolutions','v2_affiliation_resolution_proofs','v2_source_issuer_events','v2_source_issuers'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,mabhazi_api',t);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name); END IF;
  END LOOP;
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO mabhazi_api',t);
  EXECUTE format('CREATE POLICY backend_access ON public.%I FOR SELECT TO mabhazi_api USING(true)',t);
  EXECUTE format('CREATE TRIGGER v2_affiliation_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport()',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND (p.proname LIKE 'v2_affiliation_%' OR p.proname LIKE 'v2_issuer_%' OR p.proname IN('v2_claim_affiliation','v2_add_affiliation_proof','v2_review_affiliation','v2_erase_affiliation_proof','v2_record_source_issuer','v2_read_affiliation','v2_read_affiliation_at','v2_read_source_issuer','v2_read_source_issuer_at')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
  END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_read_affiliation(uuid),public.v2_read_source_issuer(uuid) TO mabhazi_api;
