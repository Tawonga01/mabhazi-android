-- WP02 intake foundation. Additive; existing journey rows/DTOs are untouched.
-- Later migrations add resolved transport/decision/task subtypes before v2 rollout.
CREATE FUNCTION public.v2_valid_operator_name(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT value IS NOT NULL AND length(value) BETWEEN 1 AND 120
    AND btrim(value) = value AND value !~ '[[:cntrl:]]'
    AND value !~ '^[[:space:]]|[[:space:]]$'
    AND lower(value) NOT IN ('unknown', 'n/a', '-');
$$;

CREATE TABLE public.v2_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CONSTRAINT v2_subject_kind CHECK (kind IN ('lead','operator')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  input_generation bigint NOT NULL DEFAULT 1 CHECK (input_generation >= 1),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,kind)
);

CREATE TABLE public.v2_operators (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'operator' CHECK (subject_kind = 'operator'),
  display_name text NOT NULL CHECK (public.v2_valid_operator_name(display_name)),
  country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
  affiliation_status text NOT NULL DEFAULT 'unverified' CHECK (affiliation_status = 'unverified'),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.v2_corridors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_city_id integer NOT NULL REFERENCES public.cities(id),
  destination_city_id integer NOT NULL REFERENCES public.cities(id),
  CHECK(origin_city_id <> destination_city_id),
  UNIQUE(origin_city_id,destination_city_id)
);
CREATE INDEX v2_corridors_destination_idx ON public.v2_corridors(destination_city_id);

