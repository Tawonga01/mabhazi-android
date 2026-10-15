-- Observation status is a projection of append-only events, never an editable fact.
-- Authenticated API actor binding and resolved-target processing remain later work.
CREATE TABLE public.v2_observation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_id uuid NOT NULL REFERENCES public.v2_observations(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>=1),
 action text NOT NULL CHECK(action IN ('baseline','submit','supersede','withdraw','hide','restore','reverse')),
 from_status text CHECK(from_status IN ('active','superseded','withdrawn','hidden')),
 status text NOT NULL CHECK(status IN ('active','superseded','withdrawn','hidden')),
 previous_event_id uuid,
 actor_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
 actor_erased boolean NOT NULL DEFAULT false,
 reason_code text CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
 private_reason text CHECK(length(private_reason)<=2000),
 request_id uuid,
 review_decision_id uuid REFERENCES public.v2_review_decisions(id),
 replacement_observation_id uuid REFERENCES public.v2_observations(id) ON DELETE SET NULL,
 replacement_erased boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(observation_id,revision), UNIQUE(observation_id,request_id),
 UNIQUE(id,observation_id), UNIQUE(id,observation_id,revision,status),
 FOREIGN KEY(previous_event_id,observation_id) REFERENCES public.v2_observation_events(id,observation_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(previous_event_id IS NULL OR previous_event_id<>id),
 CHECK((action IN ('baseline','submit'))=(previous_event_id IS NULL)),
 CHECK((action IN ('baseline','submit'))=(from_status IS NULL)),
 CHECK(action IN ('baseline','submit') OR reason_code IS NOT NULL),
 CHECK(action='baseline' OR actor_user_id IS NOT NULL OR actor_erased),
 CHECK(NOT actor_erased OR (actor_user_id IS NULL AND private_reason IS NULL AND request_id IS NULL)),
 CHECK((action IN ('hide','restore','reverse'))=(review_decision_id IS NOT NULL)),
 CHECK((action='supersede')=(replacement_observation_id IS NOT NULL OR replacement_erased)),
 CHECK(NOT replacement_erased OR replacement_observation_id IS NULL)
);
CREATE INDEX v2_observation_events_actor_idx ON public.v2_observation_events(actor_user_id);
CREATE INDEX v2_observation_events_review_idx ON public.v2_observation_events(review_decision_id);
CREATE INDEX v2_observation_events_replacement_idx ON public.v2_observation_events(replacement_observation_id);
CREATE INDEX v2_observation_events_previous_idx ON public.v2_observation_events(previous_event_id);
ALTER TABLE public.v2_observation_states ADD COLUMN latest_event_id uuid;
ALTER TABLE public.v2_observation_states ADD CONSTRAINT v2_observation_state_event
 FOREIGN KEY(latest_event_id,observation_id,revision,status)
 REFERENCES public.v2_observation_events(id,observation_id,revision,status) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION public.v2_event_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.v2_observations WHERE id=OLD.observation_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 THEN
   IF NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
     AND to_jsonb(NEW)-'actor_user_id'=to_jsonb(OLD)-'actor_user_id' THEN
     NEW.actor_erased:=true; NEW.private_reason:=NULL; NEW.request_id:=NULL; RETURN NEW;
   END IF;
   IF NEW.replacement_observation_id IS NULL AND OLD.replacement_observation_id IS NOT NULL
     AND to_jsonb(NEW)-'replacement_observation_id'=to_jsonb(OLD)-'replacement_observation_id' THEN
     NEW.replacement_erased:=true; NEW.private_reason:=NULL; RETURN NEW;
   END IF;
   IF NEW.private_reason IS NULL AND to_jsonb(NEW)-'private_reason'=to_jsonb(OLD)-'private_reason' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'v2_observation_event_immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER v2_event_immutable BEFORE UPDATE OR DELETE ON public.v2_observation_events
 FOR EACH ROW EXECUTE FUNCTION public.v2_event_immutable();

CREATE FUNCTION public.v2_validate_observation_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.v2_observation_states; o public.v2_observations; owner_id varchar;
 r public.v2_review_decisions; c public.v2_review_cases; previous public.v2_observation_events;
