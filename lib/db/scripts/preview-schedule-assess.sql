-- Own Mabhazi Preview ocwlqhlfavvuncfmzuqh only, after approved0031 application.
-- One independent SQL assessment tick per minute; no credentials, email or paid service.
BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $schedule_assessment$ DECLARE existing record;BEGIN
 IF NOT EXISTS(SELECT 1 FROM mabhazi_migrations.applied WHERE name='0031_assessment_worker.sql' AND checksum='ae4a5a5017046775147eaf562c90f234e23c47f28e90f11edd81ff94f7c60000') THEN RAISE EXCEPTION 'assessment_preview_not_verified';END IF;
 IF (SELECT count(*) FROM cron.job WHERE active AND schedule='* * * * *' AND
 ((jobname='mabhazi-preview-normalise-v1' AND command=$normal$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_normalise(20);$normal$)
 OR (jobname='mabhazi-preview-associate-v1' AND command=$associate$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_associate(20);$associate$)))<>2 THEN RAISE EXCEPTION 'assessment_existing_schedule_changed';END IF;
 SELECT * INTO existing FROM cron.job WHERE jobname='mabhazi-preview-assess-v1';
 IF FOUND THEN
  IF NOT existing.active OR existing.schedule<>'* * * * *' OR existing.command<>$command$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_assess(20);$command$ OR existing.username<>current_user OR existing.database<>current_database() THEN RAISE EXCEPTION 'assessment_schedule_changed';END IF;
 ELSE
  PERFORM cron.schedule('mabhazi-preview-assess-v1','* * * * *',$command$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_assess(20);$command$);
 END IF;
 -- Seed only uncovered active subjects. Existing failed jobs retain their budget
 -- and require the explicit owner retry; do not disguise them as fresh work.
 INSERT INTO public.v2_jobs(kind,subject_id,requested_generation,policy_version,trigger_id)
 SELECT 'assess',s.id,s.input_generation,'evidence/1',s.id FROM public.v2_subjects s
 WHERE s.lifecycle='active' AND EXISTS(SELECT 1 FROM public.v2_worker_assessment_scopes(s.id) x
  WHERE NOT public.v2_worker_assessment_scope_ready(s.id,x.field_key,x.scope_key))
 AND NOT EXISTS(SELECT 1 FROM public.v2_jobs j WHERE j.subject_id=s.id AND j.kind='assess' AND j.policy_version='evidence/1' AND j.requested_generation=s.input_generation AND j.state IN('pending','leased','failed'))
 ON CONFLICT DO NOTHING;
END;$schedule_assessment$;COMMIT;
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'schedule',(SELECT jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'schedule',schedule,'active',active) ORDER BY jobname) FROM cron.job WHERE jobname IN('mabhazi-preview-normalise-v1','mabhazi-preview-associate-v1','mabhazi-preview-assess-v1')),'health',public.v2_worker_health())::text proof;