CREATE TABLE public.v2_leads (
  subject_id uuid PRIMARY KEY,
  subject_kind text NOT NULL DEFAULT 'lead' CHECK (subject_kind = 'lead'),
  intake_kind text NOT NULL DEFAULT 'community' CHECK (intake_kind IN ('community','legacy')),
  corridor_id uuid REFERENCES public.v2_corridors(id),
  reported_departure_seconds integer CHECK (reported_departure_seconds BETWEEN 0 AND 86399),
  operator_subject_id uuid REFERENCES public.v2_operators(subject_id),
  operator_name text CHECK (operator_name IS NULL OR public.v2_valid_operator_name(operator_name)),
  resolved_status text NOT NULL DEFAULT 'unresolved' CHECK (resolved_status = 'unresolved'),
  initial_contribution_id uuid,
  attribution_erased boolean NOT NULL DEFAULT false,
  CHECK (num_nonnulls(operator_subject_id,operator_name) <= 1),
  CHECK (intake_kind <> 'community' OR
    (corridor_id IS NOT NULL AND reported_departure_seconds IS NOT NULL
     AND num_nonnulls(operator_subject_id,operator_name) = 1
     AND (initial_contribution_id IS NOT NULL OR attribution_erased))),
  FOREIGN KEY(subject_id,subject_kind) REFERENCES public.v2_subjects(id,kind)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX v2_leads_corridor_idx ON public.v2_leads(corridor_id);
CREATE INDEX v2_leads_operator_idx ON public.v2_leads(operator_subject_id);

CREATE TABLE public.v2_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_submission_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  entry_surface text NOT NULL CHECK (entry_surface IN
    ('contribute_tab','search_empty','search_result','route_detail','own_contribution','reviewer_context','legacy_import')),
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  original_subject_id uuid NOT NULL REFERENCES public.v2_subjects(id) DEFERRABLE INITIALLY DEFERRED,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,client_submission_id),
  UNIQUE(id,user_id,client_submission_id,semantic_hash),
  UNIQUE(id,original_subject_id),
  UNIQUE(id,user_id)
);
CREATE INDEX v2_contributions_subject_idx ON public.v2_contributions(original_subject_id,submitted_at);
CREATE INDEX v2_contributions_user_date_idx ON public.v2_contributions(user_id,submitted_at);
ALTER TABLE public.v2_leads ADD CONSTRAINT v2_lead_initial_contribution
  FOREIGN KEY(initial_contribution_id,subject_id)
  REFERENCES public.v2_contributions(id,original_subject_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX v2_leads_initial_contribution_idx ON public.v2_leads(initial_contribution_id);

CREATE TABLE public.v2_receipts (
  user_id varchar NOT NULL,
  client_submission_id uuid NOT NULL,
  contribution_id uuid NOT NULL,
  semantic_hash text NOT NULL,
  initial_response jsonb NOT NULL CHECK (jsonb_typeof(initial_response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,client_submission_id),
  FOREIGN KEY(contribution_id,user_id,client_submission_id,semantic_hash)
    REFERENCES public.v2_contributions(id,user_id,client_submission_id,semantic_hash) ON DELETE CASCADE
);
CREATE INDEX v2_receipts_contribution_idx ON public.v2_receipts(contribution_id);

-- Strict schemas for the initial fields. New field types require an explicit
-- migration + API validator before use; do not admit arbitrary JSON assertions.
CREATE FUNCTION public.v2_intake_observation_valid(field text, value jsonb, scope jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE amount text; segment jsonb; date_value text;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
     OR jsonb_typeof(scope) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF field = 'operator.reported' THEN
    RETURN scope='{}'::jsonb AND CASE
      WHEN value ? 'name' AND value - 'name' = '{}'::jsonb THEN
        jsonb_typeof(value->'name')='string' AND public.v2_valid_operator_name(value->>'name')
      WHEN value ? 'id' AND value - 'id' = '{}'::jsonb THEN
        jsonb_typeof(value->'id')='string' AND (value->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ELSE false END;
  ELSIF field = 'departure.reported' THEN
    RETURN COALESCE(scope='{}'::jsonb AND value ?& ARRAY['time','basis']
      AND value - ARRAY['time','basis'] = '{}'::jsonb
      AND jsonb_typeof(value->'time')='string' AND length(value->>'time')=5
      AND (value->>'time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND value->>'basis' IN ('unspecified','scheduled','actual'),false);
  ELSIF field IN ('boarding.pickup','alighting.dropoff') THEN
    RETURN COALESCE(scope='{}'::jsonb AND value ?& ARRAY['cityId','name']
      AND value - ARRAY['cityId','name','instructions'] = '{}'::jsonb
      AND jsonb_typeof(value->'cityId')='number' AND value->>'cityId' ~ '^[1-9][0-9]{0,8}$'
      AND jsonb_typeof(value->'name')='string' AND length(btrim(value->>'name')) BETWEEN 1 AND 200
      AND (NOT value ? 'instructions' OR (jsonb_typeof(value->'instructions')='string' AND length(value->>'instructions')<=500)),false);
  ELSIF field IN ('fare.paid','fare.quoted','fare.advertised') THEN
    IF NOT COALESCE(value ?& ARRAY['amount','currency'] AND value - ARRAY['amount','currency']='{}'::jsonb
      AND jsonb_typeof(value->'amount')='string' AND jsonb_typeof(value->'currency')='string'
      AND value->>'currency' ~ '^[A-Z]{3}$',false) THEN RETURN false; END IF;
    amount := value->>'amount';
    IF length(amount)>13 OR amount !~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,2})?$' THEN RETURN false; END IF;
    IF NOT COALESCE(scope ?& ARRAY['schemaVersion','segment','passengerCategory','ticketBasis']
      AND scope->>'schemaVersion'='1.0'
      AND scope - ARRAY['schemaVersion','segment','serviceDate','effectiveFrom','effectiveTo','passengerCategory','passengerLabel','ticketBasis','ticketLabel','paymentMethod','luggageIncluded','timeBasis']='{}'::jsonb
      AND scope->>'passengerCategory' IN ('adult','child','concession','other','unknown')
      AND scope->>'ticketBasis' IN ('one_way','return','other','unknown'),false) THEN RETURN false; END IF;
    segment:=scope->'segment';
    -- Stop-pair fares await the stop subtype migration; never store dangling IDs.
    IF NOT COALESCE(jsonb_typeof(segment)='object' AND segment->>'kind'='city_pair'
      AND segment ?& ARRAY['kind','originCityId','destinationCityId']
      AND segment - ARRAY['kind','originCityId','destinationCityId']='{}'::jsonb
      AND jsonb_typeof(segment->'originCityId')='number' AND jsonb_typeof(segment->'destinationCityId')='number'
      AND segment->>'originCityId' ~ '^[1-9][0-9]{0,8}$' AND segment->>'destinationCityId' ~ '^[1-9][0-9]{0,8}$'
      AND segment->>'originCityId' <> segment->>'destinationCityId',false) THEN RETURN false; END IF;
    IF field='fare.paid' AND (NOT scope ? 'serviceDate' OR scope->'serviceDate'='null'::jsonb) THEN RETURN false; END IF;
    FOREACH date_value IN ARRAY ARRAY['serviceDate','effectiveFrom','effectiveTo'] LOOP
      IF scope ? date_value AND scope->date_value <> 'null'::jsonb THEN
        IF jsonb_typeof(scope->date_value)<>'string' OR length(scope->>date_value)<>10
           OR scope->>date_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
        PERFORM (scope->>date_value)::date;
      END IF;
    END LOOP;
    IF (scope->>'effectiveFrom')::date > (scope->>'effectiveTo')::date THEN RETURN false; END IF;
    IF scope->>'passengerCategory'='other' AND NOT COALESCE(jsonb_typeof(scope->'passengerLabel')='string' AND length(btrim(scope->>'passengerLabel')) BETWEEN 1 AND 120,false) THEN RETURN false; END IF;
    IF scope->>'ticketBasis'='other' AND NOT COALESCE(jsonb_typeof(scope->'ticketLabel')='string' AND length(btrim(scope->>'ticketLabel')) BETWEEN 1 AND 120,false) THEN RETURN false; END IF;
    IF scope ? 'luggageIncluded' AND jsonb_typeof(scope->'luggageIncluded') NOT IN ('boolean','null') THEN RETURN false; END IF;
    IF scope ? 'paymentMethod' AND jsonb_typeof(scope->'paymentMethod') NOT IN ('string','null') THEN RETURN false; END IF;
    FOREACH date_value IN ARRAY ARRAY['passengerLabel','ticketLabel','paymentMethod'] LOOP
      IF scope ? date_value AND scope->date_value <> 'null'::jsonb AND
         NOT COALESCE(jsonb_typeof(scope->date_value)='string' AND length(btrim(scope->>date_value)) BETWEEN 1 AND 120,false) THEN RETURN false; END IF;
    END LOOP;
    IF scope ? 'timeBasis' AND scope->'timeBasis' <> 'null'::jsonb AND
       NOT COALESCE(scope->>'timeBasis' IN ('unspecified','scheduled','actual'),false) THEN RETURN false; END IF;
    RETURN true;
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RETURN false;
END;
$$;

CREATE TABLE public.v2_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES public.v2_contributions(id) ON DELETE CASCADE,
  original_subject_id uuid NOT NULL REFERENCES public.v2_leads(subject_id),
  field_key text NOT NULL,
  schema_version text NOT NULL DEFAULT '1.0' CHECK(schema_version = '1.0'),
  value jsonb NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}',
  -- Materialised references enforce referential integrity on JSON claims, including deletion.
  operator_ref uuid GENERATED ALWAYS AS
    (CASE WHEN field_key='operator.reported' THEN (value->>'id')::uuid END) STORED REFERENCES public.v2_operators(subject_id),
  place_city_ref integer GENERATED ALWAYS AS
    (CASE WHEN field_key IN ('boarding.pickup','alighting.dropoff') THEN (value->>'cityId')::integer END) STORED REFERENCES public.cities(id),
  fare_origin_ref integer GENERATED ALWAYS AS
    (CASE WHEN field_key IN ('fare.paid','fare.quoted','fare.advertised') THEN (scope->'segment'->>'originCityId')::integer END) STORED REFERENCES public.cities(id),
  fare_destination_ref integer GENERATED ALWAYS AS
    (CASE WHEN field_key IN ('fare.paid','fare.quoted','fare.advertised') THEN (scope->'segment'->>'destinationCityId')::integer END) STORED REFERENCES public.cities(id),
  scope_key text NOT NULL CHECK(scope_key ~ '^[0-9a-f]{64}$'),
  value_key text NOT NULL CHECK(value_key ~ '^[0-9a-f]{64}$'),
  knowledge_basis text NOT NULL DEFAULT 'unprovided' CHECK(knowledge_basis IN
    ('travelled','saw_operating','observed_sign','operator_statement','heard_from_other','unprovided','legacy_import')),
  observed_from date,
  observed_to date,
  effective_from date,
  effective_to date,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  supersedes_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  CHECK (observed_to IS NULL OR observed_from IS NOT NULL),
  CHECK (observed_to IS NULL OR observed_to >= observed_from),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CHECK (public.v2_intake_observation_valid(field_key,value,scope) IS TRUE),
  FOREIGN KEY(contribution_id,original_subject_id)
    REFERENCES public.v2_contributions(id,original_subject_id) ON DELETE CASCADE
);
CREATE INDEX v2_observations_subject_field_idx ON public.v2_observations(original_subject_id,field_key,scope_key,submitted_at);
CREATE INDEX v2_observations_contribution_idx ON public.v2_observations(contribution_id);
CREATE INDEX v2_observations_supersedes_idx ON public.v2_observations(supersedes_id);
CREATE INDEX v2_observations_operator_ref_idx ON public.v2_observations(operator_ref);
CREATE INDEX v2_observations_place_city_ref_idx ON public.v2_observations(place_city_ref);
CREATE INDEX v2_observations_fare_origin_ref_idx ON public.v2_observations(fare_origin_ref);
CREATE INDEX v2_observations_fare_destination_ref_idx ON public.v2_observations(fare_destination_ref);

CREATE TABLE public.v2_observation_states (
  observation_id uuid PRIMARY KEY REFERENCES public.v2_observations(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','withdrawn','hidden')),
  reason_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX v2_observation_states_status_idx ON public.v2_observation_states(status);

CREATE TABLE public.v2_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('firsthand','document','operator_statement','hearsay','unprovided','legacy_import')),
  source_date date,
  private_reference text,
  normalised_document_fingerprint text CHECK(normalised_document_fingerprint ~ '^[0-9a-f]{64}$'),
  visibility text NOT NULL DEFAULT 'review_only' CHECK(visibility IN ('public_metadata','review_only')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX v2_sources_owner_idx ON public.v2_sources(owner_user_id);
CREATE INDEX v2_sources_fingerprint_idx ON public.v2_sources(normalised_document_fingerprint);

CREATE TABLE public.v2_observation_sources (
  observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.v2_sources(id) ON DELETE CASCADE,
  relation text NOT NULL DEFAULT 'direct' CHECK(relation IN ('direct','cites')),
  PRIMARY KEY(observation_id,source_id)
);
CREATE INDEX v2_observation_sources_source_idx ON public.v2_observation_sources(source_id);

CREATE TABLE public.v2_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('normalise','associate','assess','refresh_tasks','rebuild_legacy','erase_recompute')),
  subject_id uuid NOT NULL REFERENCES public.v2_subjects(id),
  contribution_id uuid,
  requested_generation bigint NOT NULL CHECK(requested_generation>=1),
  policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 64),
  trigger_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','done','failed','superseded')),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK(max_attempts>0),
  last_error_code text CHECK(last_error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state='leased' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
      OR (state<>'leased' AND lease_until IS NULL AND lease_token IS NULL)),
  UNIQUE(kind,subject_id,requested_generation,policy_version,trigger_id),
  FOREIGN KEY(contribution_id,subject_id) REFERENCES public.v2_contributions(id,original_subject_id)
);
CREATE INDEX v2_jobs_pending_idx ON public.v2_jobs(available_at,created_at) WHERE state='pending';
CREATE INDEX v2_jobs_lease_idx ON public.v2_jobs(lease_until) WHERE state='leased';
CREATE INDEX v2_jobs_contribution_idx ON public.v2_jobs(contribution_id);
CREATE INDEX v2_jobs_subject_idx ON public.v2_jobs(subject_id);

CREATE TABLE public.v2_job_effects (
  job_id uuid NOT NULL REFERENCES public.v2_jobs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
  result_revision bigint NOT NULL CHECK(result_revision>=1),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,stage,input_digest)
);