BEGIN
 SELECT * INTO o FROM public.v2_observations WHERE id=NEW.observation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_observation_missing' USING ERRCODE='23503'; END IF;
 SELECT user_id INTO owner_id FROM public.v2_contributions WHERE id=o.contribution_id;
 SELECT * INTO s FROM public.v2_observation_states WHERE observation_id=o.id FOR UPDATE;
 IF NEW.action='baseline' THEN
   IF NOT FOUND OR s.latest_event_id IS NOT NULL OR NEW.actor_user_id IS NOT NULL OR NEW.actor_erased
     OR NEW.revision<>s.revision OR NEW.status<>s.status OR NEW.reason_code IS DISTINCT FROM s.reason_code
     OR NEW.request_id IS NOT NULL OR NEW.private_reason IS NOT NULL THEN
     RAISE EXCEPTION 'v2_event_baseline_only_for_untracked_state' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 ELSIF NEW.action='submit' THEN
   IF FOUND OR NEW.revision<>1 OR NEW.status<>'active' OR NEW.actor_user_id IS DISTINCT FROM owner_id
     OR NEW.actor_erased OR NEW.request_id IS NOT NULL OR NEW.private_reason IS NOT NULL OR NEW.reason_code IS NOT NULL THEN
     RAISE EXCEPTION 'v2_event_initial_state_invalid' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF s.latest_event_id IS NULL OR NEW.revision<>s.revision+1 OR NEW.previous_event_id IS DISTINCT FROM s.latest_event_id
   OR NEW.from_status IS DISTINCT FROM s.status THEN
   RAISE EXCEPTION 'v2_observation_revision_conflict' USING ERRCODE='40001'; END IF;
 IF NEW.actor_user_id IS NULL OR NEW.actor_erased OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.actor_user_id) THEN
   RAISE EXCEPTION 'v2_observation_actor_required' USING ERRCODE='42501'; END IF;
 IF NEW.action IN ('withdraw','supersede') THEN
   IF NEW.actor_user_id IS DISTINCT FROM owner_id THEN RAISE EXCEPTION 'v2_observation_owner_required' USING ERRCODE='42501'; END IF;
   IF NEW.action='withdraw' THEN
     IF s.status NOT IN ('active','hidden') OR NEW.status<>'withdrawn' OR NEW.request_id IS NULL OR NEW.reason_code<>'author_withdrawal' THEN
       RAISE EXCEPTION 'v2_observation_withdrawal_invalid' USING ERRCODE='23514'; END IF;
   ELSE
     IF s.status<>'active' OR NEW.status<>'superseded' OR NEW.request_id IS NOT NULL OR NEW.reason_code<>'author_correction'
       OR NEW.private_reason IS NOT NULL OR NOT EXISTS(
       SELECT 1 FROM public.v2_observations replacement JOIN public.v2_contributions rc ON rc.id=replacement.contribution_id
       JOIN public.v2_observation_states rs ON rs.observation_id=replacement.id
       WHERE replacement.id=NEW.replacement_observation_id AND replacement.supersedes_id=o.id AND rc.user_id=owner_id
         AND replacement.original_subject_id=o.original_subject_id AND replacement.field_key=o.field_key AND rs.status='active') THEN
       RAISE EXCEPTION 'v2_observation_correction_invalid' USING ERRCODE='23514'; END IF;
   END IF;
 ELSE
   IF NEW.private_reason IS NOT NULL OR NEW.request_id IS NOT NULL OR NOT EXISTS(
     SELECT 1 FROM public.v2_review_roles WHERE user_id=NEW.actor_user_id AND revoked_at IS NULL) THEN
     RAISE EXCEPTION 'v2_observation_reviewer_required' USING ERRCODE='42501'; END IF;
   SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.review_decision_id;
   SELECT * INTO c FROM public.v2_review_cases WHERE id=r.case_id;
   IF c.kind IS DISTINCT FROM 'moderation' OR c.subject_id IS DISTINCT FROM o.original_subject_id
     OR c.last_decision_id IS DISTINCT FROM r.id OR r.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR r.evidence_erased
     OR r.action<>NEW.action OR NEW.reason_code IS DISTINCT FROM r.reason_code THEN
     RAISE EXCEPTION 'v2_observation_current_moderation_required' USING ERRCODE='23514'; END IF;
   IF NEW.action IN ('hide','restore') THEN
     IF NOT EXISTS(SELECT 1 FROM public.v2_review_decision_evidence WHERE decision_id=r.id AND observation_id=o.id)
       OR (NEW.action='hide' AND (s.status<>'active' OR NEW.status<>'hidden'))
       OR (NEW.action='restore' AND (s.status<>'hidden' OR NEW.status<>'active')) THEN
       RAISE EXCEPTION 'v2_observation_moderation_transition_invalid' USING ERRCODE='23514'; END IF;
   ELSE
     SELECT * INTO previous FROM public.v2_observation_events WHERE id=s.latest_event_id;
     IF previous.review_decision_id IS DISTINCT FROM r.reverses_decision_id OR previous.action NOT IN ('hide','restore')
       OR NEW.status IS DISTINCT FROM previous.from_status THEN
       RAISE EXCEPTION 'v2_observation_reverse_current_effect_required' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_event_validate BEFORE INSERT ON public.v2_observation_events
 FOR EACH ROW EXECUTE FUNCTION public.v2_validate_observation_event();
