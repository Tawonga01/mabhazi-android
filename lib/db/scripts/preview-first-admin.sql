-- Run only after explicit first-owner confirmation, as the migration owner.
-- The target is a verified existing Google account, supplied by the operator.
-- This is not an application function or a client-accessible grant endpoint.
DO $first_named_admin$
DECLARE target text:=current_setting('mabhazi.bootstrap_user',true);
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('public.v2_api_admin_route_action(varchar,uuid,jsonb)'))
  THEN RAISE EXCEPTION 'admin_bootstrap_owner_only' USING ERRCODE='42501';END IF;
 IF target IS NULL OR NOT public.v2_json_uuid(to_jsonb(target)) THEN RAISE EXCEPTION 'admin_bootstrap_target_invalid' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(target));UPDATE public.v2_transport_guard SET toggle=NOT toggle WHERE id;
 IF NOT EXISTS(SELECT 1 FROM mabhazi_migrations.applied WHERE name='0039_admin_property_batches.sql' AND checksum='09c61f1a7c5e4b1252f70243a8aacaf4f39669aef60193610250dc9697db2de5')
  OR NOT EXISTS(SELECT 1 FROM mabhazi_migrations.applied WHERE name='0040_admin_route_visibility.sql' AND checksum='4598a5a24c8e9c6b1203c44e9fb6ee7b1897ef03f51dd16f6ea1b2a843415a8d')
  THEN RAISE EXCEPTION 'admin_bootstrap_schema_changed' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM public.users WHERE id=target FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.auth_deletion_jobs WHERE user_id=target)
  OR NOT EXISTS(SELECT 1 FROM auth.users a WHERE a.id::text=target AND a.email_confirmed_at IS NOT NULL AND coalesce(a.raw_app_meta_data->'providers','[]'::jsonb)?'google')
  THEN RAISE EXCEPTION 'admin_bootstrap_verified_account_required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.v2_review_roles WHERE role='administrator' AND revoked_at IS NULL AND user_id<>target)
  THEN RAISE EXCEPTION 'admin_bootstrap_already_configured' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v2_review_roles WHERE role='administrator' AND revoked_at IS NULL AND user_id=target) THEN
  INSERT INTO public.v2_review_roles(user_id,role,reason_code) VALUES(target,'administrator','owner_approved_dashboard');
 END IF;
END;$first_named_admin$;