-- Subtype integrity must hold at commit even if rows were inserted in a
-- different order. Locks prevent concurrent subtype removal/subject updates.
CREATE FUNCTION public.v2_require_intake_subtype() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target uuid; subject_kind text;
BEGIN
  IF TG_TABLE_NAME = 'v2_subjects' THEN target := COALESCE(NEW.id,OLD.id);
  ELSE target := COALESCE(NEW.subject_id,OLD.subject_id); END IF;
  SELECT kind INTO subject_kind FROM public.v2_subjects WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF subject_kind='lead' AND NOT EXISTS(SELECT 1 FROM public.v2_leads WHERE subject_id=target)
     OR subject_kind='operator' AND NOT EXISTS(SELECT 1 FROM public.v2_operators WHERE subject_id=target) THEN
    RAISE EXCEPTION 'v2_subject_requires_subtype' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER v2_subject_subtype AFTER INSERT OR UPDATE ON public.v2_subjects
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_intake_subtype();
CREATE CONSTRAINT TRIGGER v2_lead_subtype AFTER INSERT OR UPDATE OR DELETE ON public.v2_leads
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_intake_subtype();
CREATE CONSTRAINT TRIGGER v2_operator_subtype AFTER INSERT OR UPDATE OR DELETE ON public.v2_operators
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.v2_require_intake_subtype();

