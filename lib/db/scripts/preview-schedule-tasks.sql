-- Own Mabhazi Preview ocwlqhlfavvuncfmzuqh only, after specifically approved0033.
-- Independent SQL question refresh; no invitations, emails or native build.
BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(19092026,1);
UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
DO $schedule_tasks$ DECLARE existing record;BEGIN
 IF NOT EXISTS(SELECT 1 FROM mabhazi_migrations.applied WHERE name='0033_prompt_refresh_worker.sql'
  AND checksum='abeaa4508b9c59a8ed56a2e084ecd4540e24d9745c7c8adf6509fbf87c651896') THEN RAISE EXCEPTION 'prompt_preview_not_verified';END IF;
 IF (SELECT count(*) FROM cron.job WHERE active AND schedule='* * * * *' AND username=current_user AND database=current_database() AND
  ((jobname='mabhazi-preview-normalise-v1' AND command=$normal$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_normalise(20);$normal$)
  OR (jobname='mabhazi-preview-associate-v1' AND command=$associate$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_associate(20);$associate$)
  OR (jobname='mabhazi-preview-assess-v1' AND command=$assess$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_assess(20);$assess$)))<>3
  THEN RAISE EXCEPTION 'prompt_existing_schedule_changed';END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='mabhazi-preview-tasks-v1')>1 THEN RAISE EXCEPTION 'prompt_duplicate_schedule';END IF;
 SELECT * INTO existing FROM cron.job WHERE jobname='mabhazi-preview-tasks-v1';
 IF FOUND THEN
  IF NOT existing.active OR existing.schedule<>'* * * * *' OR existing.command<>$command$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_tasks(20);$command$
   OR existing.username<>current_user OR existing.database<>current_database() THEN RAISE EXCEPTION 'prompt_schedule_changed';END IF;
 ELSE
  PERFORM cron.schedule('mabhazi-preview-tasks-v1','* * * * *',$command$SET statement_timeout='20s'; SET lock_timeout='5s'; SELECT public.v2_worker_drain_tasks(20);$command$);
 END IF;
END;$schedule_tasks$;COMMIT;
SELECT jsonb_build_object('checkedAt',clock_timestamp(),'schedule',
 (SELECT jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'schedule',schedule,'active',active) ORDER BY jobname)
  FROM cron.job WHERE jobname IN('mabhazi-preview-normalise-v1','mabhazi-preview-associate-v1','mabhazi-preview-assess-v1','mabhazi-preview-tasks-v1')),
 'health',public.v2_worker_health())::text proof;