CREATE TRIGGER v2_event_lock BEFORE INSERT OR UPDATE OR DELETE ON public.v2_observation_events
 FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport();

CREATE FUNCTION public.v2_guard_observation_state() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e public.v2_observation_events;
BEGIN
 IF TG_OP='DELETE' THEN
   IF NOT EXISTS(SELECT 1 FROM public.v2_observations WHERE id=OLD.observation_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'v2_observation_state_required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO e FROM public.v2_observation_events WHERE id=NEW.latest_event_id;
 IF NOT FOUND OR e.observation_id<>NEW.observation_id OR e.revision<>NEW.revision OR e.status<>NEW.status
   OR e.reason_code IS DISTINCT FROM NEW.reason_code THEN
   RAISE EXCEPTION 'v2_observation_state_requires_event' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NOT (
   (OLD.latest_event_id IS NULL AND e.action='baseline' AND NEW.revision=OLD.revision AND NEW.status=OLD.status)
   OR (NEW.observation_id=OLD.observation_id AND NEW.revision=OLD.revision+1 AND e.previous_event_id=OLD.latest_event_id)) THEN
   RAISE EXCEPTION 'v2_observation_state_history_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_observation_state_guard BEFORE INSERT OR UPDATE OR DELETE ON public.v2_observation_states
 FOR EACH ROW EXECUTE FUNCTION public.v2_guard_observation_state();

CREATE FUNCTION public.v2_project_observation_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject uuid;
BEGIN
 IF NEW.action='baseline' THEN
   UPDATE public.v2_observation_states SET latest_event_id=NEW.id WHERE observation_id=NEW.observation_id;
 ELSIF NEW.action='submit' THEN
   INSERT INTO public.v2_observation_states(observation_id,revision,status,reason_code,latest_event_id)
     VALUES(NEW.observation_id,NEW.revision,NEW.status,NEW.reason_code,NEW.id);
 ELSE
   UPDATE public.v2_observation_states SET revision=NEW.revision,status=NEW.status,reason_code=NEW.reason_code,latest_event_id=NEW.id,updated_at=now()
     WHERE observation_id=NEW.observation_id;
   -- The existing state trigger synchronously invalidates dependent selections.
   -- Also advance/enqueue when there was no selection yet, including restore.
   SELECT original_subject_id INTO subject FROM public.v2_observations WHERE id=NEW.observation_id;
   UPDATE public.v2_subjects SET revision=revision+1,input_generation=input_generation+1 WHERE id=subject;
   INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
     SELECT 'assess',id,input_generation,'observation-events/1',NEW.id FROM public.v2_subjects WHERE id=subject;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_event_project AFTER INSERT ON public.v2_observation_events
 FOR EACH ROW EXECUTE FUNCTION public.v2_project_observation_event();

CREATE FUNCTION public.v2_append_observation_event(actor varchar,observation uuid,expected bigint,operation text,
 request uuid DEFAULT NULL,review uuid DEFAULT NULL,replacement uuid DEFAULT NULL,note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.v2_observation_states; previous public.v2_observation_events; status text; reason text; result uuid;
BEGIN
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT * INTO s FROM public.v2_observation_states WHERE observation_id=observation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'v2_observation_missing' USING ERRCODE='23503'; END IF;
 IF expected IS NULL OR s.revision<>expected THEN RAISE EXCEPTION 'v2_observation_revision_conflict' USING ERRCODE='40001'; END IF;
 CASE operation
 WHEN 'withdraw' THEN status:='withdrawn'; reason:='author_withdrawal';
 WHEN 'supersede' THEN status:='superseded'; reason:='author_correction';
 WHEN 'hide' THEN status:='hidden';
 WHEN 'restore' THEN status:='active';
 WHEN 'reverse' THEN SELECT * INTO previous FROM public.v2_observation_events WHERE id=s.latest_event_id; status:=previous.from_status;
 ELSE RAISE EXCEPTION 'v2_observation_action_invalid' USING ERRCODE='23514'; END CASE;
 IF review IS NOT NULL THEN SELECT reason_code INTO reason FROM public.v2_review_decisions WHERE id=review; END IF;
 INSERT INTO public.v2_observation_events(observation_id,revision,action,from_status,status,previous_event_id,actor_user_id,reason_code,private_reason,request_id,review_decision_id,replacement_observation_id)
 VALUES(observation,s.revision+1,operation,s.status,status,s.latest_event_id,actor,reason,note,request,review,replacement) RETURNING id INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION public.v2_withdraw_observation(actor varchar,observation uuid,expected bigint,request uuid,note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owner_id varchar; receipt public.v2_observation_events;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'v2_observation_owner_required' USING ERRCODE='42501'; END IF;
 IF request IS NULL OR expected IS NULL OR expected<1 OR length(note)>2000 THEN RAISE EXCEPTION 'v2_observation_request_invalid' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor));
 UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 SELECT c.user_id INTO owner_id FROM public.v2_observations o JOIN public.v2_contributions c ON c.id=o.contribution_id WHERE o.id=observation;
 IF owner_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'v2_observation_owner_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM public.v2_observation_events WHERE observation_id=v2_withdraw_observation.observation AND request_id=request;
 IF FOUND THEN
   IF receipt.action<>'withdraw' OR receipt.actor_user_id IS DISTINCT FROM actor OR receipt.revision<>expected+1
     OR receipt.private_reason IS DISTINCT FROM note THEN RAISE EXCEPTION 'v2_observation_request_conflict' USING ERRCODE='23514'; END IF;
   RETURN receipt.id;
 END IF;
 RETURN public.v2_append_observation_event(actor,observation,expected,'withdraw',request,NULL,NULL,note);
END; $$;

CREATE OR REPLACE FUNCTION public.v2_initial_observation_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor varchar; previous_revision bigint;
BEGIN
 SELECT user_id INTO actor FROM public.v2_contributions WHERE id=NEW.contribution_id;
 INSERT INTO public.v2_observation_events(observation_id,revision,action,status,actor_user_id)
   VALUES(NEW.id,1,'submit','active',actor);
 IF NEW.supersedes_id IS NOT NULL THEN
   SELECT revision INTO previous_revision FROM public.v2_observation_states WHERE observation_id=NEW.supersedes_id;
   PERFORM public.v2_append_observation_event(actor,NEW.supersedes_id,previous_revision,'supersede',NULL,NULL,NEW.id);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_observation_insert_lock BEFORE INSERT ON public.v2_observations
 FOR EACH STATEMENT EXECUTE FUNCTION public.v2_lock_transport();

-- Review evidence is complete by the case-pointer update in v2_record_review.
-- Applying here makes the event, review and changed visibility one transaction.
CREATE FUNCTION public.v2_apply_moderation_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.v2_review_decisions; item record;
BEGIN
 IF NEW.kind<>'moderation' OR NEW.last_decision_id IS NOT DISTINCT FROM OLD.last_decision_id THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.v2_review_decisions WHERE id=NEW.last_decision_id;
 IF r.action IN ('hide','restore') THEN
   IF NOT EXISTS(SELECT 1 FROM public.v2_review_decision_evidence WHERE decision_id=r.id) THEN
     RAISE EXCEPTION 'v2_moderation_target_evidence_required' USING ERRCODE='23514'; END IF;
   FOR item IN SELECT e.observation_id,s.revision FROM public.v2_review_decision_evidence e
     JOIN public.v2_observation_states s ON s.observation_id=e.observation_id WHERE e.decision_id=r.id ORDER BY e.observation_id LOOP
     PERFORM public.v2_append_observation_event(r.actor_user_id,item.observation_id,item.revision,r.action,NULL,r.id);
   END LOOP;
 ELSIF r.action='reverse' THEN
   FOR item IN SELECT e.observation_id,s.revision FROM public.v2_observation_events e
     JOIN public.v2_observation_states s ON s.latest_event_id=e.id
     WHERE e.review_decision_id=r.reverses_decision_id AND e.action IN ('hide','restore') ORDER BY e.observation_id LOOP
     PERFORM public.v2_append_observation_event(r.actor_user_id,item.observation_id,item.revision,'reverse',NULL,r.id);
   END LOOP;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v2_moderation_events AFTER UPDATE ON public.v2_review_cases
 FOR EACH ROW EXECUTE FUNCTION public.v2_apply_moderation_events();

CREATE FUNCTION public.v2_erase_event_actor_notes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Existing account-erasure trigger has acquired account lock then guard.
 -- Redact the stream: later explanations could quote the erased actor's note.
 UPDATE public.v2_observation_events SET private_reason=NULL WHERE observation_id IN
   (SELECT observation_id FROM public.v2_observation_events WHERE actor_user_id=OLD.id);
 -- Erase owned streams while the account still exists. Otherwise the account's
 -- actor SET NULL and contribution CASCADE actions can interleave: an actor
 -- update would recheck an event's parent FK after its observation was deleted
 -- but before the queued event cascade ran. Other users' streams still receive
 -- normal actor anonymisation. Existing observation erasure hooks run here.
 DELETE FROM public.v2_observations WHERE contribution_id IN
   (SELECT id FROM public.v2_contributions WHERE user_id=OLD.id);
 RETURN OLD;
END; $$;
CREATE TRIGGER v2_erase_event_actor_notes BEFORE DELETE ON public.users
 FOR EACH ROW EXECUTE FUNCTION public.v2_erase_event_actor_notes();

ALTER TABLE public.v2_observation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_observation_events FROM PUBLIC,mabhazi_api;
GRANT SELECT ON public.v2_observation_events TO mabhazi_api;
CREATE POLICY api_server_access ON public.v2_observation_events FOR SELECT TO mabhazi_api USING(true);
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.v2_observation_states FROM mabhazi_api;
DO $$ DECLARE role_name text; f record; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.v2_observation_events FROM %I',role_name); END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
   'v2_event_immutable','v2_validate_observation_event','v2_guard_observation_state','v2_project_observation_event',
   'v2_append_observation_event','v2_withdraw_observation','v2_initial_observation_state','v2_apply_moderation_events','v2_erase_event_actor_notes') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,mabhazi_api',f.signature);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name); END IF;
   END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.v2_withdraw_observation(varchar,uuid,bigint,uuid,text) TO mabhazi_api;

-- Preserve old status/revision/reason/timestamp as one explicitly unattributed
-- baseline. Do not invent who made a historical change or replay old corrections.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_observations o LEFT JOIN public.v2_observation_states s ON s.observation_id=o.id WHERE s.observation_id IS NULL) THEN
   RAISE EXCEPTION 'v2_event_upgrade_requires_state_inventory' USING ERRCODE='23514'; END IF;
END; $$;
INSERT INTO public.v2_observation_events(observation_id,revision,action,status,reason_code)
 SELECT observation_id,revision,'baseline',status,reason_code FROM public.v2_observation_states;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.v2_observation_states ALTER COLUMN latest_event_id SET NOT NULL;
SET CONSTRAINTS ALL DEFERRED;