CREATE FUNCTION public.v2_forbid_subject_kind_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'v2_subject_identity_is_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_subject_identity BEFORE UPDATE ON public.v2_subjects
  FOR EACH ROW EXECUTE FUNCTION public.v2_forbid_subject_kind_change();

CREATE FUNCTION public.v2_forbid_subtype_identity_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    RAISE EXCEPTION 'v2_subtype_identity_is_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_lead_identity BEFORE UPDATE ON public.v2_leads
  FOR EACH ROW EXECUTE FUNCTION public.v2_forbid_subtype_identity_change();
CREATE TRIGGER v2_operator_identity BEFORE UPDATE ON public.v2_operators
  FOR EACH ROW EXECUTE FUNCTION public.v2_forbid_subtype_identity_change();

CREATE FUNCTION public.v2_private_record_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  -- FK erasure of a superseded observation is permitted; all content stays fixed.
  IF TG_TABLE_NAME='v2_observations' THEN
    -- Generated fields are computed after BEFORE triggers. Compare their inputs.
    IF pg_trigger_depth()>1 AND NEW.supersedes_id IS NULL AND OLD.supersedes_id IS NOT NULL AND
      (to_jsonb(NEW)-ARRAY['supersedes_id','operator_ref','place_city_ref','fare_origin_ref','fare_destination_ref'])=
      (to_jsonb(OLD)-ARRAY['supersedes_id','operator_ref','place_city_ref','fare_origin_ref','fare_destination_ref']) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'v2_append_new_record_instead' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER v2_contribution_immutable BEFORE UPDATE ON public.v2_contributions
  FOR EACH ROW EXECUTE FUNCTION public.v2_private_record_immutable();
CREATE TRIGGER v2_observation_immutable BEFORE UPDATE ON public.v2_observations
  FOR EACH ROW EXECUTE FUNCTION public.v2_private_record_immutable();
CREATE TRIGGER v2_receipt_immutable BEFORE UPDATE ON public.v2_receipts
  FOR EACH ROW EXECUTE FUNCTION public.v2_private_record_immutable();
CREATE TRIGGER v2_source_immutable BEFORE UPDATE ON public.v2_sources
  FOR EACH ROW EXECUTE FUNCTION public.v2_private_record_immutable();

CREATE FUNCTION public.v2_check_observation_lineage() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE owner_id varchar; previous_owner varchar; previous_subject uuid; previous_field text;
BEGIN
  IF NEW.observed_from > current_date + 1 OR NEW.observed_to > current_date + 1 THEN
    RAISE EXCEPTION 'v2_future_observation_date' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT user_id INTO owner_id FROM public.v2_contributions WHERE id=NEW.contribution_id;
    SELECT c.user_id,o.original_subject_id,o.field_key INTO previous_owner,previous_subject,previous_field
      FROM public.v2_observations o JOIN public.v2_contributions c ON c.id=o.contribution_id
      WHERE o.id=NEW.supersedes_id;
    IF previous_owner IS DISTINCT FROM owner_id OR previous_subject IS DISTINCT FROM NEW.original_subject_id
       OR previous_field IS DISTINCT FROM NEW.field_key THEN
      RAISE EXCEPTION 'v2_supersedes_requires_same_owner_subject_field' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_observation_lineage BEFORE INSERT ON public.v2_observations
  FOR EACH ROW EXECUTE FUNCTION public.v2_check_observation_lineage();

CREATE FUNCTION public.v2_initial_observation_state() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO public.v2_observation_states(observation_id) VALUES(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_observation_state AFTER INSERT ON public.v2_observations
  FOR EACH ROW EXECUTE FUNCTION public.v2_initial_observation_state();

CREATE FUNCTION public.v2_check_source_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.v2_observations o
      JOIN public.v2_contributions c ON c.id=o.contribution_id
      JOIN public.v2_sources s ON s.id=NEW.source_id AND s.owner_user_id=c.user_id
      WHERE o.id=NEW.observation_id) THEN
    RAISE EXCEPTION 'v2_private_source_owner_mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER v2_source_owner BEFORE INSERT OR UPDATE ON public.v2_observation_sources
  FOR EACH ROW EXECUTE FUNCTION public.v2_check_source_owner();

CREATE FUNCTION public.v2_erase_contribution_lineage() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.v2_leads SET initial_contribution_id=NULL,attribution_erased=true
    WHERE initial_contribution_id=OLD.id;
  UPDATE public.v2_jobs SET state='superseded',lease_until=NULL,lease_token=NULL,last_error_code=NULL
    WHERE contribution_id=OLD.id AND state IN ('pending','leased','failed');
  UPDATE public.v2_jobs SET contribution_id=NULL WHERE contribution_id=OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER v2_erase_contribution BEFORE DELETE ON public.v2_contributions
  FOR EACH ROW EXECUTE FUNCTION public.v2_erase_contribution_lineage();

CREATE FUNCTION public.v2_account_erasure() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE affected record;
BEGIN
  -- Existing API deletion already takes this lock; re-entrant in that transaction.
  PERFORM pg_advisory_xact_lock(hashtext(OLD.id));
  FOR affected IN SELECT DISTINCT original_subject_id FROM public.v2_contributions
      WHERE user_id=OLD.id ORDER BY original_subject_id LOOP
    UPDATE public.v2_subjects SET input_generation=input_generation+1,revision=revision+1
      WHERE id=affected.original_subject_id;
    INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
      SELECT 'erase_recompute',id,input_generation,'evidence/1',gen_random_uuid()
      FROM public.v2_subjects WHERE id=affected.original_subject_id;
  END LOOP;
  RETURN OLD;
END;
$$;
CREATE TRIGGER v2_account_erasure BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.v2_account_erasure();

-- No mobile/anonymous direct-table access. Per-account API checks are additional;
-- server-wide role policies are not presented as per-user RLS.
DO $$
DECLARE t text; role_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY['v2_subjects','v2_operators','v2_corridors','v2_leads',
    'v2_contributions','v2_receipts','v2_observations','v2_observation_states',
    'v2_sources','v2_observation_sources','v2_jobs','v2_job_effects'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name);
      END IF;
    END LOOP;
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO mabhazi_api',t);
    EXECUTE format('CREATE POLICY api_server_access ON public.%I FOR ALL TO mabhazi_api USING(true) WITH CHECK(true)',t);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.v2_valid_operator_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v2_intake_observation_valid(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v2_valid_operator_name(text), public.v2_intake_observation_valid(text,jsonb,jsonb) TO mabhazi_api;
